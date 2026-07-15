// ===================================================================
// FontRig — Workplane Manager (Main Window Side)
// ===================================================================
// Manages workplane popup windows. Each workplane is an independent
// window that hosts configurable sidebar panels.
//
// Data sharing: The main window injects its FontRig reference into the
// popup via the popup window handle. The popup bridges key data
// properties (state, font, glyphCache, etc.) as live references so
// widgets see the same data. No serialization needed.
//
// BroadcastChannel: Used only for lightweight refresh notifications
// ("font changed", "glyph changed") so workplane widgets know when
// to re-read the shared data and update their display.
//
// Usage:
//   FontRig.Workplane.open();                  // open a new workplane
//   FontRig.Workplane.notifyFontChanged();     // tell workplanes to refresh
//   FontRig.Workplane.notifyGlyphChanged();    // tell workplanes to refresh
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
	if (window.location.protocol === 'file:') {
		alert('Cannot open Workplane from file:// protocol.\n\n' +
			'Please serve FontRig via HTTP:\n' +
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
		console.warn('[WorkplaneManager] Popup blocked. Allow popups for this site.');
		return null;
	}

	// Inject the main FontRig reference into the popup.
	// Since window.opener may be null in some browser/popup configs,
	// we inject directly via the popup window reference.
	//
	// Strategy: try immediately, then retry on an interval until the
	// popup's document has loaded and accepted the bridge.
	var bridgeAttempts = 0;
	var bridgeTimer = setInterval(function() {
		bridgeAttempts++;
		try {
			if (popup.closed) {
				clearInterval(bridgeTimer);
				return;
			}

			// Inject the reference
			popup._mainFontRig = FontRig;

			// Check if the popup has picked it up (its bootstrap sets _isWorkplane)
			if (popup.FontRig && popup.FontRig._isWorkplane) {
				clearInterval(bridgeTimer);
				FontRig.log('[WorkplaneManager] Bridge confirmed after', bridgeAttempts, 'attempts');
				return;
			}

			// If the popup has the bridge function ready, call it
			if (popup._workplaneBridgeMain && popup.FontRig && !popup.FontRig._isWorkplane) {
				popup._workplaneBridgeMain(FontRig);
				clearInterval(bridgeTimer);
				FontRig.log('[WorkplaneManager] Called popup._workplaneBridgeMain directly');
				return;
			}
		} catch (e) {
			// Cross-origin or popup not ready yet — keep trying
		}

		if (bridgeAttempts > 100) {  // 10 seconds
			clearInterval(bridgeTimer);
			console.warn('[WorkplaneManager] Gave up bridging after 10s');
			if (FontRig.showMessage) {
				FontRig.showMessage('Workplane not connected',
					'The workplane window could not be bridged to the editor ' +
					'after 10 seconds. Close it and try again, and make sure ' +
					'popups are allowed for this site.');
			}
		}
	}, 100);

	// BroadcastChannel for refresh notifications (no data payloads)
	var channelName = 'trv-workplane-' + id;
	var channel = null;

	try {
		channel = new BroadcastChannel(channelName);

		channel.onmessage = function(e) {
			var msg = e.data;
			if (!msg || !msg.type) return;

			if (msg.type === 'workplaneReady') {
				FontRig.log('[WorkplaneManager] Workplane ready:', id);
				// Send current state to newly connected workplane
				if (FontRig.font) {
					channel.postMessage({ type: 'fontChanged' });
				}
				if (FontRig.activeGlyph) {
					channel.postMessage({ type: 'glyphChanged' });
				}
			}

			if (msg.type === 'workplaneClosed') {
				FontRig.Workplane._cleanup(id);
			}

			if (msg.type === 'panelAdded') {
				FontRig.log('[WorkplaneManager] Panel added in', id);
			}

			if (msg.type === 'selectGlyph') {
				FontRig.log('[WorkplaneManager] Glyph selected in workplane:', msg.glyphName);
				if (msg.glyphName && FontRig.switchGlyph) {
					FontRig.switchGlyph(msg.glyphName);
				}
			}
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
	FontRig.log('[WorkplaneManager] Opened workplane:', id);

	return entry;
};

// ===================================================================
// Close / cleanup
// ===================================================================
FontRig.Workplane.close = function(id) {
	var entry = _workplanes[id];
	if (!entry) return;

	if (entry.window && !entry.window.closed) {
		entry.window.close();
	}

	FontRig.Workplane._cleanup(id);
};

FontRig.Workplane._cleanup = function(id) {
	var entry = _workplanes[id];
	if (!entry) return;

	if (entry.channel) {
		try { entry.channel.close(); } catch (e) { /* silent */ }
	}

	delete _workplanes[id];
	FontRig.log('[WorkplaneManager] Cleaned up:', id);
};

FontRig.Workplane.closeAll = function() {
	for (var id in _workplanes) {
		FontRig.Workplane.close(id);
	}
};

// ===================================================================
// Broadcast a refresh notification to all workplanes
// ===================================================================
// These are lightweight signals — no data payload. The workplane
// reads the shared FontRig object for actual data.
// ===================================================================
FontRig.Workplane.broadcast = function(type) {
	for (var id in _workplanes) {
		var entry = _workplanes[id];
		if (entry && entry.channel) {
			try {
				entry.channel.postMessage({ type: type });
			} catch (e) { /* silent — channel may be closed */ }
		}
	}
};

FontRig.Workplane.notifyFontChanged = function() {
	FontRig.Workplane.broadcast('fontChanged');
};

FontRig.Workplane.notifyGlyphChanged = function() {
	FontRig.Workplane.broadcast('glyphChanged');
};

// ===================================================================
// Utility
// ===================================================================
FontRig.Workplane.getAll = function() {
	return _workplanes;
};

FontRig.Workplane.count = function() {
	var n = 0;
	for (var id in _workplanes) {
		if (_workplanes[id].window && !_workplanes[id].window.closed) n++;
	}
	return n;
};

// ===================================================================
// Clean up on main window unload
// ===================================================================
window.addEventListener('beforeunload', function() {
	FontRig.Workplane.closeAll();
});

})();
