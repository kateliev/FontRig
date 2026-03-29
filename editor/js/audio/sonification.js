// ===================================================================
// FontRig — Curve Sonification Engine
// ===================================================================
// Converts bezier curve geometry into audio signals using the
// Web Audio API. Based on research by Shelley et al. (2009) on
// interactive sonification of curvature data, and Thoret et al.
// (2012) on biological movement-to-sound mapping.
//
// Mapping strategy:
//   - Curvature kappa(t)  ->  Pitch (frequency)
//   - d(kappa)/dt         ->  Harmonic distortion (roughness)
//   - Inflection points   ->  Transient clicks
//
// Live loop mode: stores contour references and re-reads node
// positions each cycle, so edits are heard in real time.
//
// Self-contained bezier math — no dependency on external Bezier lib.
// ===================================================================
'use strict';

(function() {

if (typeof FontRig === 'undefined') return;

// ===================================================================
// CurveSonifier — main engine
// ===================================================================
FontRig.CurveSonifier = {};

// -- State ----------------------------------------------------------
var _ctx        = null;   // AudioContext
var _master     = null;   // master gain
var _voices     = [];     // active voice objects
var _playing    = false;
var _loopState  = null;   // { mode, contours, segmentGroups, panValues }

var _settings   = {
	// Pitch mapping
	minFreq:      80,       // Hz — lowest curvature maps here
	maxFreq:      2000,     // Hz — highest curvature maps here

	// Timing
	duration:     2.0,      // seconds per contour playback
	sampleCount:  256,      // curvature samples along curve

	// Timbre
	waveform:     'sine',   // see _WAVEFORMS for list
	roughness:    0.5,      // 0-1: how much dK/dt adds distortion

	// Amplitude
	volume:       0.6,      // 0-1 master volume

	// Inflection clicks
	clickVolume:  0.7,      // 0-1
	clickEnabled: true,

	// Curvature scaling
	curvatureScale: 'log',  // 'linear', 'log', 'sqrt'

	// Multi-voice
	stereoSpread: 0.8,      // 0-1: how far voices are panned

	// Sweep direction — aligns opposing contours for comparison.
	sweepDirection: 'bottom-top',

	// Looping
	loop: false,
};

// -- Public getters/setters -----------------------------------------
FontRig.CurveSonifier.getSettings = function() {
	return Object.assign({}, _settings);
};

FontRig.CurveSonifier.setSetting = function(key, value) {
	if (_settings.hasOwnProperty(key)) {
		_settings[key] = value;
	}
};

FontRig.CurveSonifier.isPlaying = function() {
	return _playing;
};

// ===================================================================
// Waveform registry
// ===================================================================
// Each waveform is a function(phase, harmonicPhases) -> sample.
// harmonicPhases is an array of [phase*2, phase*3, ...] for timbres
// that need pre-computed harmonic phases.
var _WAVEFORMS = {
	'sine': function(ph) {
		return Math.sin(ph);
	},
	'triangle': function(ph) {
		return 2 * Math.abs(2 * (ph / (2 * Math.PI)) - 1) - 1;
	},
	'sawtooth': function(ph) {
		return 2 * (ph / (2 * Math.PI)) - 1;
	},
	'cello': function(ph) {
		return 0.50 * Math.sin(ph) +
			   0.25 * Math.sin(2 * ph) +
			   0.12 * Math.sin(3 * ph) +
			   0.06 * Math.sin(4 * ph) +
			   0.03 * Math.sin(5 * ph);
	},
	// -- Vocal "ah" — three formant peaks (F1=800, F2=1200, F3=2500)
	// approximated as weighted harmonics with a spectral tilt
	'voice': function(ph) {
		var f = 0;
		// Fundamental + harmonics with 1/n rolloff shaped by formants
		for (var n = 1; n <= 12; n++) {
			// Spectral tilt: -6dB/octave base
			var amp = 1.0 / n;
			// Boost near formant ratios (relative to fundamental)
			// F1~2nd-3rd, F2~4th-5th, F3~8th-10th
			if (n >= 2 && n <= 3)  amp *= 2.5;
			if (n >= 4 && n <= 5)  amp *= 1.8;
			if (n >= 8 && n <= 10) amp *= 1.2;
			f += amp * Math.sin(n * ph);
		}
		return f * 0.3;
	},
	// -- Flute: breathy sine with odd harmonics
	'flute': function(ph) {
		return 0.60 * Math.sin(ph) +
			   0.15 * Math.sin(3 * ph) +
			   0.05 * Math.sin(5 * ph) +
			   0.10 * (Math.random() * 2 - 1) * 0.2;  // breath noise
	},
	// -- Pad: detuned unison — warm and slow
	'pad': function(ph) {
		return 0.25 * Math.sin(ph) +
			   0.25 * Math.sin(ph * 1.003) +
			   0.25 * Math.sin(ph * 0.997) +
			   0.15 * Math.sin(ph * 2.001) +
			   0.10 * Math.sin(ph * 0.5);
	},
	// -- Glass: FM bell-like tone
	'glass': function(ph) {
		var mod = Math.sin(ph * 3.5) * 0.7;
		return Math.sin(ph + mod) * 0.6 +
			   Math.sin(ph * 2 + mod * 0.5) * 0.25 +
			   Math.sin(ph * 5.43) * 0.08;
	},
	// -- Bowed string: bright sawtooth softened by body resonance
	'bowed': function(ph) {
		var saw = 0;
		for (var n = 1; n <= 8; n++) {
			var sign = (n % 2 === 0) ? -1 : 1;
			saw += sign * Math.sin(n * ph) / n;
		}
		// Soften with a low-pass approximation (weighted average)
		return saw * 0.45;
	},
};

// Get list of waveform names for UI
FontRig.CurveSonifier.getWaveformNames = function() {
	return Object.keys(_WAVEFORMS);
};

// ===================================================================
// AudioContext management
// ===================================================================
function _ensureContext() {
	if (_ctx) return _ctx;
	try {
		_ctx = new (window.AudioContext || window.webkitAudioContext)();
		_master = _ctx.createGain();
		_master.gain.value = _settings.volume;
		_master.connect(_ctx.destination);
	} catch (e) {
		console.error('[CurveSonifier] Web Audio API not available:', e);
		return null;
	}
	return _ctx;
}

// ===================================================================
// Self-contained Bezier math
// ===================================================================
function _cubicPoint(pts, t) {
	var t2 = t * t, t3 = t2 * t;
	var mt = 1 - t, mt2 = mt * mt, mt3 = mt2 * mt;
	return {
		x: mt3 * pts[0].x + 3 * mt2 * t * pts[1].x + 3 * mt * t2 * pts[2].x + t3 * pts[3].x,
		y: mt3 * pts[0].y + 3 * mt2 * t * pts[1].y + 3 * mt * t2 * pts[2].y + t3 * pts[3].y,
	};
}

function _cubicDeriv(pts, t) {
	var mt = 1 - t;
	return {
		x: 3 * mt * mt * (pts[1].x - pts[0].x) + 6 * mt * t * (pts[2].x - pts[1].x) + 3 * t * t * (pts[3].x - pts[2].x),
		y: 3 * mt * mt * (pts[1].y - pts[0].y) + 6 * mt * t * (pts[2].y - pts[1].y) + 3 * t * t * (pts[3].y - pts[2].y),
	};
}

function _cubicDeriv2(pts, t) {
	var mt = 1 - t;
	return {
		x: 6 * mt * (pts[2].x - 2 * pts[1].x + pts[0].x) + 6 * t * (pts[3].x - 2 * pts[2].x + pts[1].x),
		y: 6 * mt * (pts[2].y - 2 * pts[1].y + pts[0].y) + 6 * t * (pts[3].y - 2 * pts[2].y + pts[1].y),
	};
}

function _quadPoint(pts, t) {
	var mt = 1 - t;
	return {
		x: mt * mt * pts[0].x + 2 * mt * t * pts[1].x + t * t * pts[2].x,
		y: mt * mt * pts[0].y + 2 * mt * t * pts[1].y + t * t * pts[2].y,
	};
}

function _quadDeriv(pts, t) {
	var mt = 1 - t;
	return {
		x: 2 * mt * (pts[1].x - pts[0].x) + 2 * t * (pts[2].x - pts[1].x),
		y: 2 * mt * (pts[1].y - pts[0].y) + 2 * t * (pts[2].y - pts[1].y),
	};
}

function _quadDeriv2(pts) {
	return {
		x: 2 * (pts[2].x - 2 * pts[1].x + pts[0].x),
		y: 2 * (pts[2].y - 2 * pts[1].y + pts[0].y),
	};
}

function _curvatureAt(seg, t) {
	var d1, d2;
	if (seg.type === 'cubic') {
		d1 = _cubicDeriv(seg.pts, t);
		d2 = _cubicDeriv2(seg.pts, t);
	} else if (seg.type === 'quadratic') {
		d1 = _quadDeriv(seg.pts, t);
		d2 = _quadDeriv2(seg.pts);
	} else {
		return 0;
	}
	var cross = d1.x * d2.y - d1.y * d2.x;
	var speed2 = d1.x * d1.x + d1.y * d1.y;
	var speed = Math.sqrt(speed2);
	if (speed < 1e-8) return 0;
	return cross / (speed2 * speed);
}

function _speedAt(seg, t) {
	var d1;
	if (seg.type === 'cubic') {
		d1 = _cubicDeriv(seg.pts, t);
	} else if (seg.type === 'quadratic') {
		d1 = _quadDeriv(seg.pts, t);
	} else {
		var dx = seg.pts[1].x - seg.pts[0].x;
		var dy = seg.pts[1].y - seg.pts[0].y;
		return Math.sqrt(dx * dx + dy * dy);
	}
	return Math.sqrt(d1.x * d1.x + d1.y * d1.y);
}

function _pointOnSegment(seg, t) {
	if (seg.type === 'cubic') return _cubicPoint(seg.pts, t);
	if (seg.type === 'quadratic') return _quadPoint(seg.pts, t);
	return {
		x: seg.pts[0].x + t * (seg.pts[1].x - seg.pts[0].x),
		y: seg.pts[0].y + t * (seg.pts[1].y - seg.pts[0].y),
	};
}

function _segmentLength(seg) {
	if (seg.type === 'line') {
		var dx = seg.pts[1].x - seg.pts[0].x;
		var dy = seg.pts[1].y - seg.pts[0].y;
		return Math.sqrt(dx * dx + dy * dy);
	}
	var nodes = [0.04691008, 0.23076534, 0.5, 0.76923466, 0.95308992];
	var weights = [0.11846345, 0.23931434, 0.28444444, 0.23931434, 0.11846345];
	var len = 0;
	for (var i = 0; i < 5; i++) {
		len += weights[i] * _speedAt(seg, nodes[i]);
	}
	return len;
}

// ===================================================================
// Bezier segment extraction from contour
// ===================================================================
function _extractSegments(contour) {
	var nodes = contour.nodes;
	var n = nodes.length;
	if (n < 2) return [];

	var segments = [];
	var firstOn = 0;
	for (var j = 0; j < n; j++) {
		if (nodes[j].type === 'on') { firstOn = j; break; }
	}

	var i = firstOn;
	var count = 0;
	var limit = contour.closed ? n : n - 1;

	while (count < limit) {
		var curr = nodes[i];
		var next_i = (i + 1) % n;
		var nextNode = nodes[next_i];

		if (curr.type === 'on' && nextNode.type === 'on') {
			segments.push({
				type: 'line',
				pts: [ {x: curr.x, y: curr.y}, {x: nextNode.x, y: nextNode.y} ],
				nodeIndices: [i, next_i],
			});
			i = next_i;
			count++;
		} else if (nextNode.type === 'curve') {
			var ci1 = next_i, ci2 = (i + 2) % n, oi = (i + 3) % n;
			var b1 = nextNode, b2 = nodes[ci2], on = nodes[oi];
			segments.push({
				type: 'cubic',
				pts: [{x: curr.x, y: curr.y}, {x: b1.x, y: b1.y},
					  {x: b2.x, y: b2.y}, {x: on.x, y: on.y}],
				nodeIndices: [i, ci1, ci2, oi],
			});
			i = oi;
			count += 3;
		} else if (nextNode.type === 'off') {
			var qi = next_i, oi2 = (i + 2) % n;
			var off = nextNode, on2 = nodes[oi2];
			segments.push({
				type: 'quadratic',
				pts: [{x: curr.x, y: curr.y}, {x: off.x, y: off.y},
					  {x: on2.x, y: on2.y}],
				nodeIndices: [i, qi, oi2],
			});
			i = oi2;
			count += 2;
		} else {
			i = next_i;
			count++;
		}
	}
	return segments;
}

// ===================================================================
// Curvature analysis
// ===================================================================
function _analyzeCurvature(segments, sampleCount) {
	var empty = { kappa: [], dKappa: [], arcT: [], inflections: [],
				  totalLength: 0, reversed: false };
	if (segments.length === 0) return empty;

	var segLengths = [];
	var totalLength = 0;
	for (var s = 0; s < segments.length; s++) {
		var len = _segmentLength(segments[s]);
		segLengths.push(len);
		totalLength += len;
	}
	if (totalLength === 0) return empty;

	var kappa = [];
	var arcT  = [];
	var startPos = null;
	var endPos   = null;

	for (var i = 0; i < sampleCount; i++) {
		var targetDist = (i / (sampleCount - 1)) * totalLength;
		var cumDist = 0, segIdx = 0, localDist = targetDist;

		for (var s = 0; s < segments.length; s++) {
			if (cumDist + segLengths[s] >= targetDist || s === segments.length - 1) {
				segIdx = s;
				localDist = targetDist - cumDist;
				break;
			}
			cumDist += segLengths[s];
		}

		var localT = segLengths[segIdx] > 0 ? localDist / segLengths[segIdx] : 0;
		localT = Math.max(0, Math.min(1, localT));

		var k = _curvatureAt(segments[segIdx], localT);
		if (!isFinite(k)) k = 0;

		kappa.push(k);
		arcT.push(i / (sampleCount - 1));

		if (i === 0) startPos = _pointOnSegment(segments[segIdx], localT);
		if (i === sampleCount - 1) endPos = _pointOnSegment(segments[segIdx], localT);
	}

	// Direction alignment
	var reversed = false;
	var dir = _settings.sweepDirection;
	if (dir && dir !== 'path' && startPos && endPos) {
		var needsReverse = false;
		switch (dir) {
			case 'bottom-top':  needsReverse = (endPos.y < startPos.y); break;
			case 'top-bottom':  needsReverse = (endPos.y > startPos.y); break;
			case 'left-right':  needsReverse = (endPos.x < startPos.x); break;
			case 'right-left':  needsReverse = (endPos.x > startPos.x); break;
		}
		if (needsReverse) { kappa.reverse(); reversed = true; }
	}

	// dKappa and inflections
	var dKappa = [];
	for (var i = 0; i < kappa.length; i++) {
		if (i === 0) dKappa.push(kappa[1] - kappa[0]);
		else if (i === kappa.length - 1) dKappa.push(kappa[i] - kappa[i - 1]);
		else dKappa.push((kappa[i + 1] - kappa[i - 1]) / 2);
	}

	var inflections = [];
	for (var i = 1; i < kappa.length; i++) {
		if ((kappa[i - 1] > 0 && kappa[i] < 0) ||
			(kappa[i - 1] < 0 && kappa[i] > 0)) {
			inflections.push(i / sampleCount);
		}
	}

	return { kappa: kappa, dKappa: dKappa, arcT: arcT, inflections: inflections,
			 totalLength: totalLength, reversed: reversed };
}

// ===================================================================
// Curvature-to-frequency mapping
// ===================================================================
function _kappaToFreq(k, kappaRange) {
	var absK = Math.abs(k);
	var norm;
	var maxK = kappaRange.max || 1;

	switch (_settings.curvatureScale) {
		case 'log':  norm = Math.log(1 + absK) / Math.log(1 + maxK); break;
		case 'sqrt': norm = Math.sqrt(absK / maxK); break;
		default:     norm = absK / maxK;
	}
	norm = Math.max(0, Math.min(1, norm));
	return _settings.minFreq + norm * (_settings.maxFreq - _settings.minFreq);
}

// ===================================================================
// Voice: render audio buffer for one contour/segment group
// ===================================================================
function _renderBuffer(analysis) {
	var ctx = _ctx;
	var dur = _settings.duration;
	var sr = ctx.sampleRate;
	var totalSamples = Math.floor(sr * dur);

	// Curvature range for normalization
	var kappaRange = { min: 0, max: 0.001 };
	for (var i = 0; i < analysis.kappa.length; i++) {
		var absK = Math.abs(analysis.kappa[i]);
		if (absK > kappaRange.max) kappaRange.max = absK;
	}
	var dKappaMax = 0.001;
	for (var i = 0; i < analysis.dKappa.length; i++) {
		var absD = Math.abs(analysis.dKappa[i]);
		if (absD > dKappaMax) dKappaMax = absD;
	}

	var buffer = ctx.createBuffer(1, totalSamples, sr);
	var data = buffer.getChannelData(0);

	var phase = 0;
	var sampleCount = analysis.kappa.length;
	var waveformFn = _WAVEFORMS[_settings.waveform] || _WAVEFORMS['sine'];

	for (var s = 0; s < totalSamples; s++) {
		var t = s / totalSamples;

		// Interpolate curvature
		var floatIdx = t * (sampleCount - 1);
		var idx0 = Math.floor(floatIdx);
		var idx1 = Math.min(idx0 + 1, sampleCount - 1);
		var frac = floatIdx - idx0;

		var k  = analysis.kappa[idx0]  * (1 - frac) + analysis.kappa[idx1]  * frac;
		var dk = analysis.dKappa[idx0] * (1 - frac) + analysis.dKappa[idx1] * frac;

		var freq = _kappaToFreq(k, kappaRange);

		phase += (2 * Math.PI * freq) / sr;
		if (phase > 2 * Math.PI) phase -= 2 * Math.PI;

		var sample = waveformFn(phase);

		// Roughness from curvature derivative
		var roughAmount = _settings.roughness * Math.abs(dk) / dKappaMax;
		roughAmount = Math.min(roughAmount, 0.8);
		if (roughAmount > 0.01) {
			sample = sample * (1 - roughAmount) +
					 roughAmount * Math.tanh(sample * (1 + roughAmount * 4));
		}

		// Fade in/out envelope
		var env = 1.0;
		var fadeLen = 0.015;
		if (t < fadeLen) env = t / fadeLen;
		if (t > 1 - fadeLen) env = (1 - t) / fadeLen;

		data[s] = sample * env * 0.5;
	}

	// Inflection clicks
	if (_settings.clickEnabled && analysis.inflections.length > 0) {
		var clickLen = Math.floor(sr * 0.003);
		for (var ci = 0; ci < analysis.inflections.length; ci++) {
			var clickPos = Math.floor(analysis.inflections[ci] * totalSamples);
			for (var cs = 0; cs < clickLen && (clickPos + cs) < totalSamples; cs++) {
				var clickEnv = 1 - cs / clickLen;
				data[clickPos + cs] += _settings.clickVolume * clickEnv *
					(Math.random() * 2 - 1) * 0.3;
			}
		}
	}

	return buffer;
}

// ===================================================================
// Live loop: schedule next cycle by re-reading contours
// ===================================================================
// _loopState holds:
//   mode: 'contours' | 'segmentGroups'
//   contours: array of live contour references   (mode=contours)
//   segmentGroups: array of segment arrays        (mode=segmentGroups)
//       — for segmentGroups we store contour refs + selByContour
//         so we can re-extract fresh segments each cycle
//   contourRefs: [{contour, selNodes}]            (mode=segmentGroups)
//   panValues: array of pan values per voice

function _scheduleNextCycle() {
	if (!_playing || !_loopState) return;

	var ls = _loopState;
	var analyses = [];
	var panValues = ls.panValues;

	if (ls.mode === 'contours') {
		// Re-extract segments from live contour references
		for (var c = 0; c < ls.contours.length; c++) {
			var segments = _extractSegments(ls.contours[c]);
			if (segments.length === 0) {
				analyses.push(null);
				continue;
			}
			analyses.push(_analyzeCurvature(segments, _settings.sampleCount));
		}
	} else if (ls.mode === 'segmentGroups') {
		// Re-extract and re-filter segments from contour refs
		var groups = [];
		for (var r = 0; r < ls.contourRefs.length; r++) {
			var ref = ls.contourRefs[r];
			var segments = _extractSegments(ref.contour);
			if (segments.length === 0) continue;

			if (!ref.selNodes) {
				// Whole contour
				groups.push(segments);
			} else {
				// Filter by selected node indices
				var currentRun = [];
				for (var s = 0; s < segments.length; s++) {
					var indices = segments[s].nodeIndices;
					var startNode = indices[0];
					var endNode   = indices[indices.length - 1];
					if (ref.selNodes.has(startNode) || ref.selNodes.has(endNode)) {
						currentRun.push(segments[s]);
					} else {
						if (currentRun.length > 0) { groups.push(currentRun); currentRun = []; }
					}
				}
				if (currentRun.length > 0) groups.push(currentRun);
			}
		}

		// Recompute pan values if group count changed
		var nGroups = groups.length;
		panValues = [];
		for (var g = 0; g < nGroups; g++) {
			if (nGroups <= 1) panValues.push(0);
			else panValues.push(-_settings.stereoSpread + (2 * _settings.stereoSpread * g / (nGroups - 1)));
		}

		for (var g = 0; g < groups.length; g++) {
			analyses.push(_analyzeCurvature(groups[g], _settings.sampleCount));
		}
	}

	// Build and start new voices
	_stopVoices();
	var newVoices = [];

	for (var v = 0; v < analyses.length; v++) {
		if (!analyses[v] || analyses[v].kappa.length === 0) continue;

		var buf = _renderBuffer(analyses[v]);
		var source = _ctx.createBufferSource();
		source.buffer = buf;

		var panner = _ctx.createStereoPanner();
		panner.pan.value = panValues[v] || 0;

		var gain = _ctx.createGain();
		gain.gain.value = _settings.volume;

		source.connect(gain);
		gain.connect(panner);
		panner.connect(_master);

		newVoices.push({ source: source, gain: gain, panner: panner,
						 analysis: analyses[v], index: v });
	}

	if (newVoices.length === 0) {
		if (_settings.loop) {
			// Keep trying — user might add nodes back
			setTimeout(function() { _scheduleNextCycle(); }, 500);
		} else {
			_playing = false;
			_loopState = null;
			if (FontRig.CurveSonifier.onPlayStateChange)
				FontRig.CurveSonifier.onPlayStateChange(false);
		}
		return;
	}

	// Start all voices
	var startTime = _ctx.currentTime + 0.01;
	var endCount = 0;

	for (var v = 0; v < newVoices.length; v++) {
		newVoices[v].source.start(startTime);
		newVoices[v].source.onended = function() {
			endCount++;
			if (endCount >= newVoices.length) {
				if (_settings.loop && _playing && _loopState) {
					// Re-read contour data and schedule next cycle
					_scheduleNextCycle();
				} else {
					_playing = false;
					_loopState = null;
					_voices = [];
					if (FontRig.CurveSonifier.onPlayStateChange)
						FontRig.CurveSonifier.onPlayStateChange(false);
				}
			}
		};
	}

	_voices = newVoices;

	// Notify with latest analyses for visualization
	var validAnalyses = [];
	for (var v = 0; v < analyses.length; v++) {
		if (analyses[v] && analyses[v].kappa.length > 0) validAnalyses.push(analyses[v]);
	}
	if (FontRig.CurveSonifier.onAnalysisUpdate) {
		FontRig.CurveSonifier.onAnalysisUpdate(validAnalyses);
	}
}

// Stop only the audio source nodes (not the loop state)
function _stopVoices() {
	for (var i = 0; i < _voices.length; i++) {
		try { _voices[i].source.onended = null; } catch (e) {}
		try { _voices[i].source.stop(); } catch (e) {}
	}
	_voices = [];
}

// ===================================================================
// Public API
// ===================================================================

// Stop everything
FontRig.CurveSonifier.stop = function() {
	_stopVoices();
	_loopState = null;
	_playing = false;
	if (FontRig.CurveSonifier.onPlayStateChange) {
		FontRig.CurveSonifier.onPlayStateChange(false);
	}
};

// Play full contours (stores live references for loop re-read)
FontRig.CurveSonifier.playContours = function(contours) {
	FontRig.CurveSonifier.stop();

	var ctx = _ensureContext();
	if (!ctx) return null;
	if (ctx.state === 'suspended') ctx.resume();

	// Compute pan values
	var panValues = [];
	for (var c = 0; c < contours.length; c++) {
		if (contours.length <= 1) panValues.push(0);
		else panValues.push(-_settings.stereoSpread +
			(2 * _settings.stereoSpread * c / (contours.length - 1)));
	}

	_loopState = {
		mode:      'contours',
		contours:  contours,     // LIVE references — re-read each cycle
		panValues: panValues,
	};

	_playing = true;
	if (FontRig.CurveSonifier.onPlayStateChange) {
		FontRig.CurveSonifier.onPlayStateChange(true);
	}

	_scheduleNextCycle();
};

// Play active glyph's contours
FontRig.CurveSonifier.playActiveGlyph = function() {
	var layer = FontRig.getActiveLayer();
	if (!layer) return null;

	var contours = [];
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			if (shape.contours[ki].nodes.length >= 2) {
				contours.push(shape.contours[ki]);
			}
		}
	}
	if (contours.length === 0) return null;
	FontRig.CurveSonifier.playContours(contours);
};

