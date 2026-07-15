// ===================================================================
// FontRig — Layer Panel (Multi-Instance)
// ===================================================================
// Layer management panel inspired by TypeRig GUI Layer panel.
// Pure JS implementation using FRWidget factories.
//
// Features:
//   - Layer table with type badges and compatibility indicators
//   - 3-tier compatibility: full / semi / incompatible
//   - Layer operations: add, remove, rename, duplicate, reorder
//   - Content options: outline, anchors, LSB, advance, RSB
//   - Content operations: swap, pull, push, clean
//   - Contour operations: pull/push node positions
//   - Visibility and type controls
//   - Lerp layers: live interpolation between masters with
//     reverse propagation for editing the interpolated result
// ===================================================================
'use strict';

FontRig.LayerPanel = {};
FontRig._internalDrag = false;

// =====================================================================
// COMPATIBILITY ENGINE — 3-tier layer compatibility checking
// =====================================================================
// Extends the existing FontRig._layerFingerprint with granular analysis.
//
// Tier 1 — Compatible:     identical node type sequences per contour
// Tier 2 — Semi-compatible: same on-curve count & start points,
//                           but off-curve counts differ per contour
// Tier 3 — Incompatible:   contour count or on-curve count mismatch
// ---------------------------------------------------------------------

FontRig.LayerPanel._contourFingerprint = function(contour) {
	if (!contour || !contour.nodes) return { full: '', oncurve: '', startType: '' };

	var fullTypes = [];
	var oncurveTypes = [];

	for (var i = 0; i < contour.nodes.length; i++) {
		var t = contour.nodes[i].type;
		fullTypes.push(t);
		if (t === 'on') oncurveTypes.push(t);
	}

	return {
		full: fullTypes.join(','),
		oncurve: oncurveTypes.join(','),
		startType: contour.nodes.length > 0 ? contour.nodes[0].type : ''
	};
};

FontRig.LayerPanel._layerDetailedFingerprint = function(layer) {
	if (!layer || !layer.shapes) return null;

	var contours = [];
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			contours.push(FontRig.LayerPanel._contourFingerprint(shape.contours[ki]));
		}
	}
	return contours;
};

// Compare two layers and return compatibility tier.
// Returns: 'compatible' | 'semi' | 'incompatible'
// Also returns per-contour detail for UI indicators.
FontRig.LayerPanel.checkCompatibility = function(refLayer, testLayer) {
	var refFp = FontRig.LayerPanel._layerDetailedFingerprint(refLayer);
	var testFp = FontRig.LayerPanel._layerDetailedFingerprint(testLayer);

	if (!refFp || !testFp) return { tier: 'incompatible', contours: [] };

	// Different contour count → incompatible
	if (refFp.length !== testFp.length) {
		return { tier: 'incompatible', contours: [] };
	}

	var allFull = true;
	var allSemi = true;
	var contourResults = [];

	for (var i = 0; i < refFp.length; i++) {
		var ref = refFp[i];
		var test = testFp[i];

		if (ref.full === test.full) {
			contourResults.push('compatible');
		} else if (ref.oncurve === test.oncurve && ref.startType === test.startType) {
			contourResults.push('semi');
			allFull = false;
		} else {
			contourResults.push('incompatible');
			allFull = false;
			allSemi = false;
		}
	}

	var tier = allFull ? 'compatible' : (allSemi ? 'semi' : 'incompatible');
	return { tier: tier, contours: contourResults };
};

// =====================================================================
// LERP ENGINE — live interpolation layers with reverse propagation
// =====================================================================
// A lerp axis is stored per panel instance in inst._lerpAxes[].
// Each axis: { name, masters: [name1, name2, ...], tx: 500, ty: 500 }
// The actual lerp. layer lives in glyphData.layers like any other.
// Forward: masters → lerp layer (recompute on any master edit)
// Reverse: lerp layer edit → distribute delta back to masters
// ---------------------------------------------------------------------

FontRig.LayerPanel.Lerp = {};

// -- Create a lerp axis from selected layers
FontRig.LayerPanel.Lerp.createAxis = function(inst) {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData) return;

	var names = FontRig.LayerPanel._getSelectedLayerNames(inst);
	if (names.length < 2) {
		console.warn('[Lerp] Need at least 2 layers selected to create axis');
		return;
	}

	// Check pairwise compatibility — require at least semi-compatible
	var refLayer = FontRig.getLayerByName(glyphData, names[0]);
	for (var i = 1; i < names.length; i++) {
		var testLayer = FontRig.getLayerByName(glyphData, names[i]);
		var compat = FontRig.LayerPanel.checkCompatibility(refLayer, testLayer);
		if (compat.tier === 'incompatible') {
			console.warn('[Lerp] Layers are incompatible:', names[0], '↔', names[i]);
			return;
		}
	}

	// Generate lerp layer name
	var lerpName = 'lerp.' + names.join('+');

	// Check if already exists
	if (FontRig.getLayerByName(glyphData, lerpName)) {
		console.warn('[Lerp] Axis already exists:', lerpName);
		return;
	}

	if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();

	// Create the lerp layer (deep clone of first master as starting point)
	var srcLayer = FontRig.getLayerByName(glyphData, names[0]);
	var lerpLayer = JSON.parse(JSON.stringify(srcLayer));
	lerpLayer.name = lerpName;
	lerpLayer.identifier = '';
	glyphData.layers.push(lerpLayer);

	// Store axis definition on the instance
	var axis = {
		name: lerpName,
		masters: names.slice(),
		tx: 500,   // blend X (0–1000 → 0.0–1.0)
		ty: 500    // blend Y (0–1000 → 0.0–1.0)
	};

	inst._lerpAxes.push(axis);

	// Compute initial interpolation
	FontRig.LayerPanel.Lerp._forward(inst, axis);

	FontRig.LayerPanel._afterChange(inst, 'Create lerp axis: ' + lerpName);
};

// -- Remove a lerp axis
FontRig.LayerPanel.Lerp.removeAxis = function(inst, axisName) {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData) return;

	// Find and remove axis definition
	for (var i = inst._lerpAxes.length - 1; i >= 0; i--) {
		if (inst._lerpAxes[i].name === axisName) {
			inst._lerpAxes.splice(i, 1);
			break;
		}
	}

	if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();

	// Remove the lerp layer from glyph data
	for (var j = glyphData.layers.length - 1; j >= 0; j--) {
		if (glyphData.layers[j].name === axisName) {
			glyphData.layers.splice(j, 1);
			break;
		}
	}

	// If active layer was the removed lerp, switch to first layer
	if (FontRig.state.activeLayer === axisName && glyphData.layers.length > 0) {
		FontRig.LayerPanel._setActiveLayer(inst, glyphData.layers[0].name);
	}

	FontRig.LayerPanel._afterChange(inst, 'Remove lerp axis: ' + axisName);
};

// -- Forward interpolation: recompute lerp layer from masters
FontRig.LayerPanel.Lerp._forward = function(inst, axis) {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData) return;

	var lerpLayer = FontRig.getLayerByName(glyphData, axis.name);
	if (!lerpLayer) return;

	var masterLayers = [];
	for (var i = 0; i < axis.masters.length; i++) {
		var ml = FontRig.getLayerByName(glyphData, axis.masters[i]);
		if (!ml) return;
		masterLayers.push(ml);
	}

	if (masterLayers.length < 2) return;

	var tx = axis.tx / 1000;  // 0.0 – 1.0
	var ty = axis.ty / 1000;

	if (masterLayers.length === 2) {
		// Simple two-master lerp
		FontRig.LayerPanel.Lerp._lerpTwo(masterLayers[0], masterLayers[1], lerpLayer, tx, ty);
	} else {
		// N-master: subdivide evenly along t
		// e.g. 3 masters at t=0, 0.5, 1.0
		FontRig.LayerPanel.Lerp._lerpN(masterLayers, lerpLayer, tx, ty);
	}

	// Invalidate path cache so the outline redraws
	FontRig.invalidatePathCache(lerpLayer);
};

// -- Two-master interpolation
FontRig.LayerPanel.Lerp._lerpTwo = function(layerA, layerB, dst, tx, ty) {
	var nodesA = FontRig.LayerPanel.Lerp._flatNodes(layerA);
	var nodesB = FontRig.LayerPanel.Lerp._flatNodes(layerB);
	var nodesDst = FontRig.LayerPanel.Lerp._flatNodes(dst);

	var count = Math.min(nodesA.length, nodesB.length, nodesDst.length);
	for (var i = 0; i < count; i++) {
		nodesDst[i].ref.x = nodesA[i].x * (1 - tx) + nodesB[i].x * tx;
		nodesDst[i].ref.y = nodesA[i].y * (1 - ty) + nodesB[i].y * ty;
	}

	// Interpolate width
	dst.width = layerA.width * (1 - tx) + layerB.width * tx;
};

