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
	// Check for file:// protocol
	if (window.location.protocol === 'file:') {
		alert('Cannot open Workplane from file:// protocol.\n\n' +
			'Please serve FontRig via HTTP:\n' +
			'cd /Users/kateliev/Remote/FontRig/editor\n' +
			'python -m http.server 8000\n\n' +
			'Then open: http://localhost:8000');
		return null;
	}

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

	console.log('[WorkplaneManager] Creating channel:', channelName);

	try {
		channel = new BroadcastChannel(channelName);
		channel.onmessage = function(e) {
			console.log('[WorkplaneManager] onmessage received:', e.data);
			console.log('[WorkplaneManager] Received:', e.data);
			FontRig.Workplane._onMessage(id, e.data);
		};
	} catch (e) {
		console.error('[WorkplaneManager] BroadcastChannel error:', e);
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
	var fontData = null;
	if (FontRig.font && FontRig.font.current) {
		fontData = {
			name: FontRig.font.current.name || 'Untitled',
			unitsPerEm: FontRig.font.current.unitsPerEm || 1000,
			ascender: FontRig.font.current.ascender || 800,
			descender: FontRig.font.current.descender || -200,
		};
	}
	FontRig.Workplane.broadcast('fontChanged', fontData);
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
	console.log('[WorkplaneManager] _onMessage called:', workplaneId, msg);
	if (!msg || !msg.type) return;

	if (msg.type === 'workplaneConnect') {
		// Workplane just opened - send init data
		console.log('[WorkplaneManager] Received workplaneConnect, looking for:', workplaneId);
		console.log('[WorkplaneManager] Available workplanes:', Object.keys(_workplanes));
		var entry = _workplanes[workplaneId];
		if (entry && entry.channel) {
			// Gather current font state
			var fontData = null;
			if (FontRig.font && FontRig.font.current) {
				fontData = {
					name: FontRig.font.current.name || 'Untitled',
					unitsPerEm: FontRig.font.current.unitsPerEm || 1000,
					ascender: FontRig.font.current.ascender || 800,
					descender: FontRig.font.current.descender || -200,
				};
			}
			
			entry.channel.postMessage({
				type: 'init',
				fontData: fontData,
			});
			console.log('[Workplane] Sent init to:', workplaneId);
		}
	}

	if (msg.type === 'workplaneReady') {
		// Workplane confirmed it's ready
		console.log('[Workplane] Ready:', workplaneId);
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
