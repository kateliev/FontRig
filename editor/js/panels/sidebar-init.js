// ===================================================================
// FontRig — Sidebar Initialization
// ===================================================================
// Creates left and right sidebar instances using the Sidebar framework.
// Migrates existing XML/Python panel content into the right sidebar.
// Mounts the unified glyph widget and font info into the left sidebar.
//
// This file runs after all panel modules are loaded but before
// events.js, so the sidebars exist when event wiring runs.
// ===================================================================
'use strict';

(function() {

if (typeof FontRig === 'undefined') return;
if (!FontRig.Sidebar) return;

var dom = FontRig.dom;

// -- Compute balanced default width (1/4 of main area) ---------------
var _quarterWidth = Math.round(dom.main.clientWidth * 0.25) || 280;

// ===================================================================
// LEFT SIDEBAR — Glyphs + Font Info
// ===================================================================
FontRig._leftSidebar = FontRig.Sidebar.create({
	id: 'left-sidebar',
	position: 'left',
	defaultWidth: _quarterWidth,
	minWidth: 120,
	maxWidth: 500,
	tabs: [
		{ id: 'glyphs', label: 'Glyphs', icon: 'select_glyph' },
		{ id: 'font-info', label: 'Info', icon: 'file' }
	],
	defaultTab: 'glyphs',
	onTabSwitch: function(tabId, prevTabId) {
		if (tabId === 'font-info') {
			FontRig.FontInfoPanel.update();
		}
	}
});

// Mount glyph widget panel into the glyphs tab
var glyphsPanel = FontRig.Sidebar.getPanel(FontRig._leftSidebar, 'glyphs');
if (glyphsPanel) {
	FontRig.GlyphWidgetPanel.mount(glyphsPanel);
}

// Mount font info panel into the font-info tab
var fontInfoPanel = FontRig.Sidebar.getPanel(FontRig._leftSidebar, 'font-info');
if (fontInfoPanel) {
	FontRig.FontInfoPanel.mount(fontInfoPanel);
}

// ===================================================================
// RIGHT SIDEBAR — XML + Python (migrate existing content)
// ===================================================================
// The existing #side-panel contains the XML and Python tab contents.
// We need to move those DOM elements into the new sidebar framework.
// ===================================================================
FontRig._rightSidebar = FontRig.Sidebar.create({
	id: 'right-sidebar',
	position: 'right',
	defaultWidth: _quarterWidth,
	minWidth: 200,
	maxWidth: 800,
	tabs: [
		{ id: 'xml', label: 'XML', icon: 'code_tag' },
		{ id: 'python', label: 'Python', icon: 'action_play' }
	],
	defaultTab: 'xml',
	onTabSwitch: function(tabId, prevTabId) {
		// Replicate the existing switchPanelTab behavior
		FontRig.state.activePanel = tabId;

		if (tabId === 'xml' && FontRig.state.showXml) {
			FontRig.buildXmlPanel();
		}

		if (tabId === 'python') {
			var input = document.getElementById('py-input');
			if (input) setTimeout(function() { input.focus(); }, 50);
		}
	},
	onToggle: function(visible) {
		FontRig.state.showXml = visible;
	}
});

// Move existing XML tab content into the new right sidebar panel
var xmlPanel = FontRig.Sidebar.getPanel(FontRig._rightSidebar, 'xml');
var oldXmlTab = document.getElementById('xml-tab');
if (xmlPanel && oldXmlTab) {
	// Move all children from old xml-tab into new panel
	while (oldXmlTab.firstChild) {
		xmlPanel.appendChild(oldXmlTab.firstChild);
	}
	// Copy the class for styling
	xmlPanel.classList.add('panel-content');
}

// Move existing Python tab content into the new right sidebar panel
var pyPanel = FontRig.Sidebar.getPanel(FontRig._rightSidebar, 'python');
var oldPyTab = document.getElementById('python-tab');
if (pyPanel && oldPyTab) {
	while (oldPyTab.firstChild) {
		pyPanel.appendChild(oldPyTab.firstChild);
	}
	pyPanel.classList.add('panel-content');
}

// Now hide the old side-panel and split-handle (they're replaced)
var oldSidePanel = document.getElementById('side-panel');
if (oldSidePanel) {
	oldSidePanel.style.display = 'none';
}
var oldSplitHandle = document.getElementById('split-handle');
if (oldSplitHandle) {
	oldSplitHandle.style.display = 'none';
}

// Also hide the old glyph-panel (replaced by left sidebar)
var oldGlyphPanel = document.getElementById('glyph-panel');
if (oldGlyphPanel) {
	oldGlyphPanel.style.display = 'none';
	oldGlyphPanel.classList.remove('visible');
}

// ===================================================================
// BRIDGE FUNCTIONS
// ===================================================================
// These functions replace the old ones in font.js so that the rest
// of the codebase can keep calling the same API.
// ===================================================================

// -- Override buildGlyphPanel to use the unified widget ---------------
var origBuildGlyphPanel = FontRig.buildGlyphPanel;
FontRig.buildGlyphPanel = function() {
	// Show the left sidebar
	FontRig.Sidebar.show(FontRig._leftSidebar);
	FontRig.Sidebar.switchTab(FontRig._leftSidebar, 'glyphs');

	// Rebuild the glyph widget
	FontRig.GlyphWidgetPanel.rebuild();

	// Update font info if that tab exists
	FontRig.FontInfoPanel.update();
};

// -- Override updateGlyphPanelActive ----------------------------------
FontRig.updateGlyphPanelActive = function() {
	FontRig.GlyphWidgetPanel.updateActive();
};

// -- Override updateGlyphPanelDirty -----------------------------------
FontRig.updateGlyphPanelDirty = function() {
	FontRig.GlyphWidgetPanel.updateDirty();
};

// -- Override filterGlyphPanel ----------------------------------------
FontRig.filterGlyphPanel = function(query) {
	FontRig.GlyphWidgetPanel.filter(query);
};

// -- Override refreshThumbnail ----------------------------------------
var origRefreshThumbnail = FontRig.refreshThumbnail;
FontRig.refreshThumbnail = function(name) {
	FontRig.GlyphWidgetPanel.refreshThumbnail(name);

	// Also send to detached font panel if it exists
	if (FontRig.fontPanelBridge && FontRig.fontPanelBridge.isDetached) {
		FontRig._sendThumbnailToPanel(name);
	}
};

// ===================================================================
// Update right sidebar toggle to use new framework
// ===================================================================
// The btn-panel click handler in events.js needs to work with the
// new sidebar. We provide a helper that events.js will call.
// ===================================================================
FontRig._toggleRightSidebar = function() {
	FontRig.Sidebar.toggle(FontRig._rightSidebar);
	// If showing, also rebuild XML if on XML tab
	if (FontRig._rightSidebar.visible && FontRig.state.activePanel === 'xml') {
		FontRig.buildXmlPanel();
	}
};

// ===================================================================
// Handle loose .trglyph file loading (hide left sidebar)
// ===================================================================
FontRig._hideLeftSidebar = function() {
	FontRig.Sidebar.hide(FontRig._leftSidebar);
};

})();