// -- N-master interpolation (piecewise linear)
FontRig.LayerPanel.Lerp._lerpN = function(masters, dst, tx, ty) {
	var n = masters.length;
	// Compute which segment we're in
	var segCount = n - 1;
	var segT = tx * segCount;
	var segIdx = Math.min(Math.floor(segT), segCount - 1);
	var localT = segT - segIdx;

	var segTy = ty * segCount;
	var segIdxY = Math.min(Math.floor(segTy), segCount - 1);
	var localTy = segTy - segIdxY;

	var layerA = masters[segIdx];
	var layerB = masters[segIdx + 1];
	var layerAy = masters[segIdxY];
	var layerBy = masters[segIdxY + 1];

	var nodesA = FontRig.LayerPanel.Lerp._flatNodes(layerA);
	var nodesB = FontRig.LayerPanel.Lerp._flatNodes(layerB);
	var nodesAy = FontRig.LayerPanel.Lerp._flatNodes(layerAy);
	var nodesBy = FontRig.LayerPanel.Lerp._flatNodes(layerBy);
	var nodesDst = FontRig.LayerPanel.Lerp._flatNodes(dst);

	var count = Math.min(nodesA.length, nodesB.length, nodesDst.length);
	for (var i = 0; i < count; i++) {
		nodesDst[i].ref.x = nodesA[i].x * (1 - localT) + nodesB[i].x * localT;
		nodesDst[i].ref.y = nodesAy[i].y * (1 - localTy) + nodesBy[i].y * localTy;
	}

	// Width: use X axis blend
	dst.width = layerA.width * (1 - localT) + layerB.width * localT;
};

// -- Reverse propagation: distribute delta from lerp edit back to masters
// Policy: proportional — nearer master absorbs more of the change.
// For 2 masters at blend t: A += Δ·(1−t), B += Δ·t
FontRig.LayerPanel.Lerp._reverse = function(inst, axis, prevSnapshot) {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData) return;

	var lerpLayer = FontRig.getLayerByName(glyphData, axis.name);
	if (!lerpLayer) return;

	var masterLayers = [];
	for (var i = 0; i < axis.masters.length; i++) {
		var ml = FontRig.getLayerByName(glyphData, axis.masters[i]);
		if (!ml) return;
		masterLayers.push(ml);
	}

	var tx = axis.tx / 1000;
	var ty = axis.ty / 1000;
	var currentNodes = FontRig.LayerPanel.Lerp._flatNodes(lerpLayer);
	var prevNodes = prevSnapshot; // array of {x, y}

	if (!prevNodes || currentNodes.length !== prevNodes.length) return;

	if (masterLayers.length === 2) {
		var nodesA = FontRig.LayerPanel.Lerp._flatNodes(masterLayers[0]);
		var nodesB = FontRig.LayerPanel.Lerp._flatNodes(masterLayers[1]);
		var count = Math.min(nodesA.length, nodesB.length, currentNodes.length);

		for (var i = 0; i < count; i++) {
			var dx = currentNodes[i].ref.x - prevNodes[i].x;
			var dy = currentNodes[i].ref.y - prevNodes[i].y;
			if (dx === 0 && dy === 0) continue;

			// Proportional distribution
			nodesA[i].ref.x += dx * (1 - tx);
			nodesA[i].ref.y += dy * (1 - ty);
			nodesB[i].ref.x += dx * tx;
			nodesB[i].ref.y += dy * ty;
		}

		// Width delta
		var dw = lerpLayer.width - (masterLayers[0].width * (1 - tx) + masterLayers[1].width * tx);
		if (dw !== 0) {
			masterLayers[0].width += dw * (1 - tx);
			masterLayers[1].width += dw * tx;
		}
	} else {
		// N-master: compute weights per master
		var n = masterLayers.length;
		var segCount = n - 1;

		// X-axis segment
		var segT = tx * segCount;
		var segIdx = Math.min(Math.floor(segT), segCount - 1);
		var localT = segT - segIdx;

		// Y-axis segment
		var segTy = ty * segCount;
		var segIdxY = Math.min(Math.floor(segTy), segCount - 1);
		var localTy = segTy - segIdxY;

		var masterNodesArr = [];
		for (var m = 0; m < n; m++) {
			masterNodesArr.push(FontRig.LayerPanel.Lerp._flatNodes(masterLayers[m]));
		}

		var count = currentNodes.length;
		for (var i = 0; i < count; i++) {
			var dx = currentNodes[i].ref.x - prevNodes[i].x;
			var dy = currentNodes[i].ref.y - prevNodes[i].y;
			if (dx === 0 && dy === 0) continue;

			// X: distribute to the two masters in the active segment
			if (masterNodesArr[segIdx] && masterNodesArr[segIdx + 1]) {
				masterNodesArr[segIdx][i].ref.x += dx * (1 - localT);
				masterNodesArr[segIdx + 1][i].ref.x += dx * localT;
			}

			// Y: distribute to the two masters in the active Y segment
			if (masterNodesArr[segIdxY] && masterNodesArr[segIdxY + 1]) {
				masterNodesArr[segIdxY][i].ref.y += dy * (1 - localTy);
				masterNodesArr[segIdxY + 1][i].ref.y += dy * localTy;
			}
		}
	}

	// Invalidate path caches for all affected master layers
	for (var m = 0; m < masterLayers.length; m++) {
		FontRig.invalidatePathCache(masterLayers[m]);
	}
};

// -- Snapshot lerp layer node positions (for computing deltas in reverse)
FontRig.LayerPanel.Lerp._snapshot = function(lerpLayer) {
	var nodes = FontRig.LayerPanel.Lerp._flatNodes(lerpLayer);
	var snap = [];
	for (var i = 0; i < nodes.length; i++) {
		snap.push({ x: nodes[i].ref.x, y: nodes[i].ref.y });
	}
	return snap;
};

// -- Flatten all nodes in a layer to an array of { x, y, ref }
// ref points to the actual node object for direct mutation
FontRig.LayerPanel.Lerp._flatNodes = function(layer) {
	var result = [];
	if (!layer || !layer.shapes) return result;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ci = 0; ci < shape.contours.length; ci++) {
			var contour = shape.contours[ci];
			for (var ni = 0; ni < contour.nodes.length; ni++) {
				var node = contour.nodes[ni];
				result.push({ x: node.x, y: node.y, ref: node });
			}
		}
	}
	return result;
};

// -- Run forward interpolation for ALL axes in this instance
FontRig.LayerPanel.Lerp.updateAll = function(inst) {
	if (!inst._lerpAxes || !inst._lerpAxes.length) return;
	for (var i = 0; i < inst._lerpAxes.length; i++) {
		FontRig.LayerPanel.Lerp._forward(inst, inst._lerpAxes[i]);
	}
};

// -- Find axis by lerp layer name
FontRig.LayerPanel.Lerp.findAxis = function(inst, lerpLayerName) {
	if (!inst._lerpAxes) return null;
	for (var i = 0; i < inst._lerpAxes.length; i++) {
		if (inst._lerpAxes[i].name === lerpLayerName) return inst._lerpAxes[i];
	}
	return null;
};

// -- Check if a layer name is a master in any lerp axis
FontRig.LayerPanel.Lerp.isMasterInAnyAxis = function(inst, layerName) {
	if (!inst._lerpAxes) return false;
	for (var i = 0; i < inst._lerpAxes.length; i++) {
		if (inst._lerpAxes[i].masters.indexOf(layerName) !== -1) return true;
	}
	return false;
};

// -- Check if a layer name is a lerp layer
FontRig.LayerPanel.Lerp.isLerpLayer = function(name) {
	return name.indexOf('lerp.') === 0;
};

// =====================================================================
// LERP UI — build lerp group rows in the table
// =====================================================================

