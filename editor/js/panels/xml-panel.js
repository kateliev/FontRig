// ===================================================================
// FontRig — XML Panel (Multi-Instance)
// ===================================================================
// XML sync model: manual Refresh (data->XML) and Apply (XML->data).
// No live sync during editing — canvas is the source of truth.
// Node selection -> XML highlight is kept (one direction only).
//
// Supports multiple instances: the primary instance uses the original
// DOM IDs for backward compatibility; clones create fresh DOM.
// All instances sync from the same glyph data source.
// ===================================================================
'use strict';

// ===================================================================
// Mount: create an XML panel instance into a container
// ===================================================================
FontRig.XmlPanel = {};

FontRig.XmlPanel.mount = function(containerEl, ctx) {
	if (!containerEl) return null;

	var inst = {
		_containerEl: containerEl,
		_textareaEl: null,
		_nodeCountEl: null,
		_parseStatusEl: null,
		_refreshBtnEl: null,
		_applyBtnEl: null,
		_lineNodeMap: {},
		_nodeLineMap: {},
	};

	containerEl.innerHTML = '';

	// -- Actions bar ------------------------------------------------
	var actions = document.createElement('div');
	actions.className = 'xml-panel__actions';

	var refreshBtn = document.createElement('button');
	refreshBtn.className = 'tb-btn';
	refreshBtn.title = 'Regenerate XML from glyph data (Refresh)';
	refreshBtn.innerHTML = '<span class="tri">refresh</span>';
	actions.appendChild(refreshBtn);
	inst._refreshBtnEl = refreshBtn;

	var applyBtn = document.createElement('button');
	applyBtn.className = 'tb-btn';
	applyBtn.title = 'Apply XML edits to glyph (Ctrl+Enter)';
	applyBtn.innerHTML = '<span class="tri">action_play</span>';
	actions.appendChild(applyBtn);
	inst._applyBtnEl = applyBtn;

	containerEl.appendChild(actions);

	// -- Textarea ---------------------------------------------------
	var textarea = document.createElement('textarea');
	textarea.className = 'xml-panel__content';
	textarea.spellcheck = false;
	textarea.autocomplete = 'off';
	textarea.autocorrect = 'off';
	textarea.autocapitalize = 'off';
	containerEl.appendChild(textarea);
	inst._textareaEl = textarea;

	// -- Status bar --------------------------------------------------
	var statusBar = document.createElement('span');
	statusBar.className = 'fr-sidebar__statusbar';

	var nodeCount = document.createElement('span');
	nodeCount.className = 'xml-panel__node-count';
	statusBar.appendChild(nodeCount);
	inst._nodeCountEl = nodeCount;

	var parseStatus = document.createElement('span');
	parseStatus.className = 'parse-status ok';
	parseStatus.textContent = 'OK';
	statusBar.appendChild(parseStatus);
	inst._parseStatusEl = parseStatus;

	containerEl.appendChild(statusBar);

	// -- Wire events ------------------------------------------------
	refreshBtn.addEventListener('click', function() {
		FontRig.xmlRefresh();
	});

	applyBtn.addEventListener('click', function() {
		if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();
		_applyFromInstance(inst);
	});

	textarea.addEventListener('keydown', function(e) {
		if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
			e.preventDefault();
			if (typeof FontRig.pushUndo === 'function') FontRig.pushUndo();
			_applyFromInstance(inst);
		}
	});

	textarea.addEventListener('click', function() {
		var pos = textarea.selectionStart;
		var text = textarea.value.substring(0, pos);
		var lineIdx = text.split('\n').length - 1;
		var nodeId = inst._lineNodeMap[lineIdx];
		if (nodeId) {
			FontRig.state.selectedNodeIds.clear();
			FontRig.state.selectedNodeIds.add(nodeId);
			FontRig.draw();
			if (typeof FontRig.updateStatusSelected === 'function') {
				FontRig.updateStatusSelected();
			}
		}
	});

	// -- Attach public methods --------------------------------------
	inst.syncFromData = function() { _syncFromData(inst); };
	inst.setParseStatus = function(ok, msg) { _setParseStatus(inst, ok, msg); };
	inst.highlightNode = function(nodeId) { _highlightNode(inst, nodeId); };

	// -- Initial sync -----------------------------------------------
	_syncFromData(inst);

	return inst;
};

