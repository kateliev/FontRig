// ===================================================================
// FontRig — Drawing primitives (JS math)
// ===================================================================
// One-shot primitive insertions and shared math used by the
// interactive drag tools.
//
// Each one-shot inserts a centered shape sized by
// FontRig.drawTool.options.primitiveSize. Center is the selection
// bbox center if a selection exists, otherwise (advanceWidth / 2,
// xHeight / 2 || layerHeight / 2).
//
// Hobby-shaped primitives (circle, ellipse) use a 4-cardinal-point
// cubic Bezier approximation (kappa = 0.5522847498). This matches
// the look of TypeRig's hobby-based ellipses closely enough that
// no Python round-trip is needed.
// ===================================================================
'use strict';

FontRig.drawPrimitives = {};

// -- Cubic-circle constant (4-arc Bezier approximation) ------------
var KAPPA = 0.5522847498307936;

// -- Insert center / size resolution -------------------------------
FontRig.drawPrimitives.resolveCenter = function() {
	var glyph = FontRig.state.glyphData;
	var lyr = FontRig.getActiveLayer();

	// Selection bbox?
	var sel = FontRig.state.selectedNodeIds;
	if (sel && sel.size > 0 && lyr && lyr.shapes) {
		var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		var found = false;
		for (var si = 0; si < lyr.shapes.length; si++) {
			var contours = lyr.shapes[si].contours;
			for (var ci = 0; ci < contours.length; ci++) {
				var nodes = contours[ci].nodes;
				for (var ni = 0; ni < nodes.length; ni++) {
					if (sel.has('c' + ci + '_n' + ni)) {
						var n = nodes[ni];
						if (n.x < minX) minX = n.x;
						if (n.y < minY) minY = n.y;
						if (n.x > maxX) maxX = n.x;
						if (n.y > maxY) maxY = n.y;
						found = true;
					}
				}
			}
		}
		if (found) return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
	}

	// Default: (advance/2, xHeight/2 or height/2)
	var w = (lyr && lyr.width) || 500;
	var h = 500;
	if (FontRig.font && FontRig.font.metrics && FontRig.font.metrics.xHeight) {
		h = FontRig.font.metrics.xHeight;
	} else if (lyr && lyr.height) {
		h = lyr.height / 2;
	}
	return { x: w / 2, y: h / 2 };
};

FontRig.drawPrimitives.size = function() {
	return Math.max(10, +FontRig.drawTool.options.primitiveSize || 250);
};

// ===================================================================
// Cubic-circle / ellipse contour builder
// ===================================================================
// Returns a closed Contour shaped like a cardinal-point cubic
// approximation of the ellipse with semi-axes (rx, ry) at center
// (cx, cy). Optionally rotated by angleRad.
//
// Node order (8 nodes total, going CCW from right):
//   on(R), off, off, on(T), off, off, on(L), off, off, on(B), off, off
// = 4 on-curve + 8 off-curve = 12 nodes.
// ===================================================================
FontRig.drawPrimitives.makeEllipseContour = function(cx, cy, rx, ry, angleRad) {
	angleRad = angleRad || 0;
	var ox = rx * KAPPA;
	var oy = ry * KAPPA;
	var cos = Math.cos(angleRad);
	var sin = Math.sin(angleRad);

	// Cardinal + handle points relative to center, then rotate+translate.
	function P(lx, ly) {
		return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
	}

	// CCW order starting at right (3 o'clock).
	// Each on-curve is followed by its outgoing handle, then the next
	// on-curve's incoming handle, then the next on-curve, etc.
	var raw = [
		[ rx,    0, 'on'],     // R
		[ rx,   oy, 'curve'],  // R out
		[ ox,   ry, 'curve'],  // T in
		[  0,   ry, 'on'],     // T
		[-ox,   ry, 'curve'],  // T out
		[-rx,   oy, 'curve'],  // L in
		[-rx,    0, 'on'],     // L
		[-rx,  -oy, 'curve'],  // L out
		[-ox,  -ry, 'curve'],  // B in
		[  0,  -ry, 'on'],     // B
		[ ox,  -ry, 'curve'],  // B out
		[ rx,  -oy, 'curve'],  // R in
	];

	var nodes = [];
	for (var i = 0; i < raw.length; i++) {
		var p = P(raw[i][0], raw[i][1]);
		var node = FontRig.drawTool.makeNode(p.x, p.y, raw[i][2], false);
		if (raw[i][2] === 'on') node.smooth = true;
		nodes.push(node);
	}
	return FontRig.drawTool.makeContour(nodes, true);
};

// ===================================================================
// Polygon / star / squircle builders (line-only contours)
// ===================================================================
FontRig.drawPrimitives.makeRegularPolygonContour = function(cx, cy, radius, n, startAngleDeg) {
	if (n < 3) return null;
	var nodes = [];
	var sa = (startAngleDeg || 0) * Math.PI / 180;
	for (var i = 0; i < n; i++) {
		var a = sa + 2 * Math.PI * i / n;
		nodes.push(FontRig.drawTool.makeNode(
			cx + radius * Math.cos(a),
			cy + radius * Math.sin(a),
			'on', false
		));
	}
	return FontRig.drawTool.makeContour(nodes, true);
};

