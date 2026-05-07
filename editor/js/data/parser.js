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
		mark: glyphEl.getAttribute('mark') || '',
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

// Default contour kind when the attribute is absent. Legacy files
// (pre-Hobby) have no `kind` and must continue to load as bezier.
FontRig.CONTOUR_KIND_BEZIER = 'bezier';
FontRig.CONTOUR_KIND_HOBBY = 'hobby';

FontRig.parseContour = function(el) {
	const kindAttr = el.getAttribute('kind');
	const kind = kindAttr || FontRig.CONTOUR_KIND_BEZIER;

	const contour = {
		name: el.getAttribute('name') || '',
		identifier: el.getAttribute('identifier') || '',
		kind: kind,
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

	if (kind === FontRig.CONTOUR_KIND_HOBBY) {
		// Hobby contour: knots are the source of truth. Bezier nodes
		// are recomputed from knots at render/export time and never
		// persisted, so .nodes stays empty here.
		contour.knots = [];
		for (const knotEl of el.querySelectorAll(':scope > knot')) {
			contour.knots.push(FontRig.parseKnot(knotEl));
		}
	} else {
		// Bezier (default).
		for (const nodeEl of el.querySelectorAll(':scope > node')) {
			contour.nodes.push({
				x: parseFloat(nodeEl.getAttribute('x') || '0'),
				y: parseFloat(nodeEl.getAttribute('y') || '0'),
				type: nodeEl.getAttribute('type') || 'on',
				smooth: nodeEl.getAttribute('smooth') === 'True',
			});
		}
	}

	return contour;
};

// Parse a <knot> element. Mirrors typerig.core.objects.hobbyspline
// HobbyKnot's XML schema: x, y are required; segment_type, alpha,
// beta default to 'hobby' / 1.0 / 1.0; dir_in/dir_out default to
// null (solver-free).
FontRig.parseKnot = function(el) {
	const knot = {
		x: parseFloat(el.getAttribute('x') || '0'),
		y: parseFloat(el.getAttribute('y') || '0'),
		segment_type: el.getAttribute('segment_type') || 'hobby',
		alpha: 1.0,
		beta: 1.0,
		dir_in: null,
		dir_out: null,
	};

	const a = el.getAttribute('alpha');
	if (a !== null) knot.alpha = parseFloat(a);
	const b = el.getAttribute('beta');
	if (b !== null) knot.beta = parseFloat(b);

	const di = el.getAttribute('dir_in');
	if (di !== null) knot.dir_in = parseFloat(di);
	const dout = el.getAttribute('dir_out');
	if (dout !== null) knot.dir_out = parseFloat(dout);

	return knot;
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
