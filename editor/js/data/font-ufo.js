// ===================================================================
// FontRig — UFO / Designspace IO handlers
// ===================================================================
// Wires the File menu entries (Load/Save Designspace, Export UFO Master(s),
// Import UFO as Master) to the TypeRig UfoConverter running in Pyodide.
//
// All conversion happens in Python (typerig.core.fileio.ufo). The JS side
// only stages the user's picked directory into Pyodide MEMFS, runs the
// converter, then either populates editor state from the result (load) or
// copies the produced files out to the user's chosen folder (save).
// ===================================================================
'use strict';

// -- Utilities ------------------------------------------------------

FontRig._ufoRequirePy = function() {
	if (!FontRig.pyBridge || !FontRig.pyBridge.ready) {
		FontRig.showMessage('Not ready', 'Python runtime is not ready yet.\nWait for the bottom-status "Ready." then try again.');
		return false;
	}
	if (!FontRig.pyBridge.pyodide.globals.get('UfoConverter')) {
		FontRig.showMessage('UFO not loaded', 'UFO support failed to load. Check the browser console for import errors.');
		return false;
	}
	return true;
};

// Run a small Python snippet with stdout/stderr captured and return
// { ok, output, error }. Does not touch the viewer-sync globals that
// pyBridge.run() manipulates — this is for one-shot IO calls.
FontRig._runPythonCaptured = function(code) {
	var py = FontRig.pyBridge.pyodide;
	py.runPython(
		'import io as _io, sys as _sys\n' +
		'_capture = _io.StringIO()\n' +
		'_old_stdout = _sys.stdout\n' +
		'_old_stderr = _sys.stderr\n' +
		'_sys.stdout = _capture\n' +
		'_sys.stderr = _capture\n'
	);
	var error = null;
	try {
		py.runPython(code);
	} catch (e) {
		error = String(e.message || e).replace(/^PythonError:\s*/i, '');
	}
	var output = '';
	try { output = py.runPython('_capture.getvalue()'); } catch (_) {}
	try {
		py.runPython(
			'_sys.stdout = _old_stdout\n' +
			'_sys.stderr = _old_stderr\n' +
			'del _capture, _old_stdout, _old_stderr, _io, _sys\n'
		);
	} catch (_) {}
	return { ok: error == null, output: output, error: error };
};

// -- Copy-friendly error / message dialog --------------------------
// Replacement for window.alert. The body sits in a readonly textarea
// so the user can select-all + copy (Ctrl+A, Ctrl+C) and paste the
// full text. Scrolls for long output. A dedicated Copy button copies
// to the clipboard with one click.
FontRig.showMessage = function(title, body) {
	body = (body == null) ? '' : String(body);

	// Build once, reuse for stacked messages (last one wins).
	if (!FontRig._msgEl) {
		var overlay = document.createElement('div');
		overlay.style.cssText = [
			'position:fixed', 'inset:0', 'z-index:100000',
			'background:rgba(0,0,0,0.55)',
			'display:flex', 'align-items:center', 'justify-content:center',
			'font:13px/1.4 sans-serif',
		].join(';');

		var box = document.createElement('div');
		box.style.cssText = [
			'background:#1d1f22', 'color:#e6e6e6',
			'border:1px solid #444', 'border-radius:6px',
			'padding:16px 18px',
			'min-width:480px', 'max-width:80vw',
			'max-height:80vh',
			'display:flex', 'flex-direction:column', 'gap:10px',
			'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
		].join(';');

		var titleEl = document.createElement('div');
		titleEl.style.cssText = 'font-weight:600;font-size:14px;';

		var ta = document.createElement('textarea');
		ta.readOnly = true;
		ta.spellcheck = false;
		ta.style.cssText = [
			'flex:1', 'min-height:120px', 'max-height:60vh',
			'width:100%', 'box-sizing:border-box',
			'background:#111', 'color:#e6e6e6',
			'border:1px solid #333', 'border-radius:4px',
			'padding:10px',
			'font:12px/1.45 ui-monospace,Consolas,monospace',
			'resize:vertical', 'white-space:pre',
		].join(';');

		var btnRow = document.createElement('div');
		btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

		var copyBtn = document.createElement('button');
		copyBtn.textContent = 'Copy';
		copyBtn.style.cssText = 'padding:6px 12px;cursor:pointer;';
		copyBtn.onclick = function() {
			ta.select();
			try {
				if (navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(ta.value);
				} else {
					document.execCommand('copy');
				}
				copyBtn.textContent = 'Copied!';
				setTimeout(function() { copyBtn.textContent = 'Copy'; }, 1200);
			} catch (e) {
				copyBtn.textContent = 'Copy failed';
				setTimeout(function() { copyBtn.textContent = 'Copy'; }, 1500);
			}
		};

		var closeBtn = document.createElement('button');
		closeBtn.textContent = 'Close';
		closeBtn.style.cssText = 'padding:6px 12px;cursor:pointer;';
		closeBtn.onclick = function() {
			if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
		};
		overlay.addEventListener('keydown', function(e) {
			if (e.key === 'Escape') closeBtn.click();
		});

		btnRow.appendChild(copyBtn);
		btnRow.appendChild(closeBtn);
		box.appendChild(titleEl);
		box.appendChild(ta);
		box.appendChild(btnRow);
		overlay.appendChild(box);

		FontRig._msgEl = {
			overlay: overlay, title: titleEl, ta: ta, close: closeBtn,
		};
	}

	var m = FontRig._msgEl;
	m.title.textContent = title || 'Message';
	m.ta.value = body;
	if (!m.overlay.parentNode) document.body.appendChild(m.overlay);
	// Focus the textarea so Ctrl+A / Ctrl+C work immediately.
	setTimeout(function() { m.ta.focus(); m.ta.setSelectionRange(0, 0); }, 0);
};

