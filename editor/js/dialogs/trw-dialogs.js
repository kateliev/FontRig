// ===================================================================
// TypeRig Dialogs (TRW) — Dialog Library
// ===================================================================
// Ports of TypeRig proxy/fl/gui/dialogs.py for the web editor.
// All dialogs reuse TRW widget factories from trw-widgets.js and
// the base TRW.Dialog modal shell.
//
// Shared state: TRV.layerSelection is the persistent layer-check
// state that both JS code and the Python bridge can consume.
// ===================================================================
'use strict';

// ===================================================================
// SHARED LAYER SELECTION STATE
// ===================================================================
// Persistent across dialog open/close. Any code can read
// TRV.layerSelection.getChecked() to get the list of layer names
// the user has ticked. The Python bridge syncs this automatically.
// -------------------------------------------------------------------
TRV.layerSelection = {
	layers: [],          // [{ name: str, type: str, checked: bool }, ...]
	_onChange: null,      // external listener

	// Populate from current glyph + font masters
	refresh: function(mode) {
		var layers = [];

		if (mode === undefined) mode = 0;

		if (mode === 0 && TRV.state.glyphData) {
			// Mode 0: all layers from the active glyph
			for (var i = 0; i < TRV.state.glyphData.layers.length; i++) {
				var layer = TRV.state.glyphData.layers[i];
				var lname = layer.name;

				// Skip internal layers (names starting with #)
				if (lname.charAt(0) === '#') continue;

				var ltype = 'Service';
				if (TRV.isMaskLayer(lname)) {
					ltype = 'Mask';
				} else if (TRV.font && TRV.font.masters) {
					for (var m = 0; m < TRV.font.masters.length; m++) {
						if (TRV.font.masters[m].layerName === lname) {
							ltype = 'Master';
							break;
						}
					}
				}

				// Preserve previous checked state if layer name matches
				var prev = TRV.layerSelection._findByName(lname);
				layers.push({
					name: lname,
					type: ltype,
					checked: prev ? prev.checked : false
				});
			}
		} else if (TRV.font && TRV.font.masters) {
			// Mode 1+: only font masters
			for (var m = 0; m < TRV.font.masters.length; m++) {
				var master = TRV.font.masters[m];
				var prev = TRV.layerSelection._findByName(master.layerName);
				layers.push({
					name: master.layerName,
					type: 'Master',
					checked: prev ? prev.checked : false
				});
			}
		}

		TRV.layerSelection.layers = layers;
	},

	// Get array of checked layer names
	getChecked: function() {
		var result = [];
		for (var i = 0; i < this.layers.length; i++) {
			if (this.layers[i].checked) result.push(this.layers[i].name);
		}
		return result;
	},

	// Get array of checked layer objects { name, type }
	getCheckedLayers: function() {
		var result = [];
		for (var i = 0; i < this.layers.length; i++) {
			if (this.layers[i].checked) result.push(this.layers[i]);
		}
		return result;
	},

	// Set checked by name list
	setChecked: function(names) {
		var set = {};
		for (var i = 0; i < names.length; i++) set[names[i]] = true;
		for (var j = 0; j < this.layers.length; j++) {
			this.layers[j].checked = !!set[this.layers[j].name];
		}
	},

	// Internal: find existing layer entry by name
	_findByName: function(name) {
		for (var i = 0; i < this.layers.length; i++) {
			if (this.layers[i].name === name) return this.layers[i];
		}
		return null;
	}
};


