// ===================================================================
// FontRig — Visualization Layer System
// ===================================================================
// Modular, toggleable rendering passes
//
// Each visual element (metrics, contour fill, handles, nodes, anchors,
// selection overlay, transform frame, etc.) is a separate registered
// "visualization layer" with:
//   - identifier  : unique string key
//   - name        : human-readable label for the View menu
//   - zIndex      : draw order (lower = behind)
//   - draw(ctx, layer, opts) : Canvas2D draw function
//   - enabledKey  : which FontRig.state.vizLayers[key] controls it
//   - activeOnly  : true = skip for non-active cells in multi-view
//   - previewMode : 'skip' (hidden in preview), 'only' (only in preview),
//                   'both' (always drawn)
//
// The registry replaces the monolithic renderLayer() function.
// Layers are drawn in zIndex order; each can be toggled by the user
// via the View menu without touching drawing code.
// ===================================================================
'use strict';

// -- Registry -------------------------------------------------------

FontRig.vizRegistry = [];   // sorted by zIndex after registration

FontRig.registerVizLayer = function(def) {
	// Defaults
	def = Object.assign({
		activeOnly: false,
		previewMode: 'skip',   // most layers hidden in preview
	}, def);

	FontRig.vizRegistry.push(def);

	// Keep sorted by zIndex
	FontRig.vizRegistry.sort(function(a, b) { return a.zIndex - b.zIndex; });
};

// -- Check if a layer is enabled ------------------------------------

FontRig.isVizLayerEnabled = function(def) {
	if (!def.enabledKey) return true;  // always on (no toggle)
	return !!FontRig.state.vizLayers[def.enabledKey];
};

// -- Draw all layers for a given font layer -------------------------
// Replaces the body of renderLayer().
// ctx, layer, opts are the same as before.

FontRig.drawVizLayers = function(layer, opts) {
	var state = FontRig.state;
	var preview = state.previewMode;
	var isActive = opts && opts.isActive;

	for (var i = 0; i < FontRig.vizRegistry.length; i++) {
		var def = FontRig.vizRegistry[i];

		// Preview filtering
		if (preview && def.previewMode === 'skip') continue;
		if (!preview && def.previewMode === 'only') continue;

		// Active-only filtering (multi-view: inactive cells skip these)
		if (def.activeOnly && !isActive) continue;

		// User toggle
		if (!FontRig.isVizLayerEnabled(def)) continue;

		// Draw
		def.draw(FontRig.dom.ctx, layer, opts);
	}
};


// ===================================================================
// State: toggle map
// ===================================================================
// Each key matches an enabledKey in a registered viz layer.
// true = visible, false = hidden.
// Layers without an enabledKey are always drawn (structural).

FontRig.state.vizLayers = {
	mask:           true,
	contourFill:    true,
	contourStroke:  true,
	stemMeasure:    true,
	metrics:        true,
	nodes:          true,
	handles:        true,
	hobbyDirHandles:true,
	startPoints:    true,
	stackedWarnings:true,
	selectedSegs:   true,
	anchors:        true,
	selectionRect:  true,
	transformFrame: true,
	layerLabel:     true,
	previewNodes:   true,
};

// Sync legacy flags → vizLayers so existing menu toggles work
FontRig._syncVizFromState = function() {
	var s = FontRig.state;
	var v = s.vizLayers;
	v.nodes          = s.showNodes;
	v.handles        = s.showNodes;   // handles follow nodes
	v.hobbyDirHandles= s.showNodes;   // direction handles follow nodes
	v.startPoints    = s.showNodes;
	v.stackedWarnings= s.showNodes;
	v.selectedSegs   = s.showNodes;
	v.metrics        = s.showMetrics;
	v.anchors        = s.showAnchors;
	v.mask           = s.showMask;
	v.stemMeasure    = s.showStem;
};


// ===================================================================
// Layer Definitions — one per visual element
// ===================================================================
// Each mirrors an existing draw* function but is now a standalone,
// independently toggleable unit.

// ----- z=0: Mask contours ------------------------------------------
FontRig.registerVizLayer({
	identifier:  'mask',
	name:        'Mask contours',
	zIndex:      0,
	enabledKey:  'mask',
	previewMode: 'skip',
	draw: function(ctx, layer) {
		var mask = FontRig.getMaskFor(layer.name);
		if (mask) FontRig.drawMaskContours(mask);
	}
});

// ----- z=100: Contour fill (closed contours) -----------------------
FontRig.registerVizLayer({
	identifier:  'contourFill',
	name:        'Contour fill',
	zIndex:      100,
	enabledKey:  'contourFill',
	previewMode: 'both',
	draw: function(ctx, layer) {
		FontRig.drawContours(layer);
	}
});