FontRig._ufoStatus = function(msg) {
	FontRig.log('[UFO]', msg);
	if (FontRig.setStatus) FontRig.setStatus(msg);
	if (FontRig._ufoSpinner && FontRig._ufoSpinner._label) {
		FontRig._ufoSpinner._label.textContent = msg;
	}
};

// -- Tiny CSS spinner overlay --------------------------------------
// Single shared instance. Calls are reference-counted via _depth so
// nested show/hide pairs nest safely. Yields to the browser via
// double-rAF on show so the overlay actually paints before the
// blocking work starts.
FontRig._ufoSpinner = (function() {
	var inst = { _el: null, _label: null, _depth: 0 };

	function ensure() {
		if (inst._el) return;
		var el = document.createElement('div');
		el.id = 'fr-ufo-spinner';
		el.style.cssText = [
			'position:fixed', 'inset:0', 'z-index:99999',
			'background:rgba(0,0,0,0.45)',
			'display:flex', 'flex-direction:column',
			'align-items:center', 'justify-content:center',
			'gap:14px', 'color:#eee',
			'font:13px/1.4 sans-serif',
			'pointer-events:auto',
		].join(';');

		var ring = document.createElement('div');
		ring.style.cssText = [
			'width:44px', 'height:44px',
			'border:4px solid rgba(255,255,255,0.18)',
			'border-top-color:#7cb7ff',
			'border-radius:50%',
			'animation:fr-ufo-spin 0.9s linear infinite',
		].join(';');

		var label = document.createElement('div');
		label.textContent = 'Working…';
		label.style.cssText = 'min-width:180px;text-align:center;opacity:.9;';

		if (!document.getElementById('fr-ufo-spinner-style')) {
			var style = document.createElement('style');
			style.id = 'fr-ufo-spinner-style';
			style.textContent =
				'@keyframes fr-ufo-spin{to{transform:rotate(360deg)}}';
			document.head.appendChild(style);
		}

		el.appendChild(ring);
		el.appendChild(label);
		inst._el = el;
		inst._label = label;
	}

	inst.show = async function(msg) {
		ensure();
		if (msg) inst._label.textContent = msg;
		inst._depth++;
		if (inst._depth === 1) document.body.appendChild(inst._el);
		// Force a paint before the caller starts blocking work.
		await new Promise(function(r) {
			requestAnimationFrame(function() { requestAnimationFrame(r); });
		});
	};

	inst.hide = function() {
		if (inst._depth > 0) inst._depth--;
		if (inst._depth === 0 && inst._el && inst._el.parentNode) {
			inst._el.parentNode.removeChild(inst._el);
		}
	};

	return inst;
})();