// ===================================================================
// Internal: sync textarea from current glyph data
// ===================================================================
function _syncFromData(inst) {
	if (!FontRig.state.rawXml) {
		inst._textareaEl.value = '';
		inst._nodeCountEl.textContent = '';
		return;
	}

	var formatted = FontRig.formatXml(FontRig.state.rawXml);
	inst._textareaEl.value = formatted;

	_rebuildLineMaps(inst, formatted);
	_updateNodeCount(inst);
	_setParseStatus(inst, true);
}

// ===================================================================
// Internal: apply from a specific instance's textarea
// ===================================================================
function _applyFromInstance(inst) {
	var xmlString = inst._textareaEl.value;

	try {
		var newGlyph = FontRig.parseGlyphXML(xmlString);

		FontRig.state.glyphData = newGlyph;
		FontRig.state.rawXml = xmlString;

		// Update layer selector
		var currentLayer = FontRig.state.activeLayer;
		FontRig.dom.layerSelect.innerHTML = '';
		for (var i = 0; i < newGlyph.layers.length; i++) {
			var layer = newGlyph.layers[i];
			var opt = document.createElement('option');
			opt.value = layer.name;
			opt.textContent = layer.name || '(unnamed)';
			FontRig.dom.layerSelect.appendChild(opt);
		}

		var found = false;
		for (var i = 0; i < newGlyph.layers.length; i++) {
			if (newGlyph.layers[i].name === currentLayer) { found = true; break; }
		}
		if (found) {
			FontRig.dom.layerSelect.value = currentLayer;
			FontRig.state.activeLayer = currentLayer;
		} else if (newGlyph.layers.length > 0) {
			FontRig.state.activeLayer = newGlyph.layers[0].name;
			FontRig.dom.layerSelect.value = FontRig.state.activeLayer;
		}

		var infoHtml = '<span>' + (newGlyph.name || '?') + '</span>';
		if (newGlyph.unicodes) infoHtml += ' U+' + newGlyph.unicodes;
		FontRig.dom.glyphInfo.innerHTML = infoHtml;

		// Sync all XML instances after apply
		FontRig.buildXmlPanel();
		FontRig.draw();

	} catch (e) {
		_setParseStatus(inst, false, 'Parse error');
	}
}

function _rebuildLineMaps(inst, text) {
	inst._lineNodeMap = {};
	inst._nodeLineMap = {};

	var lines = text.split('\n');
	var globalContourIdx = 0, nodeIdx = 0, inContour = false;

	for (var i = 0; i < lines.length; i++) {
		var line = lines[i].trim();
		if (line.indexOf('<contour') === 0) {
			inContour = true;
			nodeIdx = 0;
		} else if (line === '</contour>') {
			if (inContour) globalContourIdx++;
			inContour = false;
		} else if (inContour && line.indexOf('<node ') === 0) {
			var id = 'c' + globalContourIdx + '_n' + nodeIdx;
			inst._lineNodeMap[i] = id;
			inst._nodeLineMap[id] = i;
			nodeIdx++;
		}
	}

	// Also update global maps for backward compatibility
	FontRig.xmlLineNodeMap = inst._lineNodeMap;
	FontRig.xmlNodeLineMap = inst._nodeLineMap;
}

function _updateNodeCount(inst) {
	var layer = FontRig.getActiveLayer();
	if (layer) {
		var allNodes = FontRig.getAllNodes(layer);
		var onCount = allNodes.filter(function(n) { return n.type === 'on'; }).length;
		var offCount = allNodes.length - onCount;
		inst._nodeCountEl.textContent = onCount + ' on / ' + offCount + ' off';
	} else {
		inst._nodeCountEl.textContent = '';
	}
}

function _setParseStatus(inst, ok, msg) {
	var el = inst._parseStatusEl;
	if (ok) {
		el.textContent = 'OK';
		el.className = 'parse-status ok';
		inst._textareaEl.classList.remove('has-error');
	} else {
		el.textContent = msg || 'Error';
		el.className = 'parse-status error';
		inst._textareaEl.classList.add('has-error');
	}
}

