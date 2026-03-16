// ===================================================================
// FontRig — Python Panel (Multi-Instance)
// ===================================================================
// REPL interface: code input, output history, tab switching.
// Depends on pyodide-bridge.js for execution.
//
// Supports multiple instances: each mount() creates fresh DOM.
// History and Pyodide runtime are shared (singleton), but UI state
// (output scroll, input text) is per-instance. Output is broadcast
// to all instances.
// ===================================================================
'use strict';

// -- Namespace ------------------------------------------------------
FontRig.PythonPanel = {};

// -- Shared state (one Pyodide runtime) -----------------------------
FontRig.PythonPanel._history = [];
FontRig.PythonPanel._historyIdx = -1;

// ===================================================================
// Mount: create a Python panel instance into a container
// ===================================================================
FontRig.PythonPanel.mount = function(containerEl, ctx) {
	if (!containerEl) return null;

	var inst = {
		_containerEl: containerEl,
		_outputEl: null,
		_inputEl: null,
		_initBtnEl: null,
		_clearBtnEl: null,
		_statusEl: null,
	};

	containerEl.innerHTML = '';

	// -- Output area ------------------------------------------------
	var output = document.createElement('div');
	output.className = 'py-panel__output';
	containerEl.appendChild(output);
	inst._outputEl = output;

	// -- Input area --------------------------------------------------
	var inputWrap = document.createElement('div');
	inputWrap.className = 'py-panel__input-wrap';

	var input = document.createElement('textarea');
	input.className = 'py-panel__input';
	input.rows = 1;
	input.spellcheck = false;
	input.autocomplete = 'off';
	input.autocorrect = 'off';
	input.autocapitalize = 'off';
	inputWrap.appendChild(input);
	inst._inputEl = input;

	var actionsRow = document.createElement('div');
	actionsRow.className = 'py-panel__actions';

	var initBtn = document.createElement('button');
	initBtn.className = 'py-btn py-btn--primary';
	initBtn.textContent = 'Init Python';
	actionsRow.appendChild(initBtn);
	inst._initBtnEl = initBtn;

	var clearBtn = document.createElement('button');
	clearBtn.className = 'py-btn';
	clearBtn.textContent = 'Clear';
	actionsRow.appendChild(clearBtn);
	inst._clearBtnEl = clearBtn;

	var hint = document.createElement('span');
	hint.className = 'hint';
	hint.textContent = 'Shift+Enter to run';
	actionsRow.appendChild(hint);

	inputWrap.appendChild(actionsRow);
	containerEl.appendChild(inputWrap);

	// -- Status bar --------------------------------------------------
	var statusBar = document.createElement('span');
	statusBar.className = 'fr-sidebar__statusbar';

	var status = document.createElement('span');
	status.className = 'py-status py-status--idle';
	status.textContent = 'Not loaded';
	statusBar.appendChild(status);
	inst._statusEl = status;

	containerEl.appendChild(statusBar);

	// -- Adjust for current bridge state ----------------------------
	if (FontRig.pyBridge && FontRig.pyBridge.ready) {
		initBtn.style.display = 'none';
		input.disabled = false;
		input.placeholder = '>>> Python \u2014 Shift+Enter to run';
		_updateStatus(inst, 'ready');
	} else {
		input.disabled = true;
		input.placeholder = 'Click Init to load Python runtime';
	}

	// -- Wire events ------------------------------------------------
	input.addEventListener('keydown', function(e) {
		if (e.key === 'Enter' && e.shiftKey) {
			e.preventDefault();
			_execute(inst);
		}

		if (e.key === 'ArrowUp' && !e.shiftKey && input.value.indexOf('\n') === -1) {
			if (input.selectionStart === 0) {
				e.preventDefault();
				_historyUp(inst);
			}
		}

		if (e.key === 'ArrowDown' && !e.shiftKey && input.value.indexOf('\n') === -1) {
			if (input.selectionStart === input.value.length) {
				e.preventDefault();
				_historyDown(inst);
			}
		}
	});

	input.addEventListener('input', function() {
		_autoResize(input);
	});

	initBtn.addEventListener('click', function() {
		_init(inst);
	});

	clearBtn.addEventListener('click', function() {
		inst._outputEl.innerHTML = '';
	});

	// -- Attach public methods --------------------------------------
	inst.appendOutput = function(text, type) { _appendOutput(inst, text, type); };
	inst.updateStatus = function(status) { _updateStatus(inst, status); };
	inst.focus = function() {
		if (inst._inputEl) setTimeout(function() { inst._inputEl.focus(); }, 50);
	};

	return inst;
};

// ===================================================================
// Internal methods
// ===================================================================

function _autoResize(textarea) {
	textarea.style.height = 'auto';
	var maxH = 160;
	textarea.style.height = Math.min(textarea.scrollHeight, maxH) + 'px';
}

function _appendOutput(inst, text, type) {
	var output = inst._outputEl;
	if (!output) return;

	var entry = document.createElement('div');
	entry.className = 'py-entry py-' + (type || 'output');

	if (type === 'input') {
		var lines = text.split('\n');
		var formatted = [];
		for (var i = 0; i < lines.length; i++) {
			formatted.push((i === 0 ? '>>> ' : '... ') + lines[i]);
		}
		entry.textContent = formatted.join('\n');
	} else {
		entry.textContent = text;
	}

	output.appendChild(entry);
	output.scrollTop = output.scrollHeight;
}

function _updateStatus(inst, status) {
	var el = inst._statusEl;
	if (!el) return;

	var labels = {
		'idle': 'Not loaded',
		'ready': 'Ready',
		'error': 'Error',
	};

	el.textContent = labels[status] || status;
	el.className = 'py-status py-status--' + status;
}

