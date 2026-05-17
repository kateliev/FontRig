// ===================================================================
// FontRig — Glyph Widget
// ===================================================================
// HTML overlay widgets for glyph strip view.
// Shows editable widget for active glyph, read-only for others.
// ===================================================================
'use strict';

// -- Mark color palette (mirrors Python MARK_COLORS) ------------------
// White (#FFFFFF) is treated as "no color" - clears the mark
FontRig.MARK_COLORS = {
	'Red':         '#FF3B30',
	'Orange':      '#FF9500',
	'Brown':       '#A2845E',
	'Yellow':      '#FFCC00',
	'Light Green': '#34C759',
	'Dark Green':  '#00796B',
	'Cyan':        '#5AC8FA',
	'Blue':        '#007AFF',
	'Purple':      '#AF52DE',
	'Pink':        '#FF2D55',
	'Light Gray':  '#AEAEB2',
	'Dark Gray':   '#636366',
};

// Ordered list for the dropdown (no Black)
FontRig.MARK_COLOR_ORDER = [
	'Red', 'Orange', 'Brown', 'Yellow',
	'Light Green', 'Dark Green', 'Cyan', 'Blue',
	'Purple', 'Pink', 'Light Gray', 'Dark Gray'
];

// -- Helper: check if mark represents "no color" --------------------
// Returns true if mark is empty, white, or undefined
FontRig._isNoMark = function(mark) {
	if (!mark) return true;
	var normalized = mark.toUpperCase();
	if (normalized === '#FFFFFF' || normalized === '#FFF' || normalized === '#FFFFFFFF') return true;
	return false;
};

// -- Compute widget position and size (centered on glyph middle) ------
FontRig._getWidgetRect = function(advW, verticalOffset) {
	var lsbScreen = FontRig.glyphToScreen(0, 0);
	var rsbScreen = FontRig.glyphToScreen(advW, 0);
	var wrapRect = FontRig.dom.canvasWrap.getBoundingClientRect();
	var state = FontRig.state;

	// Fixed size: half of advance width, capped to match CSS max-width
	// so centering stays correct at high zoom (CSS clamps the rendered
	// width; using uncapped widgetW for centering would shift left).
	var widgetW = 360 * state.zoom;
	var minW = 80;
	var maxW = 450;
	widgetW = Math.max(minW, Math.min(maxW, widgetW));

	// Center on middle of glyph (advance / 2)
	var midScreenX = (lsbScreen.x + rsbScreen.x) / 2;
	var screenX = midScreenX - widgetW / 2;
	var screenY = lsbScreen.y + (verticalOffset || 12);

	return {
		left: screenX,
		top: screenY,
		width: widgetW
	};
};

// -- Get layer color ----------------------------------------------------
FontRig._getLayerColor = function(layerName, glyphData) {
	if (!glyphData || !layerName) return '#5b9def';
	var layers = glyphData.layers;
	var idx = layers.findIndex(function(l) { return l.name === layerName; });
	if (idx < 0) idx = 0;
	var colors = FontRig.getCurrentTheme().layerColors;
	return colors[idx % colors.length];
};

// -- Helper: resolve glyph data from name -----------------------------
FontRig._resolveGlyphData = function(glyphName) {
	var state = FontRig.state;
	var cacheEntry = FontRig.glyphCache.get(glyphName);
	if (cacheEntry) return cacheEntry.glyphData;
	if (state.glyphData && state.glyphData.name === glyphName) return state.glyphData;
	return null;
};

// -- Update mark swatch display ---------------------------------------
FontRig._updateMarkSwatch = function(mark) {
	var swatch = FontRig.dom.gwMark;
	if (!swatch) return;
	if (mark && !FontRig._isNoMark(mark)) {
		swatch.style.backgroundColor = mark;
		swatch.classList.add('gw-mark-swatch--active');
	} else {
		swatch.style.backgroundColor = '';
		swatch.classList.remove('gw-mark-swatch--active');
	}
};