// ===================================================================
// SCOPE STATE (Toolbar Controller)
// ===================================================================
// Determines which layers and glyphs an operation should affect.
// Mirrors pLayers / pMode from the Python TRToolbarController.
//
// layerMode:
//   'active'   — only the current active layer
//   'masters'  — all master layers (default)
//   'selected' — layers ticked in the Layer Select dialog
//
// glyphMode:
//   'active'    — only the current active glyph (default)
//   'window'    — all glyphs in the workspace strip
//   'selection' — all glyphs selected in the font/glyph panel
// -------------------------------------------------------------------
TRV.scope = {
	layerMode: 'masters',
	glyphMode: 'active',
	_onChange: null,

	// Resolve layerMode to an array of layer names for the active glyph
	getLayers: function() {
		var mode = TRV.scope.layerMode;

		if (mode === 'active') {
			return TRV.state.activeLayer ? [TRV.state.activeLayer] : [];
		}

		if (mode === 'masters') {
			if (!TRV.font || !TRV.font.masters) return TRV.state.activeLayer ? [TRV.state.activeLayer] : [];
			var names = [];
			for (var i = 0; i < TRV.font.masters.length; i++) {
				names.push(TRV.font.masters[i].layerName);
			}
			return names;
		}

		if (mode === 'selected') {
			return TRV.layerSelection.getChecked();
		}

		return [];
	},

	// Resolve glyphMode to an array of glyph names
	getGlyphs: function() {
		var mode = TRV.scope.glyphMode;

		if (mode === 'active') {
			return TRV.activeGlyph ? [TRV.activeGlyph] : [];
		}

		if (mode === 'window') {
			// Workspace strip glyphs
			if (TRV.workspace && TRV.workspace.glyphs && TRV.workspace.glyphs.length > 0) {
				return TRV.workspace.glyphs.slice();
			}
			// Fallback: active glyph only
			return TRV.activeGlyph ? [TRV.activeGlyph] : [];
		}

		if (mode === 'selection') {
			// Glyphs selected in the font panel (checked/highlighted entries)
			var list = document.getElementById('glyph-list');
			if (!list) return TRV.activeGlyph ? [TRV.activeGlyph] : [];

			var names = [];
			var entries = list.querySelectorAll('.glyph-entry.active, .glyph-entry.in-strip');
			for (var i = 0; i < entries.length; i++) {
				if (entries[i].dataset.name) names.push(entries[i].dataset.name);
			}
			return names.length > 0 ? names : (TRV.activeGlyph ? [TRV.activeGlyph] : []);
		}

		return [];
	}
};