FontRig.LayerPanel.Lerp._buildGroupUI = function(inst, axis, body) {
	var glyphData = FontRig.state.glyphData;
	var activeLayerName = FontRig.state.activeLayer;
	var isLerpActive = (activeLayerName === axis.name);

	// Determine compatibility of the lerp layer
	var lerpLayer = FontRig.getLayerByName(glyphData, axis.name);
	var activeLayer = FontRig.getActiveLayer();
	var compat = { tier: 'compatible', contours: [] };
	if (lerpLayer && activeLayer && axis.name !== activeLayerName) {
		compat = FontRig.LayerPanel.checkCompatibility(activeLayer, lerpLayer);
	}

	// -- Lerp header row
	var hdr = document.createElement('div');
	hdr.className = 'lp-table__row lp-lerp-header lp-row-compat--' + compat.tier;
	if (isLerpActive) hdr.classList.add('lp-row--active');
	hdr.dataset.layer = axis.name;
	hdr.dataset.lerp = 'true';

	// Indicator (triangle if active, dot otherwise)
	var indicator = document.createElement('span');
	if (isLerpActive) {
		indicator.className = 'lp-table__active-indicator lp-tri--' + compat.tier;
		indicator.title = 'Active lerp layer';
	} else {
		indicator.className = 'lp-table__compat lp-compat--' + compat.tier;
	}
	hdr.appendChild(indicator);

	// Icon: interpolate
	var ico = FRWidget.icon('interpolate');
	ico.className += ' lp-lerp-icon';
	hdr.appendChild(ico);

	// Name
	var nameEl = document.createElement('span');
	nameEl.className = 'lp-table__cell lp-table__cell--name';
	if (isLerpActive) nameEl.classList.add('lp-table__cell--active');
	nameEl.textContent = axis.name;
	hdr.appendChild(nameEl);

	// Remove axis button
	var removeBtn = document.createElement('span');
	removeBtn.className = 'lp-lerp-remove';
	removeBtn.title = 'Remove lerp axis';
	removeBtn.textContent = '×';
	removeBtn.addEventListener('click', function(e) {
		e.stopPropagation();
		FontRig.LayerPanel.Lerp.removeAxis(inst, axis.name);
	});
	hdr.appendChild(removeBtn);

	// Click to select
	hdr.addEventListener('click', function(e) {
		FontRig.LayerPanel._onRowClick(inst, hdr, e);
	});

	// Double-click to activate
	hdr.addEventListener('dblclick', function() {
		FontRig.LayerPanel._setActiveLayer(inst, axis.name);
	});

	body.appendChild(hdr);
	inst._rows.push({ el: hdr, name: axis.name, type: 'Lerp', compat: compat, layerIdx: -1, isLerpHeader: true });

	// -- Master child rows (indented)
	for (var mi = 0; mi < axis.masters.length; mi++) {
		var mName = axis.masters[mi];
		var childRow = document.createElement('div');
		childRow.className = 'lp-table__row lp-lerp-child';
		childRow.dataset.layer = mName;

		var treeGlyph = document.createElement('span');
		treeGlyph.className = 'lp-lerp-tree';
		treeGlyph.textContent = (mi < axis.masters.length - 1) ? '├' : '└';
		childRow.appendChild(treeGlyph);

		var childName = document.createElement('span');
		childName.className = 'lp-table__cell lp-table__cell--name lp-lerp-child-name';
		childName.textContent = mName;
		childRow.appendChild(childName);

		body.appendChild(childRow);
	}

	// -- Blend controls row
	var ctrlRow = document.createElement('div');
	ctrlRow.className = 'lp-lerp-controls';

	// X slider
	var xWrap = document.createElement('div');
	xWrap.className = 'lp-lerp-slider-row';

	var xLabel = document.createElement('span');
	xLabel.className = 'lp-lerp-slider-label';
	xLabel.textContent = 'X';
	xWrap.appendChild(xLabel);

	var xSlider = document.createElement('input');
	xSlider.type = 'range';
	xSlider.className = 'lp-lerp-slider';
	xSlider.min = 0;
	xSlider.max = 1000;
	xSlider.step = 1;
	xSlider.value = axis.tx;
	xWrap.appendChild(xSlider);

	var xSpin = document.createElement('input');
	xSpin.type = 'text';
	xSpin.className = 'lp-lerp-spin';
	xSpin.value = axis.tx;
	xWrap.appendChild(xSpin);

	ctrlRow.appendChild(xWrap);

	// Y slider
	var yWrap = document.createElement('div');
	yWrap.className = 'lp-lerp-slider-row';

	var yLabel = document.createElement('span');
	yLabel.className = 'lp-lerp-slider-label';
	yLabel.textContent = 'Y';
	yWrap.appendChild(yLabel);

	var ySlider = document.createElement('input');
	ySlider.type = 'range';
	ySlider.className = 'lp-lerp-slider';
	ySlider.min = 0;
	ySlider.max = 1000;
	ySlider.step = 1;
	ySlider.value = axis.ty;
	yWrap.appendChild(ySlider);

	var ySpin = document.createElement('input');
	ySpin.type = 'text';
	ySpin.className = 'lp-lerp-spin';
	ySpin.value = axis.ty;
	yWrap.appendChild(ySpin);

	ctrlRow.appendChild(yWrap);

	// Wire sliders ↔ spinboxes
	function onBlendChange() {
		axis.tx = parseInt(xSlider.value, 10);
		axis.ty = parseInt(ySlider.value, 10);
		xSpin.value = axis.tx;
		ySpin.value = axis.ty;
		FontRig.LayerPanel.Lerp._forward(inst, axis);
		FontRig.draw();
	}

	xSlider.addEventListener('input', onBlendChange);
	ySlider.addEventListener('input', onBlendChange);

	xSpin.addEventListener('change', function() {
		var v = Math.max(0, Math.min(1000, parseInt(xSpin.value, 10) || 0));
		xSlider.value = v;
		xSpin.value = v;
		axis.tx = v;
		FontRig.LayerPanel.Lerp._forward(inst, axis);
		FontRig.draw();
	});

	ySpin.addEventListener('change', function() {
		var v = Math.max(0, Math.min(1000, parseInt(ySpin.value, 10) || 0));
		ySlider.value = v;
		ySpin.value = v;
		axis.ty = v;
		FontRig.LayerPanel.Lerp._forward(inst, axis);
		FontRig.draw();
	});

	body.appendChild(ctrlRow);
};

// =====================================================================
// LAYER TABLE — selectable rows with type & compatibility badges
// =====================================================================

FontRig.LayerPanel._buildTable = function(inst) {
	var wrap = document.createElement('div');
	wrap.className = 'lp-table';

	var header = document.createElement('div');
	header.className = 'lp-table__header';

	var hName = document.createElement('span');
	hName.textContent = 'Layer';
	hName.className = 'lp-table__hcell lp-table__hcell--name';

	var hType = document.createElement('span');
	hType.textContent = 'Type';
	hType.className = 'lp-table__hcell lp-table__hcell--type';

	var hCompat = document.createElement('span');
	hCompat.className = 'lp-table__hcell lp-table__hcell--compat';
	hCompat.title = 'Compatibility with active layer';

	header.appendChild(hCompat);
	header.appendChild(hName);
	header.appendChild(hType);
	wrap.appendChild(header);

	var body = document.createElement('div');
	body.className = 'lp-table__body';
	wrap.appendChild(body);

	wrap._body = body;
	return wrap;
};

FontRig.LayerPanel._populateTable = function(inst) {
	var body = inst._table._body;
	body.innerHTML = '';
	inst._rows = [];

	var glyphData = FontRig.state.glyphData;
	if (!glyphData) return;

	var activeLayer = FontRig.getActiveLayer();
	var activeLayerName = activeLayer ? activeLayer.name : '';

	// -- Collect lerp layer names so we skip them in the regular list
	var lerpNames = {};
	if (inst._lerpAxes) {
		for (var li = 0; li < inst._lerpAxes.length; li++) {
			lerpNames[inst._lerpAxes[li].name] = true;
		}
	}

	// -- Render lerp axis groups at the top
	if (inst._lerpAxes) {
		for (var ai = 0; ai < inst._lerpAxes.length; ai++) {
			FontRig.LayerPanel.Lerp._buildGroupUI(inst, inst._lerpAxes[ai], body);
		}
	}

	// -- Render regular layers (skip lerp. layers)
	for (var i = 0; i < glyphData.layers.length; i++) {
		var layer = glyphData.layers[i];
		var lname = layer.name;

		// Skip hidden layers
		if (lname.indexOf('#') !== -1) continue;

		// Skip lerp layers — they are rendered above as groups
		if (lerpNames[lname]) continue;

		// Determine type
		var ltype = 'Master';
		if (lname.toLowerCase().indexOf('mask.') === 0) ltype = 'Mask';
		else if (lname.toLowerCase().indexOf('service.') === 0) ltype = 'Service';

		// Compatibility check against active layer
		// Active layer is always compatible with itself
		var compat = { tier: 'compatible', contours: [] };
		if (lname !== activeLayerName && activeLayer) {
			compat = FontRig.LayerPanel.checkCompatibility(activeLayer, layer);
		}

		var isActive = (lname === activeLayerName);
		var row = FontRig.LayerPanel._createRow(inst, lname, ltype, compat, i, isActive);
		body.appendChild(row);
		inst._rows.push({ el: row, name: lname, type: ltype, compat: compat, layerIdx: i });
	}

	// Restore selection
	FontRig.LayerPanel._syncSelection(inst);
};