function _highlightNode(inst, nodeId) {
	if (!nodeId) return;

	var lineIdx = inst._nodeLineMap[nodeId];
	if (lineIdx === undefined) return;

	var textarea = inst._textareaEl;
	var text = textarea.value;
	var lines = text.split('\n');

	var charStart = 0;
	for (var i = 0; i < lineIdx; i++) {
		charStart += lines[i].length + 1;
	}
	var charEnd = charStart + (lines[lineIdx] || '').length;

	textarea.focus();
	textarea.setSelectionRange(charStart, charEnd);

	var lineHeight = 12 * 1.65;
	var scrollTarget = lineIdx * lineHeight - textarea.clientHeight / 2;
	textarea.scrollTop = Math.max(0, scrollTarget);
}

// ===================================================================
// Legacy global API — delegates to all instances
// ===================================================================
// These functions maintain backward compatibility with code that
// calls FontRig.buildXmlPanel(), FontRig.xmlRefresh(), etc.
// They fan out to all mounted XML instances.
// ===================================================================

FontRig.buildXmlPanel = function() {
	if (!FontRig.state.rawXml) return;
	var SBC = FontRig.SidebarConfig;
	if (!SBC) return;
	SBC.forEachInstance('xml', function(inst) {
		inst.syncFromData();
	});
};

FontRig.rebuildLineMaps = function(text) {
	// Rebuild on all instances
	var SBC = FontRig.SidebarConfig;
	if (!SBC) return;
	SBC.forEachInstance('xml', function(inst) {
		_rebuildLineMaps(inst, text);
	});
};

FontRig.updateNodeCount = function() {
	var SBC = FontRig.SidebarConfig;
	if (!SBC) return;
	SBC.forEachInstance('xml', function(inst) {
		_updateNodeCount(inst);
	});
};

FontRig.setParseStatus = function(ok, msg) {
	var SBC = FontRig.SidebarConfig;
	if (!SBC) return;
	SBC.forEachInstance('xml', function(inst) {
		_setParseStatus(inst, ok, msg);
	});
};

FontRig.highlightXmlNode = function(nodeId) {
	if (!FontRig.state.showXml) return;
	var SBC = FontRig.SidebarConfig;
	if (!SBC) return;
	SBC.forEachInstance('xml', function(inst) {
		_highlightNode(inst, nodeId);
	});
};

FontRig.xmlRefresh = function() {
	if (!FontRig.state.glyphData) return;
	var newXml = FontRig.glyphToXml(FontRig.state.glyphData);
	FontRig.state.rawXml = newXml;
	FontRig.buildXmlPanel();
};

FontRig.xmlApply = function() {
	// Apply from the first available instance
	var SBC = FontRig.SidebarConfig;
	if (!SBC) return;
	var instances = SBC.getInstances('xml');
	if (instances.length > 0) {
		_applyFromInstance(instances[0]);
	}
};

// -- XML formatter (stateless, unchanged) ---------------------------
FontRig.formatXml = function(xml) {
	var result = '';
	var indent = 0;
	var tab = '  ';

	xml = xml.replace(/>\s*</g, '><').trim();

	var tokens = xml.match(/<[^>]+>|[^<]+/g) || [];

	for (var i = 0; i < tokens.length; i++) {
		var token = tokens[i];
		if (token.indexOf('<?') === 0) {
			result += tab.repeat(indent) + token + '\n';
		} else if (token.indexOf('</') === 0) {
			indent--;
			result += tab.repeat(Math.max(0, indent)) + token + '\n';
		} else if (token.indexOf('<') === 0 && token.indexOf('/>') === token.length - 2) {
			result += tab.repeat(indent) + token + '\n';
		} else if (token.indexOf('<') === 0) {
			result += tab.repeat(indent) + token + '\n';
			indent++;
		} else {
			var trimmed = token.trim();
			if (trimmed) result += tab.repeat(indent) + trimmed + '\n';
		}
	}

	return result.trimEnd();
};
