// ===================================================================
// FontRig — Curvature-Handle Editing Mode
// ===================================================================
// A toggleable editing mode built on geometry/curvature-bezier.js, after
// Steven Wittens' curvature-beziers (acko.net).
//
// When ON, dragging an on-curve node no longer translates its adjacent
// handles rigidly. Instead, for each adjacent CUBIC segment whose far
// on-curve anchor is stationary, the anchor-side handle is re-scaled so
// the CURVATURE at that anchor stays exactly what it was when the drag
// began. This is the paper's headline behaviour — "moving a point scales
// the adjacent tangents to preserve endpoint curvature" — and reduces to
// a well-determined single-unknown solve per segment (no quartic, no
// root-selection ambiguity), so it is cheap and stable enough to run on
// every mouse-move frame.
//
// Interaction with the normal drag pipeline (stream-handlers.js):
//   * The node and its OWN two handles translate rigidly, as always
//     (this fixes the moving-side tangent direction and handle length).
//   * The far anchor and its handle are NOT selection followers, so the
//     standard pass leaves them alone — we then rescale the far handle.
//   * Rescaling moves the far handle only ALONG the anchor tangent, so
//     the anchor's own smoothness (collinearity) is preserved.
//
// Only plain bezier contours participate. Hobby contours have their own
// drag path and return before this runs. Line/corner sides are skipped.
// ===================================================================
'use strict';

FontRig.curvatureMode = false;

var round1 = function(v) { return Math.round(v * 10) / 10; };
function _unit(dx, dy) {
	var m = Math.hypot(dx, dy);
	return (m < 1e-9) ? null : { x: dx / m, y: dy / m };
}

// -------------------------------------------------------------------
// Toggle + menu wiring
// -------------------------------------------------------------------
FontRig.toggleCurvatureMode = function(force) {
	FontRig.curvatureMode = (force === undefined) ? !FontRig.curvatureMode : !!force;

	var btn = document.getElementById('btn-curvature-mode');
	if (btn) btn.classList.toggle('active', FontRig.curvatureMode);

	FontRig.log('[curvature] mode ' + (FontRig.curvatureMode ? 'ON' : 'OFF'));
	if (typeof FontRig.updateStatusSelected === 'function') FontRig.updateStatusSelected();
	if (typeof FontRig.requestDraw === 'function') FontRig.requestDraw();
	else if (typeof FontRig.draw === 'function') FontRig.draw();
	return FontRig.curvatureMode;
};

(function() {
	var btn = document.getElementById('btn-curvature-mode');
	if (btn) btn.addEventListener('click', function() { FontRig.toggleCurvatureMode(); });
})();

