// ===================================================================
// FontRig — Sidebar Initialization
// ===================================================================
// Creates left and right sidebar instances using the Sidebar framework.
// Sets up per-tab detach functionality using the generic DetachablePanel system.
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
	},
	onDetach: function(tabId) {
		if (FontRig.DetachablePanel) {
			FontRig.DetachablePanel.detach(tabId);
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
// RIGHT SIDEBAR — XML + Python
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
	},
	onDetach: function(tabId) {
		if (FontRig.DetachablePanel) {
			FontRig.DetachablePanel.detach(tabId);
		}
	}
});

// Move existing XML tab content into the new right sidebar panel
var xmlPanel = FontRig.Sidebar.getPanel(FontRig._rightSidebar, 'xml');
var oldXmlTab = document.getElementById('xml-tab');
if (xmlPanel && oldXmlTab) {
	while (oldXmlTab.firstChild) {
		xmlPanel.appendChild(oldXmlTab.firstChild);
	}
	var xmlTabInfo = document.getElementById('xml-tab-info');
	if (xmlTabInfo) {
		xmlTabInfo.className = 'fr-sidebar__statusbar';
		xmlTabInfo.style.display = '';
		xmlPanel.appendChild(xmlTabInfo);
	}
}

// Move existing Python tab content into the new right sidebar panel
var pyPanel = FontRig.Sidebar.getPanel(FontRig._rightSidebar, 'python');
var oldPyTab = document.getElementById('python-tab');
if (pyPanel && oldPyTab) {
	while (oldPyTab.firstChild) {
		pyPanel.appendChild(oldPyTab.firstChild);
	}
	var pyTabInfo = document.getElementById('py-tab-info');
	if (pyTabInfo) {
		pyTabInfo.className = 'fr-sidebar__statusbar';
		pyTabInfo.style.display = '';
		pyPanel.appendChild(pyTabInfo);
	}
}

// Hide the source containers after content has been moved out
var oldXmlTabEl = document.getElementById('xml-tab');
if (oldXmlTabEl && oldXmlTabEl.children.length === 0) {
	oldXmlTabEl.style.display = 'none';
}
var oldPyTabEl = document.getElementById('python-tab');
if (oldPyTabEl && oldPyTabEl.children.length === 0) {
	oldPyTabEl.style.display = 'none';
}

