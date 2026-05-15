// ===================================================================
// FontRig — Font-level operations (.trfont)
// ===================================================================
// Handles .trfont folder open/save via File System Access API.
// Lazy glyph loading with LRU cache and per-glyph undo stacks.
'use strict';

// -- Font state -----------------------------------------------------
// In workplane context these are bridged from the main window via
// window.opener — skip re-initialization to preserve the live references.
if (!FontRig._isWorkplane) {
	FontRig.font = null;            // null = loose .trglyph mode
	FontRig.glyphCache = new Map(); // name → { glyphData, undoStack, redoStack, selection, pan, zoom }
	FontRig.dirtyGlyphs = new Set();
	FontRig.activeGlyph = null;     // current glyph name
	FontRig.workspace = {
		glyphs: [],       // ordered glyph names in strip (user-controlled)
		activeIdx: 0,     // index of active glyph in strip
	};
}
FontRig.CACHE_MAX = 32;         // LRU eviction threshold

// -- Resolve default layer name for thumbnails & strip ---------------
// Priority: font master default → 'Regular' → first non-mask layer
FontRig.getDefaultLayerName = function(glyphData) {
	if (!glyphData || !glyphData.layers || glyphData.layers.length === 0) return null;

	// 1. If font has masters defined, use the default master's layer name
	if (FontRig.font && FontRig.font.masters && FontRig.font.masters.length > 0) {
		for (var i = 0; i < FontRig.font.masters.length; i++) {
			if (FontRig.font.masters[i].isDefault) {
				var lname = FontRig.font.masters[i].layerName;
				for (var j = 0; j < glyphData.layers.length; j++) {
					if (glyphData.layers[j].name === lname) return lname;
				}
			}
		}
		// Fallback: first master's layer name
		var firstMasterLayer = FontRig.font.masters[0].layerName;
		for (var j = 0; j < glyphData.layers.length; j++) {
			if (glyphData.layers[j].name === firstMasterLayer) return firstMasterLayer;
		}
	}

	// 2. Try 'Regular'
	for (var j = 0; j < glyphData.layers.length; j++) {
		if (glyphData.layers[j].name === 'Regular') return 'Regular';
	}

	// 3. First non-mask layer
	for (var j = 0; j < glyphData.layers.length; j++) {
		if (!FontRig.isMaskLayer(glyphData.layers[j].name)) return glyphData.layers[j].name;
	}

	// 4. Whatever's there
	return glyphData.layers[0].name;
};

// -- Parse font.xml -------------------------------------------------
FontRig.parseFontXml = function(xmlString) {
	var parser = new DOMParser();
	var doc = parser.parseFromString(xmlString, 'text/xml');
	var root = doc.documentElement;

	// Info: <info> → <meta key="..." value="..."/>
	var info = { family: 'Untitled', style: 'Regular' };
	var infoEl = root.querySelector('info');
	if (infoEl) {
		var metas = infoEl.querySelectorAll('meta');
		for (var i = 0; i < metas.length; i++) {
			var k = metas[i].getAttribute('key');
			var v = metas[i].getAttribute('value') || '';
			if (k === 'family-name') info.family = v;
			else if (k === 'style-name') info.style = v;
		}
	}

	// Metrics: <metrics upm="..." ascender="..." .../>
	var metrics = { upm: 1000, ascender: 800, descender: -200, xHeight: 500, capHeight: 700 };
	var metricsEl = root.querySelector('metrics');
	if (metricsEl) {
		var _int = function(attr, def) {
			var v = metricsEl.getAttribute(attr);
			return v !== null ? parseInt(v) : def;
		};
		metrics.upm       = _int('upm', 1000);
		metrics.ascender  = _int('ascender', 800);
		metrics.descender = _int('descender', -200);
		metrics.xHeight   = _int('x-height', 500);
		metrics.capHeight = _int('cap-height', 700);
	}

	// Masters: <masters> → <master name="..." layer="..." default="true"/>
	var masters = [];
	var masterEls = root.querySelectorAll('masters > master');
	for (var i = 0; i < masterEls.length; i++) {
		masters.push({
			name: masterEls[i].getAttribute('name') || '',
			layerName: masterEls[i].getAttribute('layer') || masterEls[i].getAttribute('name') || '',
			isDefault: masterEls[i].getAttribute('default') === 'true'
		});
	}

	// Encoding: <encoding> → <entry name="..." unicodes="0041 0042"/>
	var encoding = {};
	var encEls = root.querySelectorAll('encoding > entry');
	for (var i = 0; i < encEls.length; i++) {
		var name = encEls[i].getAttribute('name');
		var val = encEls[i].getAttribute('unicodes');
		if (name && val) encoding[name] = val;
	}

	return { info: info, metrics: metrics, masters: masters, encoding: encoding };
};

