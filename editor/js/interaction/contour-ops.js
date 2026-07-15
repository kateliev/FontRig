// ===================================================================
// FontRig — interaction/contour-ops.js
// ===================================================================
// Contour operations: open/close/join/merge, endpoints, segment hit-test
// (moved from interaction.js, M7). Pure relocation — no behavior change.
// ===================================================================
'use strict';

// -- Contour walk (PageUp / PageDown) -------------------------------
// Walk selection forward/backward along the contour. If nothing is
// selected, selects the first on-curve node of the first contour.
FontRig.walkContour = function(direction) {
	const layer = FontRig.getActiveLayer();
	if (!layer) return;

	const sel = FontRig.state.selectedNodeIds;
	const allNodes = FontRig.getAllNodes(layer);
	if (allNodes.length === 0) return;

	// Nothing selected — pick first on-curve of first contour
	if (sel.size === 0) {
		for (var i = 0; i < allNodes.length; i++) {
			if (allNodes[i].type === 'on') {
				FontRig.selectNode(allNodes[i].id, false);
				return;
			}
		}
		FontRig.selectNode(allNodes[0].id, false);
		return;
	}

	// Find the contour of the first selected node
	const firstId = sel.values().next().value;
	const m = firstId.match(/^c(\d+)_n(\d+)$/);
	if (!m) return;
	const ci = parseInt(m[1]);
	const ni = parseInt(m[2]);

	// Collect nodes belonging to this contour
	const contourNodes = allNodes.filter(function(n) { return n.contourIdx === ci; });
	if (contourNodes.length === 0) return;

	// Find current position in contour node list
	var curIdx = -1;
	for (var j = 0; j < contourNodes.length; j++) {
		if (contourNodes[j].nodeIdx === ni) { curIdx = j; break; }
	}
	if (curIdx < 0) curIdx = 0;

	// Step forward or backward, wrapping around
	var newIdx = (curIdx + direction + contourNodes.length) % contourNodes.length;
	FontRig.selectNode(contourNodes[newIdx].id, false);
};

// -- Open contour at selected node (Del) ----------------------------
// Splits the contour at the selected on-curve node: duplicates it,
// sets contour.closed = false. The original node becomes the end,
// the duplicate becomes the new start.
FontRig.openContourAtNode = function() {
	var layer = FontRig.getActiveLayer();
	if (!layer) return;

	var sel = FontRig.state.selectedNodeIds;
	if (sel.size !== 1) return; // only works on single node

	var nodeId = sel.values().next().value;
	var ref = FontRig.findNodeById(nodeId);
	if (!ref || ref.node.type !== 'on') return;

	var contour = ref.contour;
	var nodes = contour.nodes;
	var n = nodes.length;

	var m = nodeId.match(/^c(\d+)_n(\d+)$/);
	if (!m) return;
	var ni = parseInt(m[2]);

	if (contour.closed) {
		// -- Closed contour: open at this node --
		// Rotate so selected node is at position 0
		var rotated = nodes.slice(ni).concat(nodes.slice(0, ni));

		// Duplicate the start node at the end (endpoint)
		var startNode = rotated[0];
		var endNode = {
			type: startNode.type,
			smooth: false,
			x: startNode.x,
			y: startNode.y
		};
		startNode.smooth = false;
		rotated.push(endNode);

		contour.nodes = rotated;
		contour.closed = false;
	} else {
		// -- Open contour: split into two at this node --
		// Don't split at the very first or last on-curve (endpoints)
		var ep = FontRig.getOpenEndpoints(contour);
		if (!ep) return;
		if (ni === ep.startIdx || ni === ep.endIdx) return;

		// First part: nodes from start to ni (inclusive)
		var firstNodes = nodes.slice(0, ni + 1);
		// Second part: nodes from ni to end (inclusive — duplicate the split node)
		var secondNodes = nodes.slice(ni);

		// Make the split node sharp at both new endpoints
		firstNodes[firstNodes.length - 1] = {
			type: 'on', smooth: false,
			x: nodes[ni].x, y: nodes[ni].y
		};
		secondNodes[0] = {
			type: 'on', smooth: false,
			x: nodes[ni].x, y: nodes[ni].y
		};

		// Validate: each part needs at least 2 on-curves to be a contour
		var firstOnCount = 0, secondOnCount = 0;
		for (var i = 0; i < firstNodes.length; i++) {
			if (firstNodes[i].type === 'on') firstOnCount++;
		}
		for (var i = 0; i < secondNodes.length; i++) {
			if (secondNodes[i].type === 'on') secondOnCount++;
		}
		if (firstOnCount < 2 || secondOnCount < 2) return;

		// Replace original contour with first part
		contour.nodes = firstNodes;
		contour.closed = false;

		// Create new contour for second part and add to the same shape
		var newContour = {
			nodes: secondNodes,
			closed: false,
			clockwise: contour.clockwise
		};
		var shape = ref.shape;
		var ci = shape.contours.indexOf(contour);
		shape.contours.splice(ci + 1, 0, newContour);
	}

	sel.clear();
	FontRig.invalidatePathCache();
	FontRig.draw();
	FontRig.updateStatusSelected();
};

