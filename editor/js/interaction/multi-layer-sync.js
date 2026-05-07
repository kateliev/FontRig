// ===================================================================
// FontRig — Multi-Layer Sync & Master Compatibility
// ===================================================================
// Provides compatibility checking across master layers and
// synchronized operations that propagate edits to all in-scope layers.
//
// Depends on:
//   - FontRig.scope           (fr-dialogs.js)
//   - FontRig.getActiveLayer  (geometry.js)
//   - FontRig.getLayerByName  (interaction.js)
//   - FontRig.getContourSegments (interaction.js)
// ===================================================================
'use strict';

// ===================================================================
// MASTER COMPATIBILITY CHECK
// ===================================================================
// Two layers are "compatible" if they have the same contour structure:
//   - Same number of contours (across all shapes)
//   - Same number of nodes per contour
//   - Same node types in the same order (on/off/curve)
//
// This is the fundamental requirement for synchronized editing:
// an insert/delete/type-change on the active layer can only be
// mirrored on another layer if the structure matches.
// -------------------------------------------------------------------

// Build a structural fingerprint for a layer: an array of per-contour
// signatures. Each signature is a string like "on,curve,curve,on,on,..."
// that encodes the node count and types.
FontRig._layerFingerprint = function(layer) {
	if (!layer || !layer.shapes) return null;
	var sigs = [];
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			var contour = shape.contours[ki];
			var types = [];
			for (var ni = 0; ni < contour.nodes.length; ni++) {
				types.push(contour.nodes[ni].type);
			}
			sigs.push(types.join(','));
		}
	}
	return sigs;
};

// Compare two fingerprints for structural equality.
FontRig._fingerprintsMatch = function(fp1, fp2) {
	if (!fp1 || !fp2) return false;
	if (fp1.length !== fp2.length) return false;
	for (var i = 0; i < fp1.length; i++) {
		if (fp1[i] !== fp2[i]) return false;
	}
	return true;
};

// Check compatibility of a single layer against a reference fingerprint.
// Returns true if the layer has the same contour structure.
FontRig.isLayerCompatible = function(layer, refFingerprint) {
	var fp = FontRig._layerFingerprint(layer);
	return FontRig._fingerprintsMatch(fp, refFingerprint);
};

// Check master compatibility across all scope layers.
// Returns an object:
//   {
//     compatible: bool,          // true if ALL scope layers match
//     reference: fingerprint,    // the active layer's fingerprint
//     layers: [                  // per-layer results
//       { name, layer, compatible, fingerprint }
//     ]
//   }
FontRig.checkMasterCompatibility = function() {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData) return { compatible: false, reference: null, layers: [] };

	var activeLayer = FontRig.getActiveLayer();
	if (!activeLayer) return { compatible: false, reference: null, layers: [] };

	var refFp = FontRig._layerFingerprint(activeLayer);
	var scopeLayerNames = FontRig.scope.getLayers();
	var results = [];
	var allCompatible = true;

	for (var i = 0; i < scopeLayerNames.length; i++) {
		var lname = scopeLayerNames[i];
		var layer = FontRig.getLayerByName(glyphData, lname);
		if (!layer) {
			results.push({ name: lname, layer: null, compatible: false, fingerprint: null });
			allCompatible = false;
			continue;
		}

		var fp = FontRig._layerFingerprint(layer);
		var compat = FontRig._fingerprintsMatch(fp, refFp);
		results.push({ name: lname, layer: layer, compatible: compat, fingerprint: fp });
		if (!compat) allCompatible = false;
	}

	return {
		compatible: allCompatible,
		reference: refFp,
		layers: results
	};
};


// ===================================================================
// MULTI-LAYER OPERATION HELPERS
// ===================================================================

// Get the list of layers to operate on, based on current scope.
// In 'active' mode, returns only the active layer.
// In 'masters' or 'selected' mode, returns all compatible scope layers.
// Always includes the active layer first.
FontRig.getSyncLayers = function() {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData) return [];

	var activeLayer = FontRig.getActiveLayer();
	if (!activeLayer) return [];

	// In 'active' scope mode, only operate on the active layer
	if (FontRig.scope.layerMode === 'active') {
		return [activeLayer];
	}

	// Multi-layer mode: get all compatible scope layers
	var refFp = FontRig._layerFingerprint(activeLayer);
	var scopeLayerNames = FontRig.scope.getLayers();
	var layers = [];

	// Active layer first (always included)
	layers.push(activeLayer);

	for (var i = 0; i < scopeLayerNames.length; i++) {
		var lname = scopeLayerNames[i];
		// Skip the active layer (already added)
		if (lname === activeLayer.name) continue;

		var layer = FontRig.getLayerByName(glyphData, lname);
		if (!layer) continue;

		// Only include compatible layers
		if (FontRig.isLayerCompatible(layer, refFp)) {
			layers.push(layer);
		}
	}

	return layers;
};

