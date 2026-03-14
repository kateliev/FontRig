// ===================================================================
// FontRig — Event Stream (Async Iterator Queue)
// ===================================================================
// Inspired by Fontra's approach: mouse interactions are consumed as
// async iterables rather than scattered across mousedown/mousemove/
// mouseup handlers.
//
// Usage:
//   const stream = new FontRig.EventStream();
//   stream.push(event);        // from mousemove/mouseup/keydown
//   stream.done();             // signals end (mouseup)
//
//   // Consumer (in an async function):
//   for await (const event of stream) {
//       // process each move/key event
//   }
//   // loop exits when stream.done() is called
//
// This allows each interaction (drag, select, pan) to be written as
// a single linear async function instead of state-machine flags.
// ===================================================================
'use strict';

/**
 * Async iterable queue. Events are pushed by the mouse tracker and
 * consumed by tool/interaction functions with `for await`.
 */
FontRig.EventStream = function() {
	this._queue = [];
	this._resolve = null;
	this._finished = false;
};

/** Push an event into the stream (called by MouseTracker). */
FontRig.EventStream.prototype.push = function(event) {
	if (this._finished) return;
	if (this._resolve) {
		// A consumer is waiting — resolve immediately
		var r = this._resolve;
		this._resolve = null;
		r({ value: event, done: false });
	} else {
		// Buffer until consumed
		this._queue.push(event);
	}
};

/** Signal that no more events will come (mouseup). */
FontRig.EventStream.prototype.done = function() {
	this._finished = true;
	if (this._resolve) {
		var r = this._resolve;
		this._resolve = null;
		r({ value: undefined, done: true });
	}
};

/** Async iterator protocol. */
FontRig.EventStream.prototype.next = function() {
	var self = this;
	// If there are buffered events, return immediately
	if (self._queue.length > 0) {
		return Promise.resolve({ value: self._queue.shift(), done: false });
	}
	// If already finished, return done
	if (self._finished) {
		return Promise.resolve({ value: undefined, done: true });
	}
	// Otherwise, wait for next push or done
	return new Promise(function(resolve) {
		self._resolve = resolve;
	});
};

/** Make EventStream an async iterable. */
FontRig.EventStream.prototype[Symbol.asyncIterator] = function() {
	return this;
};


// ===================================================================
// Drag threshold helper
// ===================================================================
// Consumes events from the stream until the pointer moves more than
// `threshold` pixels from the initial position. Returns true if a
// drag was initiated, false if the stream ended (mouseup) first.
//
// Events consumed during threshold detection are NOT re-emitted.
// The first event that exceeds the threshold IS the first drag event
// the caller should process (returned via the resolved object).
//
// Usage:
//   var result = await FontRig.shouldInitiateDrag(stream, initialEvent, 3);
//   if (result.isDrag) {
//       // result.event is the first event beyond the threshold
//       processMove(result.event);
//       for await (var event of stream) { processMove(event); }
//   } else {
//       // It was a click, not a drag
//   }

FontRig.shouldInitiateDrag = async function(stream, initialEvent, threshold) {
	threshold = threshold || 3;
	var startX = initialEvent.sx;
	var startY = initialEvent.sy;

	for await (var event of stream) {
		// Skip non-mouse events (modifier key changes)
		if (event.sx === undefined) continue;

		var dx = event.sx - startX;
		var dy = event.sy - startY;
		if (dx * dx + dy * dy > threshold * threshold) {
			return { isDrag: true, event: event };
		}
	}
	// Stream ended without exceeding threshold — it was a click
	return { isDrag: false, event: null };
};