// -- Delete selected node (Backspace) ------------------------------
// Removes the selected on-curve and reconstructs adjacent beziers.
// Curve-Curve: merges two cubics into one, keeping outer handles
//   with proportionally scaled lengths.
// Curve-Line or Line-Curve: converts to a single cubic using the
//   surviving handle and a synthetic one for the line side.
// Line-Line: simple removal, straight line remains.
FontRig.deleteNode = function() {
	var layer = FontRig.getActiveLayer();
	if (!layer) return;

	var sel = FontRig.state.selectedNodeIds;
	if (sel.size !== 1) return;

	var nodeId = sel.values().next().value;
	var ref = FontRig.findNodeById(nodeId);
	if (!ref) return;

	var contour = ref.contour;

	// Hobby: delete the source knot, re-solve, redraw.
	if (contour.kind === 'hobby') {
		var hm = nodeId.match(/^c\d+_n(\d+)$/);
		if (hm && typeof FontRig._deleteHobbyKnotById === 'function') {
			FontRig.pushUndo();
			if (FontRig._deleteHobbyKnotById(contour, parseInt(hm[1], 10))) {
				if (FontRig.invalidatePathCache) FontRig.invalidatePathCache(layer);
				sel.clear();
				FontRig.draw();
				FontRig.updateStatusSelected();
			}
		}
		return;
	}

	var nodes = contour.nodes;
	var n = nodes.length;

	var m = nodeId.match(/^c(\d+)_n(\d+)$/);
	if (!m) return;
	var ni = parseInt(m[2]);
	var node = nodes[ni];

	if (node.type !== 'on') {
		// Off-curve selected: convert parent segment to line
		// Find segment containing this off-curve node
		var segs = FontRig.getContourSegments(contour);
		for (var gi = 0; gi < segs.length; gi++) {
			var seg = segs[gi];
			var isInSeg = false;
			if (seg.type === 'cubic' && (ni === seg.offIdx1 || ni === seg.offIdx2)) isInSeg = true;
			if (seg.type === 'quadratic' && ni === seg.offIdx) isInSeg = true;
			if (isInSeg) {
				// Build a synthetic hit for convertSegmentToLine
				FontRig.convertSegmentToLine({ contour: contour, seg: seg });
				return;
			}
		}
		// Fallback: just clear selection
		sel.clear();
		FontRig.draw();
		FontRig.updateStatusSelected();
		return;
	}

	// -- On-curve node deletion --
	// Analyze incoming and outgoing segments
	var incoming = FontRig._analyzeIncoming(nodes, n, ni);
	var outgoing = FontRig._analyzeOutgoing(nodes, n, ni);

	// Collect dense samples from both segments BEFORE removing anything.
	// Skip duplicate at the junction (the deleted node itself).
	var samplesIn = FontRig._sampleSegment(nodes, n, ni, 'incoming', 40);
	var samplesOut = FontRig._sampleSegment(nodes, n, ni, 'outgoing', 40);
	// Merge: incoming ends at deleted node, outgoing starts there — skip first of outgoing
	if (samplesOut.length > 0) samplesOut.shift();
	FontRig._pendingSamples = samplesIn.concat(samplesOut);

	// Build replacement nodes to insert between prev on-curve and next on-curve
	var replacement = FontRig._buildReplacement(nodes, incoming, outgoing);
	FontRig._pendingSamples = null;

	// Collect all indices to remove (the on-curve + its adjacent handles)
	var toRemove = new Set();
	toRemove.add(ni);
	for (var i = 0; i < incoming.handleIndices.length; i++) {
		toRemove.add(incoming.handleIndices[i]);
	}
	for (var i = 0; i < outgoing.handleIndices.length; i++) {
		toRemove.add(outgoing.handleIndices[i]);
	}

	// Build new node array
	var newNodes = [];
	for (var i = 0; i < n; i++) {
		if (toRemove.has(i)) {
			// At the position of the deleted on-curve, insert replacement
			if (i === ni) {
				for (var j = 0; j < replacement.length; j++) {
					newNodes.push(replacement[j]);
				}
			}
			continue;
		}
		newNodes.push(nodes[i]);
	}

	contour.nodes = newNodes;

	// If fewer than 2 on-curve nodes remain, remove contour
	var onCount = 0;
	for (var i = 0; i < contour.nodes.length; i++) {
		if (contour.nodes[i].type === 'on') onCount++;
	}
	if (onCount < 2) {
		var shape = ref.shape;
		var ci = shape.contours.indexOf(contour);
		if (ci >= 0) shape.contours.splice(ci, 1);
	}

	sel.clear();
	FontRig.invalidatePathCache();
	FontRig.draw();
	FontRig.updateStatusSelected();
};

