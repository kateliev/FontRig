// ===================================================================
// FontRig — geometry/curve-fit.js
// ===================================================================
// Cubic curve-fitting + segment sampling math (moved from interaction.js, M7).
// Pure functions: operate only on their arguments, no DOM/state deps.
// ===================================================================
'use strict';

// Analyze the incoming segment (ending at onIdx).
// Returns { type, prevOnIdx, handleIndices, outerHandle }
FontRig._analyzeIncoming = function(nodes, n, onIdx) {
	var result = { type: 'line', prevOnIdx: -1, handleIndices: [], outerHandle: null };
	var i = (onIdx - 1 + n) % n;

	if (nodes[i].type === 'on') {
		// Line segment: prev on-curve directly
		result.prevOnIdx = i;
		return result;
	}

	// Walk backwards past handles
	var handles = [];
	while (nodes[i].type !== 'on') {
		handles.push(i);
		i = (i - 1 + n) % n;
	}
	result.prevOnIdx = i;
	result.handleIndices = handles;

	if (handles.length >= 2) {
		result.type = 'cubic';
		// Outer handle is the one closest to prevOnIdx (first in the segment)
		result.outerHandle = { x: nodes[handles[handles.length - 1]].x, y: nodes[handles[handles.length - 1]].y };
	} else if (handles.length === 1) {
		result.type = 'quad';
		result.outerHandle = { x: nodes[handles[0]].x, y: nodes[handles[0]].y };
	}

	return result;
};

// Analyze the outgoing segment (starting at onIdx).
// Returns { type, nextOnIdx, handleIndices, outerHandle }
FontRig._analyzeOutgoing = function(nodes, n, onIdx) {
	var result = { type: 'line', nextOnIdx: -1, handleIndices: [], outerHandle: null };
	var i = (onIdx + 1) % n;

	if (nodes[i].type === 'on') {
		// Line segment: next on-curve directly
		result.nextOnIdx = i;
		return result;
	}

	// Walk forward past handles
	var handles = [];
	while (nodes[i].type !== 'on') {
		handles.push(i);
		i = (i + 1) % n;
	}
	result.nextOnIdx = i;
	result.handleIndices = handles;

	if (handles.length >= 2) {
		result.type = 'cubic';
		// Outer handle is the one closest to nextOnIdx (last in the segment)
		result.outerHandle = { x: nodes[handles[handles.length - 1]].x, y: nodes[handles[handles.length - 1]].y };
	} else if (handles.length === 1) {
		result.type = 'quad';
		result.outerHandle = { x: nodes[handles[0]].x, y: nodes[handles[0]].y };
	}

	return result;
};

// Build replacement nodes between prevOn and nextOn after deleting
// the node between incoming and outgoing segments.
FontRig._buildReplacement = function(nodes, incoming, outgoing) {
	var round = function(v) { return Math.round(v * 10) / 10; };
	var prevOn = nodes[incoming.prevOnIdx];
	var nextOn = nodes[outgoing.nextOnIdx];

	var inType = incoming.type;
	var outType = outgoing.type;

	// Line-Line: no replacement nodes needed, straight line
	if (inType === 'line' && outType === 'line') {
		return [];
	}

	// Curve-Curve: merge into single cubic with scaled outer handles
	if (inType === 'cubic' && outType === 'cubic') {
		return FontRig._mergeCubics(prevOn, incoming.outerHandle, outgoing.outerHandle, nextOn);
	}

	// Curve-Line: cubic from prevOn with incoming outer handle → nextOn
	if (inType === 'cubic' && outType === 'line') {
		return FontRig._curveToLine(prevOn, incoming.outerHandle, nextOn);
	}

	// Line-Curve: cubic from prevOn → nextOn with outgoing outer handle
	if (inType === 'line' && outType === 'cubic') {
		return FontRig._lineToCurve(prevOn, outgoing.outerHandle, nextOn);
	}

	// Fallback for quad or mixed: just line
	return [];
};