// ===================================================================
// LAYER SELECT DIALOG
// ===================================================================
// Reimplements TRLayerSelect from dialogs.py.
// Opens a non-modal dialog with a CheckTableWidget showing layers.
//
// Usage:
//   var dlg = TRW.LayerSelectDialog({ mode: 0 });
//   dlg.open();
//   // later: TRV.layerSelection.getChecked()
//
// opts.mode     — 0 = all glyph layers (with types), 1+ = masters only
// opts.onClose  — callback when dialog is dismissed
// opts.onChange  — callback(checkedNames) when selection changes
// -------------------------------------------------------------------
TRW.LayerSelectDialog = function(opts) {
	opts = opts || {};
	var mode = opts.mode !== undefined ? opts.mode : 0;

	// Refresh shared state
	TRV.layerSelection.refresh(mode);

	// -- Color map for layer types (matching the Python original)
	var colorMap = {
		'Master':  'rgba(0, 255, 0, 0.06)',
		'Service': 'rgba(0, 0, 255, 0.06)',
		'Mask':    'rgba(255, 0, 0, 0.06)'
	};

	// -- Build table rows from shared state
	function buildRows() {
		var rows = [];
		for (var i = 0; i < TRV.layerSelection.layers.length; i++) {
			var l = TRV.layerSelection.layers[i];
			rows.push({
				data: [l.name, l.type],
				checked: l.checked,
				color: null   // let colorMap handle it
			});
		}
		return rows;
	}

	// -- Check table
	var checkTable = TRW.CheckTableWidget({
		columns: ['Layer Name', 'Layer Type'],
		rows: buildRows(),
		colorMap: colorMap,
		colorCol: 1,
		onChange: function(rowIdx, checked) {
			// Sync back to shared state
			if (TRV.layerSelection.layers[rowIdx]) {
				TRV.layerSelection.layers[rowIdx].checked = checked;
			}
			if (opts.onChange) opts.onChange(TRV.layerSelection.getChecked());
		}
	});

	// -- Action toolbar
	var toolbar = document.createElement('div');
	toolbar.className = 'trw-lsd__toolbar';

	var btnSelectAll = TRW.Button(null, {
		icon: 'check', tooltip: 'Select all (Shift+Click to deselect all)',
		compact: true,
		onClick: function(e) {
			var uncheck = e && e.shiftKey;
			checkTable.checkAll(!uncheck);
			syncFromTable();
		}
	});

	var btnSwap = TRW.Button(null, {
		icon: 'sliders', tooltip: 'Swap selection',
		compact: true,
		onClick: function() {
			checkTable.swapChecks();
			syncFromTable();
		}
	});

	// Layer type filter buttons (only in mode 0)
	var btnMasters = null, btnMasks = null, btnServices = null;

	if (mode === 0) {
		btnMasters = TRW.Button('M', {
			compact: true, tooltip: 'Select Masters (Shift+Click to deselect)',
			onClick: function(e) {
				var uncheck = e && e.shiftKey;
				checkTable.checkByColumn(1, 'Master', !uncheck);
				syncFromTable();
			}
		});
		btnMasters.classList.add('trw-lsd__type-btn', 'trw-lsd__type-btn--master');

		btnMasks = TRW.Button('K', {
			compact: true, tooltip: 'Select Masks (Shift+Click to deselect)',
			onClick: function(e) {
				var uncheck = e && e.shiftKey;
				checkTable.checkByColumn(1, 'Mask', !uncheck);
				syncFromTable();
			}
		});
		btnMasks.classList.add('trw-lsd__type-btn', 'trw-lsd__type-btn--mask');

		btnServices = TRW.Button('S', {
			compact: true, tooltip: 'Select Services (Shift+Click to deselect)',
			onClick: function(e) {
				var uncheck = e && e.shiftKey;
				checkTable.checkByColumn(1, 'Service', !uncheck);
				syncFromTable();
			}
		});
		btnServices.classList.add('trw-lsd__type-btn', 'trw-lsd__type-btn--service');
	}

	var btnRefresh = TRW.Button(null, {
		icon: 'sliders', tooltip: 'Refresh layer list',
		compact: true,
		onClick: function() {
			TRV.layerSelection.refresh(mode);
			checkTable.setData(
				['Layer Name', 'Layer Type'],
				buildRows()
			);
		}
	});

	toolbar.appendChild(btnSelectAll);
	toolbar.appendChild(btnSwap);
	if (btnMasters) toolbar.appendChild(btnMasters);
	if (btnMasks) toolbar.appendChild(btnMasks);
	if (btnServices) toolbar.appendChild(btnServices);

	var spacer = document.createElement('span');
	spacer.className = 'trw-spacer';
	toolbar.appendChild(spacer);
	toolbar.appendChild(btnRefresh);

	// -- Search field
	var searchRow = document.createElement('div');
	searchRow.className = 'trw-lsd__search';

	var searchLabel = TRW.Label('', { dim: true });
	searchLabel.className = 'tri';
	searchLabel.textContent = 'search';

	var searchInput = document.createElement('input');
	searchInput.type = 'text';
	searchInput.className = 'trw-lsd__search-input';
	searchInput.placeholder = 'Filter: Layer Name';
	searchInput.addEventListener('input', function() {
		checkTable.filter(0, searchInput.value);
	});

	var searchClear = TRW.Button(null, {
		icon: 'close', compact: true, tooltip: 'Clear search',
		onClick: function() {
			searchInput.value = '';
			checkTable.clearFilter();
		}
	});

	searchRow.appendChild(searchLabel);
	searchRow.appendChild(searchInput);
	searchRow.appendChild(searchClear);

	// -- Assemble body
	var body = document.createElement('div');
	body.className = 'trw-lsd__body';
	body.appendChild(toolbar);
	body.appendChild(searchRow);
	body.appendChild(checkTable);

	// -- Sync table state → shared layerSelection
	function syncFromTable() {
		var rows = checkTable.getRows();
		for (var i = 0; i < rows.length; i++) {
			if (TRV.layerSelection.layers[i]) {
				TRV.layerSelection.layers[i].checked = rows[i].checked;
			}
		}
		if (opts.onChange) opts.onChange(TRV.layerSelection.getChecked());
	}

	// -- Create dialog shell
	var dlg = TRW.Dialog({
		title: 'Select Layers',
		body: body,
		onClose: opts.onClose
	});

	// Override min/max width for this dialog
	dlg.el.querySelector('.trw-dialog').style.minWidth = '320px';
	dlg.el.querySelector('.trw-dialog').style.maxWidth = '440px';

	// Public API: expose refresh
	dlg.refresh = function() {
		TRV.layerSelection.refresh(mode);
		checkTable.setData(['Layer Name', 'Layer Type'], buildRows());
	};

	// Expose shared state accessor
	dlg.getChecked = function() {
		return TRV.layerSelection.getChecked();
	};

	return dlg;
};