FontRig.LayerPanel._createRow = function(inst, name, type, compat, layerIdx, isActive) {
	var row = document.createElement('div');
	row.className = 'lp-table__row lp-row-compat--' + compat.tier;
	if (isActive) row.classList.add('lp-row--active');
	row.dataset.layer = name;
	row.dataset.idx = layerIdx;
	row.draggable = true;

	// Active layer: colored triangle; other layers: colored dot
	var tierLabels = {
		'compatible': 'Compatible — all contours match',
		'semi': 'Semi-compatible — on-curve points match, off-curve differ',
		'incompatible': 'Incompatible — contour structure differs'
	};

	var indicator = document.createElement('span');
	if (isActive) {
		indicator.className = 'lp-table__active-indicator lp-tri--' + compat.tier;
		indicator.title = 'Active layer' + (tierLabels[compat.tier] ? ' — ' + tierLabels[compat.tier] : '');
	} else {
		indicator.className = 'lp-table__compat lp-compat--' + compat.tier;
		indicator.title = tierLabels[compat.tier] || '';
	}
	row.appendChild(indicator);

	// Name
	var nameEl = document.createElement('span');
	nameEl.className = 'lp-table__cell lp-table__cell--name';
	if (isActive) nameEl.classList.add('lp-table__cell--active');
	nameEl.textContent = name;
	row.appendChild(nameEl);

	// Type badge
	var badge = document.createElement('span');
	badge.className = 'lp-table__badge lp-badge--' + type.toLowerCase();
	badge.textContent = type.charAt(0);
	badge.title = type;
	row.appendChild(badge);

	// Click to select (multi-select with Ctrl/Cmd, range with Shift)
	row.addEventListener('click', function(e) {
		FontRig.LayerPanel._onRowClick(inst, row, e);
	});

	// Double-click to set as active layer
	row.addEventListener('dblclick', function() {
		FontRig.LayerPanel._setActiveLayer(inst, name);
	});

	// -- Drag and drop for reordering
	row.addEventListener('dragstart', function(e) {
		inst._dragIdx = parseInt(row.dataset.idx);
		row.classList.add('lp-dragging');
		FontRig._internalDrag = true;
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/plain', row.dataset.idx);
	});

	row.addEventListener('dragend', function() {
		row.classList.remove('lp-dragging');
		inst._dragIdx = null;
		FontRig._internalDrag = false;
		// Remove all drop indicators
		var allRows = inst._table._body.querySelectorAll('.lp-table__row');
		for (var r = 0; r < allRows.length; r++) {
			allRows[r].classList.remove('lp-drop-above', 'lp-drop-below');
		}
	});

	row.addEventListener('dragover', function(e) {
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = 'move';

		// Show drop indicator
		var allRows = inst._table._body.querySelectorAll('.lp-table__row');
		for (var r = 0; r < allRows.length; r++) {
			allRows[r].classList.remove('lp-drop-above', 'lp-drop-below');
		}

		var rect = row.getBoundingClientRect();
		var mid = rect.top + rect.height / 2;
		if (e.clientY < mid) {
			row.classList.add('lp-drop-above');
		} else {
			row.classList.add('lp-drop-below');
		}
	});

	row.addEventListener('dragleave', function() {
		row.classList.remove('lp-drop-above', 'lp-drop-below');
	});

	row.addEventListener('drop', function(e) {
		e.preventDefault();
		e.stopPropagation();
		row.classList.remove('lp-drop-above', 'lp-drop-below');

		var fromIdx = inst._dragIdx;
		var toIdx = parseInt(row.dataset.idx);
		if (fromIdx === null || fromIdx === toIdx) return;

		// Determine insert position based on mouse
		var rect = row.getBoundingClientRect();
		var mid = rect.top + rect.height / 2;
		var insertBefore = e.clientY < mid;

		FontRig.LayerPanel._reorderLayer(inst, fromIdx, toIdx, insertBefore);
	});

	return row;
};

FontRig.LayerPanel._onRowClick = function(inst, row, e) {
	var rows = inst._table._body.querySelectorAll('.lp-table__row');

	if (e.shiftKey && inst._lastClickedRow !== null) {
		// Range select
		var startIdx = -1, endIdx = -1, clickedIdx = -1;
		for (var i = 0; i < rows.length; i++) {
			if (rows[i] === inst._lastClickedRow) startIdx = i;
			if (rows[i] === row) clickedIdx = i;
		}
		if (startIdx >= 0 && clickedIdx >= 0) {
			var lo = Math.min(startIdx, clickedIdx);
			var hi = Math.max(startIdx, clickedIdx);
			if (!e.ctrlKey && !e.metaKey) {
				for (var j = 0; j < rows.length; j++) rows[j].classList.remove('selected');
			}
			for (var k = lo; k <= hi; k++) rows[k].classList.add('selected');
		}
	} else if (e.ctrlKey || e.metaKey) {
		// Toggle single
		row.classList.toggle('selected');
	} else {
		// Single select
		for (var i = 0; i < rows.length; i++) rows[i].classList.remove('selected');
		row.classList.add('selected');
	}

	inst._lastClickedRow = row;
};

FontRig.LayerPanel._getSelectedLayerNames = function(inst) {
	var selected = inst._table._body.querySelectorAll('.lp-table__row.selected');
	var names = [];
	for (var i = 0; i < selected.length; i++) {
		names.push(selected[i].dataset.layer);
	}
	return names;
};

FontRig.LayerPanel._syncSelection = function(inst) {
	// After rebuild, re-select previously selected rows
	var rows = inst._table._body.querySelectorAll('.lp-table__row');
	var sel = inst._selectedNames || [];
	var selSet = {};
	for (var i = 0; i < sel.length; i++) selSet[sel[i]] = true;

	for (var j = 0; j < rows.length; j++) {
		if (selSet[rows[j].dataset.layer]) {
			rows[j].classList.add('selected');
		}
	}
};

FontRig.LayerPanel._setActiveLayer = function(inst, name) {
	var state = FontRig.state;
	state.activeLayer = name;
	if (FontRig.dom.layerSelect) FontRig.dom.layerSelect.value = name;
	state.selectedNodeIds.clear();
	FontRig._notifyLayerChange(name);

	// Update active cell in multiview / expanded strip
	if (state.gridLayers && state.glyphData && !FontRig.isMaskLayer(name)) {
		var layers = state.glyphData.layers;
		var idx = -1;
		for (var i = 0; i < layers.length; i++) {
			if (layers[i].name === name) { idx = i; break; }
		}
		if (idx >= 0) {
			var r = state.activeCell.row;
			var c = state.activeCell.col;
			if (state.gridLayers[r] && state.gridLayers[r][c] !== undefined) {
				state.gridLayers[r][c] = idx;
			}
		}
	}

	FontRig.draw();
	FontRig.updateStatusSelected();
	if (typeof FontRig.buildXmlPanel === 'function') FontRig.buildXmlPanel();
	inst.update();
};

// =====================================================================
// LAYER ACTIONS — add, remove, rename, duplicate, reorder, visibility, type
// =====================================================================

FontRig.LayerPanel.Actions = {};

// -- Add new layer
FontRig.LayerPanel.Actions.addLayer = function(inst) {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData) return;

	FRWidget.InputDialog({
		title: 'Add Layer',
		message: 'Enter a name for the new layer.',
		label: 'Name:'
	}).then(function(name) {
		if (!name) return;

		// Check for duplicate name
		for (var i = 0; i < glyphData.layers.length; i++) {
			if (glyphData.layers[i].name === name) {
				console.warn('[LayerPanel] Layer name already exists:', name);
				return;
			}
		}

		var newLayer = {
			name: name,
			identifier: '',
			width: glyphData.layers[0] ? glyphData.layers[0].width : 600,
			height: glyphData.layers[0] ? glyphData.layers[0].height : 0,
			shapes: [],
			anchors: []
		};

		if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();
		glyphData.layers.push(newLayer);
		FontRig.LayerPanel._afterChange(inst, 'Add layer: ' + name);
	});
};

// -- Remove selected layers
FontRig.LayerPanel.Actions.removeLayers = function(inst) {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData) return;

	var names = FontRig.LayerPanel._getSelectedLayerNames(inst);
	if (!names.length) return;

	// Prevent removing all layers
	if (names.length >= glyphData.layers.length) {
		console.warn('[LayerPanel] Cannot remove all layers');
		return;
	}

	if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();

	for (var i = glyphData.layers.length - 1; i >= 0; i--) {
		if (names.indexOf(glyphData.layers[i].name) !== -1) {
			glyphData.layers.splice(i, 1);
		}
	}

	// If active layer was removed, switch to first available
	var activeExists = false;
	for (var j = 0; j < glyphData.layers.length; j++) {
		if (glyphData.layers[j].name === FontRig.state.activeLayer) {
			activeExists = true;
			break;
		}
	}
	if (!activeExists && glyphData.layers.length > 0) {
		FontRig.LayerPanel._setActiveLayer(inst, glyphData.layers[0].name);
	}

	FontRig.LayerPanel._afterChange(inst, 'Remove layers: ' + names.join(', '));
};

