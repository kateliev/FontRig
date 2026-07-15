// ===================================================================
// FontRig — Event Handlers
// ===================================================================
// DOM event wiring. Key/toolbar bindings defined in bindings.js.
// ===================================================================
'use strict';

(function() {

const state = FontRig.state;
const dom = FontRig.dom;

// -- Coordinate helpers moved to FontRig._* in stream-handlers.js ---

// ===================================================================
// Mouse: stream-based interaction via MouseTracker
// ===================================================================
// All mouse interactions (drag, select, pan) are now handled as async
// functions consuming EventStreams. See stream-handlers.js for the
// individual interaction implementations.
//
// The MouseTracker creates an EventStream on mousedown and routes
// mousemove/mouseup events into it. The dispatch function
// (handleCanvasDrag) does hit testing and delegates to the appropriate
// async handler. Hover events go to handleCanvasHover.
// ===================================================================

FontRig._mouseTracker = new FontRig.MouseTracker({
	element: dom.canvasWrap,
	drag: function(stream, initialEvent) {
		return FontRig.handleCanvasDrag(stream, initialEvent);
	},
	hover: function(event) {
		FontRig.handleCanvasHover(event);
	}
});

// ===================================================================
// Double-click: select all nodes on clicked contour
// ===================================================================
dom.canvasWrap.addEventListener('dblclick', function(e) {
	const rect = dom.canvas.getBoundingClientRect();
	const absSx = e.clientX - rect.left;
	const absSy = e.clientY - rect.top;
	const coords = FontRig._interactionCoords(absSx, absSy);
	const sx = coords.sx, sy = coords.sy;

	// Transform frame: double-click cycles mode
	if (FontRig.tf.active) {
		var tfHandled = false;
		FontRig._withActiveOffset(function() {
			tfHandled = FontRig.tfDblClick(sx, sy);
		});
		if (tfHandled) {
			FontRig.draw();
			return;
		}
	}

	// Double-click on a node: select whole contour (existing behavior)
	var nodeHit = null;
	FontRig._withActiveOffset(function() {
		nodeHit = FontRig.hitTestNode(sx, sy);
	});

	if (nodeHit) {
		var ci = -1;
		FontRig._withActiveOffset(function() {
			ci = FontRig.hitTestContour(sx, sy);
		});
		if (ci >= 0) {
			var ids = FontRig.getContourNodeIds(ci);
			FontRig.selectNodes(ids, e.shiftKey);
		}
		return;
	}

	// Double-click on a segment: select that segment's nodes
	var segHit = null;
	FontRig._withActiveOffset(function() {
		segHit = FontRig.hitTestSegment(sx, sy);
	});

	if (segHit) {
		var seg = segHit.seg;
		var ci = segHit.ci;
		var ids = ['c' + ci + '_n' + seg.startIdx, 'c' + ci + '_n' + seg.endIdx];
		if (seg.type === 'cubic') {
			ids.push('c' + ci + '_n' + seg.offIdx1);
			ids.push('c' + ci + '_n' + seg.offIdx2);
		} else if (seg.type === 'quadratic') {
			ids.push('c' + ci + '_n' + seg.offIdx);
		}
		FontRig.selectNodes(ids, e.shiftKey);
		return;
	}

	// Fallback: try contour hit
	var ci = -1;
	FontRig._withActiveOffset(function() {
		ci = FontRig.hitTestContour(sx, sy);
	});
	if (ci >= 0) {
		var ids = FontRig.getContourNodeIds(ci);
		FontRig.selectNodes(ids, e.shiftKey);
	}
});

// ===================================================================
// Scroll wheel: zoom / ribbon rotation
// ===================================================================
dom.canvasWrap.addEventListener('wheel', function(e) {
	e.preventDefault();

	const rect = dom.canvas.getBoundingClientRect();
	const absSx = e.clientX - rect.left;
	const absSy = e.clientY - rect.top;

	// Alt-wheel over a hobby knot: per-knot tension. Down = looser
	// (handles longer, curve laxer), Up = tighter. Shift narrows
	// the change to alpha (out-tension); Ctrl narrows to beta.
	if (e.altKey && typeof FontRig.hitTestNode === 'function') {
		var coords = FontRig._interactionCoords(absSx, absSy);
		var hit = null;
		FontRig._withActiveOffset(function() {
			hit = FontRig.hitTestNode(coords.sx, coords.sy);
		});
		if (hit && typeof FontRig._resolveKnotByNodeId === 'function'
			&& FontRig._resolveKnotByNodeId(hit.id)) {
			var step = 1.10;
			var factorT = e.deltaY > 0 ? (1 / step) : step;
			FontRig.pushUndo();
			FontRig.adjustKnotTension(hit.id, factorT, {
				alphaOnly: e.shiftKey,
				betaOnly:  e.ctrlKey,
			});
			return;
		}
	}

	// Normal zoom (centred on cursor)
	const { sx: mx, sy: my } = FontRig._interactionCoords(absSx, absSy);
	const factor = e.deltaY > 0 ? FontRig.WHEEL_ZOOM_OUT : FontRig.WHEEL_ZOOM_IN;
	const newZoom = state.zoom * factor;

	state.pan.x = mx - (mx - state.pan.x) * (newZoom / state.zoom);
	state.pan.y = my - (my - state.pan.y) * (newZoom / state.zoom);
	state.zoom = newZoom;

	FontRig.updateZoomStatus();
	FontRig.requestDraw();
}, { passive: false });

// ===================================================================
// Resize
// ===================================================================
const resizeObserver = new ResizeObserver(function() { FontRig.draw(); });
resizeObserver.observe(dom.canvasWrap);

// devicePixelRatio changes (browser zoom, moving between monitors) don't
// always resize canvasWrap's content box, so the ResizeObserver may miss
// them. draw() re-checks dpr and reallocates only when it differs, so we
// just need to trigger a redraw. matchMedia fires once per dpr change;
// re-arm it each time since the query threshold moves with the ratio.
(function watchDpr() {
	if (typeof window.matchMedia !== 'function') return;
	function arm() {
		var mq = window.matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
		var handler = function() {
			mq.removeEventListener ? mq.removeEventListener('change', handler)
				: mq.removeListener(handler);
			FontRig.draw();
			arm();
		};
		mq.addEventListener ? mq.addEventListener('change', handler)
			: mq.addListener(handler);
	}
	arm();
})();

// ===================================================================
// Toolbar: special buttons (exclusive pairs, panels, view modes)
// Simple toggle/action buttons are wired via FontRig.wireToolbar().
// ===================================================================

// Fill / Outline (exclusive pair)
document.getElementById('btn-filled').addEventListener('click', function() {
	state.filled = true;
	this.classList.add('active');
	document.getElementById('btn-outline').classList.remove('active');
	FontRig.draw();
});

document.getElementById('btn-outline').addEventListener('click', function() {
	state.filled = false;
	this.classList.add('active');
	document.getElementById('btn-filled').classList.remove('active');
	FontRig.draw();
});

// XML/Python panel (right sidebar toggle)
document.getElementById('btn-panel').addEventListener('click', function(e) {
	this.classList.toggle('active');
	FontRig._toggleRightSidebar();
});

// Font panel button — toggles left sidebar
document.getElementById('btn-font-panel').addEventListener('click', function(e) {
	// Toggle left sidebar visibility
	if (FontRig._leftSidebar) {
		FontRig.Sidebar.toggle(FontRig._leftSidebar);
		// Mirror sidebar visibility to button active state
		var isVisible = FontRig._leftSidebar.el && FontRig._leftSidebar.el.classList.contains('visible');
		this.classList.toggle('active', isVisible);
	}
});

// Workplane button — opens a new workplane window
document.getElementById('btn-workplane').addEventListener('click', function() {
	if (FontRig.Workplane) {
		FontRig.Workplane.open();
	}
});

// -- View mode buttons (1x1, 2x1, 2x2) -----------------------------
function setViewMode(cols, rows) {
	const btn1x1 = document.getElementById('btn-view-1x1');
	const btn2x1 = document.getElementById('btn-view-2x1');
	const btn2x2 = document.getElementById('btn-view-2x2');

	btn1x1.classList.remove('active');
	btn2x1.classList.remove('active');
	btn2x2.classList.remove('active');

	state.gridCols = cols;
	state.gridRows = rows;

	if (state.glyphViewMode) {
		// Strip mode: grid size controls active glyph expansion
		state.multiView = (cols > 1 || rows > 1);
		state.activeCell = { row: 0, col: 0 };
		// Force gridLayers rebuild on next draw
		state.gridLayers = null;
	} else if (cols === 1 && rows === 1) {
		state.multiView = false;
		state.gridLayers = null;
	} else {
		state.multiView = true;
		FontRig.initMultiGrid();
	}

	if (cols === 1 && rows === 1) btn1x1.classList.add('active');
	if (cols === 2 && rows === 1) btn2x1.classList.add('active');
	if (cols === 2 && rows === 2) btn2x2.classList.add('active');

	FontRig.fitToView();
}

document.getElementById('btn-view-1x1').addEventListener('click', function() { setViewMode(1, 1); });
document.getElementById('btn-view-2x1').addEventListener('click', function() { setViewMode(2, 1); });
document.getElementById('btn-view-2x2').addEventListener('click', function() { setViewMode(2, 2); });

// -- Join toggle (split vs joined canvas) ---------------------------
document.getElementById('btn-join').addEventListener('click', function() {
	// If glyph mode is active, clicking Join exits glyph mode
	if (state.glyphViewMode) {
		state.glyphViewMode = false;
		document.getElementById('btn-glyph-view').classList.remove('active');
		FontRig.updateGlyphPanelActive();
	}

	state.joinedView = !state.joinedView;
	this.classList.toggle('active', state.joinedView);

	// Auto-enable multi-view if not active
	if (state.joinedView && !state.multiView) {
		setViewMode(2, 1);
	}

	FontRig.fitToView();
});

// -- Glyph view toggle (glyph strip on shared baseline) -------------
document.getElementById('btn-glyph-view').addEventListener('click', function() {
	if (!FontRig.font) return;

	state.glyphViewMode = !state.glyphViewMode;
	this.classList.toggle('active', state.glyphViewMode);

	if (state.glyphViewMode) {
		// Enter strip mode with 1x1 (no layer expansion)
		state.gridCols = 1;
		state.gridRows = 1;
		state.multiView = false;
		state.gridLayers = null;
		state.activeCell = { row: 0, col: 0 };

		// Update view buttons
		document.getElementById('btn-view-1x1').classList.add('active');
		document.getElementById('btn-view-2x1').classList.remove('active');
		document.getElementById('btn-view-2x2').classList.remove('active');

		FontRig.updateWorkspaceStrip();
		FontRig.fitGlyphStrip();
	} else {
		// Exit strip mode
		state.gridLayers = null;
		FontRig.fitToView();
	}

	FontRig.updateGlyphPanelActive();
	FontRig.draw();
});

// -- Layer dropdown -------------------------------------------------
dom.layerSelect.addEventListener('change', function() {
	state.activeLayer = this.value;
	state.selectedNodeIds.clear();

	// In multi-view or expanded strip, update the active cell's gridLayers
	if (state.gridLayers && state.glyphData) {
		if (!FontRig.isMaskLayer(this.value)) {
			var layers = state.glyphData.layers;
			var idx = -1;
			for (var i = 0; i < layers.length; i++) {
				if (layers[i].name === this.value) { idx = i; break; }
			}
			if (idx >= 0) {
				var r = state.activeCell.row;
				var c = state.activeCell.col;
				if (state.gridLayers[r] && state.gridLayers[r][c] !== undefined) {
					state.gridLayers[r][c] = idx;
				}
			}
		}
	}

	FontRig.draw();
	FontRig.buildXmlPanel();
	FontRig.updateLayerPanel();
	FontRig._notifyLayerChange(state.activeLayer);
});

// ===================================================================
// ===================================================================
// Toolbar dropdown menus
// ===================================================================
(function() {
	var dropdowns = document.querySelectorAll('.tb-dropdown');

	// Toggle dropdown on trigger click
	for (var i = 0; i < dropdowns.length; i++) {
		(function(dd) {
			var trigger = dd.querySelector('.tb-dropdown-trigger');
			if (!trigger) return;

			trigger.addEventListener('click', function(e) {
				e.stopPropagation();
				var wasOpen = dd.classList.contains('open');

				// Close all dropdowns first
				for (var j = 0; j < dropdowns.length; j++) {
					dropdowns[j].classList.remove('open');
				}

				if (!wasOpen) dd.classList.add('open');
			});
		})(dropdowns[i]);
	}

	// Close on click outside
	window.addEventListener('mousedown', function(e) {
		if (!e.target.closest('.tb-dropdown')) {
			for (var i = 0; i < dropdowns.length; i++) {
				dropdowns[i].classList.remove('open');
			}
		}
	});

	// Close after clicking a menu item (except toggles in View menu)
	var menuItems = document.querySelectorAll('.tb-menu-item');
	for (var i = 0; i < menuItems.length; i++) {
		menuItems[i].addEventListener('click', function(e) {
			// View menu toggle items stay open
			var parent = this.closest('.tb-dropdown');
			var trigger = parent ? parent.querySelector('.tb-dropdown-trigger') : null;
			if (trigger && trigger.id === 'menu-view') return; // keep open

			for (var j = 0; j < dropdowns.length; j++) {
				dropdowns[j].classList.remove('open');
			}
		});
	}
})();

// ===================================================================
// File input / Drag and drop
// ===================================================================
dom.fileInput.addEventListener('change', function(e) {
	const file = e.target.files[0];
	if (!file) return;
	const reader = new FileReader();
	reader.onload = function(ev) { FontRig.loadXmlString(ev.target.result, file.name); };
	reader.readAsText(file);
	dom.fileInput.value = '';
});

document.addEventListener('dragover', function(e) {
	if (FontRig._internalDrag) return;
	e.preventDefault();
	dom.dropOverlay.classList.add('visible');
});

document.addEventListener('dragleave', function(e) {
	if (FontRig._internalDrag) return;
	if (e.relatedTarget === null || !document.contains(e.relatedTarget)) {
		dom.dropOverlay.classList.remove('visible');
	}
});

document.addEventListener('drop', function(e) {
	if (FontRig._internalDrag) return;
	e.preventDefault();
	dom.dropOverlay.classList.remove('visible');
	const file = e.dataTransfer.files[0];
	if (!file) return;
	const reader = new FileReader();
	reader.onload = function(ev) { FontRig.loadXmlString(ev.target.result, file.name); };
	reader.readAsText(file);
});

// ===================================================================
// Helper: detect if user is typing in a panel textarea/input
// ===================================================================
FontRig._isTypingInPanel = function(el) {
	if (!el) return false;
	var tag = el.tagName;
	if (tag === 'TEXTAREA' || tag === 'INPUT') {
		// Check if the element is inside a sidebar panel
		if (el.closest('.fr-sidebar')) return true;
		// Also check for specific panel classes
		if (el.classList.contains('xml-panel__content')) return true;
		if (el.classList.contains('py-panel__input')) return true;
	}
	return false;
};

// ===================================================================
// Keyboard — dispatch via bindings.js keyMap
// ===================================================================
document.addEventListener('keydown', function(e) {
	// Backtick: preview mode (hold) - black on white, no decorations
	// Backtick + Space: toggle persistent preview lock
	if (e.code === 'Backquote' && !FontRig._isTypingInPanel(e.target)) {
		if (state.spaceDown) {
			// Toggle persistent lock
			state.previewLocked = !state.previewLocked;
			state.previewMode = state.previewLocked;
			FontRig.updatePreviewButton();
			FontRig.draw();
		} else if (!state.previewLocked) {
			if (!state.previewMode) {
				state.previewMode = true;
				FontRig.draw();
			}
		}
		e.preventDefault();
		return;
	}

	// Spacebar: panning mode (hold)
	if (e.code === 'Space' && !FontRig._isTypingInPanel(e.target)) {
		if (!state.spaceDown) {
			state.spaceDown = true;
			e.preventDefault();
			FontRig.updateCanvasCursor();
		}
		return;
	}

	// S key: slide along curves (hold while dragging)
	if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey && !FontRig._isTypingInPanel(e.target)) {
		if (!state.sKeyDown) {
			state.sKeyDown = true;
			if (state.isDragging && state.selectedNodeIds.size === 1) {
				var nodeId = state.selectedNodeIds.values().next().value;
				state.slideData = FontRig.initSlideMode(nodeId, 'curve');
			}
		}
		if (state.slideData) {
			e.preventDefault();
			return;
		}
	}

	// A key: slide along lines (hold while dragging)
	if (e.code === 'KeyA' && !e.ctrlKey && !e.metaKey && !FontRig._isTypingInPanel(e.target)) {
		if (!state.aKeyDown) {
			state.aKeyDown = true;
			if (state.isDragging && state.selectedNodeIds.size === 1) {
				var nodeId = state.selectedNodeIds.values().next().value;
				state.slideData = FontRig.initSlideMode(nodeId, 'line');
			}
		}
		if (state.slideData) {
			e.preventDefault();
			return;
		}
	}

	// XML textarea: Ctrl+Enter applies, other typing is free-form
	// (XML panel instances handle their own Ctrl+Enter via mount wiring;
	//  this guard prevents keyboard shortcuts from firing while typing)
	if (e.target && e.target.classList && e.target.classList.contains('xml-panel__content')) {
		if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
			return; // handled by instance wiring
		}
		if (!(e.ctrlKey || e.metaKey)) return;
	}

	// Dispatch through key map
	FontRig.dispatchKey(e);
});

