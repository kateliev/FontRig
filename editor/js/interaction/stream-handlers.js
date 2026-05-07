// ===================================================================
// FontRig — Stream-Based Interaction Handlers
// ===================================================================
// Each interaction (pan, node drag, rect select, lasso, anchor drag,
// segment drag, transform frame) is a single async function that
// consumes an EventStream. This replaces the scattered state-machine
// flags (isDragging, isSelecting, segmentDrag, etc.) in events.js.
//
// The main dispatch function (handleCanvasDrag) routes the initial
// mousedown to the appropriate handler based on hit testing.
//
// Depends on:
//   - FontRig.EventStream, FontRig.shouldInitiateDrag (event-stream.js)
//   - FontRig.MouseTracker (mouse-tracker.js)
//   - All existing FontRig.* interaction helpers (interaction.js)
// ===================================================================
'use strict';

// -- Coordinate helpers (same as events.js) -------------------------

FontRig._getCellAtScreen = function(sx, sy) {
	var state = FontRig.state;
	if (!state.multiView) return null;
	if (state.joinedView) return FontRig.getJoinedCellAt(sx, sy);
	return FontRig.getCellAt(sx, sy);
};

FontRig._interactionCoords = function(sx, sy) {
	var state = FontRig.state;
	if (state.multiView && !state.joinedView && !state.glyphViewMode) {
		var cell = FontRig.getCellRect(state.activeCell.row, state.activeCell.col);
		return { sx: sx - cell.x, sy: sy - cell.y };
	}
	return { sx: sx, sy: sy };
};

FontRig._withActiveOffset = function(fn) {
	var state = FontRig.state;
	if (state.glyphViewMode && FontRig.font) {
		FontRig.withStripOffset(state.activeCell.row, state.activeCell.col, fn);
	} else if (state.multiView && state.joinedView) {
		FontRig.withJoinedOffset(state.activeCell.row, state.activeCell.col, fn);
	} else {
		fn();
	}
};