// -------------------------------------------------------------------
// Snapshot the curvature targets at drag start.
//
// For every selected ON-curve node, look at its incoming and outgoing
// segments. A side contributes a target only when it is a cubic (two
// off-curve handles) AND its far on-curve anchor is not itself being
// dragged. We store the anchor's fixed tangent direction and the
// curvature to hold, plus the node indices we will rewrite each frame.
// -------------------------------------------------------------------
// `layer` is optional — defaults to the active layer. Passing an explicit
// layer lets the multi-master sync path build targets for each layer.
FontRig._buildCurvatureTargets = function(selectedIds, layer) {
	if (!FontRig.Curvature) return null;
	layer = layer || (FontRig.getActiveLayer && FontRig.getActiveLayer());
	if (!layer) return null;
	var targets = [];

	selectedIds.forEach(function(id) {
		var m = id.match(/^c(\d+)_n(\d+)$/);
		if (!m) return;
		var ci = parseInt(m[1], 10), ni = parseInt(m[2], 10);

		var cref = FontRig._findContourInLayer(layer, ci);
		if (!cref || !cref.contour || cref.contour.kind === 'hobby') return;
		var nodes = cref.contour.nodes;
		if (!nodes || !nodes[ni] || nodes[ni].type !== 'on') return;
		var n = nodes.length;

		// -- incoming segment (prevOn ... handles ... node) -----------
		var inc = FontRig._analyzeIncoming(nodes, n, ni);
		if (inc.type === 'cubic' && inc.handleIndices.length >= 2) {
			var anchorIdx = inc.prevOnIdx;
			if (!selectedIds.has('c' + ci + '_n' + anchorIdx)) {
				var farIdx = inc.handleIndices[inc.handleIndices.length - 1]; // by prevOn
				var movIdx = inc.handleIndices[0];                            // by node
				var anchor = nodes[anchorIdx], node = nodes[ni];
				var far = nodes[farIdx], mov = nodes[movIdx];
				var tAnchor = _unit(far.x - anchor.x, far.y - anchor.y);
				if (tAnchor) {
					var k = FontRig.Curvature.measureEndCurvatures(anchor, far, mov, node).k0;
					targets.push({ nodes: nodes, anchorIdx: anchorIdx, farIdx: farIdx,
						movIdx: movIdx, onIdx: ni, tAnchor: tAnchor, kAnchor: k });
				}
			}
		}

		// -- outgoing segment (node ... handles ... nextOn) -----------
		// Framed reversed (nextOn as the anchor / P0) so the same solve
		// applies: measure curvature at nextOn, hold it, rescale its handle.
		var out = FontRig._analyzeOutgoing(nodes, n, ni);
		if (out.type === 'cubic' && out.handleIndices.length >= 2) {
			var anchorIdx2 = out.nextOnIdx;
			if (!selectedIds.has('c' + ci + '_n' + anchorIdx2)) {
				var farIdx2 = out.handleIndices[out.handleIndices.length - 1]; // by nextOn
				var movIdx2 = out.handleIndices[0];                            // by node
				var anchor2 = nodes[anchorIdx2], node2 = nodes[ni];
				var far2 = nodes[farIdx2], mov2 = nodes[movIdx2];
				var tAnchor2 = _unit(far2.x - anchor2.x, far2.y - anchor2.y);
				if (tAnchor2) {
					// reversed segment [nextOn, far2, mov2, node] -> k0 at nextOn
					var k2 = FontRig.Curvature.measureEndCurvatures(anchor2, far2, mov2, node2).k0;
					targets.push({ nodes: nodes, anchorIdx: anchorIdx2, farIdx: farIdx2,
						movIdx: movIdx2, onIdx: ni, tAnchor: tAnchor2, kAnchor: k2 });
				}
			}
		}
	});

	return targets.length ? targets : null;
};

// -------------------------------------------------------------------
// Per-frame: rescale each far handle to hold its anchor curvature.
// The moving-side tangent + handle length come from the CURRENT (already
// rigidly translated) handle, so directions stay fixed and only the far
// handle length changes. If there is no feasible positive length, the
// far handle is left untouched (graceful — the drag stays valid).
// -------------------------------------------------------------------
FontRig._applyCurvaturePreservation = function(targets) {
	if (!targets || !FontRig.Curvature) return;
	var C = FontRig.Curvature;

	for (var i = 0; i < targets.length; i++) {
		var t = targets[i];
		var nodes = t.nodes;
		var anchor = nodes[t.anchorIdx];
		var node = nodes[t.onIdx];
		var mov = nodes[t.movIdx];

		var tMoving = _unit(node.x - mov.x, node.y - mov.y);
		if (!tMoving) continue;
		var lMoving = Math.hypot(node.x - mov.x, node.y - mov.y);

		var l0 = C.solveAnchorHandleLength(anchor, node, t.tAnchor, tMoving, lMoving, t.kAnchor);
		if (l0 === null || !isFinite(l0) || l0 <= 0) continue;

		var far = nodes[t.farIdx];
		far.x = round1(anchor.x + l0 * t.tAnchor.x);
		far.y = round1(anchor.y + l0 * t.tAnchor.y);
	}
};

