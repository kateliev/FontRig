// ===================================================================
// FontRig — Drawing Tool Handlers
// ===================================================================
// Stream-based interaction handlers for the modal drawing tools
// (line, polyline, bezier, hobby, rect-drag, ellipse-drag).
//
// Wired into the global mousedown dispatch via FontRig.drawTool.
// tryDispatch(stream, initialEvent, sx, sy) — called early in
// FontRig.handleCanvasDrag. Returns true if the active draw tool
// claimed the event (so the default selection logic should be
// skipped).
//
// Tools also need cursor preview between clicks (line, polyline,
// bezier, hobby). FontRig.drawTool.handleHover(event) is called from
// handleCanvasHover when a session is active.
//
// TODO v2: snapping during preview.
// ===================================================================
'use strict';

// -- Coordinate helper (mirrors stream-handlers internal one) -------
FontRig.drawTool._cursorGlyph = function(sx, sy) {
	var coords = FontRig._interactionCoords(sx, sy);
	var gp;
	FontRig._withActiveOffset(function() {
		gp = FontRig.screenToGlyph(coords.sx, coords.sy);
	});
	return gp;
};

// ===================================================================
// Dispatch from handleCanvasDrag
// ===================================================================
FontRig.drawTool.tryDispatch = function(stream, initialEvent, sx, sy) {
	var tool = FontRig.state.activeDrawTool;
	if (!tool || tool === 'select') return false;

	var handler = FontRig.drawTool._dragHandlers[tool];
	if (!handler) return false;

	handler(stream, initialEvent, sx, sy);
	return true;
};

// Per-tool drag handlers. Each is an async fn (consumes the stream).
FontRig.drawTool._dragHandlers = {};

// ===================================================================
// Hover dispatch (cursor preview between clicks)
// ===================================================================
FontRig.drawTool.handleHover = function(event) {
	var s = FontRig.drawTool.session;
	if (!s.active) return false;

	// Only tools that need between-click cursor preview.
	var tool = s.tool;
	if (tool !== 'line' && tool !== 'polyline' &&
		tool !== 'bezier' && tool !== 'hobby') return false;

	s.cursor = FontRig.drawTool._cursorGlyph(event.absSx, event.absSy);
	FontRig.draw();
	return true;
};

// ===================================================================
// LINE tool — two-click straight segment
// ===================================================================
FontRig.drawTool._dragHandlers['line'] = async function(stream, initialEvent, sx, sy) {
	var s = FontRig.drawTool.session;
	var gp = FontRig.drawTool._cursorGlyph(initialEvent.absSx, initialEvent.absSy);

	if (!s.active) {
		// First click — anchor first point and begin session.
		s.tool = 'line';
		s.points = [gp];
		s.cursor = gp;
		s.active = true;

		// Consume any drag movement to keep the preview live in case
		// the user drags rather than clicks. Session stays open after
		// release; the second mousedown commits.
		for await (var ev of stream) {
			if (ev.sx === undefined) continue;
			s.cursor = FontRig.drawTool._cursorGlyph(ev.absSx, ev.absSy);
			FontRig.draw();
		}
		FontRig.draw();
		return;
	}

	// Second click — drain to get final cursor, then commit.
	var finalCursor = gp;
	for await (var ev2 of stream) {
		if (ev2.sx === undefined) continue;
		finalCursor = FontRig.drawTool._cursorGlyph(ev2.absSx, ev2.absSy);
	}
	var p1 = s.points[0];
	if (Math.abs(finalCursor.x - p1.x) < 0.5 && Math.abs(finalCursor.y - p1.y) < 0.5) {
		// Zero-length line — cancel without committing or pushing undo.
		FontRig.drawTool.resetSession();
		FontRig.draw();
		return;
	}
	FontRig.drawTool.commitContour(
		FontRig.drawPrimitives.makeLineContour(p1.x, p1.y, finalCursor.x, finalCursor.y)
	);
};

FontRig.drawTool.registerPreview('line', function(ctx, s, g2s) {
	if (!s.points || s.points.length === 0) return;
	var a = g2s(s.points[0].x, s.points[0].y);
	ctx.beginPath();
	ctx.moveTo(a.x, a.y);
	if (s.cursor) {
		var b = g2s(s.cursor.x, s.cursor.y);
		ctx.lineTo(b.x, b.y);
	}
	ctx.stroke();
	FontRig.drawTool.drawKnotMarker(ctx, a.x, a.y);
	if (s.cursor) {
		var b2 = g2s(s.cursor.x, s.cursor.y);
		FontRig.drawTool.drawKnotMarker(ctx, b2.x, b2.y);
	}
});

