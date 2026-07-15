// ===================================================================
// FontRig — Interaction Helpers
// ===================================================================
'use strict';

// -- Cycle through layers -------------------------------------------
// Rotates the active cell's layer in gridLayers (multi-view/strip).
// Falls back to global activeLayer rotation in single view.
FontRig.cycleLayer = function(direction) {
	var state = FontRig.state;
	var glyphData = state.glyphData;
	if (!glyphData) return;

	// Build valid (non-mask) layer indices
	var valid = [];
	for (var i = 0; i < glyphData.layers.length; i++) {
		if (!FontRig.isMaskLayer(glyphData.layers[i].name)) valid.push(i);
	}
	if (valid.length <= 1) return;

	// Per-cell rotation when gridLayers is active
	if (state.gridLayers && state.gridLayers[state.activeCell.row] &&
		state.gridLayers[state.activeCell.row][state.activeCell.col] !== undefined) {
		var r = state.activeCell.row;
		var c = state.activeCell.col;
		var current = state.gridLayers[r][c];
		var pos = valid.indexOf(current);
		if (pos < 0) pos = 0;
		pos = ((pos + direction) % valid.length + valid.length) % valid.length;
		state.gridLayers[r][c] = valid[pos];

		state.activeLayer = glyphData.layers[valid[pos]].name;
		FontRig.dom.layerSelect.value = state.activeLayer;
	} else {
		// Single view: rotate global activeLayer
		var names = valid.map(function(i) { return glyphData.layers[i].name; });
		var idx = names.indexOf(state.activeLayer);
		if (idx < 0) idx = 0;
		idx = ((idx + direction) % names.length + names.length) % names.length;
		state.activeLayer = names[idx];
		FontRig.dom.layerSelect.value = state.activeLayer;
	}

	state.selectedNodeIds.clear();
	FontRig.draw();
	FontRig.updateStatusSelected();
	FontRig._notifyLayerChange(state.activeLayer);
};

// Helper: get layer object by name from glyphData
FontRig.getLayerByName = function(glyphData, name) {
	if (!glyphData) return null;
	for (var i = 0; i < glyphData.layers.length; i++) {
		if (glyphData.layers[i].name === name) return glyphData.layers[i];
	}
	return null;
};

// -- Hit test: which strip slot/cell was clicked --------------------
FontRig.getStripSlotAt = function(sx, sy) {
	var layout = FontRig.getGlyphStripLayout();
	var state = FontRig.state;

	// Convert screen to glyph x
	var gp = FontRig.screenToGlyph(sx, sy);

	for (var si = 0; si < layout.slots.length; si++) {
		var slot = layout.slots[si];

		if (slot.active && (slot.cols > 1 || slot.rows > 1)) {
			// Check each cell of expanded active glyph
			// In base-pan glyph space: row r baseline is at y = r * rowH
			var desc = FontRig.font ? Math.abs(FontRig.font.metrics.descender) : 200;
			for (var r = 0; r < slot.rows; r++) {
				for (var c = 0; c < slot.cols; c++) {
					var cx = slot.x + c * (slot.advW + FontRig.getCurrentTheme().grid.stripGap);
					var cellYlo = r * layout.rowH - desc;
					var cellYhi = (r + 1) * layout.rowH;
					if (gp.x >= cx && gp.x <= cx + slot.advW &&
						gp.y >= cellYlo && gp.y <= cellYhi) {
						return { slotIdx: si, slot: slot, row: r, col: c };
					}
				}
			}
		}

		// Simple slot bounds check (baseline row)
		if (gp.x >= slot.x && gp.x <= slot.x + slot.w) {
			return { slotIdx: si, slot: slot, row: 0, col: 0 };
		}
	}

	return null;
};













// -- Preview button sync --------------------------------------------
FontRig.updatePreviewButton = function() {
	var btn = document.getElementById('btn-preview');
	if (btn) btn.classList.toggle('active', FontRig.state.previewLocked);
};

// -- Selection (multi-node) -----------------------------------------
FontRig.clearSelection = function() {
	FontRig.state.selectedNodeIds.clear();
	FontRig.draw();
	FontRig.updateStatusSelected();
};

// Select a single node (replaces selection unless shift is held)
FontRig.selectNode = function(nodeId, additive) {
	const sel = FontRig.state.selectedNodeIds;

	if (!nodeId) {
		if (!additive) sel.clear();
	} else if (additive) {
		// Toggle: add if missing, remove if present
		if (sel.has(nodeId)) {
			sel.delete(nodeId);
		} else {
			sel.add(nodeId);
		}
	} else {
		sel.clear();
		sel.add(nodeId);
	}

	// Highlight first selected in XML panel (canvas → XML, one way)
	if (sel.size > 0) {
		const first = sel.values().next().value;
		FontRig.highlightXmlNode(first);
	}

	FontRig.draw();
	FontRig.updateStatusSelected();
};

// Select multiple nodes (from rect/lasso), replacing or adding
FontRig.selectNodes = function(nodeIds, additive) {
	const sel = FontRig.state.selectedNodeIds;

	if (!additive) sel.clear();
	for (const id of nodeIds) {
		sel.add(id);
	}

	if (sel.size > 0) {
		const first = sel.values().next().value;
		FontRig.highlightXmlNode(first);
	}

	FontRig.draw();
	FontRig.updateStatusSelected();
};

FontRig.updateStatusSelected = function() {
	const sel = FontRig.state.selectedNodeIds;
	if (sel.size === 0) {
		FontRig.dom.statusSelected.textContent = '\u2013';
		return;
	}

	if (sel.size === 1) {
		const nodeId = sel.values().next().value;
		const ref = FontRig.findNodeById(nodeId);
		if (ref) {
			FontRig.dom.statusSelected.textContent =
				nodeId + ' (' + ref.node.x + ', ' + ref.node.y + ') ' + ref.node.type;
		}
	} else {
		FontRig.dom.statusSelected.textContent = sel.size + ' nodes';
	}
};
































// Insert a node on the segment identified by hitTestSegment result.
// Modifies the contour's node array in place.
FontRig.insertNodeOnSegment = function(hit) {
	if (!hit || !hit.contour) return;

	// Hobby contours store knots, not bezier nodes. Insert into the
	// knot list and re-solve; the bezier nodes are rebuilt by the
	// solver on the next pass.
	if (hit.contour.kind === 'hobby') {
		FontRig._insertKnotOnSegment(hit);
		return;
	}

	var nodes = hit.contour.nodes;
	var seg = hit.seg;
	var round = function(v) { return Math.round(v * 10) / 10; };

	if (seg.type === 'line') {
		// Insert new on-curve at the interpolated position
		var newNode = {
			type: 'on', smooth: false,
			x: round(hit.x), y: round(hit.y)
		};
		// Insert after startIdx
		var insertAt = seg.startIdx + 1;
		// Handle wraparound: if endIdx < startIdx, insert at end
		if (seg.endIdx < seg.startIdx) insertAt = nodes.length;
		nodes.splice(insertAt, 0, newNode);
	} else if (seg.type === 'cubic') {
		var split = FontRig._splitCubic(seg.pts, hit.t);
		var L = split.left;   // [p0, a, d, m]
		var R = split.right;  // [m, e, c, p3]

		// New nodes to replace the segment interior:
		// Original: [on(start), off1, off2, on(end)]
		// New:      [on(start), offL1, offL2, on(new), offR1, offR2, on(end)]
		// We replace off1, off2 with offL1, offL2, on(new), offR1, offR2

		var newOff1  = { type: 'curve', x: round(L[1].x), y: round(L[1].y) };
		var newOff2  = { type: 'curve', x: round(L[2].x), y: round(L[2].y) };
		var newOn    = { type: 'on', smooth: true, x: round(L[3].x), y: round(L[3].y) };
		var newOff3  = { type: 'curve', x: round(R[1].x), y: round(R[1].y) };
		var newOff4  = { type: 'curve', x: round(R[2].x), y: round(R[2].y) };

		// Find the actual positions of offIdx1 and offIdx2
		// They may wrap around, so we need to handle that carefully
		var idx1 = seg.offIdx1;
		var idx2 = seg.offIdx2;

		// Replace the two off-curves with the 5 new nodes
		if (idx2 === idx1 + 1) {
			// Normal case: consecutive indices
			nodes.splice(idx1, 2, newOff1, newOff2, newOn, newOff3, newOff4);
		} else {
			// Wraparound case: off1 is near end, off2 wraps to start
			// Remove from idx1 to end, then from 0 to idx2+1
			// Insert the new nodes at idx1
			nodes.splice(idx1, nodes.length - idx1, newOff1, newOff2, newOn, newOff3, newOff4);
			nodes.splice(0, idx2 + 1);
		}
	} else if (seg.type === 'quadratic') {
		// De Casteljau split for quadratic: P0,Q1,P2 at t
		var t = hit.t, u = 1 - t;
		var p0 = seg.pts[0], q1 = seg.pts[1], p2 = seg.pts[2];
		var a = { x: u * p0.x + t * q1.x, y: u * p0.y + t * q1.y };
		var b = { x: u * q1.x + t * p2.x, y: u * q1.y + t * p2.y };
		var m = { x: u * a.x + t * b.x, y: u * a.y + t * b.y };

		// Replace single off-curve with: offL, on(new), offR
		var newOffL = { type: 'off', smooth: false, x: round(a.x), y: round(a.y) };
		var newOn   = { type: 'on', smooth: true, x: round(m.x), y: round(m.y) };
		var newOffR = { type: 'off', smooth: false, x: round(b.x), y: round(b.y) };

		nodes.splice(seg.offIdx, 1, newOffL, newOn, newOffR);
	}

	// Rebuild IDs and redraw
	FontRig.state.selectedNodeIds.clear();
	FontRig.invalidatePathCache();
	FontRig.draw();
	FontRig.updateStatusSelected();
};

