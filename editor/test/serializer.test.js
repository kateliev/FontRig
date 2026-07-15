// Serializer tests — parse -> glyphToXml -> parse again -> deep-equal.
'use strict';

var test = require('node:test');
var assert = require('node:assert');
var loadFontRig = require('./helpers/load-fontrig').loadFontRig;
var sampleXml = require('./helpers/sample-xml').sampleXml;

var F = loadFontRig();

// Structural round-trip: the parsed object graph must survive a
// serialize+reparse unchanged. This is the core regression guard for
// the XML I/O layer.
test('round-trip: sample glyph parse -> xml -> parse is stable', function() {
	var g1 = F.parseGlyphXML(sampleXml());
	var xml = F.glyphToXml(g1);
	var g2 = F.parseGlyphXML(xml);
	assert.deepStrictEqual(g2, g1);
});

test('round-trip is idempotent on a second pass', function() {
	var g1 = F.parseGlyphXML(sampleXml());
	var xmlA = F.glyphToXml(g1);
	var xmlB = F.glyphToXml(F.parseGlyphXML(xmlA));
	assert.strictEqual(xmlB, xmlA);
});

test('esc escapes XML metacharacters', function() {
	assert.strictEqual(F.esc('a & b < c > "d"'), 'a &amp; b &lt; c &gt; &quot;d&quot;');
});

test('fmtFloat drops .0 and trailing zeros', function() {
	assert.strictEqual(F.fmtFloat(5), '5');
	assert.strictEqual(F.fmtFloat(5.0), '5');
	assert.strictEqual(F.fmtFloat(5.5), '5.5');
	assert.strictEqual(F.fmtFloat(5.500000), '5.5');
});

test('fmtTransform returns null for identity', function() {
	assert.strictEqual(F.fmtTransform([1, 0, 0, 1, 0, 0]), null);
	assert.strictEqual(F.fmtTransform([2, 0, 0, 2, 0, 0]), 'matrix(2 0 0 2 0 0)');
	assert.strictEqual(F.fmtTransform([1, 2, 3]), null);
});

test('names with special characters survive round-trip', function() {
	var xml = '<glyph name="a&amp;b" unicodes="[97]">' +
		'<layer name="L &lt;1&gt;" width="500" height="0">' +
		'<shape><contour closed="True">' +
		'<node type="on" x="0" y="0"/></contour></shape>' +
		'</layer></glyph>';
	var g1 = F.parseGlyphXML(xml);
	assert.strictEqual(g1.name, 'a&b');
	assert.strictEqual(g1.layers[0].name, 'L <1>');
	var g2 = F.parseGlyphXML(F.glyphToXml(g1));
	assert.deepStrictEqual(g2, g1);
});
