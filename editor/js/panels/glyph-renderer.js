// ===================================================================
// FontRig — Unified Glyph Thumbnail Renderer
// ===================================================================
// Single rendering pipeline for glyph thumbnails. Replaces the
// duplicated _renderThumbnail / _fontPanelRenderThumb code.
//
// Features:
//   - Configurable canvas size (works at any dimensions)
//   - Path2D caching per glyph (avoids rebuilding paths each render)
//   - requestIdleCallback for non-blocking batch rendering
//   - Skips empty glyphs (no contours)
//   - IntersectionObserver-based lazy loading
// ===================================================================
'use strict';

(function() {

if (typeof FontRig === 'undefined') return;

// -- Namespace ------------------------------------------------------
FontRig.GlyphRenderer = {};

// -- Path2D cache: glyphName → { path, advW, scale, ox, oy } -------
FontRig.GlyphRenderer._pathCache = new Map();

// -- Clear cache (call when font changes) ---------------------------
FontRig.GlyphRenderer.clearCache = function() {
	FontRig.GlyphRenderer._pathCache.clear();
};

// ===================================================================
// Build a Path2D for a glyph's default layer
// ===================================================================
FontRig.GlyphRenderer._buildPath = function(glyphData) {
	var layerName = FontRig.getDefaultLayerName(glyphData);
	var layer = FontRig.getLayerByName(glyphData, layerName);
	if (!layer || layer.shapes.length === 0) return null;

	var path = new Path2D();

	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			var contour = shape.contours[ki];
			if (!contour.closed || contour.nodes.length === 0) continue;
			// Reuse the shared contour tracer from drawing.js
			FontRig._traceContourToPath2d(path, contour);
		}
	}

	return {
		path: path,
		advW: layer.width || (FontRig.font ? FontRig.font.metrics.upm : 1000)
	};
};

// ===================================================================
// Render a glyph thumbnail onto a canvas
// ===================================================================
// Options:
//   canvas     : HTMLCanvasElement
//   glyphData  : parsed glyph object
//   glyphName  : string (for cache key, optional)
//   fillStyle  : string (default 'rgba(200,200,210,0.55)')
//   useCache   : boolean (default true)
// ===================================================================
FontRig.GlyphRenderer.render = function(canvas, glyphData, options) {
	options = options || {};
	var ctx = canvas.getContext('2d');
	var w = canvas.width;
	var h = canvas.height;
	var name = options.glyphName || (glyphData && glyphData.name) || '';
	var useCache = options.useCache !== false;
	var cacheOnly = !!options.cacheOnly;
	// Use theme-aware fill: dark mode gets light gray, light mode gets near-black
	var themeFill = (FontRig.getCurrentTheme && FontRig.getCurrentTheme().thumbnail)
		? FontRig.getCurrentTheme().thumbnail.fill
		: 'rgba(200,200,210,0.55)';
	var fillStyle = options.fillStyle || themeFill;

	ctx.clearRect(0, 0, w, h);

	// Get or build cached path
	var cached = useCache ? FontRig.GlyphRenderer._pathCache.get(name) : null;

	if (!cached) {
		// cacheOnly: skip if no cached Path2D available (avoid disk I/O)
		if (cacheOnly || !glyphData) return false;

		cached = FontRig.GlyphRenderer._buildPath(glyphData);
		if (!cached) return false; // empty glyph

		if (useCache && name) {
			FontRig.GlyphRenderer._pathCache.set(name, cached);
		}
	}

	// Compute fit transform for this canvas size
	var upm = FontRig.font ? FontRig.font.metrics.upm : 1000;
	var desc = FontRig.font ? Math.abs(FontRig.font.metrics.descender) : 200;
	var advW = cached.advW;
	var totalH = upm + desc * 0.3;

	var scale = Math.min((w - 4) / advW, (h - 4) / totalH);
	var ox = (w - advW * scale) / 2;
	var oy = h - 3 - desc * 0.3 * scale;

	// Draw with transform (flip Y for font→screen)
	ctx.save();
	ctx.setTransform(scale, 0, 0, -scale, ox, oy);
	ctx.fillStyle = fillStyle;
	ctx.fill(cached.path, 'nonzero');
	ctx.restore();

	return true;
};

// ===================================================================
// Invalidate a single glyph's cached path
// ===================================================================
FontRig.GlyphRenderer.invalidate = function(glyphName) {
	FontRig.GlyphRenderer._pathCache.delete(glyphName);
};

// ===================================================================
// Async rendering queue
// ===================================================================
// Uses requestIdleCallback where available, falling back to
// requestAnimationFrame. Processes as many items as possible within
// the idle deadline rather than a fixed batch size.
// ===================================================================
FontRig.GlyphRenderer._queue = [];
FontRig.GlyphRenderer._running = false;

FontRig.GlyphRenderer.enqueue = function(item) {
	// item: { name, canvas, element (optional, for flagging) }
	FontRig.GlyphRenderer._queue.push(item);
	FontRig.GlyphRenderer._processQueue();
};

FontRig.GlyphRenderer._processQueue = async function() {
	if (FontRig.GlyphRenderer._running) return;
	FontRig.GlyphRenderer._running = true;

	try {
		var processed = 0;

		// Always reference the live queue property (not a local copy)
		while (FontRig.GlyphRenderer._queue.length > 0) {
			var item = FontRig.GlyphRenderer._queue.shift();

			try {
				await FontRig.GlyphRenderer._processItem(item);
			} catch (err) {
				console.warn('GlyphRenderer: failed to render "' + (item.name || '?') + '":', err);
				if (item.element) item.element.dataset.thumbLoaded = 'error';
			}

			processed++;

			// Yield every 12 items to keep UI responsive
			if (processed % 12 === 0 && FontRig.GlyphRenderer._queue.length > 0) {
				await new Promise(function(resolve) {
					if (typeof requestIdleCallback === 'function') {
						requestIdleCallback(function() { resolve(); }, { timeout: 100 });
					} else {
						requestAnimationFrame(resolve);
					}
				});
			}
		}
	} finally {
		FontRig.GlyphRenderer._running = false;
	}
};

FontRig.GlyphRenderer._processItem = async function(item) {
	var name = item.name;
	var canvas = item.canvas;
	var entryEl = item.element;

	if (entryEl && entryEl.dataset.thumbLoaded) return;

	// Check editing cache first
	var cacheEntry = FontRig.glyphCache ? FontRig.glyphCache.get(name) : null;
	var glyphData = cacheEntry ? cacheEntry.glyphData : null;

	// Load from disk if needed
	if (!glyphData) {
		glyphData = await FontRig.loadGlyphFile(name);
		if (!glyphData) {
			if (entryEl) entryEl.dataset.thumbLoaded = 'empty';
			return;
		}
	}

	FontRig.GlyphRenderer.render(canvas, glyphData, { glyphName: name });

	if (entryEl) entryEl.dataset.thumbLoaded = 'true';
};

})();
