// ===================================================================
// FontRig — Contour Panel (Multi-Instance)
// ===================================================================
// Contour manipulation panel based on TypeRig GUI Contour panel.
// Uses FRWidget factories for all UI elements.
// Python logic lives in node_panel_actions.py; JS calls actions by
// name via the `npa("action_name", ...)` bridge dispatcher.
//
// Sections:
//   1. Winding + Start point
//   2. Contour ordering
//   3. Close
//   4. Drawing tools (square / circle / lines / hobby)
//   5. Alignment (mode chips + group A/B + 6 directions + distribute)
//   6. Flip H / Flip V
//   7. Transform (scale / translate / rotate / skew + origin)
// ===================================================================
'use strict';

FontRig.ContourPanel = {};

// =====================================================================
// Helper: run a Python npa() action via pyBridge
// =====================================================================
function _runNpa(call) {
	if (!FontRig.pyBridge || !FontRig.pyBridge.ready) {
		console.warn('[ContourPanel] Python not ready');
		return;
	}
	if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();
	FontRig.pyBridge.run(call);
}

// Run without pushing undo (for capture/state-only actions)
function _runNpaNoUndo(call) {
	if (!FontRig.pyBridge || !FontRig.pyBridge.ready) return null;
	FontRig.pyBridge.syncToPython();
	try {
		return FontRig.pyBridge.pyodide.runPython(call);
	} catch (e) {
		console.warn('[ContourPanel] call failed:', call, e);
		return null;
	}
}

