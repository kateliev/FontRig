// ===================================================================
// FontRig — Drawing Theme / Color Palette
// ===================================================================
// All canvas drawing colors in one place.
// CSS colors live in style.css; this file covers canvas rendering only.
// ===================================================================
'use strict';

FontRig.theme = {
	appTitle: 		'FontRig',

	// -- Sidebar tab display mode -----------------------------------
	// 'icon' : show icon only (default, wider tab bar)
	// 'text' : show rotated text labels only (narrower tab bar)
	sidebarTabMode: 'icon',
};

FontRig.themeDark = {
	// -- Canvas background ------------------------------------------
	bgFilled:       '#18181b',
	bgOutline:      '#1a1a1e',
	bgPreview: 		'#ffffff',
	// Same as RGB tuple for gradient fading (dividers)
	bgFadeRgb:      '24,24,27',

	// -- Contour outlines -------------------------------------------
	contour: {
		fill:         'rgba(200,200,210,0.12)',
		stroke:       'rgba(200,200,210,0.6)',
		strokePlain:  '#c8c8d2',           // outline mode (no fill)
		lineWidth:    1,
	},

	// -- Mask layer outlines ----------------------------------------
	mask: {
		stroke:       'rgba(255,160,60,0.3)',
		lineWidth:    1.5,
	},

	// -- Metrics (baseline, advance, sidebearings) ------------------
	metrics: {
		baseline:     'rgba(255,120,80,0.25)',
		sidebearing:  'rgba(255,120,80,0.35)',
		advance:      'rgba(91,157,239,0.45)',
		labelBase:    'rgba(255,120,80,0.5)',
		labelBaseFg:  'rgba(255,120,80,0.6)',
		labelAdvance: 'rgba(91,157,239,0.7)',
		// Styling
		lineWidth:    1,
		baselineDash: [0],    // dash for baseline/advance lines
		metricDash:   [3, 3],    // dash for sidebearing lines
		font:         '9px "IBM Plex Mono", "JetBrains Mono", monospace',
		labelFont:    '10px "IBM Plex Mono", "JetBrains Mono", monospace',
		// Font metrics (ascender, descender, x-height, cap-height)
		fontMetricsColors: {
			ascender:   'rgba(80,200,120,0.25)',
			descender:  'rgba(80,200,120,0.25)',
			xHeight:     'rgba(200,160,80,0.2)',
			capHeight:   'rgba(200,160,80,0.2)',
		},
		fontMetricsDash: [0],
	},

	// -- Nodes & handles --------------------------------------------
	node: {
		onCorner:     '#5b9def',           // on-curve corner
		onSmooth:     '#50c878',           // on-curve smooth
		offCurve:     '#5b9def',           // cubic/quadratic off-curve
		selected:     '#ff6b6b',           // any selected node
		outline:      'rgba(0,0,0,0.5)',   // node stroke
		handleLine:   'rgba(91,157,239,0.35)',
		startPoint:   '#ff6b6b',           // contour start triangle
		radius:       4,                   // node circle radius
		strokeWidth:  1.5,                 // node stroke width
		handleWidth:  1,                   // handle line width
		startSize:    6,                   // start point triangle size
	},

	// -- Anchors ----------------------------------------------------
	anchor: {
		fill:         '#ff6b6b',
		outline:      'rgba(0,0,0,0.5)',
		crosshair:    'rgba(255,107,107,0.4)',
		label:        'rgba(255,107,107,0.8)',
	},

	// -- Selection overlay (rect / lasso) ---------------------------
	selection: {
		fill:         'rgba(91,157,239,0.08)',
		stroke:       'rgba(91,157,239,0.6)',
		strokeWidth:  1,
	},

	// -- Layer label badge -------------------------------------------
	label: {
		textColor:    '#000000',
		font:         '10px "IBM Plex Mono", "JetBrains Mono", monospace',
	},

	// -- Per-layer color palette (cycled by index) ------------------
	layerColors: [
		'#5b9def',  // blue
		'#ef6b5b',  // red
		'#50c878',  // green
		'#c084fc',  // purple
		'#f59e0b',  // amber
		'#06b6d4',  // cyan
		'#f472b6',  // pink
		'#a3e635',  // lime
	],

	// -- Grid / multi-view ------------------------------------------
	grid: {
		dividerHairline:   'rgba(255,255,255,0.06)',
		dividerHairlineJ:  'rgba(255,255,255,0.05)', 	// joined mode
		dividerFadeAlpha:  	0.6,                       	// split mode fade
		dividerFadeAlphaJ: 	0.55,                      	// joined mode fade
		activeBorder:      'rgba(91,157,239,0.35)',
		strokeWidth:       1,                        	// divider line width
		fade: 				24,
		joinedGap: 			80,							// joined mode gap between cells
		stripGap: 			40,  						// glyph strip gap between glyphs
	},

	// -- Cell highlight in glyphs mode ------------------------------
	activeCellHightlight: {
		backgroundGradient: 
							[[0, 'rgba(91,157,239,0)'],
							[0.15, 'rgba(91,157,239,0.04)'],
							[0.85, 'rgba(91,157,239,0.04)'],
							[1, 'rgba(91,157,239,0)']],
		strokeStyle: 		'rgba(91,157,239,0.12)',
		strokeWidth:       1,
	},

	// -- On stem measurment ----------------------------------------
	onStemMeasurment: {
		line:      		'rgba(6,182,212,0.7)',   // cyan measurement line
		linePreview: 	'rgba(6,182,212,0.5)', // lighter for BW preview
		mark:      		'#06b6d4',               // endpoint marks
		label:     		'#06b6d4',               // distance label
		labelFont: 		'11px "IBM Plex Mono", "JetBrains Mono", monospace',
		lineWidth:      	1,
	},

	// -- Glyph thumbnail fill (sidebar / grid) ---------------------
	thumbnail: {
		fill:         'rgba(200,200,210,0.55)',
	},

	// -- Keyaboard movement ----------------------------------------
	keyboard: {
			arrowStep : 		1,
			arrowStep_SHIFT : 	10,
			arrowStep_CTRL : 	100,
	},
};

