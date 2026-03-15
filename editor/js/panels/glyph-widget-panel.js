// ===================================================================
// FontRig — Unified Glyph Widget Panel
// ===================================================================
// Dual-mode (list + grid) glyph browser. Designed to be mounted
// into any container — sidebar panel, popup, or standalone window.
//
// Uses GlyphRenderer for thumbnail rendering and supports:
//   - List mode (compact rows with thumbnails)
//   - Grid mode (thumbnail grid)
//   - Search/filter
//   - Active glyph highlighting
//   - Dirty state indicators
//   - IntersectionObserver lazy loading (both modes)
//   - Click → switchGlyph, dblclick → addToStrip
//   - View mode persistence via localStorage
//
// Depends on: glyph-renderer.js, sidebar.js (optional)
// ===================================================================
'use strict';

(function() {

if (typeof FontRig === 'undefined') return;

// -- Namespace ------------------------------------------------------
FontRig.GlyphWidgetPanel = {};

// -- State ----------------------------------------------------------
FontRig.GlyphWidgetPanel._observer = null;
FontRig.GlyphWidgetPanel._listEl = null;
FontRig.GlyphWidgetPanel._searchEl = null;
FontRig.GlyphWidgetPanel._countEl = null;
FontRig.GlyphWidgetPanel._containerEl = null;
FontRig.GlyphWidgetPanel._viewMode = 'list'; // 'list' | 'grid'
FontRig.GlyphWidgetPanel._listBtnEl = null;
FontRig.GlyphWidgetPanel._gridBtnEl = null;

// ===================================================================
// Build the widget DOM and mount into a container
// ===================================================================
FontRig.GlyphWidgetPanel.mount = function(containerEl) {
	if (!containerEl) return;

	var gw = FontRig.GlyphWidgetPanel;
	gw._containerEl = containerEl;
	containerEl.innerHTML = '';

	// Restore persisted view mode
	try {
		var saved = localStorage.getItem('fr-glyph-view-mode');
		if (saved === 'list' || saved === 'grid') gw._viewMode = saved;
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
	gw._searchEl = search;

	var count = document.createElement('span');
	count.className = 'glyph-widget-count';
	header.appendChild(count);
	gw._countEl = count;

	var modeGroup = document.createElement('div');
	modeGroup.className = 'glyph-widget-mode';

	var listBtn = document.createElement('button');
	listBtn.title = 'List view';
	listBtn.innerHTML = '<span class="tri">align_group_to_group</span>';
	modeGroup.appendChild(listBtn);
	gw._listBtnEl = listBtn;

	var gridBtn = document.createElement('button');
	gridBtn.title = 'Grid view';
	gridBtn.innerHTML = '<span class="tri">viewport_quad</span>';
	modeGroup.appendChild(gridBtn);
	gw._gridBtnEl = gridBtn;

	header.appendChild(modeGroup);
	containerEl.appendChild(header);

	// -- List container ----------------------------------------------
	var list = document.createElement('div');
	list.className = 'glyph-widget-list glyph-widget-list--' + gw._viewMode;
	containerEl.appendChild(list);
	gw._listEl = list;

	// -- Update mode button states -----------------------------------
	gw._updateModeButtons();

	// -- Wire events -------------------------------------------------
	listBtn.addEventListener('click', function() {
		gw.setViewMode('list');
	});

	gridBtn.addEventListener('click', function() {
		gw.setViewMode('grid');
	});

	search.addEventListener('input', function() {
		gw.filter(this.value);
	});

	// Click on glyph entry → switch glyph
	list.addEventListener('click', function(e) {
		var entry = e.target.closest('.gw-entry');
		if (!entry) return;
		var name = entry.dataset.name;
		if (name) FontRig.switchGlyph(name);
	});

	// Double click → add to strip
	list.addEventListener('dblclick', function(e) {
		var entry = e.target.closest('.gw-entry');
		if (!entry) return;
		var name = entry.dataset.name;
		if (!name || !FontRig.state.glyphViewMode) return;
		if (typeof FontRig.addGlyphToStrip === 'function') {
			FontRig.addGlyphToStrip(name);
		}
		gw.updateActive();
	});
};

// ===================================================================
// Set view mode (list or grid)
// ===================================================================
FontRig.GlyphWidgetPanel.setViewMode = function(mode) {
	var gw = FontRig.GlyphWidgetPanel;
	if (mode === gw._viewMode) return;
	gw._viewMode = mode;

	// Persist
	try {
		localStorage.setItem('fr-glyph-view-mode', mode);
	} catch (e) { /* silent */ }

	gw._updateModeButtons();

	// Rebuild entries (canvas sizes differ between modes)
	gw.rebuild();
};

// ===================================================================
// Update mode toggle button states
// ===================================================================
FontRig.GlyphWidgetPanel._updateModeButtons = function() {
	var gw = FontRig.GlyphWidgetPanel;
	if (gw._listBtnEl) gw._listBtnEl.classList.toggle('active', gw._viewMode === 'list');
	if (gw._gridBtnEl) gw._gridBtnEl.classList.toggle('active', gw._viewMode === 'grid');
};

// ===================================================================
// Build / rebuild glyph entries from font manifest
// ===================================================================
FontRig.GlyphWidgetPanel.rebuild = function() {
	var gw = FontRig.GlyphWidgetPanel;
	var list = gw._listEl;
	if (!list) return;

	// Disconnect previous observer
	if (gw._observer) gw._observer.disconnect();

	list.innerHTML = '';
	list.className = 'glyph-widget-list glyph-widget-list--' + gw._viewMode;

	if (!FontRig.font || !FontRig.font.manifest) {
		if (gw._countEl) gw._countEl.textContent = '';
		return;
	}

	// Clear renderer queue and path cache for fresh start
	FontRig.GlyphRenderer._queue = [];

	var isGrid = gw._viewMode === 'grid';
	var thumbW = isGrid ? 48 : 28;
	var thumbH = isGrid ? 48 : 36;

	for (var i = 0; i < FontRig.font.manifest.length; i++) {
		var entry = FontRig.font.manifest[i];
		var name = entry.alias || entry.name;
		var div = document.createElement('div');
		div.className = 'gw-entry';
		div.dataset.name = name;

		// Thumbnail canvas
		var cvs = document.createElement('canvas');
		cvs.className = 'gw-thumb';
		cvs.width = thumbW;
		cvs.height = thumbH;
		div.appendChild(cvs);

		// Name label
		var nameSpan = document.createElement('span');
		nameSpan.className = 'gw-name';
		nameSpan.textContent = name;
		div.appendChild(nameSpan);

		// Unicode (list mode only, hidden in grid via CSS)
		if (entry.unicodes) {
			var uniSpan = document.createElement('span');
			uniSpan.className = 'gw-uni';
			uniSpan.textContent = 'U+' + entry.unicodes;
			div.appendChild(uniSpan);
		}

		// Dirty dot
		var dot = document.createElement('span');
		dot.className = 'gw-dirty';
		div.appendChild(dot);

		list.appendChild(div);
	}

	// Clear search
	if (gw._searchEl) gw._searchEl.value = '';

	// Show count
	if (gw._countEl) gw._countEl.textContent = FontRig.font.manifest.length;

	// Setup IntersectionObserver for lazy thumbnail loading
	gw._observer = new IntersectionObserver(function(entries) {
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
		}
	}, { root: list, rootMargin: '200px 0px' });

	var allEntries = list.querySelectorAll('.gw-entry');
	for (var i = 0; i < allEntries.length; i++) {
		gw._observer.observe(allEntries[i]);
	}

	// Update active/dirty state
	gw.updateActive();
	gw.updateDirty();
};

// ===================================================================
// Update active glyph highlighting
// ===================================================================
FontRig.GlyphWidgetPanel.updateActive = function() {
	var gw = FontRig.GlyphWidgetPanel;
	var list = gw._listEl;
	if (!list) return;

	var stripSet = FontRig.workspace ? new Set(FontRig.workspace.glyphs) : new Set();
	var entries = list.querySelectorAll('.gw-entry');

	for (var i = 0; i < entries.length; i++) {
		var name = entries[i].dataset.name;
		entries[i].classList.toggle('active', name === FontRig.activeGlyph);
		entries[i].classList.toggle('in-strip',
			FontRig.state.glyphViewMode && stripSet.has(name));
	}

	// Scroll active entry into view
	var active = list.querySelector('.gw-entry.active');
	if (active) active.scrollIntoView({ block: 'nearest' });
};

// ===================================================================
// Update dirty dots
// ===================================================================
FontRig.GlyphWidgetPanel.updateDirty = function() {
	var gw = FontRig.GlyphWidgetPanel;
	var list = gw._listEl;
	if (!list) return;

	var entries = list.querySelectorAll('.gw-entry');
	for (var i = 0; i < entries.length; i++) {
		entries[i].classList.toggle('dirty',
			FontRig.dirtyGlyphs.has(entries[i].dataset.name));
	}
};

// ===================================================================
// Filter by search query
// ===================================================================
FontRig.GlyphWidgetPanel.filter = function(query) {
	var gw = FontRig.GlyphWidgetPanel;
	var list = gw._listEl;
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

	if (gw._countEl) {
		var total = FontRig.font ? FontRig.font.manifest.length : 0;
		gw._countEl.textContent = q ? visibleCount + '/' + total : total;
	}
};

// ===================================================================
// Refresh a single thumbnail after editing
// ===================================================================
FontRig.GlyphWidgetPanel.refreshThumbnail = function(name) {
	var gw = FontRig.GlyphWidgetPanel;
	var list = gw._listEl;
	if (!list) return;

	var entry = list.querySelector('.gw-entry[data-name="' + name + '"]');
	if (!entry) return;

	var canvas = entry.querySelector('.gw-thumb');
	if (!canvas) return;

	var cacheEntry = FontRig.glyphCache.get(name);
	if (!cacheEntry) return;

	// Invalidate path cache and re-render
	FontRig.GlyphRenderer.invalidate(name);
	entry.dataset.thumbLoaded = '';
	FontRig.GlyphRenderer.render(canvas, cacheEntry.glyphData, { glyphName: name });
	entry.dataset.thumbLoaded = 'true';
};

// ===================================================================
// Get the list element (for external queries like dialog scope)
// ===================================================================
FontRig.GlyphWidgetPanel.getListElement = function() {
	return FontRig.GlyphWidgetPanel._listEl;
};

})();
