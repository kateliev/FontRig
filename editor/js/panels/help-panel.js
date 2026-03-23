// ===================================================================
// FontRig — Help Panel
// ===================================================================
// Simple text-only help panel showing keyboard shortcuts and a brief
// overview of application functionality.
// ===================================================================
'use strict';

FontRig.HelpPanel = {};

FontRig.HelpPanel.mount = function(containerEl, ctx) {
	if (!containerEl) return null;

	var inst = {
		_containerEl: containerEl,
	};

	containerEl.innerHTML = '';

	var content = document.createElement('div');
	content.className = 'help-panel';

	// -- About section ------------------------------------------------
	_addSection(content, 'About', [
		'FontRig is a browser-based glyph editor for font design, focused on simultaneous multiple master editing.',
		'Open .trglyph files or .trfont font folders. All editing operations can synchronize across master layers when the layer scope is set to "Masters" or "Selected".',
	]);

	// -- Canvas interaction --------------------------------------------
	_addSection(content, 'Canvas Interaction', [
		'Click a node to select it. Shift+click to add/remove from selection.',
		'Double-click a contour to select all its nodes.',
		'Drag a node to move the selection. Shift+drag constrains to axis.',
		'Drag on empty canvas to rectangle-select. Alt+drag for lasso selection.',
		'Hold Space and drag to pan the canvas.',
		'Scroll wheel zooms in/out at the cursor position.',
		'Right-click a node to open the context menu.',
	]);

	// -- Slide mode ----------------------------------------------------
	_addSection(content, 'Slide Along (Mouse & Keyboard)', [
		'Hold S and drag a node to slide it along adjacent cubic curves.',
		'Hold A and drag a node to slide it along adjacent line segments.',
		'S/A + Arrow keys also slides in the same way (keyboard slide).',
		'Slide respects the layer scope and propagates to all sync layers.',
	]);

	// -- Multi-layer editing -------------------------------------------
	_addSection(content, 'Multi-Layer Editing', [
		'The layer scope buttons in the toolbar control which layers are affected:',
		'  Active — only the current layer',
		'  Masters — all master layers with compatible structure',
		'  Selected — user-chosen set of layers',
		'Synchronized operations: node insert/delete, type conversion, contour reverse, set start node, smooth toggle, retract handles, open/close contour.',
		'Movement synchronization is controlled separately via Editor > Movement.',
	]);

	// -- Movement preferences ------------------------------------------
	_addSection(content, 'Movement Preferences (Editor > Movement)', [
		'Set global X/Y step values for arrow key nudges.',
		'Toggle "Synchronize movement" to propagate nudges to scope layers.',
		'Toggle "Set per master" to define different step values per layer.',
		'Shift multiplies the step by 10, Ctrl/Cmd multiplies by 100.',
	]);

	// -- Multi-view ----------------------------------------------------
	_addSection(content, 'Multi-View', [
		'1x1, 2x1, 2x2 buttons set how many layers are visible at once.',
		'Join mode overlays all visible layers in a single viewport.',
		'Ctrl+Scroll rotates which layer is shown in a grid column.',
		'Alt+Scroll rotates which layer is shown in a grid row.',
	]);

	// -- Keyboard shortcuts (from keyMap) ------------------------------
	var shortcutsHeading = document.createElement('h3');
	shortcutsHeading.className = 'help-panel__heading';
	shortcutsHeading.textContent = 'Keyboard Shortcuts';
	content.appendChild(shortcutsHeading);

	var table = document.createElement('table');
	table.className = 'help-panel__table';

	var thead = document.createElement('thead');
	var headerRow = document.createElement('tr');
	var thKey = document.createElement('th');
	thKey.textContent = 'Shortcut';
	var thDesc = document.createElement('th');
	thDesc.textContent = 'Action';
	headerRow.appendChild(thKey);
	headerRow.appendChild(thDesc);
	thead.appendChild(headerRow);
	table.appendChild(thead);

	var tbody = document.createElement('tbody');

	// Build from keyMap if available
	var keyMap = FontRig.keyMap || [];
	for (var i = 0; i < keyMap.length; i++) {
		var b = keyMap[i];
		var shortcut = _formatShortcut(b);
		var tr = document.createElement('tr');
		var tdKey = document.createElement('td');
		tdKey.className = 'help-panel__key';
		tdKey.textContent = shortcut;
		var tdDesc = document.createElement('td');
		tdDesc.textContent = b.desc || b.action;
		tr.appendChild(tdKey);
		tr.appendChild(tdDesc);
		tbody.appendChild(tr);
	}

	// Add slide shortcuts (not in keyMap)
	var extras = [
		{ shortcut: 'S + Drag / Arrows', desc: 'Slide node along curves' },
		{ shortcut: 'A + Drag / Arrows', desc: 'Slide node along lines' },
		{ shortcut: 'Space + Drag',      desc: 'Pan canvas' },
		{ shortcut: 'Scroll Wheel',      desc: 'Zoom at cursor' },
		{ shortcut: 'Ctrl + Scroll',     desc: 'Rotate grid column (multi-view)' },
		{ shortcut: 'Alt + Scroll',      desc: 'Rotate grid row (multi-view)' },
	];
	for (var i = 0; i < extras.length; i++) {
		var tr = document.createElement('tr');
		var tdKey = document.createElement('td');
		tdKey.className = 'help-panel__key';
		tdKey.textContent = extras[i].shortcut;
		var tdDesc = document.createElement('td');
		tdDesc.textContent = extras[i].desc;
		tr.appendChild(tdKey);
		tr.appendChild(tdDesc);
		tbody.appendChild(tr);
	}

	table.appendChild(tbody);
	content.appendChild(table);

	// -- Context menu reference ----------------------------------------
	_addSection(content, 'Context Menu (Right-Click)', [
		'Convert to Smooth/Sharp — toggle node smoothness',
		'Insert Node — add a node at segment midpoint',
		'Convert to Line / Curve / Quadratic — change segment type',
		'Retract Handles — collapse off-curve handles to on-curve',
		'Transform — open transform dialog for selection',
		'Select Contour — select all nodes on the contour',
		'Set Start Node — set the contour starting point',
		'Reverse Contour — reverse node order (winding direction)',
		'Open/Close Contour — break or join contour at node',
	]);

	containerEl.appendChild(content);

	inst.onMainWindowEvent = function() {};
	return inst;
};