// ===================================================================
// Main dispatch: called by MouseTracker on mousedown
// ===================================================================
FontRig.handleCanvasDrag = async function(stream, initialEvent) {
	var state = FontRig.state;
	var e = initialEvent.e;
	var absSx = initialEvent.absSx;
	var absSy = initialEvent.absSy;

	// -- Spacebar held -> pan
	if (state.spaceDown) {
		await FontRig._handlePan(stream, initialEvent);
		return;
	}

	// -- Active drawing tool wins over default selection
	if (FontRig.drawTool && typeof FontRig.drawTool.tryDispatch === 'function') {
		// Use the same coord transform the rest of the function uses.
		var _coords = FontRig._interactionCoords(absSx, absSy);
		if (FontRig.drawTool.tryDispatch(stream, initialEvent, _coords.sx, _coords.sy)) {
			return;
		}
	}

	// -- Glyph strip: switch glyph/cell
	if (state.glyphViewMode && FontRig.font) {
		var stripHit = FontRig.getStripSlotAt(absSx, absSy);
		if (stripHit) {
			if (!stripHit.slot.active && FontRig.workspace._closeRects) {
				var cr = FontRig.workspace._closeRects[stripHit.slot.name];
				if (cr && absSx >= cr.x && absSx <= cr.x + cr.w &&
					absSy >= cr.y && absSy <= cr.y + cr.h) {
					FontRig.removeGlyphFromStrip(stripHit.slot.name);
					FontRig.updateGlyphPanelActive();
					return;
				}
			}
			if (stripHit.slot.active) {
				if (stripHit.row !== state.activeCell.row || stripHit.col !== state.activeCell.col) {
					FontRig.setActiveCell(stripHit.row, stripHit.col);
				}
			} else {
				FontRig.switchGlyph(stripHit.slot.name);
				return;
			}
		}
	}

	// -- Multi-view: switch active cell
	if (state.multiView && !state.glyphViewMode) {
		var clicked = FontRig._getCellAtScreen(absSx, absSy);
		if (clicked && (clicked.row !== state.activeCell.row || clicked.col !== state.activeCell.col)) {
			FontRig.setActiveCell(clicked.row, clicked.col);
		}
	}

	var coords = FontRig._interactionCoords(absSx, absSy);
	var sx = coords.sx, sy = coords.sy;

	// -- Transform frame
	if (FontRig.tf.active) {
		var tfHandled = false;
		FontRig._withActiveOffset(function() {
			tfHandled = FontRig.tfMouseDown(sx, sy, e);
		});
		if (tfHandled) {
			FontRig.draw();
			await FontRig._handleTransformDrag(stream, sx, sy);
			return;
		}
	}

	// -- Hobby direction handle hit (tested before nodes so the user
	//    can grab a handle without first selecting the underlying knot)
	if (state.showNodes) {
		var dirHit = null;
		FontRig._withActiveOffset(function() {
			if (typeof FontRig.hitTestHobbyDirHandle === 'function') {
				dirHit = FontRig.hitTestHobbyDirHandle(sx, sy);
			}
		});
		if (dirHit) {
			await FontRig._handleHobbyDirDrag(stream, initialEvent, sx, sy, dirHit);
			return;
		}
	}

	// -- Node hit
	if (state.showNodes) {
		var hit = null;
		FontRig._withActiveOffset(function() {
			hit = FontRig.hitTestNode(sx, sy);
		});
		if (hit) {
			if (e.shiftKey) {
				FontRig.selectNode(hit.id, true);
			} else if (!state.selectedNodeIds.has(hit.id)) {
				FontRig.selectNode(hit.id, false);
			}
			await FontRig._handleNodeDrag(stream, initialEvent, sx, sy);
			return;
		}

		// -- Segment hit (cubic drag-reshape)
		var segHit = null;
		FontRig._withActiveOffset(function() {
			segHit = FontRig.hitTestSegment(sx, sy);
		});
		if (segHit && segHit.seg.type === 'cubic') {
			await FontRig._handleSegmentDrag(stream, initialEvent, sx, sy, segHit);
			return;
		}
		// Quadratic segment click: select nodes
		if (segHit && segHit.seg.type === 'quadratic') {
			var seg = segHit.seg;
			var ci = segHit.ci;
			FontRig.selectNodes([
				'c' + ci + '_n' + seg.startIdx,
				'c' + ci + '_n' + seg.endIdx,
				'c' + ci + '_n' + seg.offIdx
			], e.shiftKey);
			return;
		}
	}

	// -- Anchor hit
	if (state.showAnchors) {
		var anchorIdx = null;
		FontRig._withActiveOffset(function() {
			anchorIdx = FontRig.hitTestAnchor(sx, sy);
		});
		if (anchorIdx !== null) {
			await FontRig._handleAnchorDrag(stream, initialEvent, sx, sy, anchorIdx);
			return;
		}
	}

	// -- No hit: selection (skip on double-click)
	if (e.detail >= 2) return;

	if (e.altKey) {
		await FontRig._handleLassoSelect(stream, initialEvent, sx, sy);
	} else {
		await FontRig._handleRectSelect(stream, initialEvent, sx, sy);
	}
};


// ===================================================================
// Pan (spacebar + drag)
// ===================================================================
FontRig._handlePan = async function(stream, initialEvent) {
	var state = FontRig.state;
	var startX = initialEvent.e.clientX;
	var startY = initialEvent.e.clientY;
	var originX = state.pan.x;
	var originY = state.pan.y;

	FontRig.dom.canvasWrap.style.cursor = 'grabbing';

	for await (var event of stream) {
		if (event.sx === undefined) continue;  // skip key events
		state.pan.x = originX + (event.e.clientX - startX);
		state.pan.y = originY + (event.e.clientY - startY);
		FontRig.draw();
	}

	FontRig.updateCanvasCursor();
};