// ===================================================================
// RECTANGLE drag tool
// ===================================================================
// Mousedown = anchor, drag = preview, mouseup = commit.
// Modifiers (read at release):
//   Shift = constrain to square
//   Alt   = anchor is center, not corner
// ===================================================================
FontRig.drawTool._dragHandlers['rectDrag'] = async function(stream, initialEvent, sx, sy) {
	var s = FontRig.drawTool.session;
	var anchor = FontRig.drawTool._cursorGlyph(initialEvent.absSx, initialEvent.absSy);

	s.tool = 'rectDrag';
	s.points = [];
	s.anchor = anchor;
	s.cursor = anchor;
	s.active = true;
	// Stash modifiers on session for the preview renderer.
	s.shift = !!initialEvent.shiftKey;
	s.alt = !!initialEvent.altKey;
	FontRig.draw();

	var lastShift = s.shift;
	var lastAlt = s.alt;
	for await (var ev of stream) {
		if (ev.shiftKey !== undefined) lastShift = !!ev.shiftKey;
		if (ev.altKey !== undefined) lastAlt = !!ev.altKey;
		s.shift = lastShift;
		s.alt = lastAlt;
		if (ev.sx === undefined) {
			// Modifier-only event — redraw to update preview shape.
			FontRig.draw();
			continue;
		}
		s.cursor = FontRig.drawTool._cursorGlyph(ev.absSx, ev.absSy);
		FontRig.draw();
	}

	// Compute final geometry on release.
	var rect = FontRig.drawTool._resolveRect(anchor, s.cursor, lastShift, lastAlt);
	if (!rect || rect.w < 1 || rect.h < 1) {
		FontRig.drawTool.resetSession();
		FontRig.draw();
		return;
	}
	FontRig.drawTool.commitContour(
		FontRig.drawPrimitives.makeRectContour(rect.ox, rect.oy, rect.w, rect.h)
	);
};

// Shared helper: turn (anchor, cursor, shift, alt) into (ox, oy, w, h).
//   shift = constrain to square (use min of |dx|,|dy|)
//   alt   = anchor is center; cursor extends in both directions
FontRig.drawTool._resolveRect = function(anchor, cursor, shift, alt) {
	if (!anchor || !cursor) return null;
	var dx = cursor.x - anchor.x;
	var dy = cursor.y - anchor.y;

	if (shift) {
		var side = Math.min(Math.abs(dx), Math.abs(dy));
		dx = (dx < 0 ? -side : side);
		dy = (dy < 0 ? -side : side);
	}

	var ox, oy, w, h;
	if (alt) {
		// Anchor is center — full extent is 2*|d|.
		w = Math.abs(dx) * 2;
		h = Math.abs(dy) * 2;
		ox = anchor.x - w / 2;
		oy = anchor.y - h / 2;
	} else {
		w = Math.abs(dx);
		h = Math.abs(dy);
		ox = Math.min(anchor.x, anchor.x + dx);
		oy = Math.min(anchor.y, anchor.y + dy);
	}
	return { ox: ox, oy: oy, w: w, h: h };
};

FontRig.drawTool.registerPreview('rectDrag', function(ctx, s, g2s) {
	if (!s.anchor || !s.cursor) return;
	var rect = FontRig.drawTool._resolveRect(s.anchor, s.cursor, s.shift, s.alt);
	if (!rect) return;

	// Convert glyph-space rect to screen-space rect (Y flips).
	var tl = g2s(rect.ox, rect.oy + rect.h);
	var br = g2s(rect.ox + rect.w, rect.oy);
	ctx.beginPath();
	ctx.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
	ctx.stroke();

	var a = g2s(s.anchor.x, s.anchor.y);
	FontRig.drawTool.drawKnotMarker(ctx, a.x, a.y);
});

// ===================================================================
// POLYLINE tool — multi-click connected lines
// ===================================================================
// Click adds a vertex. Live segment from last vertex to cursor.
// Double-click commits open path. Click on first vertex closes &
// commits. Backspace pops last vertex. Esc cancels.
//
// Close-hit radius is in screen pixels so it scales with zoom.
// ===================================================================
var POLYLINE_CLOSE_HIT_PX = 8;