// Find the contour at a given global contour index within a layer.
// Returns { contour, shape, shapeIdx, contourIdx } or null.
FontRig._findContourInLayer = function(layer, targetCi) {
	if (!layer) return null;
	var ci = 0;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			if (ci === targetCi) {
				return { contour: shape.contours[ki], shape: shape, shapeIdx: si, contourIdx: ki };
			}
			ci++;
		}
	}
	return null;
};

// Find a node by ID (cX_nY) within a specific layer.
// Returns { node, contour, shape } or null.
FontRig._findNodeInLayer = function(layer, nodeId) {
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
				if (targetNi < shape.contours[ki].nodes.length) {
					return {
						node: shape.contours[ki].nodes[targetNi],
						contour: shape.contours[ki],
						shape: shape,
						ni: targetNi
					};
				}
				return null;
			}
			ci++;
		}
	}
	return null;
};


// ===================================================================
// SYNCHRONIZED OPERATIONS
// ===================================================================
// Each sync_* function applies the same structural edit to all
// compatible scope layers. The active layer is always first.
// -------------------------------------------------------------------

// -- Synchronized: Insert node on segment ----------------------------
// Inserts a node at parameter t on the same segment across all layers.
FontRig.sync_insertNodeOnSegment = function(hit) {
	if (!hit || !hit.contour) return;

	// Extract structural info from the hit on the active layer
	var activeCi = hit.ci;
	var segIdx = hit.segIdx;
	var t = hit.t;
	var segType = hit.seg.type;

	var layers = FontRig.getSyncLayers();

	for (var li = 0; li < layers.length; li++) {
		var layer = layers[li];
		var ref = FontRig._findContourInLayer(layer, activeCi);
		if (!ref) continue;

		var contour = ref.contour;
		var segs = FontRig.getContourSegments(contour);
		if (segIdx >= segs.length) continue;

		var seg = segs[segIdx];
		// Verify segment type matches
		if (seg.type !== segType) continue;

		// Build the hit object for this layer's contour
		var layerHit = {
			contour: contour,
			seg: seg,
			t: t,
			x: 0, y: 0  // will be computed per-layer
		};

		// Compute the insertion point on this layer's segment
		var round = function(v) { return Math.round(v * 10) / 10; };
		if (seg.type === 'line') {
			var pt = FontRig._evalLine(seg.pts, t);
			layerHit.x = round(pt.x);
			layerHit.y = round(pt.y);
		} else if (seg.type === 'cubic') {
			var pt = FontRig._evalCubic(seg.pts, t);
			layerHit.x = round(pt.x);
			layerHit.y = round(pt.y);
		} else if (seg.type === 'quadratic') {
			var pt = FontRig._evalQuadratic(seg.pts, t);
			layerHit.x = round(pt.x);
			layerHit.y = round(pt.y);
		}

		// Apply the insertion (reuse existing logic)
		FontRig._insertNodeOnContour(layerHit);
		FontRig.invalidatePathCache(layer);
	}

	FontRig.state.selectedNodeIds.clear();
	FontRig.draw();
	FontRig.updateStatusSelected();
};