// ===================================================================
// Handle-drag = curvature editing
// ===================================================================
// When exactly one cubic off-curve BCP is selected, dragging it edits
// that endpoint's curvature: the handle slides along its tangent (its
// length = the curve tension there) and the segment's OPPOSITE handle
// re-solves to hold the FAR endpoint's curvature fixed. One unknown,
// one equation — same well-determined solve as the node drag.
//
// Returns the drag context, or null when the selection is not a single
// standard cubic BCP (then the normal drag path runs).
// -------------------------------------------------------------------
FontRig._curvatureHandleTarget = function(sel, layer) {
	if (!sel || sel.size !== 1) return null;
	layer = layer || (FontRig.getActiveLayer && FontRig.getActiveLayer());
	if (!layer) return null;
	var id = sel.values().next().value;
	var m = id.match(/^c(\d+)_n(\d+)$/);
	if (!m) return null;

	var cref = FontRig._findContourInLayer(layer, parseInt(m[1], 10));
	if (!cref || !cref.contour || cref.contour.kind === 'hobby') return null;
	var nodes = cref.contour.nodes;
	var hi = parseInt(m[2], 10);
	if (!nodes || !nodes[hi] || nodes[hi].type !== 'curve') return null;   // cubic BCP only
	var n = nodes.length;

	var prevOn = nodes[(hi - 1 + n) % n].type === 'on';
	var nextOn = nodes[(hi + 1) % n].type === 'on';

	var myOnIdx, otherIdx, farOnIdx;
	if (prevOn && !nextOn) {              // near-handle b0 of [onA,b0,b1,onB]
		myOnIdx  = (hi - 1 + n) % n;
		otherIdx = (hi + 1) % n;
		farOnIdx = (hi + 2) % n;
	} else if (nextOn && !prevOn) {       // far-handle b1
		myOnIdx  = (hi + 1) % n;
		otherIdx = (hi - 1 + n) % n;
		farOnIdx = (hi - 2 + n) % n;
	} else {
		return null;
	}
	if (nodes[otherIdx].type !== 'curve' || nodes[farOnIdx].type !== 'on') return null;

	return { contour: cref.contour, nodes: nodes,
		hi: hi, myOnIdx: myOnIdx, otherIdx: otherIdx, farOnIdx: farOnIdx };
};

FontRig._handleCurvatureHandleDrag = async function(stream, initialEvent, sx, sy, tgt) {
	var C = FontRig.Curvature;
	FontRig.pushUndo();
	if (typeof FontRig.lerpEditStart === 'function') FontRig.lerpEditStart();

	var nodes  = tgt.nodes;
	var myOn   = nodes[tgt.myOnIdx];      // stationary on-curve (pivot)
	var farOn  = nodes[tgt.farOnIdx];     // stationary anchor (curvature held)
	var dragged = nodes[tgt.hi];
	var other  = nodes[tgt.otherIdx];

	// Fixed tangent directions (captured at drag start).
	var dirDragged = _unit(dragged.x - myOn.x, dragged.y - myOn.y); // may be null
	var tAnchor    = _unit(other.x - farOn.x, other.y - farOn.y);

	// Curvature to hold at farOn, in the reversed frame [farOn,other,dragged,myOn].
	var kAnchor = C.measureEndCurvatures(farOn, other, dragged, myOn).k0;

	if (FontRig.dom.canvasWrap) FontRig.dom.canvasWrap.style.cursor = 'move';

	for await (var event of stream) {
		if (event.type === 'key') continue;

		var evtCoords = FontRig._interactionCoords(event.absSx, event.absSy);
		FontRig._withActiveOffset(function() {
			var dgp = FontRig.screenToGlyph(evtCoords.sx, evtCoords.sy);

			// Project the cursor onto the fixed tangent to get the new
			// handle length. If the handle had no direction (zero length),
			// let the cursor define it freely this frame.
			var dir = dirDragged;
			var L;
			if (dir) {
				L = (dgp.x - myOn.x) * dir.x + (dgp.y - myOn.y) * dir.y;
			} else {
				dir = _unit(dgp.x - myOn.x, dgp.y - myOn.y);
				if (!dir) return;
				L = Math.hypot(dgp.x - myOn.x, dgp.y - myOn.y);
			}
			if (L < 2) L = 2;                     // keep a minimal, valid handle

			dragged.x = round1(myOn.x + L * dir.x);
			dragged.y = round1(myOn.y + L * dir.y);

			// Re-solve the opposite handle to hold farOn's curvature.
			if (tAnchor) {
				var tMoving = { x: -dir.x, y: -dir.y };  // unit(myOn - dragged)
				var l1 = C.solveAnchorHandleLength(farOn, myOn, tAnchor, tMoving, L, kAnchor);
				if (l1 !== null && isFinite(l1) && l1 > 0) {
					other.x = round1(farOn.x + l1 * tAnchor.x);
					other.y = round1(farOn.y + l1 * tAnchor.y);
				}
			}
		});

		if (typeof FontRig.invalidatePathCache === 'function') {
			var lyr = FontRig.getActiveLayer && FontRig.getActiveLayer();
			if (lyr) FontRig.invalidatePathCache(lyr);
		}
		if (typeof FontRig.lerpSync === 'function') FontRig.lerpSync();
		FontRig.requestDraw();
		FontRig.updateStatusSelected();
	}

	FontRig.updateCanvasCursor();
};

