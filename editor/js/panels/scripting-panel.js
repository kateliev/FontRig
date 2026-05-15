// ===================================================================
// FontRig — Scripting Panel
// ===================================================================
// Folders of Python scripts. Drag-and-drop to reorganize, run via
// FontRig.pyBridge.run(). State persisted to localStorage; can be
// exported/imported as JSON.
//
// Data model:
//   { folders: [ { name, scripts: [ { name, source } ] } ],
//     selection: { folderIdx, scriptIdx } | null }
// ===================================================================
'use strict';

(function () {

if (typeof FontRig === 'undefined') return;

var STORAGE_KEY = 'fr-scripting-config-v1';
var CONFIG_TYPE = 'fontrig-scripting-config';
var CONFIG_VERSION = 1;

// Bundled scripting config. On first run (or after the user clears
// localStorage) the panel fetches this JSON, resolves any `path`
// references to inline source, and seeds the tree. Authors a working
// example of the on-disk format users can copy.
var BUNDLED_CONFIG_PATH = 'scripts/scripts.json';

FontRig.ScriptingPanel = {};

FontRig.ScriptingPanel.mount = function (containerEl) {
	if (!containerEl) return null;
	var inst = { _containerEl: containerEl };

	// -- Load persisted state ---------------------------------------
	var data = _load();
	inst._data = data;

	containerEl.innerHTML = '';

	var wrap = document.createElement('div');
	wrap.className = 'scripting-panel';
	wrap.style.display = 'flex';
	wrap.style.flexDirection = 'column';
	wrap.style.height = '100%';

	// -- Tree area --------------------------------------------------
	var tree = document.createElement('div');
	tree.className = 'scripting-panel__tree';
	tree.style.flex = '1 1 auto';
	tree.style.overflowY = 'auto';
	tree.style.padding = '4px';
	wrap.appendChild(tree);

	// Drop on empty panel: prompt to pick a .py file → add to first folder
	tree.addEventListener('dragover', function (e) { e.preventDefault(); });
	tree.addEventListener('drop', function (e) {
		e.preventDefault();
		// Native file drop
		if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
			_handleFileDrop(inst, e.dataTransfer.files);
		}
	});

	// -- Console output --------------------------------------------
	var console_ = document.createElement('div');
	console_.className = 'scripting-panel__console';
	console_.style.flex = '0 0 80px';
	console_.style.overflowY = 'auto';
	console_.style.borderTop = '1px solid var(--border, #333)';
	console_.style.padding = '4px 8px';
	console_.style.fontFamily = 'monospace';
	console_.style.fontSize = '11px';
	console_.style.whiteSpace = 'pre-wrap';
	console_.style.background = 'rgba(0,0,0,0.15)';
	wrap.appendChild(console_);
	inst._console = console_;

	// -- Bottom action bar -----------------------------------------
	var actions = document.createElement('div');
	actions.className = 'scripting-panel__actions';
	actions.style.display = 'flex';
	actions.style.flexWrap = 'wrap';
	actions.style.gap = '4px';
	actions.style.padding = '6px';
	actions.style.borderTop = '1px solid var(--border, #333)';

	var btnRun        = FRWidget.Button('Run',          { icon: 'action_play', primary: true, compact: true, tooltip: 'Run selected script', onClick: function () { _runSelected(inst); } });
	var btnNewFolder  = FRWidget.Button('New Folder',   { compact: true, tooltip: 'Create a new folder', onClick: function () { _createFolder(inst); } });
	var btnDelFolder  = FRWidget.Button('Del Folder',   { compact: true, tooltip: 'Remove selected folder', onClick: function () { _removeFolder(inst); } });
	var btnAddScript  = FRWidget.Button('Add Script',   { compact: true, tooltip: 'Add a .py script from disk', onClick: function () { _addScript(inst); } });
	var btnDelScript  = FRWidget.Button('Del Script',   { compact: true, tooltip: 'Remove selected script', onClick: function () { _removeScript(inst); } });
	var btnLoadCfg    = FRWidget.Button('Load Config',  { compact: true, tooltip: 'Load configuration from JSON', onClick: function () { _loadConfig(inst); } });
	var btnSaveCfg    = FRWidget.Button('Save Config',  { compact: true, tooltip: 'Save configuration to JSON', onClick: function () { _saveConfig(inst); } });

	actions.appendChild(btnRun);
	actions.appendChild(btnNewFolder);
	actions.appendChild(btnDelFolder);
	actions.appendChild(btnAddScript);
	actions.appendChild(btnDelScript);
	actions.appendChild(btnLoadCfg);
	actions.appendChild(btnSaveCfg);
	wrap.appendChild(actions);

	containerEl.appendChild(wrap);

	inst._tree = tree;
	inst.render = function () { _renderTree(inst); };
	inst.update = function () { inst.render(); };

	inst.render();

	// First run: pull the bundled scripts.json off disk and seed.
	if (!data._seeded) {
		_seedFromBundle(inst);
	}
	return inst;
};

// -------------------------------------------------------------------
// State persistence
// -------------------------------------------------------------------
function _load() {
	try {
		var raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			var d = JSON.parse(raw);
			if (d && Array.isArray(d.folders)) {
				return { folders: d.folders, selection: null, _seeded: true };
			}
		}
	} catch (e) { /* ignore */ }
	// Fresh state — bundled scripts will be fetched and inserted async
	// during mount (see _seedBundledScripts).
	return { folders: [], selection: null, _seeded: false };
}