// Low-level insert that works on any contour (not just active layer).
// This is the core of insertNodeOnSegment without the redraw/selection.
FontRig._insertNodeOnContour = function(hit) {
	if (!hit || !hit.contour) return;

	// Hobby contours: dispatch to the knot-list mutator. Bezier nodes
	// are derived state and would be overwritten on the next solve.
	if (hit.contour.kind === 'hobby') {
		if (typeof FontRig._insertKnotOnSegment === 'function') {
			FontRig._insertKnotOnSegment(hit);
		}
		return;
	}

	var nodes = hit.contour.nodes;
	var seg = hit.seg;
	var round = function(v) { return Math.round(v * 10) / 10; };

	if (seg.type === 'line') {
		var newNode = {
			type: 'on', smooth: false,
			x: round(hit.x), y: round(hit.y)
		};
		var insertAt = seg.startIdx + 1;
		if (seg.endIdx < seg.startIdx) insertAt = nodes.length;
		nodes.splice(insertAt, 0, newNode);

	} else if (seg.type === 'cubic') {
		var split = FontRig._splitCubic(seg.pts, hit.t);
		var L = split.left;
		var R = split.right;

		var newOff1  = { type: 'curve', x: round(L[1].x), y: round(L[1].y) };
		var newOff2  = { type: 'curve', x: round(L[2].x), y: round(L[2].y) };
		var newOn    = { type: 'on', smooth: true, x: round(L[3].x), y: round(L[3].y) };
		var newOff3  = { type: 'curve', x: round(R[1].x), y: round(R[1].y) };
		var newOff4  = { type: 'curve', x: round(R[2].x), y: round(R[2].y) };

		var idx1 = seg.offIdx1;
		var idx2 = seg.offIdx2;

		if (idx2 === idx1 + 1) {
			nodes.splice(idx1, 2, newOff1, newOff2, newOn, newOff3, newOff4);
		} else {
			nodes.splice(idx1, nodes.length - idx1, newOff1, newOff2, newOn, newOff3, newOff4);
			nodes.splice(0, idx2 + 1);
		}

	} else if (seg.type === 'quadratic') {
		var t = hit.t, u = 1 - t;
		var p0 = seg.pts[0], q1 = seg.pts[1], p2 = seg.pts[2];
		var a = { x: u * p0.x + t * q1.x, y: u * p0.y + t * q1.y };
		var b = { x: u * q1.x + t * p2.x, y: u * q1.y + t * p2.y };
		var m = { x: u * a.x + t * b.x, y: u * a.y + t * b.y };

		var newOffL = { type: 'off', smooth: false, x: round(a.x), y: round(a.y) };
		var newOn   = { type: 'on', smooth: true, x: round(m.x), y: round(m.y) };
		var newOffR = { type: 'off', smooth: false, x: round(b.x), y: round(b.y) };

		nodes.splice(seg.offIdx, 1, newOffL, newOn, newOffR);
	}
};


// -- Synchronized: Delete node ---------------------------------------
// Deletes the same node (by ID) across all compatible layers.
FontRig.sync_deleteNode = function() {
	var sel = FontRig.state.selectedNodeIds;
	if (sel.size !== 1) return;

	var nodeId = sel.values().next().value;
	var layers = FontRig.getSyncLayers();

	for (var li = 0; li < layers.length; li++) {
		var layer = layers[li];
		FontRig._deleteNodeInLayer(layer, nodeId);
		FontRig.invalidatePathCache(layer);
	}

	sel.clear();
	FontRig.draw();
	FontRig.updateStatusSelected();
};