document.addEventListener('keyup', function(e) {
	// Backtick released: exit preview mode (unless locked)
	if (e.code === 'Backquote') {
		if (!state.previewLocked) {
			state.previewMode = false;
			FontRig.draw();
		}
		return;
	}

	if (e.code === 'Space') {
		state.spaceDown = false;
		if (state.isPanning) {
			state.isPanning = false;
		}
		FontRig.updateCanvasCursor();
	}

	// S/A/E key released: exit slide mode
	if (e.code === 'KeyS') {
		state.sKeyDown = false;
		if (state.slideData && state.slideData.mode === 'curve') state.slideData = null;
		if (state._kbSlideData && state._kbSlideData.mode === 'curve') {
			state._kbSlideData = null;
			state._kbSlideDataLayers = null;
		}
	}
	if (e.code === 'KeyA') {
		state.aKeyDown = false;
		if (state.slideData && state.slideData.mode === 'line') state.slideData = null;
		if (state._kbSlideData && state._kbSlideData.mode === 'line') {
			state._kbSlideData = null;
			state._kbSlideDataLayers = null;
		}
	}
});

// ===================================================================
// Split handle drag (legacy — replaced by sidebar resize system)
// ===================================================================
// Kept as guard in case old DOM is still present; otherwise no-op.
(function initSplitHandle() {
	if (!dom.splitHandle) return;

	let isDragging = false;

	dom.splitHandle.addEventListener('mousedown', function(e) {
		e.preventDefault();
		isDragging = true;
		dom.splitHandle.classList.add('dragging');
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
	});

	window.addEventListener('mousemove', function(e) {
		if (!isDragging) return;

		const mainRect = dom.main.getBoundingClientRect();
		const panel = dom.sidePanel;
		if (!panel) return;

		const mouseX = e.clientX - mainRect.left;
		const panelWidth = mainRect.width - mouseX - dom.splitHandle.offsetWidth / 2;

		const minPanel = 200;
		const maxPanel = mainRect.width - minPanel - dom.splitHandle.offsetWidth;
		panel.style.width = Math.max(minPanel, Math.min(maxPanel, panelWidth)) + 'px';

		FontRig.requestDraw();
	});

	window.addEventListener('mouseup', function() {
		if (isDragging) {
			isDragging = false;
			dom.splitHandle.classList.remove('dragging');
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
			FontRig.draw();
		}
	});
})();

