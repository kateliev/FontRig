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
FontRig._buildCurvatureTargets = function(selectedIds) {
	if (!FontRig.Curvature) return null;
	var targets = [];

	selectedIds.forEach(function(id) {
		var m = id.match(/^c(\d+)_n(\d+)$/);
		if (!m) return;
		var ci = parseInt(m[1], 10), ni = parseInt(m[2], 10);

		var ref = FontRig.findNodeById(id);
		if (!ref || !ref.contour || ref.contour.kind === 'hobby') return;
		var nodes = ref.contour.nodes;
		if (!nodes || nodes[ni].type !== 'on') return;
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
