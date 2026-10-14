// ===================================================================
// FontRig — Delta Live Edit (canvas controls of the Delta panel)
// ===================================================================
// JS port of TypeRig's TRDeltaCanvas (FontLab DeltaNew.py): the Live
// Axis controls drawn on the glyph. The tool owns no values: it reads
// the panel's live state and writes through the panel (liveSet), which
// drives Python (npa_delta_live_drive). One pipeline, as in FontLab —
// the canvas and the panel sliders cannot disagree.
//
//   frame quad (8)  width / height about the transform origin; a
//                   parallelogram in italic (setup italic_angle)
//   stem ring (4)   L/R: vertical stem, T/B: horizontal, in units
//                   (radius x stem / seed stem of the active layer)
//   origin cross    snaps to baseline (0, 0) and the 9 frame points
//   icon strip      close, recapture, axis reset, metrics, anchors
//
// Width is affine in %, not proportional (stems are compensated):
// frame drags start from the proportional guess and refine by secant
// on the measured output (EdgeSecant), at most MAX_CORRECTIONS extra
// drives per push.
//
// Capture lifecycle (the panel decides; the tool only detects):
//   glyph or layer change  -> panel.liveCapture()   (layer: keeps axis)
//   outside node edit/undo -> panel.liveRecapture()
//   selection change       -> panel.liveRecapture() (selection = mode)
//   own writes             -> panel calls panelWrote() (not outside)
//
// Panel interface (delta-panel.js instance):
//   liveState() liveProblem() liveSet(values) liveCapture()
//   liveRecapture() liveReset() liveToggle(option) liveClosed() isAlive()
//
// Wiring: hit test + drag in stream-handlers.js handleCanvasDrag,
// hover in handleCanvasHover, drawing via the 'deltaLive' viz layer.
// ===================================================================
'use strict';