// ===================================================================
// Transform frame drag
// ===================================================================
FontRig._handleTransformDrag = async function(stream, sx, sy) {
	for await (var event of stream) {
		if (event.sx === undefined) {
			// Modifier key change — update shift state
			FontRig.tf._shiftKey = event.shiftKey;
			continue;
		}
		var coords = FontRig._interactionCoords(event.absSx, event.absSy);
		var tfHandled = false;
		FontRig._withActiveOffset(function() {
			tfHandled = FontRig.tfMouseMove(coords.sx, coords.sy, event.e);
		});
		if (tfHandled) { FontRig.invalidatePathCache(); FontRig.draw(); }
	}

	FontRig.tfMouseUp();
	FontRig.invalidatePathCache();
	FontRig.draw();
};


// ===================================================================
// Hobby direction handle drag
// ===================================================================
// The user grabbed a direction handle on a hobby knot. Default is
// SPLIT (only the side they grabbed gets pinned), so dragging makes
// a corner / cusp without affecting the other side. Hold Shift to
// MIRROR (smooth tangent — the opposite side is pinned to angle+π).
//
// Double-click on a handle is intercepted separately and releases
// the pin via FontRig.releaseKnotDirection.
FontRig._handleHobbyDirDrag = async function(stream, initialEvent, sx, sy, hit) {
	var state = FontRig.state;
	var contour = hit.contour;
	var knot = hit.knot;
	var side = hit.side;

	// Double-click on handle → release. Don't enter a drag.
	if (initialEvent.e && initialEvent.e.detail >= 2) {
		if (typeof FontRig.releaseKnotDirection === 'function' && hit.nodeId) {
			FontRig.releaseKnotDirection(hit.nodeId);
		}
		return;
	}

	FontRig.pushUndo();
	FontRig.dom.canvasWrap.style.cursor = 'crosshair';

	// Helper: angle from knot to glyph-space (gx, gy), in the same
	// (atan2 of dy, dx) convention used by getKnot*Direction.
	function angleFromKnot(gx, gy) {
		return Math.atan2(gy - knot.y, gx - knot.x);
	}

	// Apply current cursor → pin side. Convention reminder:
	//   dir_out = angle from this knot toward the next chord
	//   dir_in  = angle from prev chord toward this knot
	// The IN handle is rendered at angle+π (back-pointing), so when
	// the user drags it, the angle from knot→cursor equals dir_in+π.
	function applyAt(gx, gy, mirror) {
		var theta = angleFromKnot(gx, gy);
		if (side === 'out') {
			knot.dir_out = theta;
			if (mirror) knot.dir_in = theta + Math.PI;
		} else {
			// Cursor angle ≈ dir_in + π → recover dir_in.
			var dirIn = theta - Math.PI;
			knot.dir_in = dirIn;
			if (mirror) knot.dir_out = dirIn - Math.PI;
		}
		FontRig.solveHobbyContour(contour);
		if (hit.layer && FontRig.invalidatePathCache) FontRig.invalidatePathCache(hit.layer);
		FontRig.draw();
	}

	// Apply at the click location too (initial pin even if the user
	// doesn't drag — useful when they just want to pin at the current
	// solved tangent).
	var initGp;
	FontRig._withActiveOffset(function() { initGp = FontRig.screenToGlyph(sx, sy); });
	applyAt(initGp.x, initGp.y, !!(initialEvent.e && initialEvent.e.shiftKey));

	for await (var ev of stream) {
		if (ev.sx === undefined) continue;

		var coords = FontRig._interactionCoords(ev.absSx, ev.absSy);
		var mirror = !!ev.shiftKey;

		FontRig._withActiveOffset(function() {
			var dgp = FontRig.screenToGlyph(coords.sx, coords.sy);
			applyAt(dgp.x, dgp.y, mirror);
		});

		FontRig.updateStatusSelected();
	}

	FontRig.updateCanvasCursor();
};


