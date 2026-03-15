// ===================================================================
// FontRig — Sidebar Framework
// ===================================================================
// Reusable resizable sidebar with vertical tabs. Supports left and
// right positioning, drag-to-resize, collapse/expand, and
// localStorage persistence for width and view preferences.
//
// Usage:
//   FontRig.Sidebar.create({ id, position, ... });
//
// Each sidebar instance manages its own DOM, resize handle, tabs,
// and state independently.
// ===================================================================
'use strict';

(function() {

if (typeof FontRig === 'undefined') return;

// -- Sidebar namespace --------------------------------------------------
FontRig.Sidebar = {};

// -- Registry of all sidebar instances ----------------------------------
FontRig.Sidebar._instances = {};

// -- Persistence helpers ------------------------------------------------
FontRig.Sidebar._loadPref = function(key, fallback) {
	try {
		var val = localStorage.getItem('fr-sidebar-' + key);
		return val !== null ? JSON.parse(val) : fallback;
	} catch (e) { return fallback; }
};

FontRig.Sidebar._savePref = function(key, value) {
	try {
		localStorage.setItem('fr-sidebar-' + key, JSON.stringify(value));
	} catch (e) { /* silent */ }
};

// ===================================================================
// Sidebar.create — Build a sidebar instance
// ===================================================================
// Options:
//   id           : unique string identifier (e.g. 'left-sidebar')
//   position     : 'left' | 'right'
//   defaultWidth : number (px) or string like '40%'
//   minWidth     : number (px), default 150
//   maxWidth     : number (px), default 600
//   tabs         : [{ id, label, icon }] — ordered tab definitions
//   defaultTab   : tab id to activate on creation
//   container    : parent DOM element (defaults to #main)
//   onResize     : function() — called during/after resize
//   onTabSwitch  : function(tabId, prevTabId) — called on tab change
//   onToggle     : function(visible) — called on show/hide
// ===================================================================
FontRig.Sidebar.create = function(options) {
	var id = options.id;
	if (FontRig.Sidebar._instances[id]) {
		return FontRig.Sidebar._instances[id];
	}

	var sidebar = {
		id: id,
		position: options.position || 'left',
		defaultWidth: options.defaultWidth || 220,
		minWidth: options.minWidth || 150,
		maxWidth: options.maxWidth || 600,
		tabs: options.tabs || [],
		activeTab: null,
		visible: false,
		el: null,           // sidebar container element
		handleEl: null,      // resize handle element
		tabBarEl: null,      // vertical tab bar
		contentEl: null,     // content area (holds tab panels)
		panelEls: {},        // tab id → panel element
		container: options.container || FontRig.dom.main,
		onResize: options.onResize || null,
		onTabSwitch: options.onTabSwitch || null,
		onToggle: options.onToggle || null,
	};

	// -- Build DOM --------------------------------------------------
	FontRig.Sidebar._buildDOM(sidebar);

	// -- Restore persisted width ------------------------------------
	var savedWidth = FontRig.Sidebar._loadPref(id + '-width', null);
	if (savedWidth) {
		sidebar.el.style.width = savedWidth + 'px';
	}

	// -- Restore persisted active tab --------------------------------
	var savedTab = FontRig.Sidebar._loadPref(id + '-tab', options.defaultTab);
	if (savedTab && sidebar.panelEls[savedTab]) {
		FontRig.Sidebar.switchTab(sidebar, savedTab);
	} else if (sidebar.tabs.length > 0) {
		FontRig.Sidebar.switchTab(sidebar, sidebar.tabs[0].id);
	}

	// -- Wire resize ------------------------------------------------
	FontRig.Sidebar._wireResize(sidebar);

	// -- Register ---------------------------------------------------
	FontRig.Sidebar._instances[id] = sidebar;

	return sidebar;
};

// ===================================================================
// Build DOM structure
// ===================================================================
FontRig.Sidebar._buildDOM = function(sidebar) {
	var container = sidebar.container;

	// -- Sidebar root element ----------------------------------------
	var el = document.createElement('div');
	el.className = 'fr-sidebar fr-sidebar--' + sidebar.position;
	el.id = sidebar.id;
	el.style.width = (typeof sidebar.defaultWidth === 'number')
		? sidebar.defaultWidth + 'px'
		: sidebar.defaultWidth;

	// -- Vertical tab bar --------------------------------------------
	var tabBar = document.createElement('div');
	tabBar.className = 'fr-sidebar__tabs';

	for (var i = 0; i < sidebar.tabs.length; i++) {
		var tabDef = sidebar.tabs[i];
		var tabBtn = document.createElement('button');
		tabBtn.className = 'fr-sidebar__tab';
		tabBtn.dataset.tab = tabDef.id;
		tabBtn.title = tabDef.label || tabDef.id;

		if (tabDef.icon) {
			var iconSpan = document.createElement('span');
			iconSpan.className = 'tri';
			iconSpan.textContent = tabDef.icon;
			tabBtn.appendChild(iconSpan);
		}

		var labelSpan = document.createElement('span');
		labelSpan.className = 'fr-sidebar__tab-label';
		labelSpan.textContent = tabDef.label || tabDef.id;
		tabBtn.appendChild(labelSpan);

		tabBar.appendChild(tabBtn);
	}

	// -- Content area ------------------------------------------------
	var contentArea = document.createElement('div');
	contentArea.className = 'fr-sidebar__content';

	// Create panel divs for each tab
	for (var i = 0; i < sidebar.tabs.length; i++) {
		var tabDef = sidebar.tabs[i];
		var panel = document.createElement('div');
		panel.className = 'fr-sidebar__panel';
		panel.id = sidebar.id + '-panel-' + tabDef.id;
		panel.dataset.panel = tabDef.id;

		contentArea.appendChild(panel);
		sidebar.panelEls[tabDef.id] = panel;
	}

	// -- Resize handle -----------------------------------------------
	var handle = document.createElement('div');
	handle.className = 'fr-sidebar__handle';

	// -- Assemble based on position ----------------------------------
	// Tabs are placed on the INSIDE edge (closest to the canvas):
	//   Left sidebar:  [content][tabBar]  (tabs on right/inner edge)
	//   Right sidebar: [tabBar][content]  (tabs on left/inner edge)
	if (sidebar.position === 'left') {
		el.appendChild(contentArea);
		el.appendChild(tabBar);
	} else {
		el.appendChild(tabBar);
		el.appendChild(contentArea);
	}

	// -- Insert into container in correct order ----------------------
	// The handle is a sibling of the sidebar, placed between
	// the sidebar and the canvas-wrap.
	if (sidebar.position === 'left') {
		// Insert before canvas-wrap
		var canvasWrap = container.querySelector('#canvas-wrap');
		if (canvasWrap) {
			container.insertBefore(el, canvasWrap);
			container.insertBefore(handle, canvasWrap);
		} else {
			container.prepend(handle);
			container.prepend(el);
		}
	} else {
		// Insert after canvas-wrap (handle first, then sidebar)
		container.appendChild(handle);
		container.appendChild(el);
	}

	// Store refs
	sidebar.el = el;
	sidebar.handleEl = handle;
	sidebar.tabBarEl = tabBar;
	sidebar.contentEl = contentArea;

	// -- Wire tab clicks ---------------------------------------------
	tabBar.addEventListener('click', function(e) {
		var tabBtn = e.target.closest('.fr-sidebar__tab');
		if (!tabBtn) return;
		var tabId = tabBtn.dataset.tab;

		// Click on already-active tab → toggle sidebar visibility
		if (tabId === sidebar.activeTab && sidebar.visible) {
			FontRig.Sidebar.hide(sidebar);
		} else {
			FontRig.Sidebar.switchTab(sidebar, tabId);
			if (!sidebar.visible) {
				FontRig.Sidebar.show(sidebar);
			}
		}
	});
};

// ===================================================================
// Resize logic
// ===================================================================
FontRig.Sidebar._wireResize = function(sidebar) {
	var isDragging = false;

	sidebar.handleEl.addEventListener('mousedown', function(e) {
		e.preventDefault();
		isDragging = true;
		sidebar.handleEl.classList.add('dragging');
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
	});

	window.addEventListener('mousemove', function(e) {
		if (!isDragging) return;

		var containerRect = sidebar.container.getBoundingClientRect();
		var mouseX = e.clientX - containerRect.left;
		var totalWidth;

		if (sidebar.position === 'left') {
			// Mouse position is the desired total sidebar width
			totalWidth = mouseX;
		} else {
			// Total width = distance from mouse to right edge
			totalWidth = containerRect.width - mouseX;
		}

		totalWidth = Math.max(sidebar.minWidth, Math.min(sidebar.maxWidth, totalWidth));
		sidebar.el.style.width = totalWidth + 'px';

		// Persist width
		FontRig.Sidebar._savePref(sidebar.id + '-width', totalWidth);

		if (sidebar.onResize) sidebar.onResize();
		if (typeof FontRig.draw === 'function') FontRig.draw();
	});

	window.addEventListener('mouseup', function() {
		if (isDragging) {
			isDragging = false;
			sidebar.handleEl.classList.remove('dragging');
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
			if (sidebar.onResize) sidebar.onResize();
			if (typeof FontRig.draw === 'function') FontRig.draw();
		}
	});
};

// ===================================================================
// Tab switching
// ===================================================================
FontRig.Sidebar.switchTab = function(sidebar, tabId) {
	if (!sidebar.panelEls[tabId]) return;

	var prevTab = sidebar.activeTab;
	sidebar.activeTab = tabId;

	// Update tab buttons
	var tabs = sidebar.tabBarEl.querySelectorAll('.fr-sidebar__tab');
	for (var i = 0; i < tabs.length; i++) {
		tabs[i].classList.toggle('active', tabs[i].dataset.tab === tabId);
	}

	// Update panels
	for (var key in sidebar.panelEls) {
		sidebar.panelEls[key].classList.toggle('active', key === tabId);
	}

	// Persist
	FontRig.Sidebar._savePref(sidebar.id + '-tab', tabId);

	// Callback
	if (sidebar.onTabSwitch) sidebar.onTabSwitch(tabId, prevTab);
};

// ===================================================================
// Show / Hide
// ===================================================================
FontRig.Sidebar.show = function(sidebar) {
	sidebar.visible = true;
	sidebar.el.classList.add('visible');
	sidebar.handleEl.classList.add('visible');

	if (sidebar.onToggle) sidebar.onToggle(true);
	if (typeof FontRig.draw === 'function') {
		requestAnimationFrame(function() { FontRig.draw(); });
	}
};

FontRig.Sidebar.hide = function(sidebar) {
	sidebar.visible = false;
	sidebar.el.classList.remove('visible');
	sidebar.handleEl.classList.remove('visible');

	if (sidebar.onToggle) sidebar.onToggle(false);
	if (typeof FontRig.draw === 'function') {
		requestAnimationFrame(function() { FontRig.draw(); });
	}
};

FontRig.Sidebar.toggle = function(sidebar) {
	if (sidebar.visible) {
		FontRig.Sidebar.hide(sidebar);
	} else {
		FontRig.Sidebar.show(sidebar);
	}
};

// ===================================================================
// Get panel element for a tab (for inserting content)
// ===================================================================
FontRig.Sidebar.getPanel = function(sidebar, tabId) {
	return sidebar.panelEls[tabId] || null;
};

// ===================================================================
// Get sidebar by id
// ===================================================================
FontRig.Sidebar.get = function(id) {
	return FontRig.Sidebar._instances[id] || null;
};

})();