// ===================================================================
// INPUT DIALOG (single field)
// ===================================================================
// Port of TR1FieldDLG. Returns a Promise that resolves with the
// field value on OK, or null on Cancel/close.
//
// Usage:
//   TRW.InputDialog({ title: '...', message: '...', label: '...' })
//     .then(function(value) { ... });
// -------------------------------------------------------------------
TRW.InputDialog = function(opts) {
	opts = opts || {};
	var field = TRW.EditField({
		value: opts.value || '',
		placeholder: opts.placeholder || ''
	});

	var body = document.createElement('div');
	body.className = 'trw-field-dlg__body';

	if (opts.message) {
		var msg = document.createElement('p');
		msg.className = 'trw-field-dlg__msg';
		msg.textContent = opts.message;
		body.appendChild(msg);
	}

	body.appendChild(TRW.Row(opts.label || 'Value', field));

	return new Promise(function(resolve) {
		var dlg = TRW.Dialog({
			title: opts.title || 'Input',
			body: body,
			buttons: [
				{ text: 'OK', primary: true, onClick: function() { resolve(field.getValue()); } },
				{ text: 'Cancel', onClick: function() { resolve(null); } }
			],
			onClose: function() { resolve(null); }
		});
		dlg.open();
	});
};


// ===================================================================
// DUAL INPUT DIALOG (two fields)
// ===================================================================
// Port of TR2FieldDLG. Resolves with [topValue, bottomValue] or null.
// -------------------------------------------------------------------
TRW.DualInputDialog = function(opts) {
	opts = opts || {};
	var fieldT = TRW.EditField({ value: opts.valueTop || '', placeholder: opts.placeholderTop || '' });
	var fieldB = TRW.EditField({ value: opts.valueBottom || '', placeholder: opts.placeholderBottom || '' });

	var body = document.createElement('div');
	body.className = 'trw-field-dlg__body';

	if (opts.message) {
		var msg = document.createElement('p');
		msg.className = 'trw-field-dlg__msg';
		msg.textContent = opts.message;
		body.appendChild(msg);
	}

	body.appendChild(TRW.Row(opts.labelTop || 'Field 1', fieldT));
	body.appendChild(TRW.Row(opts.labelBottom || 'Field 2', fieldB));

	return new Promise(function(resolve) {
		var dlg = TRW.Dialog({
			title: opts.title || 'Input',
			body: body,
			buttons: [
				{ text: 'OK', primary: true, onClick: function() { resolve([fieldT.getValue(), fieldB.getValue()]); } },
				{ text: 'Cancel', onClick: function() { resolve(null); } }
			],
			onClose: function() { resolve(null); }
		});
		dlg.open();
	});
};


// ===================================================================
// SPIN DIALOG (single spinner)
// ===================================================================
// Port of TR1SpinDLG. Resolves with the numeric value or null.
// -------------------------------------------------------------------
TRW.SpinDialog = function(opts) {
	opts = opts || {};
	var isFloat = opts.decimals && opts.decimals > 0;

	var spinOpts = {
		min: opts.min !== undefined ? opts.min : 0,
		max: opts.max !== undefined ? opts.max : 100,
		value: opts.value !== undefined ? opts.value : 0,
		step: opts.step || (isFloat ? 0.1 : 1),
	};

	if (isFloat) spinOpts.decimals = opts.decimals;

	var spin = isFloat ? TRW.DoubleSpinBox(spinOpts) : TRW.SpinBox(spinOpts);

	var body = document.createElement('div');
	body.className = 'trw-field-dlg__body';

	if (opts.message) {
		var msg = document.createElement('p');
		msg.className = 'trw-field-dlg__msg';
		msg.textContent = opts.message;
		body.appendChild(msg);
	}

	body.appendChild(TRW.Row(opts.label || 'Value', spin));

	return new Promise(function(resolve) {
		var dlg = TRW.Dialog({
			title: opts.title || 'Spin',
			body: body,
			buttons: [
				{ text: 'OK', primary: true, onClick: function() { resolve(spin.getValue()); } },
				{ text: 'Cancel', onClick: function() { resolve(null); } }
			],
			onClose: function() { resolve(null); }
		});
		dlg.open();
	});
};


