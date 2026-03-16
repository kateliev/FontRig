// ===================================================================
// FontRig — Sidebar Framework
// ===================================================================
// Reusable, configurable, resizable sidebar with vertical tabs.
// Supports left and right positioning, drag-to-resize, collapse/expand,
// localStorage persistence, and a built-in config tab for toggling
// which widgets are active.
//
// Usage:
//   FontRig.Sidebar.create({ id, position, ... });
//   FontRig.Sidebar.createFromConfig(sidebarId);
//
// Each sidebar instance manages its own DOM, resize handle, tabs,
// config state, and persistence independently.
//
// Designed for future multi-window workplanes: each workplane can
// host N configurable sidebars, each driven by its own config.
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
// Sidebar.createFromConfig — Build a sidebar from SidebarConfig
// ===================================================================
// Creates a sidebar using the config system. The config tab is
// automatically prepended.
//
// sidebarId  : config key (e.g. 'left-sidebar')
// options    : override options { container, onResize, onTabSwitch,
//              onToggle, callbacks }
// ===================================================================
FontRig.Sidebar.createFromConfig = function(sidebarId, options) {
	options = options || {};

	var SBC = FontRig.SidebarConfig;
	if (!SBC) {
		console.warn('SidebarConfig not loaded');
		return null;
	}

	var config = SBC.getConfig(sidebarId);
	if (!config) {
		console.warn('No config for sidebar:', sidebarId);
		return null;
	}

	// Build tabs from active widgets
	var widgetTabs = SBC.buildTabs(config);

	var sidebar = FontRig.Sidebar.create({
		id:           config.id,
		position:     config.position,
		tabPosition:  config.tabPosition,
		defaultWidth: options.defaultWidth || config.defaultWidth,
		minWidth:     config.minWidth,
		maxWidth:     config.maxWidth,
		tabs:         widgetTabs,
		defaultTab:   config.defaultTab,
		container:    options.container || null,
		onResize:     options.onResize || null,
		onTabSwitch:  options.onTabSwitch || null,
		onToggle:     options.onToggle || null,
		configurable: true,
		callbacks:    options.callbacks || {},
	});

	// Store config reference
	sidebar._config = config;

	// Mount widgets into their panels and register instances
	sidebar._widgetInstances = {};
	for (var i = 0; i < widgetTabs.length; i++) {
		var tabDef = widgetTabs[i];
		var widget = SBC.getWidget(tabDef.id);
		if (widget && widget.mount) {
			var panel = FontRig.Sidebar.getPanel(sidebar, tabDef.id);
			if (panel) {
				var instance = widget.mount(panel, { sidebarId: sidebar.id }) || {};
				sidebar._widgetInstances[tabDef.id] = instance;
				SBC.addInstance(tabDef.id, sidebar.id, instance);
			}
		}
	}

	// Build the config tab content
	FontRig.Sidebar._buildConfigPanel(sidebar);

	return sidebar;
};

