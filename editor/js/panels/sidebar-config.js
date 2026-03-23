// ===================================================================
// FontRig — Sidebar Configuration
// ===================================================================
// Central registry of all sidebar-compatible widgets and default
// configurations for left and right sidebars.
//
// Each widget entry declares:
//   id       — unique string identifier (matches tab id)
//   label    — human-readable name
//   icon     — TypeRig Icons ligature name
//   mount    — function(containerEl, ctx) → instance object
//   update   — optional function(instance) called on tab switch
//   unmount  — optional function(instance) for cleanup
//
// Widgets support "cloning": the same widget type can be mounted in
// multiple sidebars simultaneously. Each mount returns a separate
// instance object. Bridge functions iterate all instances.
//
// Designed for future multi-window workplanes: each workplane
// can host N configurable sidebars, each driven by its own config.
// ===================================================================
'use strict';

(function() {

if (typeof FontRig === 'undefined') return;

// -- Widget Registry ------------------------------------------------
FontRig.SidebarConfig = {};

FontRig.SidebarConfig._widgets = {};

// -- Instance Registry ----------------------------------------------
// Maps: widgetId → [{ sidebarId, instance }]
// Each widget type keeps a list of all active mounted instances.
FontRig.SidebarConfig._instances = {};

// Register a sidebar widget
FontRig.SidebarConfig.registerWidget = function(def) {
	if (!def || !def.id) return;
	FontRig.SidebarConfig._widgets[def.id] = {
		id:      def.id,
		label:   def.label || def.id,
		icon:    def.icon || '',
		mount:   def.mount || function() { return {}; },
		update:  def.update || null,
		unmount: def.unmount || null,
	};
	// Init instance list
	if (!FontRig.SidebarConfig._instances[def.id]) {
		FontRig.SidebarConfig._instances[def.id] = [];
	}
};

// Get a registered widget definition
FontRig.SidebarConfig.getWidget = function(id) {
	return FontRig.SidebarConfig._widgets[id] || null;
};

// Get all registered widget ids in registration order
FontRig.SidebarConfig.getAllWidgetIds = function() {
	return Object.keys(FontRig.SidebarConfig._widgets);
};

// Get all registered widget definitions
FontRig.SidebarConfig.getAllWidgets = function() {
	var ids = FontRig.SidebarConfig.getAllWidgetIds();
	var result = [];
	for (var i = 0; i < ids.length; i++) {
		result.push(FontRig.SidebarConfig._widgets[ids[i]]);
	}
	return result;
};

// ===================================================================
// Instance management
// ===================================================================

// Register a mounted widget instance
FontRig.SidebarConfig.addInstance = function(widgetId, sidebarId, instance) {
	if (!FontRig.SidebarConfig._instances[widgetId]) {
		FontRig.SidebarConfig._instances[widgetId] = [];
	}
	FontRig.SidebarConfig._instances[widgetId].push({
		sidebarId: sidebarId,
		instance: instance,
	});
};

// Remove a mounted widget instance
FontRig.SidebarConfig.removeInstance = function(widgetId, sidebarId) {
	var list = FontRig.SidebarConfig._instances[widgetId];
	if (!list) return null;
	for (var i = list.length - 1; i >= 0; i--) {
		if (list[i].sidebarId === sidebarId) {
			var removed = list.splice(i, 1)[0];
			return removed.instance;
		}
	}
	return null;
};

// Get all instances of a widget type
FontRig.SidebarConfig.getInstances = function(widgetId) {
	var list = FontRig.SidebarConfig._instances[widgetId] || [];
	var result = [];
	for (var i = 0; i < list.length; i++) {
		result.push(list[i].instance);
	}
	return result;
};

// Get a specific instance by sidebar id
FontRig.SidebarConfig.getInstance = function(widgetId, sidebarId) {
	var list = FontRig.SidebarConfig._instances[widgetId] || [];
	for (var i = 0; i < list.length; i++) {
		if (list[i].sidebarId === sidebarId) {
			return list[i].instance;
		}
	}
	return null;
};

// Call a method on all instances of a widget type
FontRig.SidebarConfig.forEachInstance = function(widgetId, fn) {
	var list = FontRig.SidebarConfig._instances[widgetId] || [];
	for (var i = 0; i < list.length; i++) {
		fn(list[i].instance, list[i].sidebarId);
	}
};

// ===================================================================
// Default Sidebar Configurations
// ===================================================================
FontRig.SidebarConfig.defaults = {
	'left-sidebar': {
		id:           'left-sidebar',
		position:     'left',
		tabPosition:  'right',
		defaultWidth: null,
		minWidth:     120,
		maxWidth:     500,
		widgets: [
			{ id: 'glyphs',    active: true },
			{ id: 'font-info', active: true },
		],
		defaultTab: 'glyphs',
	},

	'right-sidebar': {
		id:           'right-sidebar',
		position:     'right',
		tabPosition:  'left',
		defaultWidth: null,
		minWidth:     200,
		maxWidth:     800,
		widgets: [
			{ id: 'node',       active: true },
			{ id: 'xml',        active: true },
			{ id: 'python',     active: true },
			{ id: 'ai-agent',   active: false },
			{ id: 'help',       active: true },
		],
		defaultTab: 'xml',
	}
};

// ===================================================================
// Get config for a sidebar (from localStorage or default)
// ===================================================================
FontRig.SidebarConfig.getConfig = function(sidebarId) {
	var def = FontRig.SidebarConfig.defaults[sidebarId];
	if (!def) return null;

	var saved = null;
	try {
		var raw = localStorage.getItem('fr-sidebar-config-' + sidebarId);
		if (raw) saved = JSON.parse(raw);
	} catch (e) { /* silent */ }

	if (saved && saved.widgets && saved.widgets.length > 0) {
		var savedMap = {};
		for (var i = 0; i < saved.widgets.length; i++) {
			savedMap[saved.widgets[i].id] = saved.widgets[i].active;
		}

		var merged = [];
		for (var i = 0; i < def.widgets.length; i++) {
			var w = def.widgets[i];
			var isActive = savedMap[w.id] !== undefined ? savedMap[w.id] : w.active;
			merged.push({ id: w.id, active: isActive });
		}

		for (var i = 0; i < saved.widgets.length; i++) {
			var sw = saved.widgets[i];
			var found = false;
			for (var j = 0; j < merged.length; j++) {
				if (merged[j].id === sw.id) { found = true; break; }
			}
			if (!found && FontRig.SidebarConfig._widgets[sw.id]) {
				merged.push({ id: sw.id, active: sw.active });
			}
		}

		return {
			id:           def.id,
			position:     def.position,
			tabPosition:  saved.tabPosition || def.tabPosition,
			defaultWidth: def.defaultWidth,
			minWidth:     def.minWidth,
			maxWidth:     def.maxWidth,
			widgets:      merged,
			defaultTab:   saved.defaultTab || def.defaultTab,
		};
	}

	return {
		id:           def.id,
		position:     def.position,
		tabPosition:  def.tabPosition,
		defaultWidth: def.defaultWidth,
		minWidth:     def.minWidth,
		maxWidth:     def.maxWidth,
		widgets:      def.widgets.slice(),
		defaultTab:   def.defaultTab,
	};
};

// ===================================================================
// Save / Export / Import (unchanged)
// ===================================================================
FontRig.SidebarConfig.saveConfig = function(sidebarId, config) {
	try {
		localStorage.setItem('fr-sidebar-config-' + sidebarId, JSON.stringify({
			widgets:     config.widgets,
			tabPosition: config.tabPosition,
			defaultTab:  config.defaultTab,
		}));
	} catch (e) { /* silent */ }
};

FontRig.SidebarConfig.exportToFile = function(sidebarId) {
	var config = FontRig.SidebarConfig.getConfig(sidebarId);
	if (!config) return;

	var data = JSON.stringify({
		_type: 'fontrig-sidebar-config',
		_version: 1,
		sidebarId: sidebarId,
		tabPosition: config.tabPosition,
		widgets: config.widgets,
		defaultTab: config.defaultTab,
	}, null, 2);

	var blob = new Blob([data], { type: 'application/json' });
	var url = URL.createObjectURL(blob);
	var a = document.createElement('a');
	a.href = url;
	a.download = 'sidebar-' + sidebarId + '.json';
	a.click();
	URL.revokeObjectURL(url);
};

FontRig.SidebarConfig.importFromFile = function(sidebarId, callback) {
	var input = document.createElement('input');
	input.type = 'file';
	input.accept = '.json';
	input.style.display = 'none';

	input.addEventListener('change', function() {
		if (!input.files || !input.files[0]) return;

		var reader = new FileReader();
		reader.onload = function(e) {
			try {
				var data = JSON.parse(e.target.result);
				if (data._type !== 'fontrig-sidebar-config') {
					console.warn('Invalid sidebar config file');
					return;
				}

				var config = FontRig.SidebarConfig.getConfig(sidebarId);
				if (!config) return;

				if (data.widgets) {
					var importMap = {};
					for (var i = 0; i < data.widgets.length; i++) {
						importMap[data.widgets[i].id] = data.widgets[i].active;
					}
					for (var i = 0; i < config.widgets.length; i++) {
						if (importMap[config.widgets[i].id] !== undefined) {
							config.widgets[i].active = importMap[config.widgets[i].id];
						}
					}
				}

				if (data.tabPosition) config.tabPosition = data.tabPosition;
				if (data.defaultTab) config.defaultTab = data.defaultTab;

				FontRig.SidebarConfig.saveConfig(sidebarId, config);

				if (callback) callback(config);
			} catch (err) {
				console.warn('Failed to parse sidebar config:', err);
			}
		};
		reader.readAsText(input.files[0]);
		document.body.removeChild(input);
	});

	document.body.appendChild(input);
	input.click();
};

// ===================================================================
// Build tabs array from config (for Sidebar.create)
// ===================================================================
FontRig.SidebarConfig.buildTabs = function(config) {
	var tabs = [];
	if (!config || !config.widgets) return tabs;

	for (var i = 0; i < config.widgets.length; i++) {
		var entry = config.widgets[i];
		if (!entry.active) continue;

		var widget = FontRig.SidebarConfig.getWidget(entry.id);
		if (!widget) continue;

		tabs.push({
			id:    widget.id,
			label: widget.label,
			icon:  widget.icon,
		});
	}

	return tabs;
};

})();