// -- Parse glyphs.xml -----------------------------------------------
FontRig.parseGlyphsManifest = function(xmlString) {
	var parser = new DOMParser();
	var doc = parser.parseFromString(xmlString, 'text/xml');
	var root = doc.documentElement;

	var entries = [];
	var index = {};
	var glyphEls = root.querySelectorAll('glyph');

	for (var i = 0; i < glyphEls.length; i++) {
		var el = glyphEls[i];
		var entry = {
			name: el.getAttribute('name') || '',
			path: el.getAttribute('src') || '',
			alias: el.getAttribute('alias') || ''
		};
		entries.push(entry);
		var key = entry.alias || entry.name;
		index[key] = entry;
	}

	return { entries: entries, index: index };
};

// -- Read file from directory handle --------------------------------
FontRig._readFile = async function(dirHandle, relativePath) {
	var parts = relativePath.replace(/\\/g, '/').split('/');
	var current = dirHandle;

	// Navigate subdirectories
	for (var i = 0; i < parts.length - 1; i++) {
		current = await current.getDirectoryHandle(parts[i]);
	}

	var fileHandle = await current.getFileHandle(parts[parts.length - 1]);
	var file = await fileHandle.getFile();
	return await file.text();
};

// -- Write file to directory handle ---------------------------------
FontRig._writeFile = async function(dirHandle, relativePath, content) {
	var parts = relativePath.replace(/\\/g, '/').split('/');
	var current = dirHandle;

	// Navigate/create subdirectories
	for (var i = 0; i < parts.length - 1; i++) {
		current = await current.getDirectoryHandle(parts[i], { create: true });
	}

	var fileHandle = await current.getFileHandle(parts[parts.length - 1], { create: true });
	var writable = await fileHandle.createWritable();
	await writable.write(content);
	await writable.close();
};

// -- Open .trfont folder --------------------------------------------
FontRig.openFont = async function() {
	try {
		var dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });

		// Read font.xml
		var fontXml;
		try {
			fontXml = await FontRig._readFile(dirHandle, 'font.xml');
		} catch (e) {
			alert('Not a valid .trfont folder: font.xml not found.');
			return;
		}

		// Read glyphs.xml
		var glyphsXml;
		try {
			glyphsXml = await FontRig._readFile(dirHandle, 'glyphs.xml');
		} catch (e) {
			alert('Not a valid .trfont folder: glyphs.xml not found.');
			return;
		}

		var fontData = FontRig.parseFontXml(fontXml);
		var manifest = FontRig.parseGlyphsManifest(glyphsXml);

		// Attach encoding unicodes to manifest entries
		for (var i = 0; i < manifest.entries.length; i++) {
			var entry = manifest.entries[i];
			var key = entry.alias || entry.name;
			if (fontData.encoding[key]) {
				entry.unicodes = fontData.encoding[key];
			}
		}

		// Store font state
		FontRig.font = {
			dirHandle: dirHandle,
			info: fontData.info,
			metrics: fontData.metrics,
			masters: fontData.masters,
			encoding: fontData.encoding,
			manifest: manifest.entries,
			manifestIndex: manifest.index
		};

		// Clear previous state
		FontRig.glyphCache.clear();
		FontRig.dirtyGlyphs.clear();
		FontRig.activeGlyph = null;
		FontRig.GlyphRenderer.clearCache();

		// Update UI
		FontRig.buildGlyphPanel();
		FontRig.updateFontInfo();

		// Load first glyph
		if (manifest.entries.length > 0) {
			await FontRig.switchGlyph(manifest.entries[0].alias || manifest.entries[0].name);
		}

	} catch (e) {
		if (e.name !== 'AbortError') {
			console.error('openFont error:', e);
			alert('Error opening font: ' + e.message);
		}
	}
};