// ===================================================================
// Sidebar.create — Build a sidebar instance
// ===================================================================
// Options:
//   id           : unique string identifier (e.g. 'left-sidebar')
//   position     : 'left' | 'right'
//   tabPosition  : 'left' | 'right' (overrides inner-edge default)
//   defaultWidth : number (px) or string like '40%'
//   minWidth     : number (px), default 150
//   maxWidth     : number (px), default 600
//   tabs         : [{ id, label, icon }] — ordered tab definitions
//   defaultTab   : tab id to activate on creation
//   container    : parent DOM element (defaults to #main)
//   configurable : bool — if true, prepend a config tab
//   onResize     : function() — called during/after resize
//   onTabSwitch  : function(tabId, prevTabId) — called on tab change
//   onToggle     : function(visible) — called on show/hide
//   callbacks    : { widgetId: { onTabSwitch: fn, ... } } per-widget
// ===================================================================
FontRig.Sidebar.create = function(options) {
	var id = options.id;
	if (FontRig.Sidebar._instances[id]) {
		return FontRig.Sidebar._instances[id];
	}

	// Determine tab bar placement
	var tabPosition = options.tabPosition || null;
	if (!tabPosition) {
		// Default: inner edge
		tabPosition = (options.position === 'left') ? 'right' : 'left';
	}

	var sidebar = {
		id:           id,
		position:     options.position || 'left',
		tabPosition:  tabPosition,
		defaultWidth: options.defaultWidth || 220,
		minWidth:     options.minWidth || 150,
		maxWidth:     options.maxWidth || 600,
		tabs:         [],      // built below
		activeTab:    null,
		visible:      false,
		el:           null,    // sidebar container element
		handleEl:     null,    // resize handle element
		tabBarEl:     null,    // vertical tab bar
		contentEl:    null,    // content area (holds tab panels)
		panelEls:     {},      // tab id -> panel element
		container:    options.container || FontRig.dom.main,
		configurable: !!options.configurable,
		onResize:     options.onResize || null,
		onTabSwitch:  options.onTabSwitch || null,
		onToggle:     options.onToggle || null,
		callbacks:    options.callbacks || {},
		_config:      null,    // set by createFromConfig
	};

	// Build final tab list: config tab first (if configurable), then widget tabs
	var allTabs = [];

	if (sidebar.configurable) {
		allTabs.push({
			id:    '_config',
			label: 'Config',
			icon:  'view_list',
			isConfig: true,
		});
	}

	var userTabs = options.tabs || [];
	for (var i = 0; i < userTabs.length; i++) {
		allTabs.push(userTabs[i]);
	}

	sidebar.tabs = allTabs;

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
		// Skip config tab for initial display if a real tab exists
		var firstTab = sidebar.tabs.length > 1 && sidebar.configurable
			? sidebar.tabs[1].id
			: sidebar.tabs[0].id;
		FontRig.Sidebar.switchTab(sidebar, options.defaultTab || firstTab);
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
		if (tabDef.isConfig) tabBtn.classList.add('fr-sidebar__tab--config');
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

		// Add header
		var header = document.createElement('div');
		header.className = 'fr-sidebar__panel-header';

		var title = document.createElement('span');
		title.className = 'fr-sidebar__panel-title';
		title.textContent = tabDef.label || tabDef.id;
		header.appendChild(title);

		panel.appendChild(header);

		var content = document.createElement('div');
		content.className = 'fr-sidebar__panel-content';
		panel.appendChild(content);

		contentArea.appendChild(panel);
		sidebar.panelEls[tabDef.id] = panel;
	}

	// -- Resize handle -----------------------------------------------
	var handle = document.createElement('div');
	handle.className = 'fr-sidebar__handle';

	// -- Assemble based on tab position ------------------------------
	// tabPosition determines which side the tab bar sits on.
	if (sidebar.tabPosition === 'left') {
		el.appendChild(tabBar);
		el.appendChild(contentArea);
	} else {
		el.appendChild(contentArea);
		el.appendChild(tabBar);
	}

	// -- Insert into container in correct order ----------------------
	if (sidebar.position === 'left') {
		var canvasWrap = container.querySelector('#canvas-wrap');
		if (canvasWrap) {
			container.insertBefore(el, canvasWrap);
			container.insertBefore(handle, canvasWrap);
		} else {
			container.prepend(handle);
			container.prepend(el);
		}
	} else {
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

		// Click on already-active tab -> toggle sidebar visibility
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
		var handleW = sidebar.handleEl.offsetWidth || 5;
		var totalWidth;

		if (sidebar.position === 'left') {
			totalWidth = mouseX - handleW / 2;
		} else {
			totalWidth = containerRect.width - mouseX - handleW / 2;
		}

		totalWidth = Math.max(sidebar.minWidth, Math.min(sidebar.maxWidth, totalWidth));
		sidebar.el.style.width = totalWidth + 'px';

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

	// Widget-specific update callback (with instance context)
	if (tabId !== '_config' && FontRig.SidebarConfig) {
		var widget = FontRig.SidebarConfig.getWidget(tabId);
		if (widget && widget.update) {
			var inst = sidebar._widgetInstances ? sidebar._widgetInstances[tabId] : null;
			widget.update(inst);
		}
	}

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
	// Only redraw if sidebar is in the main window (has the canvas)
	if (typeof FontRig.draw === 'function' && sidebar.container === FontRig.dom.main) {
		requestAnimationFrame(function() { FontRig.draw(); });
	}
};

