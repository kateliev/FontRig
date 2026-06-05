// ===================================================================
// FontRig — Delta Panel (Multi-Instance, Multi-Axis)
// ===================================================================
// Stem-driven interpolation engine. Mirrors the FL "Delta New" panel
// (which mirrors the original Delta Machine) — same icon tokens, same
// conceptual layout. Multi-axis: each axis owns its own input set and
// target list. Engine lives in Python (`delta_panel_actions.py`); JS
// owns the setup state and the UI.
//
// v1 scope (porting_guide §8): stems-mode targets only, no live
// sliders, no drag-drop (Add buttons + dropdowns instead), localStorage
// persistence keyed by font name. Dimensions-mode targets and the
// origin radio do round-trip through the engine; the slider section
// from the FL panel is deferred until we have a viable cheap-redraw
// path through Pyodide.
// ===================================================================
'use strict';

FontRig.DeltaPanel = {};

// =====================================================================
// Helpers — Python bridge
// =====================================================================
function _runNpa(call) {
	if (!FontRig.pyBridge || !FontRig.pyBridge.ready) {
		console.warn('[DeltaPanel] Python not ready'); return;
	}
	if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();
	FontRig.pyBridge.run(call);
}

function _runNpaNoUndo(call) {
	if (!FontRig.pyBridge || !FontRig.pyBridge.ready) return null;
	FontRig.pyBridge.syncToPython();
	try { return FontRig.pyBridge.pyodide.runPython(call); }
	catch (e) { console.warn('[DeltaPanel]', call, e); return null; }
}

// =====================================================================
// Helpers — setup model
// =====================================================================
FontRig.DeltaPanel._randHex = function() {
	var r = function() { return Math.floor(Math.random() * 256); };
	var h = function(v) { return ('0' + v.toString(16)).slice(-2).toUpperCase(); };
	return '#' + h(r()) + h(r()) + h(r());
};

// Status feedback — single persistent slot at the top of the panel,
// updated with action results. kind ∈ {'info','success','warning','error'}.
// ttlMs = 0 keeps it visible until next call. Default 4000.
FontRig.DeltaPanel._setStatus = function(inst, msg, kind, ttlMs) {
	if (!inst || !inst._messageEl) return;
	if (inst._messageTimer) {
		clearTimeout(inst._messageTimer);
		inst._messageTimer = null;
	}
	inst._messageEl.innerHTML = '';
	if (!msg) return;

	var b = document.createElement('div');
	b.className = 'dp-banner dp-banner--' + (kind || 'info');
	b.textContent = msg;
	inst._messageEl.appendChild(b);

	var ttl = ttlMs !== undefined ? ttlMs : 4000;
	if (ttl > 0) {
		inst._messageTimer = setTimeout(function() {
			b.classList.add('dp-banner--fading');
			setTimeout(function() {
				if (inst._messageEl && b.parentNode === inst._messageEl) {
					inst._messageEl.innerHTML = '';
				}
			}, 300);
		}, ttl);
	}
};

FontRig.DeltaPanel._freshSetup = function() {
	// Seed masters from the active glyph's layer list. Matches the
	// "current glyph's masters" workflow of FL Delta.
	var masters = [];
	var glyph = FontRig.state.glyphData;
	if (glyph && glyph.layers) {
		for (var i = 0; i < glyph.layers.length; i++) {
			masters.push({
				name: glyph.layers[i].name,
				vstem: '',
				hstem: '',
				color: FontRig.DeltaPanel._randHex(),
			});
		}
	}
	return {
		masters: masters,
		liveAxis: { name: 'Live', inputs: [] },
		axes: [],
		options: {
			metrics: true,
			anchors: true,
			extrapolate: true,
			selection: false,        // chk_selection-equivalent (per-contour)
			origin: 'BS',
			italic_angle: 0,
		},
	};
};

// Loaded setups from older versions may lack liveAxis or newer option
// keys — patch in place.
FontRig.DeltaPanel._migrateSetup = function(setup) {
	if (!setup) return setup;
	if (!setup.liveAxis) {
		setup.liveAxis = { name: 'Live', inputs: [] };
	}
	if (!Array.isArray(setup.liveAxis.inputs)) {
		setup.liveAxis.inputs = [];
	}
	if (!setup.options) setup.options = {};
	if (setup.options.selection === undefined) {
		setup.options.selection = false;
	}
	return setup;
};

FontRig.DeltaPanel._fontKey = function() {
	if (FontRig.font && FontRig.font.info && FontRig.font.info.family) {
		return 'fontrig.delta.setup.' + FontRig.font.info.family;
	}
	if (FontRig.state.glyphData && FontRig.state.glyphData.name) {
		return 'fontrig.delta.setup.glyph.' + FontRig.state.glyphData.name;
	}
	return 'fontrig.delta.setup.default';
};

FontRig.DeltaPanel._loadSetup = function() {
	try {
		var raw = localStorage.getItem(FontRig.DeltaPanel._fontKey());
		if (!raw) return null;
		var parsed = JSON.parse(raw);
		if (!parsed || !parsed.axes) return null;
		return FontRig.DeltaPanel._migrateSetup(parsed);
	} catch (e) { console.warn('[DeltaPanel] load failed', e); return null; }
};

FontRig.DeltaPanel._saveSetup = function(setup) {
	try {
		localStorage.setItem(FontRig.DeltaPanel._fontKey(), JSON.stringify(setup));
	} catch (e) { console.warn('[DeltaPanel] save failed', e); }
};

