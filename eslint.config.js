'use strict';

// Minimal, zero-plugin ESLint flat config for FontRig's vanilla-JS,
// no-build editor sources. Warnings-only baseline: CI should fail on
// ERRORS only, so this file reports (e.g. no-undef, no-control-regex)
// without blocking. Run: npx eslint editor/js
//
// The editor loads plain <script> files that all share one global
// `FontRig` object (declared const in editor/js/core/state.js). Browser
// globals + FontRig are declared below so no-undef stays useful.

const browserGlobals = {
	// Core
	window: 'readonly', document: 'readonly', navigator: 'readonly',
	console: 'readonly', globalThis: 'readonly', self: 'readonly',
	// Timers / animation
	setTimeout: 'readonly', clearTimeout: 'readonly',
	setInterval: 'readonly', clearInterval: 'readonly',
	requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
	queueMicrotask: 'readonly',
	// Networking / workers / storage
	fetch: 'readonly', XMLHttpRequest: 'readonly', WebSocket: 'readonly',
	Worker: 'readonly', BroadcastChannel: 'readonly',
	localStorage: 'readonly', sessionStorage: 'readonly',
	// DOM / platform APIs
	DOMParser: 'readonly', XMLSerializer: 'readonly',
	ResizeObserver: 'readonly', MutationObserver: 'readonly',
	IntersectionObserver: 'readonly', matchMedia: 'readonly',
	Image: 'readonly', Path2D: 'readonly', CanvasRenderingContext2D: 'readonly',
	FileReader: 'readonly', Blob: 'readonly', File: 'readonly', URL: 'readonly',
	TextEncoder: 'readonly', TextDecoder: 'readonly',
	structuredClone: 'readonly', alert: 'readonly', confirm: 'readonly',
	prompt: 'readonly', getComputedStyle: 'readonly',
	CustomEvent: 'readonly', Event: 'readonly', KeyboardEvent: 'readonly',
	MouseEvent: 'readonly', performance: 'readonly',
	HTMLElement: 'readonly', Node: 'readonly', NodeList: 'readonly',
	indexedDB: 'readonly', requestIdleCallback: 'readonly',
	cancelIdleCallback: 'readonly', FontFace: 'readonly',
	// Application globals (shared across all scripts)
	FontRig: 'writable', FRWidget: 'writable',
	// Third-party globals loaded via <script>
	loadPyodide: 'readonly',
};

module.exports = [
	{
		files: ['editor/js/**/*.js'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'script',
			globals: browserGlobals,
		},
		rules: {
			'no-undef': 'warn',
			'no-unused-vars': 'warn',
			'no-control-regex': 'warn',
		},
	},
	{
		// Node test harness runs under CommonJS with Node globals.
		files: ['editor/test/**/*.js'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'commonjs',
			globals: {
				require: 'readonly', module: 'writable', exports: 'writable',
				__dirname: 'readonly', __filename: 'readonly', process: 'readonly',
				console: 'readonly', structuredClone: 'readonly',
				setTimeout: 'readonly', clearTimeout: 'readonly',
				setInterval: 'readonly', clearInterval: 'readonly',
			},
		},
		rules: {
			'no-undef': 'warn',
			'no-unused-vars': 'warn',
		},
	},
];