// XML panel: Refresh / Apply buttons and textarea click are now
// wired per-instance inside XmlPanel.mount(). No hardcoded IDs needed.

// ===================================================================
// Python REPL + Glyph widget
// ===================================================================
FontRig.wirePythonPanel();
FontRig.initGlyphWidget();

// -- Python init button in toolbar ----------------------------------
(function() {
	var pyInitToolbar = document.getElementById('btn-py-init');
	if (pyInitToolbar) {
		pyInitToolbar.addEventListener('click', function() {
			// Show the right sidebar, switch to Python tab, then init
			if (FontRig._rightSidebar) {
				if (!FontRig._rightSidebar.visible) {
					FontRig.Sidebar.show(FontRig._rightSidebar);
					var panelBtn = document.getElementById('btn-panel');
					if (panelBtn) panelBtn.classList.add('active');
				}
				FontRig.Sidebar.switchTab(FontRig._rightSidebar, 'python');
			}
			FontRig.pyPanel.init();
		});
	}
})();

// ===================================================================
// Wire simple toolbar buttons from bindings.js
// ===================================================================
FontRig.wireToolbar();
FontRig.wireTransformInputs();

// -- Editor > Movement menu item ------------------------------------
(function() {
	var btn = document.getElementById('btn-movement-prefs');
	if (btn) {
		btn.addEventListener('click', function() {
			FontRig.openMovementPrefs();
		});
	}
})();

