// ===================================================================
// FontRig — Input Bindings
// ===================================================================
// All keyboard shortcuts, mouse actions, and toolbar button bindings
// in one place. Events.js wires DOM listeners that dispatch here.
// ===================================================================
'use strict';

// -- Zoom factors ---------------------------------------------------
FontRig.ZOOM_IN_FACTOR  = 1.15;
FontRig.ZOOM_OUT_FACTOR = 1 / 1.15;
FontRig.WHEEL_ZOOM_IN   = 1.1;
FontRig.WHEEL_ZOOM_OUT  = 0.9;

// -- Actions --------------------------------------------------------
// Named functions that keyboard/mouse/toolbar bindings reference.
// Each receives an optional event context object { e, sx, sy }.
FontRig.actions = {
	// -- File ---
	openFile: function() {
		FontRig.dom.fileInput.click();
	},

	openFont: function() {
		FontRig.openFont();
	},

	saveFile: function() {
		if (FontRig.font) {
			FontRig.saveDirtyGlyphs();
		} else {
			FontRig.saveXml();
		}
	},

	// -- Undo / Redo ---
	undo: function() {
		FontRig.undo();
	},

	redo: function() {
		FontRig.redo();
	},

	// -- View ---
	fitToView: function() {
		FontRig.fitToView();
	},

	zoomIn: function() {
		FontRig.zoomAtCenter(FontRig.ZOOM_IN_FACTOR);
	},

	zoomOut: function() {
		FontRig.zoomAtCenter(FontRig.ZOOM_OUT_FACTOR);
	},

	// -- Selection ---
	selectAll: function() {
		var layer = FontRig.getActiveLayer();
		if (!layer) return;
		var allNodes = FontRig.getAllNodes(layer);
		FontRig.state.selectedNodeIds.clear();
		for (var i = 0; i < allNodes.length; i++) {
			FontRig.state.selectedNodeIds.add(allNodes[i].id);
		}
		FontRig.draw();
		FontRig.updateStatusSelected();
	},

	clearSelection: function() {
		FontRig.clearSelection();
	},

	// -- Contour walk (PageUp / PageDown) ---
	walkNext: function() {
		FontRig.walkContour(1);
	},

	walkPrev: function() {
		FontRig.walkContour(-1);
	},

	// -- Glyph navigation (Ctrl+PageDown / Ctrl+PageUp) ---
	nextGlyph: function() {
		FontRig.stepGlyph(1);
	},

	prevGlyph: function() {
		FontRig.stepGlyph(-1);
	},

	// -- Layer cycling (Alt+. / Alt+,) ---
	nextLayer: function() {
		FontRig.cycleLayer(1);
	},

	prevLayer: function() {
		FontRig.cycleLayer(-1);
	},

	// -- Node movement (arrow keys) ---
	// All movement reads base step from FontRig.movementPrefs.
	// Shift = x10, Ctrl/Cmd = x100 multiplier on the base step.
	// When S or A is held, slides along curves or lines instead.
	moveUp: function(ctx) {
		var mult = 1;
		if (ctx.e.shiftKey) mult = 10;
		if (ctx.e.ctrlKey || ctx.e.metaKey) mult = 100;
		FontRig.pushUndoNudge();
		if (FontRig._tryKeyboardSlide(0, 1, mult)) return;
		FontRig.sync_moveSelectedNodes(0, 1, mult);
	},

	moveDown: function(ctx) {
		var mult = 1;
		if (ctx.e.shiftKey) mult = 10;
		if (ctx.e.ctrlKey || ctx.e.metaKey) mult = 100;
		FontRig.pushUndoNudge();
		if (FontRig._tryKeyboardSlide(0, -1, mult)) return;
		FontRig.sync_moveSelectedNodes(0, -1, mult);
	},

	moveRight: function(ctx) {
		var mult = 1;
		if (ctx.e.shiftKey) mult = 10;
		if (ctx.e.ctrlKey || ctx.e.metaKey) mult = 100;
		FontRig.pushUndoNudge();
		if (FontRig._tryKeyboardSlide(1, 0, mult)) return;
		FontRig.sync_moveSelectedNodes(1, 0, mult);
	},

	moveLeft: function(ctx) {
		var mult = 1;
		if (ctx.e.shiftKey) mult = 10;
		if (ctx.e.ctrlKey || ctx.e.metaKey) mult = 100;
		FontRig.pushUndoNudge();
		if (FontRig._tryKeyboardSlide(-1, 0, mult)) return;
		FontRig.sync_moveSelectedNodes(-1, 0, mult);
	},

	// -- Node operations ---
	openContour: function() {
		FontRig.pushUndo();
		FontRig.sync_openContourAtNode();
	},

	deleteNode: function() {
		FontRig.pushUndo();
		FontRig.sync_deleteNode();
	},

	retractHandles: function() {
		FontRig.pushUndo();
		FontRig.sync_retractHandles();
	},

	joinContour: function() {
		FontRig.pushUndo();
		FontRig.tryJoinEndpoints();
	},

	// -- Preview ---
	togglePreview: function() {
		FontRig.state.previewLocked = !FontRig.state.previewLocked;
		FontRig.state.previewMode = FontRig.state.previewLocked;
		FontRig.updatePreviewButton();
		FontRig.draw();
	},

	// -- GUI Mode ---
	setGuiMode: function(mode) {
		var body = document.body;
		var darkBtn = document.getElementById('btn-gui-mode-dark');
		var lightBtn = document.getElementById('btn-gui-mode-light');
		
		if (mode === 'light') {
			body.setAttribute('data-theme', 'light');
			darkBtn.classList.remove('active');
			lightBtn.classList.add('active');
		} else {
			body.removeAttribute('data-theme');
			darkBtn.classList.add('active');
			lightBtn.classList.remove('active');
		}
		
		FontRig.draw();
	},

	setGuiModeDark: function() {
		FontRig.actions.setGuiMode('dark');
	},

	setGuiModeLight: function() {
		FontRig.actions.setGuiMode('light');
	},

	// -- XML panel ---
	toggleXml: function() {
		document.getElementById('btn-panel').click();
	},

	xmlRefresh: function() {
		FontRig.xmlRefresh();
	},

	xmlApply: function() {
		FontRig.pushUndo();
		FontRig.xmlApply();
	},
};