// ===================================================================
// MULTI-SPIN DIALOG (N spinners)
// ===================================================================
// Port of TRNSpinDLG. Takes a fields object:
//   { 'Radius': { min, max, value, step, decimals }, ... }
// Resolves with an object { 'Radius': value, ... } or null.
// -------------------------------------------------------------------
TRW.MultiSpinDialog = function(opts) {
	opts = opts || {};
	var fields = opts.fields || {};
	var spinners = {};

	var body = document.createElement('div');
	body.className = 'trw-field-dlg__body';

	if (opts.message) {
		var msg = document.createElement('p');
		msg.className = 'trw-field-dlg__msg';
		msg.textContent = opts.message;
		body.appendChild(msg);
	}

	var keys = Object.keys(fields);
	for (var i = 0; i < keys.length; i++) {
		var key = keys[i];
		var cfg = fields[key];
		var isFloat = cfg.decimals && cfg.decimals > 0;

		var spinOpts = {
			min: cfg.min !== undefined ? cfg.min : 0,
			max: cfg.max !== undefined ? cfg.max : 100,
			value: cfg.value !== undefined ? cfg.value : 0,
			step: cfg.step || (isFloat ? 0.1 : 1),
		};

		if (isFloat) spinOpts.decimals = cfg.decimals;

		var spin = isFloat ? TRW.DoubleSpinBox(spinOpts) : TRW.SpinBox(spinOpts);
		spinners[key] = spin;
		body.appendChild(TRW.Row(key, spin));
	}

	return new Promise(function(resolve) {
		var dlg = TRW.Dialog({
			title: opts.title || 'Values',
			body: body,
			buttons: [
				{
					text: 'OK', primary: true,
					onClick: function() {
						var result = {};
						var k = Object.keys(spinners);
						for (var j = 0; j < k.length; j++) {
							result[k[j]] = spinners[k[j]].getValue();
						}
						resolve(result);
					}
				},
				{ text: 'Cancel', onClick: function() { resolve(null); } }
			],
			onClose: function() { resolve(null); }
		});
		dlg.open();
	});
};


// ===================================================================
// SLIDER DIALOG
// ===================================================================
// Port of TR1SliderDLG. Uses TRW.SliderCtrl. Resolves with value or null.
// -------------------------------------------------------------------
TRW.SliderDialog = function(opts) {
	opts = opts || {};

	var slider = TRW.SliderCtrl({
		label: opts.label || '',
		min: opts.min !== undefined ? opts.min : 0,
		max: opts.max !== undefined ? opts.max : 100,
		value: opts.value !== undefined ? opts.value : 50,
		step: opts.step || 1,
		decimals: opts.decimals || 0,
		onChange: opts.onLiveChange || null
	});

	var body = document.createElement('div');
	body.className = 'trw-field-dlg__body';

	if (opts.message) {
		var msg = document.createElement('p');
		msg.className = 'trw-field-dlg__msg';
		msg.textContent = opts.message;
		body.appendChild(msg);
	}

	body.appendChild(slider);

	return new Promise(function(resolve) {
		var dlg = TRW.Dialog({
			title: opts.title || 'Slider',
			body: body,
			buttons: [
				{ text: 'OK', primary: true, onClick: function() { resolve(slider.getValue()); } },
				{ text: 'Cancel', onClick: function() { resolve(null); } }
			],
			onClose: function() { resolve(null); }
		});
		dlg.open();
	});
};


// ===================================================================
// COMBO DIALOG (field + combo box)
// ===================================================================
// Port of TR2ComboDLG. Resolves with { text, selectedIndex, selectedValue }
// or null on cancel.
// -------------------------------------------------------------------
TRW.ComboDialog = function(opts) {
	opts = opts || {};

	var field = TRW.EditField({
		value: opts.value || '',
		placeholder: opts.placeholder || ''
	});

	var combo = TRW.ComboBox({
		items: opts.items || []
	});

	var body = document.createElement('div');
	body.className = 'trw-field-dlg__body';

	if (opts.message) {
		var msg = document.createElement('p');
		msg.className = 'trw-field-dlg__msg';
		msg.textContent = opts.message;
		body.appendChild(msg);
	}

	body.appendChild(TRW.Row(opts.labelField || 'Value', field));
	body.appendChild(TRW.Row(opts.labelCombo || 'Select', combo));

	return new Promise(function(resolve) {
		var dlg = TRW.Dialog({
			title: opts.title || 'Select',
			body: body,
			buttons: [
				{
					text: 'OK', primary: true,
					onClick: function() {
						resolve({
							text: field.getValue(),
							selectedIndex: combo.select.selectedIndex,
							selectedValue: combo.getValue()
						});
					}
				},
				{ text: 'Cancel', onClick: function() { resolve(null); } }
			],
			onClose: function() { resolve(null); }
		});
		dlg.open();
	});
};