FontRig.themeLight = {
	// -- Canvas background ------------------------------------------
	bgFilled:       '#fafafa',
	bgOutline:      '#f0f0f0',
	bgPreview: 		'#ffffff',
	bgFadeRgb:      '250,250,250',

	// -- Contour outlines -------------------------------------------
	contour: {
		fill:         'rgba(56,58,66,0.08)',
		stroke:       'rgba(56,58,66,0.5)',
		strokePlain:  '#383a42',           // outline mode (no fill)
		lineWidth:    1,
	},

	// -- Mask layer outlines ----------------------------------------
	mask: {
		stroke:       'rgba(193,132,1,0.5)',
		lineWidth:    1.5,
	},

	// -- Metrics (baseline, advance, sidebearings) ------------------
	metrics: {
		baseline:     'rgba(193,132,1,0.35)',
		sidebearing:  'rgba(193,132,1,0.45)',
		advance:      'rgba(64,120,242,0.5)',
		labelBase:    'rgba(193,132,1,0.7)',
		labelBaseFg:  'rgba(193,132,1,0.8)',
		labelAdvance: 'rgba(64,120,242,0.8)',
		// Styling
		lineWidth:    1,
		baselineDash: [0],    // dash for baseline/advance lines
		metricDash:   [3, 3],    // dash for sidebearing lines
		font:         '9px "IBM Plex Mono", "JetBrains Mono", monospace',
		labelFont:    '10px "IBM Plex Mono", "JetBrains Mono", monospace',
		// Font metrics (ascender, descender, x-height, cap-height)
		fontMetricsColors: {
			ascender:   'rgba(80,161,79,0.35)',
			descender:  'rgba(80,161,79,0.35)',
			xHeight:     'rgba(193,132,1,0.3)',
			capHeight:   'rgba(193,132,1,0.3)',
		},
		fontMetricsDash: [0],
	},

	// -- Nodes & handles --------------------------------------------
	node: {
		onCorner:     '#383a42',           // on-curve corner
		onSmooth:     '#50a14f',           // on-curve smooth
		offCurve:     '#4078f2',           // cubic/quadratic off-curve
		selected:    '#e45649',           // any selected node
		outline:      'rgba(255,255,255,0.9)',   // node stroke (white for contrast)
		handleLine:   'rgba(64,120,242,0.5)',
		startPoint:   '#e45649',           // contour start triangle
		radius:       4,                   // node circle radius
		strokeWidth:  1.5,                 // node stroke width
		handleWidth:  1,                   // handle line width
		startSize:    6,                   // start point triangle size
	},

	// -- Anchors ----------------------------------------------------
	anchor: {
		fill:         '#e45649',
		outline:      'rgba(255,255,255,0.9)',
		crosshair:    'rgba(228,86,73,0.5)',
		label:        'rgba(228,86,73,0.9)',
	},

	// -- Selection overlay (rect / lasso) ---------------------------
	selection: {
		fill:         'rgba(64,120,242,0.1)',
		stroke:       'rgba(64,120,242,0.7)',
		strokeWidth:  1,
	},

	// -- Layer label badge -------------------------------------------
	label: {
		textColor:    '#ffffff',
		font:         '10px "IBM Plex Mono", "JetBrains Mono", monospace',
	},

	// -- Per-layer color palette (cycled by index) ------------------
	layerColors: [
		'#4078f2',  // blue
		'#e45649',  // red
		'#50a14f',  // green
		'#a626a4',  // purple
		'#c18401',  // orange
		'#0184bc',  // cyan
		'#e45649',  // (no pink in one-light, use red)
		'#50a14f',  // (no lime in one-light, use green)
	],

	// -- Grid / multi-view ------------------------------------------
	grid: {
		dividerHairline:   'rgba(0,0,0,0.08)',
		dividerHairlineJ:  'rgba(0,0,0,0.06)', 	// joined mode
		dividerFadeAlpha:  	0.5,                       	// split mode fade
		dividerFadeAlphaJ: 	0.45,                      	// joined mode fade
		activeBorder:      'rgba(64,120,242,0.4)',
		strokeWidth:       1,                        	// divider line width
		fade: 				24,
		joinedGap: 			80,							// joined mode gap between cells
		stripGap: 			40,  						// glyph strip gap between glyphs
	},

	// -- Cell highlight in glyphs mode ------------------------------
	activeCellHightlight: {
		backgroundGradient: 
							[[0, 'rgba(64,120,242,0)'],
							[0.15, 'rgba(64,120,242,0.06)'],
							[0.85, 'rgba(64,120,242,0.06)'],
							[1, 'rgba(64,120,242,0)']],
		strokeStyle: 		'rgba(64,120,242,0.2)',
		strokeWidth:       1,
	},

	// -- On stem measurment ----------------------------------------
	onStemMeasurment: {
		line:      		'rgba(1,132,188,0.8)',   // cyan measurement line
		linePreview: 	'rgba(1,132,188,0.6)', // lighter for BW preview
		mark:      		'#0184bc',               // endpoint marks
		label:     		'#0184bc',               // distance label
		labelFont: 		'11px "IBM Plex Mono", "JetBrains Mono", monospace',
		lineWidth:      	1,
	},

	// -- Glyph thumbnail fill (sidebar / grid) ---------------------
	thumbnail: {
		fill:         'rgba(56,58,66,0.8)',
	},

	// -- Keyaboard movement ----------------------------------------
	keyboard: {
			arrowStep : 		1,
			arrowStep_SHIFT : 	10,
			arrowStep_CTRL : 	100,
	},
};

// -- Get current theme based on body attribute ----------------------
FontRig.getCurrentTheme = function() {
	var body = document.body;
	if (body.getAttribute('data-theme') === 'light') {
		return FontRig.themeLight;
	}
	return FontRig.themeDark;
};

// -- Helpers --------------------------------------------------------
FontRig.getLayerColor = function(layerIdx) {
	const colors = FontRig.getCurrentTheme().layerColors;
	return colors[layerIdx % colors.length];
};

FontRig.getBgColor = function() {
	const theme = FontRig.getCurrentTheme();
	return FontRig.state.filled ? theme.bgFilled : theme.bgOutline;
};

// -- Apply sidebar tab display mode ---------------------------------
// Reads FontRig.theme.sidebarTabMode and sets a data attribute
// on the app container so CSS can switch between icon/text modes.
FontRig.applySidebarTabMode = function() {
	var mode = FontRig.theme.sidebarTabMode || 'icon';
	var app = document.getElementById('app');
	if (app) {
		if (mode === 'text') {
			app.setAttribute('data-sidebar-tabs', 'text');
		} else {
			app.removeAttribute('data-sidebar-tabs');
		}
	}
};

// Apply on load
FontRig.applySidebarTabMode();
