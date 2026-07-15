// Filename mangler tests — _safeGlyphFilename from font.js.
// Mirrors UFO's userNameToFileName: uppercase letters get a trailing
// underscore, reserved device names get a leading underscore, disallowed
// path chars become '_', and collisions get a numeric suffix.
'use strict';

var test = require('node:test');
var assert = require('node:assert');
var loadFontRig = require('./helpers/load-fontrig').loadFontRig;

var F = loadFontRig();

function name(n, taken) {
	return F._safeGlyphFilename(n, taken || new Set());
}

test('lowercase name is unchanged', function() {
	assert.strictEqual(name('foo'), 'foo.trglyph');
});

test('uppercase letters get a trailing underscore', function() {
	assert.strictEqual(name('A'), 'A_.trglyph');
	assert.strictEqual(name('AE'), 'A_E_.trglyph');
	assert.strictEqual(name('Foo'), 'F_oo.trglyph');
});

test('reserved Windows device names get a leading underscore', function() {
	assert.strictEqual(name('con'), '_con.trglyph');
	assert.strictEqual(name('nul'), '_nul.trglyph');
	assert.strictEqual(name('com1'), '_com1.trglyph');
	assert.strictEqual(name('lpt9'), '_lpt9.trglyph');
});

test('disallowed path characters are replaced with underscore', function() {
	assert.strictEqual(name('a/b'), 'a_b.trglyph');
	assert.strictEqual(name('a:b'), 'a_b.trglyph');
	assert.strictEqual(name('a*b?'), 'a_b_.trglyph');
	assert.strictEqual(name('a<b>c'), 'a_b_c.trglyph');
});

test('empty / all-disallowed name falls back to underscore', function() {
	assert.strictEqual(name(''), '_.trglyph');
});

test('collisions get a zero-padded numeric suffix', function() {
	var taken = new Set();
	var first = name('foo', taken);
	var second = name('foo', taken);
	assert.strictEqual(first, 'foo.trglyph');
	assert.notStrictEqual(second, first);
	assert.match(second, /^foo0{14}1\.trglyph$/);
});

test('case-only differences collide on a case-insensitive filesystem', function() {
	var taken = new Set();
	// 'A_' and mangled variants — ensure the taken-set dedups case-insensitively.
	var a = name('foo', taken);
	var b = name('FOO', taken); // mangles to F_O_O_, distinct base, no collision
	assert.strictEqual(a, 'foo.trglyph');
	assert.strictEqual(b, 'F_O_O_.trglyph');
});
