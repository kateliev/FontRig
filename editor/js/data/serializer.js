// ===================================================================
// FontRig — XML Serializer
// ===================================================================
// Note: live XML sync removed. Use FontRig.xmlRefresh() to regenerate
// XML from data, and FontRig.xmlApply() to parse XML back into data.
// ===================================================================
'use strict';

// -- XML escape -----------------------------------------------------
FontRig.esc = function(s) {
	return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

// -- Compact float: drop .0 for integers, strip trailing zeros ------
FontRig.fmtFloat = function(v) {
	if (Number.isInteger(v)) return String(v);
	// Up to 6 decimal places, strip trailing zeros
	return parseFloat(v.toFixed(6)).toString();
};

// -- Format a 6-element transform array as matrix() string ----------
// Returns null when the transform is identity (skip writing)
FontRig.fmtTransform = function(t) {
	if (!Array.isArray(t) || t.length !== 6) return null;
	// Identity check: [1, 0, 0, 1, 0, 0]
	if (t[0] === 1 && t[1] === 0 && t[2] === 0 && t[3] === 1 && t[4] === 0 && t[5] === 0) return null;
	return 'matrix(' + t.map(FontRig.fmtFloat).join(' ') + ')';
};

// -- Glyph to XML ----------------------------------------------------
FontRig.glyphToXml = function(glyph) {
	var xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
	xml += '<glyph name="' + FontRig.esc(glyph.name) + '"';
	if (glyph.identifier) xml += ' identifier="' + FontRig.esc(glyph.identifier) + '"';
	if (glyph.unicodes) xml += ' unicodes="' + FontRig.esc(glyph.unicodes) + '"';
	if (glyph.selected) xml += ' selected="True"';
	if (glyph.mark) xml += ' mark="' + FontRig.esc(glyph.mark) + '"';
	xml += '>\n';

	for (var i = 0; i < glyph.layers.length; i++) {
		xml += FontRig.layerToXml(glyph.layers[i], '  ');
	}

	xml += '</glyph>';
	return xml;
};

FontRig.layerToXml = function(layer, indent) {
	var xml = indent + '<layer name="' + FontRig.esc(layer.name) + '"';
	if (layer.identifier) xml += ' identifier="' + FontRig.esc(layer.identifier) + '"';
	xml += ' width="' + layer.width + '" height="' + layer.height + '"';
	// stx/sty as direct attributes, only when present
	if (layer.stx !== undefined && layer.stx !== null) xml += ' stx="' + FontRig.fmtFloat(layer.stx) + '"';
	if (layer.sty !== undefined && layer.sty !== null) xml += ' sty="' + FontRig.fmtFloat(layer.sty) + '"';
	xml += '>\n';

	for (var si = 0; si < layer.shapes.length; si++) {
		xml += FontRig.shapeToXml(layer.shapes[si], indent + '  ');
	}

	if (layer.anchors) {
		for (var ai = 0; ai < layer.anchors.length; ai++) {
			var a = layer.anchors[ai];
			xml += indent + '  <anchor name="' + FontRig.esc(a.name) + '" x="' + a.x + '" y="' + a.y + '"/>\n';
		}
	}

	// Only write lib for truly custom data
	var libData = {};
	var libSrc = layer.lib || {};
	for (var k in libSrc) {
		if (k !== 'stx' && k !== 'sty') libData[k] = libSrc[k];
	}
	if (Object.keys(libData).length > 0) {
		xml += FontRig.plistLibToXml(libData, indent + '  ');
	}

	xml += indent + '</layer>\n';
	return xml;
};

FontRig.shapeToXml = function(shape, indent) {
	var xml = indent + '<shape';
	if (shape.name) xml += ' name="' + FontRig.esc(shape.name) + '"';
	if (shape.identifier) xml += ' identifier="' + FontRig.esc(shape.identifier) + '"';
	// transform as matrix() attribute, skipped when identity or absent
	var tx = FontRig.fmtTransform(shape.transform);
	if (tx) xml += ' transform="' + FontRig.esc(tx) + '"';
	xml += '>\n';

	for (var ci = 0; ci < shape.contours.length; ci++) {
		xml += FontRig.contourToXml(shape.contours[ci], indent + '  ');
	}

	// Only write lib for truly custom data
	var libData = {};
	var libSrc = shape.lib || {};
	for (var k in libSrc) {
		if (k !== 'transform') libData[k] = libSrc[k];
	}
	if (Object.keys(libData).length > 0) {
		xml += FontRig.plistLibToXml(libData, indent + '  ');
	}

	xml += indent + '</shape>\n';
	return xml;
};

FontRig.contourToXml = function(contour, indent) {
	var kind = contour.kind || FontRig.CONTOUR_KIND_BEZIER || 'bezier';

	var xml = indent + '<contour';
	if (contour.name) xml += ' name="' + FontRig.esc(contour.name) + '"';
	if (contour.identifier) xml += ' identifier="' + FontRig.esc(contour.identifier) + '"';
	// kind is always written explicitly so reads never have to guess.
	xml += ' kind="' + FontRig.esc(kind) + '"';
	// closed only written when true (false is default)
	if (contour.closed) xml += ' closed="True"';
	// clockwise only written when not null
	if (contour.clockwise !== null && contour.clockwise !== undefined) {
		xml += ' clockwise="' + (contour.clockwise ? 'True' : 'False') + '"';
	}
	xml += '>\n';

	if (kind === 'hobby') {
		// Hobby: persist knots only. No bezier shadow is written.
		var knots = contour.knots || [];
		for (var ki = 0; ki < knots.length; ki++) {
			xml += FontRig.knotToXml(knots[ki], indent + '  ');
		}
	} else {
		// Bezier (default).
		for (var ni = 0; ni < contour.nodes.length; ni++) {
			var node = contour.nodes[ni];
			xml += indent + '  <node x="' + node.x + '" y="' + node.y + '" type="' + node.type + '"';
			if (node.smooth) xml += ' smooth="True"';
			xml += '/>\n';
		}
	}

	// Only write lib for truly custom data
	var libData = {};
	var libSrc = contour.lib || {};
	for (var k in libSrc) {
		if (k !== 'closed' && k !== 'clockwise') libData[k] = libSrc[k];
	}
	if (Object.keys(libData).length > 0) {
		xml += FontRig.plistLibToXml(libData, indent + '  ');
	}

	xml += indent + '</contour>\n';
	return xml;
};

// Serialize a single hobby knot. Defaults (segment_type='hobby',
// alpha=1.0, beta=1.0, dir_in/dir_out=null) are skipped to keep the
// emitted XML compact and to match TypeRig core's HobbyKnot output.
FontRig.knotToXml = function(knot, indent) {
	var xml = indent + '<knot x="' + FontRig.fmtFloat(knot.x) + '" y="' + FontRig.fmtFloat(knot.y) + '"';

	var seg = knot.segment_type || 'hobby';
	if (seg !== 'hobby') xml += ' segment_type="' + FontRig.esc(seg) + '"';

	if (knot.alpha !== undefined && knot.alpha !== null && knot.alpha !== 1.0) {
		xml += ' alpha="' + FontRig.fmtFloat(knot.alpha) + '"';
	}
	if (knot.beta !== undefined && knot.beta !== null && knot.beta !== 1.0) {
		xml += ' beta="' + FontRig.fmtFloat(knot.beta) + '"';
	}

	if (knot.dir_in !== undefined && knot.dir_in !== null) {
		xml += ' dir_in="' + FontRig.fmtFloat(knot.dir_in) + '"';
	}
	if (knot.dir_out !== undefined && knot.dir_out !== null) {
		xml += ' dir_out="' + FontRig.fmtFloat(knot.dir_out) + '"';
	}

	if (knot.fixed_bcp_out_x !== undefined && knot.fixed_bcp_out_x !== null
		&& knot.fixed_bcp_out_y !== undefined && knot.fixed_bcp_out_y !== null) {
		xml += ' bcp_out="' + FontRig.fmtFloat(knot.fixed_bcp_out_x) + ',' + FontRig.fmtFloat(knot.fixed_bcp_out_y) + '"';
	}
	if (knot.fixed_bcp_in_x !== undefined && knot.fixed_bcp_in_x !== null
		&& knot.fixed_bcp_in_y !== undefined && knot.fixed_bcp_in_y !== null) {
		xml += ' bcp_in="' + FontRig.fmtFloat(knot.fixed_bcp_in_x) + ',' + FontRig.fmtFloat(knot.fixed_bcp_in_y) + '"';
	}

	xml += '/>\n';
	return xml;
};

FontRig.plistLibToXml = function(data, indent) {
	var xml = indent + '<lib>\n' + indent + '  <dict>\n';
	for (var key in data) {
		xml += indent + '    <key>' + FontRig.esc(key) + '</key>\n';
		xml += indent + '    ' + FontRig.plistValueToXml(data[key]) + '\n';
	}
	xml += indent + '  </dict>\n' + indent + '</lib>\n';
	return xml;
};

FontRig.plistValueToXml = function(val) {
	if (val === true) return '<true/>';
	if (val === false) return '<false/>';
	if (typeof val === 'number') {
		return Number.isInteger(val) ? '<integer>' + val + '</integer>' : '<real>' + FontRig.fmtFloat(val) + '</real>';
	}
	if (typeof val === 'string') return '<string>' + FontRig.esc(val) + '</string>';
	if (Array.isArray(val)) {
		if (val.length === 0) return '<array/>';
		var xml = '<array>';
		for (var i = 0; i < val.length; i++) xml += FontRig.plistValueToXml(val[i]);
		xml += '</array>';
		return xml;
	}
	return '<string>' + FontRig.esc(String(val)) + '</string>';
};

// -- Sync glyph data to XML (kept for programmatic use) -------------
// Called by xmlRefresh button and after Python sync.
// No longer called during drag or editing.
FontRig.syncXmlFromData = function() {
	if (!FontRig.state.glyphData) return;
	var newXml = FontRig.glyphToXml(FontRig.state.glyphData);
	FontRig.state.rawXml = newXml;

	// Update all XML panel instances when visible
	if (FontRig.state.showXml) {
		FontRig.buildXmlPanel();
	}
};
