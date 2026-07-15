// ===================================================================
// FontRig test harness — source loader
// ===================================================================
// Loads the plain-<script> FontRig source files into a single vm
// context so their pure logic can be exercised under `node --test`
// with no build step and no npm dependencies (audit task M8).
//
// The app files attach everything to a global `FontRig` object. In the
// browser that object is a top-level `const` shared across scripts; in
// a vm context each runInContext call has its own lexical scope, so we
// rewrite state.js's `const FontRig =` to a global assignment and let
// every later file resolve `FontRig` through the shared sandbox global.
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var xmlDom = require('./xml-dom');

var JS_ROOT = path.join(__dirname, '..', '..', 'js');

// Files that are safe to load headless (pure logic + top-level guards
// that tolerate the DOM stub below). Order matters — dependencies first.
var DEFAULT_FILES = [
	'core/state.js',
	'geometry/geometry.js',
	'data/parser.js',
	'data/serializer.js',
	'data/font.js',
	'interaction/multi-layer-sync.js',
];

function makeSandbox() {
	var noop = function() {};
	var elementStub = {
		style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: function() { return false; } },
		addEventListener: noop, removeEventListener: noop, appendChild: noop,
		setAttribute: noop, getAttribute: function() { return null; },
		getContext: function() { return null; }, querySelector: function() { return null; },
		querySelectorAll: function() { return []; },
	};
	var documentStub = {
		getElementById: function() { return null; },
		querySelector: function() { return null; },
		querySelectorAll: function() { return []; },
		createElement: function() { return Object.assign({}, elementStub); },
		addEventListener: noop, removeEventListener: noop,
		body: elementStub, documentElement: elementStub,
	};
	var sandbox = {
		console: console,
		DOMParser: xmlDom.DOMParser,
		document: documentStub,
		requestAnimationFrame: function(fn) { return setTimeout(fn, 0); },
		cancelAnimationFrame: function(id) { clearTimeout(id); },
		setTimeout: setTimeout, clearTimeout: clearTimeout,
		setInterval: setInterval, clearInterval: clearInterval,
		structuredClone: (typeof structuredClone === 'function') ? structuredClone : undefined,
		matchMedia: function() { return { matches: false, addListener: noop, addEventListener: noop }; },
		addEventListener: noop,
		removeEventListener: noop,
	};
	sandbox.window = sandbox;
	sandbox.globalThis = sandbox;
	sandbox.self = sandbox;
	return sandbox;
}

// Load the requested source files and return the populated FontRig.
function loadFontRig(files) {
	files = files || DEFAULT_FILES;
	var sandbox = makeSandbox();
	vm.createContext(sandbox);

	for (var i = 0; i < files.length; i++) {
		var file = files[i];
		var full = path.join(JS_ROOT, file);
		var src = fs.readFileSync(full, 'utf8');
		if (file === 'core/state.js') {
			// Promote the top-level const to a sandbox global so later
			// files (run in their own vm scopes) can see it.
			src = src.replace('const FontRig = {', 'globalThis.FontRig = {');
		}
		try {
			vm.runInContext(src, sandbox, { filename: file });
		} catch (e) {
			throw new Error('Failed loading ' + file + ': ' + e.stack);
		}
	}
	return sandbox.FontRig;
}

module.exports = { loadFontRig: loadFontRig, DEFAULT_FILES: DEFAULT_FILES };