(function() {

var M = FontRig.deltaLiveMath;

var DL = FontRig.deltaLive = {
	PAD_PX:            16,		// frame quad sits this far outside the output frame
	HANDLE_R:          6,
	RING_R:            5.5,
	ORIGIN_R:          7,
	STEM_RING_PX:      [40, 110],	// ring radius range on screen (before following the scale)
	STRIP_OFFSET_PX:   22,		// icon strip: diagonal offset from the top-right handle
	STRIP_SLOT_PX:     24,
	STRIP_R:           9,
	STRIP_ICON_PX:     14,
	HIT_TOL:           3,
	DRAG_THRESHOLD_PX: 2,
	PUSH_INTERVAL_MS:  33,		// at most one drive per interval during a drag
	MAX_CORRECTIONS:   2,		// secant re-drives per push (frame drags)
	TICK_MS:           150,		// change detection (target, outline, selection)
	LIMITS:            { scale: [0.1, 9.99], stem: [0.05, 5] },

	active:   false,
	panel:    null,			// the Delta panel instance driving the tool
	st:       null,			// panel.liveState() (params overridden during a drag)
	applied:  null,			// params as the panel holds them
	problem:  null,			// panel.liveProblem() while st is null
	dragging: false,

	_press: null, _dragParams: null, _models: {}, _dragKey: null, _cancelled: false,
	_pending: null, _pendingTimer: null, _lastPush: 0, _originView: null,
	_hoverKey: null, _sigGeom: null, _sigSel: null, _lastTarget: null,
	_stateKey: null, _timer: null,
};

var CURSORS = {
	'-1,1': 'nwse-resize', '1,-1': 'nwse-resize', '1,1': 'nesw-resize', '-1,-1': 'nesw-resize',
	'0,1': 'ns-resize', '0,-1': 'ns-resize', '1,0': 'ew-resize', '-1,0': 'ew-resize',
};

var RING_POINTS = [['T', 0, 1], ['R', 1, 0], ['B', 0, -1], ['L', -1, 0]];

// Icon strip entries: [key, icon (TypeRig Icons ligature; null = close
// cross), tooltip, action, always]. always=false entries show only while
// the tool is ready. Adding an icon is adding one entry.
DL.STRIP = [
	['close',     null,                  'Close Live Edit', function() { DL._close(); }, true],
	['recapture', 'refresh',             'Recapture: rebuild the Live Axis from the current outline', function() { DL._recapture(); }, true],
	['reset',     'axis_remove',         'Axis reset: neutral controls for this layer', function() { DL._call('liveReset'); DL._rebaseline(); DL.refresh(); }, false],
	['metrics',   'metrics_advance_alt', '', function() { DL._toggle('metrics'); }, false],
	['anchors',   'icon_anchor',         '', function() { DL._toggle('anchors'); }, false],
];

// - Host helpers (tolerate a headless load) --------------------------
function withOffset(fn) {
	if (typeof FontRig._withActiveOffset === 'function') FontRig._withActiveOffset(fn);
	else fn();
}

function interactionCoords(sx, sy) {
	return typeof FontRig._interactionCoords === 'function' ? FontRig._interactionCoords(sx, sy) : { sx: sx, sy: sy };
}

function requestDraw() {
	if (typeof FontRig.requestDraw === 'function') FontRig.requestDraw();
}

function sameTarget(a, b) {
	return !!a && !!b && a[0] === b[0] && a[1] === b[1];
}

function copy(o) {
	return Object.assign({}, o);
}

// - Lifecycle -------------------------------------------------------
DL.start = function(panel) {
	if (DL.panel && DL.panel !== panel) DL._call('liveClosed');		// another panel instance held it
	DL.stop();
	DL.panel = panel;
	DL.active = true;
	DL.refresh();
	DL._rebaseline();
	if (typeof setInterval === 'function') DL._timer = setInterval(DL._tick, DL.TICK_MS);
	requestDraw();
};

DL.stop = function() {
	if (DL._timer) clearInterval(DL._timer);
	if (DL._pendingTimer) clearTimeout(DL._pendingTimer);
	DL._timer = DL._pendingTimer = null;
	DL.active = false;
	DL.panel = DL.st = DL.applied = DL.problem = null;
	DL.dragging = false;
	DL._press = DL._dragParams = DL._pending = DL._originView = DL._hoverKey = DL._dragKey = null;
	DL._models = {};
	DL._stateKey = null;
	requestDraw();
};

DL._call = function(name) {
	var panel = DL.panel;
	if (!panel || typeof panel[name] !== 'function') return null;
	try {
		return panel[name].apply(panel, Array.prototype.slice.call(arguments, 1));
	} catch (e) {
		console.warn('[DeltaLive] ' + name + ' failed:', e);
		return null;
	}
};

// - Panel link ------------------------------------------------------
DL.refresh = function() {
	if (!DL.active) return;
	var st = DL._call('liveState') || null;
	DL.applied = st ? copy(st.params) : null;
	DL.problem = st ? null : (DL._call('liveProblem') || 'nothing captured');

	if (st && DL._dragParams) {
		st = copy(st);
		st.params = copy(DL._dragParams);
	}
	DL.st = st;

	// Repaint when the panel changed something (sliders, options)
	var key = JSON.stringify(st ? [st.target, st.frame, st.selection, st.params, st.options, st.process, st.warnings] : [DL.problem]);
	if (key !== DL._stateKey) {
		DL._stateKey = key;
		requestDraw();
	}
};

// Called by the panel after every live write: our own edit, not an outside one.
DL.panelWrote = function() {
	if (!DL.active) return;
	try {
		DL._rebaseline();
		DL.refresh();
		requestDraw();
	} catch (e) {
		console.warn('[DeltaLive] panelWrote failed:', e);
	}
};

DL.target = function() {
	var g = FontRig.state.glyphData;
	return g ? [g.name, FontRig.state.activeLayer || null] : null;
};

DL.ready = function() {
	return !!DL.st && sameTarget(DL.target(), DL.st.target);
};

// - Change detection ------------------------------------------------
DL._geomSig = function() {
	var layer = typeof FontRig.getActiveLayer === 'function' ? FontRig.getActiveLayer() : null;
	if (!layer) return null;
	var h = 0, n = 0;
	(layer.shapes || []).forEach(function(shape) {
		(shape.contours || []).forEach(function(contour) {
			(contour.nodes || []).forEach(function(node) {
				h = (Math.imul(h, 31) + Math.round(node.x * 100)) | 0;
				h = (Math.imul(h, 31) + Math.round(node.y * 100)) | 0;
				n++;
			});
		});
	});
	return n + ':' + h;
};

DL._selSig = function() {
	return Array.from(FontRig.state.selectedNodeIds || []).sort().join(',');
};

DL._rebaseline = function() {
	DL._sigGeom = DL._geomSig();
	DL._sigSel = DL._selSig();
	DL._lastTarget = DL.target();
};

DL._tick = function() {
	try {
		if (!DL.active) return;
		if (!DL._call('isAlive')) { DL.stop(); return; }		// the panel is gone
		if (DL.dragging || DL._pending) return;
		// A FontRig drag (node move, marquee) is in progress: judge it when it ends
		if (FontRig._mouseTracker && FontRig._mouseTracker._stream) return;

		var tgt = DL.target();
		if (!sameTarget(tgt, DL._lastTarget)) {
			DL._lastTarget = tgt;
			if (tgt) {
				DL._call('liveCapture');		// layer switch keeps the axis; glyph switch captures
				DL._rebaseline();
				DL.refresh();
				return;
			}
		}

		if (DL.ready() && (DL._geomSig() !== DL._sigGeom || DL._selSig() !== DL._sigSel)) {
			DL._recapture();					// edited outside (or undo), or selection changed
			return;
		}

		DL.refresh();							// pick up changes made in the panel
	} catch (e) {
		console.warn('[DeltaLive] tick failed:', e);
	}
};

// - Strip actions ---------------------------------------------------
DL._close = function() {
	if (DL._call('isAlive')) DL._call('liveClosed');
	else DL.stop();
};

DL._recapture = function() {
	DL._call('liveRecapture');
	DL._rebaseline();
	DL.refresh();
	requestDraw();
};

DL._toggle = function(option) {
	DL._call('liveToggle', option);			// the panel recaptures with the new attributes
	DL._rebaseline();
	DL.refresh();
	requestDraw();
};

// - Geometry (screen space, inside the active-cell offset) -----------
DL._toScreen = function(p) {
	return FontRig.glyphToScreen(p[0], p[1]);
};

DL._framePt = function(sx, sy, padPx) {
	var pad = padPx ? padPx / FontRig.state.zoom : 0;
	return DL._toScreen(M.framePoint(DL.st.frame, DL.st.slant, sx, sy, pad));
};

DL._originPt = function(code) {
	return DL._toScreen(M.originPoint(DL.st.frame, DL.st.slant, code));
};

DL._seed = function() {
	var seed = DL.st.seed || [100, 100];
	return [Math.max(seed[0], 1), Math.max(seed[1], 1)];
};

// Ring radius (px): sized from the captured frame (clamped on screen),
// then following the scale of the output frame.
DL._ringPx = function() {
	var src = DL.st.srcFrame, cur = DL.st.frame;
	var side0 = Math.min(src[2] - src[0], src[3] - src[1]);
	var side1 = Math.min(cur[2] - cur[0], cur[3] - cur[1]);
	var follow = side0 > 0 ? side1 / side0 : 1;
	var base = M.clamp(0.2 * side0 * FontRig.state.zoom, DL.STEM_RING_PX[0], DL.STEM_RING_PX[1]);
	return Math.max(base * follow, 1);
};

// Close slot: diagonally off the frame's top-right handle, the strip
// extending left; next to the banner when nothing is captured.
DL._stripOrigin = function(ready) {
	if (!ready) return { x: 16, y: 16, dir: 1 };
	var p = DL._framePt(1, 1, DL.PAD_PX);
	return { x: p.x + DL.STRIP_OFFSET_PX, y: p.y - DL.STRIP_OFFSET_PX, dir: -1 };
};

DL._stripWidth = function(ready) {
	return DL.STRIP.filter(function(e) { return ready || e[4]; }).length * DL.STRIP_SLOT_PX;
};

// Every visible handle with its screen position, in paint order.
DL.layout = function() {
	var out = [];
	if (!DL.active) return out;
	var ready = DL.ready();

	if (ready) {
		M.FRAME_POINTS.forEach(function(fp) {
			var sx = fp[1], sy = fp[2], p = DL._framePt(sx, sy, DL.PAD_PX);
			out.push({ key: 'scale_' + fp[0], group: 'scale', sx: sx, sy: sy, x: p.x, y: p.y,
				shape: sx && sy ? 'square' : sx ? 'bar_v' : 'bar_h', r: DL.HANDLE_R, color: 'active',
				cursor: CURSORS[sx + ',' + sy], tooltip: sx && sy ? 'Width / Height' : sx ? 'Width' : 'Height' });
		});

		var c = DL._framePt(0, 0, 0), ring = DL._ringPx(), seed = DL._seed(), pr = DL.st.params;
		RING_POINTS.forEach(function(rp) {
			out.push({ key: 'stem_' + rp[0], group: 'stem', code: rp[0],
				x: c.x + rp[1] * ring * pr.stem_x / seed[0], y: c.y - rp[2] * ring * pr.stem_y / seed[1],
				shape: 'circle', r: DL.RING_R, color: 'stem', cursor: CURSORS[rp[1] + ',' + rp[2]],
				tooltip: rp[1] ? 'Vertical stem' : 'Horizontal stem' });
		});

		var o = DL._originView || DL._originPt(pr.origin);
		out.push({ key: 'origin', group: 'origin', x: o.x, y: o.y, shape: 'circle', r: DL.ORIGIN_R,
			color: 'active', cursor: 'crosshair', tooltip: 'Transform origin' });
	}

	var so = DL._stripOrigin(ready), slot = 0;
	DL.STRIP.forEach(function(entry) {
		if (!(ready || entry[4])) return;
		var h = { key: 'strip_' + entry[0], group: 'strip', entry: entry,
			x: so.x + so.dir * slot * DL.STRIP_SLOT_PX, y: so.y, shape: 'circle', r: DL.STRIP_R,
			cursor: 'pointer', tooltip: entry[2], enabled: true, checked: false };
		if (entry[0] === 'metrics' || entry[0] === 'anchors') DL._optionState(h, entry[0]);
		out.push(h);
		slot++;
	});

	return out;
};

// Metrics / anchors icons: lit while the panel option is on; disabled
// in selection mode, which drives geometry only.
DL._optionState = function(h, option) {
	if (DL.st.selection) {
		h.enabled = false;
		h.tooltip = 'Process ' + option + ': not used in selection mode';
		return;
	}
	var on = !!(DL.st.options && DL.st.options[option]);
	var active = (DL.st.process || []).indexOf(option) >= 0;
	h.checked = on;
	h.tooltip = 'Process ' + option + ': ' + (on ? 'ON' : 'off')
		+ (on && !active ? ' - nothing to process on this glyph' : '')
		+ ' (click to turn ' + (on ? 'off' : 'on') + ')';
};

DL.hitTest = function(sx, sy) {
	if (!DL.active) return null;
	return M.pickHandle(DL.layout(), sx, sy, DL.HIT_TOL);
};

// - Hover -----------------------------------------------------------
// Returns true when the cursor is over a handle (the caller skips its
// own node/anchor hover then).
DL.handleHover = function(sx, sy) {
	if (!DL.active || DL.dragging) return false;
	var h = DL.hitTest(sx, sy);
	var key = h ? h.key : null;
	if (key !== DL._hoverKey) {
		DL._hoverKey = key;
		requestDraw();
	}
	if (!h) return false;
	if (FontRig.dom && FontRig.dom.canvasWrap) FontRig.dom.canvasWrap.style.cursor = h.cursor || 'default';
	return true;
};

// - Drag ------------------------------------------------------------
DL._glyphAt = function(sx, sy) {
	var g = null;
	withOffset(function() { g = FontRig.screenToGlyph(sx, sy); });
	return g;
};

// Consumes a FontRig EventStream after handleCanvasDrag hit a handle.
// Deltas are always measured from the press point (never accumulated).
DL.handleDrag = async function(stream, initialEvent, sx, sy, hit) {
	var g0 = DL._glyphAt(sx, sy);
	var started = false, last = null;
	DL._cancelled = false;
	DL._dragKey = hit.key;

	for await (var ev of stream) {
		if (ev.sx === undefined) continue;			// key events: Esc is handled by the capture listener
		if (DL._cancelled) continue;
		var c = interactionCoords(ev.absSx, ev.absSy);
		var g = DL._glyphAt(c.sx, c.sy);
		var d = { dvx: c.sx - sx, dvy: c.sy - sy, dgx: g.x - g0.x, dgy: g.y - g0.y, vx: c.sx, vy: c.sy };

		if (!started) {
			if (d.dvx * d.dvx + d.dvy * d.dvy < DL.DRAG_THRESHOLD_PX * DL.DRAG_THRESHOLD_PX) continue;
			started = true;
			if (!DL._dragStart(hit)) { DL._cancelled = true; continue; }
		}

		last = d;
		DL._dragMove(hit, d);
		requestDraw();
	}

	if (!DL._cancelled) {
		if (!started) DL._click(hit);
		else DL._dragEnd(hit, last);
	}
	DL.dragging = false;
	DL._dragKey = null;
	if (typeof FontRig.updateCanvasCursor === 'function') FontRig.updateCanvasCursor();
	if (typeof FontRig.draw === 'function') FontRig.draw();
};

DL._click = function(hit) {
	if (hit.group === 'strip' && hit.enabled !== false) {
		try { hit.entry[3](); }
		catch (e) { console.warn('[DeltaLive] ' + hit.key + ' failed:', e); }
	}
};

DL._dragStart = function(hit) {
	if (hit.group === 'strip' || !DL.ready()) return false;

	var params = copy(DL.st.params);
	DL._press = { params: params, ring: DL._ringPx() };
	DL._dragParams = copy(params);
	DL._models = {};
	DL.dragging = true;

	if (hit.group === 'scale') {
		DL._frameKeys(hit.sx, hit.sy).forEach(function(k) {
			var edge0 = DL._frameEdge(k[1], k[2]);
			var anchor = M.originCoord(DL.st.frame, k[1], params.origin);
			DL._models[k[0]] = { axis: k[1], side: k[2], edge0: edge0, target: edge0,
				model: M.EdgeSecant.proportional(params[k[0]], edge0, anchor) };
		});
	}
	return true;
};

DL._dragMove = function(hit, d) {
	if (!DL._press) return;
	if (hit.group === 'origin') {
		DL._originView = { x: d.vx, y: d.vy };
		return;
	}
	var params = DL._paramsFor(hit, d);
	DL._setDragParams(params);
	DL._push(params);
};

DL._dragEnd = function(hit, d) {
	if (!DL._press) return;
	var params;
	if (hit.group === 'origin') {
		params = copy(DL._dragParams);
		if (DL._originView) params.origin = DL._nearestOrigin(DL._originView.x, DL._originView.y);
		DL._originView = null;
	} else {
		params = DL._paramsFor(hit, d || { dvx: 0, dvy: 0, dgx: 0, dgy: 0 });
	}

	DL._setDragParams(params);
	DL._push(params, true);
	DL._press = DL._dragParams = DL._pending = null;
	DL._models = {};
	DL.dragging = false;
	DL.refresh();
};

// Esc during a drag: push the press values back.
DL._cancelDrag = function() {
	if (!DL.dragging) return;
	DL._cancelled = true;
	DL._originView = null;
	var params = DL._press ? DL._press.params : null;
	DL._press = DL._dragParams = DL._pending = null;
	DL._models = {};
	DL.dragging = false;
	if (params) DL._push(params, true);
	DL.refresh();
	requestDraw();
};

DL._setDragParams = function(params) {
	DL._dragParams = copy(params);
	if (DL.st) DL.st.params = copy(params);
};

// (param key, axis, side) driven by a frame handle. FontRig's Delta has
// no proportional mode: corners drive both axes, mid-edges one.
DL._frameKeys = function(sx, sy) {
	var keys = [];
	if (sx) keys.push(['width', 'x', sx]);
	if (sy) keys.push(['height', 'y', sy]);
	return keys;
};

DL._frameEdge = function(axis, side) {
	var f = DL.st.frame;
	if (axis === 'x') return side < 0 ? f[0] : f[2];
	return side < 0 ? f[1] : f[3];
};

// Params for the current drag position, from the press state.
DL._paramsFor = function(hit, d) {
	var params = copy(DL._press.params);

	if (hit.group === 'scale') {
		// Mid-edge bars move on one font axis; the X share is deslanted
		var dgx = hit.sx ? d.dgx : 0, dgy = hit.sy ? d.dgy : 0;
		var dxs = dgx - dgy * Math.tan(DL.st.slant);
		Object.keys(DL._models).forEach(function(key) {
			var m = DL._models[key];
			m.target = m.edge0 + (m.axis === 'x' ? dxs : dgy);
			params[key] = M.clamp(m.model.solve(m.target), DL.LIMITS.scale[0], DL.LIMITS.scale[1]);
		});

	} else if (hit.group === 'stem') {
		var ring = DL._press.ring, seed = DL._seed(), lo = DL.LIMITS.stem[0], hi = DL.LIMITS.stem[1], f;
		if (hit.code === 'L' || hit.code === 'R') {
			var outX = hit.code === 'R' ? d.dvx : -d.dvx;
			f = M.clamp(params.stem_x / seed[0] + outX / ring, lo, hi);
			params.stem_x = Math.max(1, seed[0] * f);
		} else {
			var outY = hit.code === 'T' ? -d.dvy : d.dvy;
			f = M.clamp(params.stem_y / seed[1] + outY / ring, lo, hi);
			params.stem_y = Math.max(1, seed[1] * f);
		}
	}

	return params;
};

DL._nearestOrigin = function(x, y) {
	var points = {};
	M.ORIGIN_CODES.forEach(function(code) {
		var p = DL._originPt(code);
		points[code] = [p.x, p.y];
	});
	return M.nearestCode(points, x, y, DL.st.params.origin);
};

// - Push to the panel (throttled), refine frame drags by secant ------
DL._push = function(params, now) {
	var t = Date.now();
	if (!now && t - DL._lastPush < DL.PUSH_INTERVAL_MS) {
		DL._pending = copy(params);
		if (!DL._pendingTimer && typeof setTimeout === 'function') {
			DL._pendingTimer = setTimeout(DL._flush, DL.PUSH_INTERVAL_MS);
		}
		return;
	}

	DL._lastPush = t;
	DL._pending = null;
	DL._call('liveSet', copy(params));

	for (var i = 0; i < DL.MAX_CORRECTIONS; i++) {
		var fixed = DL._correct(params);
		if (!fixed) break;
		params = fixed;
		DL._call('liveSet', copy(params));
	}

	if (DL._dragParams) DL._setDragParams(params);
};

DL._flush = function() {
	DL._pendingTimer = null;
	if (DL.active && DL._pending) DL._push(DL._pending, true);
};

// Observe the written frame; new params if the secant moves a value by
// at least one panel step (1 %), else null.
DL._correct = function(params) {
	if (!DL.st || !DL.applied) return null;
	var keys = Object.keys(DL._models);
	if (!keys.length) return null;

	var out = copy(params), changed = false;
	keys.forEach(function(key) {
		var m = DL._models[key];
		m.model.observe(DL.applied[key], DL._frameEdge(m.axis, m.side));
		var value = M.clamp(m.model.solve(m.target), DL.LIMITS.scale[0], DL.LIMITS.scale[1]);
		if (Math.round(value * 100) !== Math.round(DL.applied[key] * 100)) {
			out[key] = value;
			changed = true;
		}
	});
	return changed ? out : null;
};

// - Painting --------------------------------------------------------
DL.colors = function() {
	var dark = true;
	try { dark = FontRig.getCurrentTheme() !== FontRig.themeLight; } catch (e) {}
	return {
		active:  '#e61ea0',
		stem:    '#ffb000',
		error:   '#e62828',
		muted:   dark ? '#a0a0a0' : '#6e6e6e',
		text:    dark ? '#ebebeb' : '#141414',
		labelBg: dark ? 'rgba(45,45,48,0.88)' : 'rgba(246,246,246,0.88)',
		outline: dark ? '#141414' : '#ffffff',
	};
};

DL.valueLine = function() {
	var st = DL.st, pr = st.params;
	var parts = [
		'W ' + Math.round(pr.width * 100) + '%  H ' + Math.round(pr.height * 100) + '%',
		'stem V ' + Math.round(pr.stem_x) + ' u  H ' + Math.round(pr.stem_y) + ' u',
		'origin ' + pr.origin,
	];
	if (Math.abs(st.slant) > 1e-9) {
		parts.push('italic ' + (Math.round(st.slant * 1800 / Math.PI) / 10) + '°');
	}
	if (st.selection) parts.push('[selection: ' + st.selection + ' nodes]');
	else if (st.process && st.process.length) parts.push('also moves: ' + st.process.join(' + '));
	return parts.join('   ');
};

// Label with a translucent background; align: 'TL' | 'LM' | 'BL' at (x, y).
DL._label = function(ctx, x, y, text, align, color, C) {
	ctx.font = '11px "JetBrains Mono", monospace';
	var w = ctx.measureText(text).width + 10, h = 17;
	var top = align === 'LM' ? y - h / 2 : align === 'BL' ? y - h : y;
	ctx.fillStyle = C.labelBg;
	ctx.fillRect(x, top, w, h);
	ctx.fillStyle = color;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';
	ctx.fillText(text, x + 5, top + h / 2);
	return { x: x, y: top, w: w, h: h };
};

DL._withAlpha = function(hex, a) {
	var n = parseInt(hex.slice(1), 16);
	return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
};

DL.draw = function() {
	if (!DL.active || !FontRig.dom || !FontRig.dom.ctx) return;
	var ctx = FontRig.dom.ctx, C = DL.colors(), ready = DL.ready();
	var items = DL.layout();
	ctx.save();

	if (!ready) {
		var text = 'Delta Live Edit: ' + (DL.st ? 'nothing captured on this glyph or layer' : DL.problem);
		DL._label(ctx, 16 + DL._stripWidth(false) - 4, 16, text, 'LM', DL.st ? C.text : C.error, C);
	} else {
		// - Frame quad (parallelogram in italic)
		var quad = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(function(s) { return DL._framePt(s[0], s[1], DL.PAD_PX); });
		ctx.beginPath();
		quad.forEach(function(p, i) { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
		ctx.closePath();
		ctx.fillStyle = DL._withAlpha(C.active, 0.05);
		ctx.fill();
		ctx.strokeStyle = C.active;
		ctx.lineWidth = 1;
		ctx.stroke();

		// - Stem ring
		var c = DL._framePt(0, 0, 0), ring = DL._ringPx(), seed = DL._seed(), pr = DL.st.params;
		ctx.setLineDash([4, 3]);
		ctx.strokeStyle = C.stem;
		ctx.beginPath();
		ctx.ellipse(c.x, c.y, Math.max(ring * pr.stem_x / seed[0], 0.5), Math.max(ring * pr.stem_y / seed[1], 0.5), 0, 0, Math.PI * 2);
		ctx.stroke();
		ctx.setLineDash([]);

		// - Origin snap targets while dragging the cross
		if (DL._originView) {
			var nearest = DL._nearestOrigin(DL._originView.x, DL._originView.y);
			M.ORIGIN_CODES.forEach(function(code) {
				var p = DL._originPt(code), hot = code === nearest;
				ctx.fillStyle = hot ? C.active : DL._withAlpha(C.active, 0.25);
				ctx.strokeStyle = C.active;
				ctx.beginPath();
				ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
				ctx.fill();
				ctx.stroke();
			});
		}

		// - Values under the frame; warnings as a red second line
		var left = Math.min.apply(null, quad.map(function(p) { return p.x; }));
		var bottom = Math.max.apply(null, quad.map(function(p) { return p.y; }));
		var r = DL._label(ctx, left, bottom + 10, DL.valueLine(), 'TL', C.text, C);
		if (DL.st.warnings && DL.st.warnings.length) {
			DL._label(ctx, left, r.y + r.h + 4, DL.st.warnings.join('   '), 'TL', C.error, C);
		}
	}

	items.forEach(function(h) { DL._drawHandle(ctx, h, C); });

	if (DL._hoverKey && !DL.dragging) {
		for (var i = 0; i < items.length; i++) {
			if (items[i].key === DL._hoverKey && items[i].tooltip) {
				DL._label(ctx, items[i].x + items[i].r + 4, items[i].y - items[i].r - 2, items[i].tooltip, 'BL', C.text, C);
				break;
			}
		}
	}

	ctx.restore();
};

DL._drawHandle = function(ctx, h, C) {
	var hot = h.key === DL._hoverKey || h.key === DL._dragKey;
	var r = h.r + (hot ? 1.5 : 0);

	if (h.group === 'strip') {
		var close = h.entry[1] === null;
		var accent = close ? C.error : C.active;
		ctx.fillStyle = C.labelBg;
		ctx.fillRect(h.x - r, h.y - r, 2 * r, 2 * r);
		if (h.checked) {
			ctx.fillStyle = DL._withAlpha(accent, 0.3);
			ctx.fillRect(h.x - r, h.y - r, 2 * r, 2 * r);
		}
		ctx.strokeStyle = hot || h.checked ? accent : C.muted;
		ctx.lineWidth = h.checked ? 1.5 : 1;
		ctx.strokeRect(h.x - r, h.y - r, 2 * r, 2 * r);

		var ink = h.enabled === false ? C.muted : hot ? accent : C.text;
		if (close) {
			var k = r * 0.45;
			ctx.strokeStyle = ink;
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.moveTo(h.x - k, h.y - k); ctx.lineTo(h.x + k, h.y + k);
			ctx.moveTo(h.x - k, h.y + k); ctx.lineTo(h.x + k, h.y - k);
			ctx.stroke();
		} else {
			ctx.font = DL.STRIP_ICON_PX + 'px "TypeRig Icons"';
			ctx.fillStyle = ink;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(h.entry[1], h.x, h.y);
		}
		return;
	}

	if (h.group === 'origin') {
		ctx.strokeStyle = C.active;
		ctx.lineWidth = hot ? 2 : 1.5;
		ctx.fillStyle = C.labelBg;
		ctx.beginPath();
		ctx.arc(h.x, h.y, r * 0.55, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(h.x - r * 1.6, h.y); ctx.lineTo(h.x + r * 1.6, h.y);
		ctx.moveTo(h.x, h.y - r * 1.6); ctx.lineTo(h.x, h.y + r * 1.6);
		ctx.stroke();
		return;
	}

	ctx.fillStyle = h.color === 'stem' ? C.stem : C.active;
	if (hot) ctx.fillStyle = DL._withAlpha(h.color === 'stem' ? C.stem : C.active, 0.7);
	ctx.strokeStyle = C.outline;
	ctx.lineWidth = hot ? 1.5 : 1;
	ctx.beginPath();
	if (h.shape === 'circle') {
		ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
	} else {
		var he = M.halfExtents(h.shape, r);
		ctx.rect(h.x - he[0], h.y - he[1], 2 * he[0], 2 * he[1]);
	}
	ctx.fill();
	ctx.stroke();
};

// - Registration (skipped when loaded headless) ---------------------
if (typeof FontRig.registerVizLayer === 'function') {
	FontRig.registerVizLayer({
		identifier:  'deltaLive',
		name:        'Delta Live Edit',
		zIndex:      950,
		enabledKey:  'deltaLive',
		activeOnly:  true,
		previewMode: 'skip',
		draw: function() { DL.draw(); }
	});
}

// Esc during a handle drag restores the values (and must not reach the
// clear-selection shortcut, which would switch the mode).
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
	document.addEventListener('keydown', function(e) {
		if (e.key === 'Escape' && DL.dragging) {
			DL._cancelDrag();
			e.stopPropagation();
			e.preventDefault();
		}
	}, true);
}

})();
