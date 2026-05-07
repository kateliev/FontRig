// ===================================================================
// FontRig — Hobby Contour Helpers
// ===================================================================
// Hobby contours persist as a knot list (the source of truth) but
// the renderer and edit code paths in FontRig walk `contour.nodes`
// (solved bezier). This module bridges the two:
//
//   - solveHobbyContour(contour) populates contour.nodes from
//     contour.knots via Pyodide's hobby_preview_solve, and builds
//     contour._knotMap (per-node-index → knot-index, or null for
//     off-curves).
//
//   - solveAllHobbyContours(glyphData) walks the glyph and solves
//     every hobby contour. No-op if Pyodide isn't ready yet; the
//     caller can re-invoke when the bridge comes online.
//
// Knot mutation invalidates the bezier nodes; callers must re-solve
// before drawing or hit-testing.
// ===================================================================
'use strict';

// Convert a JS knot dict into the JSON shape hobby_preview_solve
// (and npa_draw_hobby) expect — keeps tension/direction defaults
// out of the payload to keep it small.
FontRig._hobbyKnotToPayload = function(knot) {
	var entry = { position: [knot.x, knot.y], segment: knot.segment_type || 'hobby' };
	if (knot.alpha !== undefined && knot.alpha !== null && knot.alpha !== 1.0) entry.alpha = knot.alpha;
	if (knot.beta  !== undefined && knot.beta  !== null && knot.beta  !== 1.0) entry.beta  = knot.beta;
	if (knot.dir_in  !== undefined && knot.dir_in  !== null) entry.dir_in  = knot.dir_in;
	if (knot.dir_out !== undefined && knot.dir_out !== null) entry.dir_out = knot.dir_out;
	return entry;
};

// Build the per-node knot mapping in lockstep with HobbySpline.nodes:
// each knot emits one on-curve, then 0 off-curves (line) or 2
// off-curves (hobby/fixed). For OPEN contours we keep a terminal
// on-curve at the last knot so the renderer has a chord endpoint;
// for CLOSED contours we drop it (along with the matching solved
// node) — the duplicate-of-first node otherwise makes the start
// knot register as "stacked" and triggers the overlap warning.
FontRig._buildKnotMap = function(knots, closed) {
	var map = [];
	var n = knots.length;
	if (n === 0) return map;

	var count = closed ? n : n - 1;

	for (var i = 0; i < count; i++) {
		map.push(i);
		var seg = knots[i].segment_type || 'hobby';
		if (seg === 'hobby' || seg === 'fixed') {
			map.push(null);
			map.push(null);
		}
	}

	// Open path only — append the terminal endpoint for the chord.
	if (!closed) map.push(n - 1);

	return map;
};

// Solve a single hobby contour, populate contour.nodes + knot map.
// Returns true on success, false if pyBridge isn't ready or the
// solve failed.
FontRig.solveHobbyContour = function(contour) {
	if (!contour || contour.kind !== 'hobby') return false;
	if (!contour.knots || contour.knots.length < 2) {
		contour.nodes = [];
		contour._knotMap = [];
		return true;
	}
	if (!FontRig.pyBridge || !FontRig.pyBridge.ready) return false;

	var payload = contour.knots.map(FontRig._hobbyKnotToPayload);
	var json = JSON.stringify(payload);
	var pyo = FontRig.pyBridge.pyodide;

	try {
		pyo.globals.set('_hobby_knots', json);
		pyo.globals.set('_hobby_closed', !!contour.closed);
		pyo.globals.set('_hobby_tension', 1.0);
		var raw = pyo.runPython(
			'hobby_preview_solve(_hobby_knots, _hobby_closed, _hobby_tension) ' +
			'if hobby_preview_solve else "[]"'
		);
		var triples = JSON.parse(raw);

		// TypeRig's HobbySpline.nodes always appends a terminal on-curve.
		// For closed contours that's a duplicate of the first knot —
		// drop it so it doesn't (a) double-render a knot, (b) register
		// as a stacked-node overlap, or (c) drift out of sync with the
		// knot map.
		if (contour.closed && triples.length > 0) {
			var last = triples[triples.length - 1];
			if (last && last[2] === 'on') triples.pop();
		}

		contour.nodes = triples.map(function(t) {
			return { x: t[0], y: t[1], type: t[2], smooth: false };
		});
		contour._knotMap = FontRig._buildKnotMap(contour.knots, !!contour.closed);
		return true;
	} catch (err) {
		console.warn('[hobby] solve failed:', err);
		return false;
	}
};

