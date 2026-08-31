// ===================================================================
// FontRig — Movement Preferences
// ===================================================================
// Centralized movement step configuration. All arrow-key nudges read
// their base X/Y step from here. Supports synchronized multi-layer
// movement with optional per-master step overrides.
//
// Depends on:
//   - FontRig.scope, FontRig.layerSelection  (fr-dialogs.js)
//   - FontRig.getSyncLayers, FontRig._findNodeInLayer (multi-layer-sync.js)
//   - FRWidget.*  (fr-widgets.js)
// ===================================================================
'use strict';

// ===================================================================
// STATE
// ===================================================================
FontRig.movementPrefs = {
	stepX: 1,             // global X step (integer)
	stepY: 1,             // global Y step (integer)
	syncMovement: false,  // propagate nudge to scope layers
	perMaster: false,     // use per-master steps when true
	masterSteps: {},      // { layerName: { stepX: int, stepY: int }, ... }

	// Resolve the effective step for a given layer.
	// If per-master is on and the layer has a defined step, use that.
	// Otherwise fall back to the global step.
	getStepForLayer: function(layerName) {
		if (this.perMaster && this.masterSteps[layerName]) {
			return {
				x: this.masterSteps[layerName].stepX,
				y: this.masterSteps[layerName].stepY
			};
		}
		return { x: this.stepX, y: this.stepY };
	}
};


// ===================================================================
// SYNCHRONIZED MOVE
// ===================================================================
// Moves selected nodes on all compatible scope layers.
// dirX/dirY: direction multipliers (-1, 0, or 1) from arrow keys.
// multiplier: modifier key multiplier (1, 10, or 100).
//
// Each layer gets its own step values applied:
//   dx = dirX * step.x * multiplier
//   dy = dirY * step.y * multiplier
FontRig.sync_moveSelectedNodes = function(dirX, dirY, multiplier) {
	var sel = FontRig.state.selectedNodeIds;
	if (sel.size === 0) return;

	var prefs = FontRig.movementPrefs;
	multiplier = multiplier || 1;

	if (!prefs.syncMovement || FontRig.scope.layerMode === 'active') {
		// Single-layer mode: move on active layer only
		var step = prefs.getStepForLayer(FontRig.state.activeLayer);
		var dx = dirX * step.x * multiplier;
		var dy = dirY * step.y * multiplier;
		FontRig.moveSelectedNodes(dx, dy);
		return;
	}

	// Multi-layer synchronized move
	var layers = FontRig.getSyncLayers();

	for (var li = 0; li < layers.length; li++) {
		var layer = layers[li];
		var step = prefs.getStepForLayer(layer.name);
		var dx = dirX * step.x * multiplier;
		var dy = dirY * step.y * multiplier;

		if (li === 0) {
			// Active layer: use existing moveSelectedNodes (handles smooth enforcement)
			FontRig.moveSelectedNodes(dx, dy);
		} else {
			// Other layers: move the same node IDs
			FontRig._moveNodesInLayer(layer, sel, dx, dy);
			FontRig.invalidatePathCache(layer);
		}
	}

	// Draw is already scheduled by moveSelectedNodes for the active
	// layer; coalesce the multi-layer refresh into the same frame.
	FontRig.requestDraw();
};

// Move nodes by ID set in a specific layer, with smooth enforcement.
FontRig._moveNodesInLayer = function(layer, nodeIds, dx, dy) {
	var hobbyContours = new Set();

	// Curvature mode: snapshot this layer's curvature targets before the
	// nudge so synced masters hold curvature just like the active layer.
	var curvSnap = (FontRig.curvatureMode && typeof FontRig._snapshotCurvatureForNudge === 'function')
		? FontRig._snapshotCurvatureForNudge(nodeIds, layer) : null;

	for (var id of nodeIds) {
		var ref = FontRig._findNodeInLayer(layer, id);
		if (!ref) continue;
		// Hobby: route through the source-of-truth knot/BCP, then
		// re-solve below so the bezier shadow tracks the change.
		if (ref.contour && ref.contour.kind === 'hobby') {
			FontRig._nudgeHobbyNode(ref.contour, id, dx, dy);
			hobbyContours.add(ref.contour);
			continue;
		}
		ref.node.x = Math.round((ref.node.x + dx) * 10) / 10;
		ref.node.y = Math.round((ref.node.y + dy) * 10) / 10;
	}

	hobbyContours.forEach(function(c) { FontRig.solveHobbyContour(c); });

	// Enforce smooth tangent continuity (same logic as enforceSmoothForKeys
	// but operating on the given layer instead of the active layer)
	FontRig._enforceSmoothForKeysInLayer(layer, nodeIds, dx, dy);

	// Curvature mode: re-solve this layer's anchor handles to hold the
	// snapshotted curvatures now that the nudge + smooth pass have run.
	if (curvSnap && typeof FontRig._applyCurvatureForNudge === 'function') {
		FontRig._applyCurvatureForNudge(curvSnap);
	}
};