// =====================================================================
// UI — building the panel
// =====================================================================
FontRig.DeltaPanel.mount = function(containerEl, ctx) {
	if (!containerEl) return null;

	var inst = {
		_containerEl: containerEl,
		_setup: FontRig.DeltaPanel._loadSetup() || FontRig.DeltaPanel._freshSetup(),
	};

	containerEl.innerHTML = '';
	var root = document.createElement('div');
	root.className = 'delta-panel';
	containerEl.appendChild(root);

	// -- Header (font + glyph quick-status) ---------------------------
	var status = document.createElement('div');
	status.className = 'delta-status';
	status.style.fontSize = '11px';
	status.style.opacity = '0.7';
	status.style.padding = '4px 0';
	root.appendChild(status);

	function _refreshStatus() {
		var g = FontRig.state.glyphData;
		var n = g ? g.name : '(no glyph)';
		var f = (FontRig.font && FontRig.font.info)
			? FontRig.font.info.family + ' ' + (FontRig.font.info.style || '')
			: '(single glyph)';
		status.textContent = f + ' · ' + n;
	}

	// -- Status host (persistent banner slot) -------------------------
	// Lives above the tree; outlives _renderTree's innerHTML wipe.
	// Used by _setStatus() to show action feedback (Axis set, Save,
	// Undo done, etc.). Auto-fades after a few seconds.
	var messageEl = document.createElement('div');
	messageEl.className = 'dp-banner-host';
	root.appendChild(messageEl);
	inst._messageEl = messageEl;

	// -- Tree container ----------------------------------------------
	var tree = document.createElement('div');
	tree.className = 'delta-tree';
	root.appendChild(tree);

	// -- Action row (mirror FL icons one-to-one) ----------------------
	var grpActions = FRWidget.GroupBox('Actions');

	grpActions.addWidget(FRWidget.Button(null, {
		icon: 'action_play', tooltip: 'Execute delta — bake targets',
		onClick: function() { FontRig.DeltaPanel._actionBake(inst); }
	}));

	grpActions.addWidget(FRWidget.Button(null, {
		icon: 'stem_vertical_alt', tooltip: 'Measure V stem on selection',
		onClick: function() { FontRig.DeltaPanel._actionMeasureStem(inst, 'x'); }
	}));

	grpActions.addWidget(FRWidget.Button(null, {
		icon: 'stem_horizontal_alt', tooltip: 'Measure H stem on selection',
		onClick: function() { FontRig.DeltaPanel._actionMeasureStem(inst, 'y'); }
	}));

	grpActions.addWidget(FRWidget.Button(null, {
		icon: 'undo_snapshot', tooltip: 'Make undo snapshot',
		onClick: function() {
			if (typeof FontRig.pushUndo === 'function') {
				FontRig.pushUndo();
				FontRig.DeltaPanel._setStatus(inst,
					'Undo snapshot saved.', 'info');
			} else {
				FontRig.DeltaPanel._setStatus(inst,
					'Undo not available.', 'warning');
			}
		}
	}));

	grpActions.addWidget(FRWidget.Button(null, {
		icon: 'axis_set',
		tooltip: 'Set axis — validate setup, mark deltas ready',
		onClick: function() { FontRig.DeltaPanel._actionSetDelta(inst); }
	}));

	grpActions.addWidget(FRWidget.Button(null, {
		icon: 'axis_remove',
		tooltip: 'Clear delta — drop cached state (setup kept)',
		onClick: function() { FontRig.DeltaPanel._actionClearDelta(inst); }
	}));

	grpActions.addWidget(FRWidget.Button(null, {
		icon: 'refresh',
		tooltip: 'Reset all (re-seed masters from glyph)',
		onClick: function() { FontRig.DeltaPanel._actionResetAll(inst); }
	}));

	grpActions.addWidget(FRWidget.ToggleButton(null, {
		icon: 'value_controls',
		tooltip: 'Live sliders — drive the active layer via the Live Axis',
		active: !!inst._liveEnabled,
		onChange: function(active) {
			inst._liveEnabled = !!active;
			if (active) {
				// Snapshot the Live Axis now. From here on, slider
				// ticks read from the frozen snapshot (no cascade).
				FontRig.DeltaPanel._actionLiveSet(inst);
				// Reset sliders to neutral for the current active layer.
				var an = FontRig.state.activeLayer;
				if (an) {
					inst._liveState =
						FontRig.DeltaPanel._neutralLiveState(inst, an);
				}
				FontRig.DeltaPanel._startLayerWatcher(inst);
			} else {
				FontRig.DeltaPanel._stopLayerWatcher(inst);
				FontRig.DeltaPanel._actionLiveClear(inst);
			}
			FontRig.DeltaPanel._renderTree(inst, inst._tree);
		}
	}));

	grpActions.addWidget(FRWidget.Button(null, {
		icon: 'file_save', tooltip: 'Save setup as JSON',
		onClick: function() { FontRig.DeltaPanel._actionSaveJson(inst); }
	}));

	grpActions.addWidget(FRWidget.Button(null, {
		icon: 'file_open', tooltip: 'Load setup from JSON',
		onClick: function() { FontRig.DeltaPanel._actionLoadJson(inst); }
	}));

	grpActions.addWidget(FRWidget.Button(null, {
		icon: 'font_save', tooltip: 'Save setup to browser storage',
		onClick: function() {
			FontRig.DeltaPanel._saveSetup(inst._setup);
			console.log('[DeltaPanel] Setup saved.');
			FontRig.DeltaPanel._setStatus(inst,
				'Setup saved to browser storage.', 'success');
		}
	}));

	grpActions.addWidget(FRWidget.Button(null, {
		icon: 'font_open', tooltip: 'Load setup from browser storage',
		onClick: function() {
			var s = FontRig.DeltaPanel._loadSetup();
			if (s) {
				inst._setup = s;
				FontRig.DeltaPanel._renderTree(inst, tree);
				FontRig.DeltaPanel._setStatus(inst,
					'Setup loaded from browser storage.', 'success');
			} else {
				console.warn('[DeltaPanel] No saved setup.');
				FontRig.DeltaPanel._setStatus(inst,
					'No saved setup found in browser storage.', 'warning');
			}
		}
	}));

	root.appendChild(grpActions);

	// -- Options row -------------------------------------------------
	var grpOpts = FRWidget.GroupBox('Options');

	function _optToggle(icon, tooltip, key) {
		var btn = FRWidget.ToggleButton(null, {
			icon: icon, tooltip: tooltip,
			active: !!inst._setup.options[key],
			onChange: function(active) { inst._setup.options[key] = !!active; }
		});
		grpOpts.addWidget(btn);
		return btn;
	}

	_optToggle('metrics_advance_alt', 'Process metrics', 'metrics');
	_optToggle('icon_anchor',          'Process anchors', 'anchors');
	_optToggle('extrapolate',          'Allow extrapolation', 'extrapolate');
	_optToggle('selection_basic',
		'Selection mode — only the selected nodes are moved by the delta',
		'selection');

	root.appendChild(grpOpts);

	// -- Transform-origin radio (stems mode + global) -----------------
	var grpOrigin = FRWidget.GroupBox('Transform Origin');

	function _originRadio(icon, tooltip, code) {
		var btn = FRWidget.ToggleButton(null, {
			icon: icon, tooltip: tooltip,
			active: inst._setup.options.origin === code,
			group: 'delta-origin',
			onChange: function(active) {
				if (active) inst._setup.options.origin = code;
			}
		});
		grpOrigin.addWidget(btn);
	}

	_originRadio('node_align_bottom_left', 'Baseline (origin)', 'BS');
	_originRadio('node_bottom_left',       'Bottom Left',       'BL');
	_originRadio('node_bottom_right',      'Bottom Right',      'BR');
	_originRadio('node_center',            'Center',            'CE');
	_originRadio('node_top_left',          'Top Left',          'TL');
	_originRadio('node_top_right',         'Top Right',         'TR');

	root.appendChild(grpOrigin);

	// -- Initial paint -----------------------------------------------
	_refreshStatus();
	FontRig.DeltaPanel._renderTree(inst, tree);

	inst._refreshStatus = _refreshStatus;
	inst._tree = tree;
	inst.update = function() {
		_refreshStatus();
		FontRig.DeltaPanel._renderTree(inst, tree);
	};
	inst.unmount = function() {
		FontRig.DeltaPanel._stopLayerWatcher(inst);
	};
	return inst;
};

// =====================================================================
// Tree rendering — collapsible groups with drag-drop between groups
// =====================================================================
//
// Roles drive drop-target compatibility AND row layout:
//   'master'         — children of Master Layers (4-cell shape)
//   'input'          — children of an axis's Inputs group (4-cell shape)
//   'target-stems'   — stems-mode target (7-cell shape)
//   'target-dims'    — dimensions-mode target (6-cell shape with origin)
//
// Drag from any leaf → any group. The drop handler retags the role to
// match the destination group, so a master dropped on Inputs becomes an
// input automatically.
//
// Module-scoped drag state. _dragSource carries { kind, sourceRef,
// nodeData } so we don't have to read dataTransfer (which is fiddly).
FontRig.DeltaPanel._dragSource = null;