// -- Stage current FontRig.font state into a MEMFS .trfont folder ---
// Returns the absolute MEMFS path. Used by Save / Export / Import-merge
// so the Python side can read a coherent Font via TrFontIO.read().
FontRig._stageFontToMemfs = async function(memfsPath) {
	if (!FontRig.font) throw new Error('No font is open.');

	var FS = FontRig.pyBridge.pyodide.FS;
	FontRig.pyFs.rmrf(memfsPath);
	FontRig.pyFs.mkdirp(memfsPath);
	FontRig.pyFs.mkdirp(memfsPath + '/glyphs');

	// --- font.xml: prefer the raw string we stashed at load time;
	//     fall back to re-fetching from dirHandle if available.
	var fontXml = FontRig.font.rawFontXml;
	if (!fontXml && FontRig.font.dirHandle) {
		fontXml = await FontRig._readFile(FontRig.font.dirHandle, 'font.xml');
	}
	if (!fontXml) throw new Error('Cannot recover font.xml for staging.');
	FontRig.pyFs.writeText(memfsPath + '/font.xml', fontXml);

	// --- glyphs.xml manifest
	// Do NOT re-mangle here: Pyodide MEMFS is POSIX (case-sensitive),
	// so A.trglyph and a.trglyph are distinct files; and mangling
	// would invalidate the dirHandle paths we use below to read
	// clean glyphs from the source folder. Just regenerate glyphs.xml
	// from the live manifest so staged order matches the editor's
	// panel. Filename mangling is applied later, only in Save As,
	// which writes to a real (potentially case-insensitive) FS.
	var glyphsXml = FontRig._buildGlyphsXmlFromManifest(FontRig.font.manifest || []);
	FontRig.pyFs.writeText(memfsPath + '/glyphs.xml', glyphsXml);

	// --- optional sibling features.fea
	try {
		var feaText = null;
		if (FontRig.font.rawFeatures != null) {
			feaText = FontRig.font.rawFeatures;
		} else if (FontRig.font.dirHandle) {
			try { feaText = await FontRig._readFile(FontRig.font.dirHandle, 'features.fea'); }
			catch (_) { /* optional */ }
		}
		if (feaText) FontRig.pyFs.writeText(memfsPath + '/features.fea', feaText);
	} catch (_) {}

	// --- optional sibling groups.xml
	try {
		var groupsXml = null;
		if (FontRig.font.rawGroupsXml != null) {
			groupsXml = FontRig.font.rawGroupsXml;
		} else if (FontRig.font.dirHandle) {
			try { groupsXml = await FontRig._readFile(FontRig.font.dirHandle, 'groups.xml'); }
			catch (_) { /* optional */ }
		}
		if (groupsXml) FontRig.pyFs.writeText(memfsPath + '/groups.xml', groupsXml);
	} catch (_) {}

	// --- per-glyph .trglyph files
	for (var i = 0; i < FontRig.font.manifest.length; i++) {
		var entry = FontRig.font.manifest[i];
		var key   = entry.alias || entry.name;

		var xml = null;
		// 1. Dirty in-memory glyph wins (serialize cached structure)
		if (FontRig.dirtyGlyphs.has(key)) {
			var cached = FontRig.glyphCache.get(key);
			if (cached && cached.glyphData && FontRig.glyphToXml) {
				xml = FontRig.glyphToXml(cached.glyphData);
			}
		}
		// 2. Else fall back to in-memory map (loaded-from-UFO mode)
		if (xml == null && FontRig.font.memGlyphs) {
			xml = FontRig.font.memGlyphs[key];
			if (xml == null) xml = FontRig.font.memGlyphs[entry.name];
		}
		// 3. Else read from dirHandle
		if (xml == null && FontRig.font.dirHandle) {
			try { xml = await FontRig._readFile(FontRig.font.dirHandle, entry.path); }
			catch (_) {}
		}
		if (xml == null) {
			console.warn('[UFO] could not stage glyph "' + key + '" — skipping');
			continue;
		}
		var rel = (entry.path || ('glyphs/' + key + '.trglyph')).replace(/\\/g, '/');
		FontRig.pyFs.writeText(memfsPath + '/' + rel, xml);
	}

	return memfsPath;
};

