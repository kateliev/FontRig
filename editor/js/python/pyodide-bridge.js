// ===================================================================
// FontRig — Pyodide Bridge
// ===================================================================
// Loads CPython via WebAssembly (Pyodide CDN), fetches TypeRig core
// from GitHub, and provides the JS ↔ Python interface.
// ===================================================================
'use strict';

FontRig.pyBridge = {
	pyodide: null,
	ready: false,
	loading: false,
	error: null,

	// -- Configuration ---------------------------------------------------
	config: {
		repo: 'kateliev/TypeRig',
		branch: 'master',
		basePath: 'Lib',
	},

	// -- File manifest: only pure-Python core files ------------------------
	// Package __init__ files are stubbed to avoid pulling proxy/FL deps.
	manifest: [
		// Core objects
		'typerig/core/objects/atom.py',
		'typerig/core/objects/collection.py',
		'typerig/core/objects/point.py',
		'typerig/core/objects/line.py',
		'typerig/core/objects/cubicbezier.py',
		'typerig/core/objects/quadraticbezier.py',
		'typerig/core/objects/transform.py',
		'typerig/core/objects/utils.py',
		'typerig/core/objects/array.py',
		'typerig/core/objects/matrix.py',
		'typerig/core/objects/node.py',
		'typerig/core/objects/contour.py',
		'typerig/core/objects/shape.py',
		'typerig/core/objects/sdf.py',
		'typerig/core/objects/anchor.py',
		'typerig/core/objects/layer.py',
		'typerig/core/objects/glyph.py',
		'typerig/core/objects/delta.py',
		'typerig/core/objects/hobbyspline.py',

		// Core functions
		'typerig/core/func/math.py',
		'typerig/core/func/transform.py',
		'typerig/core/func/utils.py',
		'typerig/core/func/geometry.py',

		// File I/O
		'typerig/core/fileio/xmlio.py',

		// Core actions
		'typerig/core/actions/node-actions.py',
	],

	// -- Local modules: editor-specific Python files served from FontRig --
	// These are fetched relative to the editor root, not from GitHub.
	// Installed into the same Pyodide site-packages tree.
	localModules: [
		{ src: 'python/node-panel-actions.py', dest: 'typerig/core/actions/node-panel-actions.py' },
	],

	// -- Stub __init__.py contents -----------------------------------------
	// We stub these to avoid importing proxy/FL-dependent subpackages
	stubs: {
		'typerig/__init__.py': '# TypeRig — browser stub\n__version__ = "web"\n',

		'typerig/core/__init__.py': '# TypeRig / Core — browser stub\n',

		'typerig/core/objects/__init__.py':
			'from .node import Node\n' +
			'from .contour import Contour\n' +
			'from .shape import Shape\n' +
			'from .layer import Layer\n' +
			'from .glyph import Glyph\n' +
			'from .anchor import Anchor\n' +
			'__all__ = ["Node", "Contour", "Shape", "Layer", "Glyph", "Anchor"]\n',

		'typerig/core/func/__init__.py': '# TypeRig / Core / Func — browser stub\n',

		'typerig/core/func/string.py': '# TypeRig / Core / Func / String — stub\ndef is_hex(s): return False\ndef hue_to_hex(h): return "#000000"\ndef hex_to_hue(h): return 0\n',

		'typerig/core/fileio/__init__.py': '# TypeRig / Core / FileIO — browser stub\n',

		'typerig/core/actions/__init__.py': '# TypeRig / Core / Actions — browser stub\n',
	},

	// -- Build raw GitHub URL -------------------------------------------
	_rawUrl: function(filePath) {
		var c = this.config;
		return 'https://raw.githubusercontent.com/' +
			c.repo + '/' + c.branch + '/' + c.basePath + '/' + filePath;
	},

	// -- Initialize Pyodide + TypeRig -----------------------------------
	init: async function(onProgress) {
		if (this.ready || this.loading) return;
		this.loading = true;
		this.error = null;

		var log = onProgress || function() {};

		try {
			// 1. Load Pyodide runtime from CDN
			log('Loading Python runtime\u2026');
			this.pyodide = await loadPyodide();
			log('Python runtime loaded.');

			// 2. Detect site-packages path dynamically
			var sitePackages = this.pyodide.runPython(
				'import site; site.getsitepackages()[0]'
			) + '/';

			// 3. Create directory structure in Pyodide virtual FS
			var dirs = [
				'typerig',
				'typerig/core',
				'typerig/core/objects',
				'typerig/core/func',
				'typerig/core/fileio',
				'typerig/core/actions',
			];

			for (var i = 0; i < dirs.length; i++) {
				try { this.pyodide.FS.mkdirTree(sitePackages + dirs[i]); }
				catch (e) { /* already exists */ }
			}

			// 4. Write stub __init__.py files
			for (var path in this.stubs) {
				this.pyodide.FS.writeFile(sitePackages + path, this.stubs[path]);
			}

			// 5. Create directories for manifest modules
			var manifestDirs = {};
			for (var i = 0; i < this.manifest.length; i++) {
				var parts = this.manifest[i].split('/');
				for (var j = 1; j < parts.length; j++) {
					var dir = parts.slice(0, j).join('/');
					manifestDirs[dir] = true;
				}
			}
			for (var dirPath in manifestDirs) {
				try { this.pyodide.FS.mkdirTree(sitePackages + dirPath); }
				catch (e) { /* already exists */ }
			}

			// 6. Fetch real module files from GitHub (if manifest provided)
			if (this.manifest && this.manifest.length > 0) {
				log('Fetching TypeRig core (' + this.manifest.length + ' files)\u2026');

				var fetches = this.manifest.map(function(filePath) {
					return fetch(FontRig.pyBridge._rawUrl(filePath))
						.then(function(r) {
							if (!r.ok) throw new Error(filePath + ': ' + r.status);
							return r.text();
						})
						.then(function(text) {
							return { path: filePath, text: text };
						})
						.catch(function(err) {
							console.warn('[pyBridge] Fetch failed (non-fatal):', err.message || err);
							return null;
						});
				});

				var results = await Promise.all(fetches);
				var installed = 0;

				for (var j = 0; j < results.length; j++) {
					if (results[j]) {
						this.pyodide.FS.writeFile(sitePackages + results[j].path, results[j].text);
						installed++;
					}
				}

				log('TypeRig core installed (' + installed + '/' + this.manifest.length + ' modules).');
			} else {
				log('No TypeRig core manifest \u2014 using stubs only.');
			}

			// 6b. Fetch local editor-specific modules
			if (this.localModules && this.localModules.length > 0) {
				log('Fetching editor modules (' + this.localModules.length + ' files)\u2026');

				var localFetches = this.localModules.map(function(mod) {
					return fetch(mod.src)
						.then(function(r) {
							if (!r.ok) throw new Error(mod.src + ': ' + r.status);
							return r.text();
						})
						.then(function(text) {
							return { dest: mod.dest, text: text };
						})
						.catch(function(err) {
							console.warn('[pyBridge] Local fetch failed (non-fatal):', err.message || err);
							return null;
						});
				});

				var localResults = await Promise.all(localFetches);
				var localInstalled = 0;

				for (var k = 0; k < localResults.length; k++) {
					if (localResults[k]) {
						// Ensure dest directory exists
						var destParts = localResults[k].dest.split('/');
						for (var d = 1; d < destParts.length; d++) {
							var dirPath = destParts.slice(0, d).join('/');
							try { this.pyodide.FS.mkdirTree(sitePackages + dirPath); } catch(_) {}
						}
						this.pyodide.FS.writeFile(sitePackages + localResults[k].dest, localResults[k].text);
						localInstalled++;
					}
				}

				log('Editor modules installed (' + localInstalled + '/' + this.localModules.length + ').');
			}

			// 7. Bootstrap: import core, set up bridge helpers
			this.pyodide.runPython([
				'import sys',
				'from typerig.core.objects import Node, Contour, Shape, Layer, Glyph, Anchor',
				'from typerig.core.objects.transform import Transform',
				'from typerig.core.objects.delta import DeltaScale',
				'from typerig.core.objects.point import Point',
				'from typerig.core.objects.line import Line',
				'from typerig.core.objects.array import PointArray',
				'from typerig.core.fileio.xmlio import XMLSerializable',
				'',
				'# Glyph variable \u2014 synced with viewer',
				'glyph = None',
				'',
				'# Layer selection \u2014 synced from Layer Select dialog',
				'selected_layers = []',
				'layer_info = []',
				'',
				'# Scope \u2014 synced from Toolbar Controller',
				'scope_layers = []',
				'scope_glyphs = []',
				'scope_layer_mode = "masters"',
				'scope_glyph_mode = "active"',
				'',
				'# -- Selection bridge helpers --',
				'def _set_selection(id_list, layer_name=None, mirror_to_scope=True):',
				'    """Set node selection, mirroring indices to scope layers."""',
				'    if glyph is None: return',
				'    for _lyr in glyph.layers:',
				'        for shape in _lyr.shapes:',
				'            for contour in shape.contours:',
				'                for node in contour.data:',
				'                    node.selected = False',
				'    target_names = set()',
				'    if layer_name:',
				'        target_names.add(layer_name)',
				'    elif glyph.layers:',
				'        target_names.add(glyph.layers[0].name)',
				'    if mirror_to_scope and scope_layers:',
				'        for sn in scope_layers:',
				'            target_names.add(sn)',
				'    selected = set(id_list)',
				'    for tname in target_names:',
				'        _lyr = glyph.layer(tname)',
				'        if _lyr is None: continue',
				'        ci = 0',
				'        for shape in _lyr.shapes:',
				'            for contour in shape.contours:',
				'                for ni, node in enumerate(contour.data):',
				'                    node.selected = ("c%d_n%d" % (ci, ni)) in selected',
				'                ci += 1',
				'',
				'def _get_selection(layer_name=None):',
				'    """Get selected node ids as list."""',
				'    if glyph is None: return []',
				'    layer = glyph.layer(layer_name) if layer_name else (glyph.layers[0] if glyph.layers else None)',
				'    if layer is None: return []',
				'    result = []',
				'    ci = 0',
				'    for shape in layer.shapes:',
				'        for contour in shape.contours:',
				'            for ni, node in enumerate(contour.data):',
				'                if getattr(node, "selected", False):',
				'                    result.append("c%d_n%d" % (ci, ni))',
				'            ci += 1',
				'    return result',
				'',
				'# Import node-actions (non-fatal)',
				'NodeActions = None',
				'try:',
				'    import importlib.util as _ilu',
				'    _na_path = __import__("site").getsitepackages()[0] + "/typerig/core/actions/node-actions.py"',
				'    _spec = _ilu.spec_from_file_location("node_actions", _na_path)',
				'    _mod = _ilu.module_from_spec(_spec)',
				'    _spec.loader.exec_module(_mod)',
				'    NodeActions = _mod.NodeActions',
				'    sys.modules["typerig.core.actions.node_actions"] = _mod',
				'    del _ilu, _spec, _mod, _na_path',
				'except Exception as _e:',
				'    print("Warning: NodeActions not loaded:", _e)',
				'',
				'# Import node-panel-actions (non-fatal)',
				'_npa = None',
				'try:',
				'    import importlib.util as _ilu',
				'    _npa_path = __import__("site").getsitepackages()[0] + "/typerig/core/actions/node-panel-actions.py"',
				'    _spec = _ilu.spec_from_file_location("node_panel_actions", _npa_path)',
				'    _mod = _ilu.module_from_spec(_spec)',
				'    _spec.loader.exec_module(_mod)',
				'    _npa = _mod',
				'    sys.modules["typerig.core.actions.node_panel_actions"] = _mod',
				'    del _ilu, _spec, _mod, _npa_path',
				'except Exception as _e:',
				'    print("Warning: NodePanelActions not loaded:", _e)',
				'',
				'# Thin wrappers that inject bridge globals (glyph, scope_layers, NodeActions)',
				'def npa(name, *args, **kw):',
				'    fn = getattr(_npa, name, None)',
				'    if fn is None: raise RuntimeError("Unknown action: " + name)',
				'    return fn(glyph, scope_layers, NodeActions, *args, **kw)',
				'',
				'print("TypeRig core ready \u2014 Python", sys.version.split()[0])',
				'print("Available: Node, Contour, Shape, Layer, Glyph, Anchor")',
				'print("           Transform, DeltaScale, Point, Line, PointArray")',
				'print("           NodeActions:", "loaded" if NodeActions else "not available")',
				'print("           NodePanelActions:", "loaded" if _npa else "not available")',
				'print("Selection: glyph.selected_nodes, node.selected")',
				'print("Layers:   selected_layers, layer_info")',
				'print("Scope:    scope_layers, scope_glyphs, scope_layer_mode, scope_glyph_mode")',
				'print()',
			].join('\n'));

			this.ready = true;
			this.loading = false;
			log('Ready.');

		} catch (e) {
			this.error = e.message || String(e);
			this.loading = false;
			log('Error: ' + this.error);
			console.error('Pyodide bridge init failed:', e);
		}
	},

	// -- Sync viewer glyph \u2192 Python glyph variable ----------------------
	// Also syncs selection state (not in XML, passed separately)
	syncToPython: function() {
		if (!this.ready || !FontRig.state.glyphData) return;

		// Serialize current viewer glyph to XML
		var xml = FontRig.glyphToXml(FontRig.state.glyphData);
		this.pyodide.globals.set('_xml_in', xml);

		this.pyodide.runPython(
			'glyph = Glyph.from_XML(_xml_in)\n' +
			'del _xml_in\n'
		);

		// Sync scope first (needed by _set_selection for mirroring)
		if (FontRig.scope) {
			var scopeLayerNames = FontRig.scope.getLayers();
			var scopeGlyphNames = FontRig.scope.getGlyphs();
			this.pyodide.globals.set('_scope_layers', scopeLayerNames);
			this.pyodide.globals.set('_scope_glyphs', scopeGlyphNames);
			this.pyodide.globals.set('_scope_layer_mode', FontRig.scope.layerMode);
			this.pyodide.globals.set('_scope_glyph_mode', FontRig.scope.glyphMode);
			this.pyodide.runPython(
				'scope_layers = list(_scope_layers.to_py())\n' +
				'scope_glyphs = list(_scope_glyphs.to_py())\n' +
				'scope_layer_mode = str(_scope_layer_mode)\n' +
				'scope_glyph_mode = str(_scope_glyph_mode)\n' +
				'del _scope_layers, _scope_glyphs, _scope_layer_mode, _scope_glyph_mode\n'
			);
		}

		// Sync selection: JS selectedNodeIds \u2192 Python node.selected
		// Now mirrors to all scope_layers automatically
		var selIds = Array.from(FontRig.state.selectedNodeIds);
		var activeName = FontRig.state.activeLayer || '';
		this.pyodide.globals.set('_sel_ids', selIds);
		this.pyodide.globals.set('_sel_layer', activeName);
		this.pyodide.runPython(
			'_set_selection(_sel_ids.to_py(), _sel_layer)\n' +
			'del _sel_ids, _sel_layer\n'
		);

		// Sync layer selection: FontRig.layerSelection \u2192 Python selected_layers
		if (FontRig.layerSelection && FontRig.layerSelection.layers.length > 0) {
			var checkedNames = FontRig.layerSelection.getChecked();
			var layerInfo = FontRig.layerSelection.layers.map(function(l) {
				return { name: l.name, type: l.type, checked: l.checked };
			});
			this.pyodide.globals.set('_layer_sel', checkedNames);
			this.pyodide.globals.set('_layer_info', JSON.stringify(layerInfo));
			this.pyodide.runPython(
				'import json as _json\n' +
				'selected_layers = list(_layer_sel.to_py())\n' +
				'layer_info = _json.loads(_layer_info)\n' +
				'del _layer_sel, _layer_info, _json\n'
			);
		}
	},

	// -- Sync Python glyph \u2192 viewer state --------------------------------
	// Reads XML and selection back from Python, updates viewer + canvas
	syncFromPython: function() {
		if (!this.ready) return false;

		try {
			var xml = this.pyodide.runPython(
				'glyph.to_XML() if glyph is not None else ""'
			);

			if (!xml) return false;

			var newGlyph = FontRig.parseGlyphXML(xml);

			FontRig.state.glyphData = newGlyph;
			FontRig.state.rawXml = xml;

			// Sync selection: Python node.selected \u2192 JS selectedNodeIds
			var activeName = FontRig.state.activeLayer || '';
			this.pyodide.globals.set('_sel_layer', activeName);
			var pySelRaw = this.pyodide.runPython(
				'_get_selection(_sel_layer)'
			);
			this.pyodide.runPython('del _sel_layer');
			// Pyodide may return a JsProxy for lists \u2014 convert to native JS
			var pySel = pySelRaw && pySelRaw.toJs ? pySelRaw.toJs() : pySelRaw;
			if (Array.isArray(pySel)) {
				FontRig.state.selectedNodeIds = new Set(pySel);
			}

			// Update layer selector (only if DOM element exists)
			var currentLayer = FontRig.state.activeLayer;
			if (FontRig.dom.layerSelect) {
				FontRig.dom.layerSelect.innerHTML = '';
				for (var i = 0; i < newGlyph.layers.length; i++) {
					var layer = newGlyph.layers[i];
					var opt = document.createElement('option');
					opt.value = layer.name;
					opt.textContent = layer.name || '(unnamed)';
					FontRig.dom.layerSelect.appendChild(opt);
				}

				if (newGlyph.layers.find(function(l) { return l.name === currentLayer; })) {
					FontRig.dom.layerSelect.value = currentLayer;
				} else if (newGlyph.layers.length > 0) {
					FontRig.state.activeLayer = newGlyph.layers[0].name;
					FontRig.dom.layerSelect.value = FontRig.state.activeLayer;
				}
			} else {
				if (!newGlyph.layers.find(function(l) { return l.name === currentLayer; })) {
					if (newGlyph.layers.length > 0) {
						FontRig.state.activeLayer = newGlyph.layers[0].name;
					}
				}
			}

			// Update glyph info (only if DOM element exists)
			var infoHtml = '<span>' + (newGlyph.name || '?') + '</span>';
			if (newGlyph.unicodes) infoHtml += ' U+' + newGlyph.unicodes;
			if (FontRig.dom.glyphInfo) FontRig.dom.glyphInfo.innerHTML = infoHtml;

			// Refresh XML panel if visible
			if (FontRig.state.showXml && FontRig.state.activePanel === 'xml') {
				FontRig.buildXmlPanel();
			}

			// Force canvas redraw on next frame
			requestAnimationFrame(function() { FontRig.draw(); });

			// Update status bar selection count
			if (FontRig.updateStatusSelected) FontRig.updateStatusSelected();

			return true;

		} catch (e) {
			console.error('syncFromPython failed:', e);
			return false;
		}
	},

	// -- Execute user code -----------------------------------------------
	// Returns { output: string, error: string|null, glyphChanged: bool }
	run: function(code) {
		if (!this.ready) {
			return { output: '', error: 'Python not ready. Click Init to load.', glyphChanged: false };
		}

		// Sync current viewer state \u2192 Python (glyph + selection)
		this.syncToPython();

		// Capture stdout/stderr
		this.pyodide.runPython(
			'import io as _io, sys as _sys\n' +
			'_capture = _io.StringIO()\n' +
			'_old_stdout = _sys.stdout\n' +
			'_old_stderr = _sys.stderr\n' +
			'_sys.stdout = _capture\n' +
			'_sys.stderr = _capture\n'
		);

		var output = '';
		var error = null;
		var glyphChanged = false;

		try {
			// Use AST to separate exec from final expression eval.
			this.pyodide.globals.set('_user_code', code);

			this.pyodide.runPython([
				'_user_result = None',
				'import ast as _ast',
				'try:',
				'    _tree = _ast.parse(_user_code)',
				'    if _tree.body and isinstance(_tree.body[-1], _ast.Expr):',
				'        _last_expr = _tree.body.pop()',
				'        if _tree.body:',
				'            exec(compile(_tree, "<repl>", "exec"))',
				'        _expr_tree = _ast.Expression(body=_last_expr.value)',
				'        _user_result = eval(compile(_expr_tree, "<repl>", "eval"))',
				'    else:',
				'        exec(compile(_tree, "<repl>", "exec"))',
				'except SyntaxError:',
				'    exec(compile(_user_code, "<repl>", "exec"))',
				'del _user_code, _ast',
			].join('\n'));

			output = this.pyodide.runPython('_capture.getvalue()');

			// Show REPL result (last expression value) if no print output
			if (!output) {
				try {
					var result = this.pyodide.runPython(
						'repr(_user_result) if _user_result is not None else ""'
					);
					if (result) output = result + '\n';
				} catch (_) { /* no result */ }
			}

		} catch (e) {
			// Get any partial output
			try { output = this.pyodide.runPython('_capture.getvalue()'); }
			catch (_) { /* ignore */ }

			error = String(e.message || e);
			// Clean up Pyodide traceback noise
			error = error.replace(/^PythonError:\s*/i, '');
		}

		// Restore stdout/stderr (always, even after error)
		try {
			this.pyodide.runPython(
				'_sys.stdout = _old_stdout\n' +
				'_sys.stderr = _old_stderr\n' +
				'del _capture, _old_stdout, _old_stderr, _io, _sys\n' +
				'try:\n    del _user_result\nexcept: pass\n'
			);
		} catch (_) { /* safety net */ }

		// Always sync back
		glyphChanged = this.syncFromPython();

		return { output: output, error: error, glyphChanged: glyphChanged };
	},
};
