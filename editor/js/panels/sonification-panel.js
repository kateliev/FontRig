// ===================================================================
// FontRig — Sonification Panel (Multi-Instance Sidebar Widget)
// ===================================================================
// UI panel for the Curve Sonification engine.
// Allows users to "hear" bezier curve quality by mapping curvature
// data to audio parameters.
//
// Features:
//   - Play/stop controls for active glyph or selected contours
//   - Waveform selection (sine, triangle, sawtooth, cello)
//   - Curvature-to-pitch mapping controls
//   - Roughness (dK/dt distortion) slider
//   - Duration and sample count
//   - Stereo spread for multi-voice mode
//   - Real-time curvature visualization (mini canvas)
//   - Inflection point click toggle
// ===================================================================
'use strict';

(function() {

if (typeof FontRig === 'undefined') return;

FontRig.SonificationPanel = {};

// ===================================================================
// Mount: create a Sonification panel instance
// ===================================================================
FontRig.SonificationPanel.mount = function(containerEl, ctx) {
	if (!containerEl) return null;

	var inst = {
		_containerEl: containerEl,
		_canvas:      null,
		_canvasCtx:   null,
		_lastAnalysis: null,
	};

	containerEl.innerHTML = '';

	var content = document.createElement('div');
	content.className = 'sonification-panel';
	content.style.padding = '6px';

	var sonifier = FontRig.CurveSonifier;
	var settings = sonifier.getSettings();

	// =================================================================
	// 1. TRANSPORT CONTROLS
	// =================================================================
	var grpTransport = FRWidget.GroupBox('Transport');

	// Play All button
	var btnPlayAll = FRWidget.Button('Play All', {
		tooltip: 'Sonify all contours in active layer',
		onClick: function() {
			if (sonifier.isPlaying()) {
				sonifier.stop();
			} else {
				var analyses = sonifier.playActiveGlyph();
				if (analyses) _drawCurvature(inst, analyses);
			}
		}
	});
	btnPlayAll.style.marginRight = '4px';
	grpTransport.addWidget(btnPlayAll);

	// Play Selected button
	var btnPlaySel = FRWidget.Button('Play Selected', {
		tooltip: 'Sonify only the segments touching selected nodes',
		onClick: function() {
			if (sonifier.isPlaying()) {
				sonifier.stop();
			} else {
				var analyses = sonifier.playSelectedSegments();
				if (analyses) _drawCurvature(inst, analyses);
			}
		}
	});
	grpTransport.addWidget(btnPlaySel);

	// Stop button
	var btnStop = FRWidget.Button('Stop', {
		tooltip: 'Stop playback',
		onClick: function() { sonifier.stop(); }
	});
	btnStop.style.marginLeft = '4px';
	grpTransport.addWidget(btnStop);

	// Play state indicator
	var lblState = FRWidget.Label('Ready', { mono: true, dim: true });
	lblState.style.marginLeft = '8px';
	grpTransport.addWidget(lblState);

	// Listen for play state changes
	sonifier.onPlayStateChange = function(playing) {
		lblState.textContent = playing ? 'Playing...' : 'Ready';
		lblState.style.color = playing ? '#6fcf6f' : '';
	};

	content.appendChild(grpTransport);

	// =================================================================
	// 1b. SWEEP DIRECTION
	// =================================================================
	var grpSweep = FRWidget.GroupBox('Sweep Direction');

	var cmbSweep = FRWidget.ComboBox({
		items: [
			{ value: 'bottom-top',  label: 'Bottom \u2192 Top  (stems)' },
			{ value: 'left-right',  label: 'Left \u2192 Right  (crossbars)' },
			{ value: 'top-bottom',  label: 'Top \u2192 Bottom' },
			{ value: 'right-left',  label: 'Right \u2192 Left' },
			{ value: 'path',        label: 'Along path  (native)' },
		],
		value: settings.sweepDirection,
		onChange: function(v) { sonifier.setSetting('sweepDirection', v); }
	});
	var sweepRow = document.createElement('div');
	sweepRow.style.display = 'flex';
	sweepRow.style.alignItems = 'center';
	sweepRow.style.gap = '6px';
	sweepRow.appendChild(FRWidget.Label('Direction', { dim: true }));
	sweepRow.appendChild(cmbSweep);
	grpSweep.addWidget(sweepRow);

	var lblSweepHint = FRWidget.Label(
		'Reverses playback of contours that flow against the\n' +
		'chosen direction so opposing sides play in sync.\n' +
		'Reversed voices show \u21C4 in the analysis info.',
		{ dim: true }
	);
	lblSweepHint.style.display = 'block';
	lblSweepHint.style.fontSize = '10px';
	lblSweepHint.style.lineHeight = '1.3';
	lblSweepHint.style.marginTop = '4px';
	lblSweepHint.style.whiteSpace = 'pre-wrap';
	grpSweep.addWidget(lblSweepHint);

	content.appendChild(grpSweep);

	// =================================================================
	// 2. CURVATURE DISPLAY (mini canvas)
	// =================================================================
	var grpViz = FRWidget.GroupBox('Curvature Profile');

	var canvas = document.createElement('canvas');
	canvas.width = 280;
	canvas.height = 80;
	canvas.style.width = '100%';
	canvas.style.height = '80px';
	canvas.style.display = 'block';
	canvas.style.borderRadius = '3px';
	canvas.style.background = '#1a1a2e';
	canvas.style.marginBottom = '4px';

	inst._canvas = canvas;
	inst._canvasCtx = canvas.getContext('2d');

	// Draw empty state
	_drawEmpty(inst);

	grpViz.addWidget(canvas);
	content.appendChild(grpViz);

	// =================================================================
	// 3. PITCH MAPPING
	// =================================================================
	var grpPitch = FRWidget.GroupBox('Pitch Mapping');

	// Min frequency
	var sldMinFreq = FRWidget.SliderCtrl({
		label: 'Min Hz',
		min: 20,
		max: 500,
		value: settings.minFreq,
		step: 10,
		onChange: function(v) { sonifier.setSetting('minFreq', v); }
	});
	grpPitch.addWidget(sldMinFreq);

	// Max frequency
	var sldMaxFreq = FRWidget.SliderCtrl({
		label: 'Max Hz',
		min: 200,
		max: 5000,
		value: settings.maxFreq,
		step: 50,
		onChange: function(v) { sonifier.setSetting('maxFreq', v); }
	});
	grpPitch.addWidget(sldMaxFreq);

	// Curvature scale
	var cmbScale = FRWidget.ComboBox({
		items: [
			{ value: 'log',    label: 'Logarithmic' },
			{ value: 'linear', label: 'Linear' },
			{ value: 'sqrt',   label: 'Square Root' },
		],
		value: settings.curvatureScale,
		onChange: function(v) { sonifier.setSetting('curvatureScale', v); }
	});
	var scaleRow = document.createElement('div');
	scaleRow.style.display = 'flex';
	scaleRow.style.alignItems = 'center';
	scaleRow.style.gap = '6px';
	scaleRow.style.marginTop = '4px';
	scaleRow.appendChild(FRWidget.Label('Scale', { dim: true }));
	scaleRow.appendChild(cmbScale);
	grpPitch.addWidget(scaleRow);

	content.appendChild(grpPitch);

	// =================================================================
	// 4. TIMBRE & ROUGHNESS
	// =================================================================
	var grpTimbre = FRWidget.GroupBox('Timbre');

	// Waveform selector
	var cmbWave = FRWidget.ComboBox({
		items: [
			{ value: 'sine',     label: 'Sine (pure)' },
			{ value: 'triangle', label: 'Triangle' },
			{ value: 'sawtooth', label: 'Sawtooth' },
			{ value: 'cello',    label: 'Cello (harmonic)' },
		],
		value: settings.waveform,
		onChange: function(v) { sonifier.setSetting('waveform', v); }
	});
	var waveRow = document.createElement('div');
	waveRow.style.display = 'flex';
	waveRow.style.alignItems = 'center';
	waveRow.style.gap = '6px';
	waveRow.appendChild(FRWidget.Label('Waveform', { dim: true }));
	waveRow.appendChild(cmbWave);
	grpTimbre.addWidget(waveRow);

	// Roughness (dK/dt -> distortion)
	var sldRough = FRWidget.SliderCtrl({
		label: 'Roughness',
		min: 0,
		max: 100,
		value: Math.round(settings.roughness * 100),
		step: 1,
		onChange: function(v) { sonifier.setSetting('roughness', v / 100); }
	});
	grpTimbre.addWidget(sldRough);

	content.appendChild(grpTimbre);

	// =================================================================
	// 5. PLAYBACK
	// =================================================================
	var grpPlay = FRWidget.GroupBox('Playback');

	// Duration
	var sldDur = FRWidget.SliderCtrl({
		label: 'Duration (s)',
		min: 5,
		max: 100,
		value: Math.round(settings.duration * 10),
		step: 1,
		decimals: 1,
		onChange: function(v) { sonifier.setSetting('duration', v / 10); }
	});
	grpPlay.addWidget(sldDur);

	// Volume
	var sldVol = FRWidget.SliderCtrl({
		label: 'Volume',
		min: 0,
		max: 100,
		value: Math.round(settings.volume * 100),
		step: 1,
		onChange: function(v) { sonifier.setSetting('volume', v / 100); }
	});
	grpPlay.addWidget(sldVol);

	// Sample count
	var sldSamples = FRWidget.SliderCtrl({
		label: 'Resolution',
		min: 64,
		max: 1024,
		value: settings.sampleCount,
		step: 64,
		onChange: function(v) { sonifier.setSetting('sampleCount', v); }
	});
	grpPlay.addWidget(sldSamples);

	content.appendChild(grpPlay);

	// =================================================================
	// 6. MULTI-VOICE / STEREO
	// =================================================================
	var grpStereo = FRWidget.GroupBox('Multi-Voice');

	// Stereo spread
	var sldSpread = FRWidget.SliderCtrl({
		label: 'Stereo Spread',
		min: 0,
		max: 100,
		value: Math.round(settings.stereoSpread * 100),
		step: 5,
		onChange: function(v) { sonifier.setSetting('stereoSpread', v / 100); }
	});
	grpStereo.addWidget(sldSpread);

	// Inflection clicks toggle
	var clickRow = document.createElement('div');
	clickRow.style.display = 'flex';
	clickRow.style.alignItems = 'center';
	clickRow.style.gap = '6px';
	clickRow.style.marginTop = '4px';

	var chkClicks = document.createElement('input');
	chkClicks.type = 'checkbox';
	chkClicks.checked = settings.clickEnabled;
	chkClicks.style.accentColor = '#6fcf6f';
	chkClicks.addEventListener('change', function() {
		sonifier.setSetting('clickEnabled', chkClicks.checked);
	});
	clickRow.appendChild(chkClicks);
	clickRow.appendChild(FRWidget.Label('Inflection clicks', { dim: true }));
	grpStereo.addWidget(clickRow);

	// Click volume
	var sldClickVol = FRWidget.SliderCtrl({
		label: 'Click Volume',
		min: 0,
		max: 100,
		value: Math.round(settings.clickVolume * 100),
		step: 5,
		onChange: function(v) { sonifier.setSetting('clickVolume', v / 100); }
	});
	grpStereo.addWidget(sldClickVol);

	content.appendChild(grpStereo);

	// =================================================================
	// 7. INFO DISPLAY
	// =================================================================
	var grpInfo = FRWidget.GroupBox('Analysis Info');
	var lblInfo = FRWidget.Label('Load a glyph and press Play', { mono: true, dim: true });
	lblInfo.style.whiteSpace = 'pre-wrap';
	lblInfo.style.fontSize = '11px';
	lblInfo.style.lineHeight = '1.4';
	lblInfo.style.display = 'block';
	grpInfo.addWidget(lblInfo);
	inst._lblInfo = lblInfo;

	content.appendChild(grpInfo);

	// =================================================================
	// Assemble
	// =================================================================
	containerEl.appendChild(content);

	return inst;
};

// ===================================================================
// Curvature visualization helpers
// ===================================================================

function _drawEmpty(inst) {
	var ctx = inst._canvasCtx;
	var w = inst._canvas.width;
	var h = inst._canvas.height;

	ctx.clearRect(0, 0, w, h);
	ctx.fillStyle = '#1a1a2e';
	ctx.fillRect(0, 0, w, h);

	// Center line
	ctx.strokeStyle = '#333355';
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(0, h / 2);
	ctx.lineTo(w, h / 2);
	ctx.stroke();

	// Label
	ctx.fillStyle = '#555577';
	ctx.font = '11px monospace';
	ctx.textAlign = 'center';
	ctx.fillText('curvature profile', w / 2, h / 2 - 4);
}

function _drawCurvature(inst, analyses) {
	if (!analyses || analyses.length === 0) return;

	var ctx = inst._canvasCtx;
	var w = inst._canvas.width;
	var h = inst._canvas.height;

	ctx.clearRect(0, 0, w, h);
	ctx.fillStyle = '#1a1a2e';
	ctx.fillRect(0, 0, w, h);

	// Colors for different voices
	var colors = [
		'#6fcf6f', // green
		'#cf6f6f', // red
		'#6f9fcf', // blue
		'#cfcf6f', // yellow
		'#cf6fcf', // magenta
		'#6fcfcf', // cyan
	];

	// Find global curvature range across all analyses
	var globalMax = 0.001;
	for (var a = 0; a < analyses.length; a++) {
		for (var i = 0; i < analyses[a].kappa.length; i++) {
			var absK = Math.abs(analyses[a].kappa[i]);
			if (absK > globalMax) globalMax = absK;
		}
	}

	// Center line
	ctx.strokeStyle = '#333355';
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(0, h / 2);
	ctx.lineTo(w, h / 2);
	ctx.stroke();

	// Draw each voice's curvature
	for (var a = 0; a < analyses.length; a++) {
		var kappa = analyses[a].kappa;
		var color = colors[a % colors.length];

		ctx.strokeStyle = color;
		ctx.lineWidth = 1.5;
		ctx.globalAlpha = analyses.length > 1 ? 0.7 : 1.0;
		ctx.beginPath();

		for (var i = 0; i < kappa.length; i++) {
			var x = (i / (kappa.length - 1)) * w;
			var normK = kappa[i] / globalMax;
			var y = h / 2 - normK * (h / 2 - 4);
			y = Math.max(2, Math.min(h - 2, y));

			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.stroke();

		// Draw inflection markers
		ctx.globalAlpha = 0.9;
		for (var inf = 0; inf < analyses[a].inflections.length; inf++) {
			var ix = analyses[a].inflections[inf] * w;
			ctx.strokeStyle = '#ff6644';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(ix, 2);
			ctx.lineTo(ix, h - 2);
			ctx.stroke();
		}
	}

	ctx.globalAlpha = 1.0;

	// Update info label
	if (inst._lblInfo) {
		var lines = [];
		for (var a = 0; a < analyses.length; a++) {
			var an = analyses[a];
			var maxK = 0, minK = Infinity;
			for (var i = 0; i < an.kappa.length; i++) {
				var absK = Math.abs(an.kappa[i]);
				if (absK > maxK) maxK = absK;
				if (absK < minK) minK = absK;
			}
			lines.push(
				'Voice ' + (a + 1) +
				(an.reversed ? ' \u21C4' : '') +    // ⇄ arrow when reversed
				': len=' + Math.round(an.totalLength) +
				'  K=[' + minK.toFixed(4) + ', ' + maxK.toFixed(4) + ']' +
				'  infl=' + an.inflections.length
			);
		}
		inst._lblInfo.textContent = lines.join('\n');
	}

	inst._lastAnalysis = analyses;
}

// ===================================================================
// Register as sidebar widget
// ===================================================================
FontRig.SidebarConfig.registerWidget({
	id:    'sonification',
	label: 'Sonification',
	icon:  'wave',  // TypeRig Icons ligature — fallback handled
	mount: FontRig.SonificationPanel.mount,
	update: null,
	unmount: function(inst) {
		if (FontRig.CurveSonifier.isPlaying()) {
			FontRig.CurveSonifier.stop();
		}
	},
});

})();