// Play selected segments (stores contour refs + selection for re-read)
FontRig.CurveSonifier.playSelectedSegments = function() {
	var layer = FontRig.getActiveLayer();
	if (!layer) return null;

	var selectedIds = FontRig.state.selectedNodeIds;
	if (!selectedIds || selectedIds.size === 0) {
		return FontRig.CurveSonifier.playActiveGlyph();
	}

	// Build per-contour selection map
	var allNodes = FontRig.getAllNodes(layer);
	var selByContour = {};
	selectedIds.forEach(function(id) {
		for (var i = 0; i < allNodes.length; i++) {
			if (allNodes[i].id === id) {
				var ci = allNodes[i].contourIdx;
				var ni = allNodes[i].nodeIdx;
				if (!selByContour[ci]) selByContour[ci] = new Set();
				selByContour[ci].add(ni);
				break;
			}
		}
	});

	// Build contour refs with selection info
	var contourRefs = [];
	var ci = 0;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			var contour = shape.contours[ki];
			var selNodes = selByContour[ci];
			ci++;
			if (!selNodes || contour.nodes.length < 2) continue;
			contourRefs.push({ contour: contour, selNodes: selNodes });
		}
	}

	if (contourRefs.length === 0) return null;

	FontRig.CurveSonifier.stop();

	var ctx = _ensureContext();
	if (!ctx) return null;
	if (ctx.state === 'suspended') ctx.resume();

	_loopState = {
		mode:        'segmentGroups',
		contourRefs: contourRefs,   // LIVE references
		panValues:   [],            // computed in _scheduleNextCycle
	};

	_playing = true;
	if (FontRig.CurveSonifier.onPlayStateChange) {
		FontRig.CurveSonifier.onPlayStateChange(true);
	}

	_scheduleNextCycle();
};

// ===================================================================
// Analysis-only (for visualization without playback)
// ===================================================================
FontRig.CurveSonifier.analyzeContour = function(contour) {
	var segments = _extractSegments(contour);
	if (segments.length === 0) return null;
	return _analyzeCurvature(segments, _settings.sampleCount);
};

// ===================================================================
// Callbacks
// ===================================================================
FontRig.CurveSonifier.onPlayStateChange = null;
FontRig.CurveSonifier.onAnalysisUpdate  = null;   // called each loop cycle

})();