// -- Glyph > Convert all Hobby splines to Beziers -------------------
(function() {
	var btn = document.getElementById('btn-flatten-hobby');
	if (btn) {
		btn.addEventListener('click', function() {
			if (typeof FontRig.openFlattenHobbyDialog === 'function') {
				FontRig.openFlattenHobbyDialog();
			}
		});
	}
})();

// -- View > Redraw Viewport ----------------------------------------
// Force-refresh: re-solve every hobby contour, drop the Path2D cache
// for every layer, redraw. Useful when something looks stale (e.g.
// Pyodide came online after a glyph load, or an external tool
// mutated state without dirtying the cache).
FontRig.redrawViewport = function() {
	var g = FontRig.state && FontRig.state.glyphData;
	if (g && typeof FontRig.solveAllHobbyContours === 'function') {
		FontRig.solveAllHobbyContours(g);
	}
	if (g && g.layers && typeof FontRig.invalidatePathCache === 'function') {
		for (var li = 0; li < g.layers.length; li++) {
			FontRig.invalidatePathCache(g.layers[li]);
		}
	}
	if (FontRig.draw) FontRig.draw();
	if (FontRig.updateStatusSelected) FontRig.updateStatusSelected();
};

(function() {
	var btn = document.getElementById('btn-redraw');
	if (btn) {
		btn.addEventListener('click', function() {
			FontRig.redrawViewport();
		});
	}
	// Also bind F5 globally — keeps the shortcut in the menu honest.
	window.addEventListener('keydown', function(e) {
		if (e.key === 'F5' && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
			// Don't fight the user — only intercept when they're not
			// in an input/textarea (they may want a hard browser reload).
			var t = e.target;
			var tag = t && t.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
			e.preventDefault();
			FontRig.redrawViewport();
		}
	});
})();