// -- Populate editor state from a MEMFS .trfont folder --------------
// Reads every file into JS, parses the headers, sets FontRig.font with
// memGlyphs = { name|alias: xmlString }, and refreshes the UI.
FontRig._populateFromMemfsTrfont = async function(memfsPath, displayLabel) {
	var fontXml   = FontRig.pyFs.readText(memfsPath + '/font.xml');
	var glyphsXml = FontRig.pyFs.readText(memfsPath + '/glyphs.xml');
	var fontData  = FontRig.parseFontXml(fontXml);
	var manifest  = FontRig.parseGlyphsManifest(glyphsXml);

	// Attach encoding unicodes to manifest entries (same as openFont).
	for (var i = 0; i < manifest.entries.length; i++) {
		var entry = manifest.entries[i];
		var key   = entry.alias || entry.name;
		if (fontData.encoding[key]) entry.unicodes = fontData.encoding[key];
	}

	// Read every glyph file from MEMFS into the memGlyphs map.
	var memGlyphs = {};
	for (var i = 0; i < manifest.entries.length; i++) {
		var e   = manifest.entries[i];
		var key = e.alias || e.name;
		try {
			var rel = (e.path || '').replace(/\\/g, '/');
			memGlyphs[key] = FontRig.pyFs.readText(memfsPath + '/' + rel);
		} catch (err) {
			console.warn('[UFO] missing glyph file in MEMFS:', e.path);
		}
	}

	var feaText = null, groupsXml = null;
	try { feaText   = FontRig.pyFs.readText(memfsPath + '/features.fea'); } catch (_) {}
	try { groupsXml = FontRig.pyFs.readText(memfsPath + '/groups.xml'); }   catch (_) {}

	FontRig.font = {
		dirHandle:     null,            // in-memory mode
		memGlyphs:     memGlyphs,
		memfsTrfontPath: memfsPath,
		rawFontXml:    fontXml,
		rawGlyphsXml:  glyphsXml,
		rawFeatures:   feaText,
		rawGroupsXml:  groupsXml,
		displayLabel:  displayLabel || 'unsaved',
		info:          fontData.info,
		metrics:       fontData.metrics,
		masters:       fontData.masters,
		encoding:      fontData.encoding,
		manifest:      manifest.entries,
		manifestIndex: manifest.index,
	};

	FontRig.glyphCache.clear();
	FontRig.dirtyGlyphs.clear();
	FontRig.activeGlyph = null;
	if (FontRig.GlyphRenderer && FontRig.GlyphRenderer.clearCache) {
		FontRig.GlyphRenderer.clearCache();
	}

	FontRig.buildGlyphPanel();
	FontRig.updateFontInfo();

	if (manifest.entries.length > 0) {
		await FontRig.switchGlyph(manifest.entries[0].alias || manifest.entries[0].name);
	}
};

// -- Show captured Python output in a copy-friendly dialog ---------
FontRig._ufoShowResult = function(title, result, extraText) {
	var body = '';
	if (extraText)                      body += extraText + '\n\n';
	if (result.error)                   body += 'Error:\n' + result.error + '\n\n';
	if (result.output && result.output.trim()) {
		body += '--- Python output ---\n' + result.output.trim() + '\n';
	}
	if (!body) body = '(no details)';
	FontRig.showMessage(title, body);
};


