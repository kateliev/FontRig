// ===================================================================
// FontRig — Workplane Manager (Main Window Side)
// ===================================================================
// Manages workplane popup windows. Each workplane is an independent
// window that hosts configurable sidebar panels. Communication
// happens via BroadcastChannel.
//
// The workplane window (panels/workplane.html) accesses the main
// window's FontRig object via window.opener, so widgets mounted
// in workplane sidebars use the same shared state (font data,
// glyph cache, renderer cache) and instance registry.
//
// Usage:
//   FontRig.Workplane.open();       // open a new workplane
//   FontRig.Workplane.broadcast();  // notify all workplanes
// ===================================================================
'use strict';

(function() {

if (typeof FontRig === 'undefined') return;

FontRig.Workplane = {};

// -- Registry of open workplanes ------------------------------------
var _workplanes = {};  // id → { id, window, channel }
var _counter = 0;

// ===================================================================
// Open a new workplane window
// ===================================================================
FontRig.Workplane.open = function() {
	_counter++;
	var id = 'wp-' + _counter;

	var w = 800;
	var h = window.innerHeight;
	var left = window.screenX + window.innerWidth + 10;
	var top = window.screenY;

	var popup = window.open(
		'panels/workplane.html?id=' + id,
		'trv-workplane-' + id,
		'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top +
		',menubar=no,toolbar=no,status=no,resizable=yes'
	);

	if (!popup) {
		console.warn('Popup blocked. Allow popups for this site.');
		return null;
	}

	// Set up BroadcastChannel
	var channelName = 'trv-workplane-' + id;
	var channel = null;

	try {
		channel = new BroadcastChannel(channelName);
		channel.onmessage = function(e) {
			FontRig.Workplane._onMessage(id, e.data);
		};
	} catch (e) {
		// BroadcastChannel not available
	}

	var entry = {
		id: id,
		window: popup,
		channel: channel,
	};

	_workplanes[id] = entry;

	return entry;
};

// ===================================================================
// Close a workplane
// ===================================================================
FontRig.Workplane.close = function(id) {
	var entry = _workplanes[id];
	if (!entry) return;

	if (entry.window && !entry.window.closed) {
		entry.window.close();
	}

	if (entry.channel) {
		entry.channel.close();
	}

	delete _workplanes[id];
};

// ===================================================================
// Close all workplanes
// ===================================================================
FontRig.Workplane.closeAll = function() {
	for (var id in _workplanes) {
		FontRig.Workplane.close(id);
	}
};

// ===================================================================
// Get all open workplane entries
// ===================================================================
FontRig.Workplane.getAll = function() {
	return _workplanes;
};

// ===================================================================
// Get count of open workplanes
// ===================================================================
FontRig.Workplane.count = function() {
	var n = 0;
	for (var id in _workplanes) {
		if (_workplanes[id].window && !_workplanes[id].window.closed) n++;
	}
	return n;
};

// ===================================================================
// Send message to a specific workplane
// ===================================================================
FontRig.Workplane.send = function(id, type, data) {
	var entry = _workplanes[id];
	if (!entry || !entry.channel) return;

	try {
		entry.channel.postMessage({ type: type, data: data });
	} catch (e) { /* silent */ }
};

// ===================================================================
// Broadcast a message to all open workplanes
// ===================================================================
FontRig.Workplane.broadcast = function(type, data) {
	for (var id in _workplanes) {
		FontRig.Workplane.send(id, type, data);
	}
};

// ===================================================================
// Notify workplanes of font change
// ===================================================================
FontRig.Workplane.notifyFontChanged = function() {
	FontRig.Workplane.broadcast('fontChanged', null);
};

// ===================================================================
// Notify workplanes of glyph change
// ===================================================================
FontRig.Workplane.notifyGlyphChanged = function() {
	FontRig.Workplane.broadcast('glyphChanged', null);
};

// ===================================================================
// Handle messages from workplanes
// ===================================================================
FontRig.Workplane._onMessage = function(workplaneId, msg) {
	if (!msg || !msg.type) return;

	if (msg.type === 'workplaneReady') {
		// Workplane just connected — it has access to FontRig via
		// window.opener so shared state is already available
	}

	if (msg.type === 'workplaneClosed') {
		// Clean up
		var entry = _workplanes[workplaneId];
		if (entry && entry.channel) {
			entry.channel.close();
		}
		delete _workplanes[workplaneId];
	}

	if (msg.type === 'panelAdded') {
		// A panel was added in the workplane — widgets are auto-registered
		// in the shared SidebarConfig instance registry via window.opener
	}
};

// ===================================================================
// Clean up on main window unload
// ===================================================================
window.addEventListener('beforeunload', function() {
	FontRig.Workplane.closeAll();
});

})();
