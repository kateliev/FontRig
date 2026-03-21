// ===================================================================
// FontRig — Node Panel (Multi-Instance)
// ===================================================================
// Node manipulation panel based on TypeRig GUI Node panel.
// Operates via Pyodide bridge calling NodeActions from
// typerig.core.actions.node-actions on all scope layers.
//
// Multi-layer: every action iterates scope_layers and applies
// the same operation (using mirrored selection indices) to each.
// ===================================================================
'use strict';

FontRig.NodePanel = {};

// -- Python code templates for multi-layer node actions ----------------
// Each template is a function returning a Python code string.
// All templates iterate scope_layers via the _node_action helper.
var _pyNodeAction = [
	'def _node_action(fn):',
	'\t"""Run fn(layer, contour, selected_indices) on all scope layers."""',
	'\tfor layer_name in scope_layers:',
	'\t\tlayer = glyph.layer(layer_name)',
	'\t\tif layer is None: continue',
	'\t\tfor shape in layer.shapes:',
	'\t\t\tfor contour in shape.contours:',
	'\t\t\t\tidx = [i for i, n in enumerate(contour.data) if n.selected]',
	'\t\t\t\tif idx:',
	'\t\t\t\t\tfn(layer, contour, idx)',
].join('\n');

var _pyCornerAction = [
	'def _corner_action(fn):',
	'\t"""Run fn(node) on each selected on-curve node across scope layers."""',
	'\tfor layer_name in scope_layers:',
	'\t\tlayer = glyph.layer(layer_name)',
	'\t\tif layer is None: continue',
	'\t\tfor shape in layer.shapes:',
	'\t\t\tfor contour in shape.contours:',
	'\t\t\t\tfor node in contour.data:',
	'\t\t\t\t\tif node.selected and node.is_on:',
	'\t\t\t\t\t\tfn(node)',
].join('\n');

var _pyAlignAction = [
	'def _align_action(mode):',
	'\t"""Align selected nodes using NodeActions.nodes_align on all scope layers."""',
	'\tfor layer_name in scope_layers:',
	'\t\tlayer = glyph.layer(layer_name)',
	'\t\tif layer is None: continue',
	'\t\tnodes = []',
	'\t\tfor shape in layer.shapes:',
	'\t\t\tfor contour in shape.contours:',
	'\t\t\t\tfor node in contour.data:',
	'\t\t\t\t\tif node.selected:',
	'\t\t\t\t\t\tnodes.append(node)',
	'\t\tif nodes:',
	'\t\t\tNodeActions.nodes_align(nodes, mode)',
].join('\n');

var _pyMoveAction = [
	'def _move_action(dx, dy, method, angle=0., slope=None):',
	'\t"""Move selected nodes using NodeActions.nodes_move on all scope layers."""',
	'\tfor layer_name in scope_layers:',
	'\t\tlayer = glyph.layer(layer_name)',
	'\t\tif layer is None: continue',
	'\t\tnodes = []',
	'\t\tfor shape in layer.shapes:',
	'\t\t\tfor contour in shape.contours:',
	'\t\t\t\tfor node in contour.data:',
	'\t\t\t\t\tif node.selected:',
	'\t\t\t\t\t\tnodes.append(node)',
	'\t\tif nodes:',
	'\t\t\tNodeActions.nodes_move(nodes, dx, dy, method, angle, slope)',
].join('\n');

var _pySlopeAction = [
	'def _slope_action(mode):',
	'\t"""Apply slope to selected nodes on all scope layers."""',
	'\tfor layer_name in scope_layers:',
	'\t\tlayer = glyph.layer(layer_name)',
	'\t\tif layer is None: continue',
	'\t\tnodes = []',
	'\t\tfor shape in layer.shapes:',
	'\t\t\tfor contour in shape.contours:',
	'\t\t\t\tfor node in contour.data:',
	'\t\t\t\t\tif node.selected:',
	'\t\t\t\t\t\tnodes.append(node)',
	'\t\tif len(nodes) >= 2:',
	'\t\t\tNodeActions.slope_apply(nodes, _slope_bank, mode)',
].join('\n');

