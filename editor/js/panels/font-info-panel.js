// ===================================================================
// FontRig — Font Info Panel
// ===================================================================
// Builds and updates the Font Info tab content for the left sidebar.
// Displays font metadata: family, style, version, metrics, masters.
// Read-only for now; structured for future editability.
// ===================================================================
'use strict';

(function() {

if (typeof FontRig === 'undefined') return;

FontRig.FontInfoPanel = {};

// -- Container reference --------------------------------------------
FontRig.FontInfoPanel._containerEl = null;

// ===================================================================
// Mount into a container element
// ===================================================================
FontRig.FontInfoPanel.mount = function(containerEl) {
	if (!containerEl) return;
	FontRig.FontInfoPanel._containerEl = containerEl;
	containerEl.innerHTML = '';

	var wrapper = document.createElement('div');
	wrapper.className = 'font-info-panel';
	containerEl.appendChild(wrapper);
};

// ===================================================================
// Rebuild / update content from current font data
// ===================================================================
FontRig.FontInfoPanel.update = function() {
	var container = FontRig.FontInfoPanel._containerEl;
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

	// -- Title -------------------------------------------------------
	var title = document.createElement('div');
	title.className = 'font-info-title';
	title.textContent = info.family || info.familyName || 'Untitled';
	wrapper.appendChild(title);

	// -- Basic info section ------------------------------------------
	var basicSection = FontRig.FontInfoPanel._createSection('Identification');
	FontRig.FontInfoPanel._addRow(basicSection, 'Family', info.family || info.familyName || '—');
	FontRig.FontInfoPanel._addRow(basicSection, 'Style', info.style || info.styleName || '—');
	FontRig.FontInfoPanel._addRow(basicSection, 'Version', info.version || '—');
	wrapper.appendChild(basicSection);

	// -- Metrics section ---------------------------------------------
	var metricsSection = FontRig.FontInfoPanel._createSection('Metrics');
	FontRig.FontInfoPanel._addRow(metricsSection, 'UPM', metrics.upm || '—');
	FontRig.FontInfoPanel._addRow(metricsSection, 'Ascender', metrics.ascender || '—');
	FontRig.FontInfoPanel._addRow(metricsSection, 'Descender', metrics.descender || '—');
	FontRig.FontInfoPanel._addRow(metricsSection, 'x-Height', metrics.xHeight || '—');
	FontRig.FontInfoPanel._addRow(metricsSection, 'Cap Height', metrics.capHeight || '—');
	wrapper.appendChild(metricsSection);

	// -- Masters section (if any) ------------------------------------
	if (masters.length > 0) {
		var mastersSection = FontRig.FontInfoPanel._createSection('Masters');

		for (var i = 0; i < masters.length; i++) {
			var m = masters[i];
			var label = m.name || m.layerName || 'Master ' + (i + 1);
			var value = m.layerName || '';
			if (m.isDefault) value += ' (default)';
			FontRig.FontInfoPanel._addRow(mastersSection, label, value);
		}

		wrapper.appendChild(mastersSection);
	}

	// -- Glyph count -------------------------------------------------
	var glyphSection = FontRig.FontInfoPanel._createSection('Content');
	FontRig.FontInfoPanel._addRow(glyphSection, 'Glyphs',
		FontRig.font.manifest ? FontRig.font.manifest.length : 0);
	wrapper.appendChild(glyphSection);
};

// ===================================================================
// Helpers
// ===================================================================
FontRig.FontInfoPanel._createSection = function(label) {
	var section = document.createElement('div');
	section.className = 'font-info-section';

	var lbl = document.createElement('div');
	lbl.className = 'font-info-section-label';
	lbl.textContent = label;
	section.appendChild(lbl);

	return section;
};

FontRig.FontInfoPanel._addRow = function(section, label, value) {
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
};

})();
