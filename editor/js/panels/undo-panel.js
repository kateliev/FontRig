// ===================================================================
// FontRig — Undo Panel
// ===================================================================
// Lists entries of the active undo/redo stack with a current-position
// divider. Clicking an entry jumps the editor to that state via
// FontRig.jumpToUndoIndex().
//
// Stack ordering:
//   row 0 (top)  .. oldest undo entry
//   row N-1      .. most-recent undo entry (just below "Current")
//   "Current"    .. live state
//   row N+1..    .. redo entries (oldest first from here downward)
//
// Index semantics passed to jumpToUndoIndex:
//   index in [0 .. undoStack.length]    → undo to that depth
//   index in (undoStack.length .. total] → redo forward
// ===================================================================
'use strict';

(function () {

if (typeof FontRig === 'undefined') return;

FontRig.UndoPanel = {};

FontRig.UndoPanel.mount = function (containerEl) {
	if (!containerEl) return null;
	var inst = { _containerEl: containerEl };

	containerEl.innerHTML = '';

	var wrap = document.createElement('div');
	wrap.className = 'undo-panel';
	wrap.style.display = 'flex';
	wrap.style.flexDirection = 'column';
	wrap.style.height = '100%';

	var header = document.createElement('div');
	header.className = 'undo-panel__header';
	header.style.padding = '6px 8px';
	header.style.fontSize = '11px';
	header.style.opacity = '0.7';
	header.textContent = 'History';
	wrap.appendChild(header);

	var list = document.createElement('div');
	list.className = 'undo-panel__list';
	list.style.flex = '1 1 auto';
	list.style.overflowY = 'auto';
	list.style.borderTop = '1px solid var(--border, #333)';
	wrap.appendChild(list);

	var footer = document.createElement('div');
	footer.className = 'undo-panel__footer';
	footer.style.display = 'flex';
	footer.style.gap = '4px';
	footer.style.padding = '6px';
	footer.style.borderTop = '1px solid var(--border, #333)';

	var btnUndo = FRWidget.Button('Undo', {
		icon: 'undo', compact: true, tooltip: 'Undo (Ctrl+Z)',
		onClick: function () { FontRig.undo(); }
	});
	var btnRedo = FRWidget.Button('Redo', {
		icon: 'redo', compact: true, tooltip: 'Redo (Ctrl+Shift+Z)',
		onClick: function () { FontRig.redo(); }
	});
	var btnClear = FRWidget.Button('Clear', {
		compact: true, tooltip: 'Clear undo history',
		onClick: function () { FontRig.clearUndo(); }
	});
	footer.appendChild(btnUndo);
	footer.appendChild(btnRedo);
	footer.appendChild(btnClear);
	wrap.appendChild(footer);

	containerEl.appendChild(wrap);

	// -- Rendering --------------------------------------------------
	function fmtTime(t) {
		if (!t) return '';
		var dt = (Date.now() - t) / 1000;
		if (dt < 1) return 'now';
		if (dt < 60) return Math.round(dt) + 's';
		if (dt < 3600) return Math.round(dt / 60) + 'm';
		return Math.round(dt / 3600) + 'h';
	}

	function makeRow(text, time, opts) {
		opts = opts || {};
		var row = document.createElement('div');
		row.className = 'undo-row';
		row.style.display = 'flex';
		row.style.alignItems = 'center';
		row.style.padding = '4px 8px';
		row.style.fontSize = '12px';
		row.style.cursor = opts.clickable ? 'pointer' : 'default';
		row.style.borderLeft = '2px solid transparent';
		row.style.userSelect = 'none';

		if (opts.kind === 'current') {
			row.style.borderLeftColor = 'var(--accent, #4af)';
			row.style.background = 'rgba(80,160,255,0.10)';
			row.style.fontWeight = 'bold';
		} else if (opts.kind === 'redo') {
			row.style.opacity = '0.55';
		}

		var label = document.createElement('span');
		label.textContent = text;
		label.style.flex = '1 1 auto';
		label.style.overflow = 'hidden';
		label.style.textOverflow = 'ellipsis';
		label.style.whiteSpace = 'nowrap';
		row.appendChild(label);

		if (time) {
			var t = document.createElement('span');
			t.textContent = fmtTime(time);
			t.style.fontSize = '10px';
			t.style.opacity = '0.6';
			t.style.marginLeft = '8px';
			row.appendChild(t);
		}

		if (opts.clickable && opts.kind !== 'current') {
			row.addEventListener('mouseenter', function () {
				row.style.background = 'rgba(255,255,255,0.06)';
			});
			row.addEventListener('mouseleave', function () {
				row.style.background = '';
			});
		}
		return row;
	}

	inst.render = function () {
		list.innerHTML = '';
		if (typeof FontRig._undoStacks !== 'function') {
			var empty0 = document.createElement('div');
			empty0.style.padding = '12px 8px';
			empty0.style.fontSize = '11px';
			empty0.style.opacity = '0.5';
			empty0.textContent = 'Undo system not ready yet.';
			list.appendChild(empty0);
			return;
		}
		var stacks = FontRig._undoStacks();
		var undo = stacks.undo;
		var redo = stacks.redo;

		if (undo.length === 0 && redo.length === 0) {
			var empty = document.createElement('div');
			empty.style.padding = '12px 8px';
			empty.style.fontSize = '11px';
			empty.style.opacity = '0.5';
			empty.textContent = 'No history yet.';
			list.appendChild(empty);
			return;
		}

		// Undo entries (oldest at top, most recent just before "Current")
		for (var i = 0; i < undo.length; i++) {
			var s = undo[i];
			(function (idx) {
				var row = makeRow(s.label || 'Edit', s.t, { clickable: true });
				row.addEventListener('click', function () {
					FontRig.jumpToUndoIndex(idx);
				});
				list.appendChild(row);
			})(i);
		}

		// Current marker
		var current = makeRow('● Current', null, { kind: 'current' });
		list.appendChild(current);

		// Redo entries — redoStack is LIFO (top = next redo); display in
		// forward chronological order: redo[redo.length - 1] is closest
		// to current, redo[0] is farthest in the future.
		for (var j = redo.length - 1; j >= 0; j--) {
			var rs = redo[j];
			// jumpToUndoIndex semantics: position after current = undo.length;
			// each subsequent forward redo step increases index by 1.
			var jumpIdx = undo.length + (redo.length - j);
			(function (idx, label, t) {
				var row = makeRow(label || 'Edit', t, { kind: 'redo', clickable: true });
				row.addEventListener('click', function () {
					FontRig.jumpToUndoIndex(idx);
				});
				list.appendChild(row);
			})(jumpIdx, rs.label, rs.t);
		}
	};

	inst.update = function () { inst.render(); };

	// Subscribe to change events. interaction.js may not be loaded yet
	// when this panel mounts at sidebar init time; retry until it is.
	inst._listener = function () { inst.render(); };
	(function _subscribe() {
		if (typeof FontRig.onUndoChange === 'function') {
			FontRig.onUndoChange(inst._listener);
			inst.render();
		} else {
			setTimeout(_subscribe, 100);
		}
	})();

	inst.unmount = function () {
		// (No formal unsubscribe API yet; listener will be a no-op once detached
		// because containerEl is reused. Render is cheap and self-contained.)
	};

	inst.render();
	return inst;
};

})();