function _init(inst) {
	if (!FontRig.pyBridge) return;
	if (FontRig.pyBridge.ready) return;
	if (FontRig.pyBridge.loading) return;

	// Update all instances' init buttons
	var SBC = FontRig.SidebarConfig;
	if (SBC) {
		SBC.forEachInstance('python', function(i) {
			if (i._initBtnEl) {
				i._initBtnEl.textContent = 'Loading\u2026';
				i._initBtnEl.disabled = true;
			}
		});
	}

	FontRig.pyBridge.init(function(msg) {
		// Broadcast init progress to all instances
		if (SBC) {
			SBC.forEachInstance('python', function(i) {
				_appendOutput(i, msg, 'info');
			});
		}
	}).then(function() {
		if (FontRig.pyBridge.ready) {
			// Update all instances
			if (SBC) {
				SBC.forEachInstance('python', function(i) {
					if (i._initBtnEl) i._initBtnEl.style.display = 'none';
					if (i._inputEl) {
						i._inputEl.disabled = false;
						i._inputEl.placeholder = '>>> Python \u2014 Shift+Enter to run';
					}
					_updateStatus(i, 'ready');
				});
			}

			if (FontRig.state.glyphData) {
				FontRig.pyBridge.syncToPython();
				if (SBC) {
					SBC.forEachInstance('python', function(i) {
						_appendOutput(i, 'glyph synced from viewer.', 'info');
					});
				}
			}
		} else {
			if (SBC) {
				SBC.forEachInstance('python', function(i) {
					if (i._initBtnEl) {
						i._initBtnEl.textContent = 'Retry Init';
						i._initBtnEl.disabled = false;
					}
					_updateStatus(i, 'error');
				});
			}
		}
	});
}

function _execute(inst) {
	var code = inst._inputEl.value.trim();
	if (!code) return;

	// Show input in ALL instances
	var SBC = FontRig.SidebarConfig;
	if (SBC) {
		SBC.forEachInstance('python', function(i) {
			_appendOutput(i, code, 'input');
		});
	}

	// Save to shared history
	FontRig.PythonPanel._history.push(code);
	FontRig.PythonPanel._historyIdx = FontRig.PythonPanel._history.length;

	// Run
	var result = FontRig.pyBridge.run(code);

	// Broadcast output to ALL instances
	if (SBC) {
		SBC.forEachInstance('python', function(i) {
			if (result.output) _appendOutput(i, result.output, 'output');
			if (result.error) _appendOutput(i, result.error, 'error');
			if (result.glyphChanged) _appendOutput(i, '\u21BB glyph updated in viewer', 'info');
		});
	}

	// Clear input on the executing instance
	inst._inputEl.value = '';
	_autoResize(inst._inputEl);
}

function _historyUp(inst) {
	var hist = FontRig.PythonPanel._history;
	if (hist.length === 0) return;
	if (FontRig.PythonPanel._historyIdx > 0) FontRig.PythonPanel._historyIdx--;
	inst._inputEl.value = hist[FontRig.PythonPanel._historyIdx] || '';
	_autoResize(inst._inputEl);
}

function _historyDown(inst) {
	var hist = FontRig.PythonPanel._history;
	if (hist.length === 0) return;
	FontRig.PythonPanel._historyIdx++;
	if (FontRig.PythonPanel._historyIdx >= hist.length) {
		FontRig.PythonPanel._historyIdx = hist.length;
		inst._inputEl.value = '';
	} else {
		inst._inputEl.value = hist[FontRig.PythonPanel._historyIdx] || '';
	}
	_autoResize(inst._inputEl);
}

// ===================================================================
// Legacy global API
// ===================================================================

// Tab switching (still works via sidebar framework)
FontRig.switchPanelTab = function(tabName) {
	FontRig.state.activePanel = tabName;
	if (FontRig._rightSidebar) {
		FontRig.Sidebar.switchTab(FontRig._rightSidebar, tabName);
	}
};

// Legacy pyPanel API — delegates to PythonPanel
FontRig.pyPanel = {
	get history() { return FontRig.PythonPanel._history; },
	get historyIdx() { return FontRig.PythonPanel._historyIdx; },
	set historyIdx(v) { FontRig.PythonPanel._historyIdx = v; },

	init: function() {
		var SBC = FontRig.SidebarConfig;
		if (SBC) {
			var instances = SBC.getInstances('python');
			if (instances.length > 0) {
				_init(instances[0]);
			}
		}
	},

	execute: function() {
		var SBC = FontRig.SidebarConfig;
		if (SBC) {
			var instances = SBC.getInstances('python');
			if (instances.length > 0) {
				_execute(instances[0]);
			}
		}
	},

	appendOutput: function(text, type) {
		var SBC = FontRig.SidebarConfig;
		if (SBC) {
			SBC.forEachInstance('python', function(inst) {
				_appendOutput(inst, text, type);
			});
		}
	},

	clearOutput: function() {
		var SBC = FontRig.SidebarConfig;
		if (SBC) {
			SBC.forEachInstance('python', function(inst) {
				if (inst._outputEl) inst._outputEl.innerHTML = '';
			});
		}
	},

	updateStatus: function(status) {
		var SBC = FontRig.SidebarConfig;
		if (SBC) {
			SBC.forEachInstance('python', function(inst) {
				_updateStatus(inst, status);
			});
		}
	},

	autoResize: function(textarea) {
		_autoResize(textarea);
	},
};

// Legacy wirePythonPanel — no-op, wiring is done in mount()
FontRig.wirePythonPanel = function() {};