// Quick scan: does a glyph contain any hobby contours? Used to decide
// whether loading the glyph requires Pyodide (only hobby contours
// need the solver).
FontRig.glyphHasHobby = function(glyphData) {
	if (!glyphData || !glyphData.layers) return false;
	for (var li = 0; li < glyphData.layers.length; li++) {
		var lyr = glyphData.layers[li];
		if (!lyr.shapes) continue;
		for (var si = 0; si < lyr.shapes.length; si++) {
			var shp = lyr.shapes[si];
			if (!shp.contours) continue;
			for (var ci = 0; ci < shp.contours.length; ci++) {
				if (shp.contours[ci].kind === 'hobby') return true;
			}
		}
	}
	return false;
};

// Auto-bootstrap: if Pyodide isn't already loaded and we just landed
// on a glyph that needs the solver, fire-and-forget pyBridge.init().
// The bridge's ready handler will re-run solveAllHobbyContours and
// redraw once it finishes.
FontRig.ensureHobbySolverReady = function(glyphData) {
	if (!FontRig.glyphHasHobby(glyphData)) return;
	if (!FontRig.pyBridge) return;
	if (FontRig.pyBridge.ready || FontRig.pyBridge.loading) return;

	console.log('[hobby] glyph contains hobby contours — initializing Python solver');
	FontRig.pyBridge.init(function(msg) {
		console.log('[hobby:init] ' + msg);
	}).catch(function(err) {
		console.error('[hobby] solver init failed:', err);
	});
};

// Insert a new knot on a hobby contour at the position the user
// clicked on a segment. The hit is the same shape hitTestSegment
// returns: { contour, seg, x, y, t }. We resolve which knot the
// segment starts at (via _knotMap), insert a new knot between it
// and the next knot, then re-solve so the bezier shadow refreshes.
FontRig._insertKnotOnSegment = function(hit) {
	var contour = hit && hit.contour;
	if (!contour || contour.kind !== 'hobby') return;
	if (!contour.knots || !contour._knotMap) return;

	var seg = hit.seg;
	var startNi = seg.startIdx;
	var startKi = contour._knotMap[startNi];
	if (startKi === null || startKi === undefined) return;

	var round = function(v) { return Math.round(v * 10) / 10; };

	// New knot inherits the previous knot's outgoing segment type so
	// both halves of the split keep the same character (hobby split
	// stays hobby; line split stays line).
	var prevKnot = contour.knots[startKi];
	var newSeg = (prevKnot && prevKnot.segment_type) || 'hobby';

	var newKnot = {
		x: round(hit.x),
		y: round(hit.y),
		segment_type: newSeg,
		alpha: 1.0,
		beta: 1.0,
		dir_in: null,
		dir_out: null,
	};

	contour.knots.splice(startKi + 1, 0, newKnot);

	FontRig.solveHobbyContour(contour);

	var lyr = FontRig.getActiveLayer && FontRig.getActiveLayer();
	if (lyr && FontRig.invalidatePathCache) FontRig.invalidatePathCache(lyr);
};


// Delete a knot identified by a bezier-node index (which is what
// FontRig's selection ids carry). Off-curve indices are no-ops —
// they don't map to a knot.
FontRig._deleteHobbyKnotById = function(contour, ni) {
	if (!contour || contour.kind !== 'hobby') return false;
	if (!contour.knots || !contour._knotMap) return false;
	var ki = contour._knotMap[ni];
	if (ki === null || ki === undefined) return false;
	if (contour.knots.length <= 2) return false;  // keep contour valid

	contour.knots.splice(ki, 1);
	FontRig.solveHobbyContour(contour);
	return true;
};