// ===================================================================
// DETACHABLE PANEL SETUP
// ===================================================================
if (FontRig.DetachablePanel) {

	// -- XML Panel --
	FontRig.DetachablePanel.create({
		id: 'xml',
		sidebar: FontRig._rightSidebar,
		tabId: 'xml',
		width: 500,
		getState: function() {
			var xml = '';
			if (FontRig.state.glyphData) {
				xml = FontRig.formatXml(FontRig.glyphToXml(FontRig.state.glyphData));
			}
			var layer = FontRig.getActiveLayer();
			var allNodes = layer ? FontRig.getAllNodes(layer) : [];
			var onCount = allNodes.filter(function(n) { return n.type === 'on'; }).length;

			return {
				xml: xml,
				glyphName: FontRig.state.glyphData ? FontRig.state.glyphData.name : '',
				activeLayer: FontRig.state.activeLayer || '',
				nodeCount: { on: onCount, off: allNodes.length - onCount },
				parseStatus: 'ok'
			};
		},
		onMessage: function(msg) {
			if (msg.type === 'xmlApply') {
				FontRig.dom.xmlContent.value = msg.xml;
				FontRig.xmlApply();
			} else if (msg.type === 'xmlRefresh') {
				FontRig.xmlRefresh();
			} else if (msg.type === 'selectNode') {
				FontRig.highlightXmlNode(msg.nodeId);
			}
		},
		onDetach: function() {
			// Hide the sidebar when detaching
		},
		onAttach: function() {
			// Optionally show sidebar when reattaching
		}
	});

	// -- Python Panel --
	FontRig.DetachablePanel.create({
		id: 'python',
		sidebar: FontRig._rightSidebar,
		tabId: 'python',
		width: 500,
		getState: function() {
			return { glyphName: FontRig.state.glyphData ? FontRig.state.glyphData.name : '' };
		},
		onMessage: function(msg) {
			if (msg.type === 'pyExecute') {
				FontRig._detachedPanelPyExecute(msg.code, msg.id);
			}
		}
	});

	// -- Glyphs Panel --
	FontRig.DetachablePanel.create({
		id: 'glyphs',
		sidebar: FontRig._leftSidebar,
		tabId: 'glyphs',
		width: 350,
		getState: function() {
			var glyphList = [];
			if (FontRig.font && FontRig.font.manifest) {
				for (var i = 0; i < FontRig.font.manifest.length; i++) {
					var entry = FontRig.font.manifest[i];
					glyphList.push({
						name: entry.alias || entry.name,
						unicode: entry.unicodes || null
					});
				}
			}
			return {
				glyphList: glyphList,
				glyphCount: FontRig.font ? FontRig.font.manifest.length : 0,
				currentGlyph: FontRig.state.glyphData ? FontRig.state.glyphData.name : null
			};
		},
		onMessage: function(msg) {
			if (msg.type === 'selectGlyph' && msg.glyphName) {
				FontRig.switchGlyph(msg.glyphName);
			} else if (msg.type === 'requestThumbnail') {
				FontRig._sendThumbnailToDetachedPanel(msg.glyphName);
			}
		}
	});

	// -- Font Info Panel --
	FontRig.DetachablePanel.create({
		id: 'font-info',
		sidebar: FontRig._leftSidebar,
		tabId: 'font-info',
		width: 350,
		getState: function() {
			return {
				fontInfo: FontRig._getFontInfoState(),
				glyphCount: FontRig.font ? FontRig.font.manifest.length : 0
			};
		}
	});

	// -- Python execution from detached panel --
	FontRig._detachedPanelPyExecute = function(code, msgId) {
		if (!FontRig.pyBridge || !FontRig.pyBridge.ready) {
			FontRig.DetachablePanel.send('python', 'pyResult', {
				id: msgId,
				error: 'Python not ready. Click Init in main window to load.'
			});
			return;
		}

		// pyBridge.run() is synchronous (Pyodide's runPython is sync).
		// If this ever becomes async, this call must be awaited.
		var result = FontRig.pyBridge.run(code);

		FontRig.DetachablePanel.send('python', 'pyResult', {
			id: msgId,
			output: result.output || '',
			error: result.error || null,
			glyphChanged: result.glyphChanged || false
		});

		if (result.glyphChanged) {
			FontRig.buildXmlPanel();
		}
	};

	// -- Thumbnail sending to detached glyphs panel --
	FontRig._thumbDetachQueue = [];
	FontRig._thumbDetachRunning = false;

	FontRig._sendThumbnailToDetachedPanel = function(name) {
		FontRig._thumbDetachQueue.push(name);
		FontRig._processThumbDetachQueue();
	};

	FontRig._processThumbDetachQueue = async function() {
		if (FontRig._thumbDetachRunning) return;
		FontRig._thumbDetachRunning = true;

		// Render at DPR-scaled resolution for crisp thumbnails.
		// The detached panel will receive the full-resolution PNG
		// and draw it directly (no further upscaling needed).
		var dpr = window.devicePixelRatio || 1;
		var cssW = 28;
		var cssH = 36;

		while (FontRig._thumbDetachQueue.length > 0) {
			var name = FontRig._thumbDetachQueue.shift();

			var cacheEntry = FontRig.glyphCache ? FontRig.glyphCache.get(name) : null;
			var glyphData = cacheEntry ? cacheEntry.glyphData : null;

			if (!glyphData) {
				glyphData = await FontRig.loadGlyphFile(name);
			}

			if (!glyphData) {
				FontRig.DetachablePanel.send('glyphs', 'thumbnail', { name: name, data: null });
				continue;
			}

			// Reuse GlyphRenderer which handles DPR, Path2D caching,
			// and proper vector rendering — same quality as sidebar.
			var cvs = document.createElement('canvas');
			cvs.style.width = cssW + 'px';
			cvs.style.height = cssH + 'px';
			cvs.dataset.cssW = cssW;
			cvs.dataset.cssH = cssH;

			FontRig.GlyphRenderer.render(cvs, glyphData, {
				glyphName: name,
				fillStyle: 'rgba(200,200,210,0.55)'
			});

			// Send the DPR-scaled dimensions along with the image data
			// so the detached panel can set the correct canvas size.
			var dataUrl = cvs.toDataURL('image/png');
			FontRig.DetachablePanel.send('glyphs', 'thumbnail', {
				name: name,
				data: dataUrl,
				width: cvs.width,
				height: cvs.height
			});

			if (FontRig._thumbDetachQueue.length > 0 && FontRig._thumbDetachQueue.length % 8 === 0) {
				await new Promise(function(r) { requestAnimationFrame(r); });
			}
		}

		FontRig._thumbDetachRunning = false;
	};
}