// Resolve script `path` references in a config payload to inline
// runtime source. `fetcher(path) → Promise<string|null>` does the
// per-script read; the panel uses URL fetch for the bundled config
// and a FileSystemDirectoryHandle for user-loaded configs.
function _resolveConfigFolders(folders, fetcher) {
	folders = Array.isArray(folders) ? folders : [];
	var pending = [];

	for (var i = 0; i < folders.length; i++) {
		var folder = folders[i];
		if (!folder || !Array.isArray(folder.scripts)) continue;
		for (var j = 0; j < folder.scripts.length; j++) {
			var s = folder.scripts[j];
			if (!s) continue;

			// Already has inline source — accept as-is for back-compat with
			// older configs and Save Config output from before path-only.
			if (typeof s.source === 'string') continue;

			if (typeof s.path === 'string') {
				(function (script) {
					pending.push(
						Promise.resolve(fetcher(script.path)).then(function (src) {
							if (src != null) {
								script.source   = src;
								script.fileName = script.fileName || _basename(script.path);
							} else {
								script.source   = '# (could not load ' + script.path + ')';
								script._missing = true;
							}
						}).catch(function () {
							script.source   = '# (could not load ' + script.path + ')';
							script._missing = true;
						})
					);
				})(s);
			}
		}
	}
	return Promise.all(pending).then(function () { return folders; });
}

function _basename(p) {
	if (!p) return '';
	var parts = String(p).replace(/\\/g, '/').split('/');
	return parts[parts.length - 1];
}

// Fetch the bundled config and seed the panel. Called once when no
// saved config exists.
function _seedFromBundle(inst) {
	var fetcher = function (path) {
		return fetch(path, { cache: 'no-store' })
			.then(function (r) { return r.ok ? r.text() : null; })
			.catch(function () { return null; });
	};
	fetch(BUNDLED_CONFIG_PATH, { cache: 'no-store' })
		.then(function (r) { return r.ok ? r.json() : null; })
		.then(function (cfg) {
			if (!cfg || cfg._type !== CONFIG_TYPE || !Array.isArray(cfg.folders)) {
				inst._data.folders = [{ name: 'scripts', expanded: true, scripts: [] }];
				_save(inst); _renderTree(inst);
				return;
			}
			return _resolveConfigFolders(cfg.folders, fetcher).then(function (folders) {
				inst._data.folders = folders.length > 0
					? folders
					: [{ name: 'scripts', expanded: true, scripts: [] }];
				_save(inst); _renderTree(inst);
			});
		})
		.catch(function () {
			inst._data.folders = [{ name: 'scripts', expanded: true, scripts: [] }];
			_save(inst); _renderTree(inst);
		});
}

// Build a fetcher that reads files from a FileSystemDirectoryHandle.
// Accepts paths that may contain forward slashes (sub-folders) and
// resolves them relative to the picked root.
function _dirHandleFetcher(dirHandle) {
	return function (path) {
		var parts = String(path).replace(/\\/g, '/').split('/').filter(Boolean);
		if (parts.length === 0) return Promise.resolve(null);
		var current = Promise.resolve(dirHandle);
		for (var i = 0; i < parts.length - 1; i++) {
			(function (name) {
				current = current.then(function (h) { return h.getDirectoryHandle(name); });
			})(parts[i]);
		}
		return current
			.then(function (h) { return h.getFileHandle(parts[parts.length - 1]); })
			.then(function (fh) { return fh.getFile(); })
			.then(function (f) { return f.text(); })
			.catch(function () { return null; });
	};
}