// ===================================================================
// Hobby knot drag — moves source knots, re-solves the bezier shadow
// ===================================================================
// Hobby contours store knots; .nodes is the solver's output and gets
// rebuilt every frame from knot positions. Dragging a "node" in a
// hobby contour is really dragging its underlying knot.
FontRig._selectionHasHobby = function(idSet) {
	if (!idSet || idSet.size === 0) return false;
	for (var nodeId of idSet) {
		var ref = FontRig.findNodeById(nodeId);
		if (ref && ref.contour && ref.contour.kind === 'hobby') return true;
	}
	return false;
};

FontRig._handleHobbyKnotDrag = async function(stream, initialEvent, sx, sy) {
	var state = FontRig.state;
	var e = initialEvent.e;

	FontRig.pushUndo();
	if (typeof FontRig.lerpEditStart === 'function') FontRig.lerpEditStart();

	var gp;
	FontRig._withActiveOffset(function() { gp = FontRig.screenToGlyph(sx, sy); });
	var dragOrigin = { x: gp.x, y: gp.y };

	// Resolve each selected node id to its source knot. Off-curves
	// were already filtered out of selection via getAllNodes, but
	// guard anyway.
	var dragKnots = [];     // { knot, startX, startY, contour }
	var touchedContours = new Set();

	for (var nodeId of state.selectedNodeIds) {
		var ref = FontRig.findNodeById(nodeId);
		if (!ref || !ref.contour || ref.contour.kind !== 'hobby') continue;

		var contour = ref.contour;
		var m = nodeId.match(/^c\d+_n(\d+)$/);
		if (!m) continue;
		var ni = parseInt(m[1], 10);

		var map = contour._knotMap;
		if (!map) continue;
		var ki = map[ni];
		if (ki === null || ki === undefined) continue;

		var knot = contour.knots[ki];
		if (!knot) continue;

		dragKnots.push({
			knot: knot,
			startX: knot.x,
			startY: knot.y,
			contour: contour,
		});
		touchedContours.add(contour);
	}

	if (dragKnots.length === 0) return;

	FontRig.dom.canvasWrap.style.cursor = 'move';

	for await (var event of stream) {
		if (event.sx === undefined) continue;

		var evtCoords = FontRig._interactionCoords(event.absSx, event.absSy);
		FontRig._withActiveOffset(function() {
			var dgp = FontRig.screenToGlyph(evtCoords.sx, evtCoords.sy);
			var dx = dgp.x - dragOrigin.x;
			var dy = dgp.y - dragOrigin.y;

			if (event.shiftKey) {
				if (Math.abs(dx) > Math.abs(dy)) dy = 0;
				else dx = 0;
			}

			for (var i = 0; i < dragKnots.length; i++) {
				var dk = dragKnots[i];
				dk.knot.x = Math.round((dk.startX + dx) * 10) / 10;
				dk.knot.y = Math.round((dk.startY + dy) * 10) / 10;
			}

			// Re-solve every affected hobby contour, refresh path cache.
			touchedContours.forEach(function(c) {
				FontRig.solveHobbyContour(c);
			});

			var lyr = FontRig.getActiveLayer();
			if (lyr) FontRig.invalidatePathCache(lyr);
		});

		if (typeof FontRig.lerpSync === 'function') FontRig.lerpSync();
		FontRig.draw();
		FontRig.updateStatusSelected();
	}

	FontRig.updateCanvasCursor();
};


