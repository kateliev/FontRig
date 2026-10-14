// Delta Live Edit tests — tools/delta-live-math.js (pure maths) and
// tools/delta-live.js (canvas tool) driven by a fake Delta panel.
// The fake panel answers like the real core does: the output width is
// affine in width % (stems are compensated), not proportional.
// The JS <-> Python calls of the real panel need Pyodide: check those in
// the browser (see the panel's Live Edit section).
'use strict';

var test = require('node:test');
var assert = require('node:assert');
var load = require('./helpers/load-fontrig');

var F = load.loadFontRig(load.DEFAULT_FILES.concat(['tools/delta-live-math.js', 'tools/delta-live.js']));
var M = F.deltaLiveMath;
var DL = F.deltaLive;

function close(a, b, tol) {
	return Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
}

// - Fake host + panel ------------------------------------------------
// H, 600 x 700 frame at BL (50, 0); one contour so geometry/selection
// signatures have nodes to read.
function setupHost() {
	F.state.zoom = 1;
	F.state.pan = { x: 100, y: 900 };
	F.state.activeLayer = 'Regular';
	F.state.selectedNodeIds = new Set();
	F.state.glyphData = { name: 'H', layers: [
		{ name: 'Regular', shapes: [{ contours: [{ nodes: [{ x: 50, y: 0 }, { x: 50, y: 700 }, { x: 600, y: 700 }, { x: 600, y: 0 }] }] }] },
		{ name: 'Bold', shapes: [{ contours: [{ nodes: [{ x: 40, y: 0 }, { x: 40, y: 700 }, { x: 620, y: 700 }, { x: 620, y: 0 }] }] }] },
	] };
}

function fakePanel() {
	var p = {
		w: 1, h: 1, vx: 80, hy: 60, origin: 'BL', slant: 0, selection: null, alive: true,
		options: { metrics: true, anchors: false }, process: ['metrics'],
		sets: 0, captures: 0, recaptures: 0, resets: 0, closed: 0, toggles: [],
	};
	// Output frame: BL pinned at (50, 0); width = 100 + 450 * w (affine)
	p.frame = function() { return [50, 0, 150 + 450 * p.w, 700 * p.h]; };
	p.liveState = function() {
		return { target: ['H', F.state.activeLayer], frame: p.frame(), srcFrame: [50, 0, 600, 700],
			slant: p.slant, seed: [80, 60], selection: p.selection, warnings: [],
			params: { width: p.w, height: p.h, stem_x: p.vx, stem_y: p.hy, origin: p.origin },
			options: p.options, process: p.process };
	};
	p.liveProblem = function() { return null; };
	p.liveSet = function(v) {
		p.sets++;
		p.w = Math.round(v.width * 100) / 100;			// the panel holds integer %
		p.h = Math.round(v.height * 100) / 100;
		p.vx = Math.max(1, Math.round(v.stem_x));
		p.hy = Math.max(1, Math.round(v.stem_y));
		p.origin = v.origin;
		DL.panelWrote();
	};
	p.liveCapture = function() { p.captures++; return true; };
	p.liveRecapture = function() { p.recaptures++; return true; };
	p.liveReset = function() { p.resets++; p.w = p.h = 1; };
	p.liveToggle = function(o) { p.toggles.push(o); p.options[o] = !p.options[o]; };
	p.liveClosed = function() { p.closed++; DL.stop(); };
	p.isAlive = function() { return p.alive; };
	return p;
}

function startTool() {
	setupHost();
	var p = fakePanel();
	DL.PUSH_INTERVAL_MS = 0;
	DL.MAX_CORRECTIONS = 2;
	DL.start(p);
	if (DL._timer) { clearInterval(DL._timer); DL._timer = null; }	// tests tick by hand
	return p;
}

function handle(key) {
	return DL.layout().filter(function(h) { return h.key === key; })[0];
}

async function* moves(x0, y0, dx, dy, steps) {
	for (var i = 1; i <= steps; i++) {
		var x = x0 + dx * i / steps, y = y0 + dy * i / steps;
		yield { sx: x, sy: y, absSx: x, absSy: y };
	}
}

// Drag a handle by (dx, dy) screen px, the way handleCanvasDrag does.
async function drag(key, dx, dy, steps) {
	var h = handle(key);
	assert.ok(h, 'no handle ' + key);
	await DL.handleDrag(moves(h.x, h.y, dx, dy, steps || 6), {}, h.x, h.y, DL.hitTest(h.x, h.y));
}