// -- Load a single glyph from disk ----------------------------------
FontRig.loadGlyphFile = async function(name) {
	if (!FontRig.font) return null;

	var entry = FontRig.font.manifestIndex[name];
	if (!entry) return null;

	try {
		var xmlString = await FontRig._readFile(FontRig.font.dirHandle, entry.path);
		var glyphData = FontRig.parseGlyphXML(xmlString);
		return glyphData;
	} catch (e) {
		console.error('Error loading glyph "' + name + '":', e);
		return null;
	}
};

// -- Switch active glyph -------------------------------------------
FontRig.switchGlyph = async function(name) {
	if (!FontRig.font) return;
	if (name === FontRig.activeGlyph) return;

	// Stash current glyph state into cache
	if (FontRig.activeGlyph && FontRig.glyphCache.has(FontRig.activeGlyph)) {
		var current = FontRig.glyphCache.get(FontRig.activeGlyph);
		current.selection = new Set(FontRig.state.selectedNodeIds);
		current.pan = { x: FontRig.state.pan.x, y: FontRig.state.pan.y };
		current.zoom = FontRig.state.zoom;
	}

	// Load glyph if not cached
	if (!FontRig.glyphCache.has(name)) {
		var glyphData = await FontRig.loadGlyphFile(name);
		if (!glyphData) return;

		FontRig.glyphCache.set(name, {
			glyphData: glyphData,
			undoStack: [],
			redoStack: [],
			selection: new Set(),
			pan: null,
			zoom: null
		});

		// LRU eviction
		FontRig._evictCache();
	}

	// Activate
	var entry = FontRig.glyphCache.get(name);
	FontRig.activeGlyph = name;
	FontRig.state.glyphData = entry.glyphData;
	FontRig.state.rawXml = '';

	// Hobby contours arrive with empty .nodes (the persisted truth is
	// .knots). Solve once now so the renderer has bezier nodes to walk.
	// If Pyodide isn't ready, auto-init it; the bridge's ready handler
	// will re-run the solve and redraw once initialization completes.
	if (typeof FontRig.solveAllHobbyContours === 'function') {
		FontRig.solveAllHobbyContours(entry.glyphData);
	}
	if (typeof FontRig.ensureHobbySolverReady === 'function') {
		FontRig.ensureHobbySolverReady(entry.glyphData);
	}

	// Restore per-glyph state
	FontRig.state.selectedNodeIds = entry.selection;

	// Populate layer dropdown
	FontRig.dom.layerSelect.innerHTML = '';
	for (var i = 0; i < entry.glyphData.layers.length; i++) {
		var layer = entry.glyphData.layers[i];
		var opt = document.createElement('option');
		opt.value = layer.name;
		opt.textContent = layer.name || '(unnamed)';
		FontRig.dom.layerSelect.appendChild(opt);
	}

	//if (entry.glyphData.layers.length > 0) {
	//	FontRig.state.activeLayer = entry.glyphData.layers[0].name;
	//	FontRig.dom.layerSelect.value = FontRig.state.activeLayer;
	//}

	// Glyph info in toolbar
	var g = entry.glyphData;
	var enc = FontRig.font.encoding[name] || g.unicodes || '';
	var infoHtml = '<span>' + (g.name || name) + '</span>';
	if (enc) infoHtml += ' U+' + enc;
	FontRig.dom.glyphInfo.innerHTML = infoHtml;

	FontRig.dom.emptyState.classList.add('hidden');

	// Restore or fit viewport (skip in strip mode — zoom persists)
	if (FontRig.state.glyphViewMode && FontRig.font) {
		// Strip mode: zoom stays, just update strip membership
	} else if (entry.pan !== null) {
		FontRig.state.pan = entry.pan;
		FontRig.state.zoom = entry.zoom;
	} else {
		FontRig.fitToView();
	}

	// Re-init multi-view if active
	if (FontRig.state.glyphViewMode) {
		FontRig.updateWorkspaceStrip();
		FontRig.state.activeCell = { row: 0, col: 0 };
		FontRig.syncActiveCellToLayer();
	} else if (FontRig.state.multiView) {
		FontRig.initMultiGrid();
	}

	FontRig.buildXmlPanel();
	FontRig.draw();
	FontRig.updateStatusSelected();
	FontRig.updateGlyphPanelActive();
};