// ===================================================================
// Node drag (moves selected + follower handles)
// ===================================================================
FontRig._handleNodeDrag = async function(stream, initialEvent, sx, sy) {
	var state = FontRig.state;
	var e = initialEvent.e;

	// Hobby contours have a separate drag path: knots are the source
	// of truth, the bezier nodes are render-only. If any selected
	// node sits on a hobby contour, route there. (Mixed selections
	// across hobby + bezier aren't supported — pick one kind.)
	if (FontRig._selectionHasHobby(state.selectedNodeIds)) {
		await FontRig._handleHobbyKnotDrag(stream, initialEvent, sx, sy);
		return;
	}

	FontRig.pushUndo();

	// Ensure lerp snapshot is fresh (pushUndo also calls lerpEditStart,
	// but call again to guarantee the snapshot matches the current state)
	if (typeof FontRig.lerpEditStart === 'function') FontRig.lerpEditStart();

	var gp;
	FontRig._withActiveOffset(function() { gp = FontRig.screenToGlyph(sx, sy); });
	var dragOrigin = { x: gp.x, y: gp.y };

	// Alt mode: move on-curve only
	var dragAltMode = !!(e && e.altKey);

	// Save start positions
	var dragStartPositions = new Map();
	for (var nodeId of state.selectedNodeIds) {
		var ref = FontRig.findNodeById(nodeId);
		if (ref) dragStartPositions.set(nodeId, { x: ref.node.x, y: ref.node.y });
	}

	// Add follower handles unless Alt
	if (!dragAltMode) {
		var followers = FontRig.getFollowerHandles(state.selectedNodeIds);
		for (var entry of followers) {
			if (!dragStartPositions.has(entry[0])) {
				dragStartPositions.set(entry[0], { x: entry[1].x, y: entry[1].y });
			}
		}
	}

	// Tangent constraints
	var dragTangents = FontRig.computeDragTangents(dragStartPositions);

	// Slide mode state
	var slideData = null;
	if (state.selectedNodeIds.size === 1) {
		var slideNodeId = state.selectedNodeIds.values().next().value;
		if (state.sKeyDown) {
			slideData = FontRig.initSlideMode(slideNodeId, 'curve');
		} else if (state.aKeyDown) {
			slideData = FontRig.initSlideMode(slideNodeId, 'line');
		}
	}

	FontRig.dom.canvasWrap.style.cursor = 'move';

	for await (var event of stream) {
		// Handle modifier/key changes mid-drag
		if (event.type === 'key') {
			// Slide mode toggle
			if (event.code === 'KeyS' && event.keyType === 'keydown' && !slideData && state.selectedNodeIds.size === 1) {
				var nid = state.selectedNodeIds.values().next().value;
				slideData = FontRig.initSlideMode(nid, 'curve');
			}
			if (event.code === 'KeyS' && event.keyType === 'keyup' && slideData && slideData.mode === 'curve') {
				slideData = null;
			}
			if (event.code === 'KeyA' && event.keyType === 'keydown' && !slideData && state.selectedNodeIds.size === 1) {
				var nid = state.selectedNodeIds.values().next().value;
				slideData = FontRig.initSlideMode(nid, 'line');
			}
			if (event.code === 'KeyA' && event.keyType === 'keyup' && slideData && slideData.mode === 'line') {
				slideData = null;
			}
			continue;
		}

		// Transform stream event coords the same way as initial coords
		var evtCoords = FontRig._interactionCoords(event.absSx, event.absSy);

		FontRig._withActiveOffset(function() {
			var dgp = FontRig.screenToGlyph(evtCoords.sx, evtCoords.sy);

			// Slide mode
			if (slideData) {
				FontRig.performSlide(slideData, dgp.x, dgp.y);
				return;
			}

			var dx = dgp.x - dragOrigin.x;
			var dy = dgp.y - dragOrigin.y;

			// Shift constraint
			if (event.shiftKey) {
				if (Math.abs(dx) > Math.abs(dy)) dy = 0;
				else dx = 0;
			}

			// Position all nodes
			for (var entry of dragStartPositions) {
				var nodeId = entry[0], startPos = entry[1];
				var effDx = dx, effDy = dy;

				// Tangent constraint
				var tan = dragTangents ? dragTangents.get(nodeId) : null;
				if (tan && (tan.locked || event.ctrlKey)) {
					var proj = FontRig.projectOntoTangent(dx, dy, tan);
					effDx = proj.dx;
					effDy = proj.dy;
				}

				FontRig.updateNodePosition(nodeId, startPos.x + effDx, startPos.y + effDy);
			}

			// Follower handles of constrained nodes
			if (dragTangents && dragTangents.size > 0) {
				for (var tEntry of dragTangents) {
					var onId = tEntry[0], tangent = tEntry[1];
					if (!tangent.locked && !event.ctrlKey) continue;
					var proj = FontRig.projectOntoTangent(dx, dy, tangent);
					var m = onId.match(/^c(\d+)_n(\d+)$/);
					if (!m) continue;
					var ci = parseInt(m[1]), ni = parseInt(m[2]);
					var ref = FontRig.findNodeById(onId);
					if (!ref) continue;
					var nodes = ref.contour.nodes;
					var n = nodes.length;
					var prevId = 'c' + ci + '_n' + ((ni - 1 + n) % n);
					var nextId = 'c' + ci + '_n' + ((ni + 1) % n);
					if (dragStartPositions.has(prevId) && !state.selectedNodeIds.has(prevId)) {
						var sp = dragStartPositions.get(prevId);
						FontRig.updateNodePosition(prevId, sp.x + proj.dx, sp.y + proj.dy);
					}
					if (dragStartPositions.has(nextId) && !state.selectedNodeIds.has(nextId)) {
						var sp = dragStartPositions.get(nextId);
						FontRig.updateNodePosition(nextId, sp.x + proj.dx, sp.y + proj.dy);
					}
				}
			}

			// Enforce smooth collinearity
			if (!dragAltMode) {
				var allMoved = new Set(dragStartPositions.keys());
				FontRig.enforceSmoothCollinearity(allMoved);
			}
		});

		// Live lerp: forward or reverse interpolation (mirrors moveSelectedNodes)
		if (typeof FontRig.lerpSync === 'function') FontRig.lerpSync();

		FontRig.draw();
		FontRig.updateStatusSelected();
	}

	// Finalize: try joining endpoints
	FontRig.tryJoinEndpoints();
	FontRig.updateCanvasCursor();
};