// -- Join open contour endpoints -------------------------------------
// Returns the open endpoints of a contour:
// { startIdx, endIdx, startNode, endNode } or null if closed.
FontRig.getOpenEndpoints = function(contour) {
	if (contour.closed) return null;
	var nodes = contour.nodes;
	if (nodes.length < 2) return null;

	// Find first and last on-curve
	var startIdx = -1, endIdx = -1;
	for (var i = 0; i < nodes.length; i++) {
		if (nodes[i].type === 'on') { startIdx = i; break; }
	}
	for (var i = nodes.length - 1; i >= 0; i--) {
		if (nodes[i].type === 'on') { endIdx = i; break; }
	}
	if (startIdx < 0 || endIdx < 0 || startIdx === endIdx) return null;

	return {
		startIdx: startIdx, endIdx: endIdx,
		startNode: nodes[startIdx], endNode: nodes[endIdx]
	};
};

// Check if a node ID refers to an endpoint of an open contour.
// Returns { contour, shape, ci, end: 'start'|'end' } or null.
FontRig.isOpenEndpoint = function(nodeId) {
	var layer = FontRig.getActiveLayer();
	if (!layer) return null;

	var m = nodeId.match(/^c(\d+)_n(\d+)$/);
	if (!m) return null;
	var targetCi = parseInt(m[1]);
	var targetNi = parseInt(m[2]);

	var ci = 0;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			if (ci === targetCi) {
				var ep = FontRig.getOpenEndpoints(shape.contours[ki]);
				if (!ep) return null;
				if (targetNi === ep.startIdx) {
					return { contour: shape.contours[ki], shape: shape, ci: ci, ki: ki, end: 'start' };
				}
				if (targetNi === ep.endIdx) {
					return { contour: shape.contours[ki], shape: shape, ci: ci, ki: ki, end: 'end' };
				}
			return null;
		}
		ci++;
	}
}
	return null;
};

// Find the nearest open endpoint within threshold (glyph units).
// Excludes endpoints belonging to excludeCi contour index (the dragged one).
// Returns { ci, ki, end, contour, shape, dist } or null.
FontRig.findNearOpenEndpoint = function(gx, gy, threshold, excludeCi, excludeEnd) {
	var layer = FontRig.getActiveLayer();
	if (!layer) return null;

	var best = null;
	var ci = 0;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			var ep = FontRig.getOpenEndpoints(shape.contours[ki]);
			if (ep) {
				// Check start endpoint
				if (!(ci === excludeCi && 'start' === excludeEnd)) {
					var dx = ep.startNode.x - gx, dy = ep.startNode.y - gy;
					var d = Math.sqrt(dx * dx + dy * dy);
					if (d <= threshold && (!best || d < best.dist)) {
						best = { ci: ci, ki: ki, end: 'start', contour: shape.contours[ki], shape: shape, dist: d };
					}
				}
				// Check end endpoint
				if (!(ci === excludeCi && 'end' === excludeEnd)) {
					var dx = ep.endNode.x - gx, dy = ep.endNode.y - gy;
					var d = Math.sqrt(dx * dx + dy * dy);
					if (d <= threshold && (!best || d < best.dist)) {
						best = { ci: ci, ki: ki, end: 'end', contour: shape.contours[ki], shape: shape, dist: d };
					}
				}
			}
			ci++;
		}
	}
	return best;
};

