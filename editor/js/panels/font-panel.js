// ===================================================================
// FontRig — Font Panel
// ===================================================================
// Font info display and glyph list for detached font panel.
// ===================================================================
'use strict';

(function() {

if (typeof FontRig === 'undefined') return;

// -- Font panel bridge ----------------------------------------------
FontRig.fontPanelBridge = {
	role: 'main',
	channel: null,
	detachedWindow: null,
	isDetached: false,
};

// -- Open detached font panel ---------------------------------------
FontRig.detachFontPanel = function() {
	if (FontRig.fontPanelBridge.isDetached && FontRig.fontPanelBridge.detachedWindow &&
		!FontRig.fontPanelBridge.detachedWindow.closed) {
		FontRig.fontPanelBridge.detachedWindow.focus();
		return;
	}

	// Open the font panel page
	var w = 350, h = window.innerHeight;
	var left = window.screenX + window.innerWidth;
	var top = window.screenY;
	FontRig.fontPanelBridge.detachedWindow = window.open(
		'panels/font-panel.html', 'trv-font-panel',
		'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top +
		',menubar=no,toolbar=no,status=no'
	);

	// Create channel
	if (!FontRig.fontPanelBridge.channel) {
		FontRig.fontPanelBridge.channel = new BroadcastChannel('trv-font-panel-bridge');
		FontRig.fontPanelBridge.channel.onmessage = function(e) {
			FontRig._fontPanelReceive(e.data);
		};
	}

	FontRig.fontPanelBridge.isDetached = true;

	// Hide inline glyph panel if visible
	var glyphPanel = document.getElementById('glyph-panel');
	if (glyphPanel) {
		glyphPanel.classList.remove('visible');
	}

	// Update button state
	var btn = document.getElementById('btn-font-panel');
	if (btn) btn.classList.add('detached');

	// Send initial state after a short delay
	setTimeout(function() { FontRig._fontPanelSendState(); }, 500);
};

// -- Reattach font panel -------------------------------------------
FontRig.attachFontPanel = function() {
	if (FontRig.fontPanelBridge.detachedWindow && !FontRig.fontPanelBridge.detachedWindow.closed) {
		FontRig.fontPanelBridge.detachedWindow.close();
	}
	FontRig.fontPanelBridge.detachedWindow = null;
	FontRig.fontPanelBridge.isDetached = false;

	var btn = document.getElementById('btn-font-panel');
	if (btn) btn.classList.remove('detached');

	// Show inline glyph panel if font is loaded
	if (FontRig.font) {
		var glyphPanel = document.getElementById('glyph-panel');
		if (glyphPanel) {
			glyphPanel.classList.add('visible');
		}
	}

	// Close channel
	if (FontRig.fontPanelBridge.channel) {
		FontRig.fontPanelBridge.channel.close();
		FontRig.fontPanelBridge.channel = null;
	}
};

// -- Send font state to detached panel ------------------------------
FontRig._fontPanelSendState = function() {
	if (!FontRig.fontPanelBridge.isDetached || !FontRig.fontPanelBridge.channel) return;

	// Build font info
	var fontInfo = null;
	if (FontRig.font && FontRig.font.info) {
		var info = FontRig.font.info;
		fontInfo = {
			familyName: info.familyName || info.names?.en?.familyName || 'Unknown',
			styleName: info.styleName || info.names?.en?.styleName || 'Regular',
			version: info.version || info.names?.en?.version || '',
			upm: FontRig.font.metrics ? FontRig.font.metrics.upm : 1000,
			ascender: FontRig.font.metrics ? FontRig.font.metrics.ascender : '',
			descender: FontRig.font.metrics ? FontRig.font.metrics.descender : '',
			xHeight: FontRig.font.metrics ? FontRig.font.metrics.xHeight : '',
			capHeight: FontRig.font.metrics ? FontRig.font.metrics.capHeight : '',
			masters: []
		};

		// Add masters info
		if (FontRig.font.masters) {
			for (var i = 0; i < FontRig.font.masters.length; i++) {
				var m = FontRig.font.masters[i];
				fontInfo.masters.push({
					name: m.layerName || 'Master ' + (i + 1),
					axisValues: m.axisValues || ''
				});
			}
		}
	}

	// Build glyph list (just names - thumbnails loaded on demand)
	var glyphList = [];
	if (FontRig.font && FontRig.font.manifest) {
		for (var i = 0; i < FontRig.font.manifest.length; i++) {
			var entry = FontRig.font.manifest[i];
			var name = entry.alias || entry.name;
			glyphList.push({
				name: name,
				unicode: entry.unicodes || null
			});
		}
	}

	FontRig.fontPanelBridge.channel.postMessage({
		type: 'fontUpdate',
		fontInfo: fontInfo,
		glyphList: glyphList,
		glyphCount: FontRig.font ? FontRig.font.manifest.length : 0,
		currentGlyph: FontRig.state.glyphData ? FontRig.state.glyphData.name : null
	});
};

// -- Send thumbnail to detached panel --------------------------------
FontRig._fontPanelSendThumbnail = function(name, canvasData) {
	if (!FontRig.fontPanelBridge.isDetached || !FontRig.fontPanelBridge.channel) return;

	FontRig.fontPanelBridge.channel.postMessage({
		type: 'thumbnail',
		name: name,
		data: canvasData
	});
};

// -- Receive messages from detached font panel ----------------------
FontRig._fontPanelReceive = function(msg) {
	if (msg.type === 'panelReady') {
		// Panel loaded, send initial state
		FontRig._fontPanelSendState();
	} else if (msg.type === 'panelClosed') {
		FontRig.attachFontPanel();
	} else if (msg.type === 'selectGlyph') {
		// Panel requests glyph selection
		if (FontRig.font && msg.glyphName) {
			FontRig.switchGlyph(msg.glyphName);
		}
	} else if (msg.type === 'requestThumbnail') {
		// Panel requests thumbnail for a glyph
		FontRig._sendThumbnailToPanel(msg.name);
	}
};

// -- Queue thumbnail requests from detached panel --------------------
FontRig._thumbPanelQueue = [];
FontRig._thumbPanelRunning = false;

FontRig._sendThumbnailToPanel = function(name) {
	// Queue the request; actual work happens in the async processor
	FontRig._thumbPanelQueue.push(name);
	FontRig._processThumbPanelQueue();
};

FontRig._processThumbPanelQueue = async function() {
	if (FontRig._thumbPanelRunning) return;
	FontRig._thumbPanelRunning = true;

	while (FontRig._thumbPanelQueue.length > 0) {
		var name = FontRig._thumbPanelQueue.shift();

		// Check editing cache first
		var cacheEntry = FontRig.glyphCache.get(name);
		var glyphData = cacheEntry ? cacheEntry.glyphData : null;

		// Load from disk if not in cache
		if (!glyphData) {
			glyphData = await FontRig.loadGlyphFile(name);
		}

		if (!glyphData) {
			FontRig._fontPanelSendThumbnail(name, null);
			continue;
		}

		// Render to a temporary canvas
		var cvs = document.createElement('canvas');
		cvs.width = 48;
		cvs.height = 64;
		FontRig._fontPanelRenderThumb(cvs, glyphData);

		// Convert to data URL and send
		var dataUrl = cvs.toDataURL('image/png');
		FontRig._fontPanelSendThumbnail(name, dataUrl);

		// Yield every 8 thumbnails to keep UI responsive
		if (FontRig._thumbPanelQueue.length > 0 && FontRig._thumbPanelQueue.length % 8 === 0) {
			await new Promise(function(r) { requestAnimationFrame(r); });
		}
	}

	FontRig._thumbPanelRunning = false;
};

// -- Render thumbnail to canvas (copied from font.js) ----------------------
FontRig._fontPanelRenderThumb = function(cvs, glyphData) {
	var ctx = cvs.getContext('2d');
	var w = cvs.width;
	var h = cvs.height;

	// Find default layer (consistent across all glyphs)
	var layerName = FontRig.getDefaultLayerName(glyphData);
	var layer = FontRig.getLayerByName(glyphData, layerName);
	if (!layer || layer.shapes.length === 0) return;

	// Compute transform to fit glyph in thumbnail
	var upm = FontRig.font ? FontRig.font.metrics.upm : 1000;
	var desc = FontRig.font ? Math.abs(FontRig.font.metrics.descender) : 200;
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
			FontRig._fontPanelBuildPath(ctx, contour.nodes, scale, ox, oy);
		}
	}

	ctx.fillStyle = 'rgba(200,200,210,0.55)';
	ctx.fill('nonzero');
};

// -- Build a contour path for thumbnail (copied from font.js) -------------
FontRig._fontPanelBuildPath = function(ctx, nodes, scale, ox, oy) {
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
var origSwitchGlyph = FontRig.switchGlyph;
FontRig.switchGlyph = async function(name) {
	var result = origSwitchGlyph.apply(this, arguments);
	// Notify detached font panel of selection change
	if (FontRig.fontPanelBridge.isDetached && FontRig.fontPanelBridge.channel) {
		FontRig.fontPanelBridge.channel.postMessage({
			type: 'glyphSelected',
			glyphName: name
		});
	}
	return result;
};

var origOpenFont = FontRig.openFont;
FontRig.openFont = async function() {
	var result = origOpenFont.apply(this, arguments);
	// Notify detached font panel
	if (FontRig.fontPanelBridge.isDetached) {
		setTimeout(function() { FontRig._fontPanelSendState(); }, 500);
	}
	return result;
};

var origCloseFont = FontRig.closeFont;
FontRig.closeFont = function() {
	var result = origCloseFont.apply(this, arguments);
	// Notify detached font panel
	if (FontRig.fontPanelBridge.isDetached) {
		FontRig._fontPanelSendState();
	}
	return result;
};

})();