// Low-level delete on a specific layer.
FontRig._deleteNodeInLayer = function(layer, nodeId) {
	var ref = FontRig._findNodeInLayer(layer, nodeId);
	if (!ref) return;

	var contour = ref.contour;

	// Hobby: drop the source knot, then re-solve. The bezier nodes
	// the deleter expects are derived state.
	if (contour.kind === 'hobby') {
		if (typeof FontRig._deleteHobbyKnotById === 'function') {
			FontRig._deleteHobbyKnotById(contour, ref.ni);
			if (FontRig.invalidatePathCache) FontRig.invalidatePathCache(layer);
		}
		return;
	}

	var nodes = contour.nodes;
	var n = nodes.length;
	var ni = ref.ni;
	var node = nodes[ni];

	if (node.type !== 'on') {
		// Off-curve: convert parent segment to line
		var segs = FontRig.getContourSegments(contour);
		for (var gi = 0; gi < segs.length; gi++) {
			var seg = segs[gi];
			var isInSeg = false;
			if (seg.type === 'cubic' && (ni === seg.offIdx1 || ni === seg.offIdx2)) isInSeg = true;
			if (seg.type === 'quadratic' && ni === seg.offIdx) isInSeg = true;
			if (isInSeg) {
				FontRig._convertSegmentToLineInContour(contour, seg);
				return;
			}
		}
		return;
	}

	// On-curve node deletion: same logic as deleteNode but on arbitrary layer
	var incoming = FontRig._analyzeIncoming(nodes, n, ni);
	var outgoing = FontRig._analyzeOutgoing(nodes, n, ni);

	// Sample segments before removal
	var samplesIn = FontRig._sampleSegment(nodes, n, ni, 'incoming', 40);
	var samplesOut = FontRig._sampleSegment(nodes, n, ni, 'outgoing', 40);
	if (samplesOut.length > 0) samplesOut.shift();
	FontRig._pendingSamples = samplesIn.concat(samplesOut);

	var replacement = FontRig._buildReplacement(nodes, incoming, outgoing);
	FontRig._pendingSamples = null;

	var toRemove = new Set();
	toRemove.add(ni);
	for (var i = 0; i < incoming.handleIndices.length; i++) {
		toRemove.add(incoming.handleIndices[i]);
	}
	for (var i = 0; i < outgoing.handleIndices.length; i++) {
		toRemove.add(outgoing.handleIndices[i]);
	}

	var newNodes = [];
	for (var i = 0; i < n; i++) {
		if (toRemove.has(i)) {
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
		var ci = ref.shape.contours.indexOf(contour);
		if (ci >= 0) ref.shape.contours.splice(ci, 1);
	}
};

// Helper: convert segment to line in a contour (for delete off-curve)
FontRig._convertSegmentToLineInContour = function(contour, seg) {
	var nodes = contour.nodes;
	if (seg.type === 'line') return;
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
};


// -- Synchronized: Toggle smooth/sharp -------------------------------
FontRig.sync_toggleSmooth = function() {
	var sel = FontRig.state.selectedNodeIds;
	if (sel.size === 0) return;

	var layers = FontRig.getSyncLayers();

	// Determine target state from active layer first
	var activeLayer = FontRig.getActiveLayer();
	var targetSmooth = null; // will be set per-node

	for (var li = 0; li < layers.length; li++) {
		var layer = layers[li];
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

					if (li === 0) {
						// Active layer: toggle and record state
						nodes[ni].smooth = !nodes[ni].smooth;
						if (nodes[ni].smooth) {
							FontRig._makeSmoothAt(nodes, n, ni);
						}
					} else {
						// Other layers: match the active layer's node state
						var activeRef = FontRig._findNodeInLayer(activeLayer, id);
						if (activeRef) {
							nodes[ni].smooth = activeRef.node.smooth;
							if (nodes[ni].smooth) {
								FontRig._makeSmoothAt(nodes, n, ni);
							}
						}
					}
				}
				ci++;
			}
		}
		FontRig.invalidatePathCache(layer);
	}

	FontRig.draw();
	FontRig.updateStatusSelected();
};


// -- Synchronized: Retract handles -----------------------------------
FontRig.sync_retractHandles = function() {
	var sel = FontRig.state.selectedNodeIds;
	if (sel.size === 0) return;

	var layers = FontRig.getSyncLayers();

	for (var li = 0; li < layers.length; li++) {
		var layer = layers[li];
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
		FontRig.invalidatePathCache(layer);
	}

	FontRig.draw();
	FontRig.updateStatusSelected();
};


// -- Synchronized: Set contour start node ----------------------------
// Rotates a closed contour's node array so the selected node becomes
// the first node. Applied uniformly across all compatible layers.
FontRig.sync_setContourStart = function() {
	var sel = FontRig.state.selectedNodeIds;
	if (sel.size !== 1) return;

	var nodeId = sel.values().next().value;
	var m = nodeId.match(/^c(\d+)_n(\d+)$/);
	if (!m) return;

	var targetCi = parseInt(m[1]);
	var targetNi = parseInt(m[2]);

	// Verify it's an on-curve node on the active layer
	var activeRef = FontRig.findNodeById(nodeId);
	if (!activeRef || activeRef.node.type !== 'on') return;

	// Only works on closed contours
	if (!activeRef.contour.closed) return;

	var layers = FontRig.getSyncLayers();

	for (var li = 0; li < layers.length; li++) {
		var layer = layers[li];
		var ref = FontRig._findContourInLayer(layer, targetCi);
		if (!ref || !ref.contour.closed) continue;

		var contour = ref.contour;
		var nodes = contour.nodes;

		// Ensure targetNi is valid for this layer
		if (targetNi >= nodes.length) continue;
		if (nodes[targetNi].type !== 'on') continue;

		// Rotate so targetNi becomes index 0
		if (targetNi > 0) {
			contour.nodes = nodes.slice(targetNi).concat(nodes.slice(0, targetNi));
		}

		FontRig.invalidatePathCache(layer);
	}

	// Update selection to the new index (now node 0 in the same contour)
	sel.clear();
	sel.add('c' + targetCi + '_n0');
	FontRig.draw();
	FontRig.updateStatusSelected();
};


