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
			if (FontRig.showMessage) FontRig.showMessage('Invalid font', 'Not a valid .trfont folder: font.xml not found.'); else alert('Not a valid .trfont folder: font.xml not found.');
			return;
		}

		// Read glyphs.xml
		var glyphsXml;
		try {
			glyphsXml = await FontRig._readFile(dirHandle, 'glyphs.xml');
		} catch (e) {
			if (FontRig.showMessage) FontRig.showMessage('Invalid font', 'Not a valid .trfont folder: glyphs.xml not found.'); else alert('Not a valid .trfont folder: glyphs.xml not found.');
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
			if (FontRig.showMessage) FontRig.showMessage('Open failed', 'Error opening font: ' + e.message); else alert('Error opening font: ' + e.message);
		}
	}
};

// -- Load a single glyph from disk ----------------------------------
FontRig.loadGlyphFile = async function(name) {
	if (!FontRig.font) return null;

	var entry = FontRig.font.manifestIndex[name];
	if (!entry) return null;

	try {
		var xmlString;
		// In-memory mode: font was loaded from a UFO/Designspace into MEMFS
		// and never written to a real folder. Serve glyph XML from the map
		// the loader stashed on FontRig.font.memGlyphs.
		if (FontRig.font.memGlyphs) {
			xmlString = FontRig.font.memGlyphs[name];
			if (xmlString == null) {
				// Some loaders may key by alias; try the alias too.
				var alias = entry.alias || entry.name;
				xmlString = FontRig.font.memGlyphs[alias];
			}
			if (xmlString == null) {
				console.error('In-memory glyph "' + name + '" not in memGlyphs');
				return null;
			}
		} else {
			xmlString = await FontRig._readFile(FontRig.font.dirHandle, entry.path);
		}
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
	// LRU touch: re-insert so this glyph moves to the most-recently-used
	// (back) end of the Map. _evictCache drops from the front, so without
	// this a revisited glyph stays at its original FIFO position and can
	// be evicted before glyphs never looked at again.
	FontRig.glyphCache.delete(name);
	FontRig.glyphCache.set(name, entry);
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

	// Snapshot the names first — we delete from dirtyGlyphs only on a
	// confirmed write, so a failed/skipped glyph keeps its dirty flag and
	// its edits survive to the next save. Iterate a copy to allow mutation.
	var names = Array.from(FontRig.dirtyGlyphs);
	for (var i = 0; i < names.length; i++) {
		var name = names[i];
		var entry = FontRig.glyphCache.get(name);
		if (!entry) {
			errors.push(name + ': not in cache (evicted?) — still unsaved');
			continue;
		}

		var manifestEntry = FontRig.font.manifestIndex[name];
		if (!manifestEntry) {
			errors.push(name + ': no manifest entry — still unsaved');
			continue;
		}

		try {
			var xmlString = FontRig.glyphToXml(entry.glyphData);
			await FontRig._writeFile(FontRig.font.dirHandle, manifestEntry.path, xmlString);
			FontRig.dirtyGlyphs.delete(name);
			saved++;
		} catch (e) {
			errors.push(name + ': ' + e.message + ' — still unsaved');
		}
	}

	FontRig.updateGlyphPanelDirty();

	if (errors.length > 0) {
		var msg = 'Saved ' + saved + ' glyph' + (saved === 1 ? '' : 's') + '.\n\n' +
			errors.length + ' still unsaved:\n' + errors.join('\n');
		if (FontRig.showMessage) FontRig.showMessage('Save — partial failure', msg);
		else alert(msg);
	}
};

// -- Case-safe .trglyph filename mangler ----------------------------
// Mirrors UFO's userNameToFileName scheme so .trfont survives on
// case-insensitive filesystems (Windows NTFS, macOS APFS):
//   - Every uppercase letter is followed by a trailing underscore:
//       A → A_, AE → A_E_, foo → foo, Foo → F_oo
//   - Reserved Windows device names (CON, PRN, AUX, NUL, COM1…, LPT1…)
//     get an underscore prefix.
//   - Disallowed path chars are replaced with '_'.
//   - If two different glyph names still collide after mangling,
//     a numeric suffix is appended: foo, foo000000000000001, …
// Pass a `taken` Set of already-used (lowercased) filenames; it is
// mutated as new names are reserved.
FontRig._safeGlyphFilename = (function() {
	var DISALLOWED = /[\x00-\x1f\x7f"*+/:<>?\[\\\]|]/g;
	var RESERVED  = /^(con|prn|aux|nul|com[1-9]|lpt[1-9]|clock\$)$/i;

	function mangle(name) {
		var out = '';
		for (var i = 0; i < name.length; i++) {
			var ch = name.charAt(i);
			if (ch >= 'A' && ch <= 'Z') out += ch + '_';
			else out += ch;
		}
		out = out.replace(DISALLOWED, '_');
		if (RESERVED.test(out)) out = '_' + out;
		if (out.length === 0) out = '_';
		return out;
	}

	return function safeGlyphFilename(name, taken) {
		var base = mangle(String(name));
		var candidate = base + '.trglyph';
		if (!taken.has(candidate.toLowerCase())) {
			taken.add(candidate.toLowerCase());
			return candidate;
		}
		// Collision after mangling — append numeric suffix until unique.
		for (var n = 1; n < 1e9; n++) {
			var suffix = String(n);
			while (suffix.length < 15) suffix = '0' + suffix;
			candidate = base + suffix + '.trglyph';
			if (!taken.has(candidate.toLowerCase())) {
				taken.add(candidate.toLowerCase());
				return candidate;
			}
		}
		throw new Error('Could not allocate unique filename for "' + name + '"');
	};
})();

// -- Rebuild manifest entry paths to be case-safe -------------------
// Walks the live manifest and assigns a fresh, collision-free
// `path = "glyphs/<mangled>.trglyph"` to every entry. Mutates entries
// in place so the editor's in-memory state matches what hits disk.
// Returns the updated manifest (same array reference).
FontRig._remangleManifestPaths = function(manifest) {
	var taken = new Set();
	for (var i = 0; i < manifest.length; i++) {
		var e = manifest[i];
		var key = e.alias || e.name;
		var fname = FontRig._safeGlyphFilename(key, taken);
		e.path = 'glyphs/' + fname;
	}
	return manifest;
};

// -- Serialize glyphs.xml from the live manifest --------------------
// Source of truth: FontRig.font.manifest (the same array that drives
// the glyph panel). Regenerating instead of copying the raw string we
// captured at load means on-disk order always matches what's on screen.
FontRig._buildGlyphsXmlFromManifest = function(manifest) {
	function esc(s) {
		return String(s == null ? '' : s)
			.replace(/&/g, '&amp;').replace(/</g, '&lt;')
			.replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}
	var out = ['<?xml version="1.0" encoding="UTF-8"?>', '<glyphs>'];
	for (var i = 0; i < manifest.length; i++) {
		var e = manifest[i];
		var name = e.name || (e.alias || '');
		var path = e.path || ('glyphs/' + (e.alias || name) + '.trglyph');
		var attrs = 'name="' + esc(name) + '" src="' + esc(path) + '"';
		if (e.alias) attrs += ' alias="' + esc(e.alias) + '"';
		out.push('\t<glyph ' + attrs + '/>');
	}
	out.push('</glyphs>', '');
	return out.join('\n');
};

// -- Save the entire font to a new .trfont folder (Save As) ---------
// Writes a complete .trfont snapshot to a user-picked directory:
// font.xml, glyphs.xml, optional features.fea / groups.xml, and every
// glyph file. Dirty glyphs are serialized from the cache; clean glyphs
// are read from the current dirHandle or from memGlyphs (in-memory mode
// after Load Designspace). On success the editor switches its working
// dirHandle to the new folder.
FontRig.saveFontAs = async function() {
	if (!FontRig.font) {
		if (FontRig.showMessage) FontRig.showMessage('No font', 'No font is open.');
		else alert('No font is open.');
		return;
	}

	var outHandle;
	try {
		outHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
	} catch (e) {
		if (e.name !== 'AbortError') {
			if (FontRig.showMessage) FontRig.showMessage('Pick folder failed', String(e && e.stack || e));
			else alert('Pick folder failed: ' + e.message);
		}
		return;
	}

	var spinner = (FontRig._ufoSpinner) || null;
	if (spinner) await spinner.show('Saving font…');

	var writeText = async function(rel, text) {
		await FontRig._writeFile(outHandle, rel, text);
	};

	try {
		// font.xml ------------------------------------------------------
		var fontXml = FontRig.font.rawFontXml;
		if (!fontXml && FontRig.font.dirHandle) {
			fontXml = await FontRig._readFile(FontRig.font.dirHandle, 'font.xml');
		}
		if (!fontXml) throw new Error('font.xml is not available to copy.');
		if (spinner && spinner._label) spinner._label.textContent = 'Writing font.xml…';
		await writeText('font.xml', fontXml);

		// glyphs.xml ----------------------------------------------------
		// Rewrite every entry's `path` with a case-safe mangled filename
		// BEFORE serializing glyphs.xml, so the manifest references the
		// exact filenames we're about to write. Without this, glyphs A
		// and a collide on Windows/macOS and the second write clobbers
		// the first. Mirrors UFO's userNameToFileName scheme.
		var manifest  = FontRig.font.manifest || [];
		FontRig._remangleManifestPaths(manifest);
		var glyphsXml = FontRig._buildGlyphsXmlFromManifest(manifest);
		await writeText('glyphs.xml', glyphsXml);
		FontRig.font.rawGlyphsXml = glyphsXml;
		// Refresh manifestIndex pointers in case they got out of sync.
		var newIndex = {};
		for (var mi = 0; mi < manifest.length; mi++) {
			var me = manifest[mi];
			newIndex[me.alias || me.name] = me;
		}
		FontRig.font.manifestIndex = newIndex;

		// Optional siblings --------------------------------------------
		var fea = FontRig.font.rawFeatures;
		if (fea == null && FontRig.font.dirHandle) {
			try { fea = await FontRig._readFile(FontRig.font.dirHandle, 'features.fea'); }
			catch (_) { fea = null; }
		}
		if (fea) await writeText('features.fea', fea);

		var groups = FontRig.font.rawGroupsXml;
		if (groups == null && FontRig.font.dirHandle) {
			try { groups = await FontRig._readFile(FontRig.font.dirHandle, 'groups.xml'); }
			catch (_) { groups = null; }
		}
		if (groups) await writeText('groups.xml', groups);

		// Per-glyph files ----------------------------------------------
		var manifest = FontRig.font.manifest || [];
		var total    = manifest.length;
		var errors   = [];

		for (var i = 0; i < manifest.length; i++) {
			var entry = manifest[i];
			var key   = entry.alias || entry.name;
			var rel   = (entry.path || ('glyphs/' + key + '.trglyph')).replace(/\\/g, '/');

			if (spinner && spinner._label) {
				spinner._label.textContent =
					'Writing glyphs (' + (i + 1) + '/' + total + ')…';
			}

			var xml = null;

			// 1. Dirty in-memory wins (serialize live structure).
			if (FontRig.dirtyGlyphs.has(key)) {
				var cached = FontRig.glyphCache.get(key);
				if (cached && cached.glyphData && FontRig.glyphToXml) {
					xml = FontRig.glyphToXml(cached.glyphData);
				}
			}
			// 2. In-memory map (font loaded from UFO, no dirHandle yet).
			if (xml == null && FontRig.font.memGlyphs) {
				xml = FontRig.font.memGlyphs[key];
				if (xml == null) xml = FontRig.font.memGlyphs[entry.name];
			}
			// 3. Read from current dirHandle.
			if (xml == null && FontRig.font.dirHandle) {
				try { xml = await FontRig._readFile(FontRig.font.dirHandle, rel); }
				catch (e) { errors.push(key + ': ' + e.message); }
			}

			if (xml == null) {
				errors.push(key + ': source missing');
				continue;
			}

			try {
				await writeText(rel, xml);
			} catch (e) {
				errors.push(key + ': ' + e.message);
			}
		}

		// Switch the live font to the new location.
		FontRig.font.dirHandle      = outHandle;
		FontRig.font.memGlyphs      = null;
		FontRig.font.memfsTrfontPath = null;
		FontRig.font.displayLabel   = outHandle.name;
		FontRig.dirtyGlyphs.clear();
		if (FontRig.updateGlyphPanelDirty) FontRig.updateGlyphPanelDirty();
		if (FontRig.updateFontInfo)        FontRig.updateFontInfo();

		if (errors.length) {
			var report = 'Saved with ' + errors.length + ' error(s):\n\n' + errors.join('\n');
			if (FontRig.showMessage) FontRig.showMessage('Save As — partial failure', report);
			else alert(report);
		} else if (FontRig.setStatus) {
			FontRig.setStatus('Saved as ' + outHandle.name + '.');
		}
	} catch (e) {
		var detail = String(e && e.stack || e);
		if (FontRig.showMessage) FontRig.showMessage('Save As failed', detail);
		else alert('Save As failed: ' + detail);
	} finally {
		if (spinner) spinner.hide();
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
		if (FontRig.showMessage) FontRig.showMessage('Dialog unavailable', 'Dialog module not loaded.'); else alert('Dialog module not loaded.');
		return;
	}
	var cfg = await FRWidget.NewFontDialog();
	if (!cfg) return;

	var parentDir;
	try {
		parentDir = await window.showDirectoryPicker({ mode: 'readwrite' });
	} catch (e) {
		if (e.name !== 'AbortError') { if (FontRig.showMessage) FontRig.showMessage('Pick folder failed', 'Could not open directory picker: ' + e.message); else alert('Could not open directory picker: ' + e.message); }
		return;
	}

	var folderName = (cfg.family + '-' + cfg.style).replace(/[\\/:*?"<>|\s]+/g, '_') + '.trfont';
	var dirHandle;
	try {
		dirHandle = await parentDir.getDirectoryHandle(folderName, { create: true });
	} catch (e) {
		if (FontRig.showMessage) FontRig.showMessage('Create folder failed', 'Could not create folder "' + folderName + '": ' + e.message); else alert('Could not create folder "' + folderName + '": ' + e.message);
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
		if (FontRig.showMessage) FontRig.showMessage('No font', 'Open or create a font first.'); else alert('Open or create a font first.');
		return;
	}
	if (typeof FRWidget === 'undefined' || !FRWidget.NewGlyphDialog) {
		if (FontRig.showMessage) FontRig.showMessage('Dialog unavailable', 'Dialog module not loaded.'); else alert('Dialog module not loaded.');
		return;
	}

	var defaultWidth = (FontRig.font.metrics && FontRig.font.metrics.upm) || 1000;
	var cfg = await FRWidget.NewGlyphDialog({ defaultWidth: defaultWidth });
	if (!cfg) return;

	if (FontRig.font.manifestIndex[cfg.name]) {
		if (FontRig.showMessage) FontRig.showMessage('Name in use', 'A glyph named "' + cfg.name + '" already exists.'); else alert('A glyph named "' + cfg.name + '" already exists.');
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

// -- SVG export helpers ---------------------------------------------
FontRig._safeFileName = function(s) {
	return String(s || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
};

FontRig._downloadBlob = function(content, filename, mime) {
	var blob = new Blob([content], { type: mime || 'application/octet-stream' });
	var url = URL.createObjectURL(blob);
	var a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
};

// Editor fallback metrics — match drawing.js when no font is open.
FontRig._FALLBACK_METRICS = { upm: 1000, ascender: 800, descender: -200 };

// Resolve vertical metrics from the open font, or fall back to the
// editor defaults the canvas itself uses to display the glyph.
FontRig._currentExportMetrics = function() {
	if (FontRig.font && FontRig.font.metrics) {
		var m = FontRig.font.metrics;
		return {
			upm:       m.upm       || FontRig._FALLBACK_METRICS.upm,
			ascender:  m.ascender  != null ? m.ascender  : FontRig._FALLBACK_METRICS.ascender,
			descender: m.descender != null ? m.descender : FontRig._FALLBACK_METRICS.descender
		};
	}
	return Object.assign({}, FontRig._FALLBACK_METRICS);
};

// Render one layer of the current glyph to an SVG document string,
// using a font-canvas viewBox (advance width × ascender..descender).
// `canvas`: { ascender, descender, advance? } in font units. If
// advance is null the layer's own advance_width is used.
FontRig._runSvgExport = function(mode, layerName, canvas) {
	if (!FontRig.pyBridge || !FontRig.pyBridge.ready) {
		if (FontRig.showMessage) FontRig.showMessage('Not ready', 'Python runtime is not ready yet.'); else alert('Python runtime is not ready yet.');
		return '';
	}
	FontRig.pyBridge.syncToPython();
	try {
		FontRig.pyBridge.pyodide.globals.set('_svg_cfg_json', JSON.stringify({
			mode:      (mode === 'bw') ? 'bw' : 'color',
			layer:     layerName,
			ascender:  canvas.ascender,
			descender: canvas.descender,
			advance:   (canvas.advance != null) ? canvas.advance : null
		}));
		return FontRig.pyBridge.pyodide.runPython([
			'from typerig.core.fileio.svgio import layer_to_SVG, _format_float',
			'from xml.etree import ElementTree as ET',
			'import json as _json',
			'',
			'# OpenType SVG convention (W3C / Microsoft Learn): y=0 is the',
			'# baseline; SVG y axis points down, so the ascender region is at',
			'# negative y and the descender region at positive y. The full',
			'# canvas spans (0, -ascender) -> (advance, -descender).',
			'def _fr_export_svg(g, cfg):',
			'    if g is None: return ""',
			'    lyr = None',
			'    for l in g.data:',
			'        if l.name == cfg["layer"]:',
			'            lyr = l; break',
			'    if lyr is None: return ""',
			'',
			'    ascender  = float(cfg["ascender"])',
			'    descender = float(cfg["descender"])',
			'    adv = cfg.get("advance")',
			'    if adv is None:',
			'        adv = getattr(lyr, "advance_width", None) or getattr(lyr, "width", 0)',
			'    width  = float(adv)',
			'    height = ascender - descender',
			'    if width <= 0 or height <= 0:',
			'        return ""',
			'',
			'    svg = ET.Element("svg", {',
			'        "xmlns":   "http://www.w3.org/2000/svg",',
			'        "width":   _format_float(width),',
			'        "height":  _format_float(height),',
			'        "viewBox": "0 {} {} {}".format(',
			'            _format_float(-ascender),',
			'            _format_float(width),',
			'            _format_float(height)),',
			'    })',
			'    meta = ET.SubElement(svg, "metadata")',
			'    ET.SubElement(meta, "glyphname").text = str(g.name)',
			'    ET.SubElement(meta, "layername").text = str(lyr.name)',
			'    ET.SubElement(meta, "ascender").text  = _format_float(ascender)',
			'    ET.SubElement(meta, "descender").text = _format_float(descender)',
			'    ET.SubElement(meta, "advance").text   = _format_float(width)',
			'',
			'    # Background rect covers the EM canvas in viewBox space.',
			'    ET.SubElement(svg, "rect", {',
			'        "x":      "0",',
			'        "y":      _format_float(-ascender),',
			'        "width":  _format_float(width),',
			'        "height": _format_float(height),',
			'        "fill":   "#FFFFFF",',
			'    })',
			'',
			'    # layer_to_SVG emits a <g> with transform',
			'    #   translate(-x_min, y_max) scale(1, -1)',
			'    # Passing x_min=0, y_max=0 reduces that to a pure Y-flip',
			'    # (scale(1,-1)), so path coordinates remain in font-native',
			'    # form with the baseline at SVG y=0 — matching the OT-SVG',
			'    # specification.',
			'    group = layer_to_SVG(lyr, mode=cfg["mode"], scale=1.0,',
			'                         x_min=0, y_min=descender, y_max=0)',
			'    svg.append(group)',
			'    return ET.tostring(svg, encoding="unicode")',
			'',
			'_fr_export_svg(glyph, _json.loads(_svg_cfg_json))'
		].join('\n')) || '';
	} catch (e) {
		console.error('SVG export failed:', e);
		if (FontRig.showMessage) FontRig.showMessage('SVG export failed', 'SVG export failed: ' + e.message); else alert('SVG export failed: ' + e.message);
		return '';
	}
};

// Export the currently active layer as a single SVG file.
FontRig.exportCurrentLayerAsSVG = function(mode) {
	if (!FontRig.state.glyphData) return;
	var layer = (typeof FontRig.getActiveLayer === 'function') ? FontRig.getActiveLayer() : null;
	if (!layer) { if (FontRig.showMessage) FontRig.showMessage('No layer', 'No active layer.'); else alert('No active layer.'); return; }

	var m = FontRig._currentExportMetrics();
	var svg = FontRig._runSvgExport(mode, layer.name, {
		ascender:  m.ascender,
		descender: m.descender,
		advance:   (layer.width != null) ? layer.width : null
	});
	if (!svg) return;

	var gName  = FontRig._safeFileName(FontRig.state.glyphData.name || 'glyph');
	var lName  = FontRig._safeFileName(layer.name);
	var suffix = (mode === 'bw') ? '.svg' : '_debug.svg';
	FontRig._downloadBlob(svg, gName + '-' + lName + suffix, 'image/svg+xml');
};

// Export every layer of the current glyph as a separate SVG file,
// using the pattern "glyph_name-layer_name.svg". Each file uses the
// font canvas (advance × ascender..descender). Prefers
// showDirectoryPicker for a single user choice; falls back to
// sequential blob downloads.
FontRig.exportAllLayersAsSVG = async function(mode) {
	if (!FontRig.state.glyphData) return;
	var gd = FontRig.state.glyphData;
	if (!gd.layers || gd.layers.length === 0) return;

	var m = FontRig._currentExportMetrics();
	var suffix = (mode === 'bw') ? '.svg' : '_debug.svg';
	var gName  = FontRig._safeFileName(gd.name || 'glyph');

	var files = [];
	for (var i = 0; i < gd.layers.length; i++) {
		var lyr = gd.layers[i];
		var svg = FontRig._runSvgExport(mode, lyr.name, {
			ascender:  m.ascender,
			descender: m.descender,
			advance:   (lyr.width != null) ? lyr.width : null
		});
		if (svg) {
			files.push({
				name: gName + '-' + FontRig._safeFileName(lyr.name) + suffix,
				content: svg
			});
		}
	}
	if (files.length === 0) return;

	if (typeof window.showDirectoryPicker === 'function') {
		try {
			var dir = await window.showDirectoryPicker({ mode: 'readwrite' });
			for (var j = 0; j < files.length; j++) {
				await FontRig._writeFile(dir, files[j].name, files[j].content);
			}
			return;
		} catch (e) {
			if (e && e.name === 'AbortError') return;
			console.warn('Directory picker unavailable, falling back to downloads:', e);
		}
	}

	for (var k = 0; k < files.length; k++) {
		FontRig._downloadBlob(files[k].content, files[k].name, 'image/svg+xml');
	}
};
