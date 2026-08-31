// ===================================================================
// FontRig — geometry/curvature-bezier.js   (SPIKE / prototype)
// ===================================================================
// Curvature-based Bezier handles, after Steven Wittens'
// "How to Draw Curves" / curvature-beziers (acko.net).
//
// The idea: instead of parameterizing a cubic segment by the two
// off-curve control points, parameterize each *end* by
//   - a unit tangent direction, and
//   - a signed curvature k (1/radius, sign = turn direction).
// Handle LENGTH then follows from the curvature you asked for at BOTH
// ends, solved jointly. This is what makes "true G2" editing possible:
// you set the curvature at a node and the tool finds the handle lengths
// that realise it, rather than you nudging control points and hoping.
//
// This module is PURE MATH — no DOM, no FontRig.state, no drawing. It
// is the de-risking spike for the acko.net editing mode: prove the
// solve is correct and cheap in plain JS before any UI work.
//
// Geometry / sign conventions (must stay consistent with the tests):
//   * A segment runs P0 -> P3 with control points P1, P2.
//   * t0 = unit tangent at the START, pointing P0 -> P1 (outgoing).
//   * t1 = unit tangent at the END,   pointing P2 -> P3 (arrival).
//         => P1 = P0 + l0 * t0,  P2 = P3 - l1 * t1,  l0,l1 >= 0.
//   * cross(a,b) = a.x*b.y - a.y*b.x   (standard 2D scalar cross).
//   * Signed curvature of the cubic at an endpoint:
//         k0 = (2/3) * cross(P1-P0, P2-P1) / |P1-P0|^3
//         k1 = (2/3) * cross(P2-P1, P3-P2) / |P3-P2|^3
//     (n-1)/n = 2/3 for a cubic; positive k = left turn.
//
// Deriving the solve. Substituting the handle definitions into the two
// endpoint-curvature formulas gives, with
//     c  = P3 - P0,  a0 = cross(t0,c),  a1 = cross(c,t1),  d = cross(t0,t1):
//         (3/2) k0 l0^2 = a0 - l1 d          ... (A)
//         (3/2) k1 l1^2 = a1 - l0 d          ... (B)
// Writing K0 = (3/2)k0, K1 = (3/2)k1 and eliminating l1 = (a0 - K0 l0^2)/d
// yields a depressed quartic in l0:
//         (K0^2 K1) l0^4  +  (-2 a0 K0 K1) l0^2  +  (d^3) l0
//                         +  (K1 a0^2 - a1 d^2)  =  0
// Degenerate inputs (k~0, parallel tangents) drop the leading terms and
// the same coefficient vector reduces to a quadratic/linear — the root
// finder strips near-zero high-order coefficients, so we get those cases
// for free. l1 recovery and a residual check handle the parallel-tangent
// (d~0) corner the paper flags as ambiguous.
// ===================================================================
'use strict';

