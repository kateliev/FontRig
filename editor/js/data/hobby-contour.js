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
	if (knot.fixed_bcp_out_x != null && knot.fixed_bcp_out_y != null) {
		entry.bcp_out = [knot.fixed_bcp_out_x, knot.fixed_bcp_out_y];
	}
	if (knot.fixed_bcp_in_x != null && knot.fixed_bcp_in_y != null) {
		entry.bcp_in = [knot.fixed_bcp_in_x, knot.fixed_bcp_in_y];
	}
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

// Parallel map: per node-index, the kind of the segment that node
// belongs to. For on-curves this is the OUTGOING segment kind; for
// off-curves this is the kind of the segment they sit inside (i.e.
// the outgoing segment of the previous on-curve). The terminal
// on-curve of an open contour gets null (no outgoing segment).
FontRig._buildSegmentKindMap = function(knots, closed) {
	var map = [];
	var n = knots.length;
	if (n === 0) return map;

	var count = closed ? n : n - 1;

	for (var i = 0; i < count; i++) {
		var seg = knots[i].segment_type || 'hobby';
		map.push(seg);
		if (seg === 'hobby' || seg === 'fixed') {
			map.push(seg);
			map.push(seg);
		}
	}

	if (!closed) map.push(null);

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
		contour._segmentKindMap = FontRig._buildSegmentKindMap(contour.knots, !!contour.closed);
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

// Layer-agnostic core: hobby → bezier on a specific contour. The
// solver has already produced the bezier shadow on contour.nodes;
// we promote it to the source of truth and drop the knot data.
// No undo, no draw — caller batches.
FontRig.applyConvertContourToBezier = function(contour, layer) {
	if (!contour || contour.kind !== 'hobby') return false;

	if (!contour.nodes || contour.nodes.length === 0) {
		FontRig.solveHobbyContour(contour);
	}
	if (!contour.nodes || contour.nodes.length === 0) {
		console.warn('[hobby] convert to bezier: no solved nodes available');
		return false;
	}

	contour.nodes = contour.nodes.map(function(n) {
		return { x: n.x, y: n.y, type: n.type, smooth: false };
	});
	contour.kind = 'bezier';
	delete contour.knots;
	delete contour._knotMap;

	if (layer && FontRig.invalidatePathCache) FontRig.invalidatePathCache(layer);
	return true;
};

// Layer-agnostic core: bezier → hobby on a specific contour. Calls
// Python (HobbySpline.from_contour) to recover knots, replaces
// nodes with the knot list, re-solves to populate the bezier shadow.
// No undo, no draw — caller batches.
FontRig.applyConvertContourToHobby = function(contour, layer) {
	if (!contour || contour.kind === 'hobby') return false;
	if (!FontRig.pyBridge || !FontRig.pyBridge.ready) {
		console.warn('[hobby] convert to hobby: Python solver not ready');
		FontRig.ensureHobbySolverReady && FontRig.ensureHobbySolverReady(FontRig.state.glyphData);
		return false;
	}

	var nodesPayload = (contour.nodes || []).map(function(n) {
		return [n.x, n.y, n.type];
	});

	var pyo = FontRig.pyBridge.pyodide;
	var raw;
	try {
		pyo.globals.set('_bz_nodes', JSON.stringify(nodesPayload));
		pyo.globals.set('_bz_closed', !!contour.closed);
		raw = pyo.runPython(
			'hobby_knots_from_bezier_json(_bz_nodes, _bz_closed) ' +
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

	contour.kind = 'hobby';
	contour.knots = knots.map(function(k) {
		var bo = k.fixed_bcp_out, bi = k.fixed_bcp_in;
		return {
			x: k.x, y: k.y,
			segment_type: k.segment_type || 'hobby',
			alpha: (k.alpha != null) ? k.alpha : 1.0,
			beta:  (k.beta  != null) ? k.beta  : 1.0,
			dir_in: null, dir_out: null,
			fixed_bcp_out_x: (bo && bo.length === 2) ? bo[0] : null,
			fixed_bcp_out_y: (bo && bo.length === 2) ? bo[1] : null,
			fixed_bcp_in_x:  (bi && bi.length === 2) ? bi[0] : null,
			fixed_bcp_in_y:  (bi && bi.length === 2) ? bi[1] : null,
		};
	});
	contour.nodes = [];
	FontRig.solveHobbyContour(contour);

	if (layer && FontRig.invalidatePathCache) FontRig.invalidatePathCache(layer);
	return true;
};

// Active-layer wrappers (single-layer fallback). MM-aware callers
// go through sync_convertContour* in multi-layer-sync.js.
FontRig.convertContourToBezier = function(ci) {
	var ref = FontRig._findContourByIndex(ci);
	if (!ref) return false;
	if (FontRig.pushUndo) FontRig.pushUndo();
	var ok = FontRig.applyConvertContourToBezier(ref.contour, ref.layer);
	if (ok && FontRig.draw) FontRig.draw();
	return ok;
};

FontRig.convertContourToHobby = function(ci) {
	var ref = FontRig._findContourByIndex(ci);
	if (!ref) return false;
	if (FontRig.pushUndo) FontRig.pushUndo();
	var ok = FontRig.applyConvertContourToHobby(ref.contour, ref.layer);
	if (ok && FontRig.draw) FontRig.draw();
	return ok;
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

// Layer-agnostic core. Mutates the segment_type on a specific knot
// in a specific contour, re-solves, dirties the given layer's path
// cache. No undo, no draw — caller batches.
FontRig._applyKnotSegmentTypeInContour = function(contour, ki, segmentType, layer) {
	if (!contour || contour.kind !== 'hobby') return false;
	if (!contour.knots || !contour.knots[ki]) return false;
	if (segmentType !== 'hobby' && segmentType !== 'line' && segmentType !== 'fixed') return false;

	var knots = contour.knots;
	var n = knots.length;
	var oldType = knots[ki].segment_type || 'hobby';
	var newType = segmentType;
	if (oldType === newType) return false;

	// segment_type describes the OUT segment of knot ki. Open contours
	// have no outgoing segment from the last knot — toggles are no-ops.
	if (!contour.closed && ki >= n - 1) return false;

	var nextKi = (ki + 1) % n;
	var clearBcp = function(knot, fieldRoot) {
		knot[fieldRoot + '_x'] = null;
		knot[fieldRoot + '_y'] = null;
	};
	var setBcp = function(knot, fieldRoot, x, y) {
		knot[fieldRoot + '_x'] = Math.round(x * 10) / 10;
		knot[fieldRoot + '_y'] = Math.round(y * 10) / 10;
	};

	if (newType === 'fixed' && oldType !== 'fixed') {
		// Snapshot or initialize the BCPs so the segment is editable.
		if (oldType === 'hobby') {
			// Pull off-curve positions from the solver's bezier shadow.
			var niOn = FontRig._knotIndexToNodeIndex(contour, ki);
			var nodes = contour.nodes;
			if (niOn >= 0 && nodes && nodes.length > niOn + 2) {
				var off1 = nodes[niOn + 1];
				var off2 = nodes[niOn + 2];
				if (off1 && off2) {
					setBcp(knots[ki],     'fixed_bcp_out', off1.x, off1.y);
					setBcp(knots[nextKi], 'fixed_bcp_in',  off2.x, off2.y);
				}
			}
		} else if (oldType === 'line') {
			// No off-curves to snapshot — start at chord-thirds so the
			// segment looks straight until the user drags a BCP.
			var a = knots[ki], b = knots[nextKi];
			setBcp(a, 'fixed_bcp_out', a.x + (b.x - a.x) / 3, a.y + (b.y - a.y) / 3);
			setBcp(b, 'fixed_bcp_in',  a.x + 2 * (b.x - a.x) / 3, a.y + 2 * (b.y - a.y) / 3);
		}
	}

	if (oldType === 'fixed' && newType !== 'fixed') {
		// Drop the BCPs the segment owned — solver picks again.
		clearBcp(knots[ki],     'fixed_bcp_out');
		clearBcp(knots[nextKi], 'fixed_bcp_in');
	}

	knots[ki].segment_type = newType;
	FontRig.solveHobbyContour(contour);
	if (layer && FontRig.invalidatePathCache) FontRig.invalidatePathCache(layer);
	return true;
};

// Active-layer wrapper. Used as a fallback / single-layer caller.
// MM-aware callers should go through sync_setKnotSegmentType in
// multi-layer-sync.js instead.
FontRig.setKnotSegmentType = function(nodeId, segmentType) {
	var info = FontRig._resolveKnotByNodeId(nodeId);
	if (!info) return false;
	if (FontRig.pushUndo) FontRig.pushUndo();
	var ok = FontRig._applyKnotSegmentTypeInContour(info.contour, info.ki, segmentType, info.layer);
	if (ok && FontRig.draw) FontRig.draw();
	return ok;
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

// Adjust per-knot tension by an additive delta (drawing-tool style:
// the [ ] { } keys use steps of 0.05 / 0.25). Affects the knot at
// the given node id; for batches use _withSelectedKnots + this fn
// or adjustSelectedKnotsTensionDelta below.
FontRig.adjustKnotTensionDelta = function(nodeId, delta, opts) {
	var info = FontRig._resolveKnotByNodeId(nodeId);
	if (!info) return false;
	opts = opts || {};
	var k = info.knot;
	var clamp = function(v) {
		return Math.max(FontRig.HOBBY_TENSION_MIN,
		                Math.min(FontRig.HOBBY_TENSION_MAX, v));
	};
	if (!opts.betaOnly)  k.alpha = +clamp((k.alpha || 1.0) + delta).toFixed(3);
	if (!opts.alphaOnly) k.beta  = +clamp((k.beta  || 1.0) + delta).toFixed(3);

	FontRig.solveHobbyContour(info.contour);
	if (info.layer && FontRig.invalidatePathCache) FontRig.invalidatePathCache(info.layer);
	if (FontRig.draw) FontRig.draw();
	return true;
};

// Apply an additive tension delta to every selected hobby knot in
// one batch (single undo, single re-solve per touched contour).
FontRig.adjustSelectedKnotsTensionDelta = function(delta, opts) {
	opts = opts || {};
	var clamp = function(v) {
		return Math.max(FontRig.HOBBY_TENSION_MIN,
		                Math.min(FontRig.HOBBY_TENSION_MAX, v));
	};
	return FontRig._withSelectedKnots(function(info) {
		var k = info.knot;
		if (!opts.betaOnly)  k.alpha = +clamp((k.alpha || 1.0) + delta).toFixed(3);
		if (!opts.alphaOnly) k.beta  = +clamp((k.beta  || 1.0) + delta).toFixed(3);
	});
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


// Wire tension keys: [ / ] for fine adjust, { / } for coarse (×5).
// Mirrors the drawing-tool's hobby-tension keys so the muscle memory
// carries over from "drawing a hobby curve" to "editing one".
//
// Step 0.05 matches FontRig.drawTool._adjustTension.
//
// Skipped when:
//   - The drawing tool is in an active session (it owns these keys).
//   - Focus is on an input/textarea/contenteditable.
//   - The selection contains no hobby knots.
//
// Selection-wide: every selected hobby knot is adjusted in one batch.
(function() {
	var TENSION_STEP = 0.05;
	window.addEventListener('keydown', function(e) {
		if (e.ctrlKey || e.altKey || e.metaKey) return;
		var k = e.key;
		if (k !== '[' && k !== ']' && k !== '{' && k !== '}') return;

		// Don't fight the drawing tool — it consumes these during a session.
		if (FontRig.drawTool && FontRig.drawTool.session && FontRig.drawTool.session.active) return;

		// Don't fight text fields.
		var t = e.target;
		var tag = t && t.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;

		// Need at least one selected hobby knot.
		if (!FontRig.state || !FontRig.state.selectedNodeIds || FontRig.state.selectedNodeIds.size === 0) return;

		var hasHobby = false;
		FontRig.state.selectedNodeIds.forEach(function(id) {
			if (!hasHobby && FontRig._resolveKnotByNodeId && FontRig._resolveKnotByNodeId(id)) hasHobby = true;
		});
		if (!hasHobby) return;

		var delta;
		if      (k === '[') delta = -TENSION_STEP;
		else if (k === ']') delta = +TENSION_STEP;
		else if (k === '{') delta = -TENSION_STEP * 5;
		else                delta = +TENSION_STEP * 5;

		e.preventDefault();
		if (FontRig.pushUndo) FontRig.pushUndo();
		FontRig.adjustSelectedKnotsTensionDelta(delta);
	});
})();


// ===================================================================
// Per-knot direction pinning
// ===================================================================
// dir_in / dir_out are floats in radians, or null = solver picks.
// Convention (matches TypeRig HobbyKnot.pin_dir_*):
//   dir_out — angle the curve DEPARTS at, measured from this knot
//             toward the outgoing handle / next knot.
//   dir_in  — angle the curve ARRIVES at, same chord-from-prev convention.
//             The "arrival vector" points FROM prev TO this knot.

// Find a knot's bezier-shadow node index. Returns -1 if not found
// (e.g. _knotMap stale).
FontRig._knotIndexToNodeIndex = function(contour, ki) {
	if (!contour || !contour._knotMap) return -1;
	var map = contour._knotMap;
	for (var i = 0; i < map.length; i++) if (map[i] === ki) return i;
	return -1;
};

// Solved (or pinned) departure angle at knot ki. Looks at the
// bezier shadow's next node — for hobby segments that's the first
// off-curve (tangent control); for line segments it's the next
// on-curve (chord direction).
FontRig.getKnotOutDirection = function(contour, ki) {
	var k = contour && contour.knots && contour.knots[ki];
	if (!k) return 0;
	if (k.dir_out != null) return k.dir_out;

	var ni = FontRig._knotIndexToNodeIndex(contour, ki);
	if (ni < 0 || !contour.nodes || contour.nodes.length < 2) return 0;
	var n = contour.nodes.length;
	// Open path's last knot: no outgoing segment — use back-tangent.
	if (!contour.closed && ni === n - 1) {
		var prev = contour.nodes[n - 2];
		return Math.atan2(k.y - prev.y, k.x - prev.x);
	}
	var next = contour.nodes[(ni + 1) % n];
	return Math.atan2(next.y - k.y, next.x - k.x);
};

// Solved (or pinned) arrival angle at knot ki. By convention this
// is the angle FROM the previous chord position TO this knot —
// so visually the "in handle" points BACKWARDS by π relative to it.
FontRig.getKnotInDirection = function(contour, ki) {
	var k = contour && contour.knots && contour.knots[ki];
	if (!k) return 0;
	if (k.dir_in != null) return k.dir_in;

	var ni = FontRig._knotIndexToNodeIndex(contour, ki);
	if (ni < 0 || !contour.nodes || contour.nodes.length < 2) return 0;
	var n = contour.nodes.length;
	// Open path's first knot: no incoming segment — use forward-tangent.
	if (!contour.closed && ni === 0) {
		var nxt = contour.nodes[1];
		return Math.atan2(nxt.y - k.y, nxt.x - k.x);
	}
	var prev = contour.nodes[(ni - 1 + n) % n];
	return Math.atan2(k.y - prev.y, k.x - prev.x);
};

// True when either side is pinned.
FontRig.knotHasPinnedDirection = function(knot) {
	return !!knot && (knot.dir_in != null || knot.dir_out != null);
};

// Pin one side of a knot's direction. side ∈ {'out', 'in'}.
// opts.smooth: also mirror the other side so the tangent stays
// collinear (dir_in = dir_out + π). Default false (split / cusp).
FontRig.setKnotDirection = function(nodeId, side, angle, opts) {
	var info = FontRig._resolveKnotByNodeId(nodeId);
	if (!info) return false;
	if (side !== 'out' && side !== 'in') return false;
	opts = opts || {};

	var k = info.knot;
	if (side === 'out') {
		k.dir_out = angle;
		if (opts.smooth) k.dir_in = angle + Math.PI;
	} else {
		k.dir_in = angle;
		if (opts.smooth) k.dir_out = angle - Math.PI;
	}

	FontRig.solveHobbyContour(info.contour);
	if (info.layer && FontRig.invalidatePathCache) FontRig.invalidatePathCache(info.layer);
	if (FontRig.draw) FontRig.draw();
	return true;
};

// Snapshot the currently-solved tangents into dir_in/dir_out, so the
// knot becomes pinned at exactly its current shape. Useful for the
// "Pin Direction" context-menu action.
FontRig.pinKnotDirectionAtSolved = function(nodeId) {
	var info = FontRig._resolveKnotByNodeId(nodeId);
	if (!info) return false;
	if (FontRig.pushUndo) FontRig.pushUndo();
	info.knot.dir_out = FontRig.getKnotOutDirection(info.contour, info.ki);
	info.knot.dir_in  = FontRig.getKnotInDirection(info.contour,  info.ki);

	FontRig.solveHobbyContour(info.contour);
	if (info.layer && FontRig.invalidatePathCache) FontRig.invalidatePathCache(info.layer);
	if (FontRig.draw) FontRig.draw();
	return true;
};

// Release: drop both pins, the solver decides again.
FontRig.releaseKnotDirection = function(nodeId) {
	var info = FontRig._resolveKnotByNodeId(nodeId);
	if (!info) return false;
	if (info.knot.dir_in == null && info.knot.dir_out == null) return false;

	if (FontRig.pushUndo) FontRig.pushUndo();
	info.knot.dir_in = null;
	info.knot.dir_out = null;

	FontRig.solveHobbyContour(info.contour);
	if (info.layer && FontRig.invalidatePathCache) FontRig.invalidatePathCache(info.layer);
	if (FontRig.draw) FontRig.draw();
	return true;
};

// Direction-handle screen radius (constant — handle stays a fixed
// pixel size regardless of zoom). Mirrors the bezier handle look.
FontRig.HOBBY_DIR_HANDLE_RADIUS = 28;

// Compute the screen-space endpoint of a knot's direction handle.
// side ∈ {'out', 'in'}. The 'in' handle visually points BACKWARDS
// (toward where the curve came from), so we render at angle dir_in+π.
// Returns { x, y } in screen coords.
FontRig.computeKnotDirHandlePos = function(contour, ki, side) {
	var knot = contour.knots[ki];
	var sp = FontRig.glyphToScreen(knot.x, knot.y);
	var angle = (side === 'out')
		? FontRig.getKnotOutDirection(contour, ki)
		: FontRig.getKnotInDirection(contour, ki) + Math.PI;
	var R = FontRig.HOBBY_DIR_HANDLE_RADIUS;
	return {
		x: sp.x + R * Math.cos(-angle),  // canvas y is flipped
		y: sp.y + R * Math.sin(-angle),
	};
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
