// ===================================================================
// FontRig — Python Panel
// ===================================================================
// REPL interface: code input, output history, tab switching.
// Depends on pyodide-bridge.js for execution.
// ===================================================================
'use strict';

// -- Panel tab switching ------------------------------------------------
// Note: When the sidebar framework is active, tab switching is handled
// by Sidebar.switchTab via sidebar-init.js onTabSwitch callback.
// These functions are kept for backward compatibility and for the
// detached panel window.
FontRig.initPanelTabs = function() {
	// Old-style panel tabs (in #panel-tabs) — still used by detached panel
	var tabs = document.querySelectorAll('#panel-tabs .panel-tab');
	tabs.forEach(function(tab) {
		tab.addEventListener('click', function() {
			FontRig.switchPanelTab(this.dataset.panel);
		});
	});
};

FontRig.switchPanelTab = function(tabName) {
	FontRig.state.activePanel = tabName;

	// If right sidebar framework exists, use it for tab switching
	if (FontRig._rightSidebar) {
		FontRig.Sidebar.switchTab(FontRig._rightSidebar, tabName);
		return;
	}

	// Fallback: old-style tab switching (for detached panel)
	document.querySelectorAll('.panel-tab').forEach(function(tab) {
		tab.classList.toggle('active', tab.dataset.panel === tabName);
	});

	document.querySelectorAll('.panel-content').forEach(function(panel) {
		panel.classList.toggle('active', panel.id === tabName + '-tab');
	});

	var xmlInfo = document.getElementById('xml-tab-info');
	var pyInfo = document.getElementById('py-tab-info');
	if (xmlInfo) xmlInfo.style.display = tabName === 'xml' ? '' : 'none';
	if (pyInfo) pyInfo.style.display = tabName === 'python' ? '' : 'none';

	if (tabName === 'xml' && FontRig.state.showXml) {
		FontRig.buildXmlPanel();
	}

	if (tabName === 'python') {
		var input = document.getElementById('py-input');
		if (input) setTimeout(function() { input.focus(); }, 50);
	}
};