// =====================================================================
// Helper: run Python action via pyBridge
// =====================================================================
function _runNodeAction(code) {
	if (!FontRig.pyBridge || !FontRig.pyBridge.ready) {
		console.warn('[NodePanel] Python not ready');
		return;
	}
	if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();
	FontRig.pyBridge.run(code);
}

// =====================================================================
// Helper: create an icon button
// =====================================================================
function _iconBtn(icon, tooltip, extraClass) {
	var btn = document.createElement('button');
	btn.className = 'np-btn' + (extraClass ? ' ' + extraClass : '');
	btn.title = tooltip || '';
	btn.innerHTML = '<span class="tri">' + icon + '</span>';
	return btn;
}

// =====================================================================
// Helper: create a toggle button
// =====================================================================
function _toggleBtn(icon, tooltip, group) {
	var btn = _iconBtn(icon, tooltip, 'np-toggle');
	btn.addEventListener('click', function() {
		if (group) {
			// Radio behavior within group
			var siblings = btn.parentElement.querySelectorAll('.np-toggle[data-group="' + group + '"]');
			for (var i = 0; i < siblings.length; i++) {
				siblings[i].classList.remove('active');
			}
		}
		btn.classList.toggle('active');
	});
	if (group) btn.setAttribute('data-group', group);
	return btn;
}

// =====================================================================
// Helper: create a spin input (label + number input + button)
// =====================================================================
function _spinInput(icon, tooltip, min, max, value, step) {
	var wrap = document.createElement('div');
	wrap.className = 'np-spin';

	var input = document.createElement('input');
	input.type = 'number';
	input.className = 'np-spin__input';
	input.min = min;
	input.max = max;
	input.value = value;
	input.step = step || 1;
	input.title = tooltip + ' value';

	var btn = _iconBtn(icon, tooltip);

	wrap.appendChild(input);
	wrap.appendChild(btn);

	wrap._input = input;
	wrap._btn = btn;
	return wrap;
}