// -- Least-squares cubic Bezier fitting ------------------------------
// Sample a cubic at parameter t
FontRig._sampleCubic = function(p0, p1, p2, p3, t) {
	var u = 1 - t;
	var uu = u * u, tt = t * t;
	return {
		x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
		y: uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y
	};
};

// Sample a line at parameter t
FontRig._sampleLine = function(p0, p1, t) {
	return {
		x: p0.x + t * (p1.x - p0.x),
		y: p0.y + t * (p1.y - p0.y)
	};
};

// Collect dense samples from a segment, returns [{ x, y }]
FontRig._sampleSegment = function(nodes, n, onIdx, direction, numSamples) {
	var samples = [];
	var i, pts;

	if (direction === 'incoming') {
		// Walk backward from onIdx to find segment start
		i = (onIdx - 1 + n) % n;
		if (nodes[i].type === 'on') {
			// Line
			for (var s = 0; s <= numSamples; s++) {
				var t = s / numSamples;
				samples.push(FontRig._sampleLine(nodes[i], nodes[onIdx], t));
			}
			return samples;
		}
		// Cubic: walk back to find start on-curve
		var handles = [];
		while (nodes[i].type !== 'on') {
			handles.unshift(i);
			i = (i - 1 + n) % n;
		}
		// i is the start on-curve, handles go toward onIdx
		if (handles.length >= 2) {
			var p0 = nodes[i];
			var p1 = nodes[handles[0]];
			var p2 = nodes[handles[1]];
			var p3 = nodes[onIdx];
			for (var s = 0; s <= numSamples; s++) {
				samples.push(FontRig._sampleCubic(p0, p1, p2, p3, s / numSamples));
			}
		}
		return samples;
	} else {
		// Outgoing: walk forward from onIdx
		i = (onIdx + 1) % n;
		if (nodes[i].type === 'on') {
			for (var s = 0; s <= numSamples; s++) {
				samples.push(FontRig._sampleLine(nodes[onIdx], nodes[i], s / numSamples));
			}
			return samples;
		}
		var handles = [];
		while (nodes[i].type !== 'on') {
			handles.push(i);
			i = (i + 1) % n;
		}
		if (handles.length >= 2) {
			var p0 = nodes[onIdx];
			var p1 = nodes[handles[0]];
			var p2 = nodes[handles[1]];
			var p3 = nodes[i];
			for (var s = 0; s <= numSamples; s++) {
				samples.push(FontRig._sampleCubic(p0, p1, p2, p3, s / numSamples));
			}
		}
		return samples;
	}
};

// Arc-length parameterization: assign t values to samples based on
// cumulative distance, normalized to [0, 1].
FontRig._arcLengthParameterize = function(samples) {
	var params = [0];
	var total = 0;
	for (var i = 1; i < samples.length; i++) {
		var dx = samples[i].x - samples[i - 1].x;
		var dy = samples[i].y - samples[i - 1].y;
		total += Math.sqrt(dx * dx + dy * dy);
		params.push(total);
	}
	if (total > 0.001) {
		for (var i = 0; i < params.length; i++) {
			params[i] /= total;
		}
	}
	return params;
};

