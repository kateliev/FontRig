// ===================================================================
// TypeRig Toolbar Controller
// ===================================================================
// Port of TRToolbarController from typerig-toolbar.py.
// Wires the layer-scope and glyph-scope toggle button groups in the
// editor toolbar and manages the Layer Select dialog lifecycle.
//
// Depends on:
//   - TRV.scope           (trw-dialogs.js)
//   - TRV.layerSelection  (trw-dialogs.js)
//   - TRW.LayerSelectDialog (trw-dialogs.js)
//   - DOM: #scope-layers, #scope-glyphs button groups (index.html)
// ===================================================================
'use strict';

(function() {
	// -- References -------------------------------------------------------
	var scopeLayers = document.getElementById('scope-layers');
	var scopeGlyphs = document.getElementById('scope-glyphs');

	if (!scopeLayers || !scopeGlyphs) return;

	var layerBtns = scopeLayers.querySelectorAll('.tb-scope__btn');
	var glyphBtns = scopeGlyphs.querySelectorAll('.tb-scope__btn');

	// -- Layer Select dialog instance (lazy, reused) ----------------------
	var layerDlg = null;

	function ensureLayerDialog() {
		if (!layerDlg) {
			layerDlg = TRW.LayerSelectDialog({
				mode: 0,
				onChange: function(checkedNames) {
					// Notify any external listeners
					if (TRV.scope._onChange) TRV.scope._onChange();
				},
				onClose: function() {
					// Don't switch away from 'selected' mode on close —
					// the dialog can be re-opened and state persists.
				}
			});
		}
		return layerDlg;
	}

	// -- Exclusive toggle helper ------------------------------------------
	// Given a NodeList of buttons and a click target, mark it active,
	// deactivate siblings, and return the data-scope value.
	function activateExclusive(buttons, target) {
		var scope = null;
		for (var i = 0; i < buttons.length; i++) {
			if (buttons[i] === target || buttons[i].contains(target)) {
				buttons[i].classList.add('active');
				scope = buttons[i].dataset.scope;
			} else {
				buttons[i].classList.remove('active');
			}
		}
		return scope;
	}

	// -- Layer scope events -----------------------------------------------
	scopeLayers.addEventListener('click', function(e) {
		var btn = e.target.closest('.tb-scope__btn');
		if (!btn) return;

		var mode = activateExclusive(layerBtns, btn);
		if (!mode) return;

		TRV.scope.layerMode = mode;

		if (mode === 'selected') {
			// Open / refresh the Layer Select dialog
			var dlg = ensureLayerDialog();
			dlg.refresh();
			dlg.open();
		} else {
			// Hide the dialog if it was open
			if (layerDlg) layerDlg.close();
		}

		if (TRV.scope._onChange) TRV.scope._onChange();
	});

	// -- Glyph scope events -----------------------------------------------
	scopeGlyphs.addEventListener('click', function(e) {
		var btn = e.target.closest('.tb-scope__btn');
		if (!btn) return;

		var mode = activateExclusive(glyphBtns, btn);
		if (!mode) return;

		TRV.scope.glyphMode = mode;

		// When switching glyph mode, also refresh the layer dialog's mode
		// (mode 0 = glyph layers, mode 1 = font masters only)
		if (layerDlg && TRV.scope.layerMode === 'selected') {
			var dlgMode = (mode === 'active') ? 0 : 1;
			TRV.layerSelection.refresh(dlgMode);
			layerDlg.refresh();
		}

		if (TRV.scope._onChange) TRV.scope._onChange();
	});

	// -- Public API on TRV ------------------------------------------------
	// Allow other code to programmatically open the layer dialog
	TRV.openLayerSelect = function() {
		// Switch to 'selected' mode
		TRV.scope.layerMode = 'selected';

		// Update button visuals
		for (var i = 0; i < layerBtns.length; i++) {
			layerBtns[i].classList.toggle('active', layerBtns[i].dataset.scope === 'selected');
		}

		var dlg = ensureLayerDialog();
		dlg.refresh();
		dlg.open();
	};

	// Allow reading the resolved scope from anywhere
	TRV.getScopeLayers = function() { return TRV.scope.getLayers(); };
	TRV.getScopeGlyphs = function() { return TRV.scope.getGlyphs(); };

})();