// -- Segment type conversions ----------------------------------------
// Helper: remove off-curve nodes from a segment, leaving on-curves as a line.
// Works for both cubic (2 off-curves) and quadratic (1 off-curve).
FontRig.convertSegmentToLine = function(hit) {
	if (!hit || !hit.contour) return;
	var nodes = hit.contour.nodes;
	var seg = hit.seg;
	if (seg.type === 'line') return;

	// Collect off-curve indices to remove (descending order for safe splice)
	var toRemove = [];
	if (seg.type === 'cubic') {
		toRemove = [seg.offIdx1, seg.offIdx2];
	} else if (seg.type === 'quadratic') {
		toRemove = [seg.offIdx];
	}
	toRemove.sort(function(a, b) { return b - a; });
	for (var i = 0; i < toRemove.length; i++) {
		nodes.splice(toRemove[i], 1);
	}

	FontRig.state.selectedNodeIds.clear();
	FontRig.invalidatePathCache();
	FontRig.draw();
	FontRig.updateStatusSelected();
};

// Convert line or quadratic segment to cubic bezier.
// Line: insert two cubic handles at 1/3 and 2/3.
// Quadratic: degree elevation — replace single off with two curve nodes.
FontRig.convertSegmentToCubic = function(hit) {
	if (!hit || !hit.contour) return;
	var nodes = hit.contour.nodes;
	var seg = hit.seg;
	if (seg.type === 'cubic') return;

	var round = function(v) { return Math.round(v * 10) / 10; };

	if (seg.type === 'line') {
		var p0 = seg.pts[0], p3 = seg.pts[1];
		var h1 = { type: 'curve', smooth: false,
			x: round(p0.x + (p3.x - p0.x) / 3),
			y: round(p0.y + (p3.y - p0.y) / 3)
		};
		var h2 = { type: 'curve', smooth: false,
			x: round(p0.x + 2 * (p3.x - p0.x) / 3),
			y: round(p0.y + 2 * (p3.y - p0.y) / 3)
		};
		// Insert after startIdx
		var insertAt = seg.startIdx + 1;
		if (seg.endIdx < seg.startIdx) insertAt = nodes.length;
		nodes.splice(insertAt, 0, h1, h2);

	} else if (seg.type === 'quadratic') {
		// Degree elevation: Q0,Q1,Q2 → P0,P1,P2,P3
		// P1 = Q0 + 2/3*(Q1-Q0), P2 = Q2 + 2/3*(Q1-Q2)
		var q0 = seg.pts[0], q1 = seg.pts[1], q2 = seg.pts[2];
		var p1 = {
			x: round(q0.x + 2/3 * (q1.x - q0.x)),
			y: round(q0.y + 2/3 * (q1.y - q0.y))
		};
		var p2 = {
			x: round(q2.x + 2/3 * (q1.x - q2.x)),
			y: round(q2.y + 2/3 * (q1.y - q2.y))
		};
		// Replace the single off-curve with two curve nodes
		nodes.splice(seg.offIdx, 1,
			{ type: 'curve', smooth: false, x: p1.x, y: p1.y },
			{ type: 'curve', smooth: false, x: p2.x, y: p2.y }
		);
	}

	FontRig.state.selectedNodeIds.clear();
	FontRig.invalidatePathCache();
	FontRig.draw();
	FontRig.updateStatusSelected();
};

// Convert cubic segment to quadratic bezier.
// Approximation: Q1 = (3*(P1+P2) - (P0+P3)) / 4
FontRig.convertSegmentToQuadratic = function(hit) {
	if (!hit || !hit.contour) return;
	var nodes = hit.contour.nodes;
	var seg = hit.seg;
	if (seg.type !== 'cubic') return;

	var round = function(v) { return Math.round(v * 10) / 10; };
	var p0 = seg.pts[0], p1 = seg.pts[1], p2 = seg.pts[2], p3 = seg.pts[3];

	var q1 = {
		x: round((3 * (p1.x + p2.x) - (p0.x + p3.x)) / 4),
		y: round((3 * (p1.y + p2.y) - (p0.y + p3.y)) / 4)
	};

	// Replace two curve nodes with one off node
	// Remove in descending index order, then insert
	var idx1 = seg.offIdx1, idx2 = seg.offIdx2;
	if (idx2 === idx1 + 1) {
		nodes.splice(idx1, 2, { type: 'off', smooth: false, x: q1.x, y: q1.y });
	} else {
		// Wraparound: remove from end first, then start
		nodes.splice(idx1, nodes.length - idx1, { type: 'off', smooth: false, x: q1.x, y: q1.y });
		nodes.splice(0, idx2 + 1);
	}

	FontRig.state.selectedNodeIds.clear();
	FontRig.invalidatePathCache();
	FontRig.draw();
	FontRig.updateStatusSelected();
};

// -- Slide node along contour ----------------------------------------
// Hold S while dragging an on-curve node to slide it along the path
// defined by its two adjacent segments. Both segments are re-split
// at the new position using de Casteljau + least-squares fitting.

// -- Slide node along contour ----------------------------------------
// Two modes:
//   'curve' (S): slide along bezier segments only
//   'line'  (A): slide along line segments (with extrapolation beyond endpoints)
//
// Each mode only considers segment types it cares about.
// When a node connects a line and a curve, only the matching side is
// used for sliding; the other side is reconstructed via least-squares.

