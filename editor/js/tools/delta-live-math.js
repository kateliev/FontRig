// ===================================================================
// FontRig — Delta Live Edit maths (pure: no DOM, no canvas)
// ===================================================================
// JS port of the host-neutral helpers the FontLab Delta Live Edit
// uses (TypeRig proxy/fl/gui/overlay_math.py), so both hosts drag the
// same way:
//   - deslant / reslant / slantBounds: italic frames. The slant is a
//     shear along X by y * tan(a); a in radians, positive leans right
//     (Delta's italic_rad = radians(-italic_angle)).
//   - EdgeSecant: inverse drag for an edge affine in its value (a
//     stem-compensated width is a*value + b, not proportional).
//   - frame points, transform origins, handle hit-testing.
// Tested headless: editor/test/delta-live-math.test.js
// ===================================================================
'use strict';

FontRig.deltaLiveMath = (function() {

	function clamp(v, lo, hi) {
		return v < lo ? lo : v > hi ? hi : v;
	}

	// -- Slant ------------------------------------------------------
	function deslant(x, y, a) { return [x - y * Math.tan(a), y]; }

	function reslant(x, y, a) { return [x + y * Math.tan(a), y]; }

	// Bounds [xmin, ymin, xmax, ymax] of [x, y] points in deslanted
	// space (plain bounds for a == 0), or null for no points.
	function slantBounds(points, a) {
		if (!points || !points.length) return null;
		var t = Math.tan(a || 0);
		var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
		for (var i = 0; i < points.length; i++) {
			var x = points[i][0] - points[i][1] * t, y = points[i][1];
			if (x < x0) x0 = x;
			if (x > x1) x1 = x;
			if (y < y0) y0 = y;
			if (y > y1) y1 = y;
		}
		return [x0, y0, x1, y1];
	}

	// -- EdgeSecant -------------------------------------------------
	// Starts from a guessed slope, then refines it with the secant
	// through the last two observations. A slope that changes sign is
	// rejected (keeps the drag monotone); a zero starting slope (the
	// edge the origin sits on) stays zero and solve() returns the last
	// observed value.
	function EdgeSecant(value, pos, slope) {
		this.slope = +slope;
		this.value = +value;
		this.pos = +pos;
		this.offset = this.pos - this.slope * this.value;
	}

	// Start from the guess "pos scales about anchor with value".
	EdgeSecant.proportional = function(value, pos, anchor) {
		return new EdgeSecant(value, pos, value ? (pos - anchor) / value : 0);
	};

	EdgeSecant.prototype.solve = function(target) {
		if (Math.abs(this.slope) < 1e-9) return this.value;
		return (target - this.offset) / this.slope;
	};

	EdgeSecant.prototype.observe = function(value, pos) {
		value = +value; pos = +pos;
		var dv = value - this.value;
		if (Math.abs(dv) > 1e-9) {
			var slope = (pos - this.pos) / dv;
			if (slope * this.slope > 0) this.slope = slope;
		}
		this.value = value;
		this.pos = pos;
		this.offset = pos - this.slope * value;
	};

	// -- Frame points and origins -----------------------------------
	// code -> side signs; -1 = left/bottom, 0 = middle, +1 = right/top
	var FRAME_POINTS = [['TL', -1, 1], ['TM', 0, 1], ['TR', 1, 1], ['RM', 1, 0],
	                    ['BR', 1, -1], ['BM', 0, -1], ['BL', -1, -1], ['LM', -1, 0]];

	// Delta's transform origins: baseline (font 0, 0) + the 9 frame points.
	// Codes match TypeRig delta_panel_actions._ORIGIN_FROM_CODE.
	var ORIGIN_CODES = ['BS', 'BL', 'BM', 'BR', 'LM', 'CE', 'RM', 'TL', 'TM', 'TR'];

	function sideCoord(lo, hi, side) {
		return side < 0 ? lo : side > 0 ? hi : (lo + hi) * 0.5;
	}

	// Side signs of an origin code, or null for BS (baseline).
	function originSides(code) {
		if (code === 'CE') return [0, 0];
		for (var i = 0; i < FRAME_POINTS.length; i++) {
			if (FRAME_POINTS[i][0] === code) return [FRAME_POINTS[i][1], FRAME_POINTS[i][2]];
		}
		return null;
	}

	// Origin coordinate on one axis of a (deslanted) frame: the starting
	// guess of the edge model; the secant corrects for Delta's realignment.
	function originCoord(frame, axis, code) {
		var s = originSides(code);
		if (!s) return 0;
		return axis === 'x' ? sideCoord(frame[0], frame[2], s[0]) : sideCoord(frame[1], frame[3], s[1]);
	}

	// Font-space point of a frame point: deslanted frame padded by pad
	// units, re-slanted (a parallelogram in italic).
	function framePoint(frame, slant, sx, sy, pad) {
		pad = pad || 0;
		var x = sideCoord(frame[0] - pad, frame[2] + pad, sx);
		var y = sideCoord(frame[1] - pad, frame[3] + pad, sy);
		return reslant(x, y, slant);
	}

	// Font-space point of an origin code (BS = font origin).
	function originPoint(frame, slant, code) {
		var s = originSides(code);
		if (!s) return [0, 0];
		return framePoint(frame, slant, s[0], s[1], 0);
	}

	// Nearest code; points: { code: [x, y] }.
	function nearestCode(points, x, y, fallback) {
		var best = fallback, bestD = Infinity;
		for (var code in points) {
			if (!Object.prototype.hasOwnProperty.call(points, code)) continue;
			var dx = points[code][0] - x, dy = points[code][1] - y;
			var d = dx * dx + dy * dy;
			if (d < bestD) { best = code; bestD = d; }
		}
		return best;
	}

	// -- Handle shapes ----------------------------------------------
	var BAR_LONG = 2.0, BAR_SHORT = 0.6;

	function halfExtents(shape, r) {
		if (shape === 'bar_h') return [r * BAR_LONG, r * BAR_SHORT];
		if (shape === 'bar_v') return [r * BAR_SHORT, r * BAR_LONG];
		return [r, r];
	}

	function hitShape(shape, cx, cy, r, px, py, tol) {
		var dx = px - cx, dy = py - cy;
		if (shape === 'circle') return dx * dx + dy * dy <= (r + tol) * (r + tol);
		var he = halfExtents(shape, r);
		return Math.abs(dx) <= he[0] + tol && Math.abs(dy) <= he[1] + tol;
	}

	// Topmost hit (later items are drawn on top); items need shape, x,
	// y, r and enabled !== false. Returns the item or null.
	function pickHandle(items, px, py, tol) {
		for (var i = items.length - 1; i >= 0; i--) {
			var h = items[i];
			if (h.enabled === false) continue;
			if (hitShape(h.shape, h.x, h.y, h.r, px, py, tol)) return h;
		}
		return null;
	}

	return {
		clamp: clamp,
		deslant: deslant, reslant: reslant, slantBounds: slantBounds,
		EdgeSecant: EdgeSecant,
		FRAME_POINTS: FRAME_POINTS, ORIGIN_CODES: ORIGIN_CODES,
		sideCoord: sideCoord, originSides: originSides, originCoord: originCoord,
		framePoint: framePoint, originPoint: originPoint, nearestCode: nearestCode,
		halfExtents: halfExtents, hitShape: hitShape, pickHandle: pickHandle,
	};
})();