// Try to join at the currently selected endpoint.
// Called after drag or manually. Returns true if joined.
FontRig.tryJoinEndpoints = function() {
	var layer = FontRig.getActiveLayer();
	if (!layer) return false;

	var sel = FontRig.state.selectedNodeIds;
	if (sel.size !== 1) return false;

	var nodeId = sel.values().next().value;
	var epInfo = FontRig.isOpenEndpoint(nodeId);
	if (!epInfo) return false;

	var node = epInfo.end === 'start'
		? FontRig.getOpenEndpoints(epInfo.contour).startNode
		: FontRig.getOpenEndpoints(epInfo.contour).endNode;

	var threshold = 2; // glyph units

	// Find nearby endpoint (excluding self)
	var target = FontRig.findNearOpenEndpoint(node.x, node.y, threshold, epInfo.ci, epInfo.end);

	if (!target) {
		// Check if same contour's other end is nearby → close
		var selfEp = FontRig.getOpenEndpoints(epInfo.contour);
		if (selfEp) {
			var otherNode = epInfo.end === 'start' ? selfEp.endNode : selfEp.startNode;
			var dx = otherNode.x - node.x, dy = otherNode.y - node.y;
			if (Math.sqrt(dx * dx + dy * dy) <= threshold) {
				return FontRig._closeContour(epInfo.contour, epInfo.end);
			}
		}
		return false;
	}

	// Same contour, other end → close
	if (target.ci === epInfo.ci) {
		return FontRig._closeContour(epInfo.contour, epInfo.end);
	}

	// Different contour → merge
	return FontRig._mergeContours(epInfo, target);
};

// Close an open contour: snap endpoint, remove duplicate, set closed.
FontRig._closeContour = function(contour, draggedEnd) {
	var ep = FontRig.getOpenEndpoints(contour);
	if (!ep) return false;

	if (draggedEnd === 'start') {
		// Snap start to end position
		ep.startNode.x = ep.endNode.x;
		ep.startNode.y = ep.endNode.y;
		// Remove the end duplicate
		contour.nodes.splice(ep.endIdx, 1);
	} else {
		// Snap end to start position
		ep.endNode.x = ep.startNode.x;
		ep.endNode.y = ep.startNode.y;
		// Remove the end node (the dragged one snapped to start)
		contour.nodes.splice(ep.endIdx, 1);
	}

	contour.closed = true;
	FontRig.state.selectedNodeIds.clear();
	FontRig.invalidatePathCache();
	FontRig.draw();
	FontRig.updateStatusSelected();
	return true;
};

// Merge two open contours by connecting their endpoints.
// srcInfo: { contour, shape, ci, ki, end } — the dragged endpoint
// tgtInfo: { contour, shape, ci, ki, end } — the target endpoint
FontRig._mergeContours = function(srcInfo, tgtInfo) {
	var srcContour = srcInfo.contour;
	var tgtContour = tgtInfo.contour;
	var srcNodes = srcContour.nodes.slice(); // copy
	var tgtNodes = tgtContour.nodes.slice();

	// Orient both so the joining ends are adjacent:
	// srcNodes should end at the joining point
	// tgtNodes should start at the joining point
	if (srcInfo.end === 'start') {
		srcNodes.reverse();
	}
	if (tgtInfo.end === 'end') {
		tgtNodes.reverse();
	}

	// Snap the joining node: remove last of src (duplicate of first of tgt)
	var srcLast = srcNodes[srcNodes.length - 1];
	var tgtFirst = tgtNodes[0];
	// Average position for clean join
	tgtFirst.x = (srcLast.x + tgtFirst.x) / 2;
	tgtFirst.y = (srcLast.y + tgtFirst.y) / 2;
	tgtFirst.x = Math.round(tgtFirst.x * 10) / 10;
	tgtFirst.y = Math.round(tgtFirst.y * 10) / 10;
	srcNodes.pop(); // remove the duplicate

	// Merged nodes
	var mergedNodes = srcNodes.concat(tgtNodes);

	// Replace src contour with merged, remove tgt contour
	srcContour.nodes = mergedNodes;

	// Remove target contour from its shape
	var tgtIdx = tgtInfo.shape.contours.indexOf(tgtContour);
	if (tgtIdx >= 0) {
		tgtInfo.shape.contours.splice(tgtIdx, 1);
	}

	FontRig.state.selectedNodeIds.clear();
	FontRig.invalidatePathCache();
	FontRig.draw();
	FontRig.updateStatusSelected();
	return true;
};

// Get contour index (ci) from a node ID like 'c2_n5'
FontRig.getContourIndexForNode = function(nodeId) {
	var m = nodeId.match(/^c(\d+)/);
	return m ? parseInt(m[1]) : -1;
};