FontRig.initSlideMode = function(nodeId, mode) {
	mode = mode || 'curve';
	var ref = FontRig.findNodeById(nodeId);
	if (!ref || ref.node.type !== 'on') return null;

	var contour = ref.contour;
	var nodes = contour.nodes;
	var n = nodes.length;

	var m = nodeId.match(/^c(\d+)_n(\d+)$/);
	if (!m) return null;
	var ci = parseInt(m[1]);
	var ni = parseInt(m[2]);

	var incoming = FontRig._analyzeIncoming(nodes, n, ni);
	var outgoing = FontRig._analyzeOutgoing(nodes, n, ni);

	// Determine which sides are active based on mode
	var activeIn = false, activeOut = false;
	if (mode === 'curve') {
		activeIn = (incoming.type === 'cubic');
		activeOut = (outgoing.type === 'cubic');
	} else if (mode === 'line') {
		activeIn = (incoming.type === 'line');
		activeOut = (outgoing.type === 'line');
	}

	// Need at least one active side
	if (!activeIn && !activeOut) return null;

	// Build original control points for cubic sides (needed for reconstruction)
	var inH = incoming.handleIndices;
	var outH = outgoing.handleIndices;
	var inPts = null, outPts = null;

	if (incoming.type === 'cubic' && inH.length >= 2) {
		inPts = [
			{ x: nodes[incoming.prevOnIdx].x, y: nodes[incoming.prevOnIdx].y },
			{ x: nodes[inH[inH.length - 1]].x, y: nodes[inH[inH.length - 1]].y },
			{ x: nodes[inH[0]].x, y: nodes[inH[0]].y },
			{ x: nodes[ni].x, y: nodes[ni].y }
		];
	}
	if (outgoing.type === 'cubic' && outH.length >= 2) {
		outPts = [
			{ x: nodes[ni].x, y: nodes[ni].y },
			{ x: nodes[outH[0]].x, y: nodes[outH[0]].y },
			{ x: nodes[outH[outH.length - 1]].x, y: nodes[outH[outH.length - 1]].y },
			{ x: nodes[outgoing.nextOnIdx].x, y: nodes[outgoing.nextOnIdx].y }
		];
	}

	// Endpoints for line segments
	var prevOn = { x: nodes[incoming.prevOnIdx].x, y: nodes[incoming.prevOnIdx].y };
	var onNode = { x: nodes[ni].x, y: nodes[ni].y };
	var nextOn = { x: nodes[outgoing.nextOnIdx].x, y: nodes[outgoing.nextOnIdx].y };

	// Build polyline from active sides only
	var numSamples = 60;
	var polyline = [];

	// When only one curve side is active (line-curve node), allow extrapolation.
	// Two curves: strict [0,1] to avoid boundary jitter between segments.
	var canExtrapolate = (mode === 'curve') && (activeIn !== activeOut);

	if (activeIn) {
		if (mode === 'line') {
			// Straight line: prevOn → node, extended 50% beyond each end
			for (var i = 0; i <= numSamples; i++) {
				var t = -0.5 + 2.0 * i / numSamples;
				polyline.push({
					x: prevOn.x + t * (onNode.x - prevOn.x),
					y: prevOn.y + t * (onNode.y - prevOn.y),
					seg: 0, t: t
				});
			}
		} else {
			// Cubic: extend range if single active side
			var tMin = canExtrapolate ? -0.4 : 0;
			var tMax = canExtrapolate ? 1.4 : 1;
			for (var i = 0; i <= numSamples; i++) {
				var t = tMin + (tMax - tMin) * i / numSamples;
				var pt = FontRig._sampleCubic(inPts[0], inPts[1], inPts[2], inPts[3], t);
				polyline.push({ x: pt.x, y: pt.y, seg: 0, t: t });
			}
		}
	}

	if (activeOut) {
		var skip = (activeIn) ? 1 : 0; // skip junction duplicate
		if (mode === 'line') {
			for (var i = skip; i <= numSamples; i++) {
				var t = -0.5 + 2.0 * i / numSamples;
				polyline.push({
					x: onNode.x + t * (nextOn.x - onNode.x),
					y: onNode.y + t * (nextOn.y - onNode.y),
					seg: 1, t: t
				});
			}
		} else {
			// Cubic: extend range if single active side
			var tMin = canExtrapolate ? -0.4 : 0;
			var tMax = canExtrapolate ? 1.4 : 1;
			for (var i = skip; i <= numSamples; i++) {
				var t = tMin + (tMax - tMin) * i / numSamples;
				var pt = FontRig._sampleCubic(outPts[0], outPts[1], outPts[2], outPts[3], t);
				polyline.push({ x: pt.x, y: pt.y, seg: 1, t: t });
			}
		}
	}

	if (polyline.length < 2) return null;

	// Arc-length parameterize
	var arcLens = [0];
	for (var i = 1; i < polyline.length; i++) {
		var dx = polyline[i].x - polyline[i - 1].x;
		var dy = polyline[i].y - polyline[i - 1].y;
		arcLens.push(arcLens[i - 1] + Math.sqrt(dx * dx + dy * dy));
	}

	return {
		contour: contour,
		nodeIdx: ni,
		ci: ci,
		mode: mode,
		incoming: incoming,
		outgoing: outgoing,
		activeIn: activeIn,
		activeOut: activeOut,
		inPts: inPts,
		outPts: outPts,
		prevOn: prevOn,
		onNode: onNode,
		nextOn: nextOn,
		inHandleIndices: inH,
		outHandleIndices: outH,
		polyline: polyline,
		arcLens: arcLens,
		totalLen: arcLens[arcLens.length - 1],
		canExtrapolate: canExtrapolate
	};
};

// Project glyph point onto the slide polyline.
FontRig._projectOntoSlidePolyline = function(slideData, gx, gy) {
	var poly = slideData.polyline;
	var bestDist = Infinity;
	var bestIdx = 0;

	for (var i = 0; i < poly.length; i++) {
		var dx = poly[i].x - gx, dy = poly[i].y - gy;
		var d = dx * dx + dy * dy;
		if (d < bestDist) { bestDist = d; bestIdx = i; }
	}

	// Refine between adjacent vertices
	var lo = Math.max(0, bestIdx - 1);
	var hi = Math.min(poly.length - 1, bestIdx + 1);
	var bestFrac = bestIdx;
	bestDist = Infinity;
	for (var f = lo; f <= hi; f += 0.05) {
		var fi = Math.floor(f);
		var ff = f - fi;
		if (fi >= poly.length - 1) { fi = poly.length - 2; ff = 1; }
		var px = poly[fi].x + ff * (poly[fi + 1].x - poly[fi].x);
		var py = poly[fi].y + ff * (poly[fi + 1].y - poly[fi].y);
		var dx = px - gx, dy = py - gy;
		var d = dx * dx + dy * dy;
		if (d < bestDist) { bestDist = d; bestFrac = f; }
	}

	var fi = Math.floor(bestFrac);
	var ff = bestFrac - fi;
	if (fi >= poly.length - 1) { fi = poly.length - 2; ff = 1; }
	var p = poly[fi], pn = poly[fi + 1];

	var seg, t;
	if (p.seg === pn.seg) {
		seg = p.seg;
		t = p.t + ff * (pn.t - p.t);
	} else {
		if (ff < 0.5) { seg = p.seg; t = p.t; }
		else { seg = pn.seg; t = pn.t; }
	}

	// No clamping here — polyline range controls bounds,
	// performSlide handles in-range vs extrapolated

	// Evaluate exact position
	var pt;
	if (seg === 0) {
		if (slideData.mode === 'line' && slideData.activeIn) {
			pt = FontRig._sampleLine(slideData.prevOn, slideData.onNode, t);
		} else if (slideData.inPts) {
			pt = FontRig._sampleCubic(slideData.inPts[0], slideData.inPts[1], slideData.inPts[2], slideData.inPts[3], t);
		} else {
			pt = { x: poly[fi].x + ff * (pn.x - poly[fi].x), y: poly[fi].y + ff * (pn.y - poly[fi].y) };
		}
	} else {
		if (slideData.mode === 'line' && slideData.activeOut) {
			pt = FontRig._sampleLine(slideData.onNode, slideData.nextOn, t);
		} else if (slideData.outPts) {
			pt = FontRig._sampleCubic(slideData.outPts[0], slideData.outPts[1], slideData.outPts[2], slideData.outPts[3], t);
		} else {
			pt = { x: poly[fi].x + ff * (pn.x - poly[fi].x), y: poly[fi].y + ff * (pn.y - poly[fi].y) };
		}
	}

	return { seg: seg, t: t, x: pt.x, y: pt.y };
};