// ===================================================================
//  1. Load Designspace
// ===================================================================
FontRig.loadDesignspace = async function() {
	if (!FontRig._ufoRequirePy()) return;

	// Single directory pick. The browser File System Access API can't
	// derive a parent folder from a file handle, so the only way to do
	// this in one click is to ask for the folder and find the .designspace
	// inside. The picker shows folder contents, so the user effectively
	// navigates to the .designspace and confirms its containing folder.
	var dirHandle;
	try {
		dirHandle = await window.showDirectoryPicker({ mode: 'read' });
	} catch (e) {
		if (e.name !== 'AbortError') FontRig.showMessage('Pick folder failed', String(e && e.stack || e));
		return;
	}

	await FontRig._ufoSpinner.show('Scanning folder…');
	try {
		// Find .designspace at the top level of the picked directory.
		var dsName = null;
		for await (var entry of dirHandle.values()) {
			if (entry.kind === 'file' && /\.designspace$/i.test(entry.name)) {
				if (dsName && dsName !== entry.name) {
					throw new Error('Multiple .designspace files in folder. Move one out or pick a folder with just one.');
				}
				dsName = entry.name;
			}
		}
		if (!dsName) {
			throw new Error('No .designspace file found at the top of the picked folder.');
		}

		FontRig._ufoStatus('Copying ' + dsName + ' into Python…');
		FontRig.pyFs.rmrf('/tmp/ds_in');
		await FontRig.pyFs.copyDirHandleToMemfs(dirHandle, '/tmp/ds_in');

		FontRig._ufoStatus('Converting UFO → .trfont…');
		FontRig.pyFs.rmrf('/tmp/loaded.trfont');
		var py = FontRig.pyBridge.pyodide;
		py.globals.set('_ds_path', '/tmp/ds_in/' + dsName);
		var result = FontRig._runPythonCaptured(
			'_font = UfoConverter(verbose=True).to_tr(_ds_path)\n' +
			'TrFontIO.write(_font, "/tmp/loaded.trfont")\n' +
			'del _font, _ds_path\n'
		);
		if (!result.ok) {
			FontRig._ufoShowResult('UFO load failed.', result);
			FontRig._ufoStatus('Load failed.');
			return;
		}

		FontRig._ufoStatus('Building editor state…');
		await FontRig._populateFromMemfsTrfont('/tmp/loaded.trfont', dsName + ' (unsaved)');
		FontRig._ufoStatus('Loaded ' + dsName + ' (in-memory).');
		if (result.output && result.output.trim()) FontRig.log('[UFO load]\n' + result.output);
	} catch (e) {
		FontRig.showMessage('Load failed', String(e && e.stack || e));
		FontRig._ufoStatus('Load failed.');
	} finally {
		FontRig._ufoSpinner.hide();
	}
};


// ===================================================================
//  2. Save Designspace
// ===================================================================
FontRig.saveDesignspace = async function() {
	if (!FontRig._ufoRequirePy()) return;
	if (!FontRig.font) { FontRig.showMessage('No font', 'No font is open.'); return; }

	// Stem from family name. Single directory pick — the .designspace
	// and the sibling .ufo folders are written into the chosen folder.
	var stem = (FontRig.font.info && FontRig.font.info.family) || 'Font';
	stem = String(stem).replace(/[^A-Za-z0-9_\-]/g, '_') || 'Font';
	var dsName = stem + '.designspace';

	var outHandle;
	try {
		outHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
	} catch (e) {
		if (e.name !== 'AbortError') FontRig.showMessage('Pick output folder failed', String(e && e.stack || e));
		return;
	}

	await FontRig._ufoSpinner.show('Preparing…');
	try {
		FontRig._ufoStatus('Staging font for export…');
		await FontRig._stageFontToMemfs('/tmp/src.trfont');

		FontRig.pyFs.rmrf('/tmp/ufo_out');
		FontRig.pyFs.mkdirp('/tmp/ufo_out');
		var py = FontRig.pyBridge.pyodide;
		py.globals.set('_ds_out', '/tmp/ufo_out/' + dsName);

		FontRig._ufoStatus('Writing UFO + .designspace…');
		var result = FontRig._runPythonCaptured(
			'_font = TrFontIO.read("/tmp/src.trfont")\n' +
			'UfoConverter(verbose=True).to_ufo(_font, _ds_out)\n' +
			'del _font, _ds_out\n'
		);
		if (!result.ok) {
			FontRig._ufoShowResult('UFO save failed.', result);
			FontRig._ufoStatus('Save failed.');
			return;
		}

		FontRig._ufoStatus('Copying files to disk…');
		await FontRig.pyFs.copyMemfsToDirHandle('/tmp/ufo_out', outHandle);

		FontRig._ufoStatus('Saved ' + dsName + '.');
		if (result.output && result.output.trim()) FontRig.log('[UFO save]\n' + result.output);
	} catch (e) {
		FontRig.showMessage('Save failed', String(e && e.stack || e));
		FontRig._ufoStatus('Save failed.');
	} finally {
		FontRig._ufoSpinner.hide();
	}
};