// -- Update stem fields -----------------------------------------------
FontRig._updateStemFields = function(layer) {
	var stxInput = FontRig.dom.gwStx;
	var styInput = FontRig.dom.gwSty;
	if (!stxInput || !styInput) return;

	stxInput.value = (layer.stx !== undefined && layer.stx !== null) ? layer.stx : '';
	styInput.value = (layer.sty !== undefined && layer.sty !== null) ? layer.sty : '';
};

// -- Glyph Widget HTML Overlay ---------------------------------------
FontRig._widgetSlot = null;

FontRig.showGlyphWidget = function(name, layer, layerName) {
	var widget = FontRig.dom.glyphWidget;
	if (!widget || !name || !layer) return;

	var state = FontRig.state;
	var bounds = FontRig._getLayerBounds(layer);
	var advW = layer.width || 0;

	var lsbVal = bounds ? Math.round(bounds.minX) : 0;
	var rsbVal = bounds ? Math.round(advW - bounds.maxX) : 0;

	var unicode = '';
	if (FontRig.font && FontRig.font.encoding) {
		var code = FontRig.font.encoding[name];
		if (code) unicode = 'U+' + code.toString(16).toUpperCase().padStart(4, '0');
	}

	var rect = FontRig._getWidgetRect(advW, 60);

	widget.style.left = rect.left + 'px';
	widget.style.width = rect.width + 'px';

	// Determine if we should stack vertically (when widget is narrow)
	var stackFields = rect.width < 180;

	if (stackFields) {
		widget.classList.add('gw-stacked');
	} else {
		widget.classList.remove('gw-stacked');
	}

	FontRig.dom.gwName.value = name;
	FontRig.dom.gwUnicode.value = unicode;
	FontRig.dom.gwLayer.textContent = layerName || '';

	// Color the layer indicator
	var layerColor = FontRig._getLayerColor(layerName, state.glyphData);
	FontRig.dom.gwLayer.style.color = layerColor;
	FontRig.dom.gwLayer.previousElementSibling.style.color = layerColor;

	FontRig.dom.gwLsb.value = lsbVal;
	FontRig.dom.gwAdvance.value = advW;
	FontRig.dom.gwRsb.value = rsbVal;

	// Mark color
	var glyphData = FontRig._resolveGlyphData(name);
	FontRig._updateMarkSwatch(glyphData ? glyphData.mark : '');

	// Stem values
	FontRig._updateStemFields(layer);

	FontRig._widgetSlot = name;

	widget.classList.add('visible');

	// Pin: bottom edge always 20px from canvas bottom
	var h = FontRig.dom.canvasWrap.clientHeight;
	widget.style.top = (h - widget.offsetHeight - 20) + 'px';
};

FontRig.hideGlyphWidget = function() {
	if (FontRig.dom.glyphWidget) {
		FontRig.dom.glyphWidget.classList.remove('visible');
	}
	FontRig._widgetSlot = null;
	if (FontRig.dom.glyphWidgets) {
		FontRig.dom.glyphWidgets.innerHTML = '';
	}
	// Close mark dropdown if open
	FontRig._closeMarkDropdown();
};