// -- Keyboard map ---------------------------------------------------
// Each entry: { key, ctrl, shift, alt, action, hasSelection, desc }
//   key:          KeyboardEvent.key value
//   ctrl:         requires Ctrl/Cmd (default: false)
//   hasSelection: only fires when nodes are selected (default: false)
//   action:       key into FontRig.actions
//   desc:         human-readable description
FontRig.keyMap = [
	// Undo / Redo
	{ key: 'z',         ctrl: true,  action: 'undo',           desc: 'Undo' },
	{ key: 'Z',         ctrl: true,  action: 'redo',           desc: 'Redo' },

	// File
	{ key: 'o',         ctrl: true,  action: 'openFile',       desc: 'Open file' },
	{ key: 'O',         ctrl: true,  action: 'openFont',      desc: 'Open .trfont folder' },
	{ key: 's',         ctrl: true,  action: 'saveFile',       desc: 'Save file' },
	{ key: 'e',         ctrl: true,  action: 'toggleXml',      desc: 'Toggle XML panel' },
	{ key: 'a',         ctrl: true,  action: 'selectAll',      desc: 'Select all nodes' },

	// View
	{ key: 'Home',                   action: 'fitToView',      desc: 'Fit to view' },
	{ key: 'z',                      action: 'zoomIn',         desc: 'Zoom in' },
	{ key: 'x',                      action: 'zoomOut',        desc: 'Zoom out' },

	// Selection
	{ key: 'Escape',                 action: 'clearSelection', desc: 'Clear selection' },

	// Contour walk
	{ key: 'PageDown',               action: 'walkNext',       desc: 'Next node in contour' },
	{ key: 'PageUp',                 action: 'walkPrev',       desc: 'Previous node in contour' },
	{ key: ']',  		ctrl: true,  action: 'nextGlyph',     desc: 'Next glyph' },
	{ key: '[',   		ctrl: true,  action: 'prevGlyph',     desc: 'Previous glyph' },
	{ code: 'Period',   alt: true,   action: 'nextLayer',     desc: 'Next layer' },
	{ code: 'Comma',    alt: true,   action: 'prevLayer',     desc: 'Previous layer' },

	// Node movement (only when nodes selected)
	{ key: 'ArrowUp',    hasSelection: true, action: 'moveUp',    desc: 'Move selected up' },
	{ key: 'ArrowDown',  hasSelection: true, action: 'moveDown',  desc: 'Move selected down' },
	{ key: 'ArrowRight', hasSelection: true, action: 'moveRight', desc: 'Move selected right' },
	{ key: 'ArrowLeft',  hasSelection: true, action: 'moveLeft',  desc: 'Move selected left' },

	// Node operations
	{ key: 'Delete',     hasSelection: true, action: 'openContour',  desc: 'Open/split contour at node' },
	{ key: 'Backspace',  hasSelection: true, action: 'deleteNode',   desc: 'Delete node' },
	{ key: 'Shift+Delete', hasSelection: true, action: 'retractHandles', desc: 'Retract handles' },
	{ key: 'j',          hasSelection: true, action: 'joinContour',  desc: 'Join/close contour at endpoint' },
];