// -- Rename selected layer
FontRig.LayerPanel.Actions.renameLayer = function(inst) {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData) return;

	var names = FontRig.LayerPanel._getSelectedLayerNames(inst);
	if (names.length !== 1) return;

	var oldName = names[0];

	FRWidget.InputDialog({
		title: 'Rename Layer',
		message: 'Enter a new name for layer "' + oldName + '".',
		label: 'Name:',
		value: oldName
	}).then(function(newName) {
		if (!newName || newName === oldName) return;

		// Check for duplicate
		for (var i = 0; i < glyphData.layers.length; i++) {
			if (glyphData.layers[i].name === newName) {
				console.warn('[LayerPanel] Layer name already exists:', newName);
				return;
			}
		}

		if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();

		var layer = FontRig.getLayerByName(glyphData, oldName);
		if (layer) {
			layer.name = newName;
			if (FontRig.state.activeLayer === oldName) {
				FontRig.state.activeLayer = newName;
				if (FontRig.dom.layerSelect) FontRig.dom.layerSelect.value = newName;
				FontRig._notifyLayerChange(newName);
			}
		}

		FontRig.LayerPanel._afterChange(inst, 'Rename layer: ' + oldName + ' → ' + newName);
	});
};

// -- Duplicate selected layers
FontRig.LayerPanel.Actions.duplicateLayers = function(inst) {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData) return;

	var names = FontRig.LayerPanel._getSelectedLayerNames(inst);
	if (!names.length) return;

	FRWidget.DualInputDialog({
		title: 'Duplicate Layers',
		message: 'Enter prefix and/or suffix for duplicated layers.',
		labelTop: 'Prefix:',
		labelBottom: 'Suffix:',
		valueBottom: '.copy'
	}).then(function(values) {
		if (!values) return;

		var prefix = values[0] || '';
		var suffix = values[1] || '';
		if (!prefix && !suffix) suffix = '.copy';

		if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();

		for (var i = 0; i < names.length; i++) {
			var srcLayer = FontRig.getLayerByName(glyphData, names[i]);
			if (!srcLayer) continue;

			var newName = prefix + srcLayer.name + suffix;
			var dup = JSON.parse(JSON.stringify(srcLayer));
			dup.name = newName;
			dup.identifier = '';
			glyphData.layers.push(dup);
		}

		FontRig.LayerPanel._afterChange(inst, 'Duplicate layers: ' + names.join(', '));
	});
};

// -- Duplicate as mask
FontRig.LayerPanel.Actions.duplicateAsMask = function(inst) {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData) return;

	var names = FontRig.LayerPanel._getSelectedLayerNames(inst);
	if (!names.length) return;

	if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();

	for (var i = 0; i < names.length; i++) {
		var srcLayer = FontRig.getLayerByName(glyphData, names[i]);
		if (!srcLayer) continue;

		var maskName = 'mask.' + srcLayer.name;
		// Skip if mask already exists
		if (FontRig.getLayerByName(glyphData, maskName)) continue;

		var dup = JSON.parse(JSON.stringify(srcLayer));
		dup.name = maskName;
		dup.identifier = '';
		glyphData.layers.push(dup);
	}

	FontRig.LayerPanel._afterChange(inst, 'Duplicate as mask: ' + names.join(', '));
};

// -- Reorder layer via drag and drop
FontRig.LayerPanel._reorderLayer = function(inst, fromIdx, toIdx, insertBefore) {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData) return;
	if (fromIdx < 0 || fromIdx >= glyphData.layers.length) return;
	if (toIdx < 0 || toIdx >= glyphData.layers.length) return;

	if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();

	var layer = glyphData.layers.splice(fromIdx, 1)[0];

	// After splice, toIdx may have shifted
	var insertIdx = toIdx;
	if (fromIdx < toIdx) insertIdx--;
	if (!insertBefore) insertIdx++;

	insertIdx = Math.max(0, Math.min(insertIdx, glyphData.layers.length));
	glyphData.layers.splice(insertIdx, 0, layer);

	FontRig.LayerPanel._afterChange(inst, 'Reorder layer: ' + layer.name);
};

// -- Set visibility
FontRig.LayerPanel.Actions.setVisible = function(inst, visible) {
	// Visibility is a drawing concern — we track it in panel state
	var names = FontRig.LayerPanel._getSelectedLayerNames(inst);
	if (!names.length) return;

	for (var i = 0; i < names.length; i++) {
		if (visible) {
			inst._hiddenLayers.delete(names[i]);
		} else {
			inst._hiddenLayers.add(names[i]);
		}
	}

	FontRig.draw();
	inst.update();
};

// -- Toggle layer type (mask/service)
FontRig.LayerPanel.Actions.setType = function(inst, type) {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData) return;

	var names = FontRig.LayerPanel._getSelectedLayerNames(inst);
	if (!names.length) return;

	if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();

	for (var i = 0; i < names.length; i++) {
		var layer = FontRig.getLayerByName(glyphData, names[i]);
		if (!layer) continue;

		if (type === 'Mask') {
			if (layer.name.toLowerCase().indexOf('mask.') === 0) {
				// Remove mask prefix
				layer.name = layer.name.substring(5);
			} else {
				layer.name = 'mask.' + layer.name;
			}
		} else if (type === 'Service') {
			if (layer.name.toLowerCase().indexOf('service.') === 0) {
				layer.name = layer.name.substring(8);
			} else {
				layer.name = 'service.' + layer.name;
			}
		}

		// Update active layer name if needed
		if (FontRig.state.activeLayer === names[i]) {
			FontRig.state.activeLayer = layer.name;
			if (FontRig.dom.layerSelect) FontRig.dom.layerSelect.value = layer.name;
			FontRig._notifyLayerChange(layer.name);
		}
	}

	FontRig.LayerPanel._afterChange(inst, 'Set type ' + type + ': ' + names.join(', '));
};

// =====================================================================
// CONTENT OPERATIONS — swap, pull, push, clean
// =====================================================================

FontRig.LayerPanel.Content = {};

// Deep-clone shapes array
FontRig.LayerPanel.Content._cloneShapes = function(shapes) {
	return JSON.parse(JSON.stringify(shapes));
};

// Deep-clone anchors array
FontRig.LayerPanel.Content._cloneAnchors = function(anchors) {
	return JSON.parse(JSON.stringify(anchors || []));
};

// -- Pull: copy from first selected layer → active layer
FontRig.LayerPanel.Content.pull = function(inst) {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData) return;

	var activeLayer = FontRig.getActiveLayer();
	if (!activeLayer) return;

	var names = FontRig.LayerPanel._getSelectedLayerNames(inst);
	if (!names.length) return;

	// Use first selected that isn't the active
	var srcName = null;
	for (var i = 0; i < names.length; i++) {
		if (names[i] !== activeLayer.name) { srcName = names[i]; break; }
	}
	if (!srcName) return;

	var srcLayer = FontRig.getLayerByName(glyphData, srcName);
	if (!srcLayer) return;

	if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();

	if (inst._opt.outline) activeLayer.shapes = FontRig.LayerPanel.Content._cloneShapes(srcLayer.shapes);
	if (inst._opt.anchors) activeLayer.anchors = FontRig.LayerPanel.Content._cloneAnchors(srcLayer.anchors);
	if (inst._opt.lsb) FontRig.LayerPanel.Content._copyLSB(srcLayer, activeLayer);
	if (inst._opt.advance) activeLayer.width = srcLayer.width;
	if (inst._opt.rsb) FontRig.LayerPanel.Content._copyRSB(srcLayer, activeLayer);

	FontRig.LayerPanel._afterChange(inst, 'Pull: ' + srcName + ' → ' + activeLayer.name);
};

// -- Push: copy from active layer → all selected layers
FontRig.LayerPanel.Content.push = function(inst) {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData) return;

	var activeLayer = FontRig.getActiveLayer();
	if (!activeLayer) return;

	var names = FontRig.LayerPanel._getSelectedLayerNames(inst);
	if (!names.length) return;

	if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();

	for (var i = 0; i < names.length; i++) {
		if (names[i] === activeLayer.name) continue;
		var dstLayer = FontRig.getLayerByName(glyphData, names[i]);
		if (!dstLayer) continue;

		if (inst._opt.outline) dstLayer.shapes = FontRig.LayerPanel.Content._cloneShapes(activeLayer.shapes);
		if (inst._opt.anchors) dstLayer.anchors = FontRig.LayerPanel.Content._cloneAnchors(activeLayer.anchors);
		if (inst._opt.lsb) FontRig.LayerPanel.Content._copyLSB(activeLayer, dstLayer);
		if (inst._opt.advance) dstLayer.width = activeLayer.width;
		if (inst._opt.rsb) FontRig.LayerPanel.Content._copyRSB(activeLayer, dstLayer);
	}

	FontRig.LayerPanel._afterChange(inst, 'Push: ' + activeLayer.name + ' → ' + names.join(', '));
};