// -- Insert node on contour ------------------------------------------
// Segment iteration: walks contour nodes and yields segments.
// Each segment is { type, startIdx, endIdx, nodes[] } where nodes
// are the control points (2 for line, 4 for cubic).
FontRig.getContourSegments = function(contour) {
	var nodes = contour.nodes;
	var n = nodes.length;
	var segments = [];
	var i = 0;

	while (i < n) {
		if (nodes[i].type !== 'on') { i++; continue; }

		var next1 = (i + 1) % n;
		if (nodes[next1].type === 'on') {
			// Line segment: on → on
			segments.push({
				type: 'line',
				startIdx: i,
				endIdx: next1,
				pts: [
					{ x: nodes[i].x, y: nodes[i].y },
					{ x: nodes[next1].x, y: nodes[next1].y }
				]
			});
			i++;
			continue;
		}

		// Cubic segment: on → curve → curve → on
		var next2 = (i + 2) % n;
		var next3 = (i + 3) % n;
		if (nodes[next1].type === 'curve' && nodes[next2].type === 'curve' && nodes[next3].type === 'on') {
			segments.push({
				type: 'cubic',
				startIdx: i,
				endIdx: next3,
				offIdx1: next1,
				offIdx2: next2,
				pts: [
					{ x: nodes[i].x, y: nodes[i].y },
					{ x: nodes[next1].x, y: nodes[next1].y },
					{ x: nodes[next2].x, y: nodes[next2].y },
					{ x: nodes[next3].x, y: nodes[next3].y }
				]
			});
			i += 3;
			continue;
		}

		// Quadratic segment: on → off → on
		if (nodes[next1].type === 'off') {
			var next2q = (i + 2) % n;
			if (nodes[next2q].type === 'on') {
				segments.push({
					type: 'quadratic',
					startIdx: i,
					endIdx: next2q,
					offIdx: next1,
					pts: [
						{ x: nodes[i].x, y: nodes[i].y },
						{ x: nodes[next1].x, y: nodes[next1].y },
						{ x: nodes[next2q].x, y: nodes[next2q].y }
					]
				});
				i += 2;
				continue;
			}
		}

		i++;
	}
	return segments;
};

// Find nearest point on a segment, returns { t, dist, x, y }
FontRig._nearestOnSegment = function(seg, gx, gy) {
	var evalFn = seg.type === 'cubic' ? FontRig._evalCubic :
	             seg.type === 'quadratic' ? FontRig._evalQuadratic : FontRig._evalLine;
	var pts = seg.pts;
	var bestT = 0, bestDist = Infinity;

	// Coarse search: sample at 50 points
	var steps = 50;
	for (var i = 0; i <= steps; i++) {
		var t = i / steps;
		var p = evalFn(pts, t);
		var dx = p.x - gx, dy = p.y - gy;
		var d = dx * dx + dy * dy;
		if (d < bestDist) { bestDist = d; bestT = t; }
	}

	// Refine with bisection
	var lo = Math.max(0, bestT - 1 / steps);
	var hi = Math.min(1, bestT + 1 / steps);
	for (var iter = 0; iter < 20; iter++) {
		var mid1 = lo + (hi - lo) / 3;
		var mid2 = hi - (hi - lo) / 3;
		var p1 = evalFn(pts, mid1);
		var p2 = evalFn(pts, mid2);
		var d1 = (p1.x - gx) * (p1.x - gx) + (p1.y - gy) * (p1.y - gy);
		var d2 = (p2.x - gx) * (p2.x - gx) + (p2.y - gy) * (p2.y - gy);
		if (d1 < d2) hi = mid2; else lo = mid1;
	}

	var t = (lo + hi) / 2;
	var pt = evalFn(pts, t);
	var dx = pt.x - gx, dy = pt.y - gy;
	return { t: t, dist: Math.sqrt(dx * dx + dy * dy), x: pt.x, y: pt.y };
};

// Hit-test all segments in active layer, return best match or null.
// Returns { ci, segIdx, seg, t, x, y, dist }
FontRig.hitTestSegment = function(sx, sy) {
	var layer = FontRig.getActiveLayer();
	if (!layer) return null;

	var gp = FontRig.screenToGlyph(sx, sy);
	var hitRadius = 8 / FontRig.state.zoom; // 8 screen pixels in glyph space
	var best = null;
	var ci = 0;

	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			var segs = FontRig.getContourSegments(shape.contours[ki]);
			for (var gi = 0; gi < segs.length; gi++) {
				var hit = FontRig._nearestOnSegment(segs[gi], gp.x, gp.y);
				if (hit.dist < hitRadius && (!best || hit.dist < best.dist)) {
					best = {
						ci: ci, segIdx: gi, seg: segs[gi],
						t: hit.t, x: hit.x, y: hit.y, dist: hit.dist,
						contour: shape.contours[ki]
					};
				}
			}
			ci++;
		}
	}
	return best;
};