async function click(key) {
	var h = handle(key);
	await DL.handleDrag(moves(h.x, h.y, 0, 0, 1), {}, h.x, h.y, DL.hitTest(h.x, h.y));
}

// - Maths -------------------------------------------------------------
test('slant: deslant / reslant round trip, right lean, slanted stem bounds', function() {
	var a = 12 * Math.PI / 180;
	[[0, 0], [100, 700], [-30, -200]].forEach(function(p) {
		var d = M.deslant(p[0], p[1], a), r = M.reslant(d[0], d[1], a);
		assert.ok(close(r[0], p[0]) && close(r[1], p[1]));
	});
	assert.ok(M.reslant(100, 700, a)[0] > 100);
	var stem = [0, 350, 700].map(function(y) { return [100 + y * Math.tan(a), y]; });
	var b = M.slantBounds(stem, a);
	assert.ok(close(b[0], 100) && close(b[2], 100) && b[1] === 0 && b[3] === 700);
	assert.strictEqual(M.slantBounds([], 0), null);
});

test('EdgeSecant: proportional guess misses an affine edge, one secant step lands it', function() {
	var f = function(v) { return 500 * v + 100; };
	var m = M.EdgeSecant.proportional(1, f(1), 0);
	var guess = m.solve(700);
	assert.ok(Math.abs(f(guess) - 700) > 1);
	m.observe(guess, f(guess));
	assert.ok(close(f(m.solve(700)), 700, 1e-9) && close(f(m.solve(450)), 450, 1e-9));

	var z = M.EdgeSecant.proportional(1.2, 50, 50);		// edge on the origin: does nothing
	z.observe(1.3, 52);
	assert.strictEqual(z.solve(80), 1.3);

	var s = new M.EdgeSecant(1, 600, 600);				// sign flips are rejected
	s.observe(1.1, 590);
	assert.strictEqual(s.slope, 600);
});

test('origins: 10 codes, coordinates and nearest snap', function() {
	assert.deepStrictEqual(Array.from(M.ORIGIN_CODES), ['BS', 'BL', 'BM', 'BR', 'LM', 'CE', 'RM', 'TL', 'TM', 'TR']);
	var frame = [50, 0, 600, 700];
	assert.strictEqual(M.originCoord(frame, 'x', 'BS'), 0);
	assert.strictEqual(M.originCoord(frame, 'x', 'RM'), 600);
	assert.strictEqual(M.originCoord(frame, 'y', 'RM'), 350);
	assert.strictEqual(M.originCoord(frame, 'x', 'TM'), 325);
	assert.strictEqual(M.nearestCode({ BL: [0, 0], TR: [10, 10] }, 8, 9, 'BL'), 'TR');
	assert.strictEqual(M.pickHandle([{ shape: 'circle', x: 0, y: 0, r: 6 }, { shape: 'square', x: 4, y: 0, r: 6, enabled: false }], 3, 0, 3).x, 0);
});

// - Canvas tool ------------------------------------------------------
test('layout: 8 frame + 4 ring + origin + 5 icons when ready; banner keeps close + recapture', function() {
	var p = startTool();
	assert.ok(DL.ready());
	assert.strictEqual(DL.layout().length, 18);
	F.state.activeLayer = 'Bold';					// tool target != panel target until captured
	p.liveState = function() { return null; };
	DL.refresh();
	assert.deepStrictEqual(Array.from(DL.layout().map(function(h) { return h.key; })), ['strip_close', 'strip_recapture']);
	DL.stop();
});

test('frame drag: the right edge lands under the cursor (secant)', async function() {
	var p = startTool();
	var x1 = p.frame()[2];
	await drag('scale_RM', 90, 0);					// zoom 1: 90 px = 90 units
	assert.ok(close(p.frame()[2], x1 + 90, 1e-6), p.frame()[2] + ' vs ' + (x1 + 90));
	assert.strictEqual(p.w, 1.2);
	assert.ok(DL._dragParams === null && !DL.dragging);
	DL.stop();
});

test('frame drag without corrections drifts (why the secant is needed)', async function() {
	var p = startTool();
	DL.MAX_CORRECTIONS = 0;
	var x1 = p.frame()[2];
	await drag('scale_RM', 90, 0, 1);
	assert.ok(Math.abs(p.frame()[2] - (x1 + 90)) > 10);
	DL.stop();
});