// ===================================================================
// Keyboard (arrow-key nudge) support
// ===================================================================
// Arrow-key edits go through moveSelectedNodes, not the drag stream, so
// they need their own hook. Snapshot the curvature targets BEFORE the
// nudge (measuring the pre-move geometry), then re-apply AFTER the move
// and the smooth-enforcement pass. Covers both on-curve node nudges
// (hold adjacent anchor curvature) and a single-BCP nudge (hold the far
// endpoint's curvature by re-solving the opposite handle).
// -------------------------------------------------------------------
FontRig._snapshotCurvatureForNudge = function(sel, layer) {
	if (!FontRig.curvatureMode || !FontRig.Curvature) return null;

	var nodeTargets = FontRig._buildCurvatureTargets(sel, layer);

	var handleTarget = null;
	var ht = FontRig._curvatureHandleTarget(sel, layer);
	if (ht) {
		var nodes = ht.nodes;
		var k = FontRig.Curvature.measureEndCurvatures(
			nodes[ht.farOnIdx], nodes[ht.otherIdx], nodes[ht.hi], nodes[ht.myOnIdx]).k0;
		var tAnchor = _unit(nodes[ht.otherIdx].x - nodes[ht.farOnIdx].x,
		                    nodes[ht.otherIdx].y - nodes[ht.farOnIdx].y);
		if (tAnchor) handleTarget = { tgt: ht, kAnchor: k, tAnchor: tAnchor };
	}

	if (!nodeTargets && !handleTarget) return null;
	return { nodeTargets: nodeTargets, handleTarget: handleTarget };
};

FontRig._applyCurvatureForNudge = function(snap) {
	if (!snap) return;
	if (snap.nodeTargets) FontRig._applyCurvaturePreservation(snap.nodeTargets);

	if (snap.handleTarget) {
		var C = FontRig.Curvature;
		var ht = snap.handleTarget.tgt, nodes = ht.nodes;
		var myOn = nodes[ht.myOnIdx], farOn = nodes[ht.farOnIdx];
		var dragged = nodes[ht.hi], other = nodes[ht.otherIdx];
		var tAnchor = snap.handleTarget.tAnchor;

		var dir = _unit(dragged.x - myOn.x, dragged.y - myOn.y);
		if (!dir) return;
		var L = Math.hypot(dragged.x - myOn.x, dragged.y - myOn.y);
		var tMoving = { x: -dir.x, y: -dir.y };

		var l1 = C.solveAnchorHandleLength(farOn, myOn, tAnchor, tMoving, L, snap.handleTarget.kAnchor);
		if (l1 !== null && isFinite(l1) && l1 > 0) {
			other.x = round1(farOn.x + l1 * tAnchor.x);
			other.y = round1(farOn.y + l1 * tAnchor.y);
		}
	}
};
