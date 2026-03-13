// ===================================================================
// FontRig — Font Panel
// ===================================================================
// Font info display and glyph list for detached font panel.
// ===================================================================
'use strict';

(function() {

if (typeof TRV === 'undefined') return;

// -- Font panel bridge ----------------------------------------------
TRV.fontPanelBridge = {
	role: 'main',
	channel: null,
	detachedWindow: null,
	isDetached: false,
};

// -- Open detached font panel ---------------------------------------
TRV.detachFontPanel = function() {
	if (TRV.fontPanelBridge.isDetached && TRV.fontPanelBridge.detachedWindow &&
		!TRV.fontPanelBridge.detachedWindow.closed) {
		TRV.fontPanelBridge.detachedWindow.focus();
		return;
	}

	// Open the font panel page
	var w = 350, h = window.innerHeight;
	var left = window.screenX + window.innerWidth;
	var top = window.screenY;
	TRV.fontPanelBridge.detachedWindow = window.open(
		'panels/font-panel.html', 'trv-font-panel',
		'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top +
		',menubar=no,toolbar=no,status=no'
	);

	// Create channel
	if (!TRV.fontPanelBridge.channel) {
		TRV.fontPanelBridge.channel = new BroadcastChannel('trv-font-panel-bridge');
		TRV.fontPanelBridge.channel.onmessage = function(e) {
			TRV._fontPanelReceive(e.data);
		};
	}

	TRV.fontPanelBridge.isDetached = true;

	// Hide inline glyph panel if visible
	var glyphPanel = document.getElementById('glyph-panel');
	if (glyphPanel) {
		glyphPanel.classList.remove('visible');
	}

	// Update button state
	var btn = document.getElementById('btn-font-panel');
	if (btn) btn.classList.add('detached');

	// Send initial state after a short delay
	setTimeout(function() { TRV._fontPanelSendState(); }, 500);
};

// -- Reattach font panel -------------------------------------------
TRV.attachFontPanel = function() {
	if (TRV.fontPanelBridge.detachedWindow && !TRV.fontPanelBridge.detachedWindow.closed) {
		TRV.fontPanelBridge.detachedWindow.close();
	}
	TRV.fontPanelBridge.detachedWindow = null;
	TRV.fontPanelBridge.isDetached = false;

	var btn = document.getElementById('btn-font-panel');
	if (btn) btn.classList.remove('detached');

	// Show inline glyph panel if font is loaded
	if (TRV.font) {
		var glyphPanel = document.getElementById('glyph-panel');
		if (glyphPanel) {
			glyphPanel.classList.add('visible');
		}
	}

	// Close channel
	if (TRV.fontPanelBridge.channel) {
		TRV.fontPanelBridge.channel.close();
		TRV.fontPanelBridge.channel = null;
	}
};

// -- Send font state to detached panel ------------------------------
TRV._fontPanelSendState = function() {
	if (!TRV.fontPanelBridge.isDetached || !TRV.fontPanelBridge.channel) return;

	// Build font info
	var fontInfo = null;
	if (TRV.font && TRV.font.info) {
		var info = TRV.font.info;
		fontInfo = {
			familyName: info.familyName || info.names?.en?.familyName || 'Unknown',
			styleName: info.styleName || info.names?.en?.styleName || 'Regular',
			version: info.version || info.names?.en?.version || '',
			upm: TRV.font.metrics ? TRV.font.metrics.upm : 1000,
			ascender: TRV.font.metrics ? TRV.font.metrics.ascender : '',
			descender: TRV.font.metrics ? TRV.font.metrics.descender : '',
			xHeight: TRV.font.metrics ? TRV.font.metrics.xHeight : '',
			capHeight: TRV.font.metrics ? TRV.font.metrics.capHeight : '',
			masters: []
		};

		// Add masters info
		if (TRV.font.masters) {
			for (var i = 0; i < TRV.font.masters.length; i++) {
				var m = TRV.font.masters[i];
				fontInfo.masters.push({
					name: m.layerName || 'Master ' + (i + 1),
					axisValues: m.axisValues || ''
				});
			}
		}
	}

	// Build glyph list (just names - thumbnails loaded on demand)
	var glyphList = [];
	if (TRV.font && TRV.font.manifest) {
		for (var i = 0; i < TRV.font.manifest.length; i++) {
			var entry = TRV.font.manifest[i];
			var name = entry.alias || entry.name;
			glyphList.push({
				name: name,
				unicode: entry.unicodes || null
			});
		}
	}

	TRV.fontPanelBridge.channel.postMessage({
		type: 'fontUpdate',
		fontInfo: fontInfo,
		glyphList: glyphList,
		glyphCount: TRV.font ? TRV.font.manifest.length : 0,
		currentGlyph: TRV.state.glyphData ? TRV.state.glyphData.name : null
	});
};

// -- Send thumbnail to detached panel --------------------------------
TRV._fontPanelSendThumbnail = function(name, canvasData) {
	if (!TRV.fontPanelBridge.isDetached || !TRV.fontPanelBridge.channel) return;

	TRV.fontPanelBridge.channel.postMessage({
		type: 'thumbnail',
		name: name,
		data: canvasData
	});
};

// -- Receive messages from detached font panel ----------------------
TRV._fontPanelReceive = function(msg) {
	if (msg.type === 'panelReady') {
		// Panel loaded, send initial state
		TRV._fontPanelSendState();
	} else if (msg.type === 'panelClosed') {
		TRV.attachFontPanel();
	} else if (msg.type === 'selectGlyph') {
		// Panel requests glyph selection
		if (TRV.font && msg.glyphName) {
			TRV.switchGlyph(msg.glyphName);
		}
	} else if (msg.type === 'requestThumbnail') {
		// Panel requests thumbnail for a glyph
		TRV._sendThumbnailToPanel(msg.name);
	}
};

// -- Queue thumbnail requests from detached panel --------------------
TRV._thumbPanelQueue = [];
TRV._thumbPanelRunning = false;

TRV._sendThumbnailToPanel = function(name) {
	// Queue the request; actual work happens in the async processor
	TRV._thumbPanelQueue.push(name);
	TRV._processThumbPanelQueue();
};

TRV._processThumbPanelQueue = async function() {
	if (TRV._thumbPanelRunning) return;
	TRV._thumbPanelRunning = true;

	while (TRV._thumbPanelQueue.length > 0) {
		var name = TRV._thumbPanelQueue.shift();

		// Check editing cache first
		var cacheEntry = TRV.glyphCache.get(name);
		var glyphData = cacheEntry ? cacheEntry.glyphData : null;

		// Load from disk if not in cache
		if (!glyphData) {
			glyphData = await TRV.loadGlyphFile(name);
		}

		if (!glyphData) {
			TRV._fontPanelSendThumbnail(name, null);
			continue;
		}

		// Render to a temporary canvas
		var cvs = document.createElement('canvas');
		cvs.width = 48;
		cvs.height = 64;
		TRV._fontPanelRenderThumb(cvs, glyphData);

		// Convert to data URL and send
		var dataUrl = cvs.toDataURL('image/png');
		TRV._fontPanelSendThumbnail(name, dataUrl);

		// Yield every 8 thumbnails to keep UI responsive
		if (TRV._thumbPanelQueue.length > 0 && TRV._thumbPanelQueue.length % 8 === 0) {
			await new Promise(function(r) { requestAnimationFrame(r); });
		}
	}

	TRV._thumbPanelRunning = false;
};

// -- Render thumbnail to canvas (copied from font.js) ----------------------
TRV._fontPanelRenderThumb = function(cvs, glyphData) {
	var ctx = cvs.getContext('2d');
	var w = cvs.width;
	var h = cvs.height;

	// Find default layer (consistent across all glyphs)
	var layerName = TRV.getDefaultLayerName(glyphData);
	var layer = TRV.getLayerByName(glyphData, layerName);
	if (!layer || layer.shapes.length === 0) return;

	// Compute transform to fit glyph in thumbnail
	var upm = TRV.font ? TRV.font.metrics.upm : 1000;
	var desc = TRV.font ? Math.abs(TRV.font.metrics.descender) : 200;
	var advW = layer.width || upm;
	var totalH = upm + desc * 0.3;

	var scale = Math.min((w - 4) / advW, (h - 4) / totalH);
	var ox = (w - advW * scale) / 2;
	var oy = h - 3 - desc * 0.3 * scale;

	ctx.clearRect(0, 0, w, h);

	// Draw filled contours
	ctx.beginPath();
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			var contour = shape.contours[ki];
			if (!contour.closed || contour.nodes.length === 0) continue;
			TRV._fontPanelBuildPath(ctx, contour.nodes, scale, ox, oy);
		}
	}

	ctx.fillStyle = 'rgba(200,200,210,0.55)';
	ctx.fill('nonzero');
};