FontRig.DeltaPanel._renderTree = function(inst, treeEl) {
	treeEl.innerHTML = '';
	treeEl.className = 'dp-panel';

	// Python readiness — surfaces in the persistent status slot, not the
	// tree, so it doesn't get clobbered by re-renders. ttl=0 keeps it
	// visible until Python is ready; once ready we clear it on the
	// first render that observes the ready state.
	var ready = FontRig.pyBridge && FontRig.pyBridge.ready;
	if (!ready) {
		FontRig.DeltaPanel._setStatus(inst,
			(FontRig.pyBridge && FontRig.pyBridge.loading)
				? '⏳ Python loading… Bake / Measure will activate when ready.'
				: '⚠ Python bridge not initialised. Open any Python action first.',
			'warning', 0);
		inst._pythonBannerActive = true;
	} else if (inst._pythonBannerActive) {
		// First render after Python loaded — clear the persistent banner.
		FontRig.DeltaPanel._setStatus(inst, '', 'info', 0);
		inst._pythonBannerActive = false;
	}

	treeEl.oncontextmenu = function(e) {
		e.preventDefault();
		FontRig.DeltaPanel._showTreeMenu(e, inst, treeEl, {});
	};

	var activeName = FontRig.state.activeLayer || '';

	// -- Master Layers section -------------------------------------
	var mGroup = FontRig.DeltaPanel._buildSection(treeEl, 'Master Layers',
		{ subsection: false });
	FontRig.DeltaPanel._addHeaderButton(mGroup.header, '+', 'Add master', function() {
		inst._setup.masters.push({
			name: 'New', vstem: '', hstem: '',
			color: FontRig.DeltaPanel._randHex(),
		});
		FontRig.DeltaPanel._renderTree(inst, treeEl);
	});
	FontRig.DeltaPanel._wireDropTarget(mGroup, 'master', inst, treeEl);

	inst._setup.masters.forEach(function(m, mi) {
		mGroup.body.appendChild(FontRig.DeltaPanel._buildLeafRow(m, 'master', {
			_inst: inst, _treeEl: treeEl, _axis: null,
			_container: inst._setup.masters, _index: mi, _destKind: 'master',
			_active: m.name === activeName,
			onRemove: function() {
				inst._setup.masters.splice(mi, 1);
				FontRig.DeltaPanel._renderTree(inst, treeEl);
			},
			onDuplicate: function() {
				var copy = JSON.parse(JSON.stringify(m));
				copy.color = FontRig.DeltaPanel._randHex();
				inst._setup.masters.splice(mi + 1, 0, copy);
				FontRig.DeltaPanel._renderTree(inst, treeEl);
			},
			onDragStart: function() {
				FontRig.DeltaPanel._dragSource = {
					kind: 'master', container: inst._setup.masters,
					index: mi, data: m };
			},
			_refresh: function() { FontRig.DeltaPanel._renderTree(inst, treeEl); },
		}));
	});

	// -- Live Axis (permanent slot) --------------------------------
	// Distinct from the regular bake axes. Inputs only; the implicit
	// target is whatever layer is currently active in the canvas.
	// When the Live toggle (in the action bar) is on, a slider row
	// appears under this section and drives the active layer.
	// Bake (the play button) ignores it.
	var liveAxis = inst._setup.liveAxis;
	var lvGroup = FontRig.DeltaPanel._buildSection(treeEl, 'Live Axis',
		{ subsection: false });
	FontRig.DeltaPanel._addHeaderButton(lvGroup.header, '+',
		'Add input to Live Axis', function() {
			liveAxis.inputs.push({
				name: 'New', vstem: 100, hstem: 100,
				color: FontRig.DeltaPanel._randHex(),
			});
			FontRig.DeltaPanel._renderTree(inst, treeEl);
		});
	FontRig.DeltaPanel._wireDropTarget(lvGroup, 'input',
		inst, treeEl, liveAxis);

	liveAxis.inputs.forEach(function(inp, ii) {
		lvGroup.body.appendChild(FontRig.DeltaPanel._buildLeafRow(inp, 'input', {
			_inst: inst, _treeEl: treeEl, _axis: liveAxis,
			_container: liveAxis.inputs, _index: ii, _destKind: 'input',
			_active: inp.name === activeName,
			onRemove: function() {
				liveAxis.inputs.splice(ii, 1);
				FontRig.DeltaPanel._renderTree(inst, treeEl);
			},
			onDuplicate: function() {
				var copy = JSON.parse(JSON.stringify(inp));
				copy.color = FontRig.DeltaPanel._randHex();
				liveAxis.inputs.splice(ii + 1, 0, copy);
				FontRig.DeltaPanel._renderTree(inst, treeEl);
			},
			onDragStart: function() {
				FontRig.DeltaPanel._dragSource = {
					kind: 'input', container: liveAxis.inputs,
					index: ii, data: inp };
			},
			_refresh: function() { FontRig.DeltaPanel._renderTree(inst, treeEl); },
		}));
	});

	// Sliders only when Live is toggled on AND the axis has ≥ 2 inputs.
	if (inst._liveEnabled && liveAxis.inputs.length >= 2) {
		lvGroup.body.appendChild(FontRig.DeltaPanel._buildSliderRow(
			inst, liveAxis, treeEl));
	} else if (inst._liveEnabled) {
		// Helpful hint when the user toggles Live but the axis is empty.
		var hint = document.createElement('div');
		hint.className = 'dp-banner';
		hint.style.margin = '4px 8px';
		hint.textContent = 'Drag at least 2 masters into Live Axis to use the sliders.';
		lvGroup.body.appendChild(hint);
	}

	// -- Virtual Axis sections -------------------------------------
	inst._setup.axes.forEach(function(axis, axIdx) {
		var aGroup = FontRig.DeltaPanel._buildSection(treeEl, axis.name,
			{ subsection: false, axisName: true });

		// Replace the static title span with an input.
		aGroup.titleSpan.replaceWith(
			FontRig.DeltaPanel._buildAxisName(axis));

		FontRig.DeltaPanel._addHeaderButton(aGroup.header, '×',
			'Remove this axis', function(e) {
				e.stopPropagation();
				inst._setup.axes.splice(axIdx, 1);
				FontRig.DeltaPanel._renderTree(inst, treeEl);
			}, 'dp-remove');

		// -- Inputs ------------------------------------------------
		var iGroup = FontRig.DeltaPanel._buildSection(aGroup.body, 'Inputs',
			{ subsection: true });
		FontRig.DeltaPanel._addHeaderButton(iGroup.header, '+', 'Add input',
			function() {
				axis.inputs.push({
					name: 'New', vstem: 100, hstem: 100,
					color: FontRig.DeltaPanel._randHex(),
				});
				FontRig.DeltaPanel._renderTree(inst, treeEl);
			});
		FontRig.DeltaPanel._wireDropTarget(iGroup, 'input', inst, treeEl, axis);

		axis.inputs.forEach(function(inp, ii) {
			iGroup.body.appendChild(FontRig.DeltaPanel._buildLeafRow(inp, 'input', {
				_inst: inst, _treeEl: treeEl, _axis: axis,
				_container: axis.inputs, _index: ii, _destKind: 'input',
				_active: inp.name === activeName,
				onRemove: function() {
					axis.inputs.splice(ii, 1);
					FontRig.DeltaPanel._renderTree(inst, treeEl);
				},
				onDuplicate: function() {
					var copy = JSON.parse(JSON.stringify(inp));
					copy.color = FontRig.DeltaPanel._randHex();
					axis.inputs.splice(ii + 1, 0, copy);
					FontRig.DeltaPanel._renderTree(inst, treeEl);
				},
				onDragStart: function() {
					FontRig.DeltaPanel._dragSource = {
						kind: 'input', container: axis.inputs,
						index: ii, data: inp };
				},
				_refresh: function() { FontRig.DeltaPanel._renderTree(inst, treeEl); },
			}));
		});

		// -- Targets ----------------------------------------------
		var tGroup = FontRig.DeltaPanel._buildSection(aGroup.body, 'Targets',
			{ subsection: true });
		FontRig.DeltaPanel._addHeaderButton(tGroup.header, '+', 'Add stems target',
			function() {
				axis.targets.push({
					mode: 'stems', name: 'NewTarget',
					vstem: 100, hstem: 100, sx: 100, sy: 100,
					color: FontRig.DeltaPanel._randHex(),
				});
				FontRig.DeltaPanel._renderTree(inst, treeEl);
			});
		FontRig.DeltaPanel._addHeaderButton(tGroup.header, '+W',
			'Add dimensions target', function() {
				axis.targets.push({
					mode: 'dimensions', name: 'NewTarget',
					w: 600, h: 700, origin: 'BL',
					color: FontRig.DeltaPanel._randHex(),
				});
				FontRig.DeltaPanel._renderTree(inst, treeEl);
			});
		FontRig.DeltaPanel._wireDropTarget(tGroup, 'target', inst, treeEl, axis);

		axis.targets.forEach(function(tgt, ti) {
			var role = tgt.mode === 'stems' ? 'target-stems' : 'target-dims';
			tGroup.body.appendChild(FontRig.DeltaPanel._buildLeafRow(tgt, role, {
				_inst: inst, _treeEl: treeEl, _axis: axis,
				_container: axis.targets, _index: ti, _destKind: 'target',
				_active: tgt.name === activeName,
				onRemove: function() {
					axis.targets.splice(ti, 1);
					FontRig.DeltaPanel._renderTree(inst, treeEl);
				},
				onDuplicate: function() {
					var copy = JSON.parse(JSON.stringify(tgt));
					copy.color = FontRig.DeltaPanel._randHex();
					axis.targets.splice(ti + 1, 0, copy);
					FontRig.DeltaPanel._renderTree(inst, treeEl);
				},
				onDragStart: function() {
					FontRig.DeltaPanel._dragSource = {
						kind: role, container: axis.targets,
						index: ti, data: tgt };
				},
				_refresh: function() { FontRig.DeltaPanel._renderTree(inst, treeEl); },
			}));
		});

	});
};

