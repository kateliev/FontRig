// ===================================================================
// FontRig — Font Info Panel (Multi-Instance)
// ===================================================================
// Builds and updates the Font Info tab content. Supports multiple
// simultaneous instances — each mount() returns an independent
// instance object. Read-only display of font metadata.
// ===================================================================
'use strict';

(function() {

if (typeof FontRig === 'undefined') return;

FontRig.FontInfoPanel = {};

// ===================================================================
// Mount into a container element — returns instance
// ===================================================================
FontRig.FontInfoPanel.mount = function(containerEl, ctx) {
	if (!containerEl) return null;

	var inst = {
		_containerEl: containerEl,
	};

	containerEl.innerHTML = '';

	var wrapper = document.createElement('div');
	wrapper.className = 'font-info-panel';
	containerEl.appendChild(wrapper);

	// Attach public methods
	inst.update = function() { _update(inst); };

	return inst;
};

// ===================================================================
// Internal: rebuild / update content from current font data
// ===================================================================
function _update(inst) {
	var container = inst._containerEl;
	if (!container) return;

	var wrapper = container.querySelector('.font-info-panel');
	if (!wrapper) {
		wrapper = document.createElement('div');
		wrapper.className = 'font-info-panel';
		container.appendChild(wrapper);
	}

	wrapper.innerHTML = '';

	if (!FontRig.font) {
		wrapper.innerHTML = '<div style="color:var(--text-dim);padding:16px;font-size:11px;">No font loaded</div>';
		return;
	}

	var info = FontRig.font.info || {};
	var metrics = FontRig.font.metrics || {};
	var masters = FontRig.font.masters || [];

	// -- Title
	var title = document.createElement('div');
	title.className = 'font-info-title';
	title.textContent = info.family || info.familyName || 'Untitled';
	wrapper.appendChild(title);

	// -- Basic info section
	var basicSection = _createSection('Identification');
	_addRow(basicSection, 'Family', info.family || info.familyName || '\u2014');
	_addRow(basicSection, 'Style', info.style || info.styleName || '\u2014');
	_addRow(basicSection, 'Version', info.version || '\u2014');
	wrapper.appendChild(basicSection);

	// -- Metrics section
	var metricsSection = _createSection('Metrics');
	_addRow(metricsSection, 'UPM', metrics.upm || '\u2014');
	_addRow(metricsSection, 'Ascender', metrics.ascender || '\u2014');
	_addRow(metricsSection, 'Descender', metrics.descender || '\u2014');
	_addRow(metricsSection, 'x-Height', metrics.xHeight || '\u2014');
	_addRow(metricsSection, 'Cap Height', metrics.capHeight || '\u2014');
	wrapper.appendChild(metricsSection);

	// -- Masters section
	if (masters.length > 0) {
		var mastersSection = _createSection('Masters');
		for (var i = 0; i < masters.length; i++) {
			var m = masters[i];
			var label = m.name || m.layerName || 'Master ' + (i + 1);
			var value = m.layerName || '';
			if (m.isDefault) value += ' (default)';
			_addRow(mastersSection, label, value);
		}
		wrapper.appendChild(mastersSection);
	}

	// -- Glyph count
	var glyphSection = _createSection('Content');
	_addRow(glyphSection, 'Glyphs',
		FontRig.font.manifest ? FontRig.font.manifest.length : 0);
	wrapper.appendChild(glyphSection);
}

// ===================================================================
// Helpers (stateless)
// ===================================================================
function _createSection(label) {
	var section = document.createElement('div');
	section.className = 'font-info-section';
	var lbl = document.createElement('div');
	lbl.className = 'font-info-section-label';
	lbl.textContent = label;
	section.appendChild(lbl);
	return section;
}

function _addRow(section, label, value) {
	var row = document.createElement('div');
	row.className = 'font-info-row';
	var lblSpan = document.createElement('span');
	lblSpan.className = 'label';
	lblSpan.textContent = label;
	row.appendChild(lblSpan);
	var valSpan = document.createElement('span');
	valSpan.className = 'value';
	valSpan.textContent = value;
	row.appendChild(valSpan);
	section.appendChild(row);
}

})();