FontRig._createReadonlyWidget = function(name, layer, layerName, showCloseBtn) {
	var container = FontRig.dom.glyphWidgets;
	if (!container) return;

	var state = FontRig.state;
	var bounds = FontRig._getLayerBounds(layer);
	var advW = layer.width || 0;

	var unicode = '';
	if (FontRig.font && FontRig.font.encoding) {
		var code = FontRig.font.encoding[name];
		if (code) unicode = 'U+' + code.toString(16).toUpperCase().padStart(4, '0');
	}

	var rect = FontRig._getWidgetRect(advW, 60);

	var layerColor = FontRig._getLayerColor(layerName, state.glyphData);

	var widget = document.createElement('div');
	widget.className = 'glyph-widget glyph-widget--readonly visible';
	widget.style.left = rect.left + 'px';
	widget.style.width = rect.width + 'px';
	widget.dataset.glyphName = name;

	// Layout: name, unicode, layer indicator, close button (optional)
	var html = 
		'<div class="gw-field"><span class="tri">label</span><span class="gw-value">' + name + '</span></div>' +
		'<div class="gw-field"><span class="tri">select_glyph</span><span class="gw-value">' + unicode + '</span></div>' +
		'<div class="gw-field gw-field--readonly"><span class="tri" style="color:' + layerColor + '">layer_active</span><span class="gw-value" style="color:' + layerColor + '">' + (layerName || '') + '</span></div>';
	
	if (showCloseBtn) {
		html += '<div class="gw-field gw-field--action" data-field="close"><span class="tri">close</span></div>';
	}
	
	widget.innerHTML = html;

	container.appendChild(widget);

	// Pin: bottom edge always 20px from canvas bottom
	var h = FontRig.dom.canvasWrap.clientHeight;
	widget.style.top = (h - widget.offsetHeight - 20) + 'px';

	// Stop propagation on the widget to prevent canvas click handling
	widget.addEventListener('click', function(e) {
		e.stopPropagation();
	});

	widget.addEventListener('mousedown', function(e) {
		e.stopPropagation();
	});

	// Wire close button if shown
	if (showCloseBtn) {
		var closeBtn = widget.querySelector('[data-field="close"]');
		if (closeBtn) {
			closeBtn.addEventListener('click', function(e) {
				e.stopPropagation();
				e.preventDefault();
				FontRig.removeGlyphFromStrip(name);
			});
		}
	}
};

FontRig.updateGlyphWidget = function() {
	var state = FontRig.state;

	// No glyph loaded - hide widget
	if (!state.glyphData) {
		FontRig.hideGlyphWidget();
		return;
	}

	// Clear non-active widgets container
	if (FontRig.dom.glyphWidgets) {
		FontRig.dom.glyphWidgets.innerHTML = '';
	}

	// --- GLYPH STRIP MODE ---
	// Show per-glyph widgets (active editable, non-active readonly with close)
	if (state.glyphViewMode && FontRig.font) {
		var ws = FontRig.workspace;
		if (ws.activeIdx < 0 || ws.activeIdx >= ws.glyphs.length) {
			FontRig.hideGlyphWidget();
			return;
		}

		var layout = FontRig.getGlyphStripLayout();

		var activeSlot = null;
		for (var i = 0; i < layout.slots.length; i++) {
			if (layout.slots[i].active) { activeSlot = layout.slots[i]; break; }
		}

		// Create read-only widgets for non-active glyphs (with close button)
		var basePanX = state.pan.x - (activeSlot ? activeSlot.x * state.zoom : 0);
		var basePanY = state.pan.y;
		var savedPanX = state.pan.x;
		var savedPanY = state.pan.y;

		for (var i = 0; i < layout.slots.length; i++) {
			var slot = layout.slots[i];
			if (slot.active) continue;

			var cacheEntry = FontRig.glyphCache.get(slot.name);
			if (!cacheEntry) continue;

			var layer = FontRig.getLayerByName(cacheEntry.glyphData, state.activeLayer);
			if (!layer) layer = cacheEntry.glyphData.layers[0];
			if (!layer) continue;

			state.pan.x = basePanX + slot.x * state.zoom;
			state.pan.y = basePanY;

			// Pass true for showCloseBtn in glyph strip mode
			FontRig._createReadonlyWidget(slot.name, layer, state.activeLayer, true);
		}

		state.pan.x = savedPanX;
		state.pan.y = savedPanY;

		if (!activeSlot) {
			FontRig.hideGlyphWidget();
			return;
		}

		// Show editable widget for active glyph
		var name = ws.glyphs[ws.activeIdx];
		var cacheEntry = FontRig.glyphCache.get(name);
		if (!cacheEntry) {
			FontRig.hideGlyphWidget();
			return;
		}

		var layer = FontRig.getLayerByName(cacheEntry.glyphData, state.activeLayer);
		if (!layer) layer = cacheEntry.glyphData.layers[0];
		if (!layer) {
			FontRig.hideGlyphWidget();
			return;
		}

		FontRig.showGlyphWidget(name, layer, state.activeLayer);
		return;
	}

	// --- MULTI-VIEW OR JOINED MODE (non-glyph modes) ---
	// Only show single bottom widget when NOT in glyph strip mode
	if ((state.multiView || state.joinedView) && !state.glyphViewMode) {
		// Hide main editable widget, show single positioned widget
		FontRig.hideGlyphWidget();
		FontRig._positionMultiViewWidget();
		return;
	}

	// --- SINGLE GLYPH MODE ---
	// Show editable widget for the current glyph
	var layer = FontRig.getActiveLayer();
	if (!layer) {
		FontRig.hideGlyphWidget();
		return;
	}

	var glyphName = state.glyphData.name || FontRig.activeGlyph;
	if (!glyphName) {
		FontRig.hideGlyphWidget();
		return;
	}

	FontRig.showGlyphWidget(glyphName, layer, state.activeLayer);
};