function _save(inst) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ folders: inst._data.folders }));
	} catch (e) { /* ignore */ }
}

// -------------------------------------------------------------------
// Rendering
// -------------------------------------------------------------------
function _renderTree(inst) {
	var root = inst._tree;
	root.innerHTML = '';

	var folders = inst._data.folders;
	for (var fi = 0; fi < folders.length; fi++) {
		root.appendChild(_renderFolder(inst, folders[fi], fi));
	}
}

function _renderFolder(inst, folder, folderIdx) {
	var sel = inst._data.selection;
	var isSelected = sel && sel.folderIdx === folderIdx && sel.scriptIdx == null;

	var wrap = document.createElement('div');
	wrap.className = 'scripting-folder';
	wrap.style.marginBottom = '2px';

	var header = document.createElement('div');
	header.className = 'scripting-folder__header';
	header.style.display = 'flex';
	header.style.alignItems = 'center';
	header.style.gap = '4px';
	header.style.padding = '3px 6px';
	header.style.cursor = 'pointer';
	header.style.borderRadius = '3px';
	header.style.background = isSelected ? 'rgba(80,160,255,0.15)' : 'transparent';
	header.style.userSelect = 'none';

	var arrow = document.createElement('span');
	arrow.textContent = folder.expanded === false ? '▶' : '▼';
	arrow.style.fontSize = '9px';
	arrow.style.width = '10px';
	arrow.style.opacity = '0.6';
	header.appendChild(arrow);

	var label = document.createElement('span');
	label.textContent = folder.name + '  (' + folder.scripts.length + ')';
	label.style.flex = '1 1 auto';
	label.style.fontWeight = 'bold';
	label.style.fontSize = '12px';
	header.appendChild(label);

	header.addEventListener('click', function () {
		inst._data.selection = { folderIdx: folderIdx, scriptIdx: null };
		_renderTree(inst);
	});
	header.addEventListener('dblclick', function () {
		folder.expanded = !(folder.expanded !== false);
		_renderTree(inst);
	});

	// Drop target: accept dragged scripts
	header.addEventListener('dragover', function (e) {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		header.style.outline = '1px dashed var(--accent, #4af)';
	});
	header.addEventListener('dragleave', function () { header.style.outline = ''; });
	header.addEventListener('drop', function (e) {
		e.preventDefault();
		header.style.outline = '';
		// Native file?
		if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
			_handleFileDrop(inst, e.dataTransfer.files, folderIdx);
			return;
		}
		var payload = e.dataTransfer.getData('application/x-fr-script');
		if (!payload) return;
		try {
			var src = JSON.parse(payload);
			_moveScript(inst, src.folderIdx, src.scriptIdx, folderIdx, null);
		} catch (err) { /* ignore */ }
	});

	wrap.appendChild(header);

	if (folder.expanded !== false) {
		var listEl = document.createElement('div');
		listEl.style.paddingLeft = '12px';
		for (var si = 0; si < folder.scripts.length; si++) {
			listEl.appendChild(_renderScript(inst, folder.scripts[si], folderIdx, si));
		}
		wrap.appendChild(listEl);
	}

	return wrap;
}

function _renderScript(inst, script, folderIdx, scriptIdx) {
	var sel = inst._data.selection;
	var isSelected = sel && sel.folderIdx === folderIdx && sel.scriptIdx === scriptIdx;

	var row = document.createElement('div');
	row.className = 'scripting-script';
	row.style.display = 'flex';
	row.style.alignItems = 'center';
	row.style.padding = '2px 6px';
	row.style.cursor = 'pointer';
	row.style.fontSize = '12px';
	row.style.borderRadius = '3px';
	row.style.background = isSelected ? 'rgba(80,160,255,0.15)' : 'transparent';
	row.style.userSelect = 'none';
	row.draggable = true;

	if (script._missing) {
		row.style.opacity = '0.5';
		row.style.fontStyle = 'italic';
		row.title = 'Script not resolved — Run will print the placeholder; use Load Config to re-attach.';
	}

	row.textContent = (script._missing ? '⚠ ' : '• ') + script.name;

	row.addEventListener('click', function () {
		inst._data.selection = { folderIdx: folderIdx, scriptIdx: scriptIdx };
		_renderTree(inst);
	});
	row.addEventListener('dblclick', function () {
		inst._data.selection = { folderIdx: folderIdx, scriptIdx: scriptIdx };
		_runSelected(inst);
	});

	row.addEventListener('dragstart', function (e) {
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('application/x-fr-script',
			JSON.stringify({ folderIdx: folderIdx, scriptIdx: scriptIdx }));
	});

	row.addEventListener('mouseenter', function () {
		if (!isSelected) row.style.background = 'rgba(255,255,255,0.06)';
	});
	row.addEventListener('mouseleave', function () {
		if (!isSelected) row.style.background = '';
	});

	return row;
}

