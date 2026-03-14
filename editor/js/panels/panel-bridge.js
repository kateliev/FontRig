// ===================================================================
// FontRig — Panel Bridge
// ===================================================================
// BroadcastChannel communication between main window and detached panel.
// Both windows load this file. Role determined by FontRig.panelBridge.role.
// ===================================================================
'use strict';

(function() {

var CHANNEL_NAME = 'trv-panel-bridge';
var channel = null;
var detachedWindow = null;

// -- Bridge state on main window ------------------------------------
if (typeof FontRig !== 'undefined') {
	FontRig.panelBridge = {
		role: 'main',
		channel: null,
		detachedWindow: null,
		isDetached: false,
	};

	// -- Open detached panel ----------------------------------------
	FontRig.detachPanel = function() {
		if (FontRig.panelBridge.isDetached && FontRig.panelBridge.detachedWindow &&
			!FontRig.panelBridge.detachedWindow.closed) {
			FontRig.panelBridge.detachedWindow.focus();
			return;
		}

		// Open the panel page
		var w = 500, h = window.innerHeight;
		var left = window.screenX + window.innerWidth;
		var top = window.screenY;
		FontRig.panelBridge.detachedWindow = window.open(
			'panels/xml-panel.html', 'trv-panel',
			'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top +
			',menubar=no,toolbar=no,status=no'
		);

		// Create channel
		if (!FontRig.panelBridge.channel) {
			FontRig.panelBridge.channel = new BroadcastChannel(CHANNEL_NAME);
			FontRig.panelBridge.channel.onmessage = function(e) {
				FontRig._panelReceive(e.data);
			};
		}

		FontRig.panelBridge.isDetached = true;

		// Hide inline panel
		FontRig.state.showXml = false;
		FontRig.dom.sidePanel.classList.remove('visible');
		FontRig.dom.splitHandle.classList.remove('visible');
		FontRig.dom.sidePanel.style.width = '';

		// Update button state
		var btn = document.getElementById('btn-panel');
		btn.classList.add('detached');
		btn.classList.remove('active');

		requestAnimationFrame(function() { FontRig.draw(); });

		// Send initial state after a short delay (panel needs to load)
		setTimeout(function() { FontRig._panelSendState(); }, 500);
	};

	// -- Reattach panel to inline -----------------------------------
	FontRig.attachPanel = function() {
		if (FontRig.panelBridge.detachedWindow && !FontRig.panelBridge.detachedWindow.closed) {
			FontRig.panelBridge.detachedWindow.close();
		}
		FontRig.panelBridge.detachedWindow = null;
		FontRig.panelBridge.isDetached = false;

		var btn = document.getElementById('btn-panel');
		btn.classList.remove('detached');

		// Close channel
		if (FontRig.panelBridge.channel) {
			FontRig.panelBridge.channel.close();
			FontRig.panelBridge.channel = null;
		}
	};

	// -- Send current glyph state to detached panel -----------------
	FontRig._panelSendState = function() {
		if (!FontRig.panelBridge.isDetached || !FontRig.panelBridge.channel) return;

		// Generate fresh XML
		var xml = '';
		if (FontRig.state.glyphData) {
			xml = FontRig.formatXml(FontRig.glyphToXml(FontRig.state.glyphData));
		}

		var layer = FontRig.getActiveLayer();
		var allNodes = layer ? FontRig.getAllNodes(layer) : [];
		var onCount = allNodes.filter(function(n) { return n.type === 'on'; }).length;

		FontRig.panelBridge.channel.postMessage({
			type: 'stateUpdate',
			xml: xml,
			glyphName: FontRig.state.glyphData ? (FontRig.state.glyphData.name || '?') : '',
			activeLayer: FontRig.state.activeLayer || '',
			nodeCount: { on: onCount, off: allNodes.length - onCount },
		});
	};

	// -- Send selection highlight to detached panel ------------------
	FontRig._panelSendSelection = function() {
		if (!FontRig.panelBridge.isDetached || !FontRig.panelBridge.channel) return;

		var ids = [];
		for (var id of FontRig.state.selectedNodeIds) ids.push(id);

		FontRig.panelBridge.channel.postMessage({
			type: 'selectionChanged',
			ids: ids,
		});
	};

	// -- Receive messages from detached panel ------------------------
	FontRig._panelReceive = function(msg) {
		if (msg.type === 'xmlApply') {
			// Panel edited XML → apply to glyph
			FontRig.dom.xmlContent.value = msg.xml;
			FontRig.xmlApply();
		} else if (msg.type === 'xmlRefresh') {
			// Panel requests fresh XML
			FontRig._panelSendState();
		} else if (msg.type === 'panelReady') {
			// Panel loaded, send initial state
			FontRig._panelSendState();
		} else if (msg.type === 'panelClosed') {
			FontRig.attachPanel();
		} else if (msg.type === 'pyExecute') {
			// Panel requests Python code execution
			FontRig._panelPyExecute(msg.code, msg.id);
		}
	};

	// -- Execute Python code from detached panel -----------------------
	FontRig._panelPyExecute = function(code, msgId) {
		if (!FontRig.pyBridge || !FontRig.pyBridge.ready) {
			FontRig.panelBridge.channel.postMessage({
				type: 'pyResult',
				id: msgId,
				error: 'Python not ready. Click Init in main window to load.',
			});
			return;
		}

		var result = FontRig.pyBridge.run(code);

		// Send result back to panel
		FontRig.panelBridge.channel.postMessage({
			type: 'pyResult',
			id: msgId,
			output: result.output || '',
			error: result.error || null,
			glyphChanged: result.glyphChanged || false,
		});

		// If glyph changed, notify all panels (including this one)
		if (result.glyphChanged) {
			FontRig._panelSendState();
		}
	};

	// -- Hook into existing functions to broadcast changes -----------
	var origBuildXmlPanel = FontRig.buildXmlPanel;
	FontRig.buildXmlPanel = function() {
		origBuildXmlPanel.call(FontRig);
		if (FontRig.panelBridge.isDetached) FontRig._panelSendState();
	};

	var origHighlightXmlNode = FontRig.highlightXmlNode;
	FontRig.highlightXmlNode = function(nodeId) {
		origHighlightXmlNode.call(FontRig, nodeId);
		// Send to detached panel even if inline panel is hidden
		if (FontRig.panelBridge.isDetached) FontRig._panelSendSelection();
	};
}

})();