FontRig.Sidebar.hide = function(sidebar) {
	sidebar.visible = false;
	sidebar.el.classList.remove('visible');
	sidebar.handleEl.classList.remove('visible');

	if (sidebar.onToggle) sidebar.onToggle(false);
	if (typeof FontRig.draw === 'function' && sidebar.container === FontRig.dom.main) {
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
	var panel = sidebar.panelEls[tabId] || null;
	if (panel) {
		return panel.querySelector('.fr-sidebar__panel-content');
	}
	return null;
};

// ===================================================================
// Get panel wrapper (includes header) for a tab
// ===================================================================
FontRig.Sidebar.getPanelWrapper = function(sidebar, tabId) {
	return sidebar.panelEls[tabId] || null;
};

// ===================================================================
// Get sidebar by id
// ===================================================================
FontRig.Sidebar.get = function(id) {
	return FontRig.Sidebar._instances[id] || null;
};

// ===================================================================
// Rebuild sidebar from updated config (apply config changes)
// ===================================================================
FontRig.Sidebar.applyConfig = function(sidebar, config) {
	if (!sidebar || !config) return;

	var SBC = FontRig.SidebarConfig;
	if (!SBC) return;

	// Save the new config
	SBC.saveConfig(sidebar.id, config);
	sidebar._config = config;

	// Get active widget tabs
	var widgetTabs = SBC.buildTabs(config);

	// Determine which tabs currently exist and which are needed
	var currentTabIds = {};
	for (var i = 0; i < sidebar.tabs.length; i++) {
		currentTabIds[sidebar.tabs[i].id] = true;
	}

	var neededTabIds = { '_config': true };
	for (var i = 0; i < widgetTabs.length; i++) {
		neededTabIds[widgetTabs[i].id] = true;
	}

	// Ensure instance map exists
	if (!sidebar._widgetInstances) sidebar._widgetInstances = {};

	// Remove tabs that are no longer active
	for (var i = sidebar.tabs.length - 1; i >= 0; i--) {
		var tid = sidebar.tabs[i].id;
		if (!neededTabIds[tid]) {
			// Unmount widget and remove instance
			var widget = SBC.getWidget(tid);
			var oldInst = SBC.removeInstance(tid, sidebar.id);
			if (widget && widget.unmount && oldInst) widget.unmount(oldInst);
			delete sidebar._widgetInstances[tid];

			// Remove tab button
			var btn = sidebar.tabBarEl.querySelector('[data-tab="' + tid + '"]');
			if (btn) btn.remove();

			// Remove panel
			var panel = sidebar.panelEls[tid];
			if (panel) panel.remove();
			delete sidebar.panelEls[tid];

			sidebar.tabs.splice(i, 1);
		}
	}

	// Add new tabs that don't exist yet
	for (var i = 0; i < widgetTabs.length; i++) {
		var tabDef = widgetTabs[i];
		if (currentTabIds[tabDef.id]) continue;

		// Add to sidebar.tabs
		sidebar.tabs.push(tabDef);

		// Create tab button
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

		sidebar.tabBarEl.appendChild(tabBtn);

		// Create panel
		var panel = document.createElement('div');
		panel.className = 'fr-sidebar__panel';
		panel.id = sidebar.id + '-panel-' + tabDef.id;
		panel.dataset.panel = tabDef.id;

		var header = document.createElement('div');
		header.className = 'fr-sidebar__panel-header';
		var title = document.createElement('span');
		title.className = 'fr-sidebar__panel-title';
		title.textContent = tabDef.label || tabDef.id;
		header.appendChild(title);
		panel.appendChild(header);

		var content = document.createElement('div');
		content.className = 'fr-sidebar__panel-content';
		panel.appendChild(content);

		sidebar.contentEl.appendChild(panel);
		sidebar.panelEls[tabDef.id] = panel;

		// Mount widget and register instance
		var widget = SBC.getWidget(tabDef.id);
		if (widget && widget.mount) {
			var instance = widget.mount(content, { sidebarId: sidebar.id }) || {};
			sidebar._widgetInstances[tabDef.id] = instance;
			SBC.addInstance(tabDef.id, sidebar.id, instance);
		}
	}

	// Switch to first available widget tab if current tab was removed
	if (!sidebar.panelEls[sidebar.activeTab]) {
		var firstWidget = widgetTabs.length > 0 ? widgetTabs[0].id : '_config';
		FontRig.Sidebar.switchTab(sidebar, firstWidget);
	}

	// Update the config panel checklist
	FontRig.Sidebar._updateConfigChecklist(sidebar);
};

// ===================================================================
// Build the config panel content
// ===================================================================
FontRig.Sidebar._buildConfigPanel = function(sidebar) {
	var configPanel = FontRig.Sidebar.getPanel(sidebar, '_config');
	if (!configPanel) return;

	configPanel.innerHTML = '';
	configPanel.className += ' fr-sidebar__config-panel';

	var SBC = FontRig.SidebarConfig;
	if (!SBC) return;

	var config = sidebar._config || SBC.getConfig(sidebar.id);
	if (!config) return;

	// -- Widget checklist -------------------------------------------
	var listWrap = document.createElement('div');
	listWrap.className = 'fr-config__list';

	var allWidgets = SBC.getAllWidgets();

	for (var i = 0; i < allWidgets.length; i++) {
		var w = allWidgets[i];
		var isActive = false;

		// Check if this widget is active in the config
		for (var j = 0; j < config.widgets.length; j++) {
			if (config.widgets[j].id === w.id) {
				isActive = config.widgets[j].active;
				break;
			}
		}

		var row = document.createElement('label');
		row.className = 'fr-config__item';
		row.dataset.widgetId = w.id;

		var cb = document.createElement('input');
		cb.type = 'checkbox';
		cb.className = 'fr-config__checkbox';
		cb.checked = isActive;
		cb.dataset.widgetId = w.id;
		row.appendChild(cb);

		if (w.icon) {
			var icon = document.createElement('span');
			icon.className = 'tri fr-config__icon';
			icon.textContent = w.icon;
			row.appendChild(icon);
		}

		var label = document.createElement('span');
		label.className = 'fr-config__label';
		label.textContent = w.label;
		row.appendChild(label);

		listWrap.appendChild(row);
	}

	configPanel.appendChild(listWrap);

	// -- Action buttons (bottom bar) --------------------------------
	var actions = document.createElement('div');
	actions.className = 'fr-config__actions';

	// Apply selection
	var btnApply = document.createElement('button');
	btnApply.className = 'fr-config__btn';
	btnApply.title = 'Apply selection';
	btnApply.innerHTML = '<span class="tri">check</span>';
	btnApply.addEventListener('click', function() {
		FontRig.Sidebar._applyConfigFromUI(sidebar);
	});
	actions.appendChild(btnApply);

	// Select all
	var btnSelectAll = document.createElement('button');
	btnSelectAll.className = 'fr-config__btn';
	btnSelectAll.title = 'Select all';
	btnSelectAll.innerHTML = '<span class="tri">select_all</span>';
	btnSelectAll.addEventListener('click', function() {
		var cbs = listWrap.querySelectorAll('.fr-config__checkbox');
		for (var i = 0; i < cbs.length; i++) cbs[i].checked = true;
	});
	actions.appendChild(btnSelectAll);

	// Deselect all
	var btnDeselectAll = document.createElement('button');
	btnDeselectAll.className = 'fr-config__btn';
	btnDeselectAll.title = 'Deselect all';
	btnDeselectAll.innerHTML = '<span class="tri">select_option</span>';
	btnDeselectAll.addEventListener('click', function() {
		var cbs = listWrap.querySelectorAll('.fr-config__checkbox');
		for (var i = 0; i < cbs.length; i++) cbs[i].checked = false;
	});
	actions.appendChild(btnDeselectAll);

	// Save to file
	var btnSave = document.createElement('button');
	btnSave.className = 'fr-config__btn';
	btnSave.title = 'Save configuration to file';
	btnSave.innerHTML = '<span class="tri">file_save</span>';
	btnSave.addEventListener('click', function() {
		// Apply first, then export
		FontRig.Sidebar._applyConfigFromUI(sidebar);
		FontRig.SidebarConfig.exportToFile(sidebar.id);
	});
	actions.appendChild(btnSave);

	// Load from file
	var btnLoad = document.createElement('button');
	btnLoad.className = 'fr-config__btn';
	btnLoad.title = 'Load configuration from file';
	btnLoad.innerHTML = '<span class="tri">file_open</span>';
	btnLoad.addEventListener('click', function() {
		FontRig.SidebarConfig.importFromFile(sidebar.id, function(newConfig) {
			FontRig.Sidebar.applyConfig(sidebar, newConfig);
		});
	});
	actions.appendChild(btnLoad);

	// Refresh
	var btnRefresh = document.createElement('button');
	btnRefresh.className = 'fr-config__btn';
	btnRefresh.title = 'Refresh / reset to defaults';
	btnRefresh.innerHTML = '<span class="tri">refresh</span>';
	btnRefresh.addEventListener('click', function() {
		// Reset to default config
		var def = FontRig.SidebarConfig.defaults[sidebar.id];
		if (def) {
			var resetConfig = {
				id:           def.id,
				position:     def.position,
				tabPosition:  def.tabPosition,
				defaultWidth: def.defaultWidth,
				minWidth:     def.minWidth,
				maxWidth:     def.maxWidth,
				widgets:      def.widgets.slice(),
				defaultTab:   def.defaultTab,
			};
			FontRig.Sidebar.applyConfig(sidebar, resetConfig);
		}
	});
	actions.appendChild(btnRefresh);

	configPanel.appendChild(actions);
};

// ===================================================================
// Apply config changes from the UI checkboxes
// ===================================================================
FontRig.Sidebar._applyConfigFromUI = function(sidebar) {
	var configPanel = FontRig.Sidebar.getPanel(sidebar, '_config');
	if (!configPanel) return;

	var SBC = FontRig.SidebarConfig;
	var config = sidebar._config || SBC.getConfig(sidebar.id);
	if (!config) return;

	var cbs = configPanel.querySelectorAll('.fr-config__checkbox');
	var newWidgets = [];

	for (var i = 0; i < cbs.length; i++) {
		newWidgets.push({
			id: cbs[i].dataset.widgetId,
			active: cbs[i].checked,
		});
	}

	config.widgets = newWidgets;
	FontRig.Sidebar.applyConfig(sidebar, config);

	// Switch to first active widget tab after applying
	var widgetTabs = SBC.buildTabs(config);
	if (widgetTabs.length > 0) {
		FontRig.Sidebar.switchTab(sidebar, widgetTabs[0].id);
	}
};

// ===================================================================
// Update the config checklist to match current config state
// ===================================================================
FontRig.Sidebar._updateConfigChecklist = function(sidebar) {
	var configPanel = FontRig.Sidebar.getPanel(sidebar, '_config');
	if (!configPanel) return;

	var config = sidebar._config;
	if (!config) return;

	var activeMap = {};
	for (var i = 0; i < config.widgets.length; i++) {
		activeMap[config.widgets[i].id] = config.widgets[i].active;
	}

	var cbs = configPanel.querySelectorAll('.fr-config__checkbox');
	for (var i = 0; i < cbs.length; i++) {
		var wid = cbs[i].dataset.widgetId;
		cbs[i].checked = !!activeMap[wid];
	}
};

})();