// ===================================================================
//  3. Export → UFO → Master(s)
// ===================================================================
// Tiny modal listing all masters with checkboxes. The active layer is
// pre-checked. User picks 1..N. We then ask for an output folder and
// hand off to ufo_helpers.export_selected_masters_to_ufo.
FontRig.exportUfoMasterDialog = async function() {
	if (!FontRig._ufoRequirePy()) return;
	if (!FontRig.font) { FontRig.showMessage('No font', 'No font is open.'); return; }
	var masters = FontRig.font.masters || [];
	if (!masters.length) { FontRig.showMessage('No masters', 'Font has no masters defined.'); return; }

	// Build the modal.
	var overlay = document.createElement('div');
	overlay.className = 'fr-modal-overlay';
	overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);' +
		'z-index:9999;display:flex;align-items:center;justify-content:center;';

	var box = document.createElement('div');
	box.style.cssText = 'background:#222;color:#ddd;padding:20px;border-radius:6px;' +
		'min-width:320px;max-width:480px;font-family:sans-serif;';
	box.innerHTML = '<h3 style="margin:0 0 12px 0;">Export master(s) to UFO</h3>' +
		'<p style="margin:0 0 12px 0;font-size:13px;opacity:.8;">Each selected master is written as a standalone .ufo containing only its glyphs.</p>' +
		'<div id="fr-ufo-master-list" style="max-height:280px;overflow:auto;border:1px solid #444;padding:8px;border-radius:4px;"></div>' +
		'<div style="margin-top:14px;text-align:right;">' +
			'<button id="fr-ufo-cancel" style="margin-right:8px;">Cancel</button>' +
			'<button id="fr-ufo-ok">Export…</button>' +
		'</div>';
	overlay.appendChild(box);
	document.body.appendChild(overlay);

	var list = box.querySelector('#fr-ufo-master-list');
	var activeLayer = FontRig.state && FontRig.state.activeLayer;
	for (var i = 0; i < masters.length; i++) {
		var m = masters[i];
		var row = document.createElement('label');
		row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;';
		var cb = document.createElement('input');
		cb.type  = 'checkbox';
		cb.value = m.name;
		cb.checked = (m.layerName === activeLayer) || (masters.length === 1) || m.isDefault;
		row.appendChild(cb);
		var span = document.createElement('span');
		span.textContent = m.name + (m.isDefault ? ' (default)' : '');
		row.appendChild(span);
		list.appendChild(row);
	}

	var done = new Promise(function(resolve) {
		box.querySelector('#fr-ufo-cancel').onclick = function() { resolve(null); };
		box.querySelector('#fr-ufo-ok').onclick = function() {
			var picks = Array.prototype.slice.call(list.querySelectorAll('input:checked'))
				.map(function(el) { return el.value; });
			resolve(picks);
		};
	});
	var picks = await done;
	overlay.remove();
	if (!picks || picks.length === 0) return;

	var outHandle;
	try {
		outHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
	} catch (e) {
		if (e.name !== 'AbortError') FontRig.showMessage('Pick output folder failed', String(e && e.stack || e));
		return;
	}

	await FontRig._ufoSpinner.show('Preparing…');
	try {
		FontRig._ufoStatus('Staging font for export…');
		await FontRig._stageFontToMemfs('/tmp/src.trfont');

		FontRig.pyFs.rmrf('/tmp/ufo_masters');
		FontRig.pyFs.mkdirp('/tmp/ufo_masters');

		var py = FontRig.pyBridge.pyodide;
		py.globals.set('_master_names', picks);
		FontRig._ufoStatus('Writing ' + picks.length + ' .ufo file(s)…');
		var result = FontRig._runPythonCaptured(
			'_font = TrFontIO.read("/tmp/src.trfont")\n' +
			'_names = list(_master_names.to_py())\n' +
			'_written = ufo_helpers.export_selected_masters_to_ufo(_font, _names, "/tmp/ufo_masters")\n' +
			'print("Wrote:", _written)\n' +
			'del _font, _names, _written, _master_names\n'
		);
		if (!result.ok) {
			FontRig._ufoShowResult('UFO master export failed.', result);
			return;
		}

		FontRig._ufoStatus('Copying files to disk…');
		await FontRig.pyFs.copyMemfsToDirHandle('/tmp/ufo_masters', outHandle);

		FontRig._ufoStatus('Exported ' + picks.length + ' master(s).');
		if (result.output && result.output.trim()) FontRig.log('[UFO export]\n' + result.output);
	} catch (e) {
		FontRig.showMessage('Export failed', String(e && e.stack || e));
		FontRig._ufoStatus('Export failed.');
	} finally {
		FontRig._ufoSpinner.hide();
	}
};