// =====================================================================
// Mount: create a Contour panel instance
// =====================================================================
FontRig.ContourPanel.mount = function(containerEl, ctx) {
	if (!containerEl) return null;

	var inst = {
		_containerEl: containerEl,
		_alignMode: 'CC',
		_xformOrigin: 'C',
	};

	containerEl.innerHTML = '';

	var content = document.createElement('div');
	content.className = 'contour-panel';

	// =================================================================
	// 1. WINDING + START POINT
	// =================================================================
	var grp1 = FRWidget.GroupBox('Winding & Start');

	grp1.addWidget(FRWidget.Button(null, {
		icon: 'contour_cw_alt',
		tooltip: 'Set clockwise winding (TrueType)',
		onClick: function() { _runNpa('npa("npa_contour_winding", False)'); }
	}));

	grp1.addWidget(FRWidget.Button(null, {
		icon: 'contour_ccw_alt',
		tooltip: 'Set counter-clockwise winding (PostScript)',
		onClick: function() { _runNpa('npa("npa_contour_winding", True)'); }
	}));

	grp1.addWidget(FRWidget.Button(null, {
		icon: 'contour_reverse',
		tooltip: 'Reverse contour direction',
		onClick: function() { _runNpa('npa("npa_contour_reverse")'); }
	}));

	grp1.addWidget(FRWidget.Button(null, {
		icon: 'node_start',
		tooltip: 'Set start node to selection',
		onClick: function() { _runNpa('npa("npa_contour_start_at_selection")'); }
	}));

	grp1.addWidget(FRWidget.Button(null, {
		icon: 'node_next',
		tooltip: 'Move start to next node',
		onClick: function() { _runNpa('npa("npa_contour_start_next", True)'); }
	}));

	grp1.addWidget(FRWidget.Button(null, {
		icon: 'node_previous',
		tooltip: 'Move start to previous node',
		onClick: function() { _runNpa('npa("npa_contour_start_next", False)'); }
	}));

	grp1.addWidget(FRWidget.Button(null, {
		icon: 'node_bottom_left',
		tooltip: 'Set start to bottom-left',
		onClick: function() { _runNpa('npa("npa_contour_smart_start", (0, 0))'); }
	}));

	grp1.addWidget(FRWidget.Button(null, {
		icon: 'node_top_left',
		tooltip: 'Set start to top-left',
		onClick: function() { _runNpa('npa("npa_contour_smart_start", (0, 1))'); }
	}));

	grp1.addWidget(FRWidget.Button(null, {
		icon: 'node_bottom_right',
		tooltip: 'Set start to bottom-right',
		onClick: function() { _runNpa('npa("npa_contour_smart_start", (1, 0))'); }
	}));

	grp1.addWidget(FRWidget.Button(null, {
		icon: 'node_top_right',
		tooltip: 'Set start to top-right',
		onClick: function() { _runNpa('npa("npa_contour_smart_start", (1, 1))'); }
	}));

	content.appendChild(grp1);

	// =================================================================
	// 2. CONTOUR ORDERING
	// =================================================================
	var grp2 = FRWidget.GroupBox('Contour Order');

	// (icon, tooltip, axis, mode, reverse) — axis 0=X, 1=Y
	var orderButtons = [
		['contour_sort_y',     'Reorder contours top to bottom',  1, 'TL', true],
		['contour_sort_x',     'Reorder contours left to right',  0, 'BL', false],
		['contour_sort_y_rev', 'Reorder contours bottom to top',  1, 'BL', false],
		['contour_sort_x_rev', 'Reorder contours right to left',  0, 'BR', true],
	];
	for (var i = 0; i < orderButtons.length; i++) {
		(function(icon, tip, axis, mode, rev) {
			grp2.addWidget(FRWidget.Button(null, {
				icon: icon, tooltip: tip,
				onClick: function() {
					_runNpa('npa("npa_contour_order", ' + axis + ', "' + mode + '", ' + (rev ? 'True' : 'False') + ')');
				}
			}));
		})(orderButtons[i][0], orderButtons[i][1], orderButtons[i][2], orderButtons[i][3], orderButtons[i][4]);
	}

	content.appendChild(grp2);

	// =================================================================
	// 3. CLOSE
	// =================================================================
	var grp3 = FRWidget.GroupBox('Contour');

	grp3.addWidget(FRWidget.Button(null, {
		icon: 'contour_close',
		tooltip: 'Close selected open contours',
		onClick: function() { _runNpa('npa("npa_contour_close")'); }
	}));

	content.appendChild(grp3);

	// =================================================================
	// 3.5 CUT / STROKE SEPARATE / MEDIAL AXIS
	// =================================================================
	var grpCut = FRWidget.GroupBox('Cut');

	grpCut.addWidget(FRWidget.Button(null, {
		icon: 'contour_cut',
		tooltip: 'Slice selected contours.',
		onClick: function() { _runNpa('npa("npa_contour_slice")'); }
	}));

	grpCut.addWidget(FRWidget.Button(null, {
		icon: 'cut_stem_overlap',
		tooltip: 'Cut contour, then auto overlap align both neighbor pairs at the cut junction.',
		onClick: function() { _runNpa('npa("npa_contour_slice_align")'); }
	}));

	grpCut.addWidget(FRWidget.Button(null, {
		icon: 'auto_stem_overlap',
		tooltip: 'Auto overlap align — select 4 nodes (2 neighbor pairs) at a cut junction.',
		onClick: function() { _runNpa('npa("npa_contour_auto_align")'); }
	}));

	grpCut.addWidget(FRWidget.Button(null, {
		icon: 'cutter_auto',
		tooltip: 'Stroke Separate (V3) — split stroke glyph into components via MAT analysis.',
		onClick: function() { _runNpa('npa("npa_stroke_separate")'); }
	}));

	grpCut.addWidget(FRWidget.Button(null, {
		icon: 'centerline',
		tooltip: 'Medial Axis Extract — emit a clean medial-axis skeleton as a new shape.',
		onClick: function() { _runNpa('npa("npa_mat_extract")'); }
	}));

	content.appendChild(grpCut);

	// =================================================================
	// 4. DRAWING TOOLS
	// =================================================================
	var grpDraw = FRWidget.GroupBox('Drawing');

	grpDraw.addWidget(FRWidget.Button(null, {
		icon: 'draw_square_2p',
		tooltip: 'Draw square: two points form a diagonal',
		onClick: function() { _runNpa('npa("npa_draw_square", 0)'); }
	}));

	grpDraw.addWidget(FRWidget.Button(null, {
		icon: 'draw_square_2m',
		tooltip: 'Draw square: two points are mid-points of adjacent sides',
		onClick: function() { _runNpa('npa("npa_draw_square", 1)'); }
	}));

	grpDraw.addWidget(FRWidget.Button(null, {
		icon: 'draw_circle_2p',
		tooltip: 'Draw circle: two points form the diameter',
		onClick: function() { _runNpa('npa("npa_draw_circle", 0)'); }
	}));

	grpDraw.addWidget(FRWidget.Button(null, {
		icon: 'draw_circle_3p',
		tooltip: 'Draw circle: three points lie on the circle',
		onClick: function() { _runNpa('npa("npa_draw_circle", 1)'); }
	}));

	grpDraw.addWidget(FRWidget.Button(null, {
		icon: 'draw_lines',
		tooltip: 'Trace selected nodes as line segments',
		onClick: function() { _runNpa('npa("npa_trace_nodes", 1, True)'); }
	}));

	grpDraw.addWidget(FRWidget.Button(null, {
		icon: 'draw_hobby',
		tooltip: 'Trace selected nodes as Hobby splines',
		onClick: function() { _runNpa('npa("npa_trace_nodes", 2, True)'); }
	}));

	content.appendChild(grpDraw);

	// =================================================================
	// 5. ALIGNMENT
	// =================================================================
	var grpAlign = FRWidget.GroupBox('Alignment');

	// -- Mode chips (radio): CL / CC / CN / AB
	var modeChips = [
		['align_contour_to_layer',   'CL', 'Align selected contours to the layer bounding box'],
		['align_contour_to_contour', 'CC', 'Align selected contours to each other'],
		['align_contour_to_node',    'CN', 'Align selected contours to a selected on-curve node\n(first selected contour hosts the target node)'],
		['align_group_to_group',     'AB', 'Align contour group A to group B'],
	];
	for (var m = 0; m < modeChips.length; m++) {
		(function(icon, code, tip) {
			var btn = FRWidget.ToggleButton(null, {
				icon: icon, tooltip: tip,
				group: 'contour-align-mode',
				active: code === inst._alignMode,
				onChange: function() { inst._alignMode = code; }
			});
			grpAlign.addWidget(btn);
		})(modeChips[m][0], modeChips[m][1], modeChips[m][2]);
	}

	// -- Group A / B capture chips (independent toggles)
	var btnGroupA = FRWidget.ToggleButton('A', {
		tooltip: 'Capture currently selected contours as group A',
		onChange: function(active) {
			if (active) _runNpaNoUndo('npa("npa_capture_group_A")');
		}
	});
	grpAlign.addWidget(btnGroupA);

	var btnGroupB = FRWidget.ToggleButton('B', {
		tooltip: 'Capture currently selected contours as group B',
		onChange: function(active) {
			if (active) _runNpaNoUndo('npa("npa_capture_group_B")');
		}
	});
	grpAlign.addWidget(btnGroupB);

	// -- Direction buttons
	// (icon, tooltip, align_x, align_y)
	var dirButtons = [
		['contour_align_left',              'Align left',              'L', 'X'],
		['contour_align_center_horizontal', 'Align horizontal centre', 'C', 'X'],
		['contour_align_right',             'Align right',             'R', 'X'],
		['contour_align_bottom',            'Align bottom',            'K', 'B'],
		['contour_align_center_vertical',   'Align vertical centre',   'K', 'E'],
		['contour_align_top',               'Align top',               'K', 'T'],
	];
	for (var d = 0; d < dirButtons.length; d++) {
		(function(icon, tip, ax, ay) {
			grpAlign.addWidget(FRWidget.Button(null, {
				icon: icon, tooltip: tip,
				onClick: function() {
					_runNpa('npa("npa_contour_align", "' + ax + '", "' + ay + '", "' + inst._alignMode + '")');
				}
			}));
		})(dirButtons[d][0], dirButtons[d][1], dirButtons[d][2], dirButtons[d][3]);
	}

	// -- Distribute
	grpAlign.addWidget(FRWidget.Button(null, {
		icon: 'contour_distribute_h',
		tooltip: 'Distribute contours evenly horizontally',
		onClick: function() { _runNpa('npa("npa_contour_distribute_h")'); }
	}));

	grpAlign.addWidget(FRWidget.Button(null, {
		icon: 'contour_distribute_v',
		tooltip: 'Distribute contours evenly vertically',
		onClick: function() { _runNpa('npa("npa_contour_distribute_v")'); }
	}));

	content.appendChild(grpAlign);

	// =================================================================
	// 6. FLIP
	// =================================================================
	var grpFlip = FRWidget.GroupBox('Flip');

	grpFlip.addWidget(FRWidget.Button(null, {
		icon: 'flip_horizontal',
		tooltip: 'Flip horizontally',
		onClick: function() { _runNpa('npa("npa_contour_flip", True)'); }
	}));

	grpFlip.addWidget(FRWidget.Button(null, {
		icon: 'flip_vertical',
		tooltip: 'Flip vertically',
		onClick: function() { _runNpa('npa("npa_contour_flip", False)'); }
	}));

	content.appendChild(grpFlip);

	// =================================================================
	// 7. TRANSFORM
	// =================================================================
	var grpXform = FRWidget.GroupBox('Transform');

	// 6 fields: scale_x / scale_y / skew | translate_x / translate_y / rotate
	// Each cell: icon-button label + DoubleSpinBox
	var xformFields = [
		['scale_x',     'Scale X (%)',         100.0],
		['scale_y',     'Scale Y (%)',         100.0],
		['skew',        'Skew / slant (deg)',    0.0],
		['translate_x', 'Translate X (units)',   0.0],
		['translate_y', 'Translate Y (units)',   0.0],
		['rotate',      'Rotate (deg)',          0.0],
	];
	var xformInputs = {};
	for (var f = 0; f < xformFields.length; f++) {
		(function(key, tip, def) {
			var cell = document.createElement('div');
			cell.style.display = 'flex';
			cell.style.alignItems = 'center';
			cell.style.gap = '2px';

			var lbl = FRWidget.Button(null, { icon: key, tooltip: tip });
			lbl.disabled = true;
			lbl.style.opacity = '1';
			cell.appendChild(lbl);

			var spn = FRWidget.DoubleSpinBox({
				min: -10000, max: 10000, value: def, step: 1, decimals: 2,
				tooltip: tip
			});
			spn.style.width = '64px';
			cell.appendChild(spn);

			grpXform.content.appendChild(cell);
			xformInputs[key] = spn;
		})(xformFields[f][0], xformFields[f][1], xformFields[f][2]);
	}

	// Origin chips (radio)
	var originChips = [
		['node_align_bottom_left', 'O',  'Transform at absolute origin (0, 0)'],
		['node_bottom_left',       'BL', 'Transform at bottom-left corner'],
		['node_bottom_right',      'BR', 'Transform at bottom-right corner'],
		['node_top_left',          'TL', 'Transform at top-left corner'],
		['node_top_right',         'TR', 'Transform at top-right corner'],
		['node_center',            'C',  'Transform at centre'],
	];
	for (var o = 0; o < originChips.length; o++) {
		(function(icon, code, tip) {
			grpXform.addWidget(FRWidget.ToggleButton(null, {
				icon: icon, tooltip: tip,
				group: 'contour-xform-origin',
				active: code === inst._xformOrigin,
				onChange: function() { inst._xformOrigin = code; }
			}));
		})(originChips[o][0], originChips[o][1], originChips[o][2]);
	}

	// Reset
	grpXform.addWidget(FRWidget.Button(null, {
		icon: 'refresh', tooltip: 'Reset transform fields',
		onClick: function() {
			var defaults = { scale_x: 100, scale_y: 100, skew: 0,
			                 translate_x: 0, translate_y: 0, rotate: 0 };
			for (var k in defaults) {
				if (xformInputs[k]) xformInputs[k].setValue(defaults[k]);
			}
		}
	}));

	// Apply
	grpXform.addWidget(FRWidget.Button(null, {
		icon: 'action_play', tooltip: 'Apply transform to selected contours',
		onClick: function() {
			function v(k, def) {
				var x = xformInputs[k] ? xformInputs[k].getValue() : def;
				return (typeof x === 'number' && !isNaN(x)) ? x : def;
			}
			// Signature: (scale_x, scale_y, translate_x, translate_y, rotate, skew_x, skew_y, origin)
			var args = [
				v('scale_x', 100), v('scale_y', 100),
				v('translate_x', 0), v('translate_y', 0),
				v('rotate', 0),
				v('skew', 0), 0,
				'"' + inst._xformOrigin + '"'
			];
			_runNpa('npa("npa_contour_transform", ' + args.join(', ') + ')');
		}
	}));

	content.appendChild(grpXform);

	// =================================================================
	// Finalize
	// =================================================================
	containerEl.appendChild(content);

	inst.update = function() {};
	inst.onMainWindowEvent = function(eventType) {};

	return inst;
};
