// Curvature-bezier spike tests — geometry/curvature-bezier.js.
//
// The important test is the ROUND TRIP: build a cubic from known handle
// lengths, measure its endpoint curvatures with an INDEPENDENT oracle
// (analytic first/second derivatives of the cubic — not the module's
// endpoint shortcut), feed those curvatures back into the solver, and
// check it recovers the original handle lengths. If the quartic has a
// sign error, this fails.
'use strict';

var test = require('node:test');
var assert = require('node:assert');
var loadFontRig = require('./helpers/load-fontrig').loadFontRig;

var F = loadFontRig([
	'core/state.js',
	'geometry/curvature-bezier.js',
]);
var C = F.Curvature;

// -- Independent oracle: signed curvature of a cubic via its analytic
// derivatives. Deliberately does NOT use the (2/3)*cross endpoint
// simplification the module relies on.
function cubicDeriv(P, t) {
	var u = 1 - t;
	return {
		x: 3 * u * u * (P[1].x - P[0].x) + 6 * u * t * (P[2].x - P[1].x) + 3 * t * t * (P[3].x - P[2].x),
		y: 3 * u * u * (P[1].y - P[0].y) + 6 * u * t * (P[2].y - P[1].y) + 3 * t * t * (P[3].y - P[2].y)
	};
}
function cubicDeriv2(P, t) {
	var u = 1 - t;
	return {
		x: 6 * u * (P[2].x - 2 * P[1].x + P[0].x) + 6 * t * (P[3].x - 2 * P[2].x + P[1].x),
		y: 6 * u * (P[2].y - 2 * P[1].y + P[0].y) + 6 * t * (P[3].y - 2 * P[2].y + P[1].y)
	};
}
function signedCurvatureAt(P, t) {
	var d = cubicDeriv(P, t), dd = cubicDeriv2(P, t);
	var speed = Math.hypot(d.x, d.y);
	return (d.x * dd.y - d.y * dd.x) / (speed * speed * speed);
}
function unit(x, y) { var m = Math.hypot(x, y); return { x: x / m, y: y / m }; }

// ------------------------------------------------------------------
// Root finder
// ------------------------------------------------------------------
test('realRoots solves a known quartic (roots -2,-1,1,3)', function() {
	// (x+2)(x+1)(x-1)(x-3) = x^4 -x^3 -7x^2 +x +6  -> low->high:
	var roots = C.realRoots([6, 1, -7, -1, 1]).sort(function(a, b) { return a - b; });
	assert.strictEqual(roots.length, 4);
	[-2, -1, 1, 3].forEach(function(want, i) {
		assert.ok(Math.abs(roots[i] - want) < 1e-6, 'root ' + i + ' = ' + roots[i]);
	});
});

test('realRoots collapses to lower degree when leading coeffs ~0', function() {
	// 0*x^4 + 0*x^3 + 2x^2 - 8  -> roots +/-2
	var roots = C.realRoots([-8, 0, 2, 0, 0]).sort(function(a, b) { return a - b; });
	assert.strictEqual(roots.length, 2);
	assert.ok(Math.abs(roots[0] + 2) < 1e-9 && Math.abs(roots[1] - 2) < 1e-9);
});

// ------------------------------------------------------------------
// Curvature <-> radius mapping
// ------------------------------------------------------------------
test('radius/curvature round trip and straight-line limit', function() {
	assert.ok(Math.abs(C.curvatureFromRadius(C.radiusFromCurvature(0.004)) - 0.004) < 1e-12);
	assert.strictEqual(C.radiusFromCurvature(0), Infinity);
	assert.strictEqual(C.curvatureFromRadius(Infinity), 0);
});

// ------------------------------------------------------------------
// measureEndCurvatures agrees with the independent analytic oracle
// ------------------------------------------------------------------
test('measureEndCurvatures matches analytic curvature', function() {
	var P = [{ x: 0, y: 0 }, { x: 30, y: 90 }, { x: 170, y: 70 }, { x: 200, y: 0 }];
	var m = C.measureEndCurvatures(P[0], P[1], P[2], P[3]);
	assert.ok(Math.abs(m.k0 - signedCurvatureAt(P, 0)) < 1e-9, 'k0');
	assert.ok(Math.abs(m.k1 - signedCurvatureAt(P, 1)) < 1e-9, 'k1');
});

// ------------------------------------------------------------------
// THE round trip: lengths -> cubic -> curvature -> solve -> lengths
// ------------------------------------------------------------------
var roundTripCases = [
	{ name: 'S-curve',        P0: { x: 0, y: 0 },   P3: { x: 200, y: 0 },  t0: unit(1, 1),  t1: unit(1, -1),  l0: 80,  l1: 120 },
	{ name: 'C-arc',          P0: { x: -100, y: 0 }, P3: { x: 100, y: 0 }, t0: unit(1, 2),  t1: unit(1, -2),  l0: 70,  l1: 70 },
	{ name: 'asymmetric',     P0: { x: 10, y: 20 }, P3: { x: 240, y: 60 }, t0: unit(2, 1),  t1: unit(1, 1),   l0: 55,  l1: 130 },
	{ name: 'gentle bend',    P0: { x: 0, y: 0 },   P3: { x: 300, y: 40 }, t0: unit(3, 1),  t1: unit(3, -1),  l0: 90,  l1: 90 },
];

