// ===================================================================
// FontRig — Mouse Tracker
// ===================================================================
// Central mouse event dispatcher that creates EventStream instances
// for drag interactions and routes hover events.
//
// On mousedown: creates an EventStream and calls dragFunc(stream, initialEvent).
// On mousemove during drag: pushes events into the active stream.
// On mouseup: signals done() on the stream.
// On mousemove without drag: calls hoverFunc(event).
//
// Modifier key changes (shift, ctrl, alt) during a drag are also
// pushed into the stream, so tools can react to modifier changes
// mid-drag (e.g., constraining to axis).
//
// The initialEvent and all stream events share a normalized shape:
//   { sx, sy, gx, gy, absSx, absSy, e (raw DOM event),
//     shiftKey, ctrlKey, altKey, metaKey, button, detail }
//
// Depends on: FontRig.EventStream (event-stream.js)
// ===================================================================
'use strict';

FontRig.MouseTracker = function(opts) {
	this.element = opts.element;
	this.dragFunc = opts.drag;
	this.hoverFunc = opts.hover;
	this._stream = null;       // active EventStream during drag
	this._lastEvent = null;    // last raw event (for modifier replays)

	this._onMouseDown = this._handleMouseDown.bind(this);
	this._onMouseMove = this._handleMouseMove.bind(this);
	this._onMouseUp = this._handleMouseUp.bind(this);
	this._onKeyDown = this._handleKeyChange.bind(this);
	this._onKeyUp = this._handleKeyChange.bind(this);

	this.element.addEventListener('mousedown', this._onMouseDown);
	window.addEventListener('mousemove', this._onMouseMove);
	window.addEventListener('mouseup', this._onMouseUp);
	// Key events during drag: modifier changes pushed into stream
	window.addEventListener('keydown', this._onKeyDown, true);
	window.addEventListener('keyup', this._onKeyUp, true);
};

/** Build a normalized event object from a DOM MouseEvent. */
FontRig.MouseTracker.prototype._normalize = function(e) {
	var rect = this.element.getBoundingClientRect();
	var absSx = e.clientX - rect.left;
	var absSy = e.clientY - rect.top;

	return {
		sx: absSx,           // screen x (relative to canvas)
		sy: absSy,           // screen y
		absSx: absSx,        // same (for multi-view coord transforms)
		absSy: absSy,
		e: e,                // raw DOM event
		shiftKey: e.shiftKey,
		ctrlKey: e.ctrlKey || e.metaKey,
		altKey: e.altKey,
		metaKey: e.metaKey,
		button: e.button,
		detail: e.detail || 0,
		type: 'mouse',
	};
};

/** Build a modifier-change event from a KeyboardEvent. */
FontRig.MouseTracker.prototype._normalizeKey = function(e) {
	return {
		// No sx/sy — consumers should check for undefined to detect key events
		e: e,
		shiftKey: e.shiftKey,
		ctrlKey: e.ctrlKey || e.metaKey,
		altKey: e.altKey,
		metaKey: e.metaKey,
		key: e.key,
		code: e.code,
		type: 'key',
		keyType: e.type,  // 'keydown' or 'keyup'
	};
};

FontRig.MouseTracker.prototype._handleMouseDown = function(e) {
	if (e.button !== 0) return;

	// Skip if click is on a widget overlay
	if (e.target.closest('#glyph-widget') || e.target.closest('#glyph-widgets')) {
		return;
	}

	var event = this._normalize(e);

	// Create a new stream for this drag interaction
	this._stream = new FontRig.EventStream();
	this._lastEvent = e;

	// Call the drag handler — it will consume the stream asynchronously
	this.dragFunc(this._stream, event);
};

FontRig.MouseTracker.prototype._handleMouseMove = function(e) {
	var event = this._normalize(e);
	this._lastEvent = e;

	if (this._stream) {
		// Active drag: push into stream
		this._stream.push(event);
	} else {
		// No drag: hover
		if (this.hoverFunc) {
			this.hoverFunc(event);
		}
	}
};

FontRig.MouseTracker.prototype._handleMouseUp = function(e) {
	if (this._stream) {
		// Push the final mouseup event so consumers see it
		var event = this._normalize(e);
		event.isMouseUp = true;
		this._stream.push(event);
		// Signal stream end
		this._stream.done();
		this._stream = null;
	}
};

FontRig.MouseTracker.prototype._handleKeyChange = function(e) {
	if (!this._stream) return;

	// Only push modifier key changes during active drags
	var isModifier = (e.key === 'Shift' || e.key === 'Control' ||
	                  e.key === 'Alt' || e.key === 'Meta');

	// Also push S/A keys for slide mode during drag
	var isSlideKey = (e.code === 'KeyS' || e.code === 'KeyA');

	if (isModifier || isSlideKey) {
		this._stream.push(this._normalizeKey(e));
	}
};

/** Tear down all listeners. */
FontRig.MouseTracker.prototype.destroy = function() {
	this.element.removeEventListener('mousedown', this._onMouseDown);
	window.removeEventListener('mousemove', this._onMouseMove);
	window.removeEventListener('mouseup', this._onMouseUp);
	window.removeEventListener('keydown', this._onKeyDown, true);
	window.removeEventListener('keyup', this._onKeyUp, true);
};