// -- Position single widget for multi-view/joined mode ---------------
FontRig._positionMultiViewWidget = function() {
	var state = FontRig.state;
	var widget = FontRig.dom.glyphWidget;
	if (!widget) return;

	var rows = state.gridRows;
	var cols = state.gridCols;
	var w = FontRig.dom.canvasWrap.clientWidth;
	var h = FontRig.dom.canvasWrap.clientHeight;

	// Position at bottom center
	var widgetW = Math.min(400, w * 0.4);
	var widgetX = w / 2 - widgetW / 2;

	// Position the main editable widget. Make it visible first so we
	// can measure offsetHeight, then pin its bottom 20px from the
	// canvas-wrap bottom — matching single-view's formula so the
	// vertical position is consistent across view modes.
	widget.style.left = widgetX + 'px';
	widget.style.width = widgetW + 'px';
	widget.classList.add('visible');
	widget.style.top = (h - widget.offsetHeight - 20) + 'px';

	// Populate with current glyph data
	var layer = FontRig.getActiveLayer();
	if (!layer) {
		widget.classList.remove('visible');
		return;
	}

	var glyphName = state.glyphData.name || FontRig.activeGlyph;
	if (!glyphName) {
		widget.classList.remove('visible');
		return;
	}

	var advW = layer.width || 0;
	var bounds = FontRig._getLayerBounds(layer);
	var lsbVal = bounds ? Math.round(bounds.minX) : 0;
	var rsbVal = bounds ? Math.round(advW - bounds.maxX) : 0;

	var unicode = '';
	if (FontRig.font && FontRig.font.encoding) {
		var code = FontRig.font.encoding[glyphName];
		if (code) unicode = 'U+' + code.toString(16).toUpperCase().padStart(4, '0');
	}

	// Update input values
	FontRig.dom.gwName.value = glyphName;
	FontRig.dom.gwUnicode.value = unicode;
	FontRig.dom.gwLayer.textContent = state.activeLayer || '';
	
	var layerColor = FontRig._getLayerColor(state.activeLayer, state.glyphData);
	FontRig.dom.gwLayer.style.color = layerColor;
	FontRig.dom.gwLayer.previousElementSibling.style.color = layerColor;

	FontRig.dom.gwLsb.value = lsbVal;
	FontRig.dom.gwAdvance.value = advW;
	FontRig.dom.gwRsb.value = rsbVal;

	// Mark color
	FontRig._updateMarkSwatch(state.glyphData ? state.glyphData.mark : '');

	// Stem values
	FontRig._updateStemFields(layer);

	FontRig._widgetSlot = glyphName;
};

// -- Mark dropdown management -----------------------------------------
FontRig._markDropdownOpen = false;

FontRig._openMarkDropdown = function() {
	var dropdown = FontRig.dom.gwMarkDrop;
	if (!dropdown) return;

	// Build dropdown content if empty
	if (!dropdown.hasChildNodes()) {
		FontRig._buildMarkDropdown(dropdown);
	}

	dropdown.classList.add('visible');
	FontRig._markDropdownOpen = true;
};

FontRig._closeMarkDropdown = function() {
	var dropdown = FontRig.dom.gwMarkDrop;
	if (dropdown) dropdown.classList.remove('visible');
	FontRig._markDropdownOpen = false;
};

FontRig._toggleMarkDropdown = function() {
	if (FontRig._markDropdownOpen) {
		FontRig._closeMarkDropdown();
	} else {
		FontRig._openMarkDropdown();
	}
};