// -- Build a contour path for thumbnail (copied from font.js) -------------
TRV._fontPanelBuildPath = function(ctx, nodes, scale, ox, oy) {
	var n = nodes.length;
	if (n === 0) return;

	// Find first on-curve
	var firstOn = 0;
	for (var j = 0; j < n; j++) {
		if (nodes[j].type === 'on') { firstOn = j; break; }
	}

	var tx = function(x) { return x * scale + ox; };
	var ty = function(y) { return -y * scale + oy; };

	ctx.moveTo(tx(nodes[firstOn].x), ty(nodes[firstOn].y));

	var i = (firstOn + 1) % n;
	var count = 0;

	while (count < n - 1) {
		var node = nodes[i];

		if (node.type === 'on') {
			ctx.lineTo(tx(node.x), ty(node.y));
		} else if (node.type === 'curve') {
			var b1 = node;
			var b2 = nodes[(i + 1) % n];
			var on = nodes[(i + 2) % n];
			ctx.bezierCurveTo(tx(b1.x), ty(b1.y), tx(b2.x), ty(b2.y), tx(on.x), ty(on.y));
			i = (i + 2) % n;
			count += 2;
		} else if (node.type === 'off') {
			var off = node;
			var on = nodes[(i + 1) % n];
			ctx.quadraticCurveTo(tx(off.x), ty(off.y), tx(on.x), ty(on.y));
			i = (i + 1) % n;
			count += 1;
		}

		i = (i + 1) % n;
		count++;
	}

	ctx.closePath();
};

// -- Hook into existing functions to broadcast changes ---------------
var origSwitchGlyph = TRV.switchGlyph;
TRV.switchGlyph = async function(name) {
	var result = origSwitchGlyph.apply(this, arguments);
	// Notify detached font panel of selection change
	if (TRV.fontPanelBridge.isDetached && TRV.fontPanelBridge.channel) {
		TRV.fontPanelBridge.channel.postMessage({
			type: 'glyphSelected',
			glyphName: name
		});
	}
	return result;
};

var origOpenFont = TRV.openFont;
TRV.openFont = async function() {
	var result = origOpenFont.apply(this, arguments);
	// Notify detached font panel
	if (TRV.fontPanelBridge.isDetached) {
		setTimeout(function() { TRV._fontPanelSendState(); }, 500);
	}
	return result;
};

var origCloseFont = TRV.closeFont;
TRV.closeFont = function() {
	var result = origCloseFont.apply(this, arguments);
	// Notify detached font panel
	if (TRV.fontPanelBridge.isDetached) {
		TRV._fontPanelSendState();
	}
	return result;
};

})();
