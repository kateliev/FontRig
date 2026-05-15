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

// IndexedDB store for FileSystemDirectoryHandle. localStorage cannot
// hold structured-clone-only types (handles), so we keep them here.
var IDB_NAME      = 'fr-scripting';
var IDB_STORE     = 'handles';
var IDB_HANDLE_KEY = 'scripts-dir-handle';

// In-memory cache of the live FileSystemDirectoryHandle. Repopulated
// on panel mount (from IndexedDB) and replaced on Load Config.
FontRig.ScriptingPanel = FontRig.ScriptingPanel || {};
FontRig.ScriptingPanel._dirHandle = null;

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

	// Right-click on empty tree space → context menu with the
	// folder-management options (no row context).
	tree.addEventListener('contextmenu', function (e) {
		// Only handle bare-tree clicks; row handlers stopPropagation.
		if (e.target !== tree) return;
		e.preventDefault();
		_openContextMenu(inst, e.clientX, e.clientY, { kind: 'empty' });
	});

	// -- Bottom action bar -----------------------------------------
	var actions = document.createElement('div');
	actions.className = 'scripting-panel__actions';
	actions.style.display = 'flex';
	actions.style.flexWrap = 'wrap';
	actions.style.gap = '4px';
	actions.style.padding = '6px';
	actions.style.borderTop = '1px solid var(--border, #333)';

	// Run is primary; tree management lives in the right-click menu.
	var btnRun     = FRWidget.Button('Run',         { icon: 'action_play', primary: true, compact: true, tooltip: 'Run selected script', onClick: function () { _runSelected(inst); } });
	var btnLoadCfg = FRWidget.Button('Load Config', { compact: true, tooltip: 'Load configuration from JSON', onClick: function () { _loadConfig(inst); } });
	var btnSaveCfg = FRWidget.Button('Save Config', { compact: true, tooltip: 'Save configuration to JSON', onClick: function () { _saveConfig(inst); } });

	actions.appendChild(btnRun);
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

	// Quietly re-attach the user's scripts-folder handle from a
	// previous session. Permission is requested lazily on Run, so
	// this only restores the reference — no prompts on page load.
	if (!FontRig.ScriptingPanel._dirHandle) {
		_idbGet(IDB_HANDLE_KEY).then(function (handle) {
			if (handle) FontRig.ScriptingPanel._dirHandle = handle;
		});
	}
	return inst;
};

// -------------------------------------------------------------------
// State persistence
// -------------------------------------------------------------------
// -------------------------------------------------------------------
// IndexedDB: persist the scripts-folder handle
// -------------------------------------------------------------------
function _idb() {
	return new Promise(function (resolve, reject) {
		var req = indexedDB.open(IDB_NAME, 1);
		req.onupgradeneeded = function () {
			req.result.createObjectStore(IDB_STORE);
		};
		req.onsuccess = function () { resolve(req.result); };
		req.onerror   = function () { reject(req.error); };
	});
}

function _idbGet(key) {
	return _idb().then(function (db) {
		return new Promise(function (resolve) {
			var tx = db.transaction(IDB_STORE, 'readonly');
			var rq = tx.objectStore(IDB_STORE).get(key);
			rq.onsuccess = function () { resolve(rq.result); };
			rq.onerror   = function () { resolve(null); };
		});
	}).catch(function () { return null; });
}

function _idbPut(key, value) {
	return _idb().then(function (db) {
		return new Promise(function (resolve) {
			var tx = db.transaction(IDB_STORE, 'readwrite');
			tx.objectStore(IDB_STORE).put(value, key);
			tx.oncomplete = function () { resolve(true); };
			tx.onerror    = function () { resolve(false); };
		});
	}).catch(function () { return false; });
}

// -------------------------------------------------------------------
// Live-from-disk read
// -------------------------------------------------------------------
// Re-read a script's source from the live directory handle. Returns
// the fresh text, or null if no handle / no permission / not found.
// Callers fall back to the cached `script.source` on null.
function _readFromHandle(dirHandle, relPath) {
	if (!dirHandle || !relPath) return Promise.resolve(null);
	var parts = String(relPath).replace(/\\/g, '/').split('/').filter(Boolean);
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
}