// -- Python REPL --------------------------------------------------------
FontRig.pyPanel = {
	history: [],
	historyIdx: -1,

	// -- Initialize Pyodide (triggered by user) -------------------------
	init: async function() {
		const btn = document.getElementById('py-init-btn');
		const output = document.getElementById('py-output');
		const input = document.getElementById('py-input');

		if (FontRig.pyBridge.ready) return;
		if (FontRig.pyBridge.loading) return;

		btn.textContent = 'Loading…';
		btn.disabled = true;

		await FontRig.pyBridge.init(function(msg) {
			FontRig.pyPanel.appendOutput(msg, 'info');
		});

		if (FontRig.pyBridge.ready) {
			btn.style.display = 'none';
			input.disabled = false;
			input.placeholder = '>>> Python — Shift+Enter to run';
			input.focus();

			// Sync current glyph if loaded
			if (FontRig.state.glyphData) {
				FontRig.pyBridge.syncToPython();
				FontRig.pyPanel.appendOutput('glyph synced from viewer.', 'info');
			}

			FontRig.pyPanel.updateStatus('ready');
		} else {
			btn.textContent = 'Retry Init';
			btn.disabled = false;
			FontRig.pyPanel.updateStatus('error');
		}
	},

	// -- Execute code from input ----------------------------------------
	execute: function() {
		const input = document.getElementById('py-input');
		const code = input.value.trim();
		if (!code) return;

		// Show input in output area
		FontRig.pyPanel.appendOutput(code, 'input');

		// Save to history
		this.history.push(code);
		this.historyIdx = this.history.length;

		// Run
		const result = FontRig.pyBridge.run(code);

		if (result.output) {
			FontRig.pyPanel.appendOutput(result.output, 'output');
		}

		if (result.error) {
			FontRig.pyPanel.appendOutput(result.error, 'error');
		}

		if (result.glyphChanged) {
			FontRig.pyPanel.appendOutput('↻ glyph updated in viewer', 'info');
		}

		// Clear input
		input.value = '';
		FontRig.pyPanel.autoResize(input);
	},

	// -- Output helpers -------------------------------------------------
	appendOutput: function(text, type) {
		const output = document.getElementById('py-output');
		if (!output) return;

		const entry = document.createElement('div');
		entry.className = 'py-entry py-' + (type || 'output');

		if (type === 'input') {
			// Format as prompt
			const lines = text.split('\n');
			const formatted = lines.map(function(line, i) {
				return (i === 0 ? '>>> ' : '... ') + line;
			}).join('\n');
			entry.textContent = formatted;
		} else {
			entry.textContent = text;
		}

		output.appendChild(entry);

		// Auto-scroll to bottom
		output.scrollTop = output.scrollHeight;
	},

	clearOutput: function() {
		const output = document.getElementById('py-output');
		if (output) output.innerHTML = '';
	},

	// -- History navigation (up/down arrows) ----------------------------
	historyUp: function() {
		if (this.history.length === 0) return;
		if (this.historyIdx > 0) this.historyIdx--;

		const input = document.getElementById('py-input');
		input.value = this.history[this.historyIdx] || '';
		FontRig.pyPanel.autoResize(input);
	},

	historyDown: function() {
		if (this.history.length === 0) return;
		this.historyIdx++;

		const input = document.getElementById('py-input');
		if (this.historyIdx >= this.history.length) {
			this.historyIdx = this.history.length;
			input.value = '';
		} else {
			input.value = this.history[this.historyIdx] || '';
		}
		FontRig.pyPanel.autoResize(input);
	},

	// -- Status indicator -----------------------------------------------
	updateStatus: function(status) {
		const el = document.getElementById('py-status');
		if (!el) return;

		const labels = {
			'idle': 'Not loaded',
			'ready': 'Ready',
			'error': 'Error',
		};

		el.textContent = labels[status] || status;
		el.className = 'py-status py-status--' + status;
	},

	// -- Auto-resize input textarea -------------------------------------
	autoResize: function(textarea) {
		textarea.style.height = 'auto';
		const maxH = 160; // max ~8 lines
		textarea.style.height = Math.min(textarea.scrollHeight, maxH) + 'px';
	},
};

// -- Wire Python panel events -------------------------------------------
FontRig.wirePythonPanel = function() {
	const input = document.getElementById('py-input');
	const initBtn = document.getElementById('py-init-btn');
	const clearBtn = document.getElementById('py-clear-btn');

	if (!input) return;

	// Shift+Enter to execute, Enter for newline
	input.addEventListener('keydown', function(e) {
		if (e.key === 'Enter' && e.shiftKey) {
			e.preventDefault();
			FontRig.pyPanel.execute();
		}

		// Arrow up in empty single-line input → history
		if (e.key === 'ArrowUp' && !e.shiftKey && input.value.indexOf('\n') === -1) {
			const pos = input.selectionStart;
			if (pos === 0) {
				e.preventDefault();
				FontRig.pyPanel.historyUp();
			}
		}

		// Arrow down in empty single-line input → history
		if (e.key === 'ArrowDown' && !e.shiftKey && input.value.indexOf('\n') === -1) {
			const pos = input.selectionStart;
			if (pos === input.value.length) {
				e.preventDefault();
				FontRig.pyPanel.historyDown();
			}
		}
	});

	// Auto-resize on input
	input.addEventListener('input', function() {
		FontRig.pyPanel.autoResize(this);
	});

	// Init button
	if (initBtn) {
		initBtn.addEventListener('click', function() {
			FontRig.pyPanel.init();
		});
	}

	// Clear button
	if (clearBtn) {
		clearBtn.addEventListener('click', function() {
			FontRig.pyPanel.clearOutput();
		});
	}
};
