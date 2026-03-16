// ===================================================================
// FontRig — Sidebar Initialization (Multi-Instance)
// ===================================================================
// Registers all sidebar-compatible widgets with SidebarConfig,
// then creates left and right sidebars using config-driven approach.
//
// All widgets support cloning: the same widget type can appear in
// multiple sidebars. Bridge functions fan out to all instances.
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
// Each widget's mount() returns an instance object. The instance
// is tracked by SidebarConfig and used for all subsequent operations.
// ===================================================================

// -- Glyphs Widget --------------------------------------------------
SBC.registerWidget({
	id:    'glyphs',
	label: 'Glyphs',
	icon:  'select_glyph',
	mount: function(containerEl, ctx) {
		return FontRig.GlyphWidgetPanel.mount(containerEl, ctx);
	},
	update: function(inst) {
		if (inst && FontRig.font) {
			inst.updateActive();
		}
	}
});

// -- Font Info Widget -----------------------------------------------
SBC.registerWidget({
	id:    'font-info',
	label: 'Info',
	icon:  'file',
	mount: function(containerEl, ctx) {
		return FontRig.FontInfoPanel.mount(containerEl, ctx);
	},
	update: function(inst) {
		if (inst) inst.update();
	}
});

// -- XML Widget -----------------------------------------------------
SBC.registerWidget({
	id:    'xml',
	label: 'XML',
	icon:  'code_tag',
	mount: function(containerEl, ctx) {
		return FontRig.XmlPanel.mount(containerEl, ctx);
	},
	update: function(inst) {
		if (inst && FontRig.state.showXml) {
			inst.syncFromData();
		}
	}
});

// -- Python Widget --------------------------------------------------
SBC.registerWidget({
	id:    'python',
	label: 'Python',
	icon:  'action_play',
	mount: function(containerEl, ctx) {
		return FontRig.PythonPanel.mount(containerEl, ctx);
	},
	update: function(inst) {
		if (inst) inst.focus();
	}
});

// ===================================================================
// SIDEBAR CREATION
// ===================================================================

// Skip sidebar creation if we're in workplane context (no main DOM)
if (!dom.main) {
	console.log('[SidebarInit] Running in workplane context - skipping default sidebars');
} else {

var _quarterWidth = Math.round((dom.main?.clientWidth || 0) * 0.25) || 280;

// -- LEFT SIDEBAR ---------------------------------------------------
FontRig._leftSidebar = FontRig.Sidebar.createFromConfig('left-sidebar', {
	defaultWidth: _quarterWidth,
});

// -- RIGHT SIDEBAR --------------------------------------------------
FontRig._rightSidebar = FontRig.Sidebar.createFromConfig('right-sidebar', {
	defaultWidth: _quarterWidth,
	onTabSwitch: function(tabId, prevTabId) {
		FontRig.state.activePanel = tabId;
	},
	onToggle: function(visible) {
		FontRig.state.showXml = visible;
	},
});

}

// ===================================================================
// BRIDGE FUNCTIONS — fan out to all instances
// ===================================================================

// -- buildGlyphPanel: show left sidebar, rebuild all glyph instances
var origBuildGlyphPanel = FontRig.buildGlyphPanel;
FontRig.buildGlyphPanel = function() {
	if (FontRig._leftSidebar) {
		FontRig.Sidebar.show(FontRig._leftSidebar);
		FontRig.Sidebar.switchTab(FontRig._leftSidebar, 'glyphs');
	}

	SBC.forEachInstance('glyphs', function(inst) {
		inst.rebuild();
	});
	SBC.forEachInstance('font-info', function(inst) {
		inst.update();
	});
};

// -- updateGlyphPanelActive: update all glyph instances
FontRig.updateGlyphPanelActive = function() {
	SBC.forEachInstance('glyphs', function(inst) {
		inst.updateActive();
	});
};

// -- updateGlyphPanelDirty: update all glyph instances
FontRig.updateGlyphPanelDirty = function() {
	SBC.forEachInstance('glyphs', function(inst) {
		inst.updateDirty();
	});
};

// -- filterGlyphPanel: filter all glyph instances
FontRig.filterGlyphPanel = function(query) {
	SBC.forEachInstance('glyphs', function(inst) {
		inst.filter(query);
	});
};

// -- refreshThumbnail: refresh across all glyph instances
FontRig.refreshThumbnail = function(name) {
	// Invalidate once globally (shared cache)
	FontRig.GlyphRenderer.invalidate(name);

	SBC.forEachInstance('glyphs', function(inst) {
		inst.refreshThumbnail(name);
	});
};

// -- Hook switchGlyph: notify workplanes
// Only wrap if the function exists (not in workplane popup context)
if (FontRig.switchGlyph) {
	var origSwitchGlyph = FontRig.switchGlyph;
	FontRig.switchGlyph = async function(name) {
		var result = await origSwitchGlyph.apply(this, arguments);

		// Notify workplanes of glyph change
		if (FontRig.Workplane) {
			FontRig.Workplane.notifyGlyphChanged();
		}

		return result;
	};
}

// -- Hook openFont: rebuild all glyph instances + notify workplanes
// Only wrap if the function exists (not in workplane popup context)
if (FontRig.openFont) {
	var origOpenFont = FontRig.openFont;
	FontRig.openFont = async function() {
		var result = await origOpenFont.apply(this, arguments);

		SBC.forEachInstance('glyphs', function(inst) {
			inst.rebuild();
		});
		SBC.forEachInstance('font-info', function(inst) {
			inst.update();
		});

		// Notify workplanes of font change
		if (FontRig.Workplane) {
			FontRig.Workplane.notifyFontChanged();
		}

		return result;
	};
}

// -- Helper to get font info state
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
// Toggle helpers
// ===================================================================
FontRig._toggleRightSidebar = function() {
	if (!FontRig._rightSidebar) return;
	FontRig.Sidebar.toggle(FontRig._rightSidebar);
	if (FontRig._rightSidebar.visible && FontRig.state.activePanel === 'xml') {
		FontRig.buildXmlPanel();
	}
};

FontRig._hideLeftSidebar = function() {
	if (!FontRig._leftSidebar) return;
	FontRig.Sidebar.hide(FontRig._leftSidebar);
};

})();