// -- Helpers ----------------------------------------------------------

function _addSection(parent, title, lines) {
	var heading = document.createElement('h3');
	heading.className = 'help-panel__heading';
	heading.textContent = title;
	parent.appendChild(heading);

	for (var i = 0; i < lines.length; i++) {
		var p = document.createElement('p');
		p.className = 'help-panel__text';
		p.textContent = lines[i];
		parent.appendChild(p);
	}
}

function _formatShortcut(binding) {
	var parts = [];

	if (binding.ctrl) {
		// Use Cmd symbol on Mac hint, but keep text generic
		parts.push('Ctrl');
	}
	if (binding.alt) {
		parts.push('Alt');
	}
	if (binding.shift) {
		parts.push('Shift');
	}

	// Key display name
	var keyName = binding.key || '';
	if (binding.code) {
		// code-based bindings (e.g., 'Period', 'Comma')
		keyName = binding.code.replace(/^Key/, '');
	}

	// Prettify common key names
	var prettyNames = {
		'ArrowUp': '\u2191', 'ArrowDown': '\u2193',
		'ArrowLeft': '\u2190', 'ArrowRight': '\u2192',
		'Escape': 'Esc', 'Backspace': 'Backspace',
		'Delete': 'Delete', 'Home': 'Home',
		'PageUp': 'PgUp', 'PageDown': 'PgDn',
		'Period': '.', 'Comma': ',',
	};
	if (prettyNames[keyName]) keyName = prettyNames[keyName];

	// Handle compound keys like 'Shift+Delete'
	if (keyName.indexOf('+') !== -1) {
		var compound = keyName.split('+');
		parts = compound.slice(0, -1).concat(parts);
		keyName = compound[compound.length - 1];
		if (prettyNames[keyName]) keyName = prettyNames[keyName];
	}

	parts.push(keyName);
	return parts.join(' + ');
}
