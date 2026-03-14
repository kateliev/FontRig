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

	// Normal zoom (centred on cursor)
	const { sx: mx, sy: my } = FontRig._interactionCoords(absSx, absSy);
	const factor = e.deltaY > 0 ? FontRig.WHEEL_ZOOM_OUT : FontRig.WHEEL_ZOOM_IN;
	const newZoom = state.zoom * factor;

	state.pan.x = mx - (mx - state.pan.x) * (newZoom / state.zoom);
	state.pan.y = my - (my - state.pan.y) * (newZoom / state.zoom);
	state.zoom = newZoom;

	FontRig.updateZoomStatus();
	FontRig.draw();
}, { passive: false });

// ===================================================================
// Resize
// ===================================================================
const resizeObserver = new ResizeObserver(function() { FontRig.draw(); });
resizeObserver.observe(dom.canvasWrap);

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

// XML panel (has panel show/hide logic)
document.getElementById('btn-panel').addEventListener('click', function(e) {
	// Shift+click or click when detached → toggle detach
	if (e.shiftKey || FontRig.panelBridge.isDetached) {
		if (FontRig.panelBridge.isDetached) {
			FontRig.attachPanel();
		} else {
			FontRig.detachPanel();
		}
		return;
	}

	state.showXml = !state.showXml;
	this.classList.toggle('active');

	const panel = dom.sidePanel;

	if (state.showXml) {
		const mainWidth = dom.main.clientWidth;
		panel.style.width = Math.round(mainWidth * 0.4) + 'px';
		panel.classList.add('visible');
		dom.splitHandle.classList.add('visible');
	} else {
		panel.classList.remove('visible');
		dom.splitHandle.classList.remove('visible');
		panel.style.width = '';
	}

	requestAnimationFrame(function() {
		FontRig.draw();
		if (state.showXml && state.activePanel === 'xml') FontRig.buildXmlPanel();
	});
});

// Popout button inside panel header
document.getElementById('btn-popout').addEventListener('click', function() {
	FontRig.detachPanel();
});

