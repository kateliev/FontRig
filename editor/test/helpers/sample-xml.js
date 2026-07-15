// Extract the sample glyph XML string embedded in editor/js/sample.js
// (a `const sampleXml = ` template literal) so tests can parse it
// without executing the browser-only loadSampleGlyph() path.
'use strict';

var fs = require('fs');
var path = require('path');

function sampleXml() {
	var src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'sample.js'), 'utf8');
	var start = src.indexOf('`', src.indexOf('sampleXml'));
	var end = src.indexOf('`', start + 1);
	if (start === -1 || end === -1) throw new Error('sample XML not found in sample.js');
	return src.slice(start + 1, end);
}

module.exports = { sampleXml: sampleXml };