// Perform the slide: move node, reconstruct handles on both sides.
FontRig.performSlide = function(slideData, gx, gy) {
	var proj = FontRig._projectOntoSlidePolyline(slideData, gx, gy);
	var nodes = slideData.contour.nodes;
	var round = function(v) { return Math.round(v * 10) / 10; };
	var ni = slideData.nodeIdx;
	var inH = slideData.inHandleIndices;
	var outH = slideData.outHandleIndices;

	// Move node to projected position
	nodes[ni].x = round(proj.x);
	nodes[ni].y = round(proj.y);
	var newNode = { x: proj.x, y: proj.y };

	// -- LINE mode: just move the on-curve, nothing else --
	if (slideData.mode === 'line') {
		FontRig.invalidatePathCache();
		return;
	}

	// -- CURVE mode: de Casteljau for all t values --
	// Works for extrapolated t too — pure polynomial math
	if (slideData.mode === 'curve') {
		var t = proj.t;

		// Two curves: clamp to safe range (no extrapolation allowed)
		if (!slideData.canExtrapolate) {
			t = Math.max(0.02, Math.min(0.98, t));
		}

		if (proj.seg === 0 && slideData.inPts) {
			// De Casteljau works for any t — exact even when extrapolated
			var split = FontRig._splitCubic(slideData.inPts, t);
			nodes[ni].x = round(split.left[3].x);
			nodes[ni].y = round(split.left[3].y);
			newNode = { x: split.left[3].x, y: split.left[3].y };

			nodes[inH[inH.length - 1]].x = round(split.left[1].x);
			nodes[inH[inH.length - 1]].y = round(split.left[1].y);
			nodes[inH[0]].x = round(split.left[2].x);
			nodes[inH[0]].y = round(split.left[2].y);

			// Outgoing cubic (only exists in two-curve case): combined refit
			if (slideData.outgoing.type === 'cubic' && slideData.outPts && outH.length >= 2) {
				var samples = [];
				for (var i = 0; i <= 30; i++) {
					samples.push(FontRig._sampleCubic(split.right[0], split.right[1], split.right[2], split.right[3], i / 30));
				}
				for (var i = 1; i <= 30; i++) {
					samples.push(FontRig._sampleCubic(slideData.outPts[0], slideData.outPts[1], slideData.outPts[2], slideData.outPts[3], i / 30));
				}
				FontRig._fitSamplesToSide(nodes, outH, samples, newNode, slideData.nextOn, 'out');
			}
		} else if (proj.seg === 1 && slideData.outPts) {
			var split = FontRig._splitCubic(slideData.outPts, t);
			nodes[ni].x = round(split.right[0].x);
			nodes[ni].y = round(split.right[0].y);
			newNode = { x: split.right[0].x, y: split.right[0].y };

			nodes[outH[0]].x = round(split.right[1].x);
			nodes[outH[0]].y = round(split.right[1].y);
			nodes[outH[outH.length - 1]].x = round(split.right[2].x);
			nodes[outH[outH.length - 1]].y = round(split.right[2].y);

			// Incoming cubic (only exists in two-curve case): combined refit
			if (slideData.incoming.type === 'cubic' && slideData.inPts && inH.length >= 2) {
				var samples = [];
				for (var i = 0; i <= 30; i++) {
					samples.push(FontRig._sampleCubic(slideData.inPts[0], slideData.inPts[1], slideData.inPts[2], slideData.inPts[3], i / 30));
				}
				for (var i = 1; i <= 30; i++) {
					samples.push(FontRig._sampleCubic(split.left[0], split.left[1], split.left[2], split.left[3], i / 30));
				}
				FontRig._fitSamplesToSide(nodes, inH, samples, slideData.prevOn, newNode, 'in');
			}
		}
		FontRig.invalidatePathCache();
		return;
	}

};

// Fit a set of samples into a cubic between startPt and endPt,
// then assign the result to the handle nodes.
FontRig._fitSamplesToSide = function(nodes, handleIndices, samples, startPt, endPt, direction) {
	if (samples.length < 4) return;

	var params = FontRig._arcLengthParameterize(samples);
	var fit = FontRig._fitCubicUnconstrained(samples, params, startPt, endPt);
	for (var iter = 0; iter < 3; iter++) {
		params = FontRig._reparameterize(samples, params, startPt, fit.P1, fit.P2, endPt);
		fit = FontRig._fitCubicUnconstrained(samples, params, startPt, endPt);
	}

	if (direction === 'in') {
		// incoming handleIndices: [0] = closer to node, [last] = closer to prevOn
		nodes[handleIndices[handleIndices.length - 1]].x = fit.P1.x;
		nodes[handleIndices[handleIndices.length - 1]].y = fit.P1.y;
		nodes[handleIndices[0]].x = fit.P2.x;
		nodes[handleIndices[0]].y = fit.P2.y;
	} else {
		// outgoing handleIndices: [0] = closer to node, [last] = closer to nextOn
		nodes[handleIndices[0]].x = fit.P1.x;
		nodes[handleIndices[0]].y = fit.P1.y;
		nodes[handleIndices[handleIndices.length - 1]].x = fit.P2.x;
		nodes[handleIndices[handleIndices.length - 1]].y = fit.P2.y;
	}
};

// -- Keyboard slide (S/A + arrow keys) -------------------------------
// When S or A is held and a single on-curve node is selected,
// arrow keys slide the node along curves (S) or lines (A) instead
// of doing a straight move. Returns true if slide was performed.
//
// The slide data is lazily initialized and cached in state._kbSlideData
// (active layer) and state._kbSlideDataLayers (sync layers).
// Cleared when S/A is released (handled in events.js keyup).
FontRig._tryKeyboardSlide = function(dirX, dirY, multiplier) {
	var state = FontRig.state;

	// Check if S or A is held
	var mode = null;
	if (state.sKeyDown) mode = 'curve';
	else if (state.aKeyDown) mode = 'line';
	if (!mode) return false;

	// Need exactly one on-curve node selected
	if (state.selectedNodeIds.size !== 1) return false;
	var nodeId = state.selectedNodeIds.values().next().value;

	// Lazily initialize keyboard slide data for active layer
	if (!state._kbSlideData || state._kbSlideData.nodeId !== nodeId || state._kbSlideData.mode !== mode) {
		var sd = FontRig.initSlideMode(nodeId, mode);
		if (!sd) return false;
		var ref = FontRig.findNodeById(nodeId);
		if (!ref) return false;
		sd.nodeId = nodeId;
		sd.currentArcLen = FontRig._findArcLenForNode(sd, ref.node.x, ref.node.y);
		state._kbSlideData = sd;

		// Also init slide data for sync layers
		state._kbSlideDataLayers = [];
		var prefs = FontRig.movementPrefs;
		if (prefs.syncMovement && FontRig.scope.layerMode !== 'active') {
			var layers = FontRig.getSyncLayers();
			for (var li = 1; li < layers.length; li++) {
				var layerSd = FontRig._initSlideModeInLayer(layers[li], nodeId, mode);
				if (layerSd) {
					layerSd.layer = layers[li];
					state._kbSlideDataLayers.push(layerSd);
				}
			}
		}
	}

	var sd = state._kbSlideData;
	var prefs = FontRig.movementPrefs;
	var step = prefs.getStepForLayer(state.activeLayer);

	// Compute the delta in glyph units
	var dx = dirX * step.x * multiplier;
	var dy = dirY * step.y * multiplier;

	// Project: take current node position, add delta, project onto polyline
	var ref = FontRig.findNodeById(nodeId);
	if (!ref) return false;

	var targetX = ref.node.x + dx;
	var targetY = ref.node.y + dy;

	// Slide on active layer
	FontRig.performSlide(sd, targetX, targetY);

	// Slide on sync layers
	if (state._kbSlideDataLayers) {
		for (var li = 0; li < state._kbSlideDataLayers.length; li++) {
			var layerSd = state._kbSlideDataLayers[li];
			var layerStep = prefs.getStepForLayer(layerSd.layer.name);
			var ldx = dirX * layerStep.x * multiplier;
			var ldy = dirY * layerStep.y * multiplier;

			// Find the node in this layer
			var layerRef = FontRig._findNodeInLayer(layerSd.layer, nodeId);
			if (!layerRef) continue;

			var layerTargetX = layerRef.node.x + ldx;
			var layerTargetY = layerRef.node.y + ldy;

			FontRig.performSlide(layerSd, layerTargetX, layerTargetY);
			FontRig.invalidatePathCache(layerSd.layer);
		}
	}

	FontRig.draw();
	FontRig.updateStatusSelected();
	return true;
};

