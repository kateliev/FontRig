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
//   - Arc-length speed    ->  Amplitude envelope
//   - Inflection points   ->  Transient clicks
//   - G2 breaks           ->  Noise bursts
//
// Multiple contours can be played as simultaneous voices
// (left/right stereo panning) for comparative listening.
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
var _settings   = {
	// Pitch mapping
	minFreq:      80,       // Hz — lowest curvature maps here
	maxFreq:      2000,     // Hz — highest curvature maps here
	baseFreq:     440,      // Hz — zero curvature baseline

	// Timing
	duration:     2.0,      // seconds per contour playback
	sampleCount:  256,      // curvature samples along curve

	// Timbre
	waveform:     'sine',   // 'sine', 'triangle', 'cello', 'sawtooth'
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

	// Sweep direction — how samples are ordered in time
	// 'path'        : walk along contour in its native direction
	// 'bottom-top'  : sort by Y ascending  (stem comparison)
	// 'top-bottom'  : sort by Y descending
	// 'left-right'  : sort by X ascending  (crossbar comparison)
	// 'right-left'  : sort by X descending
	sweepDirection: 'bottom-top',
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
// Segment representation: { type: 'cubic'|'quadratic'|'line', pts: [{x,y},...] }
// Cubic: 4 points, Quadratic: 3 points, Line: 2 points

// Evaluate cubic bezier at parameter t
function _cubicPoint(pts, t) {
	var t2 = t * t, t3 = t2 * t;
	var mt = 1 - t, mt2 = mt * mt, mt3 = mt2 * mt;
	return {
		x: mt3 * pts[0].x + 3 * mt2 * t * pts[1].x + 3 * mt * t2 * pts[2].x + t3 * pts[3].x,
		y: mt3 * pts[0].y + 3 * mt2 * t * pts[1].y + 3 * mt * t2 * pts[2].y + t3 * pts[3].y,
	};
}

// First derivative of cubic bezier
function _cubicDeriv(pts, t) {
	var mt = 1 - t;
	return {
		x: 3 * mt * mt * (pts[1].x - pts[0].x) + 6 * mt * t * (pts[2].x - pts[1].x) + 3 * t * t * (pts[3].x - pts[2].x),
		y: 3 * mt * mt * (pts[1].y - pts[0].y) + 6 * mt * t * (pts[2].y - pts[1].y) + 3 * t * t * (pts[3].y - pts[2].y),
	};
}

// Second derivative of cubic bezier
function _cubicDeriv2(pts, t) {
	var mt = 1 - t;
	return {
		x: 6 * mt * (pts[2].x - 2 * pts[1].x + pts[0].x) + 6 * t * (pts[3].x - 2 * pts[2].x + pts[1].x),
		y: 6 * mt * (pts[2].y - 2 * pts[1].y + pts[0].y) + 6 * t * (pts[3].y - 2 * pts[2].y + pts[1].y),
	};
}

// Evaluate quadratic bezier at parameter t
function _quadPoint(pts, t) {
	var mt = 1 - t;
	return {
		x: mt * mt * pts[0].x + 2 * mt * t * pts[1].x + t * t * pts[2].x,
		y: mt * mt * pts[0].y + 2 * mt * t * pts[1].y + t * t * pts[2].y,
	};
}

// First derivative of quadratic bezier
function _quadDeriv(pts, t) {
	var mt = 1 - t;
	return {
		x: 2 * mt * (pts[1].x - pts[0].x) + 2 * t * (pts[2].x - pts[1].x),
		y: 2 * mt * (pts[1].y - pts[0].y) + 2 * t * (pts[2].y - pts[1].y),
	};
}

// Second derivative of quadratic bezier (constant)
function _quadDeriv2(pts) {
	return {
		x: 2 * (pts[2].x - 2 * pts[1].x + pts[0].x),
		y: 2 * (pts[2].y - 2 * pts[1].y + pts[0].y),
	};
}

// Compute signed curvature: kappa = (x'*y'' - y'*x'') / (x'^2 + y'^2)^(3/2)
function _curvatureAt(seg, t) {
	var d1, d2;

	if (seg.type === 'cubic') {
		d1 = _cubicDeriv(seg.pts, t);
		d2 = _cubicDeriv2(seg.pts, t);
	} else if (seg.type === 'quadratic') {
		d1 = _quadDeriv(seg.pts, t);
		d2 = _quadDeriv2(seg.pts);
	} else {
		// Line — zero curvature
		return 0;
	}

	var cross = d1.x * d2.y - d1.y * d2.x;
	var speed2 = d1.x * d1.x + d1.y * d1.y;
	var speed = Math.sqrt(speed2);

	if (speed < 1e-8) return 0;

	return cross / (speed2 * speed);
}

// Speed (magnitude of first derivative) at parameter t
function _speedAt(seg, t) {
	var d1;
	if (seg.type === 'cubic') {
		d1 = _cubicDeriv(seg.pts, t);
	} else if (seg.type === 'quadratic') {
		d1 = _quadDeriv(seg.pts, t);
	} else {
		// Line: constant speed
		var dx = seg.pts[1].x - seg.pts[0].x;
		var dy = seg.pts[1].y - seg.pts[0].y;
		return Math.sqrt(dx * dx + dy * dy);
	}
	return Math.sqrt(d1.x * d1.x + d1.y * d1.y);
}

// Evaluate position on any segment type at parameter t
function _pointOnSegment(seg, t) {
	if (seg.type === 'cubic') {
		return _cubicPoint(seg.pts, t);
	} else if (seg.type === 'quadratic') {
		return _quadPoint(seg.pts, t);
	} else {
		// Line: lerp
		return {
			x: seg.pts[0].x + t * (seg.pts[1].x - seg.pts[0].x),
			y: seg.pts[0].y + t * (seg.pts[1].y - seg.pts[0].y),
		};
	}
}

// Approximate arc length of a segment via Gauss-Legendre quadrature (5-point)
function _segmentLength(seg) {
	if (seg.type === 'line') {
		var dx = seg.pts[1].x - seg.pts[0].x;
		var dy = seg.pts[1].y - seg.pts[0].y;
		return Math.sqrt(dx * dx + dy * dy);
	}

	// 5-point Gauss-Legendre on [0,1]
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
// Walks contour nodes and returns an array of segment objects
// with self-contained point data.
//
// Each segment also carries `nodeIndices`: the contour node indices
// that define it, so callers can filter by selection.
// A segment is considered "selected" when any of its on-curve
// anchor nodes is in the selection set.
function _extractSegments(contour) {
	var nodes = contour.nodes;
	var n = nodes.length;
	if (n < 2) return [];

	var segments = [];

	// Find first on-curve
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
			// Line segment
			segments.push({
				type: 'line',
				pts: [ {x: curr.x, y: curr.y}, {x: nextNode.x, y: nextNode.y} ],
				nodeIndices: [i, next_i],
			});
			i = next_i;
			count++;

		} else if (nextNode.type === 'curve') {
			// Cubic: on -> curve -> curve -> on
			var ci1 = next_i;
			var ci2 = (i + 2) % n;
			var oi  = (i + 3) % n;
			var b1 = nextNode;
			var b2 = nodes[ci2];
			var on = nodes[oi];
			segments.push({
				type: 'cubic',
				pts: [
					{x: curr.x, y: curr.y},
					{x: b1.x,   y: b1.y},
					{x: b2.x,   y: b2.y},
					{x: on.x,   y: on.y}
				],
				nodeIndices: [i, ci1, ci2, oi],
			});
			i = oi;
			count += 3;

		} else if (nextNode.type === 'off') {
			// Quadratic: on -> off -> on
			var qi  = next_i;
			var oi2 = (i + 2) % n;
			var off = nextNode;
			var on2 = nodes[oi2];
			segments.push({
				type: 'quadratic',
				pts: [
					{x: curr.x, y: curr.y},
					{x: off.x,  y: off.y},
					{x: on2.x,  y: on2.y}
				],
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
// Returns { kappa[], dKappa[], arcT[], positions[], inflections[],
//           totalLength, sweepDirection }
//
// The sweep direction setting controls the playback order:
//   'path'       — native contour walk order (arc-length)
//   'bottom-top' — re-sort samples by Y ascending
//   'top-bottom' — re-sort samples by Y descending
//   'left-right' — re-sort samples by X ascending
//   'right-left' — re-sort samples by X descending
//
// For spatial sweeps the curvature is re-parameterized so that
// two opposing contour sides (e.g. left and right edges of a stem)
// are both played in the same spatial direction, enabling direct
// auditory comparison of their profiles.
function _analyzeCurvature(segments, sampleCount) {
	if (segments.length === 0) {
		return { kappa: [], dKappa: [], arcT: [], positions: [],
				 inflections: [], totalLength: 0, sweepDirection: _settings.sweepDirection };
	}

	// Compute total arc length
	var segLengths = [];
	var totalLength = 0;
	for (var s = 0; s < segments.length; s++) {
		var len = _segmentLength(segments[s]);
		segLengths.push(len);
		totalLength += len;
	}

	if (totalLength === 0) {
		return { kappa: [], dKappa: [], arcT: [], positions: [],
				 inflections: [], totalLength: 0, sweepDirection: _settings.sweepDirection };
	}

	// ------------------------------------------------------------------
	// Phase 1: Sample curvature AND position at uniform arc-length
	// ------------------------------------------------------------------
	var samples = [];  // { k, x, y, arcNorm }

	for (var i = 0; i < sampleCount; i++) {
		var targetDist = (i / (sampleCount - 1)) * totalLength;

		// Find which segment this falls in
		var cumDist = 0;
		var segIdx = 0;
		var localDist = targetDist;

		for (var s = 0; s < segments.length; s++) {
			if (cumDist + segLengths[s] >= targetDist || s === segments.length - 1) {
				segIdx = s;
				localDist = targetDist - cumDist;
				break;
			}
			cumDist += segLengths[s];
		}

		// Convert arc distance to t parameter (linear approximation)
		var localT = segLengths[segIdx] > 0 ? localDist / segLengths[segIdx] : 0;
		localT = Math.max(0, Math.min(1, localT));

		// Get curvature
		var k = _curvatureAt(segments[segIdx], localT);
		if (!isFinite(k)) k = 0;

		// Get position
		var pos = _pointOnSegment(segments[segIdx], localT);

		samples.push({
			k:       k,
			x:       pos.x,
			y:       pos.y,
			arcNorm: i / (sampleCount - 1),
		});
	}

	// ------------------------------------------------------------------
	// Phase 2: Re-sort by sweep direction (if not 'path')
	// ------------------------------------------------------------------
	var dir = _settings.sweepDirection;

	if (dir && dir !== 'path') {
		samples.sort(function(a, b) {
			switch (dir) {
				case 'bottom-top':
					return a.y !== b.y ? a.y - b.y : a.x - b.x;
				case 'top-bottom':
					return a.y !== b.y ? b.y - a.y : a.x - b.x;
				case 'left-right':
					return a.x !== b.x ? a.x - b.x : a.y - b.y;
				case 'right-left':
					return a.x !== b.x ? b.x - a.x : a.y - b.y;
				default:
					return 0;
			}
		});
	}

	// ------------------------------------------------------------------
	// Phase 3: Extract ordered arrays from (possibly re-sorted) samples
	// ------------------------------------------------------------------
	var kappa     = [];
	var arcT      = [];
	var positions = [];

	for (var i = 0; i < samples.length; i++) {
		kappa.push(samples[i].k);
		arcT.push(i / (sampleCount - 1));  // re-normalized after sort
		positions.push({ x: samples[i].x, y: samples[i].y });
	}

	// Compute curvature derivative (rate of change) on the re-ordered data
	var dKappa = [];
	for (var i = 0; i < kappa.length; i++) {
		if (i === 0) {
			dKappa.push(kappa[1] - kappa[0]);
		} else if (i === kappa.length - 1) {
			dKappa.push(kappa[i] - kappa[i - 1]);
		} else {
			dKappa.push((kappa[i + 1] - kappa[i - 1]) / 2);
		}
	}

	// Detect inflection points (sign changes in curvature)
	var inflections = [];
	for (var i = 1; i < kappa.length; i++) {
		if ((kappa[i - 1] > 0 && kappa[i] < 0) ||
			(kappa[i - 1] < 0 && kappa[i] > 0)) {
			inflections.push(i / sampleCount);
		}
	}

	return {
		kappa:          kappa,
		dKappa:         dKappa,
		arcT:           arcT,
		positions:      positions,
		inflections:    inflections,
		totalLength:    totalLength,
		sweepDirection: dir,
	};
}

// ===================================================================
// Curvature-to-frequency mapping
// ===================================================================
function _kappaToFreq(k, kappaRange) {
	var absK = Math.abs(k);
	var norm;  // normalized 0..1

	var maxK = kappaRange.max || 1;

	switch (_settings.curvatureScale) {
		case 'log':
			norm = Math.log(1 + absK) / Math.log(1 + maxK);
			break;
		case 'sqrt':
			norm = Math.sqrt(absK / maxK);
			break;
		default: // linear
			norm = absK / maxK;
	}

	norm = Math.max(0, Math.min(1, norm));

	// Map to frequency range
	return _settings.minFreq + norm * (_settings.maxFreq - _settings.minFreq);
}

// ===================================================================
// Voice: generate and play audio for one contour
// ===================================================================
function _createVoice(analysis, panValue, voiceIndex) {
	var ctx = _ctx;
	var dur = _settings.duration;
	var sr = ctx.sampleRate;
	var totalSamples = Math.floor(sr * dur);

	// Compute curvature range for normalization
	var kappaRange = { min: 0, max: 0.001 };
	for (var i = 0; i < analysis.kappa.length; i++) {
		var absK = Math.abs(analysis.kappa[i]);
		if (absK > kappaRange.max) kappaRange.max = absK;
	}
	// Also compute dKappa range
	var dKappaMax = 0.001;
	for (var i = 0; i < analysis.dKappa.length; i++) {
		var absD = Math.abs(analysis.dKappa[i]);
		if (absD > dKappaMax) dKappaMax = absD;
	}

	// Create audio buffer
	var buffer = ctx.createBuffer(1, totalSamples, sr);
	var data = buffer.getChannelData(0);

	var phase = 0;
	var sampleCount = analysis.kappa.length;

	for (var s = 0; s < totalSamples; s++) {
		var t = s / totalSamples;

		// Interpolate curvature at this time position
		var floatIdx = t * (sampleCount - 1);
		var idx0 = Math.floor(floatIdx);
		var idx1 = Math.min(idx0 + 1, sampleCount - 1);
		var frac = floatIdx - idx0;

		var k = analysis.kappa[idx0] * (1 - frac) + analysis.kappa[idx1] * frac;
		var dk = analysis.dKappa[idx0] * (1 - frac) + analysis.dKappa[idx1] * frac;

		// Frequency from curvature
		var freq = _kappaToFreq(k, kappaRange);

		// Phase accumulation for the oscillator
		phase += (2 * Math.PI * freq) / sr;
		if (phase > 2 * Math.PI) phase -= 2 * Math.PI;

		// Base waveform
		var sample = 0;
		switch (_settings.waveform) {
			case 'triangle':
				sample = 2 * Math.abs(2 * (phase / (2 * Math.PI)) - 1) - 1;
				break;
			case 'sawtooth':
				sample = 2 * (phase / (2 * Math.PI)) - 1;
				break;
			case 'cello':
				// Approximate cello timbre: fundamental + harmonics
				sample = 0.5 * Math.sin(phase) +
						 0.25 * Math.sin(2 * phase) +
						 0.12 * Math.sin(3 * phase) +
						 0.06 * Math.sin(4 * phase) +
						 0.03 * Math.sin(5 * phase);
				break;
			default: // sine
				sample = Math.sin(phase);
		}

		// Apply roughness from curvature derivative
		var roughAmount = _settings.roughness * Math.abs(dk) / dKappaMax;
		roughAmount = Math.min(roughAmount, 0.8);
		if (roughAmount > 0.01) {
			// Add harmonics proportional to dK/dt — tanh waveshaping
			sample = sample * (1 - roughAmount) +
					 roughAmount * Math.tanh(sample * (1 + roughAmount * 4));
		}

		// Amplitude envelope (fade in/out)
		var env = 1.0;
		var fadeLen = 0.02; // 20ms fade
		if (t < fadeLen) env = t / fadeLen;
		if (t > 1 - fadeLen) env = (1 - t) / fadeLen;

		data[s] = sample * env * 0.5;
	}

	// Add inflection clicks
	if (_settings.clickEnabled && analysis.inflections.length > 0) {
		var clickLen = Math.floor(sr * 0.003); // 3ms click
		for (var ci = 0; ci < analysis.inflections.length; ci++) {
			var clickPos = Math.floor(analysis.inflections[ci] * totalSamples);
			for (var cs = 0; cs < clickLen && (clickPos + cs) < totalSamples; cs++) {
				var clickEnv = 1 - cs / clickLen;
				data[clickPos + cs] += _settings.clickVolume * clickEnv *
					(Math.random() * 2 - 1) * 0.3;
			}
		}
	}

	// Create source and panner
	var source = ctx.createBufferSource();
	source.buffer = buffer;

	var panner = ctx.createStereoPanner();
	panner.pan.value = panValue;

	var gain = ctx.createGain();
	gain.gain.value = _settings.volume;

	source.connect(gain);
	gain.connect(panner);
	panner.connect(_master);

	return {
		source:   source,
		gain:     gain,
		panner:   panner,
		analysis: analysis,
		index:    voiceIndex,
	};
}

// ===================================================================
// Public API: Play contours
// ===================================================================

// Stop all active playback
FontRig.CurveSonifier.stop = function() {
	for (var i = 0; i < _voices.length; i++) {
		try { _voices[i].source.stop(); } catch (e) {}
	}
	_voices = [];
	_playing = false;

	// Notify listeners
	if (FontRig.CurveSonifier.onPlayStateChange) {
		FontRig.CurveSonifier.onPlayStateChange(false);
	}
};

// Play a single contour
FontRig.CurveSonifier.playContour = function(contour) {
	FontRig.CurveSonifier.stop();

	var ctx = _ensureContext();
	if (!ctx) return null;

	if (ctx.state === 'suspended') ctx.resume();

	var segments = _extractSegments(contour);
	if (segments.length === 0) return null;

	var analysis = _analyzeCurvature(segments, _settings.sampleCount);
	var voice = _createVoice(analysis, 0, 0); // center pan

	voice.source.start(ctx.currentTime);
	voice.source.onended = function() {
		_playing = false;
		_voices = [];
		if (FontRig.CurveSonifier.onPlayStateChange) {
			FontRig.CurveSonifier.onPlayStateChange(false);
		}
	};

	_voices = [voice];
	_playing = true;

	if (FontRig.CurveSonifier.onPlayStateChange) {
		FontRig.CurveSonifier.onPlayStateChange(true);
	}

	return analysis;
};

// Play multiple contours as separate voices (stereo spread)
FontRig.CurveSonifier.playContours = function(contours) {
	FontRig.CurveSonifier.stop();

	var ctx = _ensureContext();
	if (!ctx) return null;

	if (ctx.state === 'suspended') ctx.resume();

	var analyses = [];
	var newVoices = [];
	var nContours = contours.length;

	for (var c = 0; c < nContours; c++) {
		var segments = _extractSegments(contours[c]);
		if (segments.length === 0) continue;

		var analysis = _analyzeCurvature(segments, _settings.sampleCount);
		analyses.push(analysis);

		// Stereo spread: distribute voices across stereo field
		var pan = 0;
		if (nContours > 1) {
			pan = -_settings.stereoSpread +
				  (2 * _settings.stereoSpread * c / (nContours - 1));
		}

		var voice = _createVoice(analysis, pan, c);
		newVoices.push(voice);
	}

	if (newVoices.length === 0) return null;

	// Start all voices simultaneously
	var startTime = ctx.currentTime + 0.01;
	var endCount = 0;

	for (var v = 0; v < newVoices.length; v++) {
		newVoices[v].source.start(startTime);
		newVoices[v].source.onended = function() {
			endCount++;
			if (endCount >= newVoices.length) {
				_playing = false;
				_voices = [];
				if (FontRig.CurveSonifier.onPlayStateChange) {
					FontRig.CurveSonifier.onPlayStateChange(false);
				}
			}
		};
	}

	_voices = newVoices;
	_playing = true;

	if (FontRig.CurveSonifier.onPlayStateChange) {
		FontRig.CurveSonifier.onPlayStateChange(true);
	}

	return analyses;
};

// Play the active glyph's contours from the active layer
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

	return FontRig.CurveSonifier.playContours(contours);
};

// Play only the segments touching selected nodes.
// Each run of consecutive selected segments becomes a separate voice.
// A segment is "selected" if any of its on-curve anchor nodes is
// in the current selection set.
FontRig.CurveSonifier.playSelectedSegments = function() {
	var layer = FontRig.getActiveLayer();
	if (!layer) return null;

	var selectedIds = FontRig.state.selectedNodeIds;
	if (!selectedIds || selectedIds.size === 0) {
		// Fall back to all contours
		return FontRig.CurveSonifier.playActiveGlyph();
	}

	// Build a set of selected node indices per contour index.
	// selectedIds are in "c{ci}_n{ni}" format.
	var allNodes = FontRig.getAllNodes(layer);
	// Map: contourIdx -> Set of node indices within that contour
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

	// Walk each contour, extract segments, filter by selection,
	// group consecutive selected segments into runs (voices).
	var segmentGroups = [];  // each entry is an array of segments

	var ci = 0;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			var contour = shape.contours[ki];
			var selNodes = selByContour[ci];
			ci++;

			if (!selNodes || contour.nodes.length < 2) continue;

			var segments = _extractSegments(contour);
			if (segments.length === 0) continue;

			// Mark each segment as selected if any of its on-curve
			// nodes (first and last in nodeIndices) is selected
			var currentRun = [];
			for (var s = 0; s < segments.length; s++) {
				var seg = segments[s];
				var indices = seg.nodeIndices;
				// On-curve anchors are first and last in nodeIndices
				var startNode = indices[0];
				var endNode   = indices[indices.length - 1];
				var isSelected = selNodes.has(startNode) || selNodes.has(endNode);

				if (isSelected) {
					currentRun.push(seg);
				} else {
					// Flush current run
					if (currentRun.length > 0) {
						segmentGroups.push(currentRun);
						currentRun = [];
					}
				}
			}
			// Flush trailing run
			if (currentRun.length > 0) {
				segmentGroups.push(currentRun);
			}
		}
	}

	if (segmentGroups.length === 0) return null;

	return FontRig.CurveSonifier.playSegmentGroups(segmentGroups);
};

// Play pre-extracted segment groups as separate voices.
// Each group is an array of segment objects (already extracted).
FontRig.CurveSonifier.playSegmentGroups = function(segmentGroups) {
	FontRig.CurveSonifier.stop();

	var ctx = _ensureContext();
	if (!ctx) return null;

	if (ctx.state === 'suspended') ctx.resume();

	var analyses = [];
	var newVoices = [];
	var nGroups = segmentGroups.length;

	for (var g = 0; g < nGroups; g++) {
		var segments = segmentGroups[g];
		if (segments.length === 0) continue;

		var analysis = _analyzeCurvature(segments, _settings.sampleCount);
		analyses.push(analysis);

		// Stereo spread
		var pan = 0;
		if (nGroups > 1) {
			pan = -_settings.stereoSpread +
				  (2 * _settings.stereoSpread * g / (nGroups - 1));
		}

		var voice = _createVoice(analysis, pan, g);
		newVoices.push(voice);
	}

	if (newVoices.length === 0) return null;

	// Start all voices simultaneously
	var startTime = ctx.currentTime + 0.01;
	var endCount = 0;

	for (var v = 0; v < newVoices.length; v++) {
		newVoices[v].source.start(startTime);
		newVoices[v].source.onended = function() {
			endCount++;
			if (endCount >= newVoices.length) {
				_playing = false;
				_voices = [];
				if (FontRig.CurveSonifier.onPlayStateChange) {
					FontRig.CurveSonifier.onPlayStateChange(false);
				}
			}
		};
	}

	_voices = newVoices;
	_playing = true;

	if (FontRig.CurveSonifier.onPlayStateChange) {
		FontRig.CurveSonifier.onPlayStateChange(true);
	}

	return analyses;
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
// Callbacks (set by panel or other consumers)
// ===================================================================
FontRig.CurveSonifier.onPlayStateChange = null;

})();