// - Section / sub-section (collapsible) ----------------------------
FontRig.DeltaPanel._buildSection = function(parentEl, title, opts) {
	opts = opts || {};
	var el = document.createElement('div');
	el.className = 'dp-section' + (opts.subsection ? ' dp-subsection' : '');

	var header = document.createElement('div');
	header.className = 'dp-section__header';

	var toggle = document.createElement('span');
	toggle.className = 'dp-section__toggle';
	toggle.textContent = '▾';
	header.appendChild(toggle);

	var titleSpan = document.createElement('span');
	titleSpan.className = 'dp-section__title';
	titleSpan.textContent = title || '';
	header.appendChild(titleSpan);

	var body = document.createElement('div');
	body.className = 'dp-section__body';

	header.addEventListener('click', function(e) {
		// Don't collapse when clicking inside an interactive child.
		var t = e.target;
		while (t && t !== header) {
			if (t.tagName === 'INPUT' || t.tagName === 'BUTTON' ||
			    (t.classList && (t.classList.contains('dp-add') ||
			                      t.classList.contains('dp-remove')))) return;
			t = t.parentNode;
		}
		var collapsed = el.classList.toggle('dp-section--collapsed');
		toggle.textContent = collapsed ? '▸' : '▾';
	});

	el.appendChild(header);
	el.appendChild(body);
	parentEl.appendChild(el);
	return { el: el, header: header, body: body, titleSpan: titleSpan };
};

// Compact header action button (e.g. '+' to add a row).
FontRig.DeltaPanel._addHeaderButton = function(header, label, tooltip, onClick, klass) {
	var btn = document.createElement('span');
	btn.className = klass || 'dp-add';
	btn.textContent = label;
	btn.title = tooltip;
	btn.addEventListener('click', function(e) {
		e.stopPropagation();
		if (onClick) onClick(e);
	});
	header.appendChild(btn);
	return btn;
};

// Inline editor for an axis name (replaces the title span when an
// axis section is built).
FontRig.DeltaPanel._buildAxisName = function(axis) {
	var inp = document.createElement('input');
	inp.type = 'text';
	inp.className = 'dp-axis-name';
	inp.value = axis.name;
	inp.addEventListener('change', function() {
		axis.name = inp.value.trim() || axis.name;
	});
	inp.addEventListener('click', function(e) { e.stopPropagation(); });
	return inp;
};

// -- Slider row (live drive, single axis) ---------------------------
// Models the FL Delta sliders: vstem, hstem, Wt%, Ht% per axis.
// On every `input` event, drives the active layer through scale_by_stem
// directly (no full bake, no per-tick layer-create). Cheap enough for
// real-time feedback in the browser.
FontRig.DeltaPanel._buildSliderRow = function(inst, axis, treeEl) {
	var box = document.createElement('div');
	box.className = 'dp-slider-row';

	// Range derived from input layers — first input is the min, last is max.
	var firstStem = axis.inputs[0] || {};
	var lastStem  = axis.inputs[axis.inputs.length - 1] || firstStem;

	var liveState = inst._liveState = inst._liveState || {};
	// Live axis is singular now — re-seed only if names disagree (the
	// user renamed the live axis, basically).
	if (liveState.axisName !== axis.name) {
		liveState.axisName = axis.name;
		liveState.vstem = firstStem.vstem || 0;
		liveState.hstem = firstStem.hstem || 0;
		liveState.sx = 100;
		liveState.sy = 100;
	}

	function addCtrl(label, key, min, max) {
		var item = document.createElement('div');
		item.className = 'dp-slider-item';

		var lbl = document.createElement('span');
		lbl.className = 'dp-slider-label';
		lbl.textContent = label;
		item.appendChild(lbl);

		var sl = document.createElement('input');
		sl.type = 'range';
		sl.className = 'dp-slider';
		sl.min = min; sl.max = max; sl.step = 1;
		sl.value = liveState[key];
		item.appendChild(sl);

		var sp = document.createElement('input');
		sp.type = 'text';
		sp.className = 'dp-spin';
		sp.value = liveState[key];
		item.appendChild(sp);

		function commit(v) {
			v = Math.max(min, Math.min(max, v));
			liveState[key] = v;
			sl.value = v; sp.value = v;
			FontRig.DeltaPanel._actionLiveDrive(inst);
		}
		sl.addEventListener('input', function() { commit(parseFloat(sl.value)); });
		sp.addEventListener('change', function() {
			var v = parseFloat(sp.value);
			if (!isNaN(v)) commit(v);
		});

		box.appendChild(item);
	}

	addCtrl('V',  'vstem', Math.min(firstStem.vstem, lastStem.vstem) - 40,
	                       Math.max(firstStem.vstem, lastStem.vstem) + 40);
	addCtrl('H',  'hstem', Math.min(firstStem.hstem, lastStem.hstem) - 40,
	                       Math.max(firstStem.hstem, lastStem.hstem) + 40);
	addCtrl('Wt%', 'sx', 30, 200);
	addCtrl('Ht%', 'sy', 30, 200);

	return box;
};

// - Drop-target wiring --------------------------------------------
// kind ∈ {'master','input','target'}. When a leaf is dropped, we
// remove it from its source container and append (possibly retagged)
// to the destination container.
FontRig.DeltaPanel._wireDropTarget = function(group, kind, inst, treeEl, axis) {
	function highlight(on) {
		group.el.style.outline = on ? '2px solid rgba(80,160,240,0.6)' : '';
		group.el.style.outlineOffset = on ? '-2px' : '';
	}

	function destContainer() {
		if (kind === 'master') return inst._setup.masters;
		if (kind === 'input')  return axis.inputs;
		return axis.targets;
	}

	function retagForDest(data, sourceKind) {
		return FontRig.DeltaPanel._retagPayload(data, sourceKind, kind);
	}

	// Right-click on the group → menu with the group's add-actions.
	group.el.addEventListener('contextmenu', function(e) {
		// Let rows handle their own contextmenu first.
		if (e.target.closest && e.target.closest('[draggable="true"]')) return;
		e.preventDefault();
		e.stopPropagation();
		FontRig.DeltaPanel._showTreeMenu(e, inst, treeEl, {
			groupKind: kind,
			axis: axis,
		});
	});

	group.el.addEventListener('dragover', function(e) {
		if (!FontRig.DeltaPanel._dragSource) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		highlight(true);
	});
	group.el.addEventListener('dragleave', function() { highlight(false); });
	group.el.addEventListener('drop', function(e) {
		e.preventDefault();
		highlight(false);
		var src = FontRig.DeltaPanel._dragSource;
		if (!src) return;
		var dest = destContainer();
		// Empty container or drop on group background → append.
		var destIndex = dest.length;
		// For same-container drop on the group bg (no row hit), keep
		// the row in place rather than yanking it to the end.
		if (src.container === dest) {
			FontRig.DeltaPanel._dragSource = null;
			return;
		}
		var newEntry = retagForDest(src.data, src.kind);
		src.container.splice(src.index, 1);
		dest.splice(destIndex, 0, newEntry);
		FontRig.DeltaPanel._dragSource = null;
		FontRig.DeltaPanel._renderTree(inst, treeEl);
	});
};

// Row-level drop: position-aware insert (before/after the target row).
// Handles same-container reorder AND cross-container insert at index.
FontRig.DeltaPanel._performReorderDrop = function(src, destContainer,
                                                  destIndex, destKind,
                                                  inst, treeEl) {
	if (!src) return;

	// Same-container reorder.
	if (src.container === destContainer) {
		// Pulling the source out shifts indices above it; correct destIndex.
		var adjusted = destIndex > src.index ? destIndex - 1 : destIndex;
		if (adjusted === src.index) {
			FontRig.DeltaPanel._dragSource = null; return;
		}
		var moved = destContainer.splice(src.index, 1)[0];
		destContainer.splice(adjusted, 0, moved);
		FontRig.DeltaPanel._dragSource = null;
		FontRig.DeltaPanel._renderTree(inst, treeEl);
		return;
	}

	// Cross-container — retag schema to fit destination.
	var newEntry = FontRig.DeltaPanel._retagPayload(src.data, src.kind, destKind);
	src.container.splice(src.index, 1);
	destContainer.splice(destIndex, 0, newEntry);
	FontRig.DeltaPanel._dragSource = null;
	FontRig.DeltaPanel._renderTree(inst, treeEl);
};