// Initialize slide mode for a specific layer (not just the active layer).
// Same logic as initSlideMode but finds the contour in the given layer.
FontRig._initSlideModeInLayer = function(layer, nodeId, mode) {
	mode = mode || 'curve';
	var m = nodeId.match(/^c(\d+)_n(\d+)$/);
	if (!m) return null;
	var ci = parseInt(m[1]);
	var ni = parseInt(m[2]);

	var cRef = FontRig._findContourInLayer(layer, ci);
	if (!cRef) return null;

	var contour = cRef.contour;
	var nodes = contour.nodes;
	var n = nodes.length;

	if (ni >= n || nodes[ni].type !== 'on') return null;

	var incoming = FontRig._analyzeIncoming(nodes, n, ni);
	var outgoing = FontRig._analyzeOutgoing(nodes, n, ni);

	var activeIn = false, activeOut = false;
	if (mode === 'curve') {
		activeIn = (incoming.type === 'cubic');
		activeOut = (outgoing.type === 'cubic');
	} else if (mode === 'line') {
		activeIn = (incoming.type === 'line');
		activeOut = (outgoing.type === 'line');
	}

	if (!activeIn && !activeOut) return null;

	var inH = incoming.handleIndices;
	var outH = outgoing.handleIndices;
	var inPts = null, outPts = null;

	if (incoming.type === 'cubic' && inH.length >= 2) {
		inPts = [
			{ x: nodes[incoming.prevOnIdx].x, y: nodes[incoming.prevOnIdx].y },
			{ x: nodes[inH[inH.length - 1]].x, y: nodes[inH[inH.length - 1]].y },
			{ x: nodes[inH[0]].x, y: nodes[inH[0]].y },
			{ x: nodes[ni].x, y: nodes[ni].y }
		];
	}
	if (outgoing.type === 'cubic' && outH.length >= 2) {
		outPts = [
			{ x: nodes[ni].x, y: nodes[ni].y },
			{ x: nodes[outH[0]].x, y: nodes[outH[0]].y },
			{ x: nodes[outH[outH.length - 1]].x, y: nodes[outH[outH.length - 1]].y },
			{ x: nodes[outgoing.nextOnIdx].x, y: nodes[outgoing.nextOnIdx].y }
		];
	}

	var prevOn = { x: nodes[incoming.prevOnIdx].x, y: nodes[incoming.prevOnIdx].y };
	var onNode = { x: nodes[ni].x, y: nodes[ni].y };
	var nextOn = { x: nodes[outgoing.nextOnIdx].x, y: nodes[outgoing.nextOnIdx].y };

	var numSamples = 60;
	var polyline = [];
	var canExtrapolate = (mode === 'curve') && (activeIn !== activeOut);

	if (activeIn) {
		if (mode === 'line') {
			for (var i = 0; i <= numSamples; i++) {
				var t = -0.5 + 2.0 * i / numSamples;
				polyline.push({
					x: prevOn.x + t * (onNode.x - prevOn.x),
					y: prevOn.y + t * (onNode.y - prevOn.y),
					seg: 0, t: t
				});
			}
		} else {
			var tMin = canExtrapolate ? -0.4 : 0;
			var tMax = canExtrapolate ? 1.4 : 1;
			for (var i = 0; i <= numSamples; i++) {
				var t = tMin + (tMax - tMin) * i / numSamples;
				var pt = FontRig._sampleCubic(inPts[0], inPts[1], inPts[2], inPts[3], t);
				polyline.push({ x: pt.x, y: pt.y, seg: 0, t: t });
			}
		}
	}

	if (activeOut) {
		var skip = (activeIn) ? 1 : 0;
		if (mode === 'line') {
			for (var i = skip; i <= numSamples; i++) {
				var t = -0.5 + 2.0 * i / numSamples;
				polyline.push({
					x: onNode.x + t * (nextOn.x - onNode.x),
					y: onNode.y + t * (nextOn.y - onNode.y),
					seg: 1, t: t
				});
			}
		} else {
			var tMin = canExtrapolate ? -0.4 : 0;
			var tMax = canExtrapolate ? 1.4 : 1;
			for (var i = skip; i <= numSamples; i++) {
				var t = tMin + (tMax - tMin) * i / numSamples;
				var pt = FontRig._sampleCubic(outPts[0], outPts[1], outPts[2], outPts[3], t);
				polyline.push({ x: pt.x, y: pt.y, seg: 1, t: t });
			}
		}
	}

	if (polyline.length < 2) return null;

	var arcLens = [0];
	for (var i = 1; i < polyline.length; i++) {
		var dx = polyline[i].x - polyline[i - 1].x;
		var dy = polyline[i].y - polyline[i - 1].y;
		arcLens.push(arcLens[i - 1] + Math.sqrt(dx * dx + dy * dy));
	}

	return {
		contour: contour,
		nodeIdx: ni,
		ci: ci,
		mode: mode,
		incoming: incoming,
		outgoing: outgoing,
		activeIn: activeIn,
		activeOut: activeOut,
		inPts: inPts,
		outPts: outPts,
		prevOn: prevOn,
		onNode: onNode,
		nextOn: nextOn,
		inHandleIndices: inH,
		outHandleIndices: outH,
		polyline: polyline,
		arcLens: arcLens,
		totalLen: arcLens[arcLens.length - 1],
		canExtrapolate: canExtrapolate
	};
};

// Find arc-length position of a point on the slide polyline.
FontRig._findArcLenForNode = function(slideData, nx, ny) {
	var poly = slideData.polyline;
	var arcLens = slideData.arcLens;
	var bestDist = Infinity;
	var bestArc = 0;

	for (var i = 0; i < poly.length; i++) {
		var dx = poly[i].x - nx, dy = poly[i].y - ny;
		var d = dx * dx + dy * dy;
		if (d < bestDist) {
			bestDist = d;
			bestArc = arcLens[i];
		}
	}
	return bestArc;
};

// -- Retract handles -------------------------------------------------
// If on-curve selected: retract both adjacent handles to on-curve pos.
// If handle selected: retract only that handle.
FontRig.retractHandles = function() {
	var layer = FontRig.getActiveLayer();
	if (!layer) return;

	var sel = FontRig.state.selectedNodeIds;
	if (sel.size === 0) return;

	var ci = 0;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			var nodes = shape.contours[ki].nodes;
			var n = nodes.length;

			for (var ni = 0; ni < n; ni++) {
				var id = 'c' + ci + '_n' + ni;
				if (!sel.has(id)) continue;

				if (nodes[ni].type === 'on') {
					// On-curve: retract adjacent handles
					var prevIdx = (ni - 1 + n) % n;
					var nextIdx = (ni + 1) % n;
					if (nodes[prevIdx].type !== 'on') {
						nodes[prevIdx].x = nodes[ni].x;
						nodes[prevIdx].y = nodes[ni].y;
					}
					if (nodes[nextIdx].type !== 'on') {
						nodes[nextIdx].x = nodes[ni].x;
						nodes[nextIdx].y = nodes[ni].y;
					}
				} else {
					// Handle: find parent on-curve, retract to it
					var prevIdx = (ni - 1 + n) % n;
					var nextIdx = (ni + 1) % n;
					var parentIdx = -1;
					if (nodes[prevIdx].type === 'on') parentIdx = prevIdx;
					else if (nodes[nextIdx].type === 'on') parentIdx = nextIdx;
					if (parentIdx >= 0) {
						nodes[ni].x = nodes[parentIdx].x;
						nodes[ni].y = nodes[parentIdx].y;
					}
				}
			}
			ci++;
		}
	}

	FontRig.invalidatePathCache();
	FontRig.draw();
	FontRig.updateStatusSelected();
};

// -- Constrained smooth movement -------------------------------------
// Compute unit tangent vectors for smooth on-curve nodes at drag start.
// Tangent = direction through the two adjacent handles (from their
// start positions). Returns Map<nodeId, {tx, ty}>.
FontRig.computeDragTangents = function(dragStartPositions) {
	var tangents = new Map();
	var layer = FontRig.getActiveLayer();
	if (!layer) return tangents;

	var ci = 0;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			var nodes = shape.contours[ki].nodes;
			var n = nodes.length;

			for (var ni = 0; ni < n; ni++) {
				var id = 'c' + ci + '_n' + ni;
				if (!dragStartPositions.has(id)) continue;
				if (nodes[ni].type !== 'on') continue;
				if (!nodes[ni].smooth) continue;

				var prevIdx = (ni - 1 + n) % n;
				var nextIdx = (ni + 1) % n;
				var prevIsOn = (nodes[prevIdx].type === 'on');
				var nextIsOn = (nodes[nextIdx].type === 'on');

				// Both sides are lines — no tangent constraint
				if (prevIsOn && nextIsOn) continue;

				var prevId = 'c' + ci + '_n' + prevIdx;
				var nextId = 'c' + ci + '_n' + nextIdx;
				var onStart = dragStartPositions.get(id);
				var dx, dy;
				var isLocked = true; // line-curve: always constrained

				if (!prevIsOn && !nextIsOn) {
					// Curve on both sides: tangent from handle to handle
					// Active only with Ctrl held (locked: false)
					var prevPos = dragStartPositions.has(prevId) ? dragStartPositions.get(prevId) : nodes[prevIdx];
					var nextPos = dragStartPositions.has(nextId) ? dragStartPositions.get(nextId) : nodes[nextIdx];
					dx = nextPos.x - prevPos.x;
					dy = nextPos.y - prevPos.y;
					isLocked = false;
				} else {
					// Line on one side, curve on the other:
					// tangent locked to line direction
					var lineIdx, lineId;
					if (prevIsOn) {
						lineIdx = prevIdx; lineId = prevId;
					} else {
						lineIdx = nextIdx; lineId = nextId;
					}
					// If the line neighbor is also selected, both ends
					// move together — constraint is meaningless, skip
					if (FontRig.state.selectedNodeIds.has(lineId)) continue;
					// Line neighbor's start position (or current if not dragged)
					var linePos = dragStartPositions.has(lineId) ? dragStartPositions.get(lineId) : nodes[lineIdx];
					// Direction from line neighbor to this on-curve
					dx = onStart.x - linePos.x;
					dy = onStart.y - linePos.y;
				}

				var len = Math.sqrt(dx * dx + dy * dy);
				if (len < 0.001) continue;

				tangents.set(id, { tx: dx / len, ty: dy / len, locked: isLocked });
			}
			ci++;
		}
	}
	return tangents;
};

