// ===================================================================
// FontRig — New Font / New Glyph dialogs
// ===================================================================
// Two composite dialogs:
//   FRWidget.NewFontDialog()   → { family, style, upm, ascender,
//                                   descender, xHeight, capHeight,
//                                   italicAngle, master } | null
//   FRWidget.NewGlyphDialog()  → { name, unicodes, width } | null
//
// Both resolve null on Cancel/Close. Defaults mirror
// typerig.core.objects.font.FontInfo / FontMetrics.
// ===================================================================
'use strict';

(function () {

if (typeof FRWidget === 'undefined') return;

// -- Helpers --------------------------------------------------------
function _row(label, widget) {
	return FRWidget.Row(label, widget);
}

function _section(text) {
	var h = document.createElement('div');
	h.textContent = text;
	h.style.fontSize = '11px';
	h.style.opacity = '0.6';
	h.style.margin = '8px 0 4px 0';
	h.style.textTransform = 'uppercase';
	h.style.letterSpacing = '0.05em';
	return h;
}

// -------------------------------------------------------------------
// NEW FONT DIALOG
// -------------------------------------------------------------------
FRWidget.NewFontDialog = function (opts) {
	opts = opts || {};

	var fFamily = FRWidget.EditField({ value: opts.family || 'Untitled', placeholder: 'Family name' });
	var fStyle  = FRWidget.EditField({ value: opts.style  || 'Regular',  placeholder: 'Style name' });
	var fMaster = FRWidget.EditField({ value: opts.master || 'Regular',  placeholder: 'Default master layer name' });

	var fUpm    = FRWidget.SpinBox({ min: 100,   max: 65535, value: opts.upm        || 1000, step: 10 });
	var fAsc    = FRWidget.SpinBox({ min: -5000, max: 5000,  value: opts.ascender   || 800,  step: 10 });
	var fDesc   = FRWidget.SpinBox({ min: -5000, max: 5000,  value: opts.descender  || -200, step: 10 });
	var fXH     = FRWidget.SpinBox({ min: 0,     max: 5000,  value: opts.xHeight    || 500,  step: 10 });
	var fCH     = FRWidget.SpinBox({ min: 0,     max: 5000,  value: opts.capHeight  || 700,  step: 10 });
	var fIta    = FRWidget.DoubleSpinBox({ min: -45, max: 45, value: opts.italicAngle || 0, step: 0.5, decimals: 2 });

	var body = document.createElement('div');
	body.className = 'frw-field-dlg__body';

	body.appendChild(_section('Identity'));
	body.appendChild(_row('Family',  fFamily));
	body.appendChild(_row('Style',   fStyle));
	body.appendChild(_row('Master',  fMaster));

	body.appendChild(_section('Metrics'));
	body.appendChild(_row('UPM',          fUpm));
	body.appendChild(_row('Ascender',     fAsc));
	body.appendChild(_row('Descender',    fDesc));
	body.appendChild(_row('x-height',     fXH));
	body.appendChild(_row('Cap height',   fCH));
	body.appendChild(_row('Italic angle', fIta));

	return new Promise(function (resolve) {
		var dlg = FRWidget.Dialog({
			title: 'New Font',
			body: body,
			buttons: [
				{
					text: 'Create', primary: true,
					onClick: function () {
						var family = (fFamily.getValue() || '').trim();
						var style  = (fStyle.getValue()  || '').trim();
						var master = (fMaster.getValue() || '').trim() || 'Regular';
						if (!family || !style) {
							alert('Family and Style are required.');
							return;
						}
						resolve({
							family:      family,
							style:       style,
							master:      master,
							upm:         fUpm.getValue(),
							ascender:    fAsc.getValue(),
							descender:   fDesc.getValue(),
							xHeight:     fXH.getValue(),
							capHeight:   fCH.getValue(),
							italicAngle: fIta.getValue()
						});
					}
				},
				{ text: 'Cancel', onClick: function () { resolve(null); } }
			],
			onClose: function () { resolve(null); }
		});
		dlg.open();
	});
};

// -------------------------------------------------------------------
// NEW GLYPH DIALOG
// -------------------------------------------------------------------
FRWidget.NewGlyphDialog = function (opts) {
	opts = opts || {};
	var defaultWidth = opts.defaultWidth || 600;

	var fName     = FRWidget.EditField({ value: '', placeholder: 'e.g. A' });
	var fUnicodes = FRWidget.EditField({ value: '', placeholder: 'e.g. 0041 (optional)' });
	var fWidth    = FRWidget.SpinBox({ min: 0, max: 65535, value: defaultWidth, step: 10 });

	var body = document.createElement('div');
	body.className = 'frw-field-dlg__body';
	body.appendChild(_row('Name',     fName));
	body.appendChild(_row('Unicodes', fUnicodes));
	body.appendChild(_row('Width',    fWidth));

	return new Promise(function (resolve) {
		var dlg = FRWidget.Dialog({
			title: 'New Glyph',
			body: body,
			buttons: [
				{
					text: 'Create', primary: true,
					onClick: function () {
						var name = (fName.getValue() || '').trim();
						if (!name) { alert('Glyph name is required.'); return; }
						var uni  = (fUnicodes.getValue() || '').trim();
						if (uni && !/^[0-9a-fA-F\s]+$/.test(uni)) {
							alert('Unicodes must be space-separated hex codepoints, e.g. "0041 0042".');
							return;
						}
						resolve({
							name:     name,
							unicodes: uni.toUpperCase(),
							width:    fWidth.getValue()
						});
					}
				},
				{ text: 'Cancel', onClick: function () { resolve(null); } }
			],
			onClose: function () { resolve(null); }
		});
		dlg.open();
	});
};

})();