// -- Synchronized: Reverse contour direction -------------------------
// Reverses the node order of the contour containing the selected node.
// For closed contours, after reversing we rotate so the original first
// node stays first (just the winding direction changes).
FontRig.sync_reverseContour = function(contourIdx) {
	var sel = FontRig.state.selectedNodeIds;
	var targetCi;

	if (contourIdx !== undefined) {
		// Called with explicit contour index (from segment right-click)
		targetCi = contourIdx;
	} else if (sel.size > 0) {
		// Get contour index from first selected node
		var firstId = sel.values().next().value;
		var m = firstId.match(/^c(\d+)/);
		if (!m) return;
		targetCi = parseInt(m[1]);
	} else {
		return;
	}

	var layers = FontRig.getSyncLayers();

	for (var li = 0; li < layers.length; li++) {
		var layer = layers[li];
		var ref = FontRig._findContourInLayer(layer, targetCi);
		if (!ref) continue;

		FontRig._reverseContourNodes(ref.contour);
		FontRig.invalidatePathCache(layer);
	}

	sel.clear();
	FontRig.draw();
	FontRig.updateStatusSelected();
};

// Reverse the node order of a contour in place.
// For closed contours: reverse, then rotate so the first on-curve
// node (which was originally node 0) stays at position 0.
// Also toggles the clockwise flag.
FontRig._reverseContourNodes = function(contour) {
	var nodes = contour.nodes;
	if (nodes.length < 2) return;

	if (contour.closed) {
		// For closed contours with structure like:
		// [on₀, off₁, off₂, on₃, off₄, off₅, on₆, ...]
		// After reverse: [..., on₆, off₅, off₄, on₃, off₂, off₁, on₀]
		// We want on₀ to stay at index 0, so rotate after reverse.
		nodes.reverse();

		// Find where on₀ ended up (it's now at the last position)
		// Rotate it back to the front
		var lastNode = nodes[nodes.length - 1];
		if (lastNode.type === 'on') {
			// Pop last, unshift to front
			nodes.pop();
			nodes.unshift(lastNode);
		}
	} else {
		// Open contours: simple reverse
		nodes.reverse();
	}

	// Toggle direction flag
	if (contour.clockwise !== undefined) {
		contour.clockwise = !contour.clockwise;
	}
};


// -- Synchronized: Convert segment to line ---------------------------
FontRig.sync_convertSegmentToLine = function(hit) {
	if (!hit || !hit.contour) return;

	var activeCi = hit.ci;
	var segIdx = hit.segIdx;
	var segType = hit.seg.type;

	var layers = FontRig.getSyncLayers();

	for (var li = 0; li < layers.length; li++) {
		var layer = layers[li];
		var ref = FontRig._findContourInLayer(layer, activeCi);
		if (!ref) continue;

		var segs = FontRig.getContourSegments(ref.contour);
		if (segIdx >= segs.length) continue;

		var seg = segs[segIdx];
		if (seg.type !== segType) continue;

		FontRig._convertSegmentToLineInContour(ref.contour, seg);
		FontRig.invalidatePathCache(layer);
	}

	FontRig.state.selectedNodeIds.clear();
	FontRig.draw();
	FontRig.updateStatusSelected();
};


