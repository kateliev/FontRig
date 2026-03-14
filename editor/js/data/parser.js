// ===================================================================
// FontRig — XML Parser
// ===================================================================
'use strict';

// -- Helpers --------------------------------------------------------

// Parse a transform matrix() attribute string: 'matrix(a b c d e f)'
// Returns a 6-element array or null if not a valid matrix string
FontRig.parseTransformAttr = function(str) {
	if (!str) return null;
	const m = str.match(/^matrix\(([^)]+)\)$/);
	if (!m) return null;
	const parts = m[1].trim().split(/\s+/).map(parseFloat);
	if (parts.length !== 6 || parts.some(isNaN)) return null;
	return parts;
};

// ------------------------------------------------------------------

FontRig.parseGlyphXML = function(xmlString) {
	const parser = new DOMParser();
	const doc = parser.parseFromString(xmlString, 'text/xml');
	const parseError = doc.querySelector('parsererror');
	if (parseError) throw new Error('XML parse error: ' + parseError.textContent);

	const glyphEl = doc.querySelector('glyph');
	if (!glyphEl) throw new Error('No <glyph> element found');

	const glyph = {
		name: glyphEl.getAttribute('name') || '',
		identifier: glyphEl.getAttribute('identifier') || '',
		unicodes: glyphEl.getAttribute('unicodes') || '',
		mark: parseInt(glyphEl.getAttribute('mark') || '0'),
		selected: glyphEl.getAttribute('selected') === 'True',
		layers: [],
	};

	for (const layerEl of glyphEl.querySelectorAll(':scope > layer')) {
		glyph.layers.push(FontRig.parseLayer(layerEl));
	}

	return glyph;
};

FontRig.parseLayer = function(el) {
	const layer = {
		name: el.getAttribute('name') || '',
		identifier: el.getAttribute('identifier') || '',
		width: parseFloat(el.getAttribute('width') || '0'),
		height: parseFloat(el.getAttribute('height') || '1000'),
		shapes: [],
		anchors: [],
		lib: {},
	};

	// stx/sty — compact: XML attribute; legacy fallback: lib
	const stxAttr = el.getAttribute('stx');
	const styAttr = el.getAttribute('sty');
	if (stxAttr !== null) layer.stx = parseFloat(stxAttr);
	if (styAttr !== null) layer.sty = parseFloat(styAttr);

	// Parse lib for any remaining custom data; also check legacy stx/sty in lib
	const libEl = el.querySelector(':scope > lib');
	if (libEl) {
		layer.lib = FontRig.parsePlistDict(libEl.querySelector('dict'));
		// Legacy: lib-stored stx/sty (only if not already set from attribute)
		if (layer.stx === undefined && layer.lib.stx !== undefined) layer.stx = layer.lib.stx;
		if (layer.sty === undefined && layer.lib.sty !== undefined) layer.sty = layer.lib.sty;
	}

	for (const shapeEl of el.querySelectorAll(':scope > shape')) {
		layer.shapes.push(FontRig.parseShape(shapeEl));
	}

	for (const anchorEl of el.querySelectorAll(':scope > anchor')) {
		layer.anchors.push({
			name: anchorEl.getAttribute('name') || '',
			x: parseFloat(anchorEl.getAttribute('x') || '0'),
			y: parseFloat(anchorEl.getAttribute('y') || '0'),
		});
	}

	return layer;
};

FontRig.parseShape = function(el) {
	const shape = {
		name: el.getAttribute('name') || '',
		identifier: el.getAttribute('identifier') || '',
		contours: [],
		lib: {},
		transform: null,
	};

	// transform — compact: matrix() attribute; legacy fallback: lib array
	const txAttr = el.getAttribute('transform');
	if (txAttr !== null) {
		shape.transform = FontRig.parseTransformAttr(txAttr);
	}

	const libEl = el.querySelector(':scope > lib');
	if (libEl) {
		shape.lib = FontRig.parsePlistDict(libEl.querySelector('dict'));
		// Legacy: lib-stored transform array
		if (shape.transform === null && Array.isArray(shape.lib.transform) && shape.lib.transform.length === 6) {
			shape.transform = shape.lib.transform;
		}
	}

	for (const contourEl of el.querySelectorAll(':scope > contour')) {
		shape.contours.push(FontRig.parseContour(contourEl));
	}

	return shape;
};

FontRig.parseContour = function(el) {
	const contour = {
		name: el.getAttribute('name') || '',
		identifier: el.getAttribute('identifier') || '',
		closed: false,  // default open — only written when true
		clockwise: null,
		nodes: [],
		lib: {},
	};

	// closed — compact: XML attribute; legacy fallback: lib bool
	const closedAttr = el.getAttribute('closed');
	if (closedAttr !== null) {
		contour.closed = closedAttr === 'True' || closedAttr === 'true' || closedAttr === '1';
	}

	// clockwise — compact: XML attribute; legacy fallback: lib bool
	const cwAttr = el.getAttribute('clockwise');
	if (cwAttr !== null) {
		contour.clockwise = cwAttr === 'True' || cwAttr === 'true' || cwAttr === '1';
	}

	const libEl = el.querySelector(':scope > lib');
	if (libEl) {
		const libData = FontRig.parsePlistDict(libEl.querySelector('dict'));
		// Legacy: lib-stored closed/clockwise (only if not already set from attribute)
		if (closedAttr === null && libData.closed !== undefined) contour.closed = libData.closed;
		if (cwAttr === null && libData.clockwise !== undefined) contour.clockwise = libData.clockwise;
		contour.lib = libData;
	}

	for (const nodeEl of el.querySelectorAll(':scope > node')) {
		contour.nodes.push({
			x: parseFloat(nodeEl.getAttribute('x') || '0'),
			y: parseFloat(nodeEl.getAttribute('y') || '0'),
			type: nodeEl.getAttribute('type') || 'on',
			smooth: nodeEl.getAttribute('smooth') === 'True',
		});
	}

	return contour;
};

FontRig.parsePlistDict = function(dictEl) {
	if (!dictEl) return {};
	const result = {};
	const children = Array.from(dictEl.children);
	let i = 0;
	while (i < children.length) {
		if (children[i].tagName === 'key') {
			const key = children[i].textContent;
			i++;
			if (i < children.length) {
				result[key] = FontRig.parsePlistValue(children[i]);
			}
		}
		i++;
	}
	return result;
};

FontRig.parsePlistValue = function(el) {
	switch (el.tagName) {
		case 'true': return true;
		case 'false': return false;
		case 'integer': return parseInt(el.textContent);
		case 'real': return parseFloat(el.textContent);
		case 'string': return el.textContent || '';
		case 'array': return Array.from(el.children).map(FontRig.parsePlistValue);
		case 'dict': return FontRig.parsePlistDict(el);
		default: return null;
	}
};