// -- Swap: exchange content between active and first selected layer
FontRig.LayerPanel.Content.swap = function(inst) {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData) return;

	var activeLayer = FontRig.getActiveLayer();
	if (!activeLayer) return;

	var names = FontRig.LayerPanel._getSelectedLayerNames(inst);
	var targetName = null;
	for (var i = 0; i < names.length; i++) {
		if (names[i] !== activeLayer.name) { targetName = names[i]; break; }
	}
	if (!targetName) return;

	var targetLayer = FontRig.getLayerByName(glyphData, targetName);
	if (!targetLayer) return;

	if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();

	if (inst._opt.outline) {
		var tmpShapes = activeLayer.shapes;
		activeLayer.shapes = targetLayer.shapes;
		targetLayer.shapes = tmpShapes;
	}

	if (inst._opt.anchors) {
		var tmpAnchors = activeLayer.anchors;
		activeLayer.anchors = targetLayer.anchors;
		targetLayer.anchors = tmpAnchors;
	}

	if (inst._opt.advance) {
		var tmpW = activeLayer.width;
		activeLayer.width = targetLayer.width;
		targetLayer.width = tmpW;
	}

	if (inst._opt.lsb) {
		FontRig.LayerPanel.Content._swapLSB(activeLayer, targetLayer);
	}

	if (inst._opt.rsb) {
		FontRig.LayerPanel.Content._swapRSB(activeLayer, targetLayer);
	}

	FontRig.LayerPanel._afterChange(inst, 'Swap: ' + activeLayer.name + ' ↔ ' + targetName);
};

// -- Clean: remove all shapes from selected layers
FontRig.LayerPanel.Content.clean = function(inst) {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData) return;

	var names = FontRig.LayerPanel._getSelectedLayerNames(inst);
	if (!names.length) return;

	if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();

	for (var i = 0; i < names.length; i++) {
		var layer = FontRig.getLayerByName(glyphData, names[i]);
		if (!layer) continue;

		if (inst._opt.outline) layer.shapes = [];
		if (inst._opt.anchors) layer.anchors = [];
	}

	FontRig.LayerPanel._afterChange(inst, 'Clean layers: ' + names.join(', '));
};

// -- LSB/RSB helpers
// LSB is derived from the leftmost point in the layer's shapes.
// For .trfont, LSB is implicitly 0 relative to origin. Sidebearings
// are controlled by shifting all points (LSB) or changing width (RSB).
FontRig.LayerPanel.Content._getLayerBounds = function(layer) {
	var xMin = Infinity, xMax = -Infinity;

	if (!layer || !layer.shapes) return { xMin: 0, xMax: 0 };

	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ci = 0; ci < shape.contours.length; ci++) {
			var contour = shape.contours[ci];
			for (var ni = 0; ni < contour.nodes.length; ni++) {
				var x = contour.nodes[ni].x;
				if (x < xMin) xMin = x;
				if (x > xMax) xMax = x;
			}
		}
	}

	if (xMin === Infinity) return { xMin: 0, xMax: 0 };
	return { xMin: xMin, xMax: xMax };
};

FontRig.LayerPanel.Content._copyLSB = function(srcLayer, dstLayer) {
	var srcBounds = FontRig.LayerPanel.Content._getLayerBounds(srcLayer);
	var dstBounds = FontRig.LayerPanel.Content._getLayerBounds(dstLayer);
	var delta = srcBounds.xMin - dstBounds.xMin;

	if (delta === 0 || !isFinite(delta)) return;

	// Shift all points in dst layer
	for (var si = 0; si < dstLayer.shapes.length; si++) {
		var shape = dstLayer.shapes[si];
		for (var ci = 0; ci < shape.contours.length; ci++) {
			var contour = shape.contours[ci];
			for (var ni = 0; ni < contour.nodes.length; ni++) {
				contour.nodes[ni].x += delta;
			}
		}
	}
};

FontRig.LayerPanel.Content._copyRSB = function(srcLayer, dstLayer) {
	var srcBounds = FontRig.LayerPanel.Content._getLayerBounds(srcLayer);
	var dstBounds = FontRig.LayerPanel.Content._getLayerBounds(dstLayer);
	var srcRSB = srcLayer.width - srcBounds.xMax;
	var dstRSB = dstLayer.width - dstBounds.xMax;

	if (!isFinite(srcRSB)) return;
	dstLayer.width = dstBounds.xMax + srcRSB;
};

FontRig.LayerPanel.Content._swapLSB = function(layerA, layerB) {
	var boundsA = FontRig.LayerPanel.Content._getLayerBounds(layerA);
	var boundsB = FontRig.LayerPanel.Content._getLayerBounds(layerB);
	var deltaA = boundsB.xMin - boundsA.xMin;
	var deltaB = boundsA.xMin - boundsB.xMin;

	if (!isFinite(deltaA)) return;

	FontRig.LayerPanel.Content._shiftAllX(layerA, deltaA);
	FontRig.LayerPanel.Content._shiftAllX(layerB, deltaB);
};

FontRig.LayerPanel.Content._swapRSB = function(layerA, layerB) {
	var boundsA = FontRig.LayerPanel.Content._getLayerBounds(layerA);
	var boundsB = FontRig.LayerPanel.Content._getLayerBounds(layerB);
	var rsbA = layerA.width - boundsA.xMax;
	var rsbB = layerB.width - boundsB.xMax;

	if (!isFinite(rsbA) || !isFinite(rsbB)) return;

	layerA.width = boundsA.xMax + rsbB;
	layerB.width = boundsB.xMax + rsbA;
};

FontRig.LayerPanel.Content._shiftAllX = function(layer, delta) {
	if (!delta) return;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ci = 0; ci < shape.contours.length; ci++) {
			var contour = shape.contours[ci];
			for (var ni = 0; ni < contour.nodes.length; ni++) {
				contour.nodes[ni].x += delta;
			}
		}
	}
};

// =====================================================================
// CONTOUR OPERATIONS — pull/push node positions across layers
// =====================================================================

FontRig.LayerPanel.Contour = {};

// -- Pull nodes: copy node positions from selected layer → active (selected nodes only)
FontRig.LayerPanel.Contour.pullNodes = function(inst) {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData) return;

	var activeLayer = FontRig.getActiveLayer();
	if (!activeLayer) return;

	var names = FontRig.LayerPanel._getSelectedLayerNames(inst);
	var srcName = null;
	for (var i = 0; i < names.length; i++) {
		if (names[i] !== activeLayer.name) { srcName = names[i]; break; }
	}
	if (!srcName) return;

	var srcLayer = FontRig.getLayerByName(glyphData, srcName);
	if (!srcLayer) return;

	// Check compatibility
	var compat = FontRig.LayerPanel.checkCompatibility(activeLayer, srcLayer);
	if (compat.tier === 'incompatible') {
		console.warn('[LayerPanel] Cannot pull nodes: layers are incompatible');
		return;
	}

	if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();

	var selectedIds = FontRig.state.selectedNodeIds;
	if (selectedIds.size === 0) {
		// No selection: copy all node positions
		FontRig.LayerPanel.Contour._copyAllNodePositions(srcLayer, activeLayer);
	} else {
		// Copy only selected node positions
		selectedIds.forEach(function(nodeId) {
			var srcHit = FontRig._findNodeInLayer(srcLayer, nodeId);
			var dstHit = FontRig._findNodeInLayer(activeLayer, nodeId);
			if (srcHit && dstHit) {
				dstHit.node.x = srcHit.node.x;
				dstHit.node.y = srcHit.node.y;
			}
		});
	}

	FontRig.LayerPanel._afterChange(inst, 'Pull nodes: ' + srcName + ' → ' + activeLayer.name);
};

// -- Push nodes: copy node positions from active → selected layers (selected nodes only)
FontRig.LayerPanel.Contour.pushNodes = function(inst) {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData) return;

	var activeLayer = FontRig.getActiveLayer();
	if (!activeLayer) return;

	var names = FontRig.LayerPanel._getSelectedLayerNames(inst);
	if (!names.length) return;

	if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();

	var selectedIds = FontRig.state.selectedNodeIds;

	for (var i = 0; i < names.length; i++) {
		if (names[i] === activeLayer.name) continue;
		var dstLayer = FontRig.getLayerByName(glyphData, names[i]);
		if (!dstLayer) continue;

		var compat = FontRig.LayerPanel.checkCompatibility(activeLayer, dstLayer);
		if (compat.tier === 'incompatible') {
			console.warn('[LayerPanel] Skipping incompatible layer:', names[i]);
			continue;
		}

		if (selectedIds.size === 0) {
			FontRig.LayerPanel.Contour._copyAllNodePositions(activeLayer, dstLayer);
		} else {
			selectedIds.forEach(function(nodeId) {
				var srcHit = FontRig._findNodeInLayer(activeLayer, nodeId);
				var dstHit = FontRig._findNodeInLayer(dstLayer, nodeId);
				if (srcHit && dstHit) {
					dstHit.node.x = srcHit.node.x;
					dstHit.node.y = srcHit.node.y;
				}
			});
		}
	}

	FontRig.LayerPanel._afterChange(inst, 'Push nodes: ' + activeLayer.name + ' → ' + names.join(', '));
};