FontRig.drawTool._dragHandlers['polyline'] = async function(stream, initialEvent, sx, sy) {
	var s = FontRig.drawTool.session;
	var gp = FontRig.drawTool._cursorGlyph(initialEvent.absSx, initialEvent.absSy);

	// First click: start the session.
	if (!s.active) {
		s.tool = 'polyline';
		s.points = [gp];
		s.cursor = gp;
		s.active = true;
		// Drain stream (cursor preview during any drag movement).
		for await (var ev of stream) {
			if (ev.sx === undefined) continue;
			s.cursor = FontRig.drawTool._cursorGlyph(ev.absSx, ev.absSy);
			FontRig.draw();
		}
		FontRig.draw();
		return;
	}

	// Subsequent click. Double-click commits as open path.
	if (initialEvent.detail >= 2) {
		// First click of dblclick already added a duplicate vertex —
		// pop it before committing.
		if (s.points.length >= 2) {
			var last = s.points[s.points.length - 1];
			var prev = s.points[s.points.length - 2];
			if (Math.abs(last.x - prev.x) < 0.5 && Math.abs(last.y - prev.y) < 0.5) {
				s.points.pop();
			}
		}
		FontRig.drawTool._commitPolyline(false);
		return;
	}

	// Close-hit on first vertex closes the path.
	var first = s.points[0];
	var firstS = FontRig.glyphToScreen(first.x, first.y);
	var clickS = { x: initialEvent.absSx, y: initialEvent.absSy };
	var dx = firstS.x - clickS.x, dy = firstS.y - clickS.y;
	if (s.points.length >= 2 && (dx * dx + dy * dy) <= POLYLINE_CLOSE_HIT_PX * POLYLINE_CLOSE_HIT_PX) {
		FontRig.drawTool._commitPolyline(true);
		// Drain pending events so the dispatch loop completes cleanly.
		for await (var ev2 of stream) { if (ev2.sx === undefined) continue; }
		return;
	}

	// Add a vertex.
	s.points.push(gp);
	s.cursor = gp;
	for await (var ev3 of stream) {
		if (ev3.sx === undefined) continue;
		s.cursor = FontRig.drawTool._cursorGlyph(ev3.absSx, ev3.absSy);
		FontRig.draw();
	}
	FontRig.draw();
};

FontRig.drawTool._commitPolyline = function(closed) {
	var s = FontRig.drawTool.session;
	if (!s.points || s.points.length < 2) {
		FontRig.drawTool.resetSession();
		FontRig.draw();
		return;
	}
	FontRig.drawTool.commitContour(
		FontRig.drawPrimitives.makePolylineContour(s.points, !!closed)
	);
};

FontRig.drawTool.registerPreview('polyline', function(ctx, s, g2s) {
	if (!s.points || s.points.length === 0) return;
	ctx.beginPath();
	var p0 = g2s(s.points[0].x, s.points[0].y);
	ctx.moveTo(p0.x, p0.y);
	for (var i = 1; i < s.points.length; i++) {
		var p = g2s(s.points[i].x, s.points[i].y);
		ctx.lineTo(p.x, p.y);
	}
	if (s.cursor) {
		var c = g2s(s.cursor.x, s.cursor.y);
		ctx.lineTo(c.x, c.y);
	}
	ctx.stroke();
	for (var j = 0; j < s.points.length; j++) {
		var m = g2s(s.points[j].x, s.points[j].y);
		FontRig.drawTool.drawKnotMarker(ctx, m.x, m.y);
	}

	// Highlight first vertex (close target) when there are 2+ points.
	if (s.points.length >= 2) {
		var f = g2s(s.points[0].x, s.points[0].y);
		ctx.save();
		ctx.beginPath();
		ctx.arc(f.x, f.y, POLYLINE_CLOSE_HIT_PX, 0, Math.PI * 2);
		ctx.lineWidth = 1;
		ctx.stroke();
		ctx.restore();
	}
});