// ===================================================================
// Segment drag (cubic reshape via Bernstein weights)
// ===================================================================
FontRig._handleSegmentDrag = async function(stream, initialEvent, sx, sy, segHit) {
	var state = FontRig.state;
	var e = initialEvent.e;
	var seg = segHit.seg;
	var ci = segHit.ci;

	// Select segment nodes
	FontRig.selectNodes([
		'c' + ci + '_n' + seg.startIdx,
		'c' + ci + '_n' + seg.endIdx,
		'c' + ci + '_n' + seg.offIdx1,
		'c' + ci + '_n' + seg.offIdx2
	], e.shiftKey);

	// Bernstein weights
	var t = segHit.t, u = 1 - t;
	var B1 = 3 * u * u * t;
	var B2 = 3 * u * t * t;
	var denom = B1 * B1 + B2 * B2;

	var h1Id = 'c' + ci + '_n' + seg.offIdx1;
	var h2Id = 'c' + ci + '_n' + seg.offIdx2;
	var h1Start = { x: segHit.contour.nodes[seg.offIdx1].x, y: segHit.contour.nodes[seg.offIdx1].y };
	var h2Start = { x: segHit.contour.nodes[seg.offIdx2].x, y: segHit.contour.nodes[seg.offIdx2].y };

	var gp;
	FontRig._withActiveOffset(function() { gp = FontRig.screenToGlyph(sx, sy); });
	var dragOrigin = { x: gp.x, y: gp.y };

	FontRig.pushUndo();
	if (typeof FontRig.lerpEditStart === 'function') FontRig.lerpEditStart();
	FontRig.dom.canvasWrap.style.cursor = 'move';

	for await (var event of stream) {
		if (event.sx === undefined) continue;

		// Transform stream event coords the same way as initial coords
		var evtCoords = FontRig._interactionCoords(event.absSx, event.absSy);

		FontRig._withActiveOffset(function() {
			var dgp = FontRig.screenToGlyph(evtCoords.sx, evtCoords.sy);
			var dx = dgp.x - dragOrigin.x;
			var dy = dgp.y - dragOrigin.y;

			if (event.shiftKey) {
				if (Math.abs(dx) > Math.abs(dy)) dy = 0;
				else dx = 0;
			}

			var w1 = B1 / denom;
			var w2 = B2 / denom;

			FontRig.updateNodePosition(h1Id, h1Start.x + dx * w1, h1Start.y + dy * w1);
			FontRig.updateNodePosition(h2Id, h2Start.x + dx * w2, h2Start.y + dy * w2);

			var movedHandles = new Set([h1Id, h2Id]);
			FontRig.enforceSmoothCollinearity(movedHandles);
		});

		// Live lerp: forward or reverse interpolation
		if (typeof FontRig.lerpSync === 'function') FontRig.lerpSync();

		FontRig.draw();
		FontRig.updateStatusSelected();
	}

	FontRig.updateCanvasCursor();
};


