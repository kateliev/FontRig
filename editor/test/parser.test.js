// Parser tests — parse the built-in sample glyph and assert structure.
'use strict';

var test = require('node:test');
var assert = require('node:assert');
var loadFontRig = require('./helpers/load-fontrig').loadFontRig;
var sampleXml = require('./helpers/sample-xml').sampleXml;

var F = loadFontRig();

test('parseGlyphXML: glyph-level attributes', function() {
	var g = F.parseGlyphXML(sampleXml());
	assert.strictEqual(g.name, 'a');
	assert.strictEqual(g.unicodes, '[97]');
	assert.strictEqual(g.mark, '0');
	assert.strictEqual(g.selected, false);
});

test('parseGlyphXML: sample has two layers (Light, Bold)', function() {
	var g = F.parseGlyphXML(sampleXml());
	assert.strictEqual(g.layers.length, 2);
	assert.strictEqual(g.layers[0].name, 'Light');
	assert.strictEqual(g.layers[1].name, 'Bold');
	assert.strictEqual(g.layers[0].width, 534);
	assert.strictEqual(g.layers[1].width, 624);
});

test('parseGlyphXML: nodes carry x/y/type/smooth', function() {
	var g = F.parseGlyphXML(sampleXml());
	var contour = g.layers[0].shapes[0].contours[0];
	assert.ok(contour.nodes.length > 0, 'contour should have nodes');
	var n0 = contour.nodes[0];
	assert.strictEqual(typeof n0.x, 'number');
	assert.strictEqual(typeof n0.y, 'number');
	assert.ok(['on', 'curve', 'qcurve'].indexOf(n0.type) !== -1, 'valid node type');
	assert.strictEqual(typeof n0.smooth, 'boolean');
	// Sample's first node is an on-curve smooth node at (57,130).
	assert.strictEqual(n0.type, 'on');
	assert.strictEqual(n0.smooth, true);
	assert.strictEqual(n0.x, 57);
	assert.strictEqual(n0.y, 130);
});

test('parseGlyphXML: closed attribute round-trips to boolean', function() {
	var g = F.parseGlyphXML(sampleXml());
	var contour = g.layers[0].shapes[0].contours[0];
	assert.strictEqual(contour.closed, true);
});

test('parseTransformAttr: valid and invalid matrices', function() {
	assert.deepStrictEqual(Array.from(F.parseTransformAttr('matrix(1 0 0 1 0 0)')), [1, 0, 0, 1, 0, 0]);
	assert.deepStrictEqual(Array.from(F.parseTransformAttr('matrix(2 0 0 2 10 -5)')), [2, 0, 0, 2, 10, -5]);
	assert.strictEqual(F.parseTransformAttr(''), null);
	assert.strictEqual(F.parseTransformAttr('translate(1,2)'), null);
	assert.strictEqual(F.parseTransformAttr('matrix(1 2 3)'), null);
});
