// ===================================================================
// FontRig — interaction/undo.js
// ===================================================================
// Undo / Redo system + change subscribers (moved from interaction.js, M7).
// Per-glyph stacks when a font is open; global stacks for loose files.
// Pure relocation — no behavior change. Attaches to FontRig (state.js).
// ===================================================================
'use strict';

// -- Undo / Redo (snapshot-based) -----------------------------------
// Per-glyph stacks when a font is open; global stacks for loose files.
FontRig.undoStack = [];

FontRig.redoStack = [];

FontRig.UNDO_MAX = 99;

FontRig._nudgeTimer = null;

FontRig._nudgeUndoPushed = false;

// Resolve active undo/redo stacks (per-glyph or global)
FontRig._undoStacks = function() {
	var entry = FontRig._getUndoEntry ? FontRig._getUndoEntry() : null;
	if (entry) return { undo: entry.undoStack, redo: entry.redoStack };
	return { undo: FontRig.undoStack, redo: FontRig.redoStack };
};

// Deep-clone all layers' shape trees for multi-layer undo.
// Returns { _allLayers: true, layers: { name: shapesClone, ... } }
FontRig._snapshotLayer = function() {
	var gd = FontRig.state.glyphData;
	if (!gd || !gd.layers || gd.layers.length === 0) return null;
	var snap = { _allLayers: true, layers: {} };
	for (var i = 0; i < gd.layers.length; i++) {
		var l = gd.layers[i];
		snap.layers[l.name] = structuredClone(l.shapes);
	}
	FontRig.log('[undo] snapshot taken, layers:', Object.keys(snap.layers));
	return snap;
};

// Restore a snapshot. Supports both:
//   - new multi-layer format { _allLayers: true, layers: { name: shapes } }
//   - legacy single-layer format (plain shapes array)
FontRig._restoreSnapshot = function(snapshot) {
	if (!snapshot) return;
	var gd = FontRig.state.glyphData;

	if (snapshot._allLayers && gd && gd.layers) {
		// Multi-layer restore
		var restored = [];
		for (var i = 0; i < gd.layers.length; i++) {
			var l = gd.layers[i];
			if (snapshot.layers[l.name]) {
				l.shapes = structuredClone(snapshot.layers[l.name]);
				FontRig.invalidatePathCache(l);
				restored.push(l.name);
			}
		}
		FontRig.log('[undo] restored layers:', restored);
	} else {
		// Legacy: single active layer
		var layer = FontRig.getActiveLayer();
		if (!layer) return;
		layer.shapes = structuredClone(snapshot);
		FontRig.invalidatePathCache(layer);
	}
};

// Subscribers notified after pushUndo / undo / redo / clearUndo / jumpToUndoIndex.
FontRig._undoSubs = [];

FontRig.onUndoChange = function(fn) {
	if (typeof fn === 'function') FontRig._undoSubs.push(fn);
};

FontRig._notifyUndoChange = function() {
	for (var i = 0; i < FontRig._undoSubs.length; i++) {
		try { FontRig._undoSubs[i](); } catch (e) { console.warn('onUndoChange listener:', e); }
	}
};

// -- Active-layer change pub/sub ------------------------------------
// Replaces the Delta panel's 200ms activeLayer polling. Call
// _notifyLayerChange(name) from every genuine layer-switch site (the
// toolbar <select>, Layer panel, layer cycling, Python sync). Dedups on
// value so transient save/restore swaps and same-value writes are free.
// Returns an unsubscribe fn from onLayerChange so listeners don't leak.
FontRig._layerSubs = [];

FontRig._lastNotifiedLayer = null;

FontRig.onLayerChange = function(fn) {
	if (typeof fn !== 'function') return function() {};
	FontRig._layerSubs.push(fn);
	return function() {
		var idx = FontRig._layerSubs.indexOf(fn);
		if (idx !== -1) FontRig._layerSubs.splice(idx, 1);
	};
};

FontRig._notifyLayerChange = function(name) {
	name = name || null;
	if (name === FontRig._lastNotifiedLayer) return;
	FontRig._lastNotifiedLayer = name;
	for (var i = 0; i < FontRig._layerSubs.length; i++) {
		try { FontRig._layerSubs[i](name); } catch (e) { console.warn('onLayerChange listener:', e); }
	}
};

