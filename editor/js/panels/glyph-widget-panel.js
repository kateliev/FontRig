// ===================================================================
// FontRig — Unified Glyph Widget Panel (Multi-Instance)
// ===================================================================
// Dual-mode (list + grid) glyph browser. Supports multiple
// simultaneous instances — each mount() returns an independent
// instance object with its own DOM, observer, and state.
//
// Uses GlyphRenderer for thumbnail rendering (shared Path2D cache).
//
// Depends on: glyph-renderer.js, sidebar.js (optional)
// ===================================================================
'use strict';

(function() {

if (typeof FontRig === 'undefined') return;

// -- Namespace (factory, not singleton) -----------------------------
FontRig.GlyphWidgetPanel = {};

// ===================================================================
// Mount: create a new instance into a container
// ===================================================================
// Returns an instance object with all per-instance state and methods.
// ===================================================================
FontRig.GlyphWidgetPanel.mount = function(containerEl, ctx) {
	if (!containerEl) return null;

	var inst = {
		_containerEl: containerEl,
		_listEl: null,
		_searchEl: null,
		_countEl: null,
		_observer: null,
		_viewMode: 'list',
		_listBtnEl: null,
		_gridBtnEl: null,
	};

	containerEl.innerHTML = '';

	// Restore persisted view mode (shared preference)
	try {
		var saved = localStorage.getItem('fr-glyph-view-mode');
		if (saved === 'list' || saved === 'grid') inst._viewMode = saved;
	} catch (e) { /* silent */ }

	// -- Header: [search] [count] [list|grid toggle] ----------------
	var header = document.createElement('div');
	header.className = 'glyph-widget-header';

	var search = document.createElement('input');
	search.type = 'text';
	search.placeholder = 'Filter glyphs...';
	search.spellcheck = false;
	search.autocomplete = 'off';
	header.appendChild(search);
	inst._searchEl = search;

	var count = document.createElement('span');
	count.className = 'glyph-widget-count';
	header.appendChild(count);
	inst._countEl = count;

	var modeGroup = document.createElement('div');
	modeGroup.className = 'glyph-widget-mode';

	var listBtn = document.createElement('button');
	listBtn.title = 'List view';
	listBtn.innerHTML = '<span class="tri">align_group_to_group</span>';
	modeGroup.appendChild(listBtn);
	inst._listBtnEl = listBtn;

	var gridBtn = document.createElement('button');
	gridBtn.title = 'Grid view';
	gridBtn.innerHTML = '<span class="tri">viewport_quad</span>';
	modeGroup.appendChild(gridBtn);
	inst._gridBtnEl = gridBtn;

	header.appendChild(modeGroup);
	containerEl.appendChild(header);

	// -- List container ----------------------------------------------
	var list = document.createElement('div');
	list.className = 'glyph-widget-list glyph-widget-list--' + inst._viewMode;
	containerEl.appendChild(list);
	inst._listEl = list;

	// -- Update mode button states -----------------------------------
	_updateModeButtons(inst);

	// -- Wire events -------------------------------------------------
	listBtn.addEventListener('click', function() {
		_setViewMode(inst, 'list');
	});

	gridBtn.addEventListener('click', function() {
		_setViewMode(inst, 'grid');
	});

	search.addEventListener('input', function() {
		_filter(inst, this.value);
	});

	list.addEventListener('click', function(e) {
		var entry = e.target.closest('.gw-entry');
		if (!entry) return;
		var name = entry.dataset.name;
		if (name) FontRig.switchGlyph(name);
	});

	list.addEventListener('dblclick', function(e) {
		var entry = e.target.closest('.gw-entry');
		if (!entry) return;
		var name = entry.dataset.name;
		if (!name || !FontRig.state.glyphViewMode) return;
		if (typeof FontRig.addGlyphToStrip === 'function') {
			FontRig.addGlyphToStrip(name);
		}
		_updateActive(inst);
	});

	// -- Attach public methods to the instance ----------------------
	inst.rebuild = function() { _rebuild(inst); };
	inst.updateActive = function() { _updateActive(inst); };
	inst.updateDirty = function() { _updateDirty(inst); };
	inst.updateMark = function(name) { _updateMarkTint(inst, name); };
	inst.filter = function(q) { _filter(inst, q); };
	inst.refreshThumbnail = function(name) { _refreshThumbnail(inst, name); };
	inst.setViewMode = function(mode) { _setViewMode(inst, mode); };
	inst.getListElement = function() { return inst._listEl; };

	// -- Handle events from main window (for workplane sync) -------
	inst.onMainWindowEvent = function(eventType) {
		if (eventType === 'fontChanged') {
			_rebuild(inst);
		} else if (eventType === 'glyphChanged') {
			_updateActive(inst);
			_updateDirty(inst);
		}
	};

	return inst;
};

// ===================================================================
// Internal methods (operate on instance)
// ===================================================================

function _updateModeButtons(inst) {
	if (inst._listBtnEl) inst._listBtnEl.classList.toggle('active', inst._viewMode === 'list');
	if (inst._gridBtnEl) inst._gridBtnEl.classList.toggle('active', inst._viewMode === 'grid');
}

function _setViewMode(inst, mode) {
	if (mode === inst._viewMode) return;
	inst._viewMode = mode;

	try {
		localStorage.setItem('fr-glyph-view-mode', mode);
	} catch (e) { /* silent */ }

	_updateModeButtons(inst);

	var list = inst._listEl;
	if (!list || !FontRig.font) {
		_rebuild(inst);
		return;
	}

	list.className = 'glyph-widget-list glyph-widget-list--' + mode;

	var isGrid = mode === 'grid';
	var thumbW = isGrid ? 48 : 28;
	var thumbH = isGrid ? 48 : 36;

	var canvases = list.querySelectorAll('.gw-thumb');
	for (var i = 0; i < canvases.length; i++) {
		canvases[i].style.width = thumbW + 'px';
		canvases[i].style.height = thumbH + 'px';
		canvases[i].dataset.cssW = thumbW;
		canvases[i].dataset.cssH = thumbH;
	}

	_rerenderAll(inst);
}

function _rerenderAll(inst) {
	var list = inst._listEl;
	if (!list) return;

	var entries = list.querySelectorAll('.gw-entry');
	for (var i = 0; i < entries.length; i++) {
		var el = entries[i];
		if (el.dataset.thumbLoaded !== 'true') continue;

		var name = el.dataset.name;
		var canvas = el.querySelector('.gw-thumb');
		if (!name || !canvas) continue;

		FontRig.GlyphRenderer.render(canvas, null, { glyphName: name, cacheOnly: true });
	}
}

function _rebuild(inst) {
	var list = inst._listEl;
	if (!list) return;

	if (inst._observer) inst._observer.disconnect();

	list.innerHTML = '';
	list.className = 'glyph-widget-list glyph-widget-list--' + inst._viewMode;

	if (!FontRig.font || !FontRig.font.manifest) {
		if (inst._countEl) inst._countEl.textContent = '';
		return;
	}

	// NOTE: We do NOT drain the global render queue here.
	// Other instances may have pending items. Items for removed
	// entries will fail gracefully (element gone from DOM).

	var isGrid = inst._viewMode === 'grid';
	var thumbW = isGrid ? 48 : 28;
	var thumbH = isGrid ? 48 : 36;

	for (var i = 0; i < FontRig.font.manifest.length; i++) {
		var entry = FontRig.font.manifest[i];
		var name = entry.alias || entry.name;
		var div = document.createElement('div');
		div.className = 'gw-entry';
		div.dataset.name = name;

		var cvs = document.createElement('canvas');
		cvs.className = 'gw-thumb';
		cvs.style.width = thumbW + 'px';
		cvs.style.height = thumbH + 'px';
		cvs.dataset.cssW = thumbW;
		cvs.dataset.cssH = thumbH;
		div.appendChild(cvs);

		var nameSpan = document.createElement('span');
		nameSpan.className = 'gw-name';
		nameSpan.textContent = name;
		div.appendChild(nameSpan);

		if (entry.unicodes) {
			var uniSpan = document.createElement('span');
			uniSpan.className = 'gw-uni';
			uniSpan.textContent = 'U+' + entry.unicodes;
			div.appendChild(uniSpan);
		}

		var dot = document.createElement('span');
		dot.className = 'gw-dirty';
		div.appendChild(dot);

		list.appendChild(div);
	}

	if (inst._searchEl) inst._searchEl.value = '';
	if (inst._countEl) inst._countEl.textContent = FontRig.font.manifest.length;

	// Setup IntersectionObserver for lazy thumbnail loading
	inst._observer = new IntersectionObserver(function(entries) {
		for (var i = 0; i < entries.length; i++) {
			if (!entries[i].isIntersecting) continue;
			var el = entries[i].target;
			var eName = el.dataset.name;
			if (!eName || el.dataset.thumbLoaded) continue;

			var canvas = el.querySelector('.gw-thumb');
			if (!canvas) continue;

			FontRig.GlyphRenderer.enqueue({
				name: eName,
				canvas: canvas,
				element: el
			});

			// Apply mark tint when entry becomes visible
			_applyMarkTint(el, _getGlyphMark(eName));
		}
	}, { root: list, rootMargin: '200px 0px' });

	var allEntries = list.querySelectorAll('.gw-entry');
	for (var i = 0; i < allEntries.length; i++) {
		inst._observer.observe(allEntries[i]);
		// Apply mark tinting for already-cached glyphs
		var eName = allEntries[i].dataset.name;
		var mark = _getGlyphMark(eName);
		if (mark) _applyMarkTint(allEntries[i], mark);
	}

	_updateActive(inst);
	_updateDirty(inst);
}

function _updateActive(inst) {
	var list = inst._listEl;
	if (!list) return;

	var stripSet = FontRig.workspace ? new Set(FontRig.workspace.glyphs) : new Set();
	var entries = list.querySelectorAll('.gw-entry');

	for (var i = 0; i < entries.length; i++) {
		var name = entries[i].dataset.name;
		entries[i].classList.toggle('active', name === FontRig.activeGlyph);
		entries[i].classList.toggle('in-strip',
			FontRig.state.glyphViewMode && stripSet.has(name));
	}

	var active = list.querySelector('.gw-entry.active');
	if (active) active.scrollIntoView({ block: 'nearest' });
}

function _updateDirty(inst) {
	var list = inst._listEl;
	if (!list) return;

	var entries = list.querySelectorAll('.gw-entry');
	for (var i = 0; i < entries.length; i++) {
		entries[i].classList.toggle('dirty',
			FontRig.dirtyGlyphs.has(entries[i].dataset.name));
	}
}

// -- Helper: convert hex color to rgba for tinting -------------------
function _hexToRgba(hex, alpha) {
	var r = parseInt(hex.slice(1, 3), 16);
	var g = parseInt(hex.slice(3, 5), 16);
	var b = parseInt(hex.slice(5, 7), 16);
	return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// -- Apply mark tint to a single entry element -----------------------
// Uses a CSS custom property so hover/active states layer on top.
function _applyMarkTint(el, mark) {
	if (mark && /^#[0-9A-Fa-f]{6}$/.test(mark)) {
		el.style.setProperty('--mark-color', _hexToRgba(mark, 0.15));
		el.classList.add('gw-marked');
	} else {
		el.style.removeProperty('--mark-color');
		el.classList.remove('gw-marked');
	}
}

// -- Get mark for a glyph name (from cache) --------------------------
function _getGlyphMark(name) {
	var cacheEntry = FontRig.glyphCache ? FontRig.glyphCache.get(name) : null;
	if (cacheEntry && cacheEntry.glyphData) return cacheEntry.glyphData.mark || '';
	var state = FontRig.state;
	if (state.glyphData && state.glyphData.name === name) return state.glyphData.mark || '';
	return '';
}

// -- Update mark tint for a single glyph by name --------------------
function _updateMarkTint(inst, name) {
	var list = inst._listEl;
	if (!list) return;

	var entry = list.querySelector('.gw-entry[data-name="' + name + '"]');
	if (!entry) return;

	_applyMarkTint(entry, _getGlyphMark(name));
}

function _filter(inst, query) {
	var list = inst._listEl;
	if (!list) return;

	var q = query.toLowerCase();
	var entries = list.querySelectorAll('.gw-entry');
	var visibleCount = 0;

	for (var i = 0; i < entries.length; i++) {
		var name = entries[i].dataset.name.toLowerCase();
		var visible = !q || name.indexOf(q) >= 0;
		entries[i].style.display = visible ? '' : 'none';
		if (visible) visibleCount++;
	}

	if (inst._countEl) {
		var total = FontRig.font ? FontRig.font.manifest.length : 0;
		inst._countEl.textContent = q ? visibleCount + '/' + total : total;
	}
}

function _refreshThumbnail(inst, name) {
	var list = inst._listEl;
	if (!list) return;

	var entry = list.querySelector('.gw-entry[data-name="' + name + '"]');
	if (!entry) return;

	var canvas = entry.querySelector('.gw-thumb');
	if (!canvas) return;

	var cacheEntry = FontRig.glyphCache ? FontRig.glyphCache.get(name) : null;
	if (!cacheEntry) return;

	// Path cache invalidation is done by the bridge function
	// (FontRig.refreshThumbnail) before calling each instance.
	entry.dataset.thumbLoaded = '';
	FontRig.GlyphRenderer.render(canvas, cacheEntry.glyphData, { glyphName: name });
	entry.dataset.thumbLoaded = 'true';
}

})();