// =====================================================================
// Helper: create a group box with title
// =====================================================================
function _groupBox(label) {
	var box = document.createElement('div');
	box.className = 'np-group';
	if (label) {
		var lbl = document.createElement('div');
		lbl.className = 'np-group__label';
		lbl.textContent = label;
		box.appendChild(lbl);
	}
	var content = document.createElement('div');
	content.className = 'np-group__content';
	box.appendChild(content);
	box._content = content;
	return box;
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
	var grpNode = _groupBox('Node');
	var flow = grpNode._content;

	// Insert node (t=0.5)
	var btnInsert = _iconBtn('node_add', 'Insert node at midpoint');
	btnInsert.addEventListener('click', function() {
		_runNodeAction(_pyNodeAction + '\n_node_action(lambda l, c, idx: NodeActions.node_insert(c, idx, 0.5))');
	});
	flow.appendChild(btnInsert);

	// Insert at extremes
	var btnExtreme = _iconBtn('node_add_extreme_alt', 'Insert node at extremes');
	btnExtreme.addEventListener('click', function() {
		_runNodeAction(_pyNodeAction + '\n_node_action(lambda l, c, idx: NodeActions.node_insert_at_extremes(c, idx))');
	});
	flow.appendChild(btnExtreme);

	// Remove node
	var btnRemove = _iconBtn('node_remove', 'Remove selected nodes');
	btnRemove.addEventListener('click', function() {
		_runNodeAction(_pyNodeAction + '\n_node_action(lambda l, c, idx: NodeActions.node_remove(c, idx))');
	});
	flow.appendChild(btnRemove);

	// Set smooth
	var btnSmooth = _iconBtn('node_smooth', 'Set node smooth');
	btnSmooth.addEventListener('click', function() {
		_runNodeAction(
			'for layer_name in scope_layers:\n' +
			'\tlayer = glyph.layer(layer_name)\n' +
			'\tif layer is None: continue\n' +
			'\tnodes = [n for s in layer.shapes for c in s.contours for n in c.data if n.selected]\n' +
			'\tif nodes: NodeActions.node_set_smooth(nodes, True)\n'
		);
	});
	flow.appendChild(btnSmooth);

	// Set sharp
	var btnSharp = _iconBtn('node_sharp', 'Set node sharp');
	btnSharp.addEventListener('click', function() {
		_runNodeAction(
			'for layer_name in scope_layers:\n' +
			'\tlayer = glyph.layer(layer_name)\n' +
			'\tif layer is None: continue\n' +
			'\tnodes = [n for s in layer.shapes for c in s.contours for n in c.data if n.selected]\n' +
			'\tif nodes: NodeActions.node_set_smooth(nodes, False)\n'
		);
	});
	flow.appendChild(btnSharp);

	// Round coordinates
	var btnRound = _iconBtn('node_round', 'Round coordinates (ceil)');
	btnRound.addEventListener('click', function() {
		_runNodeAction(
			'for layer_name in scope_layers:\n' +
			'\tlayer = glyph.layer(layer_name)\n' +
			'\tif layer is None: continue\n' +
			'\tnodes = [n for s in layer.shapes for c in s.contours for n in c.data if n.selected]\n' +
			'\tif nodes: NodeActions.node_round_coordinates(nodes, True)\n'
		);
	});
	flow.appendChild(btnRound);

	content.appendChild(grpNode);

	// =================================================================
	// 2. CORNER TOOLS
	// =================================================================
	var grpCorner = _groupBox('Corner');
	var flowCorner = grpCorner._content;

	// Mitre
	var spnMitre = _spinInput('corner_mitre', 'Corner Mitre', 0, 300, 5, 1);
	spnMitre._btn.addEventListener('click', function() {
		var val = parseFloat(spnMitre._input.value) || 5;
		_runNodeAction(_pyCornerAction + '\n_corner_action(lambda n: NodeActions.corner_mitre(n, ' + val + '))');
	});
	flowCorner.appendChild(spnMitre);

	// Round
	var spnRound = _spinInput('corner_round', 'Corner Round', 0, 300, 5, 1);
	spnRound._btn.addEventListener('click', function() {
		var val = parseFloat(spnRound._input.value) || 5;
		_runNodeAction(_pyCornerAction + '\n_corner_action(lambda n: NodeActions.corner_round(n, ' + val + '))');
	});
	flowCorner.appendChild(spnRound);

	// Loop
	var spnLoop = _spinInput('corner_loop', 'Corner Loop', 0, 300, 20, 1);
	spnLoop._btn.addEventListener('click', function() {
		var val = parseFloat(spnLoop._input.value) || 20;
		_runNodeAction(_pyCornerAction + '\n_corner_action(lambda n: NodeActions.corner_loop(n, ' + val + '))');
	});
	flowCorner.appendChild(spnLoop);

	// Trap
	var btnTrap = _iconBtn('corner_trap', 'Create ink trap');
	btnTrap.addEventListener('click', function() {
		_runNodeAction(_pyCornerAction + '\n_corner_action(lambda n: NodeActions.corner_trap(n))');
	});
	flowCorner.appendChild(btnTrap);

	// Rebuild
	var btnRebuild = _iconBtn('corner_rebuild', 'Rebuild corner');
	btnRebuild.addEventListener('click', function() {
		_runNodeAction(
			_pyNodeAction + '\n_node_action(lambda l, c, idx: NodeActions.corner_rebuild(c, idx))'
		);
	});
	flowCorner.appendChild(btnRebuild);

	content.appendChild(grpCorner);

	// =================================================================
	// 3. ALIGN TOOLS
	// =================================================================
	var grpAlign = _groupBox('Align');
	var flowAlign = grpAlign._content;

	// Pick target node for alignment
	var btnTarget = _toggleBtn('node_target', 'Pick target node for alignment');
	btnTarget.addEventListener('click', function() {
		if (btnTarget.classList.contains('active')) {
			// Store target: midpoint of selection on active layer
			if (!FontRig.pyBridge || !FontRig.pyBridge.ready) return;
			FontRig.pyBridge.syncToPython();
			try {
				FontRig.pyBridge.pyodide.runPython(
					'_sel = [n for s in glyph.layer(scope_layers[0] if scope_layers else None).shapes for c in s.contours for n in c.data if n.selected]\n' +
					'if _sel:\n' +
					'    from typerig.core.objects.point import Point\n' +
					'    _tx = sum(n.x for n in _sel) / len(_sel)\n' +
					'    _ty = sum(n.y for n in _sel) / len(_sel)\n' +
					'    _align_target = Point(_tx, _ty)\n' +
					'else:\n' +
					'    _align_target = None\n' +
					'del _sel\n'
				);
				inst._targetSet = true;
			} catch (e) {
				console.warn('[NodePanel] target set failed:', e);
				inst._targetSet = false;
			}
		} else {
			inst._targetSet = false;
			if (FontRig.pyBridge && FontRig.pyBridge.ready) {
				try { FontRig.pyBridge.pyodide.runPython('_align_target = None'); } catch(_) {}
			}
		}
	});
	flowAlign.appendChild(btnTarget);

	// Collapse to target
	var btnCollapse = _iconBtn('node_target_collapse', 'Collapse selected nodes to target');
	btnCollapse.addEventListener('click', function() {
		if (!inst._targetSet) return;
		_runNodeAction(
			'if _align_target is not None:\n' +
			'    for layer_name in scope_layers:\n' +
			'        layer = glyph.layer(layer_name)\n' +
			'        if layer is None: continue\n' +
			'        for s in layer.shapes:\n' +
			'            for c in s.contours:\n' +
			'                for n in c.data:\n' +
			'                    if n.selected:\n' +
			'                        n.x = _align_target.x\n' +
			'                        n.y = _align_target.y\n'
		);
	});
	flowAlign.appendChild(btnCollapse);

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
			var btn = _iconBtn(icon, tip);
			btn.addEventListener('click', function() {
				_runNodeAction(_pyAlignAction + '\n_align_action("' + mode + '")');
			});
			flowAlign.appendChild(btn);
		})(alignModes[i][0], alignModes[i][1], alignModes[i][2]);
	}

	content.appendChild(grpAlign);

	// =================================================================
	// 4. SLOPE TOOLS
	// =================================================================
	var grpSlope = _groupBox('Slope');
	var flowSlope = grpSlope._content;

	// Copy slope
	var btnSlopeCopy = _toggleBtn('slope_copy', 'Copy slope between selected nodes');
	btnSlopeCopy.addEventListener('click', function() {
		if (btnSlopeCopy.classList.contains('active')) {
			// Copy slope from current selection
			if (!FontRig.pyBridge || !FontRig.pyBridge.ready) return;
			FontRig.pyBridge.syncToPython();
			try {
				var result = FontRig.pyBridge.pyodide.runPython(
					'_slope_val = 0\n' +
					'_active_lyr = glyph.layer(scope_layers[0] if scope_layers else None)\n' +
					'if _active_lyr:\n' +
					'\t_sel = [n for s in _active_lyr.shapes for c in s.contours for n in c.data if n.selected and n.is_on]\n' +
					'\tif len(_sel) >= 2:\n' +
					'\t\t_slope_val = NodeActions.slope_from_nodes(_sel[0], _sel[-1])\n' +
					'_slope_val'
				);
				inst._slopeBank = result;
			} catch (e) {
				console.warn('[NodePanel] slope copy failed:', e);
			}
		} else {
			inst._slopeBank = 0;
		}
	});
	flowSlope.appendChild(btnSlopeCopy);

	// Paste slope (4 modes)
	var slopeModes = [
		['slope_paste_min',      [false, false], 'Paste slope (pivot min Y)'],
		['slope_paste_max',      [true,  false], 'Paste slope (pivot max Y)'],
		['slope_paste_min_flip', [false, true],  'Paste flipped slope (pivot min Y)'],
		['slope_paste_max_flip', [true,  true],  'Paste flipped slope (pivot max Y)'],
	];

	for (var s = 0; s < slopeModes.length; s++) {
		(function(icon, mode, tip) {
			var btn = _iconBtn(icon, tip);
			btn.addEventListener('click', function() {
				_runNodeAction(
					'_slope_bank = ' + inst._slopeBank + '\n' +
					_pySlopeAction + '\n_slope_action((' + mode[0] + ', ' + mode[1] + '))'
				);
			});
			flowSlope.appendChild(btn);
		})(slopeModes[s][0], slopeModes[s][1], slopeModes[s][2]);
	}

	content.appendChild(grpSlope);

	// =================================================================
	// 5. MOVE TOOLS
	// =================================================================
	var grpMove = _groupBox('Move');
	var flowMove = grpMove._content;

	// -- Method toggles
	var methodRow = document.createElement('div');
	methodRow.className = 'np-group__content';

	var methods = [
		['shift_smart',       'SMART', 'Smart shift (on-curve + BCPs)'],
		['shift_dumb',        'MOVE',  'Simple shift'],
		['shift_interpolate', 'LERP',  'Interpolated shift'],
	];

	for (var m = 0; m < methods.length; m++) {
		(function(icon, method, tip) {
			var btn = _toggleBtn(icon, tip, 'move-method');
			if (method === 'SMART') btn.classList.add('active');
			btn.addEventListener('click', function() {
				inst._moveMethod = method;
			});
			methodRow.appendChild(btn);
		})(methods[m][0], methods[m][1], methods[m][2]);
	}
	flowMove.appendChild(methodRow);

	// -- X/Y inputs and arrow buttons
	var moveGrid = document.createElement('div');
	moveGrid.className = 'np-move-grid';

	var lblX = document.createElement('span');
	lblX.className = 'np-move-grid__label tri';
	lblX.textContent = 'width_x';

	var spnX = document.createElement('input');
	spnX.type = 'number';
	spnX.className = 'np-spin__input';
	spnX.min = -999;
	spnX.max = 999;
	spnX.value = 1;
	spnX.step = 1;
	spnX.title = 'Horizontal shift value';

	var btnLeft = _iconBtn('arrow_left', 'Shift left');
	btnLeft.addEventListener('click', function() {
		var dx = parseFloat(spnX.value) || 1;
		_runNodeAction(
			_pyMoveAction + '\n_move_action(' + (-dx) + ', 0, "' + inst._moveMethod + '")'
		);
	});

	var btnRight = _iconBtn('arrow_right', 'Shift right');
	btnRight.addEventListener('click', function() {
		var dx = parseFloat(spnX.value) || 1;
		_runNodeAction(
			_pyMoveAction + '\n_move_action(' + dx + ', 0, "' + inst._moveMethod + '")'
		);
	});

	var lblY = document.createElement('span');
	lblY.className = 'np-move-grid__label tri';
	lblY.textContent = 'width_y';

	var spnY = document.createElement('input');
	spnY.type = 'number';
	spnY.className = 'np-spin__input';
	spnY.min = -999;
	spnY.max = 999;
	spnY.value = 1;
	spnY.step = 1;
	spnY.title = 'Vertical shift value';

	var btnUp = _iconBtn('arrow_up', 'Shift up');
	btnUp.addEventListener('click', function() {
		var dy = parseFloat(spnY.value) || 1;
		_runNodeAction(
			_pyMoveAction + '\n_move_action(0, ' + dy + ', "' + inst._moveMethod + '")'
		);
	});

	var btnDown = _iconBtn('arrow_down', 'Shift down');
	btnDown.addEventListener('click', function() {
		var dy = parseFloat(spnY.value) || 1;
		_runNodeAction(
			_pyMoveAction + '\n_move_action(0, ' + (-dy) + ', "' + inst._moveMethod + '")'
		);
	});

	moveGrid.appendChild(lblX);
	moveGrid.appendChild(spnX);
	moveGrid.appendChild(btnLeft);
	moveGrid.appendChild(btnRight);
	moveGrid.appendChild(lblY);
	moveGrid.appendChild(spnY);
	moveGrid.appendChild(btnUp);
	moveGrid.appendChild(btnDown);

	flowMove.appendChild(moveGrid);

	content.appendChild(grpMove);

	// =================================================================
	// Finalize
	// =================================================================
	containerEl.appendChild(content);

	// -- Public methods
	inst.update = function() {
		// Nothing to refresh on tab switch for now
	};

	inst.onMainWindowEvent = function(eventType) {
		// Could react to glyph/font changes if needed
	};

	return inst;
};
