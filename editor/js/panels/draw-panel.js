// ===================================================================
// FontRig — Drawing Panel
// ===================================================================
// Sidebar panel for drawing tools and primitive insertions.
//
// Two button groups:
//   1. Tools (modal): Line, Polyline, Bezier, Hobby, RectDrag, EllipseDrag.
//      Clicking activates a tool by setting FontRig.state.activeDrawTool.
//      Re-clicking the active tool deactivates (back to 'select').
//      Tool interactions are handled in stream-handlers.js / per-tool
//      modules (draw-bezier.js, draw-hobby.js).
//   2. Primitives (one-shot): circle, square, triangle, pentagon,
//      diamond, star, squircle. Inserts immediately at the resolved
//      center, sized by the panel's "Size" spinner.
//
// Plus per-tool / per-primitive options.
// ===================================================================
'use strict';

FontRig.DrawPanel = {};

FontRig.DrawPanel.mount = function(containerEl, ctx) {
	if (!containerEl) return null;

	var inst = { _containerEl: containerEl, _toolButtons: {} };
	containerEl.innerHTML = '';

	var content = document.createElement('div');
	content.className = 'draw-panel';

	// ===============================================================
	// 1. TOOLS (modal toggles)
	// ===============================================================
	var grpTools = FRWidget.GroupBox('Tools');

	function makeToolToggle(toolId, icon, label) {
		var btn = FRWidget.ToggleButton(null, {
			icon: icon,
			tooltip: label,
			active: FontRig.state.activeDrawTool === toolId,
			group: 'draw-panel-tool',
			onChange: function(active) {
				if (active) {
					FontRig.drawTool.setActiveTool(toolId);
				} else if (FontRig.state.activeDrawTool === toolId) {
					FontRig.drawTool.setActiveTool('select');
				}
			},
		});
		inst._toolButtons[toolId] = btn;
		return btn;
	}

	// Per icon mapping confirmed by user:
	// draw_lines  -> Line
	// draw_nodes  -> Polyline
	// draw_line   -> Bezier
	// draw_hobby  -> Hobby
	// draw_circle -> Ellipse drag
	// draw_square -> Rect drag
	grpTools.addWidget(makeToolToggle('select',      'arrow_up',    'Selection — exit drawing mode'));
	grpTools.addWidget(makeToolToggle('line',        'draw_lines',  'Line tool — two-click straight segment'));
	grpTools.addWidget(makeToolToggle('polyline',    'draw_nodes',  'Polyline tool — multi-click connected lines'));
	grpTools.addWidget(makeToolToggle('bezier',      'draw_line',   'Bezier tool — Corel-style: drag to pull handles'));
	grpTools.addWidget(makeToolToggle('hobby',       'draw_hobby',  'Hobby tool — knot picker with smooth solve'));
	grpTools.addWidget(makeToolToggle('rectDrag',    'draw_square', 'Rectangle tool — drag to draw (Shift = square)'));
	grpTools.addWidget(makeToolToggle('ellipseDrag', 'draw_circle', 'Ellipse tool — drag to draw (Shift = circle)'));

	content.appendChild(grpTools);

	// ===============================================================
	// 2. PRIMITIVES (one-shot)
	// ===============================================================
	var grpPrim = FRWidget.GroupBox('Primitives');

	grpPrim.addWidget(FRWidget.Button(null, {
		icon: 'circle',
		tooltip: 'Insert a circle at center',
		onClick: function() { FontRig.drawPrimitives.insertCircle(); },
	}));
	grpPrim.addWidget(FRWidget.Button(null, {
		icon: 'quad',
		tooltip: 'Insert a square at center',
		onClick: function() { FontRig.drawPrimitives.insertSquare(); },
	}));
	grpPrim.addWidget(FRWidget.Button(null, {
		icon: 'triangle',
		tooltip: 'Insert a triangle (n-gon, n=3) at center',
		onClick: function() { FontRig.drawPrimitives.insertTriangle(); },
	}));
	grpPrim.addWidget(FRWidget.Button(null, {
		icon: 'gem',
		tooltip: 'Insert a pentagon (n-gon, n=5) at center',
		onClick: function() { FontRig.drawPrimitives.insertPentagon(); },
	}));
	grpPrim.addWidget(FRWidget.Button(null, {
		icon: 'diamond',
		tooltip: 'Insert a diamond (n-gon, n=4 rotated) at center',
		onClick: function() { FontRig.drawPrimitives.insertDiamond(); },
	}));
	grpPrim.addWidget(FRWidget.Button(null, {
		icon: 'star',
		tooltip: 'Insert a star at center (sides + ratio from options)',
		onClick: function() { FontRig.drawPrimitives.insertStar(); },
	}));
	grpPrim.addWidget(FRWidget.Button(null, {
		icon: 'hyper',
		tooltip: 'Insert a squircle (Lamé curve) at center',
		onClick: function() { FontRig.drawPrimitives.insertSquircle(); },
	}));

	content.appendChild(grpPrim);

	// ===============================================================
	// 3. OPTIONS
	// ===============================================================
	// Each row: [icon] [widget] so the meaning is visible at a glance.
	function optionRow(iconName, widget, tooltip) {
		var row = document.createElement('div');
		row.className = 'frw-row';
		row.style.display = 'flex';
		row.style.alignItems = 'center';
		row.style.gap = '6px';
		row.style.padding = '2px 0';
		var ic = FRWidget.icon(iconName);
		if (ic) {
			ic.style.flex = '0 0 auto';
			ic.style.fontSize = '16px';
			ic.style.opacity = '0.85';
			if (tooltip) ic.title = tooltip;
			row.appendChild(ic);
		}
		widget.style.flex = '1 1 auto';
		row.appendChild(widget);
		return row;
	}

	var grpOpts = FRWidget.GroupBox('Options');

	// Primitive size — icon: quad (representative shape)
	grpOpts.content.appendChild(optionRow(
		'quad',
		FRWidget.SpinBox({
			min: 10, max: 5000, value: FontRig.drawTool.options.primitiveSize, step: 10,
			tooltip: 'Default size (units) for one-shot primitive inserts',
			onChange: function(v) { FontRig.drawTool.options.primitiveSize = v; },
		}),
		'Primitive size (units)'
	));

	grpOpts.addSeparator();

	// Star sides + ratio — both flagged with the star icon
	grpOpts.content.appendChild(optionRow(
		'star',
		FRWidget.SpinBox({
			min: 3, max: 24, value: FontRig.drawTool.options.starSides, step: 1,
			tooltip: 'Star: number of points',
			onChange: function(v) { FontRig.drawTool.options.starSides = v; },
		}),
		'Star: number of points'
	));

	grpOpts.content.appendChild(optionRow(
		'star',
		FRWidget.DoubleSpinBox({
			min: 0.05, max: 0.95, value: FontRig.drawTool.options.starRatio, step: 0.05,
			decimals: 2,
			tooltip: 'Star: inner / outer radius ratio',
			onChange: function(v) { FontRig.drawTool.options.starRatio = v; },
		}),
		'Star: inner / outer radius ratio'
	));

	grpOpts.addSeparator();

	// Squircle exponent — icon: hyper
	grpOpts.content.appendChild(optionRow(
		'hyper',
		FRWidget.DoubleSpinBox({
			min: 2, max: 20, value: FontRig.drawTool.options.squircleExp, step: 0.5,
			decimals: 1,
			tooltip: 'Squircle exponent (2 = ellipse, ~5 = Apple icon)',
			onChange: function(v) { FontRig.drawTool.options.squircleExp = v; },
		}),
		'Squircle exponent'
	));

	grpOpts.addSeparator();

	// Hobby tension — icon: draw_hobby. Also exposed globally so the
	// scroll-wheel handler in draw-handlers can keep the spinner in
	// sync when the user adjusts tension live with Alt+scroll.
	var tensionSpin = FRWidget.DoubleSpinBox({
		min: 0.1, max: 5, value: FontRig.drawTool.options.hobbyTension, step: 0.1,
		decimals: 2,
		tooltip: 'Hobby tool tension (1.0 = default METAFONT). Press [ / ] while drawing to adjust live (use { / } for coarse).',
		onChange: function(v) { FontRig.drawTool.options.hobbyTension = v; },
	});
	FontRig.drawTool._tensionSpinner = tensionSpin;
	grpOpts.content.appendChild(optionRow('draw_hobby', tensionSpin, 'Hobby tool tension'));

	content.appendChild(grpOpts);

	containerEl.appendChild(content);

	// -- Lifecycle ---------------------------------------------------
	inst.update = function() {
		// Sync tool buttons with current active tool (e.g. after Esc).
		var active = FontRig.state.activeDrawTool;
		Object.keys(inst._toolButtons).forEach(function(id) {
			var btn = inst._toolButtons[id];
			if (btn && typeof btn.setValue === 'function') {
				btn.setValue(active === id);
			}
		});
	};

	inst.unmount = function() { /* nothing to clean up */ };

	return inst;
};
