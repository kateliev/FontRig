// ===================================================================
// FontRig — XML Panel
// ===================================================================
// XML sync model: manual Refresh (data→XML) and Apply (XML→data).
// No live sync during editing — canvas is the source of truth.
// Node selection → XML highlight is kept (one direction only).
// ===================================================================
'use strict';

FontRig.buildXmlPanel = function() {
	if (!FontRig.state.rawXml) {
		FontRig.dom.xmlContent.value = '';
		FontRig.dom.xmlNodeCount.textContent = '';
		return;
	}

	const formatted = FontRig.formatXml(FontRig.state.rawXml);
	FontRig.dom.xmlContent.value = formatted;

	FontRig.rebuildLineMaps(formatted);
	FontRig.updateNodeCount();
	FontRig.setParseStatus(true);
};

FontRig.rebuildLineMaps = function(text) {
	FontRig.xmlLineNodeMap = {};
	FontRig.xmlNodeLineMap = {};

	const lines = text.split('\n');
	let globalContourIdx = 0;
	let nodeIdx = 0;
	let inContour = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();

		if (line.startsWith('<contour')) {
			inContour = true;
			nodeIdx = 0;
		} else if (line === '</contour>') {
			if (inContour) globalContourIdx++;
			inContour = false;
		} else if (inContour && line.startsWith('<node ')) {
			const id = `c${globalContourIdx}_n${nodeIdx}`;
			FontRig.xmlLineNodeMap[i] = id;
			FontRig.xmlNodeLineMap[id] = i;
			nodeIdx++;
		}
	}
};

FontRig.updateNodeCount = function() {
	const layer = FontRig.getActiveLayer();
	if (layer) {
		const allNodes = FontRig.getAllNodes(layer);
		const onCount = allNodes.filter(n => n.type === 'on').length;
		const offCount = allNodes.length - onCount;
		FontRig.dom.xmlNodeCount.textContent = `${onCount} on / ${offCount} off`;
	} else {
		FontRig.dom.xmlNodeCount.textContent = '';
	}
};

FontRig.setParseStatus = function(ok, msg) {
	const el = FontRig.dom.parseStatus;
	if (ok) {
		el.textContent = 'OK';
		el.className = 'parse-status ok';
		FontRig.dom.xmlContent.classList.remove('has-error');
	} else {
		el.textContent = msg || 'Error';
		el.className = 'parse-status error';
		FontRig.dom.xmlContent.classList.add('has-error');
	}
};

// Highlight first selected node in XML textarea (for multi-selection,
// scroll to first; all are conceptually selected).
// Direction: canvas → XML (one way only)
FontRig.highlightXmlNode = function(nodeId) {
	if (!FontRig.state.showXml) return;
	if (!nodeId) return;

	const lineIdx = FontRig.xmlNodeLineMap[nodeId];
	if (lineIdx === undefined) return;

	const textarea = FontRig.dom.xmlContent;
	const text = textarea.value;
	const lines = text.split('\n');

	let charStart = 0;
	for (let i = 0; i < lineIdx; i++) {
		charStart += lines[i].length + 1;
	}
	const charEnd = charStart + (lines[lineIdx] || '').length;

	textarea.focus();
	textarea.setSelectionRange(charStart, charEnd);

	const lineHeight = 12 * 1.65;
	const scrollTarget = lineIdx * lineHeight - textarea.clientHeight / 2;
	textarea.scrollTop = Math.max(0, scrollTarget);
};

// -- Refresh: glyph data → XML textarea -----------------------------
// Regenerates XML from the current in-memory glyph, replacing
// whatever is in the textarea. Called by Refresh button.
FontRig.xmlRefresh = function() {
	if (!FontRig.state.glyphData) return;
	const newXml = FontRig.glyphToXml(FontRig.state.glyphData);
	FontRig.state.rawXml = newXml;

	const formatted = FontRig.formatXml(newXml);
	FontRig.dom.xmlContent.value = formatted;
	FontRig.rebuildLineMaps(formatted);
	FontRig.updateNodeCount();
	FontRig.setParseStatus(true);
};

// -- Apply: XML textarea → glyph data ------------------------------
// Parses the textarea content and replaces the in-memory glyph.
// Called by Apply button or Ctrl+Enter in the XML textarea.
FontRig.xmlApply = function() {
	const xmlString = FontRig.dom.xmlContent.value;

	try {
		const newGlyph = FontRig.parseGlyphXML(xmlString);

		FontRig.state.glyphData = newGlyph;
		FontRig.state.rawXml = xmlString;

		// Update layer selector if layers changed
		const currentLayer = FontRig.state.activeLayer;
		FontRig.dom.layerSelect.innerHTML = '';
		for (const layer of newGlyph.layers) {
			const opt = document.createElement('option');
			opt.value = layer.name;
			opt.textContent = layer.name || '(unnamed)';
			FontRig.dom.layerSelect.appendChild(opt);
		}

		if (newGlyph.layers.find(l => l.name === currentLayer)) {
			FontRig.dom.layerSelect.value = currentLayer;
			FontRig.state.activeLayer = currentLayer;
		} else if (newGlyph.layers.length > 0) {
			FontRig.state.activeLayer = newGlyph.layers[0].name;
			FontRig.dom.layerSelect.value = FontRig.state.activeLayer;
		}

		let infoHtml = `<span>${newGlyph.name || '?'}</span>`;
		if (newGlyph.unicodes) infoHtml += ` U+${newGlyph.unicodes}`;
		FontRig.dom.glyphInfo.innerHTML = infoHtml;

		FontRig.rebuildLineMaps(xmlString);
		FontRig.updateNodeCount();
		FontRig.setParseStatus(true);
		FontRig.draw();

	} catch (e) {
		FontRig.setParseStatus(false, 'Parse error');
	}
};

// -- XML formatter --------------------------------------------------
FontRig.formatXml = function(xml) {
	let result = '';
	let indent = 0;
	const tab = '  ';

	xml = xml.replace(/>\s*</g, '><').trim();

	const tokens = xml.match(/<[^>]+>|[^<]+/g) || [];

	for (const token of tokens) {
		if (token.startsWith('<?')) {
			// Processing instruction — no indent change
			result += tab.repeat(indent) + token + '\n';
		} else if (token.startsWith('</')) {
			indent--;
			result += tab.repeat(Math.max(0, indent)) + token + '\n';
		} else if (token.startsWith('<') && token.endsWith('/>')) {
			result += tab.repeat(indent) + token + '\n';
		} else if (token.startsWith('<')) {
			result += tab.repeat(indent) + token + '\n';
			indent++;
		} else {
			const trimmed = token.trim();
			if (trimmed) result += tab.repeat(indent) + trimmed + '\n';
		}
	}

	return result.trimEnd();
};