// Copy all node positions from one layer to another (structurally compatible)
FontRig.LayerPanel.Contour._copyAllNodePositions = function(srcLayer, dstLayer) {
	var srcNodes = FontRig.getAllNodes(srcLayer);
	var dstNodes = FontRig.getAllNodes(dstLayer);

	var count = Math.min(srcNodes.length, dstNodes.length);
	for (var i = 0; i < count; i++) {
		dstNodes[i].x = srcNodes[i].x;
		dstNodes[i].y = srcNodes[i].y;

		// Write back (getAllNodes returns copies with references)
		// We need to write to the actual contour node
		var dstContour = dstNodes[i].contour;
		var dstNi = dstNodes[i].nodeIdx;
		if (dstContour && dstContour.nodes[dstNi]) {
			dstContour.nodes[dstNi].x = srcNodes[i].x;
			dstContour.nodes[dstNi].y = srcNodes[i].y;
		}
	}
};

// -- Copy contours to clipboard (multi-layer)
FontRig.LayerPanel.Contour.copyOutline = function(inst) {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData) return;

	var names = FontRig.LayerPanel._getSelectedLayerNames(inst);
	if (!names.length) names = [FontRig.state.activeLayer];

	inst._contourClipboard = {};

	for (var i = 0; i < names.length; i++) {
		var layer = FontRig.getLayerByName(glyphData, names[i]);
		if (!layer) continue;

		// Clone all shapes
		inst._contourClipboard[names[i]] = JSON.parse(JSON.stringify(layer.shapes));
	}

	FontRig.log('[LayerPanel] Copied outlines from layers:', names.join(', '));
};

// -- Paste contours from clipboard (by layer name match)
FontRig.LayerPanel.Contour.pasteOutline = function(inst) {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData || !inst._contourClipboard) return;

	if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();

	var pasted = [];
	var clipKeys = Object.keys(inst._contourClipboard);

	for (var i = 0; i < clipKeys.length; i++) {
		var layerName = clipKeys[i];
		var layer = FontRig.getLayerByName(glyphData, layerName);
		if (!layer) continue;

		var clonedShapes = JSON.parse(JSON.stringify(inst._contourClipboard[layerName]));

		// Add shapes (append, don't replace)
		for (var s = 0; s < clonedShapes.length; s++) {
			layer.shapes.push(clonedShapes[s]);
		}

		pasted.push(layerName);
	}

	if (pasted.length) {
		FontRig.LayerPanel._afterChange(inst, 'Paste outlines to: ' + pasted.join(', '));
	}
};

// -- Paste contours by selection order (clipboard layers → selected layers in order)
FontRig.LayerPanel.Contour.pasteOutlineBySelection = function(inst) {
	var glyphData = FontRig.state.glyphData;
	if (!glyphData || !inst._contourClipboard) return;

	var names = FontRig.LayerPanel._getSelectedLayerNames(inst);
	var clipKeys = Object.keys(inst._contourClipboard);

	if (names.length !== clipKeys.length) {
		console.warn('[LayerPanel] Clipboard layer count (' + clipKeys.length + ') does not match selection (' + names.length + ')');
		return;
	}

	if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();

	for (var i = 0; i < names.length; i++) {
		var layer = FontRig.getLayerByName(glyphData, names[i]);
		if (!layer) continue;

		var clonedShapes = JSON.parse(JSON.stringify(inst._contourClipboard[clipKeys[i]]));
		for (var s = 0; s < clonedShapes.length; s++) {
			layer.shapes.push(clonedShapes[s]);
		}
	}

	FontRig.LayerPanel._afterChange(inst, 'Paste outlines by selection');
};

// =====================================================================
// POST-CHANGE HOOK — refresh UI, update drawing, mark dirty
// =====================================================================

FontRig.LayerPanel._afterChange = function(inst, msg) {
	// Save selected names before rebuild
	inst._selectedNames = FontRig.LayerPanel._getSelectedLayerNames(inst);

	// Rebuild layer dropdown
	if (FontRig.dom.layerSelect && FontRig.state.glyphData) {
		FontRig.dom.layerSelect.innerHTML = '';
		for (var i = 0; i < FontRig.state.glyphData.layers.length; i++) {
			var opt = document.createElement('option');
			opt.value = FontRig.state.glyphData.layers[i].name;
			opt.textContent = FontRig.state.glyphData.layers[i].name;
			FontRig.dom.layerSelect.appendChild(opt);
		}
		FontRig.dom.layerSelect.value = FontRig.state.activeLayer;
	}

	// Mark dirty
	if (typeof FontRig.markDirty === 'function') FontRig.markDirty();

	// Run forward interpolation on all lerp axes (a master may have changed)
	if (!inst._isLerpUpdate) {
		inst._isLerpUpdate = true;
		FontRig.LayerPanel.Lerp.updateAll(inst);
		inst._isLerpUpdate = false;
	}

	// Refresh panel
	inst.update();

	// Redraw canvas
	FontRig.draw();

	// Sync XML panel if open
	if (typeof FontRig.xmlRefresh === 'function') FontRig.xmlRefresh();

	FontRig.log('[LayerPanel]', msg);
};

// =====================================================================
// MOUNT — create a Layer panel instance
// =====================================================================