// Project a delta (dx, dy) onto a unit tangent (tx, ty).
// Returns { dx, dy } along the tangent direction.
FontRig.projectOntoTangent = function(dx, dy, tangent) {
	var dot = dx * tangent.tx + dy * tangent.ty;
	return { dx: dot * tangent.tx, dy: dot * tangent.ty };
};

// -- Toggle smooth / sharp on selected on-curve nodes ---------------
// When converting to smooth, enforces collinearity by adjusting the
// shorter handle to match the longer handle's direction.
FontRig.toggleSmooth = function() {
	var layer = FontRig.getActiveLayer();
	if (!layer) return;

	var sel = FontRig.state.selectedNodeIds;
	if (sel.size === 0) return;

	var ci = 0;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			var nodes = shape.contours[ki].nodes;
			var n = nodes.length;

			for (var ni = 0; ni < n; ni++) {
				var id = 'c' + ci + '_n' + ni;
				if (!sel.has(id)) continue;
				if (nodes[ni].type !== 'on') continue;

				nodes[ni].smooth = !nodes[ni].smooth;

				// When making smooth, enforce collinearity immediately
				if (nodes[ni].smooth) {
					FontRig._makeSmoothAt(nodes, n, ni);
				}
			}
			ci++;
		}
	}

	FontRig.draw();
	FontRig.updateStatusSelected();
};

// Enforce collinearity at on-curve node onIdx by rotating the shorter
// handle to be collinear with the longer one (preserving both lengths).
FontRig._makeSmoothAt = function(nodes, n, onIdx) {
	var prevIdx = (onIdx - 1 + n) % n;
	var nextIdx = (onIdx + 1) % n;
	var prevIsHandle = (nodes[prevIdx].type !== 'on');
	var nextIsHandle = (nodes[nextIdx].type !== 'on');

	// Both sides are lines — nothing to enforce
	if (!prevIsHandle && !nextIsHandle) return;

	var ox = nodes[onIdx].x, oy = nodes[onIdx].y;

	if (prevIsHandle && nextIsHandle) {
		// Curve on both sides: keep longer handle, rotate shorter one
		var pDx = nodes[prevIdx].x - ox, pDy = nodes[prevIdx].y - oy;
		var nDx = nodes[nextIdx].x - ox, nDy = nodes[nextIdx].y - oy;
		var pLen = Math.sqrt(pDx * pDx + pDy * pDy);
		var nLen = Math.sqrt(nDx * nDx + nDy * nDy);
		if (pLen < 0.001 || nLen < 0.001) return;

		var fixDx, fixDy, fixLen, adjIdx, adjLen;
		if (pLen >= nLen) {
			fixDx = pDx; fixDy = pDy; fixLen = pLen;
			adjIdx = nextIdx; adjLen = nLen;
		} else {
			fixDx = nDx; fixDy = nDy; fixLen = nLen;
			adjIdx = prevIdx; adjLen = pLen;
		}

		var scale = -adjLen / fixLen;
		nodes[adjIdx].x = Math.round((ox + fixDx * scale) * 10) / 10;
		nodes[adjIdx].y = Math.round((oy + fixDy * scale) * 10) / 10;
	} else {
		// Line on one side, curve on the other:
		// align handle to the line direction (opposite sense)
		var lineIdx = prevIsHandle ? nextIdx : prevIdx;
		var handleIdx = prevIsHandle ? prevIdx : nextIdx;

		// Line direction: from line neighbor to this on-curve
		var lDx = ox - nodes[lineIdx].x;
		var lDy = oy - nodes[lineIdx].y;
		var lLen = Math.sqrt(lDx * lDx + lDy * lDy);
		if (lLen < 0.001) return;

		// Preserve handle length, place along line direction (away from line neighbor)
		var hDx = nodes[handleIdx].x - ox;
		var hDy = nodes[handleIdx].y - oy;
		var hLen = Math.sqrt(hDx * hDx + hDy * hDy);
		if (hLen < 0.001) return;

		var scale = hLen / lLen;
		nodes[handleIdx].x = Math.round((ox + lDx * scale) * 10) / 10;
		nodes[handleIdx].y = Math.round((oy + lDy * scale) * 10) / 10;
	}
};

// -- Smooth node constraint ------------------------------------------
// Two mechanisms, used in different contexts:
//
// A) Mouse drag (absolute positioning):
//    1. startDrag saves follower handles in dragStartPositions
//    2. Drag handler positions ALL entries from their start + delta
//    3. enforceSmoothCollinearity adjusts opposite handles
//
// B) Arrow keys (incremental):
//    1. moveSelectedNodes adds step to selected nodes
//    2. enforceSmoothForKeys translates adjacent handles, then
//       enforces collinearity

// Get non-selected handles adjacent to selected on-curves.
// These should follow their parent during drag (rigid body).
// Returns Map<nodeId, {x, y}> of current positions.
FontRig.getFollowerHandles = function(selectedIds) {
	var followers = new Map();
	var layer = FontRig.getActiveLayer();
	if (!layer) return followers;

	var ci = 0;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			var nodes = shape.contours[ki].nodes;
			var n = nodes.length;

			for (var ni = 0; ni < n; ni++) {
				var id = 'c' + ci + '_n' + ni;
				if (!selectedIds.has(id)) continue;
				if (nodes[ni].type !== 'on') continue;

				// Check adjacent nodes
				var prevIdx = (ni - 1 + n) % n;
				var nextIdx = (ni + 1) % n;
				var prevId = 'c' + ci + '_n' + prevIdx;
				var nextId = 'c' + ci + '_n' + nextIdx;

				if (nodes[prevIdx].type !== 'on' && !selectedIds.has(prevId)) {
					followers.set(prevId, { x: nodes[prevIdx].x, y: nodes[prevIdx].y });
				}
				if (nodes[nextIdx].type !== 'on' && !selectedIds.has(nextId)) {
					followers.set(nextId, { x: nodes[nextIdx].x, y: nodes[nextIdx].y });
				}
			}
			ci++;
		}
	}
	return followers;
};

// Enforce collinearity on smooth nodes after positioning.
// Called after all nodes (selected + followers) have been placed.
// movedIds: Set of all node IDs that were repositioned this frame.
FontRig.enforceSmoothCollinearity = function(movedIds) {
	var layer = FontRig.getActiveLayer();
	if (!layer) return;

	var ci = 0;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			var nodes = shape.contours[ki].nodes;
			var n = nodes.length;

			for (var ni = 0; ni < n; ni++) {
				var id = 'c' + ci + '_n' + ni;
				if (!movedIds.has(id)) continue;
				if (nodes[ni].type === 'on') continue; // only handles

				FontRig._enforceOppositeSmooth(nodes, n, ni, ci, movedIds);
			}
			ci++;
		}
	}
};