// Shared retagger — moves the schema-fixup logic out of the closure in
// _wireDropTarget so the row-level handler can reuse it. destKind ∈
// {'master','input','target'}.
FontRig.DeltaPanel._retagPayload = function(data, sourceKind, destKind) {
	var copy = JSON.parse(JSON.stringify(data));
	if (destKind === 'master' || destKind === 'input') {
		delete copy.mode; delete copy.sx; delete copy.sy;
		delete copy.w; delete copy.h; delete copy.origin;
		if (copy.vstem === undefined) copy.vstem = '';
		if (copy.hstem === undefined) copy.hstem = '';
		if (destKind === 'input') {
			if (copy.vstem === '' || copy.vstem == null) copy.vstem = 100;
			if (copy.hstem === '' || copy.hstem == null) copy.hstem = 100;
		}
	} else if (destKind === 'target') {
		if (sourceKind === 'target-dims') {
			copy.mode = 'dimensions';
			if (copy.origin === undefined) copy.origin = 'BL';
			if (copy.w === undefined) copy.w = 600;
			if (copy.h === undefined) copy.h = 700;
		} else {
			copy.mode = 'stems';
			if (copy.vstem === '' || copy.vstem == null) copy.vstem = 100;
			if (copy.hstem === '' || copy.hstem == null) copy.hstem = 100;
			if (copy.sx === undefined) copy.sx = 100;
			if (copy.sy === undefined) copy.sy = 100;
		}
	}
	return copy;
};

// - Unified leaf row builder ----------------------------------------
// role ∈ {'master','input','target-stems','target-dims'}. Layout (cells
// after the drag handle + swatch + name) differs per role.
FontRig.DeltaPanel._buildLeafRow = function(entry, role, cb) {
	var row = document.createElement('div');
	row.draggable = true;
	row.className = 'dp-row dp-row--' + role;
	if (cb._active) row.classList.add('dp-row--active');

	// Colored left border + faint background tint, using the row's own
	// hex color. 8-digit hex is the alpha suffix (0x14 ≈ 8%).
	var hex = entry.color || '#888888';
	row.style.borderLeftColor = hex;
	row.style.background = hex + '14';
	row.title = entry.name || '';

	// -- Cell 1: type badge (M / I / S / D)
	var badgeMap = { master: 'M', input: 'I',
	                 'target-stems': 'S', 'target-dims': 'D' };
	var badge = document.createElement('span');
	badge.className = 'dp-badge dp-badge--' + role;
	badge.textContent = badgeMap[role] || '?';
	badge.title = role;
	// Clicking the badge randomises the row's color (the swatch is
	// also implicit via the colored left border — no separate chip).
	badge.addEventListener('click', function(e) {
		e.stopPropagation();
		entry.color = FontRig.DeltaPanel._randHex();
		row.style.borderLeftColor = entry.color;
		row.style.background = entry.color + '14';
	});
	row.appendChild(badge);

	// -- Cell 2: editable name
	var name = document.createElement('input');
	name.type = 'text';
	name.value = entry.name || '';
	name.placeholder = 'name';
	name.className = 'dp-name';
	name.addEventListener('change', function() { entry.name = name.value; });
	name.addEventListener('click', function(e) { e.stopPropagation(); });
	row.appendChild(name);

	// -- Cells 3+: per-role numeric / select cells
	function numCell(key, ph, tip) {
		var inp = FontRig.DeltaPanel._numField(entry, key, ph, tip);
		inp.className = 'dp-cell';
		return inp;
	}
	function textCell(key, ph, strict, tip) {
		var inp = FontRig.DeltaPanel._textField(entry, key, ph, strict, tip);
		inp.className = 'dp-cell';
		if (entry[key] === undefined || entry[key] === '' || entry[key] === null) {
			inp.classList.add('dp-cell--blank');
		}
		inp.addEventListener('focus', function() {
			inp.classList.remove('dp-cell--blank');
		});
		return inp;
	}

	if (role === 'target-stems') {
		row.appendChild(numCell('vstem', 'V st.', 'Vertical stem (units)'));
		row.appendChild(numCell('hstem', 'H st.', 'Horizontal stem (units)'));
		row.appendChild(numCell('sx', 'Wt%', 'Width scale (percent)'));
		row.appendChild(numCell('sy', 'Ht%', 'Height scale (percent)'));
	} else if (role === 'target-dims') {
		row.appendChild(numCell('w', 'Width', 'Target width (units)'));
		row.appendChild(numCell('h', 'Height', 'Target height (units)'));
		var origin = document.createElement('select');
		origin.className = 'dp-cell dp-cell--origin';
		origin.title = 'Transform origin';
		['BL','BR','TL','TR','CE','BS'].forEach(function(code) {
			var o = document.createElement('option');
			o.value = code; o.textContent = code;
			if (entry.origin === code) o.selected = true;
			origin.appendChild(o);
		});
		origin.addEventListener('change', function() { entry.origin = origin.value; });
		row.appendChild(origin);
	} else {
		// master / input — blank stems on masters are legal
		row.appendChild(textCell('vstem', 'V st.', role === 'input',
			'Vertical stem (units)'));
		row.appendChild(textCell('hstem', 'H st.', role === 'input',
			'Horizontal stem (units)'));
	}

	// -- Last cell: remove ×
	var rm = document.createElement('span');
	rm.className = 'dp-remove';
	rm.textContent = '×';
	rm.title = 'Remove';
	rm.addEventListener('click', function(e) {
		e.stopPropagation();
		cb.onRemove();
	});
	row.appendChild(rm);

	// -- Drag and drop — position-aware row-level handlers.
	function clearIndicators() {
		row.classList.remove('dp-drop-above', 'dp-drop-below');
	}
	row.addEventListener('dragover', function(e) {
		if (!FontRig.DeltaPanel._dragSource) return;
		if (!cb._container) return;
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = 'move';
		var rect = row.getBoundingClientRect();
		var before = (e.clientY - rect.top) < (rect.height / 2);
		clearIndicators();
		row.classList.add(before ? 'dp-drop-above' : 'dp-drop-below');
	});
	row.addEventListener('dragleave', clearIndicators);
	row.addEventListener('drop', function(e) {
		if (!FontRig.DeltaPanel._dragSource) return;
		if (!cb._container) return;
		e.preventDefault();
		e.stopPropagation();
		clearIndicators();
		var rect = row.getBoundingClientRect();
		var before = (e.clientY - rect.top) < (rect.height / 2);
		var destIndex = cb._index + (before ? 0 : 1);
		FontRig.DeltaPanel._performReorderDrop(
			FontRig.DeltaPanel._dragSource,
			cb._container, destIndex, cb._destKind,
			cb._inst, cb._treeEl);
	});

	row.addEventListener('dragstart', function(e) {
		FontRig._internalDrag = true;
		row.classList.add('dp-dragging');
		try { e.dataTransfer.setData('text/plain', entry.name || ''); } catch (_) {}
		e.dataTransfer.effectAllowed = 'move';
		if (cb.onDragStart) cb.onDragStart();
	});
	row.addEventListener('dragend', function() {
		FontRig._internalDrag = false;
		row.classList.remove('dp-dragging');
		FontRig.DeltaPanel._dragSource = null;
	});

	row.addEventListener('contextmenu', function(e) {
		e.preventDefault();
		e.stopPropagation();
		FontRig.DeltaPanel._showTreeMenu(e, cb._inst, cb._treeEl, {
			role: role, entry: entry, axis: cb._axis, rowCb: cb,
		});
	});

	return row;
};

