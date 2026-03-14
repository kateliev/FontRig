// ===================================================================
// TypeRig Toolbar Controller
// ===================================================================
// Port of TRToolbarController from typerig-toolbar.py.
// Wires the layer-scope and glyph-scope toggle button groups in the
// editor toolbar and manages the Layer Select dialog lifecycle.
//
// Depends on:
//   - FontRig.scope           (frw-dialogs.js)
//   - FontRig.layerSelection  (frw-dialogs.js)
//   - FRWidget.LayerSelectDialog (frw-dialogs.js)
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
			layerDlg = FRWidget.LayerSelectDialog({
				mode: 0,
				onChange: function(checkedNames) {
					// Notify any external listeners
					if (FontRig.scope._onChange) FontRig.scope._onChange();
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

		FontRig.scope.layerMode = mode;

		if (mode === 'selected') {
			// Open / refresh the Layer Select dialog
			var dlg = ensureLayerDialog();
			dlg.refresh();
			dlg.open();
		} else {
			// Hide the dialog if it was open
			if (layerDlg) layerDlg.close();
		}

		if (FontRig.scope._onChange) FontRig.scope._onChange();
	});

	// -- Glyph scope events -----------------------------------------------
	scopeGlyphs.addEventListener('click', function(e) {
		var btn = e.target.closest('.tb-scope__btn');
		if (!btn) return;

		var mode = activateExclusive(glyphBtns, btn);
		if (!mode) return;

		FontRig.scope.glyphMode = mode;

		// When switching glyph mode, also refresh the layer dialog's mode
		// (mode 0 = glyph layers, mode 1 = font masters only)
		if (layerDlg && FontRig.scope.layerMode === 'selected') {
			var dlgMode = (mode === 'active') ? 0 : 1;
			FontRig.layerSelection.refresh(dlgMode);
			layerDlg.refresh();
		}

		if (FontRig.scope._onChange) FontRig.scope._onChange();
	});

	// -- Public API on FontRig ------------------------------------------------
	// Allow other code to programmatically open the layer dialog
	FontRig.openLayerSelect = function() {
		// Switch to 'selected' mode
		FontRig.scope.layerMode = 'selected';

		// Update button visuals
		for (var i = 0; i < layerBtns.length; i++) {
			layerBtns[i].classList.toggle('active', layerBtns[i].dataset.scope === 'selected');
		}

		var dlg = ensureLayerDialog();
		dlg.refresh();
		dlg.open();
	};

	// Allow reading the resolved scope from anywhere
	FontRig.getScopeLayers = function() { return FontRig.scope.getLayers(); };
	FontRig.getScopeGlyphs = function() { return FontRig.scope.getGlyphs(); };

})();