// Push current state onto undo stack (call before modifying).
// Optional `label` is a human-readable description shown in the Undo panel.
FontRig.pushUndo = function(label) {
	var snapshot = FontRig._snapshotLayer();
	if (!snapshot) return;
	snapshot.label = (typeof label === 'string' && label) ? label : 'Edit';
	snapshot.t = Date.now();
	var stacks = FontRig._undoStacks();
	stacks.undo.push(snapshot);
	if (stacks.undo.length > FontRig.UNDO_MAX) {
		stacks.undo.shift();
	}
	// Any new action clears redo
	stacks.redo.length = 0;
	// Mark glyph dirty
	if (FontRig.font && FontRig.activeGlyph) {
		FontRig.dirtyGlyphs.add(FontRig.activeGlyph);
		FontRig.updateGlyphPanelDirty();
		// Debounced thumbnail refresh
		clearTimeout(FontRig._thumbRefreshTimer);
		var name = FontRig.activeGlyph;
		FontRig._thumbRefreshTimer = setTimeout(function() {
			FontRig.refreshThumbnail(name);
		}, 300);
	}
	// Debounced layer panel refresh (compatibility may have changed)
	clearTimeout(FontRig._layerPanelRefreshTimer);
	FontRig._layerPanelRefreshTimer = setTimeout(function() {
		if (typeof FontRig.updateLayerPanel === 'function') FontRig.updateLayerPanel();
	}, 200);

	// Snapshot lerp layers for reverse propagation
	if (typeof FontRig.lerpEditStart === 'function') FontRig.lerpEditStart();

	FontRig._notifyUndoChange();
};

// Push undo for nudge with timer coalescing.
// Multiple nudges within 400ms count as one undo step.
FontRig.pushUndoNudge = function() {
	if (!FontRig._nudgeUndoPushed) {
		FontRig.pushUndo();
		FontRig._nudgeUndoPushed = true;
	}
	clearTimeout(FontRig._nudgeTimer);
	FontRig._nudgeTimer = setTimeout(function() {
		FontRig._nudgeUndoPushed = false;
	}, 400);
};

// Pass silent=true to restore state without repainting / refreshing the
// XML panel / notifying subscribers — jumpToUndoIndex uses it to replay
// many steps and finalize the UI once at the end.
FontRig.undo = function(silent) {
	var stacks = FontRig._undoStacks();
	FontRig.log('[undo] stack size:', stacks.undo.length, 'redo:', stacks.redo.length);
	if (stacks.undo.length === 0) return;
	// Save current state to redo
	var current = FontRig._snapshotLayer();
	if (current) {
		current.label = 'Current';
		current.t = Date.now();
		stacks.redo.push(current);
	}
	// Restore previous
	var snapshot = stacks.undo.pop();
	FontRig.log('[undo] snapshot type:', snapshot._allLayers ? 'multi-layer' : 'legacy', snapshot._allLayers ? Object.keys(snapshot.layers) : '(active only)');
	FontRig._restoreSnapshot(snapshot);
	FontRig.state.selectedNodeIds.clear();
	if (silent) return;
	FontRig.draw();
	FontRig.updateStatusSelected();
	FontRig.xmlRefresh();
	FontRig._notifyUndoChange();
};

FontRig.redo = function(silent) {
	var stacks = FontRig._undoStacks();
	if (stacks.redo.length === 0) return;
	// Save current state to undo
	var current = FontRig._snapshotLayer();
	if (current) {
		current.label = 'Current';
		current.t = Date.now();
		stacks.undo.push(current);
	}
	// Restore next
	var snapshot = stacks.redo.pop();
	FontRig._restoreSnapshot(snapshot);
	FontRig.state.selectedNodeIds.clear();
	if (silent) return;
	FontRig.draw();
	FontRig.updateStatusSelected();
	FontRig.xmlRefresh();
	FontRig._notifyUndoChange();
};

// Jump to a specific position in the combined undo/redo timeline.
// Timeline = [...undoStack, current, ...redoStackReversed].
// index < undoStack.length  → undo to that point.
// index === undoStack.length → no-op (already current).
// index > undoStack.length  → redo forward.
FontRig.jumpToUndoIndex = function(index) {
	var stacks = FontRig._undoStacks();
	var currentPos = stacks.undo.length;
	if (index === currentPos) return;

	if (index < currentPos) {
		var steps = currentPos - index;
		for (var i = 0; i < steps; i++) FontRig.undo(true);
	} else {
		var fwd = index - currentPos;
		for (var j = 0; j < fwd; j++) FontRig.redo(true);
	}

	// Finalize the UI once after replaying all steps, instead of once
	// per step (each undo()/redo() would otherwise draw + rebuild XML).
	FontRig.draw();
	FontRig.updateStatusSelected();
	FontRig.xmlRefresh();
	FontRig._notifyUndoChange();
};

// Clear undo history (e.g. when loading new glyph)
FontRig.clearUndo = function() {
	var stacks = FontRig._undoStacks();
	stacks.undo.length = 0;
	stacks.redo.length = 0;
	FontRig._notifyUndoChange();
};