// =====================================================================
// Tree context menu — mirrors the FL DeltaNew menu (FRWidget parity).
// =====================================================================
// ctx shape (all keys optional):
//   ctx.role      — set when right-click was on a row: 'master' |
//                   'input' | 'target-stems' | 'target-dims'
//   ctx.entry     — the row's data object
//   ctx.axis      — owning axis (set on input / target / inputs-group /
//                   targets-group right-clicks)
//   ctx.groupKind — set when right-click was on a group background:
//                   'master' | 'input' | 'target'
//   ctx.rowCb     — the row's callback bag (onRemove/onDuplicate/_refresh)
//
// When none of the keys are set we're on the tree background and only
// the top-level commands (Add Axis, stem measurement, Clear all) show.
FontRig.DeltaPanel._showTreeMenu = function(e, inst, treeEl, ctx) {
	var items = [];
	var sep = function() { items.push({ separator: true }); };

	// --- Add commands ----------------------------------------------
	items.push({
		label: 'Add Virtual Axis',
		onClick: function() { FontRig.DeltaPanel._actionAddAxis(inst); },
	});

	// Add Input / Add Target only meaningful when an axis is implied.
	var implicitAxis = ctx.axis || null;
	// On a target/input row context we already know the axis. On the
	// targets-group background we know the axis too. On master rows
	// and the tree background, we don't.
	if (implicitAxis) {
		items.push({
			label: 'Add Input to "' + implicitAxis.name + '"',
			onClick: function() {
				implicitAxis.inputs.push({
					name: 'New', vstem: 100, hstem: 100,
					color: FontRig.DeltaPanel._randHex(),
				});
				FontRig.DeltaPanel._renderTree(inst, treeEl);
			},
		});
		items.push({
			label: 'Add Target (Stems) to "' + implicitAxis.name + '"',
			onClick: function() {
				implicitAxis.targets.push({
					mode: 'stems', name: 'NewTarget',
					vstem: 100, hstem: 100, sx: 100, sy: 100,
					color: FontRig.DeltaPanel._randHex(),
				});
				FontRig.DeltaPanel._renderTree(inst, treeEl);
			},
		});
		items.push({
			label: 'Add Target (Dimensions) to "' + implicitAxis.name + '"',
			onClick: function() {
				implicitAxis.targets.push({
					mode: 'dimensions', name: 'NewTarget',
					w: 600, h: 700, origin: 'BL',
					color: FontRig.DeltaPanel._randHex(),
				});
				FontRig.DeltaPanel._renderTree(inst, treeEl);
			},
		});
	}

	if (ctx.groupKind === 'master' || ctx.role === 'master') {
		items.push({
			label: 'Add Master row',
			onClick: function() {
				inst._setup.masters.push({
					name: 'New', vstem: '', hstem: '',
					color: FontRig.DeltaPanel._randHex(),
				});
				FontRig.DeltaPanel._renderTree(inst, treeEl);
			},
		});
	}

	// --- Row-specific commands -------------------------------------
	if (ctx.entry && ctx.rowCb) {
		sep();
		items.push({ label: 'Duplicate', onClick: ctx.rowCb.onDuplicate });

		if (ctx.role === 'target-stems') {
			items.push({
				label: 'Switch to dimensions',
				onClick: function() {
					ctx.entry.mode = 'dimensions';
					if (ctx.entry.w === undefined) ctx.entry.w = 600;
					if (ctx.entry.h === undefined) ctx.entry.h = 700;
					ctx.entry.origin = ctx.entry.origin || 'BL';
					ctx.rowCb._refresh && ctx.rowCb._refresh();
				},
			});
		} else if (ctx.role === 'target-dims') {
			items.push({
				label: 'Switch to stems',
				onClick: function() {
					ctx.entry.mode = 'stems';
					if (ctx.entry.vstem === undefined) ctx.entry.vstem = 100;
					if (ctx.entry.hstem === undefined) ctx.entry.hstem = 100;
					if (ctx.entry.sx === undefined) ctx.entry.sx = 100;
					if (ctx.entry.sy === undefined) ctx.entry.sy = 100;
					ctx.rowCb._refresh && ctx.rowCb._refresh();
				},
			});
		}

		items.push({ label: 'Remove', onClick: ctx.rowCb.onRemove });
	}

	// --- Stem measurement (always available) -----------------------
	sep();
	items.push({
		label: 'Measure V stem on selection (all rows)',
		onClick: function() { FontRig.DeltaPanel._actionMeasureStem(inst, 'x'); },
	});
	items.push({
		label: 'Measure H stem on selection (all rows)',
		onClick: function() { FontRig.DeltaPanel._actionMeasureStem(inst, 'y'); },
	});

	// --- Bulk actions ----------------------------------------------
	sep();
	items.push({
		label: 'Clear all axes',
		onClick: function() { FontRig.DeltaPanel._actionResetAxes(inst); },
	});
	items.push({
		label: 'Reset all (re-seed masters)',
		onClick: function() { FontRig.DeltaPanel._actionResetAll(inst); },
	});

	FontRig.DeltaPanel._showContextMenu(e.pageX, e.pageY, items);
};

// Lightweight context menu — popped from row contextmenu handlers.
FontRig.DeltaPanel._showContextMenu = function(x, y, items) {
	var existing = document.getElementById('delta-ctx-menu');
	if (existing) existing.parentNode.removeChild(existing);

	var menu = document.createElement('div');
	menu.id = 'delta-ctx-menu';
	menu.style.position = 'fixed';
	menu.style.left = x + 'px';
	menu.style.top = y + 'px';
	menu.style.background = 'var(--bg-1, #2a2a2a)';
	menu.style.color = 'var(--fg-1, #ddd)';
	menu.style.border = '1px solid rgba(127,127,127,0.4)';
	menu.style.borderRadius = '4px';
	menu.style.padding = '4px 0';
	menu.style.fontSize = '11px';
	menu.style.zIndex = '9999';
	menu.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
	menu.style.minWidth = '140px';

	items.forEach(function(item) {
		if (item.separator) {
			var sep = document.createElement('div');
			sep.style.borderTop = '1px solid rgba(127,127,127,0.25)';
			sep.style.margin = '4px 0';
			menu.appendChild(sep);
			return;
		}
		var el = document.createElement('div');
		el.textContent = item.label;
		el.style.padding = '4px 12px';
		el.style.cursor = 'pointer';
		if (item.disabled) {
			el.style.opacity = '0.4';
			el.style.cursor = 'default';
		}
		el.addEventListener('mouseenter', function() {
			if (!item.disabled) el.style.background = 'rgba(127,127,127,0.2)';
		});
		el.addEventListener('mouseleave', function() {
			el.style.background = '';
		});
		el.addEventListener('click', function() {
			if (item.disabled) return;
			menu.parentNode.removeChild(menu);
			if (item.onClick) item.onClick();
		});
		menu.appendChild(el);
	});

	document.body.appendChild(menu);
	setTimeout(function() {
		var dismiss = function(e) {
			if (!menu.contains(e.target)) {
				if (menu.parentNode) menu.parentNode.removeChild(menu);
				document.removeEventListener('click', dismiss);
			}
		};
		document.addEventListener('click', dismiss);
	}, 0);
};

// Free-form text field — keeps blank as blank (used for masters).
// strict=true → empty becomes 0 (used for inputs which need numeric).
FontRig.DeltaPanel._textField = function(entry, key, placeholder, strict, tooltip) {
	var inp = document.createElement('input');
	inp.type = 'text';
	inp.value = entry[key] === undefined || entry[key] === null ? '' : String(entry[key]);
	inp.placeholder = placeholder;
	if (tooltip) inp.title = tooltip;
	inp.addEventListener('click', function(e) { e.stopPropagation(); });
	inp.addEventListener('change', function() {
		var raw = inp.value.trim();
		if (raw === '') { entry[key] = strict ? 0 : ''; return; }
		var v = parseFloat(raw);
		entry[key] = isNaN(v) ? raw : v;
	});
	return inp;
};

FontRig.DeltaPanel._numField = function(entry, key, placeholder, tooltip) {
	var inp = document.createElement('input');
	inp.type = 'text';
	inp.value = entry[key] === undefined ? '' : String(entry[key]);
	inp.placeholder = placeholder;
	if (tooltip) inp.title = tooltip;
	inp.addEventListener('click', function(e) { e.stopPropagation(); });
	inp.addEventListener('change', function() {
		var v = parseFloat(inp.value);
		entry[key] = isNaN(v) ? 0 : v;
	});
	return inp;
};

// - Helpers --------------------------------------------------------
FontRig.DeltaPanel._pickLayerName = function(inst) {
	var names = inst._setup.masters.map(function(m) { return m.name; });
	if (!names.length) {
		console.warn('[DeltaPanel] No masters defined.');
		return null;
	}
	var choice = window.prompt(
		'Layer to add as input:\n' + names.join('\n'),
		names[0]);
	if (!choice) return null;
	return choice;
};

FontRig.DeltaPanel._colorForMaster = function(inst, name) {
	for (var i = 0; i < inst._setup.masters.length; i++) {
		if (inst._setup.masters[i].name === name) {
			return inst._setup.masters[i].color || FontRig.DeltaPanel._randHex();
		}
	}
	return FontRig.DeltaPanel._randHex();
};

// =====================================================================
// Actions
// =====================================================================
FontRig.DeltaPanel._actionAddAxis = function(inst) {
	var n = inst._setup.axes.length + 1;
	inst._setup.axes.push({
		name: 'axis_' + n,
		inputs: [],
		targets: [],
	});
	FontRig.DeltaPanel._renderTree(inst, inst._tree);
};