// ===================================================================
// ELLIPSE drag tool
// ===================================================================
// Same modifiers as rectDrag: Shift = circle, Alt = anchor is center.
// Reuses _resolveRect to compute the bounding rect, then builds an
// ellipse inscribed in it.
// ===================================================================
FontRig.drawTool._dragHandlers['ellipseDrag'] = async function(stream, initialEvent, sx, sy) {
	var s = FontRig.drawTool.session;
	var anchor = FontRig.drawTool._cursorGlyph(initialEvent.absSx, initialEvent.absSy);

	s.tool = 'ellipseDrag';
	s.points = [];
	s.anchor = anchor;
	s.cursor = anchor;
	s.active = true;
	s.shift = !!initialEvent.shiftKey;
	s.alt = !!initialEvent.altKey;
	FontRig.draw();

	var lastShift = s.shift;
	var lastAlt = s.alt;
	for await (var ev of stream) {
		if (ev.shiftKey !== undefined) lastShift = !!ev.shiftKey;
		if (ev.altKey !== undefined) lastAlt = !!ev.altKey;
		s.shift = lastShift;
		s.alt = lastAlt;
		if (ev.sx === undefined) {
			FontRig.draw();
			continue;
		}
		s.cursor = FontRig.drawTool._cursorGlyph(ev.absSx, ev.absSy);
		FontRig.draw();
	}

	var rect = FontRig.drawTool._resolveRect(anchor, s.cursor, lastShift, lastAlt);
	if (!rect || rect.w < 1 || rect.h < 1) {
		FontRig.drawTool.resetSession();
		FontRig.draw();
		return;
	}
	var cx = rect.ox + rect.w / 2;
	var cy = rect.oy + rect.h / 2;
	FontRig.drawTool.commitContour(
		FontRig.drawPrimitives.makeEllipseContour(cx, cy, rect.w / 2, rect.h / 2, 0)
	);
};

FontRig.drawTool.registerPreview('ellipseDrag', function(ctx, s, g2s) {
	if (!s.anchor || !s.cursor) return;
	var rect = FontRig.drawTool._resolveRect(s.anchor, s.cursor, s.shift, s.alt);
	if (!rect) return;

	var tl = g2s(rect.ox, rect.oy + rect.h);
	var br = g2s(rect.ox + rect.w, rect.oy);
	var sw = br.x - tl.x;
	var sh = br.y - tl.y;
	var cx = tl.x + sw / 2;
	var cy = tl.y + sh / 2;

	ctx.beginPath();
	ctx.ellipse(cx, cy, Math.abs(sw) / 2, Math.abs(sh) / 2, 0, 0, Math.PI * 2);
	ctx.stroke();

	var a = g2s(s.anchor.x, s.anchor.y);
	FontRig.drawTool.drawKnotMarker(ctx, a.x, a.y);
});

// ===================================================================
// BEZIER tool — Corel-style
// ===================================================================
// Interaction:
//   Click + release        : drop on-curve corner (no handles)
//   Click + drag           : drop on-curve smooth, drag pulls
//                            handleOut (and mirrored handleIn)
//   Alt while dragging     : break symmetry, only handleOut moves
//   Shift while dragging   : constrain handle to 15° increments
//   Click on first node    : close & commit (close-hit ring shown)
//   Enter / dblclick       : commit as open path
//   Backspace              : pop last node
//   Esc                    : cancel
//
// session.points entries:
//   { x, y, handleIn:{x,y}|null, handleOut:{x,y}|null, smooth:bool }
// ===================================================================
var BEZIER_CLOSE_HIT_PX = 8;
var BEZIER_HANDLE_DRAG_THRESHOLD_PX = 4;   // movement to count as a drag
var BEZIER_SHIFT_STEP_DEG = 15;