FontRig.drawPrimitives.makeStarContour = function(cx, cy, outerR, innerR, n, startAngleDeg) {
	if (n < 3) return null;
	var nodes = [];
	var sa = (startAngleDeg || 0) * Math.PI / 180;
	for (var i = 0; i < n * 2; i++) {
		var r = (i % 2 === 0) ? outerR : innerR;
		var a = sa + Math.PI * i / n;
		nodes.push(FontRig.drawTool.makeNode(
			cx + r * Math.cos(a),
			cy + r * Math.sin(a),
			'on', false
		));
	}
	return FontRig.drawTool.makeContour(nodes, true);
};

// Squircle (Lamé curve) sampled into a polygon, then nodes at the
// 4 cardinal points are kept smooth-on, the rest as line corners.
// Higher exponent → more rectangular. exp = 2 = ellipse, exp ≈ 4-5 = Apple icon.
FontRig.drawPrimitives.makeSquircleContour = function(cx, cy, rx, ry, exponent, samples) {
	exponent = +exponent || 5;
	samples = samples || 64;
	var nodes = [];
	for (var i = 0; i < samples; i++) {
		var t = 2 * Math.PI * i / samples;
		var c = Math.cos(t);
		var s = Math.sin(t);
		// Lamé: x = rx * sign(cos) * |cos|^(2/n), similarly y
		var n = exponent;
		var x = rx * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
		var y = ry * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
		nodes.push(FontRig.drawTool.makeNode(cx + x, cy + y, 'on', false));
	}
	return FontRig.drawTool.makeContour(nodes, true);
};

// Rectangle from origin (BL) + width/height.
FontRig.drawPrimitives.makeRectContour = function(ox, oy, w, h) {
	var nodes = [
		FontRig.drawTool.makeNode(ox,     oy,     'on', false),
		FontRig.drawTool.makeNode(ox + w, oy,     'on', false),
		FontRig.drawTool.makeNode(ox + w, oy + h, 'on', false),
		FontRig.drawTool.makeNode(ox,     oy + h, 'on', false),
	];
	return FontRig.drawTool.makeContour(nodes, true);
};

// Line contour from (x1,y1) to (x2,y2) — open, two on-curve nodes.
FontRig.drawPrimitives.makeLineContour = function(x1, y1, x2, y2) {
	return FontRig.drawTool.makeContour([
		FontRig.drawTool.makeNode(x1, y1, 'on', false),
		FontRig.drawTool.makeNode(x2, y2, 'on', false),
	], false);
};

// Polyline contour (open) from a list of points.
FontRig.drawPrimitives.makePolylineContour = function(points, closed) {
	var nodes = [];
	for (var i = 0; i < points.length; i++) {
		nodes.push(FontRig.drawTool.makeNode(points[i].x, points[i].y, 'on', false));
	}
	return FontRig.drawTool.makeContour(nodes, !!closed);
};

// ===================================================================
// One-shot inserts (called from panel buttons)
// ===================================================================
FontRig.drawPrimitives.insertCircle = function() {
	var c = FontRig.drawPrimitives.resolveCenter();
	var r = FontRig.drawPrimitives.size() / 2;
	FontRig.drawTool.commitContour(
		FontRig.drawPrimitives.makeEllipseContour(c.x, c.y, r, r, 0)
	);
};

FontRig.drawPrimitives.insertSquare = function() {
	var c = FontRig.drawPrimitives.resolveCenter();
	var s = FontRig.drawPrimitives.size();
	FontRig.drawTool.commitContour(
		FontRig.drawPrimitives.makeRectContour(c.x - s / 2, c.y - s / 2, s, s)
	);
};

FontRig.drawPrimitives.insertNGon = function(n, startAngleDeg) {
	var c = FontRig.drawPrimitives.resolveCenter();
	var r = FontRig.drawPrimitives.size() / 2;
	FontRig.drawTool.commitContour(
		FontRig.drawPrimitives.makeRegularPolygonContour(c.x, c.y, r, n, startAngleDeg)
	);
};

FontRig.drawPrimitives.insertTriangle = function() {
	// Point up: first vertex at top (90°)
	FontRig.drawPrimitives.insertNGon(3, 90);
};

FontRig.drawPrimitives.insertPentagon = function() {
	FontRig.drawPrimitives.insertNGon(5, 90);
};

FontRig.drawPrimitives.insertDiamond = function() {
	// Square rotated 45° = n-gon n=4 starting at 90°
	FontRig.drawPrimitives.insertNGon(4, 90);
};

FontRig.drawPrimitives.insertStar = function() {
	var c = FontRig.drawPrimitives.resolveCenter();
	var rOut = FontRig.drawPrimitives.size() / 2;
	var rIn = rOut * (+FontRig.drawTool.options.starRatio || 0.5);
	var n = +FontRig.drawTool.options.starSides || 5;
	FontRig.drawTool.commitContour(
		FontRig.drawPrimitives.makeStarContour(c.x, c.y, rOut, rIn, n, 90)
	);
};

FontRig.drawPrimitives.insertSquircle = function() {
	var c = FontRig.drawPrimitives.resolveCenter();
	var r = FontRig.drawPrimitives.size() / 2;
	var exp = +FontRig.drawTool.options.squircleExp || 5;
	FontRig.drawTool.commitContour(
		FontRig.drawPrimitives.makeSquircleContour(c.x, c.y, r, r, exp, 64)
	);
};