// -- LRU eviction ---------------------------------------------------
FontRig._evictCache = function() {
	if (FontRig.glyphCache.size <= FontRig.CACHE_MAX) return;

	// Evict oldest entries that aren't dirty or active
	var keys = Array.from(FontRig.glyphCache.keys());
	for (var i = 0; i < keys.length; i++) {
		if (FontRig.glyphCache.size <= FontRig.CACHE_MAX) break;
		var k = keys[i];
		if (k === FontRig.activeGlyph) continue;
		if (FontRig.dirtyGlyphs.has(k)) continue;
		FontRig.glyphCache.delete(k);
	}
};

// -- Per-glyph undo integration -------------------------------------
// These replace the global stacks when a font is open.
FontRig._getUndoEntry = function() {
	if (!FontRig.font || !FontRig.activeGlyph) return null;
	return FontRig.glyphCache.get(FontRig.activeGlyph) || null;
};

// -- Save dirty glyphs to disk --------------------------------------
FontRig.saveDirtyGlyphs = async function() {
	if (!FontRig.font || FontRig.dirtyGlyphs.size === 0) return;

	var saved = 0;
	var errors = [];

	for (var name of FontRig.dirtyGlyphs) {
		var entry = FontRig.glyphCache.get(name);
		if (!entry) continue;

		var manifestEntry = FontRig.font.manifestIndex[name];
		if (!manifestEntry) continue;

		try {
			var xmlString = FontRig.glyphToXml(entry.glyphData);
			await FontRig._writeFile(FontRig.font.dirHandle, manifestEntry.path, xmlString);
			saved++;
		} catch (e) {
			errors.push(name + ': ' + e.message);
		}
	}

	FontRig.dirtyGlyphs.clear();
	FontRig.updateGlyphPanelDirty();

	if (errors.length > 0) {
		alert('Saved ' + saved + ' glyphs. Errors:\n' + errors.join('\n'));
	}
};

// -- Glyph panel stubs ----------------------------------------------
// Original implementations below are overridden by sidebar-init.js
// which mounts GlyphWidgetPanel into the sidebar framework.
// These stubs exist so the functions are defined before the override.
FontRig.buildGlyphPanel = function() {};
FontRig.refreshThumbnail = function() {};
FontRig.updateGlyphPanelActive = function() {};
FontRig.updateGlyphPanelDirty = function() {};
FontRig.updateGlyphPanelMark = function() {};
FontRig.filterGlyphPanel = function() {};

// -- Update font info in toolbar ------------------------------------
FontRig.updateFontInfo = function() {
	if (!FontRig.font) return;
	var info = FontRig.font.info;
	document.title = FontRig.getCurrentTheme().appTitle + ' | ' + info.family + ' ' + info.style;
};


// -- Unsaved changes warning ----------------------------------------
window.addEventListener('beforeunload', function(e) {
	if (FontRig.dirtyGlyphs.size > 0) {
		e.preventDefault();
		e.returnValue = '';
	}
});

// -- Step to next/previous glyph in manifest ------------------------
FontRig.stepGlyph = function(direction) {
	if (!FontRig.font || !FontRig.activeGlyph) return;

	var manifest = FontRig.font.manifest;
	var idx = -1;
	for (var i = 0; i < manifest.length; i++) {
		var name = manifest[i].alias || manifest[i].name;
		if (name === FontRig.activeGlyph) { idx = i; break; }
	}

	if (idx < 0) return;

	var newIdx = idx + direction;
	if (newIdx < 0) newIdx = manifest.length - 1;
	if (newIdx >= manifest.length) newIdx = 0;

	var newName = manifest[newIdx].alias || manifest[newIdx].name;
	FontRig.switchGlyph(newName);
};