FontRig._buildMarkDropdown = function(dropdown) {
	dropdown.innerHTML = '';

	// Clear option
	var clearEl = document.createElement('div');
	clearEl.className = 'gw-mark-option gw-mark-option--clear';
	clearEl.innerHTML = '<span class="gw-mark-dot gw-mark-dot--clear"></span><span class="gw-mark-label">None</span>';
	clearEl.addEventListener('click', function(e) {
		e.stopPropagation();
		FontRig._setGlyphMark('');
	});
	dropdown.appendChild(clearEl);

	// Color options
	for (var i = 0; i < FontRig.MARK_COLOR_ORDER.length; i++) {
		var colorName = FontRig.MARK_COLOR_ORDER[i];
		var hex = FontRig.MARK_COLORS[colorName];

		var opt = document.createElement('div');
		opt.className = 'gw-mark-option';
		opt.dataset.color = hex;
		opt.innerHTML = '<span class="gw-mark-dot" style="background:' + hex + '"></span><span class="gw-mark-label">' + colorName + '</span>';
		opt.addEventListener('click', (function(h) {
			return function(e) {
				e.stopPropagation();
				FontRig._setGlyphMark(h);
			};
		})(hex));
		dropdown.appendChild(opt);
	}
};

FontRig._setGlyphMark = function(hexColor) {
	var glyphName = FontRig._widgetSlot;
	if (!glyphName) return;

	var glyphData = FontRig._resolveGlyphData(glyphName);
	if (!glyphData) return;

	// Treat white as "no color" (clears the mark)
	if (hexColor && FontRig._isNoMark(hexColor)) {
		hexColor = '';
	}

	glyphData.mark = hexColor || '';
	FontRig.dirtyGlyphs.add(glyphName);

	FontRig._updateMarkSwatch(glyphData.mark);
	FontRig._closeMarkDropdown();

	// Update glyph panel cell tinting
	if (typeof FontRig.updateGlyphPanelMark === 'function') {
		FontRig.updateGlyphPanelMark(glyphName);
	}
};