// ===================================================================
// Anchor drag
// ===================================================================
FontRig._handleAnchorDrag = async function(stream, initialEvent, sx, sy, anchorIdx) {
	var state = FontRig.state;

	FontRig.pushUndo();

	var gp;
	FontRig._withActiveOffset(function() { gp = FontRig.screenToGlyph(sx, sy); });
	var dragOrigin = { x: gp.x, y: gp.y };

	FontRig.dom.canvasWrap.style.cursor = 'move';

	for await (var event of stream) {
		if (event.sx === undefined) continue;

		FontRig._withActiveOffset(function() {
			var dgp = FontRig.screenToGlyph(event.sx, event.sy);
			var layer = FontRig.getActiveLayer();
			if (layer && layer.anchors && layer.anchors[anchorIdx]) {
				var a = layer.anchors[anchorIdx];
				var ax = dgp.x, ay = dgp.y;
				if (event.shiftKey) {
					var dx = Math.abs(ax - dragOrigin.x);
					var dy = Math.abs(ay - dragOrigin.y);
					if (dx > dy) ay = dragOrigin.y;
					else ax = dragOrigin.x;
				}
				a.x = Math.round(ax);
				a.y = Math.round(ay);
			}
		});
		FontRig.draw();
	}

	FontRig.updateCanvasCursor();
};


// ===================================================================
// Rectangle selection
// ===================================================================
FontRig._handleRectSelect = async function(stream, initialEvent, sx, sy) {
	var state = FontRig.state;
	var e = initialEvent.e;
	var startSx = sx, startSy = sy;

	if (!e.shiftKey) {
		state.selectedNodeIds.clear();
		FontRig.draw();
		FontRig.updateStatusSelected();
	}

	// Set selection state for the visualization layer to draw the overlay
	state.isSelecting = true;
	state.selectMode = 'rect';
	state.selectStartScreen = { x: startSx, y: startSy };
	state.selectCurrentScreen = { x: startSx, y: startSy };

	FontRig.dom.canvasWrap.style.cursor = 'crosshair';

	for await (var event of stream) {
		if (event.sx === undefined) continue;

		var coords = FontRig._interactionCoords(event.absSx, event.absSy);
		state.selectCurrentScreen = { x: coords.sx, y: coords.sy };

		var ids;
		FontRig._withActiveOffset(function() {
			ids = FontRig.hitTestRect(startSx, startSy, coords.sx, coords.sy);
		});
		if (!event.shiftKey) state.selectedNodeIds.clear();
		for (var i = 0; i < ids.length; i++) state.selectedNodeIds.add(ids[i]);

		FontRig.draw();
		FontRig.updateStatusSelected();
	}

	// Finalize
	var finalCoords = state.selectCurrentScreen;
	state.isSelecting = false;
	state.selectMode = null;
	state.selectStartScreen = null;
	state.selectCurrentScreen = null;

	var finalIds;
	FontRig._withActiveOffset(function() {
		finalIds = FontRig.hitTestRect(startSx, startSy, finalCoords.x, finalCoords.y);
	});
	FontRig.selectNodes(finalIds, e.shiftKey);
	FontRig.updateCanvasCursor();
};