// "Set axis" — activate the delta. Validates the setup and stores it.
// In the FL panel this also pre-builds DeltaScale arrays; in FontRig
// the arrays are rebuilt per bake call (cheap enough), so this acts
// as the user's "I'm done editing, commit it" gesture.
FontRig.DeltaPanel._actionSetDelta = function(inst) {
	var s = inst._setup;
	var errors = [];

	if (!s.axes.length) errors.push('No axes defined.');
	s.axes.forEach(function(ax) {
		if (!ax.name) errors.push('An axis has no name.');
		if (ax.inputs.length < 2)
			errors.push('Axis "' + ax.name + '" needs at least 2 inputs.');
		ax.inputs.forEach(function(inp) {
			if (typeof inp.vstem !== 'number' || typeof inp.hstem !== 'number') {
				errors.push('Axis "' + ax.name + '" input "' + inp.name
					+ '" has non-numeric stems.');
			}
		});
	});

	if (errors.length) {
		errors.forEach(function(e) { console.warn('[DeltaPanel]', e); });
		FontRig.DeltaPanel._setStatus(inst,
			'Axis set failed: ' + errors[0], 'error');
		return;
	}

	FontRig.DeltaPanel._saveSetup(s);
	inst._deltaActive = true;
	var nTargets = s.axes.reduce(function(n, a) { return n + a.targets.length; }, 0);
	var msg = 'Axis set — ' + s.axes.length + ' axis'
		+ (s.axes.length === 1 ? '' : 'es')
		+ ', ' + nTargets + ' target' + (nTargets === 1 ? '' : 's') + '.';
	console.log('[DeltaPanel] ' + msg);
	FontRig.DeltaPanel._setStatus(inst, msg, 'success');
};

// "Clear delta" — drop cached/derived state. Setup (the tree) is
// untouched. After this, Bake will rebuild from scratch on next click.
FontRig.DeltaPanel._actionClearDelta = function(inst) {
	inst._deltaActive = false;
	console.log('[DeltaPanel] Delta cleared (setup preserved).');
	FontRig.DeltaPanel._setStatus(inst,
		'Axis reset — delta cleared, setup preserved.', 'info');
};

FontRig.DeltaPanel._actionResetAll = function(inst) {
	inst._setup = FontRig.DeltaPanel._freshSetup();
	inst._deltaActive = false;
	FontRig.DeltaPanel._renderTree(inst, inst._tree);
	FontRig.DeltaPanel._setStatus(inst,
		'Reset all — masters re-seeded from glyph.', 'info');
};

// Fingerprint of the Live Axis structure (input names + stems) — used
// to detect when the user edits the axis while Live mode is on, so we
// can re-snapshot transparently.
FontRig.DeltaPanel._liveFingerprint = function(liveAxis) {
	if (!liveAxis || !liveAxis.inputs) return '';
	return JSON.stringify(liveAxis.inputs.map(function(i) {
		return [i.name, i.vstem, i.hstem];
	}));
};

// Take a snapshot of the Live Axis. Inputs are cloned in Python
// (deepcopy) so the snapshot is frozen — driving the active layer
// later cannot feed back into the snapshot, which is the whole point.
FontRig.DeltaPanel._actionLiveSet = function(inst) {
	if (!FontRig.pyBridge || !FontRig.pyBridge.ready) return false;
	var liveAxis = inst._setup.liveAxis;
	if (!liveAxis || !liveAxis.inputs || liveAxis.inputs.length < 2) {
		console.warn('[DeltaPanel] Live Axis needs at least 2 inputs.');
		return false;
	}
	var liveSetup = {
		masters: inst._setup.masters,
		axes: [{
			name: liveAxis.name || 'Live',
			inputs: liveAxis.inputs,
			targets: [],
		}],
		options: Object.assign({}, inst._setup.options, {
			origin: inst._setup.options.origin || 'BS',
		}),
	};
	var json = JSON.stringify(liveSetup);
	FontRig.pyBridge.pyodide.globals.set('_delta_setup_json', json);
	FontRig.pyBridge.syncToPython();
	try {
		var resJson = FontRig.pyBridge.pyodide.runPython(
			'import json as _j; _j.dumps(' +
			'npa("npa_delta_live_set", _delta_setup_json))'
		);
		var res = JSON.parse(resJson || '{}');
		if (!res.ok) {
			console.warn('[DeltaPanel] Live snapshot failed:', res.error || res);
			inst._liveFingerprintCached = '';
			return false;
		}
		inst._liveFingerprintCached =
			FontRig.DeltaPanel._liveFingerprint(liveAxis);
		console.log('[DeltaPanel] Live snapshot taken — '
			+ res.inputs + ' inputs, viable: ' + (res.viable || []).join(', '));
		return true;
	} catch (e) {
		console.warn('[DeltaPanel] Live snapshot failed:', e);
		return false;
	}
};

FontRig.DeltaPanel._actionLiveClear = function(inst) {
	if (!FontRig.pyBridge || !FontRig.pyBridge.ready) return;
	try {
		FontRig.pyBridge.pyodide.runPython('npa("npa_delta_live_clear")');
	} catch (e) { /* non-fatal */ }
	inst._liveFingerprintCached = '';
};

// Build a neutral slider state for `layerName`. V/H come from whichever
// row in the panel matches the layer name (live axis input → master);
// scale resets to 100%.
FontRig.DeltaPanel._neutralLiveState = function(inst, layerName) {
	function find(arr) {
		for (var i = 0; i < arr.length; i++) {
			if (arr[i].name === layerName) return arr[i];
		}
		return null;
	}
	var found = null;
	if (inst._setup.liveAxis) found = find(inst._setup.liveAxis.inputs);
	if (!found) found = find(inst._setup.masters);

	var vs = found ? parseFloat(found.vstem) : NaN;
	var hs = found ? parseFloat(found.hstem) : NaN;
	return {
		axisName: 'Live',
		vstem: isNaN(vs) ? 100 : vs,
		hstem: isNaN(hs) ? 100 : hs,
		sx: 100,
		sy: 100,
	};
};

// Called when the polling watcher (or any other trigger) detects that
// the editor's active layer changed while Live mode is on.
// Effects:
//   1. Re-snapshot all inputs at their *current* geometry, so each
//      input layer's snapshot now matches what's in the glyph. This
//      means "neutral slider" on the new active layer = its current
//      state, and prior edits on other layers are baked into the
//      baseline used by future driving.
//   2. Reset slider state to neutral for the new active layer.
//   3. Re-render so the slider section shows the new values.
// The previously-active layer keeps whatever geometry the user drove
// it to — we never touch it on switch.
FontRig.DeltaPanel._onActiveLayerChange = function(inst, newName) {
	inst._liveCurrentLayer = newName;
	if (!newName || !inst._liveEnabled) return;

	// Re-snapshot — captures the editor's current layer states as the
	// new baseline.
	FontRig.DeltaPanel._actionLiveSet(inst);

	// Reset sliders.
	inst._liveState = FontRig.DeltaPanel._neutralLiveState(inst, newName);

	FontRig.DeltaPanel._renderTree(inst, inst._tree);
};

FontRig.DeltaPanel._startLayerWatcher = function(inst) {
	if (inst._layerWatcher) return;
	inst._liveCurrentLayer = FontRig.state.activeLayer || null;
	inst._layerWatcher = setInterval(function() {
		if (!inst._liveEnabled) return;
		var active = FontRig.state.activeLayer || null;
		if (active !== inst._liveCurrentLayer) {
			FontRig.DeltaPanel._onActiveLayerChange(inst, active);
		}
	}, 200);
};

FontRig.DeltaPanel._stopLayerWatcher = function(inst) {
	if (inst._layerWatcher) {
		clearInterval(inst._layerWatcher);
		inst._layerWatcher = null;
	}
	inst._liveCurrentLayer = null;
};