// Arrow key variant: translate adjacent handles then enforce collinearity.
// dx, dy are the incremental step (called once per keypress, so no drift).
FontRig.enforceSmoothForKeys = function(draggedIds, dx, dy) {
	var layer = FontRig.getActiveLayer();
	if (!layer) return;

	// First pass: translate non-selected handles adjacent to selected on-curves
	var ci = 0;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			var nodes = shape.contours[ki].nodes;
			var n = nodes.length;

			for (var ni = 0; ni < n; ni++) {
				var id = 'c' + ci + '_n' + ni;
				if (!draggedIds.has(id)) continue;
				if (nodes[ni].type !== 'on') continue;

				var prevIdx = (ni - 1 + n) % n;
				var nextIdx = (ni + 1) % n;
				var prevId = 'c' + ci + '_n' + prevIdx;
				var nextId = 'c' + ci + '_n' + nextIdx;

				if (nodes[prevIdx].type !== 'on' && !draggedIds.has(prevId)) {
					nodes[prevIdx].x = Math.round((nodes[prevIdx].x + dx) * 10) / 10;
					nodes[prevIdx].y = Math.round((nodes[prevIdx].y + dy) * 10) / 10;
				}
				if (nodes[nextIdx].type !== 'on' && !draggedIds.has(nextId)) {
					nodes[nextIdx].x = Math.round((nodes[nextIdx].x + dx) * 10) / 10;
					nodes[nextIdx].y = Math.round((nodes[nextIdx].y + dy) * 10) / 10;
				}
			}
			ci++;
		}
	}

	// Second pass: enforce collinearity for moved handles
	ci = 0;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			var nodes = shape.contours[ki].nodes;
			var n = nodes.length;

			for (var ni = 0; ni < n; ni++) {
				var id = 'c' + ci + '_n' + ni;
				if (!draggedIds.has(id)) continue;
				if (nodes[ni].type === 'on') continue;

				FontRig._enforceOppositeSmooth(nodes, n, ni, ci, draggedIds);
			}
			ci++;
		}
	}
};

// For handle at handleIdx, find parent on-curve. If smooth, adjust
// the opposite handle to maintain collinearity (same angle, opposite
// direction, preserving the opposite handle's original length).
FontRig._enforceOppositeSmooth = function(nodes, n, handleIdx, ci, movedIds) {
	var prevIdx = (handleIdx - 1 + n) % n;
	var nextIdx = (handleIdx + 1) % n;

	// Find parent on-curve (adjacent to this handle)
	var parentIdx = -1;
	if (nodes[prevIdx].type === 'on') parentIdx = prevIdx;
	else if (nodes[nextIdx].type === 'on') parentIdx = nextIdx;
	else return; // no adjacent on-curve

	var parent = nodes[parentIdx];
	if (!parent.smooth) return; // corner node — nothing to enforce

	// Opposite side of parent
	var oppositeIdx;
	if (parentIdx === prevIdx) {
		oppositeIdx = (parentIdx - 1 + n) % n;
	} else {
		oppositeIdx = (parentIdx + 1) % n;
	}

	var ox = parent.x, oy = parent.y;

	if (nodes[oppositeIdx].type === 'on') {
		// Opposite is a line segment: constrain dragged handle to line direction.
		// Line direction: from line neighbor to parent on-curve
		var lDx = ox - nodes[oppositeIdx].x;
		var lDy = oy - nodes[oppositeIdx].y;
		var lLen = Math.sqrt(lDx * lDx + lDy * lDy);
		if (lLen < 0.001) return;

		// Handle extends along lDx,lDy (continuing the line past parent)
		var ux = lDx / lLen, uy = lDy / lLen;
		var hx = nodes[handleIdx].x - ox;
		var hy = nodes[handleIdx].y - oy;
		var dot = hx * ux + hy * uy;
		var hLen = Math.max(dot, 0); // clamp: don't flip past parent

		nodes[handleIdx].x = Math.round((ox + ux * hLen) * 10) / 10;
		nodes[handleIdx].y = Math.round((oy + uy * hLen) * 10) / 10;
		return;
	}

	// Skip if opposite handle is also being moved (user controls both)
	var oppositeId = 'c' + ci + '_n' + oppositeIdx;
	if (movedIds.has(oppositeId)) return;

	// Vector from parent to dragged handle
	var hx = nodes[handleIdx].x, hy = nodes[handleIdx].y;
	var vx = hx - ox, vy = hy - oy;
	var dist = Math.sqrt(vx * vx + vy * vy);
	if (dist < 0.001) return;

	// Preserve opposite handle's distance from parent
	var opDx = nodes[oppositeIdx].x - ox;
	var opDy = nodes[oppositeIdx].y - oy;
	var opLen = Math.sqrt(opDx * opDx + opDy * opDy);
	if (opLen < 0.001) return;

	// Place opposite at reversed direction, scaled to its length
	var scale = -opLen / dist;
	nodes[oppositeIdx].x = Math.round((ox + vx * scale) * 10) / 10;
	nodes[oppositeIdx].y = Math.round((oy + vy * scale) * 10) / 10;
};

// -- Fit to view ----------------------------------------------------
FontRig.fitToView = function() {
	const layer = FontRig.getActiveLayer();
	if (!layer) return;

	const canvasW = FontRig.dom.canvasWrap.clientWidth;
	const canvasH = FontRig.dom.canvasWrap.clientHeight;

	// Glyph strip mode: fit the strip
	if (FontRig.state.glyphViewMode && FontRig.font) {
		FontRig.fitGlyphStrip();
		FontRig.draw();
		return;
	}

	// Joined multi-view: fit the entire joined layout
	if (FontRig.state.multiView && FontRig.state.joinedView) {
		const layout = FontRig.getJoinedLayout();

		const padding = 40;
		const scaleX = (canvasW - padding * 2) / layout.totalW;
		const scaleY = (canvasH - padding * 2) / layout.totalH;
		FontRig.state.zoom = Math.min(scaleX, scaleY);

		// Center of the joined layout in glyph space
		const cx = layout.totalW / 2;
		const cy = layout.totalH / 2;
		FontRig.state.pan.x = canvasW / 2 - cx * FontRig.state.zoom;
		FontRig.state.pan.y = canvasH / 2 + cy * FontRig.state.zoom;

		FontRig.updateZoomStatus();
		FontRig.draw();
		return;
	}

	// Split multi-view: fit to cell dimensions
	var w, h;
	if (FontRig.state.multiView) {
		const cell = FontRig.getCellRect(FontRig.state.activeCell.row, FontRig.state.activeCell.col);
		w = cell.w;
		h = cell.h;
	} else {
		w = canvasW;
		h = canvasH;
	}

	var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

	for (const shape of layer.shapes) {
		for (const contour of shape.contours) {
			for (const node of contour.nodes) {
				minX = Math.min(minX, node.x);
				minY = Math.min(minY, node.y);
				maxX = Math.max(maxX, node.x);
				maxY = Math.max(maxY, node.y);
			}
		}
	}

	minX = Math.min(minX, 0);
	maxX = Math.max(maxX, layer.width);
	minY = Math.min(minY, 0);
	maxY = Math.max(maxY, layer.height);

	if (layer.anchors) {
		for (const a of layer.anchors) {
			minX = Math.min(minX, a.x);
			minY = Math.min(minY, a.y);
			maxX = Math.max(maxX, a.x);
			maxY = Math.max(maxY, a.y);
		}
	}

	const glyphW = maxX - minX || 1;
	const glyphH = maxY - minY || 1;

	const padding = FontRig.state.multiView ? 30 : 60;
	const scaleX = (w - padding * 2) / glyphW;
	const scaleY = (h - padding * 2) / glyphH;
	FontRig.state.zoom = Math.min(scaleX, scaleY);

	const cx = (minX + maxX) / 2;
	const cy = (minY + maxY) / 2;
	FontRig.state.pan.x = w / 2 - cx * FontRig.state.zoom;
	FontRig.state.pan.y = h / 2 + cy * FontRig.state.zoom;

	FontRig.updateZoomStatus();
	FontRig.draw();
};

FontRig.updateZoomStatus = function() {
	FontRig.dom.statusZoom.textContent = Math.round(FontRig.state.zoom * 100) + '%';
};