test('stem ring writes stems in units', async function() {
	var p = startTool();
	var ring = DL._ringPx();
	await drag('stem_R', ring * 0.25, 0);
	assert.strictEqual(p.vx, 100);					// 80 * 1.25
	await drag('stem_T', 0, -ring * 0.5);
	assert.strictEqual(p.hy, 90);					// 60 * 1.5
	DL.stop();
});

test('origin cross snaps to each of the 10 origins', async function() {
	var p = startTool();
	for (var i = 0; i < M.ORIGIN_CODES.length; i++) {
		var code = M.ORIGIN_CODES[i], o = handle('origin'), t = DL._originPt(code);
		await drag('origin', t.x - o.x + 2, t.y - o.y - 2);
		assert.strictEqual(p.origin, code);
	}
	DL.stop();
});

test('Esc restores the values from before the drag', function() {
	var p = startTool();
	var h = handle('scale_TM');
	assert.ok(DL._dragStart(h));
	DL._dragMove(h, { dvx: 0, dvy: -120, dgx: 0, dgy: 120, vx: h.x, vy: h.y - 120 });
	assert.ok(p.h > 1);
	DL._cancelDrag();
	assert.strictEqual(p.h, 1);
	assert.ok(!DL.dragging && DL._dragParams === null);
	DL.stop();
});

test('icon strip: close, recapture, reset, option toggles; options off in selection mode', async function() {
	var p = startTool();
	assert.ok(handle('strip_metrics').checked && !handle('strip_anchors').checked);
	assert.ok(/nothing to process/.test(handle('strip_metrics').tooltip) === false);
	await click('strip_recapture');
	assert.strictEqual(p.recaptures, 1);
	p.w = 1.4;
	await click('strip_reset');
	assert.ok(p.resets === 1 && p.w === 1);
	await click('strip_anchors');
	assert.deepStrictEqual(Array.from(p.toggles), ['anchors']);

	p.selection = 4;
	DL.refresh();
	assert.ok(!handle('strip_metrics').enabled && /selection mode/.test(handle('strip_metrics').tooltip));
	assert.ok(/\[selection: 4 nodes\]/.test(DL.valueLine()));
	assert.strictEqual(DL.hitTest(handle('strip_metrics').x, handle('strip_metrics').y), null);

	await click('strip_close');
	assert.ok(p.closed === 1 && !DL.active);
});

test('tick: target change captures once; outside edit and selection change recapture; own writes do not', async function() {
	var p = startTool();
	await drag('scale_RM', 40, 0);						// own writes (panelWrote rebaselines)
	F.state.glyphData.layers[0].shapes[0].contours[0].nodes[2].x += 30;	// ...but this one is outside
	DL._sigGeom = DL._geomSig();							// pretend it was ours
	DL._tick();
	assert.strictEqual(p.recaptures, 0);

	F.state.glyphData.layers[0].shapes[0].contours[0].nodes[0].x += 5;	// outside node edit
	DL._tick();
	assert.strictEqual(p.recaptures, 1);

	F.state.selectedNodeIds = new Set(['c0_n0', 'c0_n1']);				// selection change
	DL._tick();
	assert.strictEqual(p.recaptures, 2);

	F.state.activeLayer = 'Bold';											// layer switch
	DL._tick(); DL._tick();
	assert.strictEqual(p.captures, 1);

	p.liveState = function() { return null; };							// capture failed: no retry storm
	F.state.activeLayer = 'Regular';
	DL._tick(); DL._tick(); DL._tick();
	assert.strictEqual(p.captures, 2);

	p.alive = false;														// panel gone
	DL._tick();
	assert.ok(!DL.active);
});

test('italic: the frame is a parallelogram and corner drags work in deslanted space', function() {
	var p = startTool();
	p.slant = 12 * Math.PI / 180;
	DL.refresh();
	var tl = DL._framePt(-1, 1, 0), bl = DL._framePt(-1, -1, 0);
	assert.ok(tl.x > bl.x + 100, 'leans right');

	var h = handle('scale_TR');
	assert.ok(DL._dragStart(h));
	var params = DL._paramsFor(h, { dvx: 0, dvy: 0, dgx: 50, dgy: 70 });
	assert.ok(close(DL._models.width.target, p.frame()[2] + 50 - 70 * Math.tan(p.slant)));
	assert.ok(close(DL._models.height.target, 770) && params.height > 1);
	DL._cancelDrag();
	DL.stop();
});