// Unconstrained least-squares: fit cubic P0→P1→P2→P3 to samples.
// P0 and P3 are fixed endpoints. Solves for P1, P2.
FontRig._fitCubicUnconstrained = function(samples, params, P0, P3) {
	var round = function(v) { return Math.round(v * 10) / 10; };

	// Build normal equations for: A1*P1 + A2*P2 = R
	// A1i = 3(1-t)²t,  A2i = 3(1-t)t²
	var C00 = 0, C01 = 0, C11 = 0;
	var Rx0 = 0, Ry0 = 0, Rx1 = 0, Ry1 = 0;

	for (var i = 0; i < samples.length; i++) {
		var t = params[i];
		var u = 1 - t;
		var A1 = 3 * u * u * t;
		var A2 = 3 * u * t * t;

		// Residual: sample minus endpoint contribution
		var rx = samples[i].x - (u * u * u * P0.x + t * t * t * P3.x);
		var ry = samples[i].y - (u * u * u * P0.y + t * t * t * P3.y);

		C00 += A1 * A1;
		C01 += A1 * A2;
		C11 += A2 * A2;
		Rx0 += A1 * rx;
		Ry0 += A1 * ry;
		Rx1 += A2 * rx;
		Ry1 += A2 * ry;
	}

	// Solve 2x2 system: [C00, C01; C01, C11] * [p1, p2] = [R0, R1]
	var det = C00 * C11 - C01 * C01;
	if (Math.abs(det) < 1e-12) {
		// Degenerate: fall back to 1/3 rule
		return {
			P1: { x: round(P0.x + (P3.x - P0.x) / 3), y: round(P0.y + (P3.y - P0.y) / 3) },
			P2: { x: round(P3.x - (P3.x - P0.x) / 3), y: round(P3.y - (P3.y - P0.y) / 3) }
		};
	}

	var invDet = 1 / det;
	return {
		P1: {
			x: round((C11 * Rx0 - C01 * Rx1) * invDet),
			y: round((C11 * Ry0 - C01 * Ry1) * invDet)
		},
		P2: {
			x: round((C00 * Rx1 - C01 * Rx0) * invDet),
			y: round((C00 * Ry1 - C01 * Ry0) * invDet)
		}
	};
};

// Tangent-constrained least-squares: P1 = P0 + α₁·T1, P2 = P3 + α₂·T2.
// Solves for scalar distances α₁, α₂ (preserves G1 continuity).
FontRig._fitCubicConstrained = function(samples, params, P0, P3, T1, T2) {
	var round = function(v) { return Math.round(v * 10) / 10; };
	var dot12 = T1.x * T2.x + T1.y * T2.y;

	var C00 = 0, C01 = 0, C11 = 0;
	var R0 = 0, R1 = 0;

	for (var i = 0; i < samples.length; i++) {
		var t = params[i];
		var u = 1 - t;
		var b1 = 3 * u * u * t;
		var b2 = 3 * u * t * t;

		// With P1 = P0 + α₁T1 and P2 = P3 + α₂T2, the fixed part is
		// (B0+B1)·P0 + (B2+B3)·P3, not just B0·P0 + B3·P3
		var fixedP0 = u * u * u + b1;   // B0 + B1
		var fixedP3 = b2 + t * t * t;   // B2 + B3
		var rx = samples[i].x - (fixedP0 * P0.x + fixedP3 * P3.x);
		var ry = samples[i].y - (fixedP0 * P0.y + fixedP3 * P3.y);

		C00 += b1 * b1;           // T1·T1 = 1
		C01 += b1 * b2 * dot12;   // T1·T2
		C11 += b2 * b2;           // T2·T2 = 1
		R0  += b1 * (T1.x * rx + T1.y * ry);
		R1  += b2 * (T2.x * rx + T2.y * ry);
	}

	var det = C00 * C11 - C01 * C01;
	var alpha1, alpha2;

	if (Math.abs(det) < 1e-12) {
		// Degenerate: use chord thirds
		var chordDx = P3.x - P0.x;
		var chordDy = P3.y - P0.y;
		var chordLen = Math.sqrt(chordDx * chordDx + chordDy * chordDy);
		alpha1 = chordLen / 3;
		alpha2 = chordLen / 3;
	} else {
		alpha1 = (C11 * R0 - C01 * R1) / det;
		alpha2 = (C00 * R1 - C01 * R0) / det;
	}

	// Clamp: prevent degenerate negative or extreme handles
	var chordDx = P3.x - P0.x;
	var chordDy = P3.y - P0.y;
	var chordLen = Math.sqrt(chordDx * chordDx + chordDy * chordDy);
	var maxLen = chordLen * 4; // large arcs need long handles
	alpha1 = Math.max(0.01, Math.min(alpha1, maxLen));
	alpha2 = Math.max(0.01, Math.min(alpha2, maxLen));

	return {
		P1: {
			x: round(P0.x + alpha1 * T1.x),
			y: round(P0.y + alpha1 * T1.y)
		},
		P2: {
			x: round(P3.x + alpha2 * T2.x),
			y: round(P3.y + alpha2 * T2.y)
		}
	};
};