// -- Build font.xml string from a config ----------------------------
FontRig._buildFontXml = function(cfg) {
	var esc = FontRig.esc || function(s){ return String(s); };
	var lines = [];
	lines.push('<?xml version="1.0" encoding="UTF-8"?>');
	lines.push('<font>');
	lines.push('  <info>');
	lines.push('    <meta key="family-name" value="' + esc(cfg.family) + '"/>');
	lines.push('    <meta key="style-name"  value="' + esc(cfg.style)  + '"/>');
	if (cfg.italicAngle) lines.push('    <meta key="italic-angle" value="' + cfg.italicAngle + '"/>');
	lines.push('  </info>');
	lines.push('  <metrics upm="' + cfg.upm + '" ascender="' + cfg.ascender +
	           '" descender="' + cfg.descender + '" x-height="' + cfg.xHeight +
	           '" cap-height="' + cfg.capHeight + '"/>');
	lines.push('  <masters>');
	lines.push('    <master name="' + esc(cfg.master) + '" layer="' + esc(cfg.master) + '" default="true"/>');
	lines.push('  </masters>');
	lines.push('  <encoding>');
	if (cfg.encoding) {
		var keys = Object.keys(cfg.encoding);
		for (var i = 0; i < keys.length; i++) {
			var v = cfg.encoding[keys[i]];
			if (v) lines.push('    <entry name="' + esc(keys[i]) + '" unicodes="' + esc(v) + '"/>');
		}
	}
	lines.push('  </encoding>');
	lines.push('</font>');
	return lines.join('\n');
};

// -- Build glyphs.xml string from a manifest array ------------------
FontRig._buildGlyphsManifestXml = function(manifest) {
	var esc = FontRig.esc || function(s){ return String(s); };
	var lines = [];
	lines.push('<?xml version="1.0" encoding="UTF-8"?>');
	lines.push('<glyphs>');
	for (var i = 0; i < manifest.length; i++) {
		var e = manifest[i];
		var attrs = 'name="' + esc(e.name) + '" src="' + esc(e.path) + '"';
		if (e.alias) attrs += ' alias="' + esc(e.alias) + '"';
		lines.push('  <glyph ' + attrs + '/>');
	}
	lines.push('</glyphs>');
	return lines.join('\n');
};

// -- Rewrite glyphs.xml on disk -------------------------------------
FontRig._writeGlyphsManifest = async function() {
	if (!FontRig.font) return;
	var xml = FontRig._buildGlyphsManifestXml(FontRig.font.manifest);
	await FontRig._writeFile(FontRig.font.dirHandle, 'glyphs.xml', xml);
};

// -- Rewrite font.xml on disk ---------------------------------------
FontRig._writeFontXml = async function() {
	if (!FontRig.font) return;
	var f = FontRig.font;
	var cfg = {
		family:     f.info.family,
		style:      f.info.style,
		master:     (f.masters && f.masters[0] && f.masters[0].name) || 'Regular',
		upm:        f.metrics.upm,
		ascender:   f.metrics.ascender,
		descender:  f.metrics.descender,
		xHeight:    f.metrics.xHeight,
		capHeight:  f.metrics.capHeight,
		italicAngle: f.info.italicAngle || 0,
		encoding:   f.encoding
	};
	var xml = FontRig._buildFontXml(cfg);
	await FontRig._writeFile(f.dirHandle, 'font.xml', xml);
};