FontRig.LayerPanel.mount = function(containerEl, ctx) {
	if (!containerEl) return null;

	var inst = {
		_containerEl: containerEl,
		_rows: [],
		_lastClickedRow: null,
		_selectedNames: [],
		_hiddenLayers: new Set(),
		_contourClipboard: null,
		_dragIdx: null,
		_lerpAxes: [],          // Lerp axis definitions
		_lerpSnapshot: null,    // Pre-edit snapshot for reverse propagation
		_isLerpUpdate: false,   // Guard against circular updates
		_opt: {
			outline: true,
			anchors: false,
			lsb: false,
			advance: true,
			rsb: false
		}
	};

	containerEl.innerHTML = '';

	var content = document.createElement('div');
	content.className = 'layer-panel';

	// =================================================================
	// 1. HEADER — glyph name + refresh
	// =================================================================
	var grpHead = document.createElement('div');
	grpHead.className = 'lp-header';

	var lblIcon = FRWidget.icon('label');
	lblIcon.className += ' lp-header__icon';
	grpHead.appendChild(lblIcon);

	inst._glyphName = document.createElement('span');
	inst._glyphName.className = 'lp-header__name';
	inst._glyphName.textContent = FontRig.state.glyphData ? FontRig.state.glyphData.name : '—';
	grpHead.appendChild(inst._glyphName);

	var spacer = document.createElement('span');
	spacer.className = 'frw-spacer';
	grpHead.appendChild(spacer);

	grpHead.appendChild(FRWidget.Button(null, {
		icon: 'refresh', tooltip: 'Refresh',
		onClick: function() { inst.update(); }
	}));

	content.appendChild(grpHead);

	// =================================================================
	// 2. LAYER TABLE
	// =================================================================
	inst._table = FontRig.LayerPanel._buildTable(inst);
	content.appendChild(inst._table);

	// =================================================================
	// 3. CONTENT OPTIONS — toggles for what to copy
	// =================================================================
	var grpOpt = FRWidget.GroupBox(null);
	grpOpt.classList.add('lp-options');

	function makeOptToggle(icon, tooltip, key, defaultOn) {
		var btn = FRWidget.ToggleButton(null, {
			icon: icon, tooltip: tooltip,
			active: defaultOn,
			onChange: function(active) { inst._opt[key] = active; }
		});
		return btn;
	}

	grpOpt.addWidget(makeOptToggle('bbox', 'Outline', 'outline', true));
	grpOpt.addWidget(makeOptToggle('icon_anchor', 'Anchors', 'anchors', false));
	grpOpt.addWidget(makeOptToggle('metrics_lsb', 'Metrics LSB', 'lsb', false));
	grpOpt.addWidget(makeOptToggle('metrics_advance', 'Advance width', 'advance', true));
	grpOpt.addWidget(makeOptToggle('metrics_rsb', 'Metrics RSB', 'rsb', false));

	content.appendChild(grpOpt);

	// =================================================================
	// 4. LAYER ACTIONS — add, remove, rename, duplicate, reorder, visibility, type
	// =================================================================
	var grpActions = FRWidget.GroupBox('Layer');

	grpActions.addWidget(FRWidget.Button(null, {
		icon: 'layer_add_alt', tooltip: 'Add new layer',
		onClick: function() { FontRig.LayerPanel.Actions.addLayer(inst); }
	}));

	grpActions.addWidget(FRWidget.Button(null, {
		icon: 'layer_remove_alt', tooltip: 'Remove selected layers',
		onClick: function() { FontRig.LayerPanel.Actions.removeLayers(inst); }
	}));

	grpActions.addWidget(FRWidget.Button(null, {
		icon: 'rename', tooltip: 'Rename layer',
		onClick: function() { FontRig.LayerPanel.Actions.renameLayer(inst); }
	}));

	grpActions.addWidget(FRWidget.Button(null, {
		icon: 'layer_duplicate', tooltip: 'Duplicate layers',
		onClick: function() { FontRig.LayerPanel.Actions.duplicateLayers(inst); }
	}));

	grpActions.addWidget(FRWidget.Button(null, {
		icon: 'layer_mask_add', tooltip: 'Duplicate as mask',
		onClick: function() { FontRig.LayerPanel.Actions.duplicateAsMask(inst); }
	}));

	grpActions.addSeparator();

	grpActions.addWidget(FRWidget.Button(null, {
		icon: 'visible', tooltip: 'Set layers visible',
		onClick: function() { FontRig.LayerPanel.Actions.setVisible(inst, true); }
	}));

	grpActions.addWidget(FRWidget.Button(null, {
		icon: 'visible_off', tooltip: 'Set layers invisible',
		onClick: function() { FontRig.LayerPanel.Actions.setVisible(inst, false); }
	}));

	grpActions.addSeparator();

	grpActions.addWidget(FRWidget.Button(null, {
		icon: 'layer_mask', tooltip: 'Toggle mask type',
		onClick: function() { FontRig.LayerPanel.Actions.setType(inst, 'Mask'); }
	}));

	grpActions.addWidget(FRWidget.Button(null, {
		icon: 'layer_service', tooltip: 'Toggle service type',
		onClick: function() { FontRig.LayerPanel.Actions.setType(inst, 'Service'); }
	}));

	content.appendChild(grpActions);

	// =================================================================
	// 4b. INTERPOLATION — set axis, remove axis
	// =================================================================
	var grpLerp = FRWidget.GroupBox('Interpolation');

	grpLerp.addWidget(FRWidget.Button(null, {
		icon: 'axis_set', tooltip: 'Set lerp axis from selected layers',
		onClick: function() { FontRig.LayerPanel.Lerp.createAxis(inst); }
	}));

	grpLerp.addWidget(FRWidget.Button(null, {
		icon: 'axis_remove', tooltip: 'Remove lerp axis for selected layer',
		onClick: function() {
			var names = FontRig.LayerPanel._getSelectedLayerNames(inst);
			for (var i = 0; i < names.length; i++) {
				if (FontRig.LayerPanel.Lerp.isLerpLayer(names[i])) {
					FontRig.LayerPanel.Lerp.removeAxis(inst, names[i]);
					return;
				}
			}
		}
	}));

	grpLerp.addWidget(FRWidget.Button(null, {
		icon: 'extrapolate', tooltip: 'Toggle extrapolation (allow values beyond 0–1000)',
		onClick: function() {
			// Future: toggle extrapolation mode
			FontRig.log('[Lerp] Extrapolation toggle — not yet implemented');
		}
	}));

	content.appendChild(grpLerp);

	// =================================================================
	// 5. CONTENT OPERATIONS — swap, pull, push, clean
	// =================================================================
	var grpContent = FRWidget.GroupBox('Content');

	grpContent.addWidget(FRWidget.Button(null, {
		icon: 'layer_swap', tooltip: 'Swap layer contents',
		onClick: function() { FontRig.LayerPanel.Content.swap(inst); }
	}));

	grpContent.addWidget(FRWidget.Button(null, {
		icon: 'layer_pull', tooltip: 'Pull contents from selected → active',
		onClick: function() { FontRig.LayerPanel.Content.pull(inst); }
	}));

	grpContent.addWidget(FRWidget.Button(null, {
		icon: 'layer_push', tooltip: 'Push contents from active → selected',
		onClick: function() { FontRig.LayerPanel.Content.push(inst); }
	}));

	grpContent.addWidget(FRWidget.Button(null, {
		icon: 'layer_clean', tooltip: 'Clear layer contents',
		onClick: function() { FontRig.LayerPanel.Content.clean(inst); }
	}));

	content.appendChild(grpContent);

	// =================================================================
	// 6. CONTOUR OPERATIONS — pull/push nodes, copy/paste outlines
	// =================================================================
	var grpContour = FRWidget.GroupBox('Contour');

	grpContour.addWidget(FRWidget.Button(null, {
		icon: 'nodes_pull', tooltip: 'Pull node positions from selected → active',
		onClick: function() { FontRig.LayerPanel.Contour.pullNodes(inst); }
	}));

	grpContour.addWidget(FRWidget.Button(null, {
		icon: 'nodes_push', tooltip: 'Push node positions from active → selected',
		onClick: function() { FontRig.LayerPanel.Contour.pushNodes(inst); }
	}));

	grpContour.addSeparator();

	grpContour.addWidget(FRWidget.Button(null, {
		icon: 'clipboard_copy_nodes', tooltip: 'Copy outlines to clipboard (multi-layer)',
		onClick: function() { FontRig.LayerPanel.Contour.copyOutline(inst); }
	}));

	grpContour.addWidget(FRWidget.Button(null, {
		icon: 'clipboard_paste_nodes', tooltip: 'Paste outlines from clipboard (by layer name)',
		onClick: function() { FontRig.LayerPanel.Contour.pasteOutline(inst); }
	}));

	grpContour.addWidget(FRWidget.Button(null, {
		icon: 'clipboard_paste_exact', tooltip: 'Paste outlines from clipboard (by selection order)',
		onClick: function() { FontRig.LayerPanel.Contour.pasteOutlineBySelection(inst); }
	}));

	content.appendChild(grpContour);

	// =================================================================
	// Finalize
	// =================================================================
	containerEl.appendChild(content);

	// -- Public API
	inst.update = function() {
		inst._glyphName.textContent = FontRig.state.glyphData ? FontRig.state.glyphData.name : '—';
		inst._selectedNames = FontRig.LayerPanel._getSelectedLayerNames(inst);

		// Prune stale lerp axes (whose lerp layer no longer exists)
		if (inst._lerpAxes && FontRig.state.glyphData) {
			for (var li = inst._lerpAxes.length - 1; li >= 0; li--) {
				if (!FontRig.getLayerByName(FontRig.state.glyphData, inst._lerpAxes[li].name)) {
					inst._lerpAxes.splice(li, 1);
				}
			}
		}

		FontRig.LayerPanel._populateTable(inst);
	};

	// Called by the drawing/editing pipeline on every change
	inst.onGlyphEdit = function() {
		if (inst._isLerpUpdate) return; // prevent circular
		inst._isLerpUpdate = true;

		var activeName = FontRig.state.activeLayer;

		if (FontRig.LayerPanel.Lerp.isLerpLayer(activeName)) {
			// Active layer IS a lerp layer — run reverse propagation
			var axis = FontRig.LayerPanel.Lerp.findAxis(inst, activeName);
			if (axis && inst._lerpSnapshot) {
				FontRig.LayerPanel.Lerp._reverse(inst, axis, inst._lerpSnapshot);
				// Re-snapshot after reverse
				var lerpLayer = FontRig.getLayerByName(FontRig.state.glyphData, activeName);
				if (lerpLayer) inst._lerpSnapshot = FontRig.LayerPanel.Lerp._snapshot(lerpLayer);
			}
		} else {
			// Active layer is a regular layer — run forward on all axes
			FontRig.LayerPanel.Lerp.updateAll(inst);
		}

		inst._isLerpUpdate = false;
	};

	// Snapshot before edit begins (called on mousedown/toolstart)
	inst.onEditStart = function() {
		var activeName = FontRig.state.activeLayer;
		if (FontRig.LayerPanel.Lerp.isLerpLayer(activeName)) {
			var lerpLayer = FontRig.getLayerByName(FontRig.state.glyphData, activeName);
			if (lerpLayer) {
				inst._lerpSnapshot = FontRig.LayerPanel.Lerp._snapshot(lerpLayer);
			}
		}
	};

	inst.onMainWindowEvent = function(eventType) {};

	// Initial populate
	FontRig.LayerPanel._populateTable(inst);

	return inst;
};