// Locate a contour in the active layer by index (matches the
// contour-id encoding the context menu uses).
FontRig._findContourByIndex = function(ci) {
	var layer = FontRig.getActiveLayer && FontRig.getActiveLayer();
	if (!layer) return null;
	var i = 0;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shp = layer.shapes[si];
		for (var ki = 0; ki < shp.contours.length; ki++) {
			if (i === ci) return { contour: shp.contours[ki], shape: shp, layer: layer };
			i++;
		}
	}
	return null;
};

// Convert a hobby contour to bezier in place. The solver has already
// produced the bezier shadow on contour.nodes; we just promote it
// to the source of truth and drop the knot data. Irreversible
// without undo.
FontRig.convertContourToBezier = function(ci) {
	var ref = FontRig._findContourByIndex(ci);
	if (!ref || ref.contour.kind !== 'hobby') return false;

	var c = ref.contour;
	if (!c.nodes || c.nodes.length === 0) {
		// Solver hasn't produced nodes yet — try once.
		FontRig.solveHobbyContour(c);
	}
	if (!c.nodes || c.nodes.length === 0) {
		console.warn('[hobby] convert to bezier: no solved nodes available');
		return false;
	}

	if (FontRig.pushUndo) FontRig.pushUndo();

	// Snapshot solved nodes as the new persistent bezier nodes.
	c.nodes = c.nodes.map(function(n) {
		return { x: n.x, y: n.y, type: n.type, smooth: false };
	});
	c.kind = 'bezier';
	delete c.knots;
	delete c._knotMap;

	if (FontRig.invalidatePathCache) FontRig.invalidatePathCache(ref.layer);
	if (FontRig.draw) FontRig.draw();
	return true;
};

// Convert a bezier contour to hobby. Calls Python (HobbySpline.
// from_contour) to recover knot positions and tensions; replaces
// nodes with the solved knot list, then re-solves to populate the
// bezier shadow for rendering.
FontRig.convertContourToHobby = function(ci) {
	var ref = FontRig._findContourByIndex(ci);
	if (!ref || ref.contour.kind === 'hobby') return false;
	if (!FontRig.pyBridge || !FontRig.pyBridge.ready) {
		console.warn('[hobby] convert to hobby: Python solver not ready');
		FontRig.ensureHobbySolverReady && FontRig.ensureHobbySolverReady(FontRig.state.glyphData);
		return false;
	}

	var c = ref.contour;
	var nodesPayload = (c.nodes || []).map(function(n) {
		return [n.x, n.y, n.type];
	});

	var pyo = FontRig.pyBridge.pyodide;
	var raw;
	try {
		pyo.globals.set('_bz_nodes', JSON.stringify(nodesPayload));
		raw = pyo.runPython(
			'hobby_knots_from_bezier_json(_bz_nodes) ' +
			'if hobby_knots_from_bezier_json else "[]"'
		);
	} catch (err) {
		console.error('[hobby] convert to hobby failed:', err);
		return false;
	}

	var knots;
	try { knots = JSON.parse(raw); }
	catch (e) { knots = []; }

	if (!knots || knots.length < 2) {
		console.warn('[hobby] convert to hobby: solver returned no knots');
		return false;
	}

	if (FontRig.pushUndo) FontRig.pushUndo();

	c.kind = 'hobby';
	c.knots = knots.map(function(k) {
		return {
			x: k.x, y: k.y,
			segment_type: k.segment_type || 'hobby',
			alpha: (k.alpha != null) ? k.alpha : 1.0,
			beta:  (k.beta  != null) ? k.beta  : 1.0,
			dir_in: null, dir_out: null,
		};
	});
	c.nodes = [];
	FontRig.solveHobbyContour(c);

	if (FontRig.invalidatePathCache) FontRig.invalidatePathCache(ref.layer);
	if (FontRig.draw) FontRig.draw();
	return true;
};


