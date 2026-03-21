// ===================================================================
// FontRig — Node Panel (Multi-Instance)
// ===================================================================
// Node manipulation panel based on TypeRig GUI Node panel.
// Uses FRWidget factories for all UI elements.
// Python logic lives in node-panel-actions.py; JS calls actions by
// name via the `npa("action_name", ...)` bridge dispatcher.
// ===================================================================
'use strict';

FontRig.NodePanel = {};

// =====================================================================
// Helper: run a Python npa() action via pyBridge
// =====================================================================
function _runNpa(call) {
	if (!FontRig.pyBridge || !FontRig.pyBridge.ready) {
		console.warn('[NodePanel] Python not ready');
		return;
	}
	if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();
	FontRig.pyBridge.run(call);
}

// =====================================================================
// Mount: create a Node panel instance
// =====================================================================
FontRig.NodePanel.mount = function(containerEl, ctx) {
	if (!containerEl) return null;

	var inst = {
		_containerEl: containerEl,
		_slopeBank: 0,
		_moveMethod: 'SMART',
		_targetSet: false,
	};

	containerEl.innerHTML = '';

	var content = document.createElement('div');
	content.className = 'node-panel';

	// =================================================================
	// 1. NODE TOOLS
	// =================================================================
	var grpNode = FRWidget.GroupBox('Node');

	grpNode.addWidget(FRWidget.Button(null, {
		icon: 'node_add', tooltip: 'Insert node at midpoint',
		onClick: function() { _runNpa('npa("npa_insert", 0.5)'); }
	}));

	grpNode.addWidget(FRWidget.Button(null, {
		icon: 'node_add_extreme_alt', tooltip: 'Insert node at extremes',
		onClick: function() { _runNpa('npa("npa_insert_at_extremes")'); }
	}));

	grpNode.addWidget(FRWidget.Button(null, {
		icon: 'node_remove', tooltip: 'Remove selected nodes',
		onClick: function() { _runNpa('npa("npa_remove")'); }
	}));

	grpNode.addWidget(FRWidget.Button(null, {
		icon: 'node_smooth', tooltip: 'Set node smooth',
		onClick: function() { _runNpa('npa("npa_set_smooth", True)'); }
	}));

	grpNode.addWidget(FRWidget.Button(null, {
		icon: 'node_sharp', tooltip: 'Set node sharp',
		onClick: function() { _runNpa('npa("npa_set_smooth", False)'); }
	}));

	grpNode.addWidget(FRWidget.Button(null, {
		icon: 'node_round', tooltip: 'Round coordinates (ceil)',
		onClick: function() { _runNpa('npa("npa_round_coordinates")'); }
	}));

	content.appendChild(grpNode);

	// =================================================================
	// 2. CORNER TOOLS
	// =================================================================
	var grpCorner = FRWidget.GroupBox('Corner');

	// Mitre
	var spnMitre = FRWidget.SpinButton(null, {
		icon: 'corner_mitre', tooltip: 'Corner Mitre',
		min: 0, max: 300, value: 5, step: 1,
		onClick: function(val) {
			_runNpa('npa("npa_corner_mitre", ' + val + ')');
		}
	});
	grpCorner.addWidget(spnMitre);

	// Round
	var spnRound = FRWidget.SpinButton(null, {
		icon: 'corner_round', tooltip: 'Corner Round',
		min: 0, max: 300, value: 5, step: 1,
		onClick: function(val) {
			_runNpa('npa("npa_corner_round", ' + val + ')');
		}
	});
	grpCorner.addWidget(spnRound);

	// Loop
	var spnLoop = FRWidget.SpinButton(null, {
		icon: 'corner_loop', tooltip: 'Corner Loop',
		min: 0, max: 300, value: 20, step: 1,
		onClick: function(val) {
			_runNpa('npa("npa_corner_loop", ' + val + ')');
		}
	});
	grpCorner.addWidget(spnLoop);

	// Trap
	grpCorner.addWidget(FRWidget.Button(null, {
		icon: 'corner_trap', tooltip: 'Create ink trap',
		onClick: function() { _runNpa('npa("npa_corner_trap")'); }
	}));

	// Rebuild
	grpCorner.addWidget(FRWidget.Button(null, {
		icon: 'corner_rebuild', tooltip: 'Rebuild corner',
		onClick: function() { _runNpa('npa("npa_corner_rebuild")'); }
	}));

	content.appendChild(grpCorner);

	// =================================================================
	// 3. ALIGN TOOLS
	// =================================================================
	var grpAlign = FRWidget.GroupBox('Align');

	// Pick target
	var btnTarget = FRWidget.ToggleButton(null, {
		icon: 'node_target', tooltip: 'Pick target node for alignment',
		onChange: function(active) {
			if (active) {
				if (!FontRig.pyBridge || !FontRig.pyBridge.ready) return;
				FontRig.pyBridge.syncToPython();
				try {
					var ok = FontRig.pyBridge.pyodide.runPython('npa("npa_target_set")');
					inst._targetSet = !!ok;
				} catch (e) {
					console.warn('[NodePanel] target set failed:', e);
					inst._targetSet = false;
				}
			} else {
				inst._targetSet = false;
				if (FontRig.pyBridge && FontRig.pyBridge.ready) {
					try { FontRig.pyBridge.pyodide.runPython('npa("npa_target_clear")'); } catch(_) {}
				}
			}
		}
	});
	grpAlign.addWidget(btnTarget);

	// Collapse to target
	grpAlign.addWidget(FRWidget.Button(null, {
		icon: 'node_target_collapse', tooltip: 'Collapse selected nodes to target',
		onClick: function() {
			if (!inst._targetSet) return;
			_runNpa('npa("npa_collapse_to_target")');
		}
	}));

	// Align mode buttons
	var alignModes = [
		['node_align_left',        'L',            'Align left'],
		['node_align_right',       'R',            'Align right'],
		['node_align_top',         'T',            'Align top'],
		['node_align_bottom',      'B',            'Align bottom'],
		['node_align_selection_x', 'C',            'Align to horizontal center'],
		['node_align_selection_y', 'E',            'Align to vertical center'],
		['node_align_outline_x',   'BBoxCenterX',  'Align to bbox center X'],
		['node_align_outline_y',   'BBoxCenterY',  'Align to bbox center Y'],
		['node_align_neigh_x',     'peerCenterX',  'Align to neighbor center X'],
		['node_align_neigh_y',     'peerCenterY',  'Align to neighbor center Y'],
		['node_align_min_max_Y',   'Y',            'Align to min/max Y line'],
		['node_align_min_max_X',   'X',            'Align to min/max X line'],
	];

	for (var i = 0; i < alignModes.length; i++) {
		(function(icon, mode, tip) {
			grpAlign.addWidget(FRWidget.Button(null, {
				icon: icon, tooltip: tip,
				onClick: function() {
					_runNpa('npa("npa_align", "' + mode + '")');
				}
			}));
		})(alignModes[i][0], alignModes[i][1], alignModes[i][2]);
	}

	content.appendChild(grpAlign);

	// =================================================================
	// 4. SLOPE TOOLS
	// =================================================================
	var grpSlope = FRWidget.GroupBox('Slope');

	// Copy slope
	var btnSlopeCopy = FRWidget.ToggleButton(null, {
		icon: 'slope_copy', tooltip: 'Copy slope between selected nodes',
		onChange: function(active) {
			if (active) {
				if (!FontRig.pyBridge || !FontRig.pyBridge.ready) return;
				FontRig.pyBridge.syncToPython();
				try {
					inst._slopeBank = FontRig.pyBridge.pyodide.runPython('npa("npa_slope_copy")');
				} catch (e) {
					console.warn('[NodePanel] slope copy failed:', e);
				}
			} else {
				inst._slopeBank = 0;
			}
		}
	});
	grpSlope.addWidget(btnSlopeCopy);

	// Paste slope (4 modes)
	var slopeModes = [
		['slope_paste_min',      'False', 'False', 'Paste slope (pivot min Y)'],
		['slope_paste_max',      'True',  'False', 'Paste slope (pivot max Y)'],
		['slope_paste_min_flip', 'False', 'True',  'Paste flipped slope (pivot min Y)'],
		['slope_paste_max_flip', 'True',  'True',  'Paste flipped slope (pivot max Y)'],
	];

	for (var s = 0; s < slopeModes.length; s++) {
		(function(icon, pMax, flip, tip) {
			grpSlope.addWidget(FRWidget.Button(null, {
				icon: icon, tooltip: tip,
				onClick: function() {
					_runNpa('npa("npa_slope_paste", ' + pMax + ', ' + flip + ')');
				}
			}));
		})(slopeModes[s][0], slopeModes[s][1], slopeModes[s][2], slopeModes[s][3]);
	}

	content.appendChild(grpSlope);

	// =================================================================
	// 5. MOVE TOOLS
	// =================================================================
	var grpMove = FRWidget.GroupBox('Move');

	// -- Method toggles (radio group)
	var methods = [
		['shift_smart',       'SMART', 'Smart shift (on-curve + BCPs)'],
		['shift_dumb',        'MOVE',  'Simple shift'],
		['shift_interpolate', 'LERP',  'Interpolated shift'],
	];

	for (var m = 0; m < methods.length; m++) {
		(function(icon, method, tip) {
			var btn = FRWidget.ToggleButton(null, {
				icon: icon, tooltip: tip,
				group: 'move-method',
				active: method === 'SMART',
				onChange: function() { inst._moveMethod = method; }
			});
			grpMove.addWidget(btn);
		})(methods[m][0], methods[m][1], methods[m][2]);
	}

	// -- X/Y inputs and arrow buttons
	var moveGrid = document.createElement('div');
	moveGrid.className = 'np-move-grid';

	var lblX = document.createElement('span');
	lblX.className = 'np-move-grid__label tri';
	lblX.textContent = 'width_x';

	var spnX = FRWidget.SpinBox({
		min: -999, max: 999, value: 1, step: 1,
		tooltip: 'Horizontal shift value'
	});

	var btnLeft = FRWidget.Button(null, {
		icon: 'arrow_left', tooltip: 'Shift left',
		onClick: function() {
			var dx = spnX.getValue() || 1;
			_runNpa('npa("npa_move", ' + (-dx) + ', 0, "' + inst._moveMethod + '")');
		}
	});

	var btnRight = FRWidget.Button(null, {
		icon: 'arrow_right', tooltip: 'Shift right',
		onClick: function() {
			var dx = spnX.getValue() || 1;
			_runNpa('npa("npa_move", ' + dx + ', 0, "' + inst._moveMethod + '")');
		}
	});

	var lblY = document.createElement('span');
	lblY.className = 'np-move-grid__label tri';
	lblY.textContent = 'width_y';

	var spnY = FRWidget.SpinBox({
		min: -999, max: 999, value: 1, step: 1,
		tooltip: 'Vertical shift value'
	});

	var btnUp = FRWidget.Button(null, {
		icon: 'arrow_up', tooltip: 'Shift up',
		onClick: function() {
			var dy = spnY.getValue() || 1;
			_runNpa('npa("npa_move", 0, ' + dy + ', "' + inst._moveMethod + '")');
		}
	});

	var btnDown = FRWidget.Button(null, {
		icon: 'arrow_down', tooltip: 'Shift down',
		onClick: function() {
			var dy = spnY.getValue() || 1;
			_runNpa('npa("npa_move", 0, ' + (-dy) + ', "' + inst._moveMethod + '")');
		}
	});

	moveGrid.appendChild(lblX);
	moveGrid.appendChild(spnX);
	moveGrid.appendChild(btnLeft);
	moveGrid.appendChild(btnRight);
	moveGrid.appendChild(lblY);
	moveGrid.appendChild(spnY);
	moveGrid.appendChild(btnUp);
	moveGrid.appendChild(btnDown);

	grpMove.content.appendChild(moveGrid);

	content.appendChild(grpMove);

	// =================================================================
	// Finalize
	// =================================================================
	containerEl.appendChild(content);

	// -- Public methods
	inst.update = function() {};

	inst.onMainWindowEvent = function(eventType) {};

	return inst;
};