// -- Synchronized: Convert segment to cubic --------------------------
FontRig.sync_convertSegmentToCubic = function(hit) {
	if (!hit || !hit.contour) return;

	var activeCi = hit.ci;
	var segIdx = hit.segIdx;
	var segType = hit.seg.type;

	var layers = FontRig.getSyncLayers();
	var round = function(v) { return Math.round(v * 10) / 10; };

	for (var li = 0; li < layers.length; li++) {
		var layer = layers[li];
		var ref = FontRig._findContourInLayer(layer, activeCi);
		if (!ref) continue;

		var contour = ref.contour;
		var segs = FontRig.getContourSegments(contour);
		if (segIdx >= segs.length) continue;

		var seg = segs[segIdx];
		if (seg.type !== segType) continue;
		if (seg.type === 'cubic') continue;

		var nodes = contour.nodes;

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
			var insertAt = seg.startIdx + 1;
			if (seg.endIdx < seg.startIdx) insertAt = nodes.length;
			nodes.splice(insertAt, 0, h1, h2);

		} else if (seg.type === 'quadratic') {
			var q0 = seg.pts[0], q1 = seg.pts[1], q2 = seg.pts[2];
			var p1 = {
				x: round(q0.x + 2/3 * (q1.x - q0.x)),
				y: round(q0.y + 2/3 * (q1.y - q0.y))
			};
			var p2 = {
				x: round(q2.x + 2/3 * (q1.x - q2.x)),
				y: round(q2.y + 2/3 * (q1.y - q2.y))
			};
			nodes.splice(seg.offIdx, 1,
				{ type: 'curve', smooth: false, x: p1.x, y: p1.y },
				{ type: 'curve', smooth: false, x: p2.x, y: p2.y }
			);
		}

		FontRig.invalidatePathCache(layer);
	}

	FontRig.state.selectedNodeIds.clear();
	FontRig.draw();
	FontRig.updateStatusSelected();
};


// -- Synchronized: Convert segment to quadratic ----------------------
FontRig.sync_convertSegmentToQuadratic = function(hit) {
	if (!hit || !hit.contour) return;

	var activeCi = hit.ci;
	var segIdx = hit.segIdx;

	var layers = FontRig.getSyncLayers();
	var round = function(v) { return Math.round(v * 10) / 10; };

	for (var li = 0; li < layers.length; li++) {
		var layer = layers[li];
		var ref = FontRig._findContourInLayer(layer, activeCi);
		if (!ref) continue;

		var contour = ref.contour;
		var segs = FontRig.getContourSegments(contour);
		if (segIdx >= segs.length) continue;

		var seg = segs[segIdx];
		if (seg.type !== 'cubic') continue;

		var nodes = contour.nodes;
		var p0 = seg.pts[0], p1 = seg.pts[1], p2 = seg.pts[2], p3 = seg.pts[3];

		var q1 = {
			x: round((3 * (p1.x + p2.x) - (p0.x + p3.x)) / 4),
			y: round((3 * (p1.y + p2.y) - (p0.y + p3.y)) / 4)
		};

		var idx1 = seg.offIdx1, idx2 = seg.offIdx2;
		if (idx2 === idx1 + 1) {
			nodes.splice(idx1, 2, { type: 'off', smooth: false, x: q1.x, y: q1.y });
		} else {
			nodes.splice(idx1, nodes.length - idx1, { type: 'off', smooth: false, x: q1.x, y: q1.y });
			nodes.splice(0, idx2 + 1);
		}

		FontRig.invalidatePathCache(layer);
	}

	FontRig.state.selectedNodeIds.clear();
	FontRig.draw();
	FontRig.updateStatusSelected();
};


// -- Synchronized: Open contour at node ------------------------------
FontRig.sync_openContourAtNode = function() {
	var sel = FontRig.state.selectedNodeIds;
	if (sel.size !== 1) return;

	var nodeId = sel.values().next().value;
	var m = nodeId.match(/^c(\d+)_n(\d+)$/);
	if (!m) return;

	var targetCi = parseInt(m[1]);
	var targetNi = parseInt(m[2]);

	var layers = FontRig.getSyncLayers();

	for (var li = 0; li < layers.length; li++) {
		var layer = layers[li];
		var ref = FontRig._findContourInLayer(layer, targetCi);
		if (!ref) continue;

		var contour = ref.contour;
		var nodes = contour.nodes;
		var n = nodes.length;

		if (targetNi >= n) continue;
		if (nodes[targetNi].type !== 'on') continue;

		if (contour.closed) {
			var rotated = nodes.slice(targetNi).concat(nodes.slice(0, targetNi));
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
			// Open contour: split into two
			var ep = FontRig.getOpenEndpoints(contour);
			if (!ep) continue;
			if (targetNi === ep.startIdx || targetNi === ep.endIdx) continue;

			var firstNodes = nodes.slice(0, targetNi + 1);
			var secondNodes = nodes.slice(targetNi);

			firstNodes[firstNodes.length - 1] = {
				type: 'on', smooth: false,
				x: nodes[targetNi].x, y: nodes[targetNi].y
			};
			secondNodes[0] = {
				type: 'on', smooth: false,
				x: nodes[targetNi].x, y: nodes[targetNi].y
			};

			var firstOnCount = 0, secondOnCount = 0;
			for (var i = 0; i < firstNodes.length; i++) {
				if (firstNodes[i].type === 'on') firstOnCount++;
			}
			for (var i = 0; i < secondNodes.length; i++) {
				if (secondNodes[i].type === 'on') secondOnCount++;
			}
			if (firstOnCount < 2 || secondOnCount < 2) continue;

			contour.nodes = firstNodes;
			contour.closed = false;

			var newContour = {
				nodes: secondNodes,
				closed: false,
				clockwise: contour.clockwise
			};
			var ci = ref.shape.contours.indexOf(contour);
			ref.shape.contours.splice(ci + 1, 0, newContour);
		}

		FontRig.invalidatePathCache(layer);
	}

	sel.clear();
	FontRig.draw();
	FontRig.updateStatusSelected();
};