// Zoom centred on the viewport middle (for keyboard zoom)
FontRig.zoomAtCenter = function(factor) {
	const w = FontRig.dom.canvasWrap.clientWidth;
	const h = FontRig.dom.canvasWrap.clientHeight;
	const cx = w / 2;
	const cy = h / 2;
	const newZoom = FontRig.state.zoom * factor;

	FontRig.state.pan.x = cx - (cx - FontRig.state.pan.x) * (newZoom / FontRig.state.zoom);
	FontRig.state.pan.y = cy - (cy - FontRig.state.pan.y) * (newZoom / FontRig.state.zoom);
	FontRig.state.zoom = newZoom;

	FontRig.updateZoomStatus();
	FontRig.draw();
};

// -- File I/O -------------------------------------------------------
FontRig.loadXmlString = function(xmlString, filename) {
	try {
		FontRig.state.glyphData = FontRig.parseGlyphXML(xmlString);
		FontRig.state.rawXml = xmlString;

		// Clear font mode if loading a loose file
		FontRig.font = null;
		FontRig.glyphCache.clear();
		FontRig.dirtyGlyphs.clear();
		FontRig.activeGlyph = null;
		// Hide left sidebar when loading a loose file
		if (FontRig._hideLeftSidebar) FontRig._hideLeftSidebar();

		FontRig.dom.layerSelect.innerHTML = '';
		for (const layer of FontRig.state.glyphData.layers) {
			const opt = document.createElement('option');
			opt.value = layer.name;
			opt.textContent = layer.name || '(unnamed)';
			FontRig.dom.layerSelect.appendChild(opt);
		}

		if (FontRig.state.glyphData.layers.length > 0) {
			FontRig.state.activeLayer = FontRig.state.glyphData.layers[0].name;
			FontRig.dom.layerSelect.value = FontRig.state.activeLayer;
			FontRig._notifyLayerChange(FontRig.state.activeLayer);
		}

		const g = FontRig.state.glyphData;
		var infoHtml = '<span>' + (g.name || '?') + '</span>';
		if (g.unicodes) infoHtml += ' U+' + g.unicodes;
		FontRig.dom.glyphInfo.innerHTML = infoHtml;

		FontRig.dom.emptyState.classList.add('hidden');
		FontRig.state.selectedNodeIds.clear();

		// Re-init grid if multi-view is active
		if (FontRig.state.multiView) FontRig.initMultiGrid();

		// Hobby contours arrive with empty .nodes — solve once now if
		// Pyodide is ready, or auto-init it otherwise. (Mirrors the
		// equivalent hook in setActiveGlyph for the font-mode path.)
		if (typeof FontRig.solveAllHobbyContours === 'function') {
			FontRig.solveAllHobbyContours(FontRig.state.glyphData);
		}
		if (typeof FontRig.ensureHobbySolverReady === 'function') {
			FontRig.ensureHobbySolverReady(FontRig.state.glyphData);
		}

		FontRig.fitToView();
		FontRig.buildXmlPanel();
		FontRig.clearUndo();
		document.title = FontRig.getCurrentTheme().appTitle + ' | ' + (g.name || 'untitled');
	} catch (e) {
		if (FontRig.showMessage) FontRig.showMessage('Load failed', 'Error loading XML: ' + e.message); else alert('Error loading XML: ' + e.message);
	}
};

FontRig.saveXml = function() {
	// Always serialize fresh from data for saving
	var xmlString = FontRig.state.glyphData ? FontRig.glyphToXml(FontRig.state.glyphData) : FontRig.state.rawXml;
	if (!xmlString) return;

	const blob = new Blob([xmlString], { type: 'application/xml' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	const name = FontRig.state.glyphData ? FontRig.state.glyphData.name : 'glyph';
	a.download = name + '.trglyph';
	a.click();
	URL.revokeObjectURL(url);
};

// -- Cursor helpers -------------------------------------------------
FontRig.updateCanvasCursor = function() {
	const wrap = FontRig.dom.canvasWrap;
	const state = FontRig.state;
	if (state.spaceDown) {
		wrap.style.cursor = 'grab';
	} else if (state.activeDrawTool && state.activeDrawTool !== 'select') {
		// Drawing mode wins over default arrow.
		wrap.style.cursor = 'crosshair';
	} else {
		wrap.style.cursor = 'default';
	}
};

// -- Node movement by keyboard (moves all selected) -----------------
FontRig.moveSelectedNodes = function(dx, dy) {
	const sel = FontRig.state.selectedNodeIds;
	if (sel.size === 0) return;

	const hobbyContours = new Set();

	for (const nodeId of sel) {
		const ref = FontRig.findNodeById(nodeId);
		if (!ref) continue;

		// Hobby: contour.nodes is solver-derived state. Mutating it
		// directly looks right until the next solve overwrites the
		// shadow from the (untouched) source — that's the "snap back"
		// the user sees on next selection. Route to the source data:
		// knots for on-curves, fixed_bcp_* for fixed-segment off-curves.
		if (ref.contour && ref.contour.kind === 'hobby') {
			FontRig._nudgeHobbyNode(ref.contour, nodeId, dx, dy);
			hobbyContours.add(ref.contour);
			continue;
		}

		ref.node.x = Math.round((ref.node.x + dx) * 10) / 10;
		ref.node.y = Math.round((ref.node.y + dy) * 10) / 10;
	}

	// Re-solve every touched hobby contour so the bezier shadow tracks
	// the updated knots/BCPs.
	hobbyContours.forEach(function(c) { FontRig.solveHobbyContour(c); });

	// Enforce smooth tangent continuity on neighbors (bezier only)
	FontRig.enforceSmoothForKeys(sel, dx, dy);

	// Live lerp: forward or reverse interpolation
	if (typeof FontRig.lerpSync === 'function') FontRig.lerpSync();

	// Invalidate Path2D cache and redraw. Nudge (arrow-key) is a
	// continuous-input path when the key repeats, so coalesce paints.
	FontRig.invalidatePathCache();
	FontRig.requestDraw();
	FontRig.updateStatusSelected();
};

// Nudge a single hobby contour entry by (dx, dy). Routes to the
// underlying knot for on-curves, or to the fixed_bcp_* fields for
// off-curves on fixed segments. Caller is responsible for re-solving.
FontRig._nudgeHobbyNode = function(contour, nodeId, dx, dy) {
	if (!contour || !contour.knots) return;
	var m = nodeId && nodeId.match(/^c\d+_n(\d+)$/);
	if (!m) return;
	var ni = parseInt(m[1], 10);
	var map = contour._knotMap;
	if (!map) return;
	var round = function(v) { return Math.round(v * 10) / 10; };

	var ki = map[ni];
	if (ki !== null && ki !== undefined) {
		var knot = contour.knots[ki];
		if (!knot) return;
		knot.x = round(knot.x + dx);
		knot.y = round(knot.y + dy);
		// Fixed BCPs anchored on this knot translate with it so the
		// segment shape doesn't tear.
		if (knot.fixed_bcp_out_x != null) knot.fixed_bcp_out_x = round(knot.fixed_bcp_out_x + dx);
		if (knot.fixed_bcp_out_y != null) knot.fixed_bcp_out_y = round(knot.fixed_bcp_out_y + dy);
		if (knot.fixed_bcp_in_x  != null) knot.fixed_bcp_in_x  = round(knot.fixed_bcp_in_x  + dx);
		if (knot.fixed_bcp_in_y  != null) knot.fixed_bcp_in_y  = round(knot.fixed_bcp_in_y  + dy);
		return;
	}

	// Off-curve: only fixed-segment BCPs are moveable.
	var skMap = contour._segmentKindMap;
	if (!skMap || skMap[ni] !== 'fixed') return;

	var niOn = ni;
	while (niOn > 0 && (map[niOn] === null || map[niOn] === undefined)) niOn--;
	var ownerKi = map[niOn];
	if (ownerKi === null || ownerKi === undefined) return;
	var offset = ni - niOn;
	var n = contour.knots.length;
	var targetKi, field;
	if (offset === 1)      { targetKi = ownerKi;             field = 'fixed_bcp_out'; }
	else if (offset === 2) { targetKi = (ownerKi + 1) % n;   field = 'fixed_bcp_in';  }
	else return;

	var target = contour.knots[targetKi];
	if (!target) return;
	var sx = target[field + '_x'], sy = target[field + '_y'];
	if (sx == null || sy == null) {
		var node = contour.nodes && contour.nodes[ni];
		if (!node) return;
		sx = node.x; sy = node.y;
	}
	target[field + '_x'] = round(sx + dx);
	target[field + '_y'] = round(sy + dy);
};
