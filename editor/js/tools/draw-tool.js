// ===================================================================
// FontRig — Drawing Tools (shared session + commit)
// ===================================================================
// Owns the "what tool is active and what is being drawn right now"
// state for all interactive drawing tools (line, polyline, bezier,
// hobby, rectangle, ellipse, primitives).
//
// All tool-specific math/interaction lives in sibling files
// (draw-primitives.js, draw-bezier.js, draw-hobby.js). This module
// provides the shared bits:
//   - session state read by the preview viz layer
//   - scope-aware commit helper (mirrors to all in-scope masters)
//   - small Contour/Shape/Node builder helpers (no Python required)
//   - the preview viz layer itself (zIndex 950)
//
// TODO v2: snapping (nodes, grid, extrema) — currently disabled.
// ===================================================================
'use strict';

FontRig.drawTool = {};

// -- Active tool -----------------------------------------------------
// 'select' = no draw tool active (default selection behaviour wins)
// Other values: 'line', 'polyline', 'bezier', 'hobby',
//               'rectDrag', 'ellipseDrag'
// One-shot primitives don't set activeDrawTool — they commit
// immediately on button press.
FontRig.state.activeDrawTool = 'select';

// -- Per-tool options (read by tool implementations) ----------------
FontRig.drawTool.options = {
	hobbyTension: 1.0,
	hobbyClosed: false,
	polygonSides: 5,
	starSides: 5,
	starRatio: 0.5,
	squircleExp: 5.0,
	primitiveSize: 250,   // default insert size for one-shot primitives
};

// -- Session: what is being drawn right now -------------------------
// Tool implementations write into this; the viz layer reads it.
//
// Conventions:
//   tool       : 'line' | 'polyline' | 'bezier' | 'hobby' |
//                'rectDrag' | 'ellipseDrag' | null
//   points     : list of committed glyph-space points
//                  - line/polyline: [{x,y}]
//                  - bezier: [{x,y,handleOut:{x,y}|null,handleIn:{x,y}|null,smooth}]
//                  - hobby:  [{x,y,dir_out:radians|null,segment:'hobby'|'line'}]
//   cursor     : current glyph-space cursor (for live segment to mouse)
//   anchor     : drag anchor (rect/ellipse start corner) in glyph coords
//   active     : true when a session is in progress
FontRig.drawTool.session = {
	tool: null,
	points: [],
	cursor: null,
	anchor: null,
	active: false,
};

FontRig.drawTool.resetSession = function() {
	FontRig.drawTool.session.tool = null;
	FontRig.drawTool.session.points = [];
	FontRig.drawTool.session.cursor = null;
	FontRig.drawTool.session.anchor = null;
	FontRig.drawTool.session.active = false;
};

// ===================================================================
// Builders — plain JS objects matching the FontRig data model
// ===================================================================

FontRig.drawTool.makeNode = function(x, y, type, smooth) {
	return {
		x: +x,
		y: +y,
		type: type || 'on',
		smooth: !!smooth,
	};
};

FontRig.drawTool.makeContour = function(nodes, closed) {
	return {
		name: '',
		identifier: '',
		closed: !!closed,
		clockwise: null,
		nodes: nodes || [],
		lib: {},
	};
};

FontRig.drawTool.makeShape = function(contours) {
	return {
		name: '',
		identifier: '',
		contours: contours || [],
		transform: null,
		lib: {},
	};
};

// Deep-clone a contour (so the same shape can be appended to multiple
// layers without aliasing).
FontRig.drawTool.cloneContour = function(contour) {
	var nodes = [];
	for (var i = 0; i < contour.nodes.length; i++) {
		var n = contour.nodes[i];
		nodes.push(FontRig.drawTool.makeNode(n.x, n.y, n.type, n.smooth));
	}
	return {
		name: contour.name || '',
		identifier: '',
		closed: !!contour.closed,
		clockwise: contour.clockwise == null ? null : contour.clockwise,
		nodes: nodes,
		lib: {},
	};
};

