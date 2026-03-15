// ===================================================================
// FontRig — Generic Detachable Panel Framework
// ===================================================================
// A unified system for detaching any sidebar tab into a popup window.
// Supports per-tab detach, BroadcastChannel communication, and
// reuses the same panel classes from the main window.
//
// Usage:
//   FontRig.DetachablePanel.create({
//     id: 'xml',           // unique panel identifier
//     sidebar: sidebarObj, // reference to Sidebar instance
//     tabId: 'xml',        // sidebar tab id
//     width: 500,
//     getState: function() { return {...}; },
//     onMessage: function(msg) { ... }
//   });
// ===================================================================
'use strict';

(function() {

if (typeof FontRig === 'undefined') return;

FontRig.DetachablePanel = {};

var _instances = {};

FontRig.DetachablePanel.create = function(options) {
	var id = options.id;
	if (_instances[id]) {
		return _instances[id];
	}

	var panel = {
		id: id,
		sidebar: options.sidebar,
		tabId: options.tabId,
		width: options.width || 400,
		getState: options.getState || function() { return null; },
		onMessage: options.onMessage || function() {},
		onDetach: options.onDetach || function() {},
		onAttach: options.onAttach || function() {},
		
		channel: null,
		detachedWindow: null,
		isDetached: false,
		role: 'main'
	};

	panel.detach = function() {
		FontRig.DetachablePanel.detach(panel.id);
	};

	panel.attach = function() {
		FontRig.DetachablePanel.attach(panel.id);
	};

	panel.send = function(type, data) {
		FontRig.DetachablePanel.send(panel.id, type, data);
	};

	_instances[id] = panel;
	return panel;
};

FontRig.DetachablePanel.get = function(id) {
	return _instances[id] || null;
};

FontRig.DetachablePanel.getAll = function() {
	return _instances;
};

FontRig.DetachablePanel.detach = function(id) {
	var panel = _instances[id];
	if (!panel) return;

	if (panel.isDetached && panel.detachedWindow && !panel.detachedWindow.closed) {
		panel.detachedWindow.focus();
		return;
	}

	var w = panel.width;
	var h = window.innerHeight;
	var left = window.screenX + window.innerWidth;
	var top = window.screenY;

	panel.detachedWindow = window.open(
		'panels/detached-panel.html?panel=' + id,
		'trv-panel-' + id,
		'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top +
		',menubar=no,toolbar=no,status=no'
	);

	panel.channel = new BroadcastChannel('trv-detach-' + panel.id);
	panel.channel.onmessage = function(e) {
		FontRig.DetachablePanel._receive(panel.id, e.data);
	};

	panel.isDetached = true;

	if (panel.sidebar) {
		FontRig.Sidebar.hide(panel.sidebar);
	}

	panel.onDetach();

	FontRig.DetachablePanel._updateToolbarState(panel.id);

	setTimeout(function() {
		FontRig.DetachablePanel._sendState(panel.id);
	}, 500);
};

FontRig.DetachablePanel.attach = function(id) {
	var panel = _instances[id];
	if (!panel) return;

	if (panel.detachedWindow && !panel.detachedWindow.closed) {
		panel.detachedWindow.close();
	}
	panel.detachedWindow = null;
	panel.isDetached = false;

	if (panel.channel) {
		panel.channel.close();
		panel.channel = null;
	}

	panel.onAttach();

	FontRig.DetachablePanel._updateToolbarState(panel.id);
};

FontRig.DetachablePanel.send = function(id, type, data) {
	var panel = _instances[id];
	if (!panel || !panel.isDetached) return;

	var msg = {
		type: type,
		data: data
	};

	if (panel.channel) {
		panel.channel.postMessage(msg);
	}

	// Fallback for file:// protocol - use window.opener
	if (panel.detachedWindow && !panel.detachedWindow.closed && panel.detachedWindow.opener) {
		try {
			panel.detachedWindow.postMessage(msg, '*');
		} catch (e) {
			// ignore
		}
	}
};

FontRig.DetachablePanel._receive = function(id, msg) {
	var panel = _instances[id];
	if (!panel) return;

	if (msg.type === 'panelReady') {
		FontRig.DetachablePanel._sendState(id);
	} else if (msg.type === 'panelClosed') {
		FontRig.DetachablePanel.attach(id);
	} else {
		panel.onMessage(msg);
	}
};

FontRig.DetachablePanel._sendState = function(id) {
	var panel = _instances[id];
	if (!panel || !panel.isDetached || !panel.channel) return;

	var state = panel.getState();
	if (state) {
		panel.channel.postMessage({
			type: 'stateUpdate',
			state: state
		});
	}
};

FontRig.DetachablePanel._updateToolbarState = function(id) {
	var panel = _instances[id];
	if (!panel) return;

	var btnId = 'btn-detach-' + id;
	var btn = document.getElementById(btnId);
	if (!btn) return;

	btn.classList.toggle('detached', panel.isDetached);
};

FontRig.DetachablePanel.broadcast = function(type, data) {
	for (var id in _instances) {
		FontRig.DetachablePanel.send(id, type, data);
	}
};

FontRig.DetachablePanel.isAnyDetached = function() {
	for (var id in _instances) {
		if (_instances[id].isDetached) return true;
	}
	return false;
};

})();