// -------------------------------------------------------------------
// Actions
// -------------------------------------------------------------------
function _runSelected(inst) {
	var sel = inst._data.selection;
	if (!sel || sel.scriptIdx == null) {
		_log(inst, 'No script selected.', 'warn');
		return;
	}
	var script = inst._data.folders[sel.folderIdx].scripts[sel.scriptIdx];
	if (!script) return;

	if (!FontRig.pyBridge || !FontRig.pyBridge.ready) {
		_log(inst, 'Python runtime not ready. Open the Python panel and click Init.', 'error');
		return;
	}

	if (typeof FontRig.pushUndo === 'function') {
		FontRig.pushUndo('Script: ' + script.name);
	}

	_log(inst, '▶ ' + script.name, 'info');
	var res = FontRig.pyBridge.run(script.source);
	if (res) {
		if (res.output) _log(inst, res.output, 'output');
		if (res.error)  _log(inst, res.error,  'error');
	}
}

function _createFolder(inst) {
	if (typeof FRWidget !== 'undefined' && FRWidget.InputDialog) {
		FRWidget.InputDialog({ title: 'New Folder', label: 'Name', value: 'Folder' })
			.then(function (name) {
				if (!name) return;
				inst._data.folders.push({ name: name, scripts: [], expanded: true });
				_save(inst); _renderTree(inst);
			});
	} else {
		var name = prompt('Folder name:', 'Folder');
		if (!name) return;
		inst._data.folders.push({ name: name, scripts: [], expanded: true });
		_save(inst); _renderTree(inst);
	}
}

function _removeFolder(inst) {
	var sel = inst._data.selection;
	if (!sel) { _log(inst, 'No folder selected.', 'warn'); return; }
	if (inst._data.folders.length <= 1) { _log(inst, 'Cannot remove the last folder.', 'warn'); return; }
	if (!confirm('Remove folder "' + inst._data.folders[sel.folderIdx].name + '" and all its scripts?')) return;
	inst._data.folders.splice(sel.folderIdx, 1);
	inst._data.selection = null;
	_save(inst); _renderTree(inst);
}

function _addScript(inst) {
	var sel = inst._data.selection;
	var folderIdx = sel ? sel.folderIdx : 0;

	if (typeof window.showOpenFilePicker !== 'function') {
		_log(inst, 'File picker unavailable in this browser.', 'error');
		return;
	}

	window.showOpenFilePicker({
		types: [{ description: 'Python', accept: { 'text/x-python': ['.py'] } }],
		multiple: true
	}).then(function (handles) {
		return Promise.all(handles.map(function (h) {
			return h.getFile().then(function (f) {
				return f.text().then(function (text) {
					return { fileName: f.name, source: text };
				});
			});
		}));
	}).then(function (scripts) {
		for (var i = 0; i < scripts.length; i++) {
			inst._data.folders[folderIdx].scripts.push({
				name:     scripts[i].fileName.replace(/\.py$/i, ''),
				fileName: scripts[i].fileName,
				source:   scripts[i].source
			});
		}
		_save(inst); _renderTree(inst);
	}).catch(function (e) {
		if (e && e.name !== 'AbortError') _log(inst, 'Add script failed: ' + e.message, 'error');
	});
}

function _removeScript(inst) {
	var sel = inst._data.selection;
	if (!sel || sel.scriptIdx == null) { _log(inst, 'No script selected.', 'warn'); return; }
	inst._data.folders[sel.folderIdx].scripts.splice(sel.scriptIdx, 1);
	inst._data.selection = { folderIdx: sel.folderIdx, scriptIdx: null };
	_save(inst); _renderTree(inst);
}

function _moveScript(inst, fromFolderIdx, fromScriptIdx, toFolderIdx, toScriptIdx) {
	if (fromFolderIdx === toFolderIdx && (toScriptIdx === fromScriptIdx)) return;
	var folders = inst._data.folders;
	var script = folders[fromFolderIdx].scripts.splice(fromScriptIdx, 1)[0];
	if (!script) return;
	if (toScriptIdx == null) folders[toFolderIdx].scripts.push(script);
	else folders[toFolderIdx].scripts.splice(toScriptIdx, 0, script);
	inst._data.selection = null;
	_save(inst); _renderTree(inst);
}