// ----- z=150: Stem measurement -------------------------------------
FontRig.registerVizLayer({
	identifier:  'stemMeasure',
	name:        'Stem measurement',
	zIndex:      150,
	enabledKey:  'stemMeasure',
	previewMode: 'both',
	draw: function(ctx, layer) {
		FontRig.drawStemMeasurement(layer);
	}
});

// ----- z=200: Metrics (baseline, advance, font metrics) ------------
FontRig.registerVizLayer({
	identifier:  'metrics',
	name:        'Metrics',
	zIndex:      200,
	enabledKey:  'metrics',
	previewMode: 'skip',
	draw: function(ctx, layer, opts) {
		FontRig.drawMetrics(layer, opts.canvasW, opts.canvasH);
	}
});

// ----- z=300: Stacked node warnings --------------------------------
FontRig.registerVizLayer({
	identifier:  'stackedWarnings',
	name:        'Stacked node warnings',
	zIndex:      300,
	enabledKey:  'stackedWarnings',
	previewMode: 'skip',
	draw: function(ctx, layer) {
		FontRig.drawStackedWarnings(layer);
	}
});

// ----- z=350: Selected segment highlights --------------------------
FontRig.registerVizLayer({
	identifier:  'selectedSegs',
	name:        'Selected segments',
	zIndex:      350,
	enabledKey:  'selectedSegs',
	previewMode: 'skip',
	draw: function(ctx, layer) {
		FontRig.drawSelectedSegments(layer);
	}
});

// ----- z=400: Handle lines -----------------------------------------
FontRig.registerVizLayer({
	identifier:  'handles',
	name:        'Handle lines',
	zIndex:      400,
	enabledKey:  'handles',
	previewMode: 'skip',
	draw: function(ctx, layer) {
		FontRig._drawHandleLines(layer);
	}
});

// ----- z=500: Node markers -----------------------------------------
FontRig.registerVizLayer({
	identifier:  'nodes',
	name:        'Nodes',
	zIndex:      500,
	enabledKey:  'nodes',
	previewMode: 'skip',
	draw: function(ctx, layer) {
		FontRig._drawNodeMarkers(layer);
	}
});

// ----- z=530: Hobby direction handles ------------------------------
FontRig.registerVizLayer({
	identifier:  'hobbyDirHandles',
	name:        'Hobby direction handles',
	zIndex:      530,
	enabledKey:  'hobbyDirHandles',
	previewMode: 'skip',
	draw: function(ctx, layer) {
		FontRig._drawHobbyDirectionHandles(layer);
	}
});

// ----- z=550: Start point triangles --------------------------------
FontRig.registerVizLayer({
	identifier:  'startPoints',
	name:        'Start points',
	zIndex:      550,
	enabledKey:  'startPoints',
	previewMode: 'skip',
	draw: function(ctx, layer) {
		FontRig._drawStartPoints(layer);
	}
});

// ----- z=600: Preview nodes (proximity reveal) ---------------------
FontRig.registerVizLayer({
	identifier:  'previewNodes',
	name:        'Preview nodes',
	zIndex:      600,
	enabledKey:  'previewNodes',
	previewMode: 'only',
	draw: function(ctx, layer) {
		FontRig.drawPreviewNodes(layer);
	}
});

// ----- z=700: Anchors ----------------------------------------------
FontRig.registerVizLayer({
	identifier:  'anchors',
	name:        'Anchors',
	zIndex:      700,
	enabledKey:  'anchors',
	previewMode: 'skip',
	draw: function(ctx, layer) {
		FontRig.drawAnchors(layer);
	}
});

// ----- z=800: Selection overlay (rect/lasso) -----------------------
FontRig.registerVizLayer({
	identifier:  'selectionRect',
	name:        'Selection overlay',
	zIndex:      800,
	enabledKey:  'selectionRect',
	activeOnly:  true,
	previewMode: 'skip',
	draw: function(ctx, layer) {
		if (FontRig.state.isSelecting) {
			FontRig.drawSelectionOverlay();
		}
	}
});

// ----- z=900: Transform frame --------------------------------------
FontRig.registerVizLayer({
	identifier:  'transformFrame',
	name:        'Transform frame',
	zIndex:      900,
	enabledKey:  'transformFrame',
	activeOnly:  true,
	previewMode: 'skip',
	draw: function(ctx, layer) {
		if (FontRig.tf.active) {
			FontRig.drawTransformFrame();
		}
	}
});

// ----- z=1000: Layer label badge -----------------------------------
FontRig.registerVizLayer({
	identifier:  'layerLabel',
	name:        'Layer label',
	zIndex:      1000,
	enabledKey:  'layerLabel',
	previewMode: 'skip',
	draw: function(ctx, layer) {
		FontRig.drawLayerLabel(layer);
	}
});