// ===================================================================
// Scope-aware commit
// ===================================================================
// Resolves the layer scope (Active / Masters / Selected) and appends
// the contour to each scoped layer. One undo snapshot, one redraw.
//
// Contract per dev guide §10: each layer gets a Shape wrapping a
// single-element contour list.
//
// Returns the number of layers committed to (0 = nothing happened,
// no undo entry pushed).
// ===================================================================
FontRig.drawTool.commitContour = function(contour) {
	if (!contour || !contour.nodes || contour.nodes.length === 0) return 0;

	var glyph = FontRig.state.glyphData;
	if (!glyph) return 0;

	// Resolve scope. FontRig.scope is the canonical resolver used by
	// the rest of the editor; falls back to active layer if unavailable.
	var layerNames = [];
	if (FontRig.scope && typeof FontRig.scope.getLayers === 'function') {
		layerNames = FontRig.scope.getLayers();
	}
	if (!layerNames || layerNames.length === 0) {
		if (FontRig.state.activeLayer) layerNames = [FontRig.state.activeLayer];
	}
	if (layerNames.length === 0) return 0;

	if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();

	var committed = 0;
	for (var i = 0; i < layerNames.length; i++) {
		var lyr = FontRig.getLayerByName(glyph, layerNames[i]);
		if (!lyr) continue;
		if (!lyr.shapes) lyr.shapes = [];
		var shape = FontRig.drawTool.makeShape([
			FontRig.drawTool.cloneContour(contour),
		]);
		lyr.shapes.push(shape);
		if (typeof FontRig.invalidatePathCache === 'function') {
			FontRig.invalidatePathCache(lyr);
		}
		committed++;
	}

	if (committed > 0) {
		FontRig.drawTool.resetSession();
		FontRig.draw();
	}
	return committed;
};

// Convenience: commit a list of glyph-space points as a contour.
// types is optional (parallel array of 'on'|'off'|'curve'); defaults
// to all 'on'.
FontRig.drawTool.commitPoints = function(points, closed, types) {
	if (!points || points.length === 0) return 0;
	var nodes = [];
	for (var i = 0; i < points.length; i++) {
		var t = types ? (types[i] || 'on') : 'on';
		nodes.push(FontRig.drawTool.makeNode(points[i].x, points[i].y, t, false));
	}
	return FontRig.drawTool.commitContour(
		FontRig.drawTool.makeContour(nodes, !!closed)
	);
};

// ===================================================================
// Tool activation
// ===================================================================
// Switching tools cancels any in-progress session.
FontRig.drawTool.setActiveTool = function(name) {
	if (FontRig.state.activeDrawTool === name) return;
	FontRig.drawTool.cancelSession();
	FontRig.state.activeDrawTool = name || 'select';
	FontRig.drawTool._updateStatusHint();
	FontRig.drawTool._updateCursor();
	FontRig.draw();
};

FontRig.drawTool.cancelSession = function() {
	if (FontRig.drawTool.session.active) {
		FontRig.drawTool.resetSession();
		FontRig.draw();
	}
};

// ===================================================================
// Status hint + cursor
// ===================================================================
// Status bar message describing how the active tool works. Shown
// whenever any draw tool is active.
FontRig.drawTool._statusHints = {
	'select':      null,   // hide the slot
	'line':        'Click two points. Ctrl = constrain to 15° angle. Esc cancels.',
	'polyline':    'Click to add vertices. Ctrl = constrain to 15° angle. Double-click / Enter to commit. Click first vertex to close. Backspace pops last. Esc cancels.',
	'bezier':      'Click for corner; click+drag for smooth handles. Ctrl = constrain placement to 15°, Shift = constrain handle to 15°, Alt = asymmetric handle. Click first node to close. Enter / dblclick commits open.',
	'hobby':       'Click to drop knots. Ctrl = constrain to 15°, Shift+Click = straight incoming segment, [ / ] = adjust tension live ({ / } coarser). Click first knot to close (Shift+Click closes with straight closing segment). Enter / dblclick commits open. Backspace pops last.',
	'rectDrag':    'Drag to draw a rectangle. Shift = square, Alt = anchor is center. Esc cancels.',
	'ellipseDrag': 'Drag to draw an ellipse. Shift = circle, Alt = anchor is center. Esc cancels.',
};