FontRig.Curvature = (function() {

	var EPS = 1e-9;

	// -- tiny vector helpers ----------------------------------------
	function cross(a, b) { return a.x * b.y - a.y * b.x; }
	function dot(a, b)   { return a.x * b.x + a.y * b.y; }
	function sub(a, b)   { return { x: a.x - b.x, y: a.y - b.y }; }
	function len(v)      { return Math.hypot(v.x, v.y); }
	function unit(v) {
		var m = Math.hypot(v.x, v.y);
		return (m < EPS) ? { x: 0, y: 0 } : { x: v.x / m, y: v.y / m };
	}

	// -- curvature <-> radius (for the UI handle-length mapping) -----
	// Radius carries the curvature's sign so the handle can encode both
	// magnitude and turn direction. k = 0 => straight => infinite radius.
	function radiusFromCurvature(k) {
		return (Math.abs(k) < EPS) ? Infinity : 1 / k;
	}
	function curvatureFromRadius(r) {
		return (!isFinite(r) || Math.abs(r) < EPS) ? 0 : 1 / r;
	}

	// ---------------------------------------------------------------
	// Real-root finders. Coeffs are LOW->HIGH: [c0, c1, c2, ... cN].
	// stripLeading() drops near-zero top coefficients so a "quartic"
	// with k~0 collapses to the right lower-degree solve automatically.
	// ---------------------------------------------------------------
	function stripLeading(c) {
		var i = c.length - 1;
		// Scale the zero-test to the largest magnitude present so we don't
		// treat a legitimately small leading term as zero.
		var scale = 0;
		for (var j = 0; j < c.length; j++) scale = Math.max(scale, Math.abs(c[j]));
		var tol = (scale > 0 ? scale : 1) * 1e-14;
		while (i > 0 && Math.abs(c[i]) <= tol) i--;
		return c.slice(0, i + 1);
	}

	function realRootsLinear(c0, c1) {
		return (Math.abs(c1) < EPS) ? [] : [-c0 / c1];
	}

	function realRootsQuadratic(c0, c1, c2) {
		if (Math.abs(c2) < EPS) return realRootsLinear(c0, c1);
		var disc = c1 * c1 - 4 * c2 * c0;
		if (disc < 0) return [];
		if (disc === 0) return [-c1 / (2 * c2)];
		var s = Math.sqrt(disc);
		return [(-c1 + s) / (2 * c2), (-c1 - s) / (2 * c2)];
	}

	// Durand-Kerner (Weierstrass) for degree 3 and 4: robust, no fragile
	// Cardano/Ferrari sign analysis. Returns real roots only. This runs a
	// few dozen complex iterations — trivially cheap for one drag frame.
	function realRootsDK(coeffs) {
		coeffs = stripLeading(coeffs);
		var deg = coeffs.length - 1;
		if (deg <= 0) return [];
		if (deg === 1) return realRootsLinear(coeffs[0], coeffs[1]);
		if (deg === 2) return realRootsQuadratic(coeffs[0], coeffs[1], coeffs[2]);

		// Normalise to monic, high->low, as complex.
		var lead = coeffs[deg];
		var a = [];             // a[i] = coefficient of x^(deg-i), i=0..deg
		for (var i = deg; i >= 0; i--) a.push({ re: coeffs[i] / lead, im: 0 });

		function cAdd(p, q) { return { re: p.re + q.re, im: p.im + q.im }; }
		function cSub(p, q) { return { re: p.re - q.re, im: p.im - q.im }; }
		function cMul(p, q) { return { re: p.re * q.re - p.im * q.im, im: p.re * q.im + p.im * q.re }; }
		function cDiv(p, q) {
			var den = q.re * q.re + q.im * q.im;
			return { re: (p.re * q.re + p.im * q.im) / den, im: (p.im * q.re - p.re * q.im) / den };
		}
		function polyEval(z) {
			var acc = { re: 1, im: 0 };            // monic leading term
			for (var k = 1; k <= deg; k++) acc = cAdd(cMul(acc, z), a[k]);
			return acc;
		}

		// Seed with the classic spread-out complex initial guesses.
		var roots = [];
		var seed = { re: 0.4, im: 0.9 };
		var cur = { re: 1, im: 0 };
		for (var r = 0; r < deg; r++) {
			roots.push(cur);
			cur = cMul(cur, seed);
		}

		for (var iter = 0; iter < 60; iter++) {
			var maxDelta = 0;
			for (var m = 0; m < deg; m++) {
				var num = polyEval(roots[m]);
				var den = { re: 1, im: 0 };
				for (var j = 0; j < deg; j++) {
					if (j === m) continue;
					den = cMul(den, cSub(roots[m], roots[j]));
				}
				var delta = cDiv(num, den);
				roots[m] = cSub(roots[m], delta);
				maxDelta = Math.max(maxDelta, Math.hypot(delta.re, delta.im));
			}
			if (maxDelta < 1e-14) break;
		}

		var out = [];
		for (var q = 0; q < deg; q++) {
			var z = roots[q];
			if (Math.abs(z.im) <= 1e-7 * (1 + Math.abs(z.re))) {
				// One Newton polish on the real axis to clean up DK residue.
				var x = z.re;
				for (var p = 0; p < 3; p++) {
					var f = coeffs[deg], df = 0;
					for (var t = deg - 1; t >= 0; t--) { df = df * x + f; f = f * x + coeffs[t]; }
					if (Math.abs(df) < EPS) break;
					x -= f / df;
				}
				out.push(x);
			}
		}
		return out;
	}

	// ---------------------------------------------------------------
	// buildCubic: (endpoints + unit tangents + handle lengths) -> [P0..P3]
	// ---------------------------------------------------------------
	function buildCubic(P0, P3, t0, t1, l0, l1) {
		return [
			{ x: P0.x, y: P0.y },
			{ x: P0.x + l0 * t0.x, y: P0.y + l0 * t0.y },
			{ x: P3.x - l1 * t1.x, y: P3.y - l1 * t1.y },
			{ x: P3.x, y: P3.y }
		];
	}

	// ---------------------------------------------------------------
	// measureEndCurvatures: closed-form signed curvature at both ends.
	// Independent-of-the-solver oracle used by callers and tests.
	// ---------------------------------------------------------------
	function measureEndCurvatures(P0, P1, P2, P3) {
		var v0 = sub(P1, P0), v1 = sub(P2, P1), v2 = sub(P3, P2);
		var l0 = len(v0), l1 = len(v2);
		var k0 = (l0 < EPS) ? 0 : (2 / 3) * cross(v0, v1) / (l0 * l0 * l0);
		var k1 = (l1 < EPS) ? 0 : (2 / 3) * cross(v1, v2) / (l1 * l1 * l1);
		return { k0: k0, k1: k1 };
	}

	// Selection weight from the paper: penalises unstable / self-
	// intersecting solutions, favours balanced handle lengths. theta is
	// the angle between the two tangents; acos(-cos theta) = PI - theta.
	function solutionWeight(l0, l1, t0, t1) {
		var theta = Math.acos(Math.max(-1, Math.min(1, dot(t0, t1))));
		var denom = l0 * l0 + l1 * l1;
		if (denom < EPS) return 0;
		var w = (l0 * l1 * Math.acos(-Math.cos(theta))) / denom;
		return w * w;
	}

	// ---------------------------------------------------------------
	// solveTangentLengths: THE core solve.
	// Given a segment's endpoints, both END unit tangents, and the
	// desired signed curvature at each end, return every physically
	// valid (l0 >= 0, l1 >= 0) handle-length pair, best-first.
	//
	//   returns [{ l0, l1, weight, residual }, ...]  (may be empty)
	//   plus a `.fallback` array is never used — callers pick [0] or
	//   fall back themselves via solveWithFallback().
	// ---------------------------------------------------------------
	function solveTangentLengths(P0, P3, t0In, t1In, k0, k1) {
		var t0 = unit(t0In), t1 = unit(t1In);
		var c = sub(P3, P0);

		var a0 = cross(t0, c);
		var a1 = cross(c, t1);
		var d  = cross(t0, t1);

		var K0 = 1.5 * k0;
		var K1 = 1.5 * k1;

		// Depressed quartic in l0 (low->high). c3 term is identically 0.
		var coeffs = [
			K1 * a0 * a0 - a1 * d * d,   // c0
			d * d * d,                   // c1
			-2 * a0 * K0 * K1,           // c2
			0,                           // c3
			K0 * K0 * K1                 // c4
		];

		var l0Candidates = realRootsDK(coeffs);
		var parallel = Math.abs(d) < 1e-7;

		var out = [];
		for (var i = 0; i < l0Candidates.length; i++) {
			var l0 = l0Candidates[i];
			if (!isFinite(l0) || l0 < -1e-6) continue;

			// Recover l1. Away from parallel tangents, use (A). At (near)
			// parallel tangents that formula is 0/0, so fall back to (B):
			// K1 l1^2 = a1  =>  l1 = sqrt(a1 / K1).
			var l1;
			if (!parallel) {
				l1 = (a0 - K0 * l0 * l0) / d;
			} else if (Math.abs(K1) > EPS) {
				var q = a1 / K1;
				if (q < 0) continue;
				l1 = Math.sqrt(q);
			} else {
				continue; // straight + parallel: nothing to pin l1 — skip
			}
			if (!isFinite(l1) || l1 < -1e-6) continue;

			l0 = Math.max(0, l0);
			l1 = Math.max(0, l1);

			// Validate against BOTH original equations and keep the
			// residual so a caller can gauge confidence. This also filters
			// spurious l1 recoveries near the degenerate corner.
			var resA = K0 * l0 * l0 - (a0 - l1 * d);
			var resB = K1 * l1 * l1 - (a1 - l0 * d);
			var chord = len(c) || 1;
			var residual = (Math.abs(resA) + Math.abs(resB)) / chord;
			if (residual > 1e-6) continue;

			out.push({
				l0: l0,
				l1: l1,
				weight: solutionWeight(l0, l1, t0, t1),
				residual: residual
			});
		}

		out.sort(function(p, q) { return q.weight - p.weight; });
		return out;
	}

	// ---------------------------------------------------------------
	// solveAnchorHandleLength: the well-determined single-unknown solve
	// used by the interactive "preserve curvature" node-drag mode.
	//
	// A segment runs anchor -> moving. The anchor end is STATIONARY and we
	// want to hold its curvature `kAnchor` fixed. Both tangent directions
	// are fixed, and the moving-end handle length `lMoving` is fixed (it
	// rode along rigidly with the node). Only the anchor-side handle
	// length is free — one unknown, one equation (relation A):
	//         (3/2) kAnchor * l^2 = cross(tAnchor, c) - lMoving * cross(tAnchor, tMoving)
	// where c = moving - anchor. Returns the new anchor-side length, or
	// null when there is no positive real solution (straight anchor, or
	// the node has moved past the feasible range) — the caller then keeps
	// the handle rigid.
	// ---------------------------------------------------------------
	function solveAnchorHandleLength(anchor, moving, tAnchor, tMoving, lMoving, kAnchor) {
		var K = 1.5 * kAnchor;
		if (Math.abs(K) < EPS) return null;             // straight anchor
		var c = sub(moving, anchor);
		var a0 = cross(tAnchor, c);
		var d  = cross(tAnchor, tMoving);
		var rhs = (a0 - lMoving * d) / K;
		if (!(rhs > 0)) return null;                    // no positive length
		return Math.sqrt(rhs);
	}

	// Convenience wrapper: always returns a single usable pair. If the
	// solve produced no valid root (the ambiguous / degenerate cases the
	// paper says need a split), fall back to projecting chord-thirds onto
	// the tangents so the caller always has something to draw.
	function solveWithFallback(P0, P3, t0In, t1In, k0, k1) {
		var sols = solveTangentLengths(P0, P3, t0In, t1In, k0, k1);
		if (sols.length > 0) {
			return { l0: sols[0].l0, l1: sols[0].l1, weight: sols[0].weight,
			         residual: sols[0].residual, fallback: false, count: sols.length };
		}
		var chord = len(sub(P3, P0));
		var third = chord / 3;
		return { l0: third, l1: third, weight: 0, residual: NaN,
		         fallback: true, count: 0 };
	}

	return {
		EPS: EPS,
		cross: cross,
		unit: unit,
		radiusFromCurvature: radiusFromCurvature,
		curvatureFromRadius: curvatureFromRadius,
		realRoots: realRootsDK,
		buildCubic: buildCubic,
		measureEndCurvatures: measureEndCurvatures,
		solutionWeight: solutionWeight,
		solveTangentLengths: solveTangentLengths,
		solveWithFallback: solveWithFallback,
		solveAnchorHandleLength: solveAnchorHandleLength
	};
})();