// -- Create new .trfont folder + open it ----------------------------
FontRig.createNewFont = async function() {
	if (typeof FRWidget === 'undefined' || !FRWidget.NewFontDialog) {
		alert('Dialog module not loaded.');
		return;
	}
	var cfg = await FRWidget.NewFontDialog();
	if (!cfg) return;

	var parentDir;
	try {
		parentDir = await window.showDirectoryPicker({ mode: 'readwrite' });
	} catch (e) {
		if (e.name !== 'AbortError') alert('Could not open directory picker: ' + e.message);
		return;
	}

	var folderName = (cfg.family + '-' + cfg.style).replace(/[\\/:*?"<>|\s]+/g, '_') + '.trfont';
	var dirHandle;
	try {
		dirHandle = await parentDir.getDirectoryHandle(folderName, { create: true });
	} catch (e) {
		alert('Could not create folder "' + folderName + '": ' + e.message);
		return;
	}

	// Write font.xml + empty glyphs.xml + create empty glyphs/ subfolder
	cfg.encoding = {};
	await FontRig._writeFile(dirHandle, 'font.xml', FontRig._buildFontXml(cfg));
	await FontRig._writeFile(dirHandle, 'glyphs.xml', FontRig._buildGlyphsManifestXml([]));
	await dirHandle.getDirectoryHandle('glyphs', { create: true });

	// Populate FontRig.font state
	FontRig.font = {
		dirHandle: dirHandle,
		info: { family: cfg.family, style: cfg.style, italicAngle: cfg.italicAngle },
		metrics: {
			upm: cfg.upm, ascender: cfg.ascender, descender: cfg.descender,
			xHeight: cfg.xHeight, capHeight: cfg.capHeight
		},
		masters: [{ name: cfg.master, layerName: cfg.master, isDefault: true }],
		encoding: {},
		manifest: [],
		manifestIndex: {}
	};

	FontRig.glyphCache.clear();
	FontRig.dirtyGlyphs.clear();
	FontRig.activeGlyph = null;
	if (FontRig.GlyphRenderer && FontRig.GlyphRenderer.clearCache) FontRig.GlyphRenderer.clearCache();

	FontRig.buildGlyphPanel();
	if (typeof FontRig.updateFontInfo === 'function') FontRig.updateFontInfo();
};

// -- Add new glyph to current font ----------------------------------
FontRig.createNewGlyph = async function() {
	if (!FontRig.font) {
		alert('Open or create a font first.');
		return;
	}
	if (typeof FRWidget === 'undefined' || !FRWidget.NewGlyphDialog) {
		alert('Dialog module not loaded.');
		return;
	}

	var defaultWidth = (FontRig.font.metrics && FontRig.font.metrics.upm) || 1000;
	var cfg = await FRWidget.NewGlyphDialog({ defaultWidth: defaultWidth });
	if (!cfg) return;

	if (FontRig.font.manifestIndex[cfg.name]) {
		alert('A glyph named "' + cfg.name + '" already exists.');
		return;
	}

	// Build minimal glyph data — one layer per master
	var masters = FontRig.font.masters && FontRig.font.masters.length
		? FontRig.font.masters
		: [{ name: 'Regular', layerName: 'Regular', isDefault: true }];
	var upm = FontRig.font.metrics.upm || 1000;

	var glyphData = {
		name: cfg.name,
		identifier: '',
		unicodes: cfg.unicodes || '',
		mark: '',
		selected: false,
		layers: masters.map(function (m) {
			return {
				name: m.layerName || m.name,
				identifier: '',
				width: cfg.width,
				height: upm,
				shapes: [],
				anchors: [],
				lib: {}
			};
		})
	};

	var xmlString = FontRig.glyphToXml(glyphData);
	var relPath = 'glyphs/' + cfg.name + '.trglyph';
	await FontRig._writeFile(FontRig.font.dirHandle, relPath, xmlString);

	// Update manifest + encoding in memory and on disk
	var entry = { name: cfg.name, path: relPath, alias: '', unicodes: cfg.unicodes || '' };
	FontRig.font.manifest.push(entry);
	FontRig.font.manifestIndex[cfg.name] = entry;
	if (cfg.unicodes) FontRig.font.encoding[cfg.name] = cfg.unicodes;

	await FontRig._writeGlyphsManifest();
	await FontRig._writeFontXml();

	// Refresh UI + switch to new glyph
	FontRig.buildGlyphPanel();
	await FontRig.switchGlyph(cfg.name);
};

// -- Export current glyph as SVG ------------------------------------
// mode: 'bw' (black filled, type-design output) or 'color' (per-contour debug)
FontRig.exportCurrentGlyphAsSVG = function(mode) {
	if (!FontRig.pyBridge || !FontRig.pyBridge.ready) {
		alert('Python runtime is not ready yet.');
		return;
	}
	if (!FontRig.state.glyphData) return;

	FontRig.pyBridge.syncToPython();

	var svg;
	try {
		svg = FontRig.pyBridge.pyodide.runPython(
			'from typerig.core.fileio.svgio import glyph_to_SVG\n' +
			'glyph_to_SVG(glyph, mode="' + (mode === 'bw' ? 'bw' : 'color') + '") if glyph is not None else ""'
		);
	} catch (e) {
		console.error('SVG export failed:', e);
		alert('SVG export failed: ' + e.message);
		return;
	}
	if (!svg) return;

	var name = (FontRig.state.glyphData && FontRig.state.glyphData.name) || 'glyph';
	var suffix = (mode === 'bw') ? '.svg' : '_debug.svg';
	var blob = new Blob([svg], { type: 'image/svg+xml' });
	var url = URL.createObjectURL(blob);
	var a = document.createElement('a');
	a.href = url;
	a.download = name + suffix;
	a.click();
	URL.revokeObjectURL(url);
};
