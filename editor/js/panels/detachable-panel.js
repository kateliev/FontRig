// ===================================================================
// FontRig — Panel Communication Bridge
// ===================================================================
// BroadcastChannel-based communication infrastructure for panels.
// Originally used for detaching sidebar tabs into popup windows;
// now retained as the bridge layer for future multi-window workplanes.
//
// Each panel can register a channel and exchange messages with other
// windows/contexts that share the same BroadcastChannel name.
//
// Usage:
//   FontRig.PanelBridge.create({ id, onMessage, getState });
//   FontRig.PanelBridge.send(id, type, data);
//   FontRig.PanelBridge.broadcast(type, data);
// ===================================================================
'use strict';

(function() {

if (typeof FontRig === 'undefined') return;

FontRig.PanelBridge = {};

var _instances = {};

// ===================================================================
// Create a bridge endpoint
// ===================================================================
FontRig.PanelBridge.create = function(options) {
	var id = options.id;
	if (_instances[id]) {
		return _instances[id];
	}

	var bridge = {
		id: id,
		getState: options.getState || function() { return null; },
		onMessage: options.onMessage || function() {},

		channel: null,
		connected: false,
	};

	bridge.send = function(type, data) {
		FontRig.PanelBridge.send(bridge.id, type, data);
	};

	_instances[id] = bridge;
	return bridge;
};

// ===================================================================
// Get bridge by id
// ===================================================================
FontRig.PanelBridge.get = function(id) {
	return _instances[id] || null;
};

// ===================================================================
// Get all bridges
// ===================================================================
FontRig.PanelBridge.getAll = function() {
	return _instances;
};

// ===================================================================
// Connect a bridge (open BroadcastChannel)
// ===================================================================
FontRig.PanelBridge.connect = function(id) {
	var bridge = _instances[id];
	if (!bridge) return;

	if (bridge.connected && bridge.channel) return;

	try {
		bridge.channel = new BroadcastChannel('trv-bridge-' + id);
		bridge.channel.onmessage = function(e) {
			FontRig.PanelBridge._receive(id, e.data);
		};
		bridge.connected = true;
	} catch (e) {
		// BroadcastChannel not available (file:// protocol)
		bridge.connected = false;
	}
};

// ===================================================================
// Disconnect a bridge
// ===================================================================
FontRig.PanelBridge.disconnect = function(id) {
	var bridge = _instances[id];
	if (!bridge) return;

	if (bridge.channel) {
		bridge.channel.close();
		bridge.channel = null;
	}
	bridge.connected = false;
};

// ===================================================================
// Send a message on a bridge
// ===================================================================
FontRig.PanelBridge.send = function(id, type, data) {
	var bridge = _instances[id];
	if (!bridge || !bridge.connected || !bridge.channel) return;

	var msg;
	if (type === 'stateUpdate') {
		msg = { type: 'stateUpdate', state: data };
	} else {
		msg = { type: type, data: data };
	}

	try {
		bridge.channel.postMessage(msg);
	} catch (e) {
		// Channel failed
	}
};

// ===================================================================
// Receive handler
// ===================================================================
FontRig.PanelBridge._receive = function(id, msg) {
	var bridge = _instances[id];
	if (!bridge) return;

	if (msg.type === 'panelReady') {
		FontRig.PanelBridge._sendState(id);
	} else {
		bridge.onMessage(msg);
	}
};

// ===================================================================
// Send current state on a bridge
// ===================================================================
FontRig.PanelBridge._sendState = function(id) {
	var bridge = _instances[id];
	if (!bridge || !bridge.connected || !bridge.channel) return;

	var state = bridge.getState();
	if (state) {
		bridge.channel.postMessage({
			type: 'stateUpdate',
			state: state
		});
	}
};

// ===================================================================
// Broadcast to all connected bridges
// ===================================================================
FontRig.PanelBridge.broadcast = function(type, data) {
	for (var id in _instances) {
		FontRig.PanelBridge.send(id, type, data);
	}
};

// ===================================================================
// Check if any bridge is connected
// ===================================================================
FontRig.PanelBridge.isAnyConnected = function() {
	for (var id in _instances) {
		if (_instances[id].connected) return true;
	}
	return false;
};

})();
