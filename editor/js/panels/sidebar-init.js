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
			return {
				fontInfo: fontInfo,
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

			var cvs = document.createElement('canvas');
			cvs.width = 28;
			cvs.height = 36;
			FontRig._fontPanelRenderThumb(cvs, glyphData);

			var dataUrl = cvs.toDataURL('image/png');
			FontRig.DetachablePanel.send('glyphs', 'thumbnail', { name: name, data: dataUrl });

			if (FontRig._thumbDetachQueue.length > 0 && FontRig._thumbDetachQueue.length % 8 === 0) {
				await new Promise(function(r) { requestAnimationFrame(r); });
			}
		}

		FontRig._thumbDetachRunning = false;
	};

	FontRig._fontPanelRenderThumb = function(cvs, glyphData) {
		var ctx = cvs.getContext('2d');
		var w = cvs.width;
		var h = cvs.height;

		var layerName = FontRig.getDefaultLayerName(glyphData);
		var layer = FontRig.getLayerByName(glyphData, layerName);
		if (!layer || layer.shapes.length === 0) return;

		var upm = FontRig.font ? FontRig.font.metrics.upm : 1000;
		var desc = FontRig.font ? Math.abs(FontRig.font.metrics.descender) : 200;
		var advW = layer.width || upm;
		var totalH = upm + desc * 0.3;

		var scale = Math.min((w - 4) / advW, (h - 4) / totalH);
		var ox = (w - advW * scale) / 2;
		var oy = h - 3 - desc * 0.3 * scale;

		ctx.clearRect(0, 0, w, h);

		ctx.beginPath();
		for (var si = 0; si < layer.shapes.length; si++) {
			var shape = layer.shapes[si];
			for (var ki = 0; ki < shape.contours.length; ki++) {
				var contour = shape.contours[ki];
				if (!contour.closed || contour.nodes.length === 0) continue;
				FontRig._traceContourToPath(ctx, contour.nodes, scale, ox, oy);
			}
		}

		ctx.fillStyle = 'rgba(200,200,210,0.55)';
		ctx.fill('nonzero');
	};

	FontRig._traceContourToPath = function(ctx, nodes, scale, ox, oy) {
		var n = nodes.length;
		if (n === 0) return;

		var firstOn = 0;
		for (var j = 0; j < n; j++) {
			if (nodes[j].type === 'on') { firstOn = j; break; }
		}

		var tx = function(x) { return x * scale + ox; };
		var ty = function(y) { return -y * scale + oy; };

		ctx.moveTo(tx(nodes[firstOn].x), ty(nodes[firstOn].y));

		var i = (firstOn + 1) % n;
		var count = 0;

		while (count < n - 1) {
			var node = nodes[i];

			if (node.type === 'on') {
				ctx.lineTo(tx(node.x), ty(node.y));
			} else if (node.type === 'curve') {
				var b1 = node;
				var b2 = nodes[(i + 1) % n];
				var on = nodes[(i + 2) % n];
				ctx.bezierCurveTo(tx(b1.x), ty(b1.y), tx(b2.x), ty(b2.y), tx(on.x), ty(on.y));
				i = (i + 2) % n;
				count += 2;
			} else if (node.type === 'off') {
				var off = node;
				var on = nodes[(i + 1) % n];
				ctx.quadraticCurveTo(tx(off.x), ty(off.y), tx(on.x), ty(on.y));
				i = (i + 1) % n;
				count += 1;
			}

			i = (i + 1) % n;
			count++;
		}

		ctx.closePath();
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
	var result = origSwitchGlyph.apply(this, arguments);

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
	var result = origOpenFont.apply(this, arguments);

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