// ===================================================================
// Context menu (right-click)
// ===================================================================
var ctxMenu = document.getElementById('context-menu');

function hideContextMenu() {
	if (ctxMenu) ctxMenu.classList.remove('visible');
}

// Stored segment hit for "Insert Node" action
var pendingSegmentHit = null;
var pendingContourIdx = -1;

dom.canvasWrap.addEventListener('contextmenu', function(e) {
	e.preventDefault();
	pendingSegmentHit = null;
	pendingContourIdx = -1;

	var rect = dom.canvas.getBoundingClientRect();
	var absSx = e.clientX - rect.left;
	var absSy = e.clientY - rect.top;
	var coords = FontRig._interactionCoords(absSx, absSy);

	// Menu items
	var toggleItem = ctxMenu.querySelector('[data-action="toggleSmooth"]');
	var retractItem = ctxMenu.querySelector('[data-action="retractHandles"]');
	var insertItem = ctxMenu.querySelector('[data-action="insertNode"]');
	var toLineItem = ctxMenu.querySelector('[data-action="convertToLine"]');
	var toCurveItem = ctxMenu.querySelector('[data-action="convertToCurve"]');
	var toQuadItem = ctxMenu.querySelector('[data-action="convertToQuadratic"]');
	var selectContourItem = ctxMenu.querySelector('[data-action="selectContour"]');
	var setStartItem = ctxMenu.querySelector('[data-action="setContourStart"]');
	var reverseItem = ctxMenu.querySelector('[data-action="reverseContour"]');
	var joinItem = ctxMenu.querySelector('[data-action="joinContour"]');
	var transformItem = ctxMenu.querySelector('[data-action="transformSelection"]');
	var toHobbyItem = ctxMenu.querySelector('[data-action="convertToHobby"]');
	var toBezierItem = ctxMenu.querySelector('[data-action="convertToBezier"]');
	var hobbySep = ctxMenu.querySelector('[data-id="hobby-sep"]');
	var hobbyTensionSep = ctxMenu.querySelector('[data-id="hobby-sep-tension"]');
	var hobbyConvertSep = ctxMenu.querySelector('[data-id="hobby-convert-sep"]');
	var knotSegHobby = ctxMenu.querySelector('[data-action="knotSegHobby"]');
	var knotSegLine = ctxMenu.querySelector('[data-action="knotSegLine"]');
	var knotSegFixed = ctxMenu.querySelector('[data-action="knotSegFixed"]');
	var knotTLooser = ctxMenu.querySelector('[data-action="knotTensionLooser"]');
	var knotTTighter = ctxMenu.querySelector('[data-action="knotTensionTighter"]');
	var knotTReset = ctxMenu.querySelector('[data-action="knotTensionReset"]');
	var hobbyDirSep = ctxMenu.querySelector('[data-id="hobby-sep-dir"]');
	var knotPinDir = ctxMenu.querySelector('[data-action="knotPinDirection"]');
	var knotReleaseDir = ctxMenu.querySelector('[data-action="knotReleaseDirection"]');

	// Hit test: node first, then segment
	var nodeHit = null;
	var segHit = null;
	FontRig._withActiveOffset(function() {
		nodeHit = FontRig.hitTestNode(coords.sx, coords.sy);
		if (!nodeHit) {
			segHit = FontRig.hitTestSegment(coords.sx, coords.sy);
		}
	});

	// Determine contour kind for kind-aware menu visibility.
	var hitContour = (nodeHit && nodeHit.contour) || (segHit && segHit.contour) || null;
	var hitIsHobby = hitContour && hitContour.kind === 'hobby';

	if (nodeHit) {
		// -- Right-clicked on a node --
		if (!state.selectedNodeIds.has(nodeHit.id)) {
			FontRig.selectNode(nodeHit.id, false);
		}

		// Find which contour this node belongs to
		pendingContourIdx = FontRig.getContourIndexForNode(nodeHit.id);

		// Show join only for open endpoints
		if (joinItem) {
			var epCheck = FontRig.isOpenEndpoint(nodeHit.id);
			joinItem.style.display = epCheck ? '' : 'none';
		}

		// Set Start Node: show only for on-curve nodes on closed contours
		if (setStartItem) {
			var nodeRef = FontRig.findNodeById(nodeHit.id);
			var isOnClosed = nodeRef && nodeRef.node.type === 'on' && nodeRef.contour.closed;
			setStartItem.style.display = isOnClosed ? '' : 'none';
		}

		// Reverse Contour: always show when a contour is identified
		if (reverseItem) reverseItem.style.display = '';

		// Show node items, hide segment items
		if (toggleItem) toggleItem.style.display = '';
		if (retractItem) retractItem.style.display = '';
		if (insertItem) insertItem.style.display = 'none';
		if (toLineItem) toLineItem.style.display = 'none';
		if (toCurveItem) toCurveItem.style.display = 'none';
		if (toQuadItem) toQuadItem.style.display = 'none';
		if (selectContourItem) selectContourItem.style.display = '';
		if (transformItem) transformItem.style.display = (state.selectedNodeIds.size >= 2) ? '' : 'none';
		// Show/hide separators
		var seps = ctxMenu.querySelectorAll('.ctx-separator');
		if (seps[0]) seps[0].style.display = 'none';
		if (seps[1]) seps[1].style.display = '';
		if (seps[2]) seps[2].style.display = '';

		// Update smooth/sharp label
		if (toggleItem) {
			var hasSmooth = false, hasSharp = false;
			for (var id of state.selectedNodeIds) {
				var ref = FontRig.findNodeById(id);
				if (ref && ref.node.type === 'on') {
					if (ref.node.smooth) hasSmooth = true;
					else hasSharp = true;
				}
			}
			if (hasSmooth && !hasSharp) {
				toggleItem.innerHTML = '<span class="tri">node_sharp</span>Convert to Sharp';
			} else if (hasSharp && !hasSmooth) {
				toggleItem.innerHTML = '<span class="tri">node_smooth</span>Convert to Smooth';
			} else {
				toggleItem.innerHTML = '<span class="tri">node_smooth</span>Toggle Smooth/Sharp';
			}
		}

		// Hobby knot: smooth/sharp + retract handles + setStart aren't
		// meaningful — knots have no handles and the start ring is
		// implicit at index 0.
		if (hitIsHobby) {
			if (toggleItem) toggleItem.style.display = 'none';
			if (retractItem) retractItem.style.display = 'none';
			if (setStartItem) setStartItem.style.display = 'none';
		}
	} else if (segHit) {
		// -- Right-clicked on a segment --
		pendingSegmentHit = segHit;

		// Show segment items, hide node items
		if (toggleItem) toggleItem.style.display = 'none';
		if (retractItem) retractItem.style.display = 'none';
		if (insertItem) insertItem.style.display = '';
		if (selectContourItem) selectContourItem.style.display = '';
		if (setStartItem) setStartItem.style.display = 'none';
		if (reverseItem) reverseItem.style.display = '';
		if (joinItem) joinItem.style.display = 'none';
		if (transformItem) transformItem.style.display = (state.selectedNodeIds.size >= 2) ? '' : 'none';
		pendingContourIdx = segHit.ci;

		// Conversion items based on segment type
		var stype = segHit.seg.type;
		if (toLineItem) toLineItem.style.display = (stype === 'cubic' || stype === 'quadratic') ? '' : 'none';
		if (toCurveItem) toCurveItem.style.display = (stype === 'line' || stype === 'quadratic') ? '' : 'none';
		if (toQuadItem) toQuadItem.style.display = (stype === 'cubic') ? '' : 'none';

		// Hobby segments are solver-derived. Bezier-flavoured
		// segment-type conversions don't apply.
		if (hitIsHobby) {
			if (toLineItem) toLineItem.style.display = 'none';
			if (toCurveItem) toCurveItem.style.display = 'none';
			if (toQuadItem) toQuadItem.style.display = 'none';
		}

		// Separators: hide first two, show last
		var seps = ctxMenu.querySelectorAll('.ctx-separator:not([data-id="hobby-sep"])');
		if (seps[0]) seps[0].style.display = 'none';
		if (seps[1]) seps[1].style.display = 'none';
		if (seps[2]) seps[2].style.display = '';
	} else {
		hideContextMenu();
		return;
	}

	// Hobby ↔ Bezier conversion items. Hobby contours offer "Convert
	// to Bezier"; bezier contours offer "Convert to Hobby". Hidden
	// when the hit doesn't carry a contour (shouldn't happen, but
	// be safe).
	if (toHobbyItem) toHobbyItem.style.display = (hitContour && !hitIsHobby) ? '' : 'none';
	if (toBezierItem) toBezierItem.style.display = hitIsHobby ? '' : 'none';
	if (hobbySep) hobbySep.style.display = hitContour ? '' : 'none';

	// Knot-specific items: segment-type toggle and per-knot tension.
	// Visible only when the right-click landed on an actual knot
	// (i.e. an on-curve node of a hobby contour). Off-curve and
	// segment hits don't carry a knot identity.
	var knotInfo = (nodeHit && hitIsHobby && typeof FontRig._resolveKnotByNodeId === 'function')
		? FontRig._resolveKnotByNodeId(nodeHit.id)
		: null;
	var hasKnot = !!knotInfo;

	if (hobbyTensionSep) hobbyTensionSep.style.display = hasKnot ? '' : 'none';
	if (hobbyConvertSep) hobbyConvertSep.style.display = (hasKnot && hitIsHobby) ? '' : 'none';

	if (knotSegHobby) knotSegHobby.style.display = hasKnot ? '' : 'none';
	if (knotSegLine)  knotSegLine.style.display  = hasKnot ? '' : 'none';
	if (knotSegFixed) knotSegFixed.style.display = hasKnot ? '' : 'none';
	if (knotTLooser)  knotTLooser.style.display  = hasKnot ? '' : 'none';
	if (knotTTighter) knotTTighter.style.display = hasKnot ? '' : 'none';
	if (knotTReset)   knotTReset.style.display   = hasKnot ? '' : 'none';

	// Direction items: Pin shown when knot is free; Release shown when pinned.
	var dirPinned = hasKnot && (knotInfo.knot.dir_in != null || knotInfo.knot.dir_out != null);
	if (hobbyDirSep)    hobbyDirSep.style.display    = hasKnot ? '' : 'none';
	if (knotPinDir)     knotPinDir.style.display     = (hasKnot && !dirPinned) ? '' : 'none';
	if (knotReleaseDir) knotReleaseDir.style.display = (hasKnot &&  dirPinned) ? '' : 'none';

	// Mark the current segment_type with a checkmark prefix so the
	// user can see at a glance which one is active without opening
	// a property panel.
	if (hasKnot) {
		var seg = knotInfo.knot.segment_type || 'hobby';
		var mark = function(item, value, label) {
			if (!item) return;
			item.textContent = (seg === value ? '✓ ' : '   ') + label;
		};
		mark(knotSegHobby, 'hobby', 'Segment: Hobby');
		mark(knotSegLine,  'line',  'Segment: Line');
		mark(knotSegFixed, 'fixed', 'Segment: Fixed');

		// Stash for the click handler so it doesn't have to re-resolve.
		ctxMenu._pendingKnotNodeId = nodeHit.id;
	} else {
		ctxMenu._pendingKnotNodeId = null;
	}

	// Position and show menu
	ctxMenu.style.left = e.clientX + 'px';
	ctxMenu.style.top = e.clientY + 'px';
	ctxMenu.classList.add('visible');

	// Clamp to viewport
	requestAnimationFrame(function() {
		var mr = ctxMenu.getBoundingClientRect();
		if (mr.right > window.innerWidth) {
			ctxMenu.style.left = (e.clientX - mr.width) + 'px';
		}
		if (mr.bottom > window.innerHeight) {
			ctxMenu.style.top = (e.clientY - mr.height) + 'px';
		}
	});
});