FontRig.drawTool._dragHandlers['bezier'] = async function(stream, initialEvent, sx, sy) {
	var s = FontRig.drawTool.session;
	var gp = FontRig.drawTool._cursorGlyph(initialEvent.absSx, initialEvent.absSy);

	// Initialize session on first click.
	if (!s.active) {
		s.tool = 'bezier';
		s.points = [];
		s.cursor = gp;
		s.active = true;
	}

	// Double-click → commit open (the first click of dblclick already
	// dropped a duplicate node; pop it).
	if (initialEvent.detail >= 2 && s.points.length > 0) {
		var lastN = s.points[s.points.length - 1];
		if (Math.abs(lastN.x - gp.x) < 0.5 && Math.abs(lastN.y - gp.y) < 0.5) {
			s.points.pop();
		}
		FontRig.drawTool._commitBezier(false);
		return;
	}

	// Close-hit on first node (need 2+ points already committed).
	if (s.points.length >= 2) {
		var first = s.points[0];
		var firstS = FontRig.glyphToScreen(first.x, first.y);
		var dxC = firstS.x - initialEvent.absSx;
		var dyC = firstS.y - initialEvent.absSy;
		if (dxC * dxC + dyC * dyC <= BEZIER_CLOSE_HIT_PX * BEZIER_CLOSE_HIT_PX) {
			FontRig.drawTool._commitBezier(true);
			for await (var evClose of stream) { if (evClose.sx === undefined) continue; }
			return;
		}
	}

	// Drop the new on-curve node.
	var node = { x: gp.x, y: gp.y, handleIn: null, handleOut: null, smooth: false };
	s.points.push(node);
	s.cursor = gp;
	FontRig.draw();

	// Consume the drag stream — first significant movement turns this
	// into a smooth node with handles.
	var startScreen = { x: initialEvent.absSx, y: initialEvent.absSy };
	var draggedFar = false;
	var lastShift = !!initialEvent.shiftKey;
	var lastAlt = !!initialEvent.altKey;
	for await (var ev of stream) {
		if (ev.shiftKey !== undefined) lastShift = !!ev.shiftKey;
		if (ev.altKey !== undefined) lastAlt = !!ev.altKey;
		if (ev.sx === undefined) {
			// Modifier-only — refresh handle if dragging.
			if (draggedFar) FontRig.draw();
			continue;
		}
		var dxS = ev.absSx - startScreen.x;
		var dyS = ev.absSy - startScreen.y;
		if (!draggedFar &&
			(dxS * dxS + dyS * dyS) >= BEZIER_HANDLE_DRAG_THRESHOLD_PX * BEZIER_HANDLE_DRAG_THRESHOLD_PX) {
			draggedFar = true;
			node.smooth = true;
		}
		if (draggedFar) {
			var p = FontRig.drawTool._cursorGlyph(ev.absSx, ev.absSy);
			// Apply Shift constraint (snap angle around node).
			if (lastShift) {
				p = FontRig.drawTool._snapAngle(node, p, BEZIER_SHIFT_STEP_DEG);
			}
			node.handleOut = { x: p.x, y: p.y };
			if (!lastAlt) {
				node.handleIn = { x: 2 * node.x - p.x, y: 2 * node.y - p.y };
				node.smooth = true;
			} else {
				// Alt: break symmetry — handleIn untouched (null on first
				// drag, preserved otherwise), node is no longer smooth.
				node.smooth = false;
			}
		}
		s.cursor = FontRig.drawTool._cursorGlyph(ev.absSx, ev.absSy);
		FontRig.draw();
	}
	FontRig.draw();
};

// Snap (p relative to anchor) to nearest stepDeg increment.
FontRig.drawTool._snapAngle = function(anchor, p, stepDeg) {
	var dx = p.x - anchor.x;
	var dy = p.y - anchor.y;
	var len = Math.sqrt(dx * dx + dy * dy);
	if (len < 1e-6) return p;
	var ang = Math.atan2(dy, dx);
	var step = stepDeg * Math.PI / 180;
	var snapped = Math.round(ang / step) * step;
	return { x: anchor.x + Math.cos(snapped) * len, y: anchor.y + Math.sin(snapped) * len };
};

// Commit the bezier session to a Contour.
FontRig.drawTool._commitBezier = function(closed) {
	var s = FontRig.drawTool.session;
	var pts = s.points || [];
	if (pts.length < 2) {
		FontRig.drawTool.resetSession();
		FontRig.draw();
		return;
	}

	var nodes = [];
	var n = pts.length;
	var stop = closed ? n : n - 1;

	for (var i = 0; i < n; i++) {
		var p = pts[i];
		var on = FontRig.drawTool.makeNode(p.x, p.y, 'on', !!p.smooth);
		nodes.push(on);

		if (i >= stop) break;

		var nxt = pts[(i + 1) % n];
		var hOut = p.handleOut;
		var hIn = nxt.handleIn;

		// Pure line segment — no off-curves.
		if (!hOut && !hIn) continue;

		// Asymmetric — use the on-curve coord as the missing handle.
		var oh = hOut || { x: p.x, y: p.y };
		var ih = hIn || { x: nxt.x, y: nxt.y };
		nodes.push(FontRig.drawTool.makeNode(oh.x, oh.y, 'curve', false));
		nodes.push(FontRig.drawTool.makeNode(ih.x, ih.y, 'curve', false));
	}

	FontRig.drawTool.commitContour(
		FontRig.drawTool.makeContour(nodes, !!closed)
	);
};