// Font panel button
document.getElementById('btn-font-panel').addEventListener('click', function(e) {
	// Shift+click → toggle detach
	if (e.shiftKey || FontRig.fontPanelBridge.isDetached) {
		if (FontRig.fontPanelBridge.isDetached) {
			FontRig.attachFontPanel();
		} else {
			FontRig.detachFontPanel();
		}
		return;
	}

	// Just focus the detached panel if already detached
	if (FontRig.fontPanelBridge.isDetached && FontRig.fontPanelBridge.detachedWindow) {
		FontRig.fontPanelBridge.detachedWindow.focus();
	} else {
		// Open detached font panel
		FontRig.detachFontPanel();
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
// Glyph panel — click and search
// ===================================================================
(function() {
	var glyphList = document.getElementById('glyph-list');
	var glyphSearch = document.getElementById('glyph-search');
	var glyphCount = document.getElementById('glyph-count');

	if (glyphList) {
		// Single click: switch to glyph
		glyphList.addEventListener('click', function(e) {
			var entry = e.target.closest('.glyph-entry');
			if (!entry) return;
			var name = entry.dataset.name;
			if (name) FontRig.switchGlyph(name);
		});

		// Double click: add glyph to workspace strip
		glyphList.addEventListener('dblclick', function(e) {
			var entry = e.target.closest('.glyph-entry');
			if (!entry) return;
			var name = entry.dataset.name;
			if (!name || !FontRig.state.glyphViewMode) return;

			FontRig.addGlyphToStrip(name);
			FontRig.updateGlyphPanelActive();
		});
	}

	if (glyphSearch) {
		glyphSearch.addEventListener('input', function() {
			FontRig.filterGlyphPanel(this.value);
			// Update visible count
			if (glyphCount && glyphList) {
				var visible = glyphList.querySelectorAll('.glyph-entry:not([style*="display: none"])');
				glyphCount.textContent = visible.length + '/' + (FontRig.font ? FontRig.font.manifest.length : 0);
			}
		});
	}
})();

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
	e.preventDefault();
	dom.dropOverlay.classList.add('visible');
});

document.addEventListener('dragleave', function(e) {
	if (e.relatedTarget === null || !document.contains(e.relatedTarget)) {
		dom.dropOverlay.classList.remove('visible');
	}
});

document.addEventListener('drop', function(e) {
	e.preventDefault();
	dom.dropOverlay.classList.remove('visible');
	const file = e.dataTransfer.files[0];
	if (!file) return;
	const reader = new FileReader();
	reader.onload = function(ev) { FontRig.loadXmlString(ev.target.result, file.name); };
	reader.readAsText(file);
});

// ===================================================================
// Keyboard — dispatch via bindings.js keyMap
// ===================================================================
document.addEventListener('keydown', function(e) {
	// Backtick: preview mode (hold) - black on white, no decorations
	// Backtick + Space: toggle persistent preview lock
	if (e.code === 'Backquote' && e.target !== dom.xmlContent && e.target !== dom.pyInput) {
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
	if (e.code === 'Space' && e.target !== dom.xmlContent) {
		if (!state.spaceDown) {
			state.spaceDown = true;
			e.preventDefault();
			FontRig.updateCanvasCursor();
		}
		return;
	}

	// S key: slide along curves (hold while dragging)
	if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey && e.target !== dom.xmlContent) {
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
	if (e.code === 'KeyA' && !e.ctrlKey && !e.metaKey && e.target !== dom.xmlContent) {
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
	if (e.target === dom.xmlContent) {
		if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
			e.preventDefault();
			FontRig.pushUndo();
			FontRig.xmlApply();
			return;
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
	}
	if (e.code === 'KeyA') {
		state.aKeyDown = false;
		if (state.slideData && state.slideData.mode === 'line') state.slideData = null;
	}
});

// ===================================================================
// Split handle drag
// ===================================================================
(function initSplitHandle() {
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

		const mouseX = e.clientX - mainRect.left;
		const panelWidth = mainRect.width - mouseX - dom.splitHandle.offsetWidth / 2;

		const minPanel = 200;
		const maxPanel = mainRect.width - minPanel - dom.splitHandle.offsetWidth;
		panel.style.width = Math.max(minPanel, Math.min(maxPanel, panelWidth)) + 'px';

		FontRig.draw();
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

// ===================================================================
// XML panel: Refresh / Apply buttons (no live sync)
// ===================================================================
var xmlRefreshBtn = document.getElementById('xml-refresh-btn');
var xmlApplyBtn = document.getElementById('xml-apply-btn');

if (xmlRefreshBtn) {
	xmlRefreshBtn.addEventListener('click', function() {
		FontRig.xmlRefresh();
	});
}

if (xmlApplyBtn) {
	xmlApplyBtn.addEventListener('click', function() {
		FontRig.pushUndo();
		FontRig.xmlApply();
	});
}

// XML textarea: click to highlight node on canvas (one-way)
dom.xmlContent.addEventListener('click', function() {
	var textarea = dom.xmlContent;
	var pos = textarea.selectionStart;
	var text = textarea.value.substring(0, pos);
	var lineIdx = text.split('\n').length - 1;
	var nodeId = FontRig.xmlLineNodeMap[lineIdx];

	if (nodeId) {
		state.selectedNodeIds.clear();
		state.selectedNodeIds.add(nodeId);
		FontRig.draw();
		FontRig.updateStatusSelected();
	}
});

// ===================================================================
// Panel tabs + Python REPL
// ===================================================================
FontRig.initPanelTabs();
FontRig.wirePythonPanel();
FontRig.initGlyphWidget();

// ===================================================================
// Wire simple toolbar buttons from bindings.js
// ===================================================================
FontRig.wireToolbar();
FontRig.wireTransformInputs();

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
	var joinItem = ctxMenu.querySelector('[data-action="joinContour"]');
	var transformItem = ctxMenu.querySelector('[data-action="transformSelection"]');

	// Hit test: node first, then segment
	var nodeHit = null;
	var segHit = null;
	FontRig._withActiveOffset(function() {
		nodeHit = FontRig.hitTestNode(coords.sx, coords.sy);
		if (!nodeHit) {
			segHit = FontRig.hitTestSegment(coords.sx, coords.sy);
		}
	});

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
	} else if (segHit) {
		// -- Right-clicked on a segment --
		pendingSegmentHit = segHit;

		// Show segment items, hide node items
		if (toggleItem) toggleItem.style.display = 'none';
		if (retractItem) retractItem.style.display = 'none';
		if (insertItem) insertItem.style.display = '';
		if (selectContourItem) selectContourItem.style.display = '';
		if (joinItem) joinItem.style.display = 'none';
		if (transformItem) transformItem.style.display = (state.selectedNodeIds.size >= 2) ? '' : 'none';
		pendingContourIdx = segHit.ci;

		// Conversion items based on segment type
		var stype = segHit.seg.type;
		if (toLineItem) toLineItem.style.display = (stype === 'cubic' || stype === 'quadratic') ? '' : 'none';
		if (toCurveItem) toCurveItem.style.display = (stype === 'line' || stype === 'quadratic') ? '' : 'none';
		if (toQuadItem) toQuadItem.style.display = (stype === 'cubic') ? '' : 'none';

		// Separators: hide first two, show last
		var seps = ctxMenu.querySelectorAll('.ctx-separator');
		if (seps[0]) seps[0].style.display = 'none';
		if (seps[1]) seps[1].style.display = 'none';
		if (seps[2]) seps[2].style.display = '';
	} else {
		hideContextMenu();
		return;
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
			FontRig.toggleSmooth();
		} else if (action === 'retractHandles') {
			FontRig.pushUndo();
			FontRig.retractHandles();
		} else if (action === 'joinContour') {
			FontRig.pushUndo();
			FontRig.tryJoinEndpoints();
		} else if (action === 'openContour') {
			FontRig.pushUndo();
			FontRig.openContourAtNode();
		} else if (action === 'selectContour') {
			if (pendingContourIdx >= 0) {
				var ids = FontRig.getContourNodeIds(pendingContourIdx);
				FontRig.selectNodes(ids, false);
				pendingContourIdx = -1;
			}
		} else if (action === 'insertNode') {
			if (pendingSegmentHit) {
				FontRig.pushUndo();
				FontRig.insertNodeOnSegment(pendingSegmentHit);
				pendingSegmentHit = null;
	pendingContourIdx = -1;
			}
		} else if (action === 'convertToLine') {
			if (pendingSegmentHit) {
				FontRig.pushUndo();
				FontRig.convertSegmentToLine(pendingSegmentHit);
				pendingSegmentHit = null;
				pendingContourIdx = -1;
			}
		} else if (action === 'convertToCurve') {
			if (pendingSegmentHit) {
				FontRig.pushUndo();
				FontRig.convertSegmentToCubic(pendingSegmentHit);
				pendingSegmentHit = null;
				pendingContourIdx = -1;
			}
		} else if (action === 'convertToQuadratic') {
			if (pendingSegmentHit) {
				FontRig.pushUndo();
				FontRig.convertSegmentToQuadratic(pendingSegmentHit);
				pendingSegmentHit = null;
				pendingContourIdx = -1;
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