// ===================================================================
//  4. Import → UFO → New Master
// ===================================================================
FontRig.importUfoAsMasterDialog = async function() {
	if (!FontRig._ufoRequirePy()) return;
	if (!FontRig.font) { FontRig.showMessage('No font', 'Open a font first — Import UFO merges into the open font.'); return; }

	var ufoHandle;
	try {
		ufoHandle = await window.showDirectoryPicker({ mode: 'read' });
	} catch (e) {
		if (e.name !== 'AbortError') FontRig.showMessage('Pick folder failed', String(e && e.stack || e));
		return;
	}
	if (!/\.ufo$/i.test(ufoHandle.name)) {
		FontRig.showMessage('Wrong folder', 'Pick a folder whose name ends in .ufo.');
		return;
	}

	// Ask for the new master name.
	var defaultName = ufoHandle.name.replace(/\.ufo$/i, '');
	var newName = window.prompt('New master name:', defaultName);
	if (!newName) return;
	newName = String(newName).trim();
	if (!newName) return;

	await FontRig._ufoSpinner.show('Preparing…');
	try {
		FontRig._ufoStatus('Copying UFO into Python…');
		FontRig.pyFs.rmrf('/tmp/ufo_in.ufo');
		await FontRig.pyFs.copyDirHandleToMemfs(ufoHandle, '/tmp/ufo_in.ufo');

		FontRig._ufoStatus('Staging current font…');
		await FontRig._stageFontToMemfs('/tmp/src.trfont');

		FontRig.pyFs.rmrf('/tmp/merged.trfont');

		var py = FontRig.pyBridge.pyodide;
		py.globals.set('_new_name', newName);
		FontRig._ufoStatus('Merging…');
		var result = FontRig._runPythonCaptured(
			'_current = TrFontIO.read("/tmp/src.trfont")\n' +
			'_summary = ufo_helpers.merge_ufo_as_new_master(_current, "/tmp/ufo_in.ufo", _new_name)\n' +
			'TrFontIO.write(_current, "/tmp/merged.trfont")\n' +
			'print("Merge summary:", _summary)\n' +
			'del _current, _summary, _new_name\n'
		);
		if (!result.ok) {
			FontRig._ufoShowResult('UFO merge failed.', result);
			FontRig._ufoStatus('Merge failed.');
			return;
		}

		FontRig._ufoStatus('Rebuilding editor state…');
		await FontRig._populateFromMemfsTrfont('/tmp/merged.trfont',
			(FontRig.font.displayLabel || 'font') + ' + ' + newName);

		FontRig._ufoStatus('Merged "' + newName + '" as new master.');
		if (result.output && result.output.trim()) FontRig.log('[UFO merge]\n' + result.output);
	} catch (e) {
		FontRig.showMessage('Merge failed', String(e && e.stack || e));
		FontRig._ufoStatus('Merge failed.');
	} finally {
		FontRig._ufoSpinner.hide();
	}
};
