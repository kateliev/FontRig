// ===================================================================
// FontRig — Sidebar Initialization
// ===================================================================
// Registers all sidebar-compatible widgets with SidebarConfig,
// then creates left and right sidebars using config-driven approach.
// Maintains bridge functions so the rest of the codebase can keep
// calling the same API (buildXmlPanel, switchGlyph, etc.).
//
// The popup/detachable panel system has been removed in favour of
// future multi-window workplanes. The BroadcastChannel bridge
// infrastructure in detachable-panel.js is kept intact for reuse.
// ===================================================================
'use strict';

(function() {

if (typeof FontRig === 'undefined') return;
if (!FontRig.Sidebar) return;
if (!FontRig.SidebarConfig) return;

var dom = FontRig.dom;
var SBC = FontRig.SidebarConfig;

// ===================================================================
// WIDGET REGISTRATION
// ===================================================================
// Register every sidebar-compatible widget. The mount function
// receives a container element and must build the widget DOM inside
// it. The update function is called when the tab is switched to.
// ===================================================================

// -- Glyphs Widget --------------------------------------------------
SBC.registerWidget({
	id:    'glyphs',
	label: 'Glyphs',
	icon:  'select_glyph',
	mount: function(containerEl) {
		if (FontRig.GlyphWidgetPanel) {
			FontRig.GlyphWidgetPanel.mount(containerEl);
		}
	},
	update: function() {
		// Rebuild if font is loaded but panel was lazily mounted
		if (FontRig.font && FontRig.GlyphWidgetPanel) {
			FontRig.GlyphWidgetPanel.updateActive();
		}
	}
});

// -- Font Info Widget -----------------------------------------------
SBC.registerWidget({
	id:    'font-info',
	label: 'Info',
	icon:  'file',
	mount: function(containerEl) {
		if (FontRig.FontInfoPanel) {
			FontRig.FontInfoPanel.mount(containerEl);
		}
	},
	update: function() {
		if (FontRig.FontInfoPanel) {
			FontRig.FontInfoPanel.update();
		}
	}
});

// -- XML Widget -----------------------------------------------------
// The XML content lives in #xml-tab in index.html. On first mount,
// child nodes are moved into the sidebar panel. On subsequent mounts
// (after config toggle), we locate the nodes by ID and re-parent them.
SBC.registerWidget({
	id:    'xml',
	label: 'XML',
	icon:  'code_tag',
	mount: function(containerEl) {
		// Try to find the content by ID first (may already be mounted)
		var xmlActions = document.getElementById('xml-actions');
		var xmlContent = document.getElementById('xml-content');
		var xmlTabInfo = document.getElementById('xml-tab-info');

		if (xmlActions) containerEl.appendChild(xmlActions);
		if (xmlContent) containerEl.appendChild(xmlContent);
		if (xmlTabInfo) {
			xmlTabInfo.className = 'fr-sidebar__statusbar';
			xmlTabInfo.style.display = '';
			containerEl.appendChild(xmlTabInfo);
		}

		// If the source container is now empty, hide it
		var oldXmlTab = document.getElementById('xml-tab');
		if (oldXmlTab && oldXmlTab.children.length === 0) {
			oldXmlTab.style.display = 'none';
		}
	},
	unmount: function() {
		// Move content back to the hidden source container so it
		// survives panel removal and can be re-mounted later
		var oldXmlTab = document.getElementById('xml-tab');
		if (!oldXmlTab) return;
		var xmlActions = document.getElementById('xml-actions');
		var xmlContent = document.getElementById('xml-content');
		var xmlTabInfo = document.getElementById('xml-tab-info');
		if (xmlActions) oldXmlTab.appendChild(xmlActions);
		if (xmlContent) oldXmlTab.appendChild(xmlContent);
		if (xmlTabInfo) oldXmlTab.appendChild(xmlTabInfo);
	},
	update: function() {
		if (FontRig.state.showXml) {
			FontRig.buildXmlPanel();
		}
	}
});

// -- Python Widget --------------------------------------------------
// Same pattern as XML: content lives in #python-tab and gets
// moved into the sidebar panel on mount.
SBC.registerWidget({
	id:    'python',
	label: 'Python',
	icon:  'action_play',
	mount: function(containerEl) {
		var pyOutput = document.getElementById('py-output');
		var pyInputWrap = document.getElementById('py-input-wrap');
		var pyTabInfo = document.getElementById('py-tab-info');

		if (pyOutput) containerEl.appendChild(pyOutput);
		if (pyInputWrap) containerEl.appendChild(pyInputWrap);
		if (pyTabInfo) {
			pyTabInfo.className = 'fr-sidebar__statusbar';
			pyTabInfo.style.display = '';
			containerEl.appendChild(pyTabInfo);
		}

		var oldPyTab = document.getElementById('python-tab');
		if (oldPyTab && oldPyTab.children.length === 0) {
			oldPyTab.style.display = 'none';
		}
	},
	unmount: function() {
		var oldPyTab = document.getElementById('python-tab');
		if (!oldPyTab) return;
		var pyOutput = document.getElementById('py-output');
		var pyInputWrap = document.getElementById('py-input-wrap');
		var pyTabInfo = document.getElementById('py-tab-info');
		if (pyOutput) oldPyTab.appendChild(pyOutput);
		if (pyInputWrap) oldPyTab.appendChild(pyInputWrap);
		if (pyTabInfo) oldPyTab.appendChild(pyTabInfo);
	},
	update: function() {
		var input = document.getElementById('py-input');
		if (input) setTimeout(function() { input.focus(); }, 50);
	}
});

// ===================================================================
// SIDEBAR CREATION
// ===================================================================

// -- Compute balanced default width (1/4 of main area) ---------------
var _quarterWidth = Math.round(dom.main.clientWidth * 0.25) || 280;

// -- LEFT SIDEBAR — config-driven -----------------------------------
FontRig._leftSidebar = FontRig.Sidebar.createFromConfig('left-sidebar', {
	defaultWidth: _quarterWidth,
	onTabSwitch: function(tabId, prevTabId) {
		// Widget-specific updates are handled by the framework
		// via widget.update(), but we can add extra logic here
	},
});

// -- RIGHT SIDEBAR — config-driven ----------------------------------
FontRig._rightSidebar = FontRig.Sidebar.createFromConfig('right-sidebar', {
	defaultWidth: _quarterWidth,
	onTabSwitch: function(tabId, prevTabId) {
		FontRig.state.activePanel = tabId;
	},
	onToggle: function(visible) {
		FontRig.state.showXml = visible;
	},
});

// ===================================================================
// BRIDGE FUNCTIONS
// ===================================================================
// These functions replace the old ones so that the rest of the
// codebase can keep calling the same API.
// ===================================================================

// -- Override buildXmlPanel ------------------------------------------
var origBuildXmlPanel = FontRig.buildXmlPanel;
FontRig.buildXmlPanel = function() {
	origBuildXmlPanel.apply(this, arguments);
};

// -- Override buildGlyphPanel to use the unified widget ---------------
var origBuildGlyphPanel = FontRig.buildGlyphPanel;
FontRig.buildGlyphPanel = function() {
	FontRig.Sidebar.show(FontRig._leftSidebar);
	FontRig.Sidebar.switchTab(FontRig._leftSidebar, 'glyphs');
	if (FontRig.GlyphWidgetPanel) {
		FontRig.GlyphWidgetPanel.rebuild();
	}
	if (FontRig.FontInfoPanel) {
		FontRig.FontInfoPanel.update();
	}
};

// -- Override updateGlyphPanelActive ----------------------------------
FontRig.updateGlyphPanelActive = function() {
	if (FontRig.GlyphWidgetPanel) {
		FontRig.GlyphWidgetPanel.updateActive();
	}
};

// -- Override updateGlyphPanelDirty -----------------------------------
FontRig.updateGlyphPanelDirty = function() {
	if (FontRig.GlyphWidgetPanel) {
		FontRig.GlyphWidgetPanel.updateDirty();
	}
};

// -- Override filterGlyphPanel ----------------------------------------
FontRig.filterGlyphPanel = function(query) {
	if (FontRig.GlyphWidgetPanel) {
		FontRig.GlyphWidgetPanel.filter(query);
	}
};

// -- Override refreshThumbnail ----------------------------------------
var origRefreshThumbnail = FontRig.refreshThumbnail;
FontRig.refreshThumbnail = function(name) {
	if (FontRig.GlyphWidgetPanel) {
		FontRig.GlyphWidgetPanel.refreshThumbnail(name);
	}
};

// -- Hook switchGlyph ------------------------------------------------
var origSwitchGlyph = FontRig.switchGlyph;
FontRig.switchGlyph = async function(name) {
	var result = await origSwitchGlyph.apply(this, arguments);
	return result;
};

// -- Hook openFont ---------------------------------------------------
var origOpenFont = FontRig.openFont;
FontRig.openFont = async function() {
	var result = await origOpenFont.apply(this, arguments);

	// Rebuild glyph panel after font load
	if (FontRig.GlyphWidgetPanel) {
		FontRig.GlyphWidgetPanel.rebuild();
	}

	return result;
};

// -- Helper to get font info state -----------------------------------
FontRig._getFontInfoState = function() {
	var fontInfo = null;
	if (FontRig.font && FontRig.font.info) {
		var info = FontRig.font.info;
		fontInfo = {
			familyName: info.family || info.familyName || 'Unknown',
			styleName: info.style || info.styleName || 'Regular',
			version: info.version || '',
			upm: FontRig.font.metrics ? FontRig.font.metrics.upm : 1000,
			ascender: FontRig.font.metrics ? FontRig.font.metrics.ascender : '',
			descender: FontRig.font.metrics ? FontRig.font.metrics.descender : '',
			xHeight: FontRig.font.metrics ? FontRig.font.metrics.xHeight : '',
			capHeight: FontRig.font.metrics ? FontRig.font.metrics.capHeight : '',
			masters: []
		};
		if (FontRig.font.masters) {
			for (var i = 0; i < FontRig.font.masters.length; i++) {
				var m = FontRig.font.masters[i];
				fontInfo.masters.push({
					name: m.layerName || 'Master ' + (i + 1),
					axisValues: m.axisValues || ''
				});
			}
		}
	}
	return fontInfo;
};

// ===================================================================
// Update right sidebar toggle to use new framework
// ===================================================================
FontRig._toggleRightSidebar = function() {
	FontRig.Sidebar.toggle(FontRig._rightSidebar);
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

// ===================================================================
// Hook xmlApply for consistency
// ===================================================================
var origXmlApply = FontRig.xmlApply;
FontRig.xmlApply = function() {
	origXmlApply.apply(this, arguments);
};

})();