// ===================================================================
// BRIDGE FUNCTIONS
// ===================================================================
// These functions replace the old ones in font.js so that the rest
// of the codebase can keep calling the same API.
// ===================================================================

// -- Override buildXmlPanel to broadcast to detached panels ---------------
var origBuildXmlPanel = FontRig.buildXmlPanel;
FontRig.buildXmlPanel = function() {
	origBuildXmlPanel.apply(this, arguments);
	if (FontRig.DetachablePanel) {
		var xml = '';
		if (FontRig.state.glyphData) {
			xml = FontRig.formatXml(FontRig.glyphToXml(FontRig.state.glyphData));
		}
		var layer = FontRig.getActiveLayer();
		var allNodes = layer ? FontRig.getAllNodes(layer) : [];
		var onCount = allNodes.filter(function(n) { return n.type === 'on'; }).length;

		FontRig.DetachablePanel.send('xml', 'stateUpdate', {
			xml: xml,
			glyphName: FontRig.state.glyphData ? FontRig.state.glyphData.name : '',
			activeLayer: FontRig.state.activeLayer || '',
			nodeCount: { on: onCount, off: allNodes.length - onCount },
			parseStatus: 'ok'
		});
	}
};

// -- Override buildGlyphPanel to use the unified widget ---------------
var origBuildGlyphPanel = FontRig.buildGlyphPanel;
FontRig.buildGlyphPanel = function() {
	FontRig.Sidebar.show(FontRig._leftSidebar);
	FontRig.Sidebar.switchTab(FontRig._leftSidebar, 'glyphs');
	FontRig.GlyphWidgetPanel.rebuild();
	FontRig.FontInfoPanel.update();
};

// -- Override updateGlyphPanelActive ----------------------------------
FontRig.updateGlyphPanelActive = function() {
	FontRig.GlyphWidgetPanel.updateActive();

	// Notify detached glyphs panel
	if (FontRig.DetachablePanel) {
		var panel = FontRig.DetachablePanel.get('glyphs');
		if (panel && panel.isDetached) {
			panel.send('stateUpdate', {
				currentGlyph: FontRig.state.glyphData ? FontRig.state.glyphData.name : null
			});
		}
	}
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

	// Also send to detached glyphs panel
	if (FontRig.DetachablePanel) {
		var panel = FontRig.DetachablePanel.get('glyphs');
		if (panel && panel.isDetached) {
			FontRig._sendThumbnailToDetachedPanel(name);
		}
	}
};