// Ensure read permission on a stored handle. Returns Promise<bool>.
// Re-prompts the user if needed (e.g., first Run after a reload).
function _ensureReadPermission(handle) {
	if (!handle) return Promise.resolve(false);
	if (typeof handle.queryPermission !== 'function') return Promise.resolve(true);
	return handle.queryPermission({ mode: 'read' }).then(function (state) {
		if (state === 'granted') return true;
		return handle.requestPermission({ mode: 'read' }).then(function (s) {
			return s === 'granted';
		});
	}).catch(function () { return false; });
}

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
	header.addEventListener('contextmenu', function (e) {
		e.preventDefault();
		e.stopPropagation();
		inst._data.selection = { folderIdx: folderIdx, scriptIdx: null };
		_renderTree(inst);
		_openContextMenu(inst, e.clientX, e.clientY, { kind: 'folder', folderIdx: folderIdx });
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
	row.addEventListener('contextmenu', function (e) {
		e.preventDefault();
		e.stopPropagation();
		inst._data.selection = { folderIdx: folderIdx, scriptIdx: scriptIdx };
		_renderTree(inst);
		_openContextMenu(inst, e.clientX, e.clientY,
			{ kind: 'script', folderIdx: folderIdx, scriptIdx: scriptIdx });
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
// Context menu
// -------------------------------------------------------------------
// Lightweight, self-contained right-click menu. One menu lives in the
// document body at a time; clicking outside or pressing Escape closes
// it. The `ctx` argument carries enough information for each entry's
// handler to act on the right row.
function _openContextMenu(inst, x, y, ctx) {
	_closeContextMenu();

	var items = _menuItemsFor(inst, ctx);
	if (!items || items.length === 0) return;

	var menu = document.createElement('div');
	menu.className = 'fr-context-menu';
	menu.style.position = 'fixed';
	menu.style.left = x + 'px';
	menu.style.top  = y + 'px';
	menu.style.minWidth = '180px';
	menu.style.background = 'var(--bg-secondary, #1e1e1e)';
	menu.style.border = '1px solid var(--border, #333)';
	menu.style.borderRadius = '6px';
	menu.style.padding = '4px 0';
	menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)';
	menu.style.zIndex = '10000';
	menu.style.fontFamily = "'DM Sans', sans-serif";
	menu.style.fontSize = '12px';
	menu.style.userSelect = 'none';

	for (var i = 0; i < items.length; i++) {
		var item = items[i];
		if (item === '-') {
			var sep = document.createElement('div');
			sep.style.height = '1px';
			sep.style.background = 'var(--border-subtle, #2a2a2a)';
			sep.style.margin = '4px 8px';
			menu.appendChild(sep);
			continue;
		}
		menu.appendChild(_menuItem(item));
	}

	document.body.appendChild(menu);
	_currentMenu = menu;

	// Clamp inside viewport
	var rect = menu.getBoundingClientRect();
	if (rect.right > window.innerWidth)   menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
	if (rect.bottom > window.innerHeight) menu.style.top  = (window.innerHeight - rect.height - 4) + 'px';

	setTimeout(function () {
		document.addEventListener('mousedown', _onDocClick, true);
		document.addEventListener('keydown',  _onDocKey, true);
	}, 0);
}

var _currentMenu = null;
function _closeContextMenu() {
	if (_currentMenu && _currentMenu.parentNode) _currentMenu.parentNode.removeChild(_currentMenu);
	_currentMenu = null;
	document.removeEventListener('mousedown', _onDocClick, true);
	document.removeEventListener('keydown',  _onDocKey, true);
}
function _onDocClick(e) {
	if (_currentMenu && !_currentMenu.contains(e.target)) _closeContextMenu();
}
function _onDocKey(e) {
	if (e.key === 'Escape') _closeContextMenu();
}

function _menuItem(item) {
	var el = document.createElement('div');
	el.className = 'fr-context-menu__item';
	el.style.padding = '5px 14px';
	el.style.cursor = item.disabled ? 'default' : 'pointer';
	el.style.color = item.disabled ? 'var(--text-dim, #666)' : 'var(--text-secondary, #ccc)';
	el.style.whiteSpace = 'nowrap';
	el.textContent = item.label;

	if (!item.disabled) {
		el.addEventListener('mouseenter', function () { el.style.background = 'var(--bg-hover, #2a2a2a)'; });
		el.addEventListener('mouseleave', function () { el.style.background = ''; });
		el.addEventListener('click', function () {
			_closeContextMenu();
			try { item.onClick && item.onClick(); }
			catch (e) { console.warn('context menu action failed:', e); }
		});
	}
	return el;
}

function _menuItemsFor(inst, ctx) {
	var d = inst._data;
	var hasFolder = ctx && (ctx.kind === 'folder' || ctx.kind === 'script');
	var hasScript = ctx && ctx.kind === 'script';
	var multipleFolders = (d.folders || []).length > 1;

	return [
		{ label: 'New folder',  onClick: function () { _createFolder(inst); } },
		{ label: 'Del folder',  disabled: !hasFolder || !multipleFolders,
		  onClick: function () { _removeFolder(inst); } },
		'-',
		{ label: 'Add script',  onClick: function () { _addScript(inst); } },
		{ label: 'Del script',  disabled: !hasScript,
		  onClick: function () { _removeScript(inst); } }
	];
}

// -------------------------------------------------------------------
// Actions
// -------------------------------------------------------------------
// Run the selected script and pipe its output into the Python REPL.
// Pyodide's globals dict is shared between pyBridge.run() calls, so
// any names the script defines (functions, imports, variables) are
// immediately reachable from the REPL prompt — the session simply
// continues there.
//
// Live-from-disk: if the script entry has a `path` and we hold a
// directory handle from Load Config, re-read the source fresh on
// every Run. This makes external edits (your usual editor) show up
// the next time you click Run with no re-Load step.
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

	var dirHandle = FontRig.ScriptingPanel._dirHandle;
	var relPath = script.path || (script.fileName ? script.fileName : null);
	var canReread = !!(dirHandle && relPath);

	var sourcePromise;
	if (canReread) {
		sourcePromise = _ensureReadPermission(dirHandle).then(function (granted) {
			if (!granted) return script.source;
			return _readFromHandle(dirHandle, relPath).then(function (fresh) {
				if (fresh == null) return script.source;
				// Sync the cache so localStorage and in-tree row stay current.
				if (fresh !== script.source) {
					script.source = fresh;
					delete script._missing;
					_save(inst);
				}
				return fresh;
			});
		});
	} else {
		sourcePromise = Promise.resolve(script.source);
	}

	sourcePromise.then(function (source) {
		if (typeof source !== 'string' || source.length === 0) {
			_log(inst, 'Script source is empty (' + script.name + ').', 'error');
			return;
		}

		if (typeof FontRig.pushUndo === 'function') {
			FontRig.pushUndo('Script: ' + script.name);
		}

		// Echo the run as an input line in the REPL so the transcript
		// reads linearly with whatever the user types next.
		if (FontRig.PythonPanel && typeof FontRig.PythonPanel.appendToActive === 'function') {
			FontRig.PythonPanel.appendToActive('# ▶ Running: ' + script.name, 'input');
		}

		var res = FontRig.pyBridge.run(source);
		if (res) {
			if (res.output) _log(inst, res.output, 'output');
			if (res.error)  _log(inst, res.error,  'error');
		}

		// Switch focus to the Python panel so the user can keep
		// interacting with whatever the script left in scope.
		if (FontRig.PythonPanel && typeof FontRig.PythonPanel.focusActive === 'function') {
			FontRig.PythonPanel.focusActive();
		}
	});
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
				.then(function (handle) {
					// Persist for live re-reads across this session and reloads.
					FontRig.ScriptingPanel._dirHandle = handle;
					_idbPut(IDB_HANDLE_KEY, handle);
					return _dirHandleFetcher(handle);
				});
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

// Route panel messages into the Python REPL transcript when it's
// mounted (the user's preferred place to read output / continue
// interacting). Falls back to the browser console for boot-time and
// silent-failure scenarios.
function _log(_inst, text, type) {
	var t = type === 'warn' ? 'error' : (type || 'output');
	var routed = (FontRig.PythonPanel && typeof FontRig.PythonPanel.appendToActive === 'function')
		? FontRig.PythonPanel.appendToActive(text, t)
		: false;
	if (!routed) {
		if (type === 'error') console.error('[scripts]', text);
		else if (type === 'warn') console.warn('[scripts]', text);
		else console.log('[scripts]', text);
	}
}

})();