// Layer-parameterized version of enforceSmoothForKeys.
// Translates adjacent handles of selected on-curves, then enforces
// collinearity for smooth nodes — all within the specified layer.
FontRig._enforceSmoothForKeysInLayer = function(layer, draggedIds, dx, dy) {
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


// ===================================================================
// MOVEMENT DIALOG
// ===================================================================
// Persistent, draggable dialog. Opened from Editor > Movement.
// Reused across open/close cycles.
var _movementDlg = null;

FontRig.openMovementPrefs = function() {
	if (_movementDlg) {
		_movementDlg.refresh();
		_movementDlg.open();
		return;
	}

	var prefs = FontRig.movementPrefs;

	// -- Global step spinboxes ----------------------------------------
	var globalRow = document.createElement('div');
	globalRow.className = 'frw-mvp__row';

	var lblX = document.createElement('span');
	lblX.className = 'tri frw-mvp__icon';
	lblX.textContent = 'delta_x';

	var spnX = FRWidget.SpinBox({
		min: 1, max: 999, value: prefs.stepX, step: 1,
		tooltip: 'Horizontal step (units)',
		onChange: function(v) { prefs.stepX = v; }
	});

	var lblY = document.createElement('span');
	lblY.className = 'tri frw-mvp__icon';
	lblY.textContent = 'delta_y';

	var spnY = FRWidget.SpinBox({
		min: 1, max: 999, value: prefs.stepY, step: 1,
		tooltip: 'Vertical step (units)',
		onChange: function(v) { prefs.stepY = v; }
	});

	globalRow.appendChild(lblX);
	globalRow.appendChild(spnX);
	globalRow.appendChild(lblY);
	globalRow.appendChild(spnY);

	// -- Sync toggle --------------------------------------------------
	var syncRow = document.createElement('div');
	syncRow.className = 'frw-mvp__row';

	var btnSync = FRWidget.ToggleButton('Synchronize movement', {
		icon: 'node_snap',
		tooltip: 'Move selected nodes on all scope layers',
		active: prefs.syncMovement,
		onChange: function(active) {
			prefs.syncMovement = active;
		}
	});
	btnSync.classList.add('frw-mvp__toggle');
	syncRow.appendChild(btnSync);

	// -- Per-master toggle + expandable table --------------------------
	var perMasterRow = document.createElement('div');
	perMasterRow.className = 'frw-mvp__row';

	var masterTableWrap = document.createElement('div');
	masterTableWrap.className = 'frw-mvp__master-table';
	masterTableWrap.style.display = prefs.perMaster ? '' : 'none';

	var btnPerMaster = FRWidget.ToggleButton('Set per master', {
		icon: 'layer_master',
		tooltip: 'Set different step values per master layer',
		active: prefs.perMaster,
		onChange: function(active) {
			prefs.perMaster = active;
			masterTableWrap.style.display = active ? '' : 'none';
			if (active) buildMasterTable();
		}
	});
	btnPerMaster.classList.add('frw-mvp__toggle');
	perMasterRow.appendChild(btnPerMaster);

	// -- Master table builder -----------------------------------------
	var _masterSpinners = {}; // { layerName: { spnX, spnY } }

	function buildMasterTable() {
		masterTableWrap.innerHTML = '';
		_masterSpinners = {};

		// Get master layer names from scope
		var layerNames = [];
		if (FontRig.font && FontRig.font.masters && FontRig.font.masters.length > 0) {
			for (var i = 0; i < FontRig.font.masters.length; i++) {
				layerNames.push(FontRig.font.masters[i].layerName);
			}
		} else if (FontRig.state.glyphData) {
			for (var i = 0; i < FontRig.state.glyphData.layers.length; i++) {
				var lname = FontRig.state.glyphData.layers[i].name;
				if (!FontRig.isMaskLayer(lname)) layerNames.push(lname);
			}
		}

		if (layerNames.length === 0) {
			var empty = document.createElement('div');
			empty.className = 'frw-mvp__empty';
			empty.textContent = 'No master layers available';
			masterTableWrap.appendChild(empty);
			return;
		}

		// Header
		var hdr = document.createElement('div');
		hdr.className = 'frw-mvp__table-hdr';

		var hdrName = document.createElement('span');
		hdrName.className = 'frw-mvp__table-cell frw-mvp__table-cell--name';
		hdrName.textContent = 'Layer';

		var hdrX = document.createElement('span');
		hdrX.className = 'frw-mvp__table-cell frw-mvp__table-cell--val';
		hdrX.innerHTML = '<span class="tri">delta_x</span>';

		var hdrY = document.createElement('span');
		hdrY.className = 'frw-mvp__table-cell frw-mvp__table-cell--val';
		hdrY.innerHTML = '<span class="tri">delta_y</span>';

		hdr.appendChild(hdrName);
		hdr.appendChild(hdrX);
		hdr.appendChild(hdrY);
		masterTableWrap.appendChild(hdr);

		// Rows
		for (var i = 0; i < layerNames.length; i++) {
			(function(lname) {
				var existing = prefs.masterSteps[lname] || { stepX: prefs.stepX, stepY: prefs.stepY };

				var row = document.createElement('div');
				row.className = 'frw-mvp__table-row';

				// Highlight active layer
				if (lname === FontRig.state.activeLayer) {
					row.classList.add('frw-mvp__table-row--active');
				}

				var nameCell = document.createElement('span');
				nameCell.className = 'frw-mvp__table-cell frw-mvp__table-cell--name';
				nameCell.textContent = lname;
				nameCell.title = lname;

				var spnMX = FRWidget.SpinBox({
					min: 1, max: 999, value: existing.stepX, step: 1,
					onChange: function(v) {
						if (!prefs.masterSteps[lname]) {
							prefs.masterSteps[lname] = { stepX: prefs.stepX, stepY: prefs.stepY };
						}
						prefs.masterSteps[lname].stepX = v;
					}
				});

				var spnMY = FRWidget.SpinBox({
					min: 1, max: 999, value: existing.stepY, step: 1,
					onChange: function(v) {
						if (!prefs.masterSteps[lname]) {
							prefs.masterSteps[lname] = { stepX: prefs.stepX, stepY: prefs.stepY };
						}
						prefs.masterSteps[lname].stepY = v;
					}
				});

				var xCell = document.createElement('span');
				xCell.className = 'frw-mvp__table-cell frw-mvp__table-cell--val';
				xCell.appendChild(spnMX);

				var yCell = document.createElement('span');
				yCell.className = 'frw-mvp__table-cell frw-mvp__table-cell--val';
				yCell.appendChild(spnMY);

				row.appendChild(nameCell);
				row.appendChild(xCell);
				row.appendChild(yCell);
				masterTableWrap.appendChild(row);

				_masterSpinners[lname] = { spnX: spnMX, spnY: spnMY };

				// Initialize masterSteps entry if not present
				if (!prefs.masterSteps[lname]) {
					prefs.masterSteps[lname] = { stepX: existing.stepX, stepY: existing.stepY };
				}
			})(layerNames[i]);
		}
	}

	// -- Assemble body ------------------------------------------------
	var body = document.createElement('div');
	body.className = 'frw-mvp';
	body.appendChild(globalRow);
	body.appendChild(syncRow);
	body.appendChild(perMasterRow);
	body.appendChild(masterTableWrap);

	// -- Create dialog ------------------------------------------------
	var dlg = FRWidget.Dialog({
		title: 'Movement',
		body: body,
		onClose: function() {
			// Dialog persists, just hidden
		}
	});

	// Style overrides for this dialog
	dlg.dialog.style.minWidth = '280px';
	dlg.dialog.style.maxWidth = '400px';

	// Public refresh (rebuilds master table when font/glyph changes)
	dlg.refresh = function() {
		// Sync spinbox values back from prefs
		spnX.setValue(prefs.stepX);
		spnY.setValue(prefs.stepY);
		if (prefs.perMaster) buildMasterTable();
	};

	// Build initial master table if per-master is on
	if (prefs.perMaster) buildMasterTable();

	_movementDlg = dlg;
	dlg.open();
};