// Bulk flatten — convert every hobby contour in a layer to bezier
// (in-place). Returns the count of contours converted.
FontRig.flattenHobbyInLayer = function(layer) {
	if (!layer || !layer.shapes) return 0;
	var converted = 0;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shp = layer.shapes[si];
		if (!shp.contours) continue;
		for (var ci = 0; ci < shp.contours.length; ci++) {
			var c = shp.contours[ci];
			if (c.kind !== 'hobby') continue;

			if (!c.nodes || c.nodes.length === 0) {
				FontRig.solveHobbyContour(c);
			}
			if (!c.nodes || c.nodes.length === 0) continue;

			c.nodes = c.nodes.map(function(n) {
				return { x: n.x, y: n.y, type: n.type, smooth: false };
			});
			c.kind = 'bezier';
			delete c.knots;
			delete c._knotMap;
			converted++;
		}
	}
	if (converted && FontRig.invalidatePathCache) FontRig.invalidatePathCache(layer);
	return converted;
};

// Bulk flatten across the whole active glyph (every layer).
FontRig.flattenHobbyInGlyph = function(glyphData) {
	if (!glyphData || !glyphData.layers) return 0;
	var total = 0;
	for (var li = 0; li < glyphData.layers.length; li++) {
		total += FontRig.flattenHobbyInLayer(glyphData.layers[li]);
	}
	return total;
};

// Modal dialog for the Glyph > Convert all Hobby splines to Beziers
// menu item. Lets the user pick scope (current layer / all layers
// of this glyph) and confirm the irreversible change.
FontRig.openFlattenHobbyDialog = function() {
	if (typeof FRWidget === 'undefined' || !FRWidget.Dialog) {
		console.warn('[hobby] FRWidget.Dialog unavailable');
		return;
	}

	var glyphData = FontRig.state && FontRig.state.glyphData;
	if (!glyphData) return;

	var activeLayer = FontRig.getActiveLayer && FontRig.getActiveLayer();
	var activeName = activeLayer ? (activeLayer.name || '(unnamed)') : '(none)';

	// Count hobby contours in scope so the message is concrete.
	function countHobby(layer) {
		var n = 0;
		if (!layer || !layer.shapes) return 0;
		for (var si = 0; si < layer.shapes.length; si++) {
			var shp = layer.shapes[si];
			if (!shp.contours) continue;
			for (var ci = 0; ci < shp.contours.length; ci++) {
				if (shp.contours[ci].kind === 'hobby') n++;
			}
		}
		return n;
	}

	var countActive = countHobby(activeLayer);
	var countTotal = 0;
	for (var li = 0; li < glyphData.layers.length; li++) {
		countTotal += countHobby(glyphData.layers[li]);
	}

	if (countTotal === 0) {
		console.log('[hobby] no hobby contours in this glyph');
		return;
	}

	// Body: explanation + scope radios.
	var wrap = document.createElement('div');

	var note = document.createElement('p');
	note.style.margin = '0 0 12px 0';
	note.style.lineHeight = '1.4';
	note.innerHTML =
		'Replaces every Hobby contour in scope with the bezier curve ' +
		'currently produced by the solver. The original knot data is ' +
		'discarded — <b>this cannot be reversed</b> except via undo. ' +
		'Use this when you want to hand-edit the resulting bezier ' +
		'handles or freeze the curve before export.';
	wrap.appendChild(note);

	var scopeFs = document.createElement('div');
	scopeFs.style.display = 'flex';
	scopeFs.style.flexDirection = 'column';
	scopeFs.style.gap = '6px';
	scopeFs.style.margin = '0 0 8px 0';

	function makeRadio(value, label, count, checked) {
		var lab = document.createElement('label');
		lab.style.display = 'flex';
		lab.style.alignItems = 'center';
		lab.style.gap = '8px';
		lab.style.cursor = (count > 0) ? 'pointer' : 'not-allowed';
		lab.style.opacity = (count > 0) ? '1' : '0.5';

		var inp = document.createElement('input');
		inp.type = 'radio';
		inp.name = 'flatten-hobby-scope';
		inp.value = value;
		inp.checked = !!checked;
		if (count === 0) inp.disabled = true;
		lab.appendChild(inp);

		var txt = document.createElement('span');
		txt.textContent = label + '  (' + count + ' hobby contour' + (count === 1 ? '' : 's') + ')';
		lab.appendChild(txt);

		scopeFs.appendChild(lab);
		return inp;
	}

	var radioActive = makeRadio('active',
		'Current layer (' + activeName + ')',
		countActive,
		countActive > 0);
	var radioGlyph = makeRadio('glyph',
		'All layers of this glyph',
		countTotal,
		countActive === 0 && countTotal > 0);

	wrap.appendChild(scopeFs);

	var dlg = FRWidget.Dialog({
		title: 'Convert all Hobby splines to Beziers',
		body: wrap,
		buttons: [
			{ text: 'Cancel', primary: false, onClick: function() {} },
			{ text: 'Convert', primary: true, onClick: function() {
				var scope = radioActive.checked ? 'active' :
				            (radioGlyph.checked ? 'glyph' : null);
				if (!scope) return;

				if (FontRig.pushUndo) FontRig.pushUndo();

				var converted = 0;
				if (scope === 'active') {
					converted = FontRig.flattenHobbyInLayer(activeLayer);
				} else {
					converted = FontRig.flattenHobbyInGlyph(glyphData);
				}

				console.log('[hobby] flattened ' + converted + ' contour(s)');
				if (FontRig.draw) FontRig.draw();
				if (FontRig.syncXmlFromData) FontRig.syncXmlFromData();
				if (FontRig.updateStatusSelected) FontRig.updateStatusSelected();
			}}
		],
	});
	dlg.open();
};