// Menu item click
if (ctxMenu) {
	ctxMenu.addEventListener('click', function(e) {
		var item = e.target.closest('.ctx-item');
		if (!item) return;

		var action = item.dataset.action;
		if (action === 'toggleSmooth') {
			FontRig.pushUndo();
			FontRig.sync_toggleSmooth();
		} else if (action === 'retractHandles') {
			FontRig.pushUndo();
			FontRig.sync_retractHandles();
		} else if (action === 'joinContour') {
			FontRig.pushUndo();
			FontRig.tryJoinEndpoints();
		} else if (action === 'openContour') {
			FontRig.pushUndo();
			FontRig.sync_openContourAtNode();
		} else if (action === 'setContourStart') {
			FontRig.pushUndo();
			FontRig.sync_setContourStart();
		} else if (action === 'reverseContour') {
			FontRig.pushUndo();
			FontRig.sync_reverseContour(pendingContourIdx >= 0 ? pendingContourIdx : undefined);
		} else if (action === 'selectContour') {
			if (pendingContourIdx >= 0) {
				var ids = FontRig.getContourNodeIds(pendingContourIdx);
				FontRig.selectNodes(ids, false);
				pendingContourIdx = -1;
			}
		} else if (action === 'insertNode') {
			if (pendingSegmentHit) {
				FontRig.pushUndo();
				FontRig.sync_insertNodeOnSegment(pendingSegmentHit);
				pendingSegmentHit = null;
				pendingContourIdx = -1;
			}
		} else if (action === 'convertToLine') {
			if (pendingSegmentHit) {
				FontRig.pushUndo();
				FontRig.sync_convertSegmentToLine(pendingSegmentHit);
				pendingSegmentHit = null;
				pendingContourIdx = -1;
			}
		} else if (action === 'convertToCurve') {
			if (pendingSegmentHit) {
				FontRig.pushUndo();
				FontRig.sync_convertSegmentToCubic(pendingSegmentHit);
				pendingSegmentHit = null;
				pendingContourIdx = -1;
			}
		} else if (action === 'convertToQuadratic') {
			if (pendingSegmentHit) {
				FontRig.pushUndo();
				FontRig.sync_convertSegmentToQuadratic(pendingSegmentHit);
				pendingSegmentHit = null;
				pendingContourIdx = -1;
			}
		} else if (action === 'knotSegHobby' || action === 'knotSegLine' || action === 'knotSegFixed') {
			var seg = (action === 'knotSegHobby') ? 'hobby'
				: (action === 'knotSegLine')  ? 'line'
				: 'fixed';
			var nid = ctxMenu._pendingKnotNodeId;
			// Structural change → MM-aware. sync_setKnotSegmentType
			// honours the layer-selector mode; in 'active' mode it
			// only touches the active layer.
			if (nid && typeof FontRig.sync_setKnotSegmentType === 'function') {
				FontRig.sync_setKnotSegmentType(nid, seg);
			} else if (nid && typeof FontRig.setKnotSegmentType === 'function') {
				FontRig.setKnotSegmentType(nid, seg);
			}
			ctxMenu._pendingKnotNodeId = null;
		} else if (action === 'knotTensionLooser') {
			var nidL = ctxMenu._pendingKnotNodeId;
			if (nidL && typeof FontRig.adjustKnotTensionDelta === 'function') {
				FontRig.pushUndo();
				FontRig.adjustKnotTensionDelta(nidL, -0.05);
			}
			ctxMenu._pendingKnotNodeId = null;
		} else if (action === 'knotTensionTighter') {
			var nidT = ctxMenu._pendingKnotNodeId;
			if (nidT && typeof FontRig.adjustKnotTensionDelta === 'function') {
				FontRig.pushUndo();
				FontRig.adjustKnotTensionDelta(nidT, +0.05);
			}
			ctxMenu._pendingKnotNodeId = null;
		} else if (action === 'knotTensionReset') {
			var nidR = ctxMenu._pendingKnotNodeId;
			if (nidR && typeof FontRig.resetKnotTension === 'function') {
				FontRig.resetKnotTension(nidR);
			}
			ctxMenu._pendingKnotNodeId = null;
		} else if (action === 'knotPinDirection') {
			var nidPD = ctxMenu._pendingKnotNodeId;
			if (nidPD && typeof FontRig.pinKnotDirectionAtSolved === 'function') {
				FontRig.pinKnotDirectionAtSolved(nidPD);
			}
			ctxMenu._pendingKnotNodeId = null;
		} else if (action === 'knotReleaseDirection') {
			var nidRD = ctxMenu._pendingKnotNodeId;
			if (nidRD && typeof FontRig.releaseKnotDirection === 'function') {
				FontRig.releaseKnotDirection(nidRD);
			}
			ctxMenu._pendingKnotNodeId = null;
		} else if (action === 'convertToHobby') {
			// Structural change → MM-aware.
			if (pendingContourIdx >= 0) {
				if (typeof FontRig.sync_convertContourToHobby === 'function') {
					FontRig.sync_convertContourToHobby(pendingContourIdx);
				} else if (typeof FontRig.convertContourToHobby === 'function') {
					FontRig.convertContourToHobby(pendingContourIdx);
				}
				pendingContourIdx = -1;
				pendingSegmentHit = null;
			}
		} else if (action === 'convertToBezier') {
			if (pendingContourIdx >= 0) {
				if (typeof FontRig.sync_convertContourToBezier === 'function') {
					FontRig.sync_convertContourToBezier(pendingContourIdx);
				} else if (typeof FontRig.convertContourToBezier === 'function') {
					FontRig.convertContourToBezier(pendingContourIdx);
				}
				pendingContourIdx = -1;
				pendingSegmentHit = null;
			}
		} else if (action === 'transformSelection') {
			FontRig.activateTransform();
			FontRig.draw();
		}

		hideContextMenu();
	});
}

// Dismiss on click outside or Escape
window.addEventListener('mousedown', function(e) {
	if (ctxMenu && !ctxMenu.contains(e.target)) {
		hideContextMenu();
	}
});

document.addEventListener('keydown', function(e) {
	if (e.key === 'Escape' && FontRig.tf.active) {
		FontRig.deactivateTransform();
		FontRig.draw();
		e.stopPropagation();
		return;
	}
	if (e.key === 'Escape' && ctxMenu && ctxMenu.classList.contains('visible')) {
		e.stopPropagation();
		hideContextMenu();
	}
}, true);

})();