// ===================================================================
// Lasso selection
// ===================================================================
FontRig._handleLassoSelect = async function(stream, initialEvent, sx, sy) {
	var state = FontRig.state;
	var e = initialEvent.e;

	if (!e.shiftKey) {
		state.selectedNodeIds.clear();
		FontRig.draw();
		FontRig.updateStatusSelected();
	}

	state.isSelecting = true;
	state.selectMode = 'lasso';
	state.selectLassoPoints = [{ x: sx, y: sy }];

	FontRig.dom.canvasWrap.style.cursor = 'default';

	for await (var event of stream) {
		if (event.sx === undefined) continue;

		var coords = FontRig._interactionCoords(event.absSx, event.absSy);
		state.selectLassoPoints.push({ x: coords.sx, y: coords.sy });

		var ids;
		FontRig._withActiveOffset(function() {
			ids = FontRig.hitTestLasso(state.selectLassoPoints);
		});
		if (!event.shiftKey) state.selectedNodeIds.clear();
		for (var i = 0; i < ids.length; i++) state.selectedNodeIds.add(ids[i]);

		FontRig.draw();
		FontRig.updateStatusSelected();
	}

	// Finalize
	var lassoPoints = state.selectLassoPoints;
	state.isSelecting = false;
	state.selectMode = null;
	state.selectLassoPoints = [];

	var finalIds;
	FontRig._withActiveOffset(function() {
		finalIds = FontRig.hitTestLasso(lassoPoints);
	});
	FontRig.selectNodes(finalIds, e.shiftKey);
	FontRig.updateCanvasCursor();
};


// ===================================================================
// Hover handler (no drag — just cursor hints + preview tracking)
// ===================================================================
FontRig.handleCanvasHover = function(event) {
	var state = FontRig.state;

	// Track cursor for preview/stem
	state.previewMouse = { x: event.absSx, y: event.absSy };

	// Active draw tool: update between-click cursor preview.
	if (FontRig.drawTool && typeof FontRig.drawTool.handleHover === 'function') {
		FontRig.drawTool.handleHover(event);
	}

	// Cursor position in glyph coords
	var coords = FontRig._interactionCoords(event.absSx, event.absSy);
	var gp;
	FontRig._withActiveOffset(function() {
		gp = FontRig.screenToGlyph(coords.sx, coords.sy);
	});
	FontRig.dom.statusCursor.textContent = Math.round(gp.x) + ', ' + Math.round(gp.y);

	// Preview mode / stem measurement: redraw on hover
	if (state.previewMode || state.showStem) {
		FontRig.draw();
	}

	// Hover cursor hint
	if (!state.spaceDown) {
		var cursor = 'default';
		if (state.showNodes) {
			var hit = null;
			FontRig._withActiveOffset(function() {
				hit = FontRig.hitTestNode(coords.sx, coords.sy);
			});
			if (hit) cursor = 'move';
		}
		if (cursor === 'default' && state.showAnchors) {
			var aHit = null;
			FontRig._withActiveOffset(function() {
				aHit = FontRig.hitTestAnchor(coords.sx, coords.sy);
			});
			if (aHit !== null) cursor = 'move';
		}
		FontRig.dom.canvasWrap.style.cursor = cursor;
	}
};