// Save Config writes ONLY references (path = filename or relative
// sub-path within the user's scripts folder). The runtime `source`
// string never leaves the editor — keeping configs safe to share and
// independent of the panel's in-memory cache.
function _saveConfig(inst) {
	var folders = inst._data.folders.map(function (folder) {
		return {
			name:     folder.name,
			expanded: folder.expanded !== false,
			scripts:  (folder.scripts || []).map(function (s) {
				return {
					name: s.name,
					path: s.fileName || (s.name + '.py')
				};
			})
		};
	});
	var data = JSON.stringify({
		_type:    CONFIG_TYPE,
		_version: CONFIG_VERSION,
		folders:  folders
	}, null, 2);
	var blob = new Blob([data], { type: 'application/json' });
	var url = URL.createObjectURL(blob);
	var a = document.createElement('a');
	a.href = url;
	a.download = 'fontrig-scripts.json';
	a.click();
	URL.revokeObjectURL(url);
}

// Load Config picks a JSON file, then prompts for the folder
// containing the referenced scripts and resolves each path against
// it. Inline-source configs are still accepted for back-compat.
function _loadConfig(inst) {
	if (typeof window.showOpenFilePicker !== 'function') {
		_log(inst, 'File picker unavailable in this browser.', 'error');
		return;
	}
	window.showOpenFilePicker({
		types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
	}).then(function (handles) {
		return handles[0].getFile();
	}).then(function (f) { return f.text(); })
	.then(function (text) {
		var parsed = JSON.parse(text);
		if (parsed._type !== CONFIG_TYPE || !Array.isArray(parsed.folders)) {
			_log(inst, 'Not a FontRig scripting config.', 'error');
			return;
		}

		var needsDir = false;
		for (var i = 0; i < parsed.folders.length && !needsDir; i++) {
			var ss = parsed.folders[i].scripts || [];
			for (var j = 0; j < ss.length; j++) {
				if (ss[j] && typeof ss[j].source !== 'string' && typeof ss[j].path === 'string') {
					needsDir = true; break;
				}
			}
		}

		var fetcherPromise;
		if (needsDir) {
			_log(inst, 'Select the folder containing your scripts…', 'info');
			fetcherPromise = window.showDirectoryPicker({ mode: 'read' })
				.then(_dirHandleFetcher);
		} else {
			fetcherPromise = Promise.resolve(function () { return null; });
		}

		fetcherPromise
			.then(function (fetcher) {
				return _resolveConfigFolders(parsed.folders, fetcher);
			})
			.then(function (folders) {
				inst._data.folders   = folders;
				inst._data.selection = null;
				_save(inst); _renderTree(inst);
				var missing = 0;
				for (var i = 0; i < folders.length; i++) {
					var ss = folders[i].scripts || [];
					for (var j = 0; j < ss.length; j++) if (ss[j]._missing) missing++;
				}
				if (missing > 0) {
					_log(inst, 'Config loaded with ' + missing + ' unresolved script(s).', 'warn');
				} else {
					_log(inst, 'Config loaded.', 'info');
				}
			})
			.catch(function (e) {
				if (e && e.name !== 'AbortError') _log(inst, 'Load failed: ' + e.message, 'error');
			});
	}).catch(function (e) {
		if (e && e.name !== 'AbortError') _log(inst, 'Load failed: ' + e.message, 'error');
	});
}

function _handleFileDrop(inst, files, folderIdx) {
	if (folderIdx == null) folderIdx = 0;
	var pending = [];
	for (var i = 0; i < files.length; i++) {
		var f = files[i];
		if (!/\.py$/i.test(f.name)) continue;
		(function (file) {
			pending.push(file.text().then(function (text) {
				inst._data.folders[folderIdx].scripts.push({
					name:     file.name.replace(/\.py$/i, ''),
					fileName: file.name,
					source:   text
				});
			}));
		})(f);
	}
	Promise.all(pending).then(function () { _save(inst); _renderTree(inst); });
}

function _log(inst, text, type) {
	var line = document.createElement('div');
	line.textContent = text;
	if (type === 'error') line.style.color = '#f88';
	else if (type === 'warn') line.style.color = '#fc6';
	else if (type === 'info') line.style.color = '#8cf';
	else line.style.color = 'inherit';
	inst._console.appendChild(line);
	inst._console.scrollTop = inst._console.scrollHeight;
}

})();