// -- Init: wire all widget events -------------------------------------
FontRig.initGlyphWidget = function() {
	var nameInput = FontRig.dom.gwName;
	var unicodeInput = FontRig.dom.gwUnicode;
	var lsbInput = FontRig.dom.gwLsb;
	var advInput = FontRig.dom.gwAdvance;
	var rsbInput = FontRig.dom.gwRsb;
	var stxInput = FontRig.dom.gwStx;
	var styInput = FontRig.dom.gwSty;

	nameInput.addEventListener('change', function() {
		var oldName = FontRig._widgetSlot;
		var newName = this.value.trim();
		if (!oldName || !newName || oldName === newName) return;

		var ws = FontRig.workspace;
		var idx = ws.glyphs.indexOf(oldName);
		if (idx >= 0) {
			ws.glyphs[idx] = newName;
			FontRig.activeGlyph = newName;
			FontRig.dirtyGlyphs.add(newName);
			FontRig.dirtyGlyphs.delete(oldName);
			FontRig._widgetSlot = newName;
			FontRig.updateGlyphPanelActive();
		}
	});

	unicodeInput.addEventListener('change', function() {
		var glyphName = FontRig._widgetSlot;
		var val = this.value.trim();
		if (!glyphName) return;

		var code = null;
		if (val.startsWith('U+') || val.startsWith('u+')) {
			code = parseInt(val.slice(2), 16);
		} else if (/^[0-9a-fA-F]+$/.test(val)) {
			code = parseInt(val, 16);
		}

		if (code !== null && code >= 0 && code <= 0x10FFFF) {
			if (FontRig.font && FontRig.font.encoding) {
				FontRig.font.encoding[glyphName] = code;
				FontRig.dirtyGlyphs.add(glyphName);
				this.value = 'U+' + code.toString(16).toUpperCase().padStart(4, '0');
			}
		} else {
			if (FontRig.font && FontRig.font.encoding) {
				var current = FontRig.font.encoding[glyphName];
				if (current) {
					this.value = 'U+' + current.toString(16).toUpperCase().padStart(4, '0');
				}
			}
		}
	});

	// -- Mark color selector ------------------------------------------
	var markField = FontRig.dom.glyphWidget.querySelector('[data-field="mark"]');
	if (markField) {
		markField.addEventListener('click', function(e) {
			e.stopPropagation();
			FontRig._toggleMarkDropdown();
		});
	}

	// Close dropdown on outside click
	document.addEventListener('click', function() {
		FontRig._closeMarkDropdown();
	});

	// Prevent dropdown clicks from closing
	if (FontRig.dom.gwMarkDrop) {
		FontRig.dom.gwMarkDrop.addEventListener('click', function(e) {
			e.stopPropagation();
		});
	}

	// -- Metric inputs ------------------------------------------------
	function updateWidths() {
		var glyphName = FontRig._widgetSlot;
		if (!glyphName) return;

		var lsb = parseInt(lsbInput.value) || 0;
		var adv = parseInt(advInput.value) || 0;
		var rsb = parseInt(rsbInput.value) || 0;

		if (lsb + rsb > adv) {
			rsb = adv - lsb;
			rsbInput.value = rsb;
		}

		var state = FontRig.state;
		var glyphData = FontRig._resolveGlyphData(glyphName);
		if (!glyphData) return;

		var layer = FontRig.getLayerByName(glyphData, state.activeLayer);
		if (!layer) layer = glyphData.layers[0];
		if (!layer) return;

		layer.width = adv;

		var bounds = FontRig._getLayerBounds(layer);
		if (bounds) {
			var currentLsb = Math.round(bounds.minX);
			var delta = lsb - currentLsb;
			if (delta !== 0) {
				for (var si = 0; si < layer.shapes.length; si++) {
					var shape = layer.shapes[si];
					for (var ki = 0; ki < shape.contours.length; ki++) {
						var nodes = shape.contours[ki].nodes;
						for (var ni = 0; ni < nodes.length; ni++) {
							nodes[ni].x += delta;
						}
					}
				}
			}
		}

		FontRig.dirtyGlyphs.add(glyphName);
		FontRig.draw();
		FontRig.updateGlyphWidget();
	}

	lsbInput.addEventListener('change', updateWidths);
	advInput.addEventListener('change', updateWidths);
	rsbInput.addEventListener('change', updateWidths);

	// -- Stem inputs --------------------------------------------------
	function updateStems() {
		var glyphName = FontRig._widgetSlot;
		if (!glyphName) return;

		var state = FontRig.state;
		var glyphData = FontRig._resolveGlyphData(glyphName);
		if (!glyphData) return;

		var layer = FontRig.getLayerByName(glyphData, state.activeLayer);
		if (!layer) layer = glyphData.layers[0];
		if (!layer) return;

		var stxVal = stxInput.value.trim();
		var styVal = styInput.value.trim();

		layer.stx = stxVal !== '' ? parseFloat(stxVal) : undefined;
		layer.sty = styVal !== '' ? parseFloat(styVal) : undefined;

		FontRig.dirtyGlyphs.add(glyphName);
	}

	if (stxInput) stxInput.addEventListener('change', updateStems);
	if (styInput) styInput.addEventListener('change', updateStems);

	// -- Close button -------------------------------------------------
	var closeBtn = FontRig.dom.glyphWidget.querySelector('[data-field="close"]');
	if (closeBtn) {
		closeBtn.addEventListener('click', function() {
			var name = FontRig._widgetSlot;
			if (name) {
				FontRig.removeGlyphFromStrip(name);
			}
		});
	}
};

FontRig._getLayerBounds = function(layer) {
	var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	var found = false;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			var nodes = shape.contours[ki].nodes;
			for (var ni = 0; ni < nodes.length; ni++) {
				found = true;
				if (nodes[ni].x < minX) minX = nodes[ni].x;
				if (nodes[ni].y < minY) minY = nodes[ni].y;
				if (nodes[ni].x > maxX) maxX = nodes[ni].x;
				if (nodes[ni].y > maxY) maxY = nodes[ni].y;
			}
		}
	}
	return found ? { minX: minX, minY: minY, maxX: maxX, maxY: maxY } : null;
};