// Newton-Raphson reparameterization: improve t values for each sample
// by projecting onto the current fitted curve.
FontRig._reparameterize = function(samples, params, P0, P1, P2, P3) {
	var newParams = [];
	for (var i = 0; i < samples.length; i++) {
		var t = params[i];
		var Q = samples[i];

		// Evaluate curve and derivative at t
		var u = 1 - t;
		var Bt = {
			x: u*u*u*P0.x + 3*u*u*t*P1.x + 3*u*t*t*P2.x + t*t*t*P3.x,
			y: u*u*u*P0.y + 3*u*u*t*P1.y + 3*u*t*t*P2.y + t*t*t*P3.y
		};
		// First derivative
		var Bd = {
			x: 3*u*u*(P1.x-P0.x) + 6*u*t*(P2.x-P1.x) + 3*t*t*(P3.x-P2.x),
			y: 3*u*u*(P1.y-P0.y) + 6*u*t*(P2.y-P1.y) + 3*t*t*(P3.y-P2.y)
		};
		// Second derivative
		var Bdd = {
			x: 6*u*(P2.x-2*P1.x+P0.x) + 6*t*(P3.x-2*P2.x+P1.x),
			y: 6*u*(P2.y-2*P1.y+P0.y) + 6*t*(P3.y-2*P2.y+P1.y)
		};

		var dx = Bt.x - Q.x, dy = Bt.y - Q.y;
		var num = dx * Bd.x + dy * Bd.y;
		var den = Bd.x*Bd.x + Bd.y*Bd.y + dx*Bdd.x + dy*Bdd.y;

		var newT = (Math.abs(den) > 1e-12) ? t - num / den : t;
		newParams.push(Math.max(0, Math.min(1, newT)));
	}
	return newParams;
};

// High-level: merge two cubics by sampling + least-squares fitting
// with tangent-constrained optimization and Newton refinement.
FontRig._mergeCubics = function(prevOn, inHandle, outHandle, nextOn) {
	return FontRig._fitMergedSegments(prevOn, nextOn, inHandle, outHandle, true);
};

FontRig._curveToLine = function(prevOn, inHandle, nextOn) {
	return FontRig._fitMergedSegments(prevOn, nextOn, inHandle, null, false);
};

FontRig._lineToCurve = function(prevOn, outHandle, nextOn) {
	return FontRig._fitMergedSegments(prevOn, nextOn, null, outHandle, false);
};

