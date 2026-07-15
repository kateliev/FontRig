// Fingerprint tests — _layerFingerprint / _fingerprintsMatch from
// multi-layer-sync.js. Equal structures match; mutated ones don't.
'use strict';

var test = require('node:test');
var assert = require('node:assert');
var loadFontRig = require('./helpers/load-fontrig').loadFontRig;
var sampleXml = require('./helpers/sample-xml').sampleXml;

var F = loadFontRig();

function layer(types) {
	// Build a minimal layer with one contour whose node types are given.
	return {
		shapes: [{
			contours: [{
				nodes: types.map(function(t) { return { type: t }; }),
			}],
		}],
	};
}

test('_layerFingerprint encodes node types per contour', function() {
	var fp = F._layerFingerprint(layer(['on', 'curve', 'curve', 'on']));
	// Array.from re-homes the vm-realm array into this realm so
	// deepStrictEqual's prototype check passes; contents are strings.
	assert.deepStrictEqual(Array.from(fp), ['on,curve,curve,on']);
});

test('_layerFingerprint returns null for missing shapes', function() {
	assert.strictEqual(F._layerFingerprint(null), null);
	assert.strictEqual(F._layerFingerprint({}), null);
});

test('_fingerprintsMatch: identical structures match', function() {
	var a = F._layerFingerprint(layer(['on', 'curve', 'curve', 'on']));
	var b = F._layerFingerprint(layer(['on', 'curve', 'curve', 'on']));
	assert.strictEqual(F._fingerprintsMatch(a, b), true);
});

test('_fingerprintsMatch: different node type does not match', function() {
	var a = F._layerFingerprint(layer(['on', 'curve', 'curve', 'on']));
	var b = F._layerFingerprint(layer(['on', 'curve', 'on', 'on']));
	assert.strictEqual(F._fingerprintsMatch(a, b), false);
});

test('_fingerprintsMatch: different node count does not match', function() {
	var a = F._layerFingerprint(layer(['on', 'curve', 'on']));
	var b = F._layerFingerprint(layer(['on', 'curve', 'curve', 'on']));
	assert.strictEqual(F._fingerprintsMatch(a, b), false);
});

test('_fingerprintsMatch: null input is never a match', function() {
	var a = F._layerFingerprint(layer(['on']));
	assert.strictEqual(F._fingerprintsMatch(a, null), false);
	assert.strictEqual(F._fingerprintsMatch(null, a), false);
});

test('sample glyph masters are structurally compatible', function() {
	// Light and Bold in the sample are compatible masters (same contour
	// structure) — that is what makes interpolation valid.
	var g = F.parseGlyphXML(sampleXml());
	var a = F._layerFingerprint(g.layers[0]);
	var b = F._layerFingerprint(g.layers[1]);
	assert.strictEqual(F._fingerprintsMatch(a, b), true);
});