// -- Hook switchGlyph to notify detached panels ----------------------
var origSwitchGlyph = FontRig.switchGlyph;
FontRig.switchGlyph = async function(name) {
	var result = await origSwitchGlyph.apply(this, arguments);

	// Notify detached panels
	if (FontRig.DetachablePanel) {
		// Glyphs panel
		var glyphsPanel = FontRig.DetachablePanel.get('glyphs');
		if (glyphsPanel && glyphsPanel.isDetached) {
			glyphsPanel.send('stateUpdate', { currentGlyph: name });
		}

		// XML panel
		var xmlPanel = FontRig.DetachablePanel.get('xml');
		if (xmlPanel && xmlPanel.isDetached) {
			var xml = '';
			if (FontRig.state.glyphData) {
				xml = FontRig.formatXml(FontRig.glyphToXml(FontRig.state.glyphData));
			}
			var layer = FontRig.getActiveLayer();
			var allNodes = layer ? FontRig.getAllNodes(layer) : [];
			var onCount = allNodes.filter(function(n) { return n.type === 'on'; }).length;

			xmlPanel.send('stateUpdate', {
				xml: xml,
				glyphName: name,
				activeLayer: FontRig.state.activeLayer || '',
				nodeCount: { on: onCount, off: allNodes.length - onCount }
			});
		}

		// Python panel
		var pythonPanel = FontRig.DetachablePanel.get('python');
		if (pythonPanel && pythonPanel.isDetached) {
			pythonPanel.send('stateUpdate', { glyphName: name });
		}
	}

	return result;
};

// -- Hook openFont to notify detached panels ------------------------
var origOpenFont = FontRig.openFont;
FontRig.openFont = async function() {
	var result = await origOpenFont.apply(this, arguments);

	if (FontRig.DetachablePanel) {
		// Rebuild and notify glyphs panel
		FontRig.GlyphWidgetPanel.rebuild();
		var glyphsPanel = FontRig.DetachablePanel.get('glyphs');
		if (glyphsPanel && glyphsPanel.isDetached) {
			var glyphList = [];
			if (FontRig.font && FontRig.font.manifest) {
				for (var i = 0; i < FontRig.font.manifest.length; i++) {
					var entry = FontRig.font.manifest[i];
					glyphList.push({
						name: entry.alias || entry.name,
						unicode: entry.unicodes || null
					});
				}
			}
			glyphsPanel.send('stateUpdate', {
				glyphList: glyphList,
				glyphCount: FontRig.font ? FontRig.font.manifest.length : 0,
				currentGlyph: FontRig.state.glyphData ? FontRig.state.glyphData.name : null
			});
		}

		// Notify font-info panel
		var fontInfoPanel = FontRig.DetachablePanel.get('font-info');
		if (fontInfoPanel && fontInfoPanel.isDetached) {
			fontInfoPanel.send('stateUpdate', {
				fontInfo: FontRig._getFontInfoState(),
				glyphCount: FontRig.font ? FontRig.font.manifest.length : 0
			});
		}
	}

	return result;
};

// -- Helper to get font info state ---------------------------------
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
// Hook xmlApply to notify detached panels when XML is applied
// ===================================================================
var origXmlApply = FontRig.xmlApply;
FontRig.xmlApply = function() {
	origXmlApply.apply(this, arguments);

	if (FontRig.DetachablePanel) {
		var xmlPanel = FontRig.DetachablePanel.get('xml');
		if (xmlPanel && xmlPanel.isDetached) {
			var xml = FontRig.dom.xmlContent.value;
			var layer = FontRig.getActiveLayer();
			var allNodes = layer ? FontRig.getAllNodes(layer) : [];
			var onCount = allNodes.filter(function(n) { return n.type === 'on'; }).length;

			xmlPanel.send('stateUpdate', {
				xml: xml,
				glyphName: FontRig.state.glyphData ? FontRig.state.glyphData.name : '',
				activeLayer: FontRig.state.activeLayer || '',
				nodeCount: { on: onCount, off: allNodes.length - onCount },
				parseStatus: 'ok'
			});
		}
	}
};

})();