// Resolve a selected node id to its source knot. Returns
// { contour, knot, ki } or null if the id doesn't map to a knot
// (e.g. it's an off-curve node, or the contour isn't hobby).
FontRig._resolveKnotByNodeId = function(nodeId) {
	if (typeof FontRig.findNodeById !== 'function') return null;
	var ref = FontRig.findNodeById(nodeId);
	if (!ref || !ref.contour || ref.contour.kind !== 'hobby') return null;
	var m = nodeId.match(/^c\d+_n(\d+)$/);
	if (!m) return null;
	var ni = parseInt(m[1], 10);
	if (!ref.contour._knotMap) return null;
	var ki = ref.contour._knotMap[ni];
	if (ki == null) return null;
	var knot = ref.contour.knots && ref.contour.knots[ki];
	if (!knot) return null;
	return { contour: ref.contour, knot: knot, ki: ki, layer: ref.layer };
};

// Set the segment_type on the knot at the given node id. The
// segment_type describes the segment going OUT of this knot to the
// next knot. Re-solves the contour so the bezier shadow refreshes.
FontRig.setKnotSegmentType = function(nodeId, segmentType) {
	var info = FontRig._resolveKnotByNodeId(nodeId);
	if (!info) return false;
	if (segmentType !== 'hobby' && segmentType !== 'line' && segmentType !== 'fixed') {
		return false;
	}
	if (info.knot.segment_type === segmentType) return false;

	if (FontRig.pushUndo) FontRig.pushUndo();
	info.knot.segment_type = segmentType;

	FontRig.solveHobbyContour(info.contour);
	if (info.layer && FontRig.invalidatePathCache) FontRig.invalidatePathCache(info.layer);
	if (FontRig.draw) FontRig.draw();
	return true;
};

// Adjust per-knot tension by a multiplicative factor. By default
// affects both alpha (out-tension) and beta (in-tension); pass
// {alphaOnly:true} or {betaOnly:true} to split. Tension is clamped
// to [TENSION_MIN, TENSION_MAX] to match TypeRig's solver bounds.
FontRig.HOBBY_TENSION_MIN = 0.1;
FontRig.HOBBY_TENSION_MAX = 10.0;