// Unified fitting: collects samples from both segments around the
// deleted node, then fits a single cubic.
// inHandle/outHandle may be null for line sides.
FontRig._fitMergedSegments = function(P0, P3, inHandle, outHandle, bothCurves) {
	var round = function(v) { return Math.round(v * 10) / 10; };

	// Collect samples from the deleteNode caller — we stored them
	var samples = FontRig._pendingSamples;
	var params = FontRig._arcLengthParameterize(samples);

	if (samples.length < 4) {
		// Not enough data — 1/3 rule fallback
		return [
			{ type: 'curve', x: round(P0.x + (P3.x - P0.x) / 3), y: round(P0.y + (P3.y - P0.y) / 3) },
			{ type: 'curve', x: round(P3.x - (P3.x - P0.x) / 3), y: round(P3.y - (P3.y - P0.y) / 3) }
		];
	}

	var fit;

	if (bothCurves && inHandle && outHandle) {
		// Tangent-constrained: preserve G1 at endpoints
		var t1dx = inHandle.x - P0.x, t1dy = inHandle.y - P0.y;
		var t1len = Math.sqrt(t1dx * t1dx + t1dy * t1dy);
		var t2dx = outHandle.x - P3.x, t2dy = outHandle.y - P3.y;
		var t2len = Math.sqrt(t2dx * t2dx + t2dy * t2dy);

		if (t1len < 0.001 || t2len < 0.001) {
			fit = FontRig._fitCubicUnconstrained(samples, params, P0, P3);
		} else {
			var T1 = { x: t1dx / t1len, y: t1dy / t1len };
			var T2 = { x: t2dx / t2len, y: t2dy / t2len };

			fit = FontRig._fitCubicConstrained(samples, params, P0, P3, T1, T2);

			// Newton-Raphson refinement: 3 iterations
			for (var iter = 0; iter < 3; iter++) {
				params = FontRig._reparameterize(samples, params, P0, fit.P1, fit.P2, P3);
				fit = FontRig._fitCubicConstrained(samples, params, P0, P3, T1, T2);
			}
		}
	} else {
		// Unconstrained for mixed line/curve
		fit = FontRig._fitCubicUnconstrained(samples, params, P0, P3);

		// Newton-Raphson refinement: 3 iterations
		for (var iter = 0; iter < 3; iter++) {
			params = FontRig._reparameterize(samples, params, P0, fit.P1, fit.P2, P3);
			fit = FontRig._fitCubicUnconstrained(samples, params, P0, P3);
		}
	}

	return [
		{ type: 'curve', x: fit.P1.x, y: fit.P1.y },
		{ type: 'curve', x: fit.P2.x, y: fit.P2.y }
	];
};

// Evaluate a cubic bezier at parameter t (de Casteljau)
FontRig._evalCubic = function(pts, t) {
	var u = 1 - t;
	var uu = u * u, tt = t * t;
	var uuu = uu * u, ttt = tt * t;
	return {
		x: uuu * pts[0].x + 3 * uu * t * pts[1].x + 3 * u * tt * pts[2].x + ttt * pts[3].x,
		y: uuu * pts[0].y + 3 * uu * t * pts[1].y + 3 * u * tt * pts[2].y + ttt * pts[3].y
	};
};

// Evaluate a line at parameter t
FontRig._evalLine = function(pts, t) {
	return {
		x: pts[0].x + t * (pts[1].x - pts[0].x),
		y: pts[0].y + t * (pts[1].y - pts[0].y)
	};
};

// Evaluate a quadratic bezier at parameter t
FontRig._evalQuadratic = function(pts, t) {
	var u = 1 - t;
	return {
		x: u * u * pts[0].x + 2 * u * t * pts[1].x + t * t * pts[2].x,
		y: u * u * pts[0].y + 2 * u * t * pts[1].y + t * t * pts[2].y
	};
};

// De Casteljau split: split cubic at t, returns { left, right }
// Each is an array of 4 points: [on, off, off, on]
FontRig._splitCubic = function(pts, t) {
	var p0 = pts[0], p1 = pts[1], p2 = pts[2], p3 = pts[3];
	var u = 1 - t;

	// Level 1
	var a = { x: u * p0.x + t * p1.x, y: u * p0.y + t * p1.y };
	var b = { x: u * p1.x + t * p2.x, y: u * p1.y + t * p2.y };
	var c = { x: u * p2.x + t * p3.x, y: u * p2.y + t * p3.y };

	// Level 2
	var d = { x: u * a.x + t * b.x, y: u * a.y + t * b.y };
	var e = { x: u * b.x + t * c.x, y: u * b.y + t * c.y };

	// Level 3 — point on curve
	var m = { x: u * d.x + t * e.x, y: u * d.y + t * e.y };

	return {
		left:  [p0, a, d, m],
		right: [m, e, c, p3]
	};
};
