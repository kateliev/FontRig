// Curve-fit tests — pure math moved to geometry/curve-fit.js (M7).
// _evalCubic endpoints, _splitCubic continuity, _sampleCubic.
'use strict';

var test = require('node:test');
var assert = require('node:assert');
var loadFontRig = require('./helpers/load-fontrig').loadFontRig;

var F = loadFontRig([
	'core/state.js',
	'geometry/geometry.js',
	'geometry/curve-fit.js',
]);

var pts = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }];

test('_evalCubic hits the endpoints at t=0 and t=1', function() {
	assert.deepStrictEqual(Object.assign({}, F._evalCubic(pts, 0)), { x: 0, y: 0 });
	assert.deepStrictEqual(Object.assign({}, F._evalCubic(pts, 1)), { x: 100, y: 0 });
});

test('_evalCubic midpoint matches the Bernstein formula', function() {
	// At t=0.5: 0.125*P0 + 0.375*P1 + 0.375*P2 + 0.125*P3
	var m = F._evalCubic(pts, 0.5);
	assert.ok(Math.abs(m.x - 50) < 1e-9, 'x symmetric = 50, got ' + m.x);
	assert.ok(Math.abs(m.y - 75) < 1e-9, 'y = 75, got ' + m.y);
});

test('_splitCubic preserves the curve (C0 continuity at the split)', function() {
	var t = 0.37;
	var parts = F._splitCubic(pts, t);
	// _splitCubic returns the two half-segments; the split point must be
	// the same as evaluating the original curve at t, and the halves must
	// join there.
	var atT = F._evalCubic(pts, t);
	// Find the shared join point across the returned structure.
	var flat = JSON.stringify(parts);
	assert.ok(flat.indexOf('x') !== -1, 'returns point data');
	// The first sub-curve starts at P0, the second ends at P3.
	var left = parts.left || parts[0];
	var right = parts.right || parts[1];
	assert.ok(left && right, 'two halves returned');
	var lastLeft = left[left.length - 1];
	var firstRight = right[0];
	assert.ok(Math.abs(lastLeft.x - firstRight.x) < 1e-6 &&
		Math.abs(lastLeft.y - firstRight.y) < 1e-6, 'halves share the split point');
	assert.ok(Math.abs(lastLeft.x - atT.x) < 1e-6 &&
		Math.abs(lastLeft.y - atT.y) < 1e-6, 'split point equals evalCubic(t)');
});

test('_sampleCubic returns points on the curve', function() {
	var p = F._sampleCubic(pts[0], pts[1], pts[2], pts[3], 0.5);
	assert.ok(Math.abs(p.x - 50) < 1e-9 && Math.abs(p.y - 75) < 1e-9);
});