// Bezier preview: committed segments + handles + live segment to cursor.
FontRig.drawTool.registerPreview('bezier', function(ctx, s, g2s) {
	var pts = s.points || [];
	if (pts.length === 0) return;

	// Committed path.
	ctx.beginPath();
	var firstS = g2s(pts[0].x, pts[0].y);
	ctx.moveTo(firstS.x, firstS.y);
	for (var i = 0; i < pts.length - 1; i++) {
		var a = pts[i], b = pts[i + 1];
		var bs = g2s(b.x, b.y);
		if (a.handleOut || b.handleIn) {
			var oh = a.handleOut || { x: a.x, y: a.y };
			var ih = b.handleIn || { x: b.x, y: b.y };
			var ohS = g2s(oh.x, oh.y);
			var ihS = g2s(ih.x, ih.y);
			ctx.bezierCurveTo(ohS.x, ohS.y, ihS.x, ihS.y, bs.x, bs.y);
		} else {
			ctx.lineTo(bs.x, bs.y);
		}
	}
	// Live segment from last node to cursor (straight, no preview handles
	// for the next node yet).
	if (s.cursor) {
		var last = pts[pts.length - 1];
		if (last.handleOut) {
			// Show what the next segment will look like with last.handleOut
			// and the cursor as a corner endpoint (no handleIn).
			var lhS = g2s(last.handleOut.x, last.handleOut.y);
			var cS = g2s(s.cursor.x, s.cursor.y);
			ctx.bezierCurveTo(lhS.x, lhS.y, cS.x, cS.y, cS.x, cS.y);
		} else {
			var c2 = g2s(s.cursor.x, s.cursor.y);
			ctx.lineTo(c2.x, c2.y);
		}
	}
	ctx.stroke();

	// Handle whiskers + handle ends for every committed node.
	ctx.save();
	ctx.lineWidth = 1;
	for (var k = 0; k < pts.length; k++) {
		var n = pts[k];
		var nS = g2s(n.x, n.y);
		if (n.handleIn) {
			var hi = g2s(n.handleIn.x, n.handleIn.y);
			ctx.beginPath();
			ctx.moveTo(nS.x, nS.y); ctx.lineTo(hi.x, hi.y);
			ctx.stroke();
			FontRig.drawTool.drawKnotMarker(ctx, hi.x, hi.y);
		}
		if (n.handleOut) {
			var ho = g2s(n.handleOut.x, n.handleOut.y);
			ctx.beginPath();
			ctx.moveTo(nS.x, nS.y); ctx.lineTo(ho.x, ho.y);
			ctx.stroke();
			FontRig.drawTool.drawKnotMarker(ctx, ho.x, ho.y);
		}
		FontRig.drawTool.drawKnotMarker(ctx, nS.x, nS.y);
	}
	ctx.restore();

	// Close-hit ring on first node.
	if (pts.length >= 2) {
		var f = g2s(pts[0].x, pts[0].y);
		ctx.save();
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(f.x, f.y, BEZIER_CLOSE_HIT_PX, 0, Math.PI * 2);
		ctx.stroke();
		ctx.restore();
	}
});

// ===================================================================
// Esc / Enter handling
// ===================================================================
// Esc cancels any in-progress draw session. Wired at module load
// time (window-level). Enter is reserved for polyline / hobby commit
// (added with those tools).
window.addEventListener('keydown', function(e) {
	var s = FontRig.drawTool.session;
	if (!s.active) return;

	// Skip if focus is on a text-entry element.
	var tgt = e.target;
	if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' ||
				tgt.isContentEditable)) return;

	if (e.key === 'Escape') {
		FontRig.drawTool.cancelSession();
		e.preventDefault();
		return;
	}

	// Enter commits polyline / bezier as open path.
	if (e.key === 'Enter') {
		if (s.tool === 'polyline') {
			FontRig.drawTool._commitPolyline(false);
			e.preventDefault();
			return;
		}
		if (s.tool === 'bezier') {
			FontRig.drawTool._commitBezier(false);
			e.preventDefault();
			return;
		}
	}

	// Backspace pops last vertex (polyline / bezier). If only first
	// remains, cancel the session.
	if (e.key === 'Backspace' && (s.tool === 'polyline' || s.tool === 'bezier')) {
		if (s.points.length > 1) {
			s.points.pop();
			FontRig.draw();
		} else {
			FontRig.drawTool.cancelSession();
		}
		e.preventDefault();
		return;
	}
}, true);
