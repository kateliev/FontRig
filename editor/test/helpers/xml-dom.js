// ===================================================================
// Minimal XML DOM shim for the Node test harness
// ===================================================================
// The FontRig parser (editor/js/data/parser.js) relies on the browser
// DOMParser + a small slice of the DOM API (getAttribute, children,
// tagName, textContent, and querySelector/querySelectorAll limited to
// ':scope > tag' and bare descendant tag selectors). Node has no DOM,
// and the audit plan (M8) forbids npm dependencies, so this file
// provides a self-contained XML parser + just-enough DOM surface.
//
// Supported: elements, attributes (single/double quoted), self-closing
// tags, text content, comments, the <?xml ...?> declaration, and the
// five XML entities. Not a general-purpose parser — scoped to .trglyph.
'use strict';

var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s) {
	return s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, function(m, body) {
		if (body[0] === '#') {
			var code = body[1] === 'x' || body[1] === 'X'
				? parseInt(body.slice(2), 16)
				: parseInt(body.slice(1), 10);
			return isNaN(code) ? m : String.fromCodePoint(code);
		}
		return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : m;
	});
}

function XmlNode(tagName) {
	this.tagName = tagName;
	this.attributes = {};
	this.children = [];   // element children only (DOM-like)
	this._text = '';      // direct text accumulated for this element
}

Object.defineProperty(XmlNode.prototype, 'textContent', {
	get: function() {
		var out = this._text;
		for (var i = 0; i < this.children.length; i++) {
			out += this.children[i].textContent;
		}
		return out;
	}
});

XmlNode.prototype.getAttribute = function(name) {
	return Object.prototype.hasOwnProperty.call(this.attributes, name)
		? this.attributes[name] : null;
};

XmlNode.prototype._descendants = function() {
	var out = [];
	for (var i = 0; i < this.children.length; i++) {
		out.push(this.children[i]);
		var sub = this.children[i]._descendants();
		for (var j = 0; j < sub.length; j++) out.push(sub[j]);
	}
	return out;
};

function parseSelector(sel) {
	sel = sel.trim();
	if (sel.indexOf(':scope') === 0) {
		return { scope: true, tag: sel.slice(6).replace(/^\s*>\s*/, '').trim() };
	}
	return { scope: false, tag: sel };
}

XmlNode.prototype.querySelectorAll = function(sel) {
	var q = parseSelector(sel);
	var pool = q.scope ? this.children : this._descendants();
	var out = [];
	for (var i = 0; i < pool.length; i++) {
		if (pool[i].tagName === q.tag) out.push(pool[i]);
	}
	return out;
};

XmlNode.prototype.querySelector = function(sel) {
	var all = this.querySelectorAll(sel);
	return all.length ? all[0] : null;
};

// -- Tokenizing parser ----------------------------------------------
function parseXml(src) {
	var root = new XmlNode('#document');
	var stack = [root];
	var i = 0;
	var n = src.length;

	function top() { return stack[stack.length - 1]; }

	while (i < n) {
		var lt = src.indexOf('<', i);
		if (lt === -1) break;
		// Text before this tag
		if (lt > i) {
			var txt = src.slice(i, lt);
			if (txt.trim().length) top()._text += decodeEntities(txt);
		}
		if (src.slice(lt, lt + 4) === '<!--') {
			var end = src.indexOf('-->', lt + 4);
			i = end === -1 ? n : end + 3;
			continue;
		}
		if (src.slice(lt, lt + 2) === '<?') {
			var qend = src.indexOf('?>', lt + 2);
			i = qend === -1 ? n : qend + 2;
			continue;
		}
		if (src.slice(lt, lt + 2) === '<!') {
			// DOCTYPE / other declarations — skip to '>'
			var dend = src.indexOf('>', lt + 2);
			i = dend === -1 ? n : dend + 1;
			continue;
		}
		var gt = src.indexOf('>', lt);
		if (gt === -1) break;
		var raw = src.slice(lt + 1, gt).trim();
		if (raw[0] === '/') {
			// Close tag
			stack.pop();
			i = gt + 1;
			continue;
		}
		var selfClose = raw[raw.length - 1] === '/';
		if (selfClose) raw = raw.slice(0, -1).trim();

		// Tag name + attributes
		var sp = raw.search(/\s/);
		var tag = sp === -1 ? raw : raw.slice(0, sp);
		var el = new XmlNode(tag);
		if (sp !== -1) {
			var attrStr = raw.slice(sp);
			var re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
			var m;
			while ((m = re.exec(attrStr))) {
				el.attributes[m[1]] = decodeEntities(m[3] !== undefined ? m[3] : m[4]);
			}
		}
		top().children.push(el);
		if (!selfClose) stack.push(el);
		i = gt + 1;
	}
	return root;
}

function XmlDocument(root) { this._root = root; }
XmlDocument.prototype.querySelector = function(sel) {
	// Document-level search includes the root element itself.
	var q = parseSelector(sel);
	var pool = [this._root].concat(this._root._descendants());
	for (var i = 0; i < pool.length; i++) {
		if (pool[i].tagName === q.tag) return pool[i];
	}
	return null;
};
XmlDocument.prototype.querySelectorAll = function(sel) {
	var q = parseSelector(sel);
	var pool = [this._root].concat(this._root._descendants());
	var out = [];
	for (var i = 0; i < pool.length; i++) {
		if (pool[i].tagName === q.tag) out.push(pool[i]);
	}
	return out;
};

function DOMParser() {}
DOMParser.prototype.parseFromString = function(str /*, type */) {
	var doc = parseXml(str);
	// The real document's first element child is the root element.
	var rootEl = doc.children[0] || new XmlNode('#empty');
	return new XmlDocument(rootEl);
};

module.exports = { DOMParser: DOMParser, parseXml: parseXml };