FontRig.drawTool._updateStatusHint = function() {
	var wrap = document.getElementById('status-draw-hint-wrap');
	var text = document.getElementById('status-draw-hint');
	if (!wrap || !text) return;
	var tool = FontRig.state.activeDrawTool;
	var hint = FontRig.drawTool._statusHints[tool];
	if (!hint) {
		wrap.style.display = 'none';
		return;
	}
	wrap.style.display = '';
	text.textContent = hint;
};

// Crosshair cursor on the canvas while any draw tool is active.
// Defers to FontRig.updateCanvasCursor (interaction.js) so spaceDown
// and other states get the right precedence.
FontRig.drawTool._updateCursor = function() {
	if (typeof FontRig.updateCanvasCursor === 'function') {
		FontRig.updateCanvasCursor();
	}
};

// Apply once on load (in case some other code already set state).
if (typeof window !== 'undefined') {
	window.addEventListener('DOMContentLoaded', function() {
		FontRig.drawTool._updateStatusHint();
		FontRig.drawTool._updateCursor();
	});
}

// ===================================================================
// Preview visualization layer
// ===================================================================
// One layer renders all in-progress draw tool feedback. Each tool
// writes into FontRig.drawTool.session and calls FontRig.draw();
// the layer's draw fn dispatches by session.tool.
// ===================================================================

// Enable by default (tools rely on it being on).
FontRig.state.vizLayers.drawPreview = true;

FontRig.registerVizLayer({
	identifier: 'drawPreview',
	name: 'Drawing Preview',
	zIndex: 950,
	enabledKey: 'drawPreview',
	previewMode: 'skip',
	draw: function(ctx, layer, opts) {
		var s = FontRig.drawTool.session;
		if (!s.active || !s.tool) return;

		// Canvas ctx is in screen-space (DPR transform only). Preview
		// renderers receive a `g2s(x, y)` helper that converts glyph
		// coords to screen pixels — must be called for every point.
		var fn = FontRig.drawTool._previewDispatch[s.tool];
		if (!fn) return;

		ctx.save();
		ctx.lineWidth = 1.5;
		ctx.strokeStyle = '#ff7a00';   // orange — distinct from selection blue
		ctx.fillStyle   = '#ff7a00';
		ctx.setLineDash([]);

		fn(ctx, s, FontRig.glyphToScreen);

		ctx.restore();
	},
});

// Per-tool preview renderers register themselves into this dispatch
// table from their own files (draw-primitives.js, draw-bezier.js, etc).
FontRig.drawTool._previewDispatch = {};

FontRig.drawTool.registerPreview = function(toolName, fn) {
	FontRig.drawTool._previewDispatch[toolName] = fn;
};

// Small marker helper shared by preview renderers. Coords are SCREEN
// pixels (already converted by the caller via glyphToScreen).
FontRig.drawTool.drawKnotMarker = function(ctx, sx, sy) {
	var r = 3;
	ctx.save();
	ctx.beginPath();
	ctx.rect(sx - r, sy - r, r * 2, r * 2);
	ctx.fill();
	ctx.restore();
};

// Pentagon marker — used by the Hobby tool. Filled = "hobby" knot,
// hollow outline = "line" knot (incoming segment is straight).
// Apex points up.
FontRig.drawTool._drawPentagon = function(ctx, sx, sy, radius, hollow) {
	ctx.save();
	ctx.beginPath();
	for (var i = 0; i < 5; i++) {
		var a = -Math.PI / 2 + i * 2 * Math.PI / 5;
		var x = sx + radius * Math.cos(a);
		var y = sy + radius * Math.sin(a);
		if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
	}
	ctx.closePath();
	if (hollow) {
		ctx.lineWidth = 1.5;
		ctx.stroke();
	} else {
		ctx.fill();
	}
	ctx.restore();
};