FontRig.adjustKnotTension = function(nodeId, factor, opts) {
	var info = FontRig._resolveKnotByNodeId(nodeId);
	if (!info) return false;

	opts = opts || {};
	var k = info.knot;
	var clamp = function(v) {
		return Math.max(FontRig.HOBBY_TENSION_MIN,
		                Math.min(FontRig.HOBBY_TENSION_MAX, v));
	};

	if (!opts.betaOnly)  k.alpha = clamp((k.alpha || 1.0) * factor);
	if (!opts.alphaOnly) k.beta  = clamp((k.beta  || 1.0) * factor);

	FontRig.solveHobbyContour(info.contour);
	if (info.layer && FontRig.invalidatePathCache) FontRig.invalidatePathCache(info.layer);
	if (FontRig.draw) FontRig.draw();
	return true;
};

// Reset both tensions to 1.0.
FontRig.resetKnotTension = function(nodeId) {
	var info = FontRig._resolveKnotByNodeId(nodeId);
	if (!info) return false;
	if (info.knot.alpha === 1.0 && info.knot.beta === 1.0) return false;

	if (FontRig.pushUndo) FontRig.pushUndo();
	info.knot.alpha = 1.0;
	info.knot.beta = 1.0;

	FontRig.solveHobbyContour(info.contour);
	if (info.layer && FontRig.invalidatePathCache) FontRig.invalidatePathCache(info.layer);
	if (FontRig.draw) FontRig.draw();
	return true;
};

// Apply an action to every selected hobby knot at once. Pushes a
// single undo for the whole batch and re-solves each touched
// contour exactly once.
FontRig._withSelectedKnots = function(fn) {
	if (!FontRig.state || !FontRig.state.selectedNodeIds) return 0;

	var infos = [];
	var contours = new Set();
	FontRig.state.selectedNodeIds.forEach(function(id) {
		var info = FontRig._resolveKnotByNodeId(id);
		if (info) {
			infos.push(info);
			contours.add(info.contour);
		}
	});
	if (infos.length === 0) return 0;

	if (FontRig.pushUndo) FontRig.pushUndo();
	for (var i = 0; i < infos.length; i++) fn(infos[i]);

	contours.forEach(function(c) { FontRig.solveHobbyContour(c); });
	var lyr = FontRig.getActiveLayer && FontRig.getActiveLayer();
	if (lyr && FontRig.invalidatePathCache) FontRig.invalidatePathCache(lyr);
	if (FontRig.draw) FontRig.draw();
	return infos.length;
};


// Walk a glyph and solve every hobby contour. Used right after parse
// (to display loaded knots) and after Python sync (to refresh after
// commit/edit). No-op if Pyodide isn't ready — the caller is expected
// to re-invoke once the bridge comes online.
FontRig.solveAllHobbyContours = function(glyphData) {
	if (!glyphData || !glyphData.layers) return false;
	if (!FontRig.pyBridge || !FontRig.pyBridge.ready) return false;

	var any = false;
	for (var li = 0; li < glyphData.layers.length; li++) {
		var lyr = glyphData.layers[li];
		if (!lyr.shapes) continue;
		var solvedThisLayer = false;
		for (var si = 0; si < lyr.shapes.length; si++) {
			var shp = lyr.shapes[si];
			if (!shp.contours) continue;
			for (var ci = 0; ci < shp.contours.length; ci++) {
				var c = shp.contours[ci];
				if (c.kind === 'hobby') {
					if (FontRig.solveHobbyContour(c)) {
						any = true;
						solvedThisLayer = true;
					}
				}
			}
		}
		// We mutated contour.nodes in place; the Path2D cache compares
		// by shapes-reference equality and won't otherwise notice.
		if (solvedThisLayer && typeof FontRig.invalidatePathCache === 'function') {
			FontRig.invalidatePathCache(lyr);
		}
	}
	return any;
};