roundTripCases.forEach(function(tc) {
	test('round trip recovers handle lengths: ' + tc.name, function() {
		var P = C.buildCubic(tc.P0, tc.P3, tc.t0, tc.t1, tc.l0, tc.l1);

		// Measure with the INDEPENDENT oracle.
		var k0 = signedCurvatureAt(P, 0);
		var k1 = signedCurvatureAt(P, 1);

		var sols = C.solveTangentLengths(tc.P0, tc.P3, tc.t0, tc.t1, k0, k1);
		assert.ok(sols.length > 0, 'at least one valid solution');

		// Some geometry admits several roots; require that one of them is
		// the pair we started from.
		var hit = sols.some(function(s) {
			return Math.abs(s.l0 - tc.l0) < 1e-2 && Math.abs(s.l1 - tc.l1) < 1e-2;
		});
		assert.ok(hit, 'recovered (l0,l1) among ' + JSON.stringify(sols.map(function(s) {
			return [Math.round(s.l0 * 100) / 100, Math.round(s.l1 * 100) / 100];
		})));

		// And every returned solution must actually realise the requested
		// curvatures when built back into a cubic (independent re-measure).
		sols.forEach(function(s) {
			var Q = C.buildCubic(tc.P0, tc.P3, tc.t0, tc.t1, s.l0, s.l1);
			assert.ok(Math.abs(signedCurvatureAt(Q, 0) - k0) < 1e-6, 'k0 realised');
			assert.ok(Math.abs(signedCurvatureAt(Q, 1) - k1) < 1e-6, 'k1 realised');
		});
	});
});

// ------------------------------------------------------------------
// Anchor-handle solve (the interactive "preserve curvature" drag).
// Move the far endpoint, re-scale only the anchor handle, and confirm
// the anchor curvature is unchanged.
// ------------------------------------------------------------------
test('solveAnchorHandleLength holds anchor curvature as the node moves', function() {
	var P = [{ x: 0, y: 0 }, { x: 40, y: 80 }, { x: 170, y: 60 }, { x: 200, y: 0 }];
	var tAnchor = unit(P[1].x - P[0].x, P[1].y - P[0].y);
	var tMoving = unit(P[3].x - P[2].x, P[3].y - P[2].y);
	var lMoving = Math.hypot(P[3].x - P[2].x, P[3].y - P[2].y);
	var kAnchor = signedCurvatureAt(P, 0);

	// Drag the node (P3) to a new location.
	var moved = { x: 240, y: -30 };
	var l0 = C.solveAnchorHandleLength(P[0], moved, tAnchor, tMoving, lMoving, kAnchor);
	assert.ok(l0 !== null && l0 > 0, 'got a positive anchor length');

	var rebuilt = [
		P[0],
		{ x: P[0].x + l0 * tAnchor.x, y: P[0].y + l0 * tAnchor.y },
		{ x: moved.x - lMoving * tMoving.x, y: moved.y - lMoving * tMoving.y },
		moved
	];
	assert.ok(Math.abs(signedCurvatureAt(rebuilt, 0) - kAnchor) < 1e-9,
		'anchor curvature preserved after the move');
});

test('solveAnchorHandleLength returns null for a straight anchor', function() {
	var r = C.solveAnchorHandleLength({ x: 0, y: 0 }, { x: 100, y: 50 },
		unit(1, 0), unit(1, 0), 30, 0);
	assert.strictEqual(r, null);
});

// ------------------------------------------------------------------
// Degenerate / fallback behaviour
// ------------------------------------------------------------------
test('straight collinear segment (k=0) is underdetermined -> fallback', function() {
	var P0 = { x: 0, y: 0 }, P3 = { x: 100, y: 0 };
	var t = unit(1, 0);
	var r = C.solveWithFallback(P0, P3, t, t, 0, 0);
	assert.ok(r.fallback, 'flags fallback');
	assert.ok(Math.abs(r.l0 - 100 / 3) < 1e-9 && Math.abs(r.l1 - 100 / 3) < 1e-9, 'chord thirds');
});

test('solveWithFallback always returns a usable positive pair', function() {
	var r = C.solveWithFallback({ x: 0, y: 0 }, { x: 200, y: 0 }, unit(1, 1), unit(1, -1), 0.006, -0.006);
	assert.ok(r.l0 > 0 && r.l1 > 0, 'positive lengths');
	assert.ok(isFinite(r.l0) && isFinite(r.l1));
});

// ------------------------------------------------------------------
// Monotonicity: on a symmetric arc, a shorter handle produces a
// tighter turn (larger |curvature|). We derive curvatures from real
// builds so both are feasible, then confirm the solver recovers each
// and the direction of the relationship holds.
// ------------------------------------------------------------------
test('shorter handle => tighter curvature, and solver recovers both', function() {
	var P0 = { x: -100, y: 0 }, P3 = { x: 100, y: 0 };
	var t0 = unit(1, 3), t1 = unit(1, -3);

	var shortP = C.buildCubic(P0, P3, t0, t1, 40, 40);
	var longP  = C.buildCubic(P0, P3, t0, t1, 90, 90);
	var kShort = signedCurvatureAt(shortP, 0);
	var kLong  = signedCurvatureAt(longP, 0);

	assert.ok(Math.abs(kShort) > Math.abs(kLong),
		'shorter handle turns tighter (' + kShort + ' vs ' + kLong + ')');

	var sShort = C.solveWithFallback(P0, P3, t0, t1, kShort, signedCurvatureAt(shortP, 1));
	var sLong  = C.solveWithFallback(P0, P3, t0, t1, kLong,  signedCurvatureAt(longP, 1));
	assert.ok(!sShort.fallback && !sLong.fallback, 'both solved');
	assert.ok(Math.abs(sShort.l0 - 40) < 1e-2, 'recovers short handle: ' + sShort.l0);
	assert.ok(Math.abs(sLong.l0 - 90) < 1e-2, 'recovers long handle: ' + sLong.l0);
});