// ===================================================================
// HOBBY-SPECIFIC SYNC OPERATIONS
// ===================================================================
// Per the spec: structural changes (contour kind change, knot
// segment-type change) propagate to scope layers under
// active/masters/selected mode. Per-knot tension and direction
// stay active-layer only — those are fine-tuning, not structure.
// -------------------------------------------------------------------

// Convert a contour from bezier to hobby across all in-scope layers.
FontRig.sync_convertContourToHobby = function(contourIdx) {
	if (typeof contourIdx !== 'number' || contourIdx < 0) return;

	var layers = FontRig.getSyncLayers();
	if (layers.length === 0) return;

	if (FontRig.pushUndo) FontRig.pushUndo();

	for (var li = 0; li < layers.length; li++) {
		var layer = layers[li];
		var ref = FontRig._findContourInLayer(layer, contourIdx);
		if (!ref || !ref.contour || ref.contour.kind === 'hobby') continue;
		FontRig.applyConvertContourToHobby(ref.contour, layer);
	}

	if (FontRig.draw) FontRig.draw();
	if (FontRig.updateStatusSelected) FontRig.updateStatusSelected();
};

// Convert a contour from hobby to bezier across all in-scope layers.
FontRig.sync_convertContourToBezier = function(contourIdx) {
	if (typeof contourIdx !== 'number' || contourIdx < 0) return;

	var layers = FontRig.getSyncLayers();
	if (layers.length === 0) return;

	if (FontRig.pushUndo) FontRig.pushUndo();

	for (var li = 0; li < layers.length; li++) {
		var layer = layers[li];
		var ref = FontRig._findContourInLayer(layer, contourIdx);
		if (!ref || !ref.contour || ref.contour.kind !== 'hobby') continue;
		FontRig.applyConvertContourToBezier(ref.contour, layer);
	}

	if (FontRig.draw) FontRig.draw();
	if (FontRig.updateStatusSelected) FontRig.updateStatusSelected();
};

// Change a hobby knot's segment_type across all in-scope layers.
// nodeId identifies the knot on the active layer (cX_nY); the same
// (contour-index, node-index) tuple is used to locate the matching
// knot in each scope layer. Compatible scope layers have identical
// knot maps, so the lookup lands on the same knot.
FontRig.sync_setKnotSegmentType = function(nodeId, segmentType) {
	var m = nodeId && nodeId.match(/^c(\d+)_n(\d+)$/);
	if (!m) return;
	var ci = parseInt(m[1], 10);
	var ni = parseInt(m[2], 10);

	var layers = FontRig.getSyncLayers();
	if (layers.length === 0) return;

	if (FontRig.pushUndo) FontRig.pushUndo();

	for (var li = 0; li < layers.length; li++) {
		var layer = layers[li];
		var ref = FontRig._findContourInLayer(layer, ci);
		if (!ref || !ref.contour || ref.contour.kind !== 'hobby') continue;
		var contour = ref.contour;
		if (!contour._knotMap) continue;
		var ki = contour._knotMap[ni];
		if (ki == null) continue;
		FontRig._applyKnotSegmentTypeInContour(contour, ki, segmentType, layer);
	}

	if (FontRig.draw) FontRig.draw();
	if (FontRig.updateStatusSelected) FontRig.updateStatusSelected();
};