// -- Keyboard dispatch ----------------------------------------------
// Called from events.js keydown handler. Returns true if handled.
FontRig.dispatchKey = function(e) {
	var isCtrl = e.ctrlKey || e.metaKey;
	var isAlt = e.altKey;
	var isTyping = (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT');

	for (var i = 0; i < FontRig.keyMap.length; i++) {
		var b = FontRig.keyMap[i];

		// Match key (code takes priority for layout independence with modifiers)
		if (b.code) {
			if (e.code !== b.code) continue;
		} else {
			if (e.key !== b.key) continue;
		}

		// Match modifier requirements
		if (b.ctrl && !isCtrl) continue;
		if (!b.ctrl && isCtrl) continue;
		if (b.alt && !isAlt) continue;
		if (!b.alt && isAlt) continue;

		// Skip if requires selection but none active
		if (b.hasSelection && FontRig.state.selectedNodeIds.size === 0) continue;

		// Skip plain keys when typing in any text field
		if (isTyping && !b.ctrl && !b.alt) continue;

		e.preventDefault();
		var action = FontRig.actions[b.action];
		if (action) action({ e: e });
		return true;
	}

	return false;
};

// -- Mouse action map -----------------------------------------------
// Descriptive reference; actual wiring in events.js.
//
//   Click         - select/deselect node
//   Shift+click   - additive node selection
//   Double-click  - select all nodes on clicked contour
//   Drag node     - move selected nodes
//   Shift+drag    - constrain to axis
//   Drag empty    - rectangle selection
//   Alt+drag      - lasso selection
//   Spacebar+drag - pan canvas
//   Scroll wheel  - zoom in/out
//   Ctrl+scroll   - rotate grid column (multi-view)
//   Alt+scroll    - rotate grid row (multi-view)

// -- Toolbar button map ---------------------------------------------
// { id, toggle, stateKey, action, desc }
// Buttons with toggle:true flip a state boolean and toggle .active class.
// Buttons with action call FontRig.actions[action].
FontRig.toolbarMap = [
	{ id: 'btn-load',    action: 'openFile',  desc: 'Load .trglyph file' },
	{ id: 'btn-open-font', action: 'openFont', desc: 'Open .trfont folder' },
	{ id: 'btn-save',    action: 'saveFile',  desc: 'Save .trglyph file' },
	{ id: 'btn-fit',     action: 'fitToView', desc: 'Fit glyph to view' },

	// Toggle buttons
	{ id: 'btn-nodes',   toggle: true, stateKey: 'showNodes',   desc: 'Toggle nodes' },
	{ id: 'btn-metrics', toggle: true, stateKey: 'showMetrics', desc: 'Toggle metrics' },
	{ id: 'btn-anchors', toggle: true, stateKey: 'showAnchors', desc: 'Toggle anchors' },
	{ id: 'btn-mask',    toggle: true, stateKey: 'showMask',    desc: 'Toggle mask' },

	{ id: 'btn-preview', action: 'togglePreview', desc: 'Toggle BW preview' },
	{ id: 'btn-stem',    toggle: true, stateKey: 'showStem',    desc: 'Toggle stem measurement' },

	// GUI mode (exclusive pair - handled specially)
	{ id: 'btn-gui-mode-dark',  action: 'setGuiModeDark',  desc: 'Dark mode' },
	{ id: 'btn-gui-mode-light', action: 'setGuiModeLight', desc: 'Light mode' },

	// Fill/outline are exclusive pair - handled specially in events.js
	// View mode buttons (1x1, 2x1, 2x2) - handled specially in events.js
	// Join button - handled specially in events.js
	// XML button - has panel logic, handled specially in events.js
];

// -- Toolbar dispatch -----------------------------------------------
// Wire simple toolbar buttons. Call once during init.
FontRig.wireToolbar = function() {
	for (var i = 0; i < FontRig.toolbarMap.length; i++) {
		(function(entry) {
			var el = document.getElementById(entry.id);
			if (!el) return;

			el.addEventListener('click', function() {
				if (entry.toggle) {
					FontRig.state[entry.stateKey] = !FontRig.state[entry.stateKey];
					this.classList.toggle('active');
					FontRig.draw();
				} else if (entry.action) {
					FontRig.actions[entry.action]();
				}
			});
		})(FontRig.toolbarMap[i]);
	}
};