// Live-drive: each slider tick is now a single, cheap call into the
// snapshot. No setup JSON, no sync round-trip for inputs — just the
// target layer name and four floats. Cascade-proof: the inputs are
// frozen in module-level Python state, never re-read from the live glyph.
FontRig.DeltaPanel._actionLiveDrive = function(inst) {
	if (!FontRig.pyBridge || !FontRig.pyBridge.ready) return;
	if (!inst._liveState) return;
	if (!inst._setup.liveAxis || inst._setup.liveAxis.inputs.length < 2) return;

	var active = (typeof FontRig.getActiveLayer === 'function')
		? FontRig.getActiveLayer() : null;
	if (!active) return;

	// Re-snapshot transparently if the Live Axis was edited while
	// Live was on (e.g. user dragged in a different master).
	var fp = FontRig.DeltaPanel._liveFingerprint(inst._setup.liveAxis);
	if (fp !== inst._liveFingerprintCached) {
		if (!FontRig.DeltaPanel._actionLiveSet(inst)) return;
	}

	var s = inst._liveState;
	var py = FontRig.pyBridge.pyodide;
	py.globals.set('_delta_live_target', active.name);
	py.globals.set('_delta_live_v', s.vstem);
	py.globals.set('_delta_live_h', s.hstem);
	py.globals.set('_delta_live_sx', s.sx);
	py.globals.set('_delta_live_sy', s.sy);

	// syncToPython: we need the editor's current glyph as the *write*
	// target. The deltas read from the frozen snapshot in module state,
	// so the live glyph state never feeds back into the inputs.
	FontRig.pyBridge.syncToPython();
	try {
		py.runPython(
			'npa("npa_delta_live_drive", _delta_live_target, ' +
			'_delta_live_v, _delta_live_h, _delta_live_sx, _delta_live_sy)'
		);
		FontRig.pyBridge.syncFromPython();
		if (FontRig.draw) FontRig.draw();
	} catch (e) {
		console.warn('[DeltaPanel] Live drive failed:', e);
	}
};

FontRig.DeltaPanel._actionBake = function(inst) {
	if (!FontRig.pyBridge || !FontRig.pyBridge.ready) {
		console.warn('[DeltaPanel] Python not ready'); return;
	}
	// Serialise setup, hand off to the dispatcher. _runNpa snapshots
	// undo and rebuilds JS state from Python after the call.
	var json = JSON.stringify(inst._setup);
	FontRig.pyBridge.pyodide.globals.set('_delta_setup_json', json);
	_runNpa('npa("npa_delta_bake", _delta_setup_json)');
	// Read back warnings + counts (best-effort, advisory only)
	try {
		var status = FontRig.pyBridge.pyodide.runPython(
			'import json as _j; ' +
			'try:\n' +
			'  _r = npa("npa_delta_bake", _delta_setup_json)\n' +
			'except Exception as _e:\n' +
			'  _r = {"ok": False, "error": str(_e)}\n' +
			'_j.dumps(_r)'
		);
		var parsed = JSON.parse(status);
		if (parsed.warnings && parsed.warnings.length) {
			console.warn('[DeltaPanel] Bake warnings:');
			parsed.warnings.forEach(function(w) { console.warn('  · ' + w); });
		}
		var summary = 'Bake — ' + parsed.axes_built
			+ ' axis/axes, ' + parsed.targets_baked + ' target(s).';
		console.log('[DeltaPanel] ' + summary);
		FontRig.DeltaPanel._setStatus(inst,
			summary + (parsed.warnings && parsed.warnings.length
				? ' (' + parsed.warnings.length + ' warning'
				  + (parsed.warnings.length === 1 ? '' : 's') + ' in console)'
				: ''),
			parsed.warnings && parsed.warnings.length ? 'warning' : 'success');
	} catch (e) {
		console.warn('[DeltaPanel] Could not read bake status:', e);
		FontRig.DeltaPanel._setStatus(inst,
			'Bake completed (status unread).', 'info');
	}
};

FontRig.DeltaPanel._actionMeasureStem = function(inst, axis) {
	// Selection lives on one layer (FontRig is single-viewport), but
	// the index pair is topology — the same (shape, contour, node)
	// triple on a compatible master describes the matching node.
	// So we send the axis ('x' or 'y') to Python and receive
	// {layer_name: float_or_null} for *every* layer of the glyph,
	// derived from whichever layer carries the live selection. We
	// then update every row (master + input across all axes) whose
	// name appears in the result. Layers with incompatible topology
	// silently return null and stay untouched.
	if (!FontRig.pyBridge || !FontRig.pyBridge.ready) {
		console.warn('[DeltaPanel] Python not ready'); return;
	}
	if (!FontRig.state.glyphData) {
		console.warn('[DeltaPanel] No glyph loaded'); return;
	}
	if (!FontRig.state.selectedNodeIds || FontRig.state.selectedNodeIds.size < 2) {
		console.warn('[DeltaPanel] Select at least 2 nodes that define a stem.');
		return;
	}

	FontRig.pyBridge.syncToPython();

	var resultJson = null;
	try {
		FontRig.pyBridge.pyodide.globals.set('_delta_axis', axis);
		resultJson = FontRig.pyBridge.pyodide.runPython(
			'npa("npa_delta_measure_stems_all", _delta_axis)'
		);
	} catch (e) {
		console.warn('[DeltaPanel] Measure failed:', e); return;
	}

	var perLayer = {};
	try { perLayer = JSON.parse(resultJson || '{}'); }
	catch (e) { console.warn('[DeltaPanel] Bad result JSON:', e); return; }

	var key = axis === 'y' ? 'hstem' : 'vstem';
	var touched = 0;
	var skipped = [];

	function apply(rowSet) {
		rowSet.forEach(function(row) {
			if (Object.prototype.hasOwnProperty.call(perLayer, row.name)) {
				var v = perLayer[row.name];
				if (v === null || v === undefined) {
					skipped.push(row.name);
				} else {
					row[key] = v;
					touched++;
				}
			}
		});
	}

	apply(inst._setup.masters);
	inst._setup.axes.forEach(function(ax) {
		apply(ax.inputs);
		// Stems-mode target rows are also user-authored stems and get
		// broadcast updates. Dimensions-mode targets are skipped — they
		// don't carry vstem/hstem.
		ax.targets.forEach(function(t) {
			if (t.mode !== 'stems') return;
			if (!Object.prototype.hasOwnProperty.call(perLayer, t.name)) return;
			var v = perLayer[t.name];
			if (v !== null && v !== undefined) { t[key] = v; touched++; }
		});
	});
	// Live Axis inputs — these drive the live snapshot so keeping them
	// in sync with measured stems matters even more.
	if (inst._setup.liveAxis && inst._setup.liveAxis.inputs) {
		apply(inst._setup.liveAxis.inputs);
	}

	var measuredCount = Object.keys(perLayer).filter(function(k) {
		return perLayer[k] !== null && perLayer[k] !== undefined;
	}).length;

	console.log('[DeltaPanel] ' + (axis === 'y' ? 'H' : 'V')
		+ ' stem measured on ' + measuredCount
		+ ' compatible layer(s) → updated ' + touched + ' row(s).'
		+ (skipped.length ? ' Skipped (incompatible): ' + skipped.join(', ') : ''));

	if (touched) FontRig.DeltaPanel._renderTree(inst, inst._tree);
};

FontRig.DeltaPanel._actionSaveJson = function(inst) {
	var json = JSON.stringify(inst._setup, null, 2);
	var blob = new Blob([json], { type: 'application/json' });
	var url = URL.createObjectURL(blob);
	var a = document.createElement('a');
	a.href = url;
	a.download = 'delta-setup.json';
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
	FontRig.DeltaPanel._setStatus(inst,
		'Setup exported to delta-setup.json.', 'success');
};

FontRig.DeltaPanel._actionLoadJson = function(inst) {
	var input = document.createElement('input');
	input.type = 'file';
	input.accept = 'application/json,.json';
	input.addEventListener('change', function() {
		var f = input.files && input.files[0];
		if (!f) return;
		var reader = new FileReader();
		reader.onload = function() {
			try {
				var s = JSON.parse(reader.result);
				if (!s.axes) throw new Error('Not a Delta setup.');
				inst._setup = FontRig.DeltaPanel._migrateSetup(s);
				FontRig.DeltaPanel._renderTree(inst, inst._tree);
				FontRig.DeltaPanel._setStatus(inst,
					'Setup loaded from ' + f.name + '.', 'success');
			} catch (e) {
				console.warn('[DeltaPanel] Load failed:', e);
				FontRig.DeltaPanel._setStatus(inst,
					'Load failed — not a valid Delta setup.', 'error');
			}
		};
		reader.readAsText(f);
	});
	input.click();
};
