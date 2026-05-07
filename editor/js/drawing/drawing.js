// ===================================================================
// FontRig — Canvas Drawing
// ===================================================================
// All color values come from FontRig.theme (theme.js).
// ===================================================================
'use strict';

// ===================================================================
// Path2D Cache
// ===================================================================
// Lazily builds and caches Path2D objects per font-layer.  Paths are
// stored in raw font coordinates (y-up).  At render time a single
// ctx.transform(zoom, 0, 0, -zoom, panX, panY) maps them to screen
// space, avoiding per-point glyphToScreen() calls.
//
// Cache validity:
//   - layer.shapes reference check handles undo/redo (shapes replaced)
//   - _pathCacheDirty flag handles in-place mutations (node drags)
//   - Different layer object on glyph switch → no cache yet
// ===================================================================

// Trace a single contour into a Path2D in font coordinates.
// Handles both open and closed contours.
FontRig._traceContourToPath2d = function(path, contour) {
	var nodes = contour.nodes;
	var n = nodes.length;
	if (n === 0) return;

	// Find first on-curve
	var firstOn = 0;
	for (var j = 0; j < n; j++) {
		if (nodes[j].type === 'on') { firstOn = j; break; }
	}

	path.moveTo(nodes[firstOn].x, nodes[firstOn].y);

	var i = (firstOn + 1) % n;
	var count = 0;

	while (count < n - 1) {
		var node = nodes[i];

		if (node.type === 'on') {
			path.lineTo(node.x, node.y);

		} else if (node.type === 'curve') {
			var b1 = node;
			var b2 = nodes[(i + 1) % n];
			var on = nodes[(i + 2) % n];
			path.bezierCurveTo(b1.x, b1.y, b2.x, b2.y, on.x, on.y);
			i = (i + 2) % n;
			count += 2;

		} else if (node.type === 'off') {
			var off = node;
			var on2 = nodes[(i + 1) % n];
			path.quadraticCurveTo(off.x, off.y, on2.x, on2.y);
			i = (i + 1) % n;
			count += 1;
		}

		i = (i + 1) % n;
		count++;
	}

	if (contour.closed) path.closePath();
};

// Return cached { closedPath, openPath, allPath, hasOpen, hasClosed }
// for a layer, rebuilding only when stale.
FontRig._getLayerPaths = function(layer) {
	if (!layer) return null;

	// Cache hit: same shapes reference and not explicitly dirtied
	if (layer._pathCache &&
		layer._pathCache.shapes === layer.shapes &&
		!layer._pathCacheDirty) {
		return layer._pathCache;
	}

	var closedPath = new Path2D();
	var openPath   = new Path2D();
	var allPath    = new Path2D();
	var hasOpen    = false;
	var hasClosed  = false;

	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			var contour = shape.contours[ki];
			if (contour.nodes.length === 0) continue;

			FontRig._traceContourToPath2d(allPath, contour);

			if (contour.closed) {
				FontRig._traceContourToPath2d(closedPath, contour);
				hasClosed = true;
			} else {
				FontRig._traceContourToPath2d(openPath, contour);
				hasOpen = true;
			}
		}
	}

	var cache = {
		shapes:     layer.shapes,   // reference for staleness check
		closedPath: closedPath,
		openPath:   openPath,
		allPath:    allPath,
		hasOpen:    hasOpen,
		hasClosed:  hasClosed,
	};

	layer._pathCache = cache;
	layer._pathCacheDirty = false;

	return cache;
};

// Mark a layer's cached paths as stale.
// Call after in-place mutations (node drags, structural edits).
// With no argument, invalidates the active layer.
FontRig.invalidatePathCache = function(layer) {
	if (layer) {
		layer._pathCacheDirty = true;
	} else {
		var al = FontRig.getActiveLayer();
		if (al) al._pathCacheDirty = true;
	}
};


// ===================================================================
// Layer Render — dispatches through the visualization layer system
// ===================================================================
FontRig.renderLayer = function(layer, opts) {
	// Sync legacy toggle flags to vizLayers map
	FontRig._syncVizFromState();

	// Dispatch to the registered visualization layers
	FontRig.drawVizLayers(layer, opts);
};

// ===================================================================
// Glyph Render
// ===================================================================
FontRig.draw = function() {
	const { canvas, ctx, canvasWrap } = FontRig.dom;
	if (!canvas || !ctx || !canvasWrap) return;  // no canvas (workplane popup)
	const state = FontRig.state;
	const dpr = window.devicePixelRatio || 1;
	const w = canvasWrap.clientWidth;
	const h = canvasWrap.clientHeight;

	canvas.width = w * dpr;
	canvas.height = h * dpr;
	canvas.style.width = w + 'px';
	canvas.style.height = h + 'px';
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

	// Clear — preview mode: white bg, black fill, no decorations
	var preview = state.previewMode;
	var t = FontRig.getCurrentTheme();
	ctx.fillStyle = preview ? t.bgPreview : FontRig.getBgColor();
	ctx.fillRect(0, 0, w, h);

	// Update glyph widget (works in all modes)
	FontRig.updateGlyphWidget();

	if (!state.glyphData) return;

	// Multi-view: delegate to split or joined renderer
	if (state.multiView || state.glyphViewMode) {
		if (state.glyphViewMode && FontRig.font) {
			FontRig.drawGlyphStrip(w, h);
		} else if (state.joinedView) {
			FontRig.drawJoinedView(w, h);
		} else {
			FontRig.drawSplitView(w, h);
		}
		return;
	}

	const layer = FontRig.getActiveLayer();
	if (!layer) return;

	FontRig.renderLayer(layer, {
					isActive: true,
					canvasW: w,
					canvasH: h
				});

};

// -- Metrics --------------------------------------------------------
FontRig.drawMetrics = function(layer, w, h) {
	const ctx = FontRig.dom.ctx;
	const t = FontRig.getCurrentTheme().metrics;
	const advW = layer.width;
	const advH = layer.height;

	// Baseline (y=0)
	const baseY = FontRig.glyphToScreen(0, 0).y;
	ctx.strokeStyle = t.baseline;
	ctx.lineWidth = t.lineWidth || 1;
	ctx.setLineDash(t.baselineDash || [6, 4]);
	ctx.beginPath();
	ctx.moveTo(0, baseY);
	ctx.lineTo(w, baseY);
	ctx.stroke();
	ctx.setLineDash([]);

	// Advance height line (y=advH)
	const topY = FontRig.glyphToScreen(0, advH).y;
	ctx.strokeStyle = t.baseline;
	ctx.setLineDash(t.baselineDash || [6, 4]);
	ctx.beginPath();
	ctx.moveTo(0, topY);
	ctx.lineTo(w, topY);
	ctx.stroke();
	ctx.setLineDash([]);

	// Font-level metrics (ascender, descender, x-height, cap-height)
	if (FontRig.font) {
		var fm = FontRig.font.metrics;
		var fmLines = [
			{ y: fm.ascender,  label: 'Asc',  color: t.fontMetricsColors.ascender },
			{ y: fm.descender, label: 'Desc', color: t.fontMetricsColors.descender },
			{ y: fm.xHeight,   label: 'xH',   color: t.fontMetricsColors.xHeight },
			{ y: fm.capHeight, label: 'CapH',  color: t.fontMetricsColors.capHeight }
		];
		ctx.lineWidth = t.lineWidth || 1;
		for (var i = 0; i < fmLines.length; i++) {
			var fy = FontRig.glyphToScreen(0, fmLines[i].y).y;
			ctx.strokeStyle = fmLines[i].color;
			ctx.setLineDash(t.fontMetricsDash || [3, 5]);
			ctx.beginPath();
			ctx.moveTo(0, fy);
			ctx.lineTo(w, fy);
			ctx.stroke();

			ctx.font = t.font;
			ctx.fillStyle = fmLines[i].color.replace(/[\d.]+\)$/, '0.5)');
			ctx.textAlign = 'right';
			ctx.fillText(fmLines[i].label + ' ' + fmLines[i].y, w - 6, fy - 3);
		}
		ctx.setLineDash([]);
	}

	// LSB line (x=0) — solid within UPM, fade beyond
	const lsbX = FontRig.glyphToScreen(0, 0).x;
	var descY = FontRig.font ? FontRig.font.metrics.descender : -200;
	var ascY = FontRig.font ? FontRig.font.metrics.ascender : 800;
	var fadeMargin = (ascY - descY) * 0.4;
	var sbTop = FontRig.glyphToScreen(0, ascY + fadeMargin).y;
	var sbAscY = FontRig.glyphToScreen(0, ascY).y;
	var sbDescY = FontRig.glyphToScreen(0, descY).y;
	var sbBot = FontRig.glyphToScreen(0, descY - fadeMargin).y;

	var lsbGrad = ctx.createLinearGradient(0, sbTop, 0, sbBot);
	lsbGrad.addColorStop(0, 'rgba(255,120,80,0)');
	lsbGrad.addColorStop((sbAscY - sbTop) / (sbBot - sbTop), t.sidebearing);
	lsbGrad.addColorStop((sbDescY - sbTop) / (sbBot - sbTop), t.sidebearing);
	lsbGrad.addColorStop(1, 'rgba(255,120,80,0)');
	ctx.strokeStyle = lsbGrad;
	ctx.lineWidth = t.lineWidth || 1;
	ctx.setLineDash(t.metricDash || [3, 3]);
	ctx.beginPath();
	ctx.moveTo(lsbX, sbTop);
	ctx.lineTo(lsbX, sbBot);
	ctx.stroke();
	ctx.setLineDash([]);

	// RSB / Advance width line — solid within UPM, fade beyond
	const rsbX = FontRig.glyphToScreen(advW, 0).x;
	var rsbGrad = ctx.createLinearGradient(0, sbTop, 0, sbBot);
	rsbGrad.addColorStop(0, 'rgba(91,157,235,0)');
	rsbGrad.addColorStop((sbAscY - sbTop) / (sbBot - sbTop), t.advance);
	rsbGrad.addColorStop((sbDescY - sbTop) / (sbBot - sbTop), t.advance);
	rsbGrad.addColorStop(1, 'rgba(91,157,235,0)');
	ctx.strokeStyle = rsbGrad;
	ctx.setLineDash(t.metricDash || [3, 3]);
	ctx.beginPath();
	ctx.moveTo(rsbX, sbTop);
	ctx.lineTo(rsbX, sbBot);
	ctx.stroke();
	ctx.setLineDash([]);

	// Labels
	ctx.font = t.labelFont || '10px "JetBrains Mono", monospace';

	ctx.fillStyle = t.labelAdvance;
	ctx.textAlign = 'right';
	var labelY = FontRig.glyphToScreen(0, -30).y;
	ctx.fillText(`ADV ${advW}`, rsbX - 4, labelY);
};

// -- Contours -------------------------------------------------------
// Uses cached Path2D objects rendered via ctx.transform() so that
// paths are only rebuilt when the glyph data actually changes, not
// on every pan/zoom/redraw.
FontRig.drawContours = function(layer) {
	var ctx = FontRig.dom.ctx;
	var t = FontRig.getCurrentTheme().contour;
	var preview = FontRig.state.previewMode;
	var paths = FontRig._getLayerPaths(layer);
	if (!paths) return;

	var zoom = FontRig.state.zoom;

	// Apply font→screen transform: scale by zoom, flip Y, translate by pan.
	// Composes with the existing DPR transform set in draw().
	ctx.save();
	ctx.transform(zoom, 0, 0, -zoom, FontRig.state.pan.x, FontRig.state.pan.y);

	if (preview || FontRig.state.filled) {
		// Filled mode: closed contours in ONE path; nonzero winding rule
		if (paths.hasClosed) {
			ctx.fillStyle = preview ? '#000000' : t.fill;
			ctx.fill(paths.closedPath, 'nonzero');
			if (!preview) {
				ctx.strokeStyle = t.stroke;
				ctx.lineWidth = (t.lineWidth || 1) / zoom;
				ctx.stroke(paths.closedPath);
			}
		}

		// Open contours: stroke only (hidden in preview)
		if (!preview && paths.hasOpen) {
			ctx.strokeStyle = t.strokePlain || t.stroke;
			ctx.lineWidth = ((t.lineWidth || 1) + 0.5) / zoom;
			ctx.stroke(paths.openPath);
		}
	} else {
		// Outline mode: stroke all contours
		ctx.strokeStyle = t.strokePlain;
		ctx.lineWidth = 1.5 / zoom;
		ctx.stroke(paths.allPath);
	}

	ctx.restore();
};

FontRig.buildContourPath = function(contour) {
	const ctx = FontRig.dom.ctx;
	const nodes = contour.nodes;
	if (nodes.length === 0) return;

	// Types: 'on' = on-curve, 'curve' = cubic BCP, 'off' = quadratic off-curve
	const n = nodes.length;

	// Find first on-curve
	let firstOn = 0;
	for (let j = 0; j < n; j++) {
		if (nodes[j].type === 'on') { firstOn = j; break; }
	}

	const sp = FontRig.glyphToScreen(nodes[firstOn].x, nodes[firstOn].y);
	ctx.moveTo(sp.x, sp.y);

	let i = (firstOn + 1) % n;
	let count = 0;

	while (count < n - 1) {
		const node = nodes[i];

		if (node.type === 'on') {
			const p = FontRig.glyphToScreen(node.x, node.y);
			ctx.lineTo(p.x, p.y);

		} else if (node.type === 'curve') {
			// Cubic: two BCPs then on-curve
			const bcp1 = node;
			const bcp2 = nodes[(i + 1) % n];
			const onCurve = nodes[(i + 2) % n];
			const p1 = FontRig.glyphToScreen(bcp1.x, bcp1.y);
			const p2 = FontRig.glyphToScreen(bcp2.x, bcp2.y);
			const p3 = FontRig.glyphToScreen(onCurve.x, onCurve.y);
			ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
			i = (i + 2) % n;
			count += 2;

		} else if (node.type === 'off') {
			// Quadratic: single off-curve then on-curve
			const offNode = node;
			const onCurve = nodes[(i + 1) % n];
			const p1 = FontRig.glyphToScreen(offNode.x, offNode.y);
			const p2 = FontRig.glyphToScreen(onCurve.x, onCurve.y);
			ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
			i = (i + 1) % n;
			count += 1;
		}

		i = (i + 1) % n;
		count++;
	}

	if (contour.closed) ctx.closePath();
};


// -- Highlighted segments (between selected on-curves) --------------
FontRig.drawSelectedSegments = function(layer) {
	var ctx = FontRig.dom.ctx;
	var sel = FontRig.state.selectedNodeIds;
	if (sel.size === 0) return;

	var ci = 0;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			var contour = shape.contours[ki];
			var segs = FontRig.getContourSegments(contour);

			for (var gi = 0; gi < segs.length; gi++) {
				var seg = segs[gi];
				var startId = 'c' + ci + '_n' + seg.startIdx;
				var endId = 'c' + ci + '_n' + seg.endIdx;

				// Highlight if both endpoints are selected
				if (!sel.has(startId) || !sel.has(endId)) continue;

				ctx.save();
				ctx.beginPath();

				var sp = FontRig.glyphToScreen(seg.pts[0].x, seg.pts[0].y);
				ctx.moveTo(sp.x, sp.y);

				if (seg.type === 'line') {
					var ep = FontRig.glyphToScreen(seg.pts[1].x, seg.pts[1].y);
					ctx.lineTo(ep.x, ep.y);
				} else if (seg.type === 'cubic') {
					var p1 = FontRig.glyphToScreen(seg.pts[1].x, seg.pts[1].y);
					var p2 = FontRig.glyphToScreen(seg.pts[2].x, seg.pts[2].y);
					var p3 = FontRig.glyphToScreen(seg.pts[3].x, seg.pts[3].y);
					ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
				} else if (seg.type === 'quadratic') {
					var p1 = FontRig.glyphToScreen(seg.pts[1].x, seg.pts[1].y);
					var p2 = FontRig.glyphToScreen(seg.pts[2].x, seg.pts[2].y);
					ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
				}

				// Glow effect: wide soft stroke underneath
				ctx.strokeStyle = 'rgba(220, 60, 60, 0.3)';
				ctx.lineWidth = 6;
				ctx.lineCap = 'round';
				ctx.stroke();

				// Sharp stroke on top
				ctx.strokeStyle = 'rgba(220, 60, 60, 0.8)';
				ctx.lineWidth = 2;
				ctx.stroke();

				ctx.restore();
			}
			ci++;
		}
	}
};


// -- Stacked node warning glow --------------------------------------
// Highlights nodes that overlap or are within 2 units of another node.
// Static red glow — no animation.
FontRig.drawStackedWarnings = function(layer) {
	var ctx = FontRig.dom.ctx;
	var allNodes = FontRig.getAllNodes(layer);
	var n = allNodes.length;
	if (n < 2) return;

	// Find stacked pairs (within 2 glyph units)
	var stacked = new Set();
	for (var i = 0; i < n; i++) {
		for (var j = i + 1; j < n; j++) {
			var dx = allNodes[i].x - allNodes[j].x;
			var dy = allNodes[i].y - allNodes[j].y;
			if (dx * dx + dy * dy <= 4.0) {
				stacked.add(i);
				stacked.add(j);
			}
		}
	}

	if (stacked.size === 0) return;

	ctx.save();
	for (var idx of stacked) {
		var node = allNodes[idx];
		var sp = FontRig.glyphToScreen(node.x, node.y);

		ctx.beginPath();
		ctx.arc(sp.x, sp.y, 12, 0, Math.PI * 2);
		ctx.fillStyle = 'rgba(220, 50, 50, 0.15)';
		ctx.fill();

		ctx.beginPath();
		ctx.arc(sp.x, sp.y, 7, 0, Math.PI * 2);
		ctx.fillStyle = 'rgba(220, 50, 50, 0.3)';
		ctx.fill();
	}
	ctx.restore();
};

// -- Nodes & handles ------------------------------------------------
// Split into three independent functions for the visualization layer
// system. The combined drawNodes() is kept for backward compat.

// Pass 1: Handle lines (off-curve → on-curve connections)
FontRig._drawHandleLines = function(layer) {
	const ctx = FontRig.dom.ctx;
	const tn = FontRig.getCurrentTheme().node;

	for (const shape of layer.shapes) {
		for (const contour of shape.contours) {
			const isHobbyKind = contour.kind === 'hobby';
			const segKind = isHobbyKind ? (contour._segmentKindMap || null) : null;

			const nodes = contour.nodes;
			const n = nodes.length;

			for (let ni = 0; ni < n; ni++) {
				const node = nodes[ni];

				// Hobby: only draw handle lines for off-curves on
				// fixed segments — solver-driven hobby/line off-curves
				// aren't editable and shouldn't suggest they are.
				if (isHobbyKind) {
					if (node.type === 'on') continue;
					if (!segKind || segKind[ni] !== 'fixed') continue;
				}

				if (node.type === 'curve') {
					const sp = FontRig.glyphToScreen(node.x, node.y);
					const prevIdx = (ni - 1 + n) % n;
					const nextIdx = (ni + 1) % n;
					const prev = nodes[prevIdx];
					const next = nodes[nextIdx];

					if (prev.type === 'on') {
						const pp = FontRig.glyphToScreen(prev.x, prev.y);
						ctx.strokeStyle = tn.handleLine;
						ctx.lineWidth = tn.handleWidth;
						ctx.beginPath();
						ctx.moveTo(pp.x, pp.y);
						ctx.lineTo(sp.x, sp.y);
						ctx.stroke();
					}

					if (next.type === 'on') {
						const np = FontRig.glyphToScreen(next.x, next.y);
						ctx.strokeStyle = tn.handleLine;
						ctx.lineWidth = tn.handleWidth;
						ctx.beginPath();
						ctx.moveTo(sp.x, sp.y);
						ctx.lineTo(np.x, np.y);
						ctx.stroke();
					}

				} else if (node.type === 'off') {
					const sp = FontRig.glyphToScreen(node.x, node.y);
					const prevIdx = (ni - 1 + n) % n;
					const nextIdx = (ni + 1) % n;

					if (nodes[prevIdx].type === 'on') {
						const pp = FontRig.glyphToScreen(nodes[prevIdx].x, nodes[prevIdx].y);
						ctx.strokeStyle = tn.handleLine;
						ctx.lineWidth = tn.handleWidth;
						ctx.beginPath();
						ctx.moveTo(pp.x, pp.y);
						ctx.lineTo(sp.x, sp.y);
						ctx.stroke();
					}

					if (nodes[nextIdx].type === 'on') {
						const np = FontRig.glyphToScreen(nodes[nextIdx].x, nodes[nextIdx].y);
						ctx.strokeStyle = tn.handleLine;
						ctx.lineWidth = tn.handleWidth;
						ctx.beginPath();
						ctx.moveTo(sp.x, sp.y);
						ctx.lineTo(np.x, np.y);
						ctx.stroke();
					}
				}
			}
		}
	}
};

// Pass 2: Node markers (on-curve squares/circles, off-curve circles)
FontRig._drawNodeMarkers = function(layer) {
	const ctx = FontRig.dom.ctx;
	const sel = FontRig.state.selectedNodeIds;
	const tn = FontRig.getCurrentTheme().node;

	let ci = 0;
	for (const shape of layer.shapes) {
		for (const contour of shape.contours) {
			const nodes = contour.nodes;
			const n = nodes.length;
			const isHobby = contour.kind === 'hobby';

			// Find first on-curve (start point — drawn as triangle separately)
			let firstOn = 0;
			for (let j = 0; j < n; j++) {
				if (nodes[j].type === 'on') { firstOn = j; break; }
			}
			const startNode = nodes[firstOn];

			for (let ni = 0; ni < n; ni++) {
				const node = nodes[ni];

				// Hobby: on-curves are knots; off-curves on fixed segments
				// behave like regular cubic BCPs (editable / hit-testable).
				// Off-curves on hobby/line segments stay hidden.
				if (isHobby && node.type !== 'on') {
					var skMap = contour._segmentKindMap;
					if (!skMap || skMap[ni] !== 'fixed') continue;
				}

				// Render the start node like any other; the ring + arrow
				// (drawn by _drawStartPoints) sits around it.

				// Skip end node if it overlaps the start node
				if (ni === n - 1 && node.x === startNode.x && node.y === startNode.y) {
					continue;
				}

				const id = `c${ci}_n${ni}`;
				const sp = FontRig.glyphToScreen(node.x, node.y);
				const isSelected = sel.has(id);
				const r = isSelected ? tn.radius + 1 : tn.radius;

				if (node.type === 'on') {
					ctx.fillStyle = isSelected ? tn.selected : (node.smooth ? tn.onSmooth : tn.onCorner);
					ctx.strokeStyle = isSelected ? tn.selected : tn.outline;
					ctx.lineWidth = tn.strokeWidth;

					if (isHobby) {
						// Knot marker: pentagon (matches the drawing-tool
						// preview). Filled = hobby segment going OUT of
						// this knot, hollow = line / fixed.
						var ki = (contour._knotMap && contour._knotMap[ni] != null)
							? contour._knotMap[ni] : null;
						var seg = (ki != null && contour.knots && contour.knots[ki])
							? (contour.knots[ki].segment_type || 'hobby')
							: 'hobby';
						var hollow = (seg === 'line' || seg === 'fixed');

						// Per-segment-type colour with sensible fallbacks
						// to onCorner (so the user's regular node colour
						// applies). Selection always wins.
						var knotKey = (seg === 'line') ? 'knotLine'
									: (seg === 'fixed') ? 'knotFixed'
									: 'knotHobby';
						var knotColor = isSelected
							? tn.selected
							: (tn[knotKey] || tn.onCorner);

						if (hollow) {
							// No fill — the stroke IS the visible mark,
							// so it must use the body colour, not the
							// thin "outline" border colour.
							ctx.strokeStyle = knotColor;
							ctx.lineWidth = tn.knotStrokeWidth || tn.strokeWidth || 1.5;
						} else {
							ctx.fillStyle = knotColor;
							ctx.strokeStyle = isSelected ? tn.selected : tn.outline;
							ctx.lineWidth = tn.strokeWidth;
						}

						FontRig.drawTool._drawPentagon(ctx, sp.x, sp.y, r + 1, hollow);

						if (seg === 'fixed') {
							// Inner dot distinguishes fixed from line.
							ctx.fillStyle = knotColor;
							ctx.beginPath();
							ctx.arc(sp.x, sp.y, 1.5, 0, Math.PI * 2);
							ctx.fill();
						}
					} else if (node.smooth) {
						ctx.beginPath();
						ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
						ctx.fill();
						ctx.stroke();
					} else {
						ctx.fillRect(sp.x - r, sp.y - r, r * 2, r * 2);
						ctx.strokeRect(sp.x - r, sp.y - r, r * 2, r * 2);
					}
				} else {
					ctx.fillStyle = isSelected ? tn.selected : tn.offCurve;
					ctx.strokeStyle = isSelected ? tn.selected : tn.outline;
					ctx.lineWidth = tn.strokeWidth;
					ctx.beginPath();
					ctx.arc(sp.x, sp.y, r - 1, 0, Math.PI * 2);
					ctx.fill();
					ctx.stroke();
				}
			}
			ci++;
		}
	}
};

// Pass 3: Start point triangles
FontRig._drawStartPoints = function(layer) {
	const ctx = FontRig.dom.ctx;
	const sel = FontRig.state.selectedNodeIds;
	const tn = FontRig.getCurrentTheme().node;

	let ci = 0;
	for (const shape of layer.shapes) {
		for (const contour of shape.contours) {
			const nodes = contour.nodes;
			const n = nodes.length;
			if (n < 2) { ci++; continue; }

			let firstOn = 0;
			for (let j = 0; j < n; j++) {
				if (nodes[j].type === 'on') { firstOn = j; break; }
			}

			const startNode = nodes[firstOn];

			// Ring + arrow around the start node — the male-symbol mark.
			// Direction is toward the next bezier-shadow node: an off-
			// curve when present (gives the tangent), otherwise the
			// next on-curve (chord direction).
			const sp = FontRig.glyphToScreen(startNode.x, startNode.y);
			const tangentNode = nodes[(firstOn + 1) % n];
			const tp = FontRig.glyphToScreen(tangentNode.x, tangentNode.y);
			const ang = Math.atan2(tp.y - sp.y, tp.x - sp.x);

			const isStartSelected = sel.has('c' + ci + '_n' + firstOn);

			const R = (tn.radius || 4) + 4;
			const shaftLen = 8;
			const headLen = 7;
			const headSpread = 0.55;
			const sx0 = sp.x + R * Math.cos(ang);
			const sy0 = sp.y + R * Math.sin(ang);
			const ex = sp.x + (R + shaftLen) * Math.cos(ang);
			const ey = sp.y + (R + shaftLen) * Math.sin(ang);

			ctx.save();
			ctx.strokeStyle = isStartSelected ? tn.selected : (tn.startPoint || tn.outline);
			ctx.lineWidth = 1.25;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';

			// Ring
			ctx.beginPath();
			ctx.arc(sp.x, sp.y, R, 0, Math.PI * 2);
			ctx.stroke();

			// Shaft
			ctx.beginPath();
			ctx.moveTo(sx0, sy0);
			ctx.lineTo(ex, ey);
			ctx.stroke();

			// Filled triangular arrowhead
			const hx1 = ex - headLen * Math.cos(ang - headSpread);
			const hy1 = ey - headLen * Math.sin(ang - headSpread);
			const hx2 = ex - headLen * Math.cos(ang + headSpread);
			const hy2 = ey - headLen * Math.sin(ang + headSpread);
			ctx.beginPath();
			ctx.moveTo(ex, ey);
			ctx.lineTo(hx1, hy1);
			ctx.lineTo(hx2, hy2);
			ctx.closePath();
			ctx.fillStyle = isStartSelected ? tn.selected : (tn.startPoint || tn.outline);
			ctx.fill();
			ctx.stroke();

			ctx.restore();
			ci++;
		}
	}
};

// Pass 4: Hobby direction handles --------------------------------------
// Renders a thin tangent line + dot for each pinned hobby-knot side,
// and a dashed/hollow stub for selected-but-free knots so the user
// has a target to grab. Solid-filled = pinned, dashed-hollow = free
// hint based on the solved tangent.
FontRig._drawHobbyDirectionHandles = function(layer) {
	if (!layer || !layer.shapes) return;
	var ctx = FontRig.dom.ctx;
	var sel = FontRig.state.selectedNodeIds;
	var tn = FontRig.getCurrentTheme().node;

	var ci = 0;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki2 = 0; ki2 < shape.contours.length; ki2++) {
			var contour = shape.contours[ki2];
			if (contour.kind !== 'hobby' || !contour.knots) { ci++; continue; }
			if (!contour._knotMap) { ci++; continue; }

			for (var ki = 0; ki < contour.knots.length; ki++) {
				var knot = contour.knots[ki];

				// Find the bezier-shadow node id so we can check
				// selection. There's exactly one on-curve per knot.
				var nodeIdx = FontRig._knotIndexToNodeIndex(contour, ki);
				if (nodeIdx < 0) continue;
				var nodeId = 'c' + ci + '_n' + nodeIdx;
				var isSelected = sel.has(nodeId);

				var hasOut = (knot.dir_out != null);
				var hasIn  = (knot.dir_in  != null);

				// Suppress direction handles on sides bordering a fixed
				// segment — the BCP handle IS the direction, a separate
				// dir handle would just collide visually.
				var nKnots = contour.knots.length;
				var prevKi = (ki - 1 + nKnots) % nKnots;
				var fixedOnOut = (knot.segment_type === 'fixed');
				var fixedOnIn  = (contour.knots[prevKi]
					&& contour.knots[prevKi].segment_type === 'fixed');
				// Open contour: no incoming segment for ki==0, no outgoing for ki==last.
				if (!contour.closed) {
					if (ki === 0) fixedOnIn = false;
					if (ki === nKnots - 1) fixedOnOut = false;
				}

				// Skip entirely if the knot is free and not selected.
				if (!hasOut && !hasIn && !isSelected) continue;

				var sp = FontRig.glyphToScreen(knot.x, knot.y);

				// Render each side independently.
				['out', 'in'].forEach(function(side) {
					var fixedAdjacent = (side === 'out') ? fixedOnOut : fixedOnIn;
					if (fixedAdjacent) return;
					var pinned = (side === 'out') ? hasOut : hasIn;
					// Hint stubs only when selected; pinned always shown.
					if (!pinned && !isSelected) return;

					var endP = FontRig.computeKnotDirHandlePos(contour, ki, side);

					ctx.save();
					ctx.strokeStyle = pinned
						? (tn.knotHobby || tn.onCorner)
						: (tn.handleLine || 'rgba(91,157,239,0.45)');
					ctx.lineWidth = pinned ? 1.5 : 1;
					if (!pinned) ctx.setLineDash([3, 3]);

					ctx.beginPath();
					ctx.moveTo(sp.x, sp.y);
					ctx.lineTo(endP.x, endP.y);
					ctx.stroke();

					ctx.setLineDash([]);

					// Dot at the end — filled if pinned, hollow ring otherwise.
					ctx.beginPath();
					ctx.arc(endP.x, endP.y, 3.5, 0, Math.PI * 2);
					if (pinned) {
						ctx.fillStyle = (tn.knotHobby || tn.onCorner);
						ctx.fill();
						ctx.strokeStyle = tn.outline;
						ctx.lineWidth = 1;
						ctx.stroke();
					} else {
						ctx.fillStyle = 'rgba(0,0,0,0)';
						ctx.fill();
						ctx.strokeStyle = (tn.handleLine || 'rgba(91,157,239,0.7)');
						ctx.lineWidth = 1.25;
						ctx.stroke();
					}
					ctx.restore();
				});
			}
			ci++;
		}
	}
};

// Combined (backward compat — used by preview nodes path)
FontRig.drawNodes = function(layer) {
	FontRig._drawHandleLines(layer);
	FontRig._drawNodeMarkers(layer);
	FontRig._drawStartPoints(layer);
};


// -- Preview mode: proximity-reveal nodes ---------------------------
// Draws nodes/handles with opacity based on distance to cursor.
// Closer = brighter; beyond REVEAL_RADIUS = invisible.
FontRig.PREVIEW_REVEAL_RADIUS = 120; // screen pixels

FontRig.drawPreviewNodes = function(layer) {
	var mouse = FontRig.state.previewMouse;
	if (!mouse) return;

	var ctx = FontRig.dom.ctx;
	var sel = FontRig.state.selectedNodeIds;
	var tn = FontRig.getCurrentTheme().node;
	var radius = FontRig.PREVIEW_REVEAL_RADIUS;
	var savedAlpha = ctx.globalAlpha;

	// Helper: distance-based alpha (quadratic falloff)
	function nodeAlpha(sp) {
		var dx = sp.x - mouse.x;
		var dy = sp.y - mouse.y;
		var dist = Math.sqrt(dx * dx + dy * dy);
		var a = 1 - dist / radius;
		return a > 0 ? a * a : 0;
	}

	// -- Pass 1: handle lines --
	var ci = 0;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			var contour = shape.contours[ki];
			// Hobby contours: only fixed-segment off-curves are editable.
			// All other off-curves are solver artefacts — skip them in
			// the proximity reveal.
			var isHobbyKind = contour.kind === 'hobby';
			var skMap = isHobbyKind ? (contour._segmentKindMap || null) : null;
			var nodes = contour.nodes;
			var n = nodes.length;

			for (var ni = 0; ni < n; ni++) {
				var node = nodes[ni];
				if (node.type !== 'curve' && node.type !== 'off') continue;
				if (isHobbyKind && (!skMap || skMap[ni] !== 'fixed')) continue;

				var sp = FontRig.glyphToScreen(node.x, node.y);
				var a = nodeAlpha(sp);
				if (a <= 0) continue;

				ctx.globalAlpha = a;
				ctx.strokeStyle = tn.handleLine;
				ctx.lineWidth = 1;

				var prevIdx = (ni - 1 + n) % n;
				var nextIdx = (ni + 1) % n;

				if (nodes[prevIdx].type === 'on') {
					var pp = FontRig.glyphToScreen(nodes[prevIdx].x, nodes[prevIdx].y);
					ctx.beginPath();
					ctx.moveTo(pp.x, pp.y);
					ctx.lineTo(sp.x, sp.y);
					ctx.stroke();
				}

				if (nodes[nextIdx].type === 'on') {
					var np = FontRig.glyphToScreen(nodes[nextIdx].x, nodes[nextIdx].y);
					ctx.beginPath();
					ctx.moveTo(sp.x, sp.y);
					ctx.lineTo(np.x, np.y);
					ctx.stroke();
				}
			}
			ci++;
		}
	}

	// -- Pass 2: node markers --
	ci = 0;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			var contour = shape.contours[ki];
			var nodes = contour.nodes;
			var n = nodes.length;
			var isHobby = contour.kind === 'hobby';

			var firstOn = 0;
			for (var j = 0; j < n; j++) {
				if (nodes[j].type === 'on') { firstOn = j; break; }
			}

			for (var ni = 0; ni < n; ni++) {
				// Bezier: start point is drawn as a triangle separately.
				// Hobby: start knot is rendered like the others (with a
				// ring overlay), so don't skip it.
				if (!isHobby && ni === firstOn) continue;

				var node = nodes[ni];
				if (isHobby && node.type !== 'on') {
					var skMap2 = contour._segmentKindMap;
					if (!skMap2 || skMap2[ni] !== 'fixed') continue;
				}
				var startNode = nodes[firstOn];

				if (ni === n - 1 && node.x === startNode.x && node.y === startNode.y) continue;

				var sp = FontRig.glyphToScreen(node.x, node.y);
				var a = nodeAlpha(sp);
				if (a <= 0) continue;

				var id = 'c' + ci + '_n' + ni;
				var isSelected = sel.has(id);
				var r = isSelected ? 5 : (node.type === 'on' ? 4 : 3);

				ctx.globalAlpha = a;

				if (node.type === 'on') {
					ctx.fillStyle = isSelected ? tn.selected : (node.smooth ? tn.onSmooth : tn.onCorner);
					ctx.strokeStyle = isSelected ? tn.selected : tn.outline;
					ctx.lineWidth = 1;

					if (node.smooth) {
						ctx.beginPath();
						ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
						ctx.fill();
						ctx.stroke();
					} else {
						ctx.fillRect(sp.x - r, sp.y - r, r * 2, r * 2);
						ctx.strokeRect(sp.x - r, sp.y - r, r * 2, r * 2);
					}
				} else {
					ctx.fillStyle = isSelected ? tn.selected : tn.offCurve;
					ctx.strokeStyle = isSelected ? tn.selected : tn.outline;
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
					ctx.fill();
					ctx.stroke();
				}
			}
			ci++;
		}
	}

	// -- Pass 3: start point triangles --
	ci = 0;
	for (var si = 0; si < layer.shapes.length; si++) {
		var shape = layer.shapes[si];
		for (var ki = 0; ki < shape.contours.length; ki++) {
			var contour = shape.contours[ki];
			var nodes = contour.nodes;
			var n = nodes.length;
			if (n < 2) { ci++; continue; }

			var firstOn = 0;
			for (var j = 0; j < n; j++) {
				if (nodes[j].type === 'on') { firstOn = j; break; }
			}

			var startNode = nodes[firstOn];
			var nextNode = nodes[(firstOn + 1) % n];
			var sp = FontRig.glyphToScreen(startNode.x, startNode.y);
			var a = nodeAlpha(sp);
			if (a <= 0) { ci++; continue; }

			var np = FontRig.glyphToScreen(nextNode.x, nextNode.y);
			var dx = np.x - sp.x;
			var dy = np.y - sp.y;
			var angle = Math.atan2(dy, dx);
			var isStartSelected = sel.has('c' + ci + '_n' + firstOn);
			var size = tn.startSize;

			ctx.globalAlpha = a;
			ctx.save();
			ctx.translate(sp.x, sp.y);
			ctx.rotate(angle);

			ctx.beginPath();
			ctx.moveTo(size + 4, 0);
			ctx.lineTo(-size + 2, -size + 1);
			ctx.lineTo(-size + 2, size - 1);
			ctx.closePath();

			ctx.fillStyle = isStartSelected ? tn.selected : tn.startPoint;
			ctx.fill();
			ctx.strokeStyle = tn.outline;
			ctx.lineWidth = 1;
			ctx.stroke();

			ctx.restore();
			ci++;
		}
	}

	ctx.globalAlpha = savedAlpha;
};

// -- Anchors --------------------------------------------------------
FontRig.drawAnchors = function(layer) {
	if (!layer.anchors || layer.anchors.length === 0) return;
	const ctx = FontRig.dom.ctx;
	const ta = FontRig.getCurrentTheme().anchor;

	for (const anchor of layer.anchors) {
		const sp = FontRig.glyphToScreen(anchor.x, anchor.y);
		const size = 6;

		ctx.fillStyle = ta.fill;
		ctx.strokeStyle = ta.outline;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(sp.x, sp.y - size);
		ctx.lineTo(sp.x + size, sp.y);
		ctx.lineTo(sp.x, sp.y + size);
		ctx.lineTo(sp.x - size, sp.y);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();

		ctx.strokeStyle = ta.crosshair;
		ctx.setLineDash([3, 3]);
		ctx.beginPath();
		ctx.moveTo(sp.x - 12, sp.y);
		ctx.lineTo(sp.x + 12, sp.y);
		ctx.moveTo(sp.x, sp.y - 12);
		ctx.lineTo(sp.x, sp.y + 12);
		ctx.stroke();
		ctx.setLineDash([]);

		ctx.font = '10px "JetBrains Mono", monospace';
		ctx.fillStyle = ta.label;
		ctx.textAlign = 'left';
		ctx.fillText(anchor.name, sp.x + size + 4, sp.y + 3);
	}
};

// -- Selection overlay (rect or lasso) ------------------------------
FontRig.drawSelectionOverlay = function() {
	const ctx = FontRig.dom.ctx;
	const state = FontRig.state;
	const ts = FontRig.getCurrentTheme().selection;

	ctx.save();

	if (state.selectMode === 'rect' && state.selectStartScreen && state.selectCurrentScreen) {
		const x1 = state.selectStartScreen.x;
		const y1 = state.selectStartScreen.y;
		const x2 = state.selectCurrentScreen.x;
		const y2 = state.selectCurrentScreen.y;

		// Semi-transparent fill
		ctx.fillStyle = ts.fill;
		ctx.fillRect(
			Math.min(x1, x2), Math.min(y1, y2),
			Math.abs(x2 - x1), Math.abs(y2 - y1)
		);

		// Dashed border
		ctx.strokeStyle = ts.stroke;
		ctx.lineWidth = ts.strokeWidth || 1;
		ctx.setLineDash([4, 3]);
		ctx.strokeRect(
			Math.min(x1, x2), Math.min(y1, y2),
			Math.abs(x2 - x1), Math.abs(y2 - y1)
		);
		ctx.setLineDash([]);

	} else if (state.selectMode === 'lasso' && state.selectLassoPoints.length > 1) {
		const pts = state.selectLassoPoints;

		// Semi-transparent fill
		ctx.fillStyle = ts.fill;
		ctx.beginPath();
		ctx.moveTo(pts[0].x, pts[0].y);
		for (let i = 1; i < pts.length; i++) {
			ctx.lineTo(pts[i].x, pts[i].y);
		}
		ctx.closePath();
		ctx.fill();

		// Dashed border
		ctx.strokeStyle = ts.stroke;
		ctx.lineWidth = 1;
		ctx.setLineDash([4, 3]);
		ctx.beginPath();
		ctx.moveTo(pts[0].x, pts[0].y);
		for (let i = 1; i < pts.length; i++) {
			ctx.lineTo(pts[i].x, pts[i].y);
		}
		ctx.closePath();
		ctx.stroke();
		ctx.setLineDash([]);
	}

	ctx.restore();
};

// -- Mask contours (underneath main layer) --------------------------
FontRig.drawMaskContours = function(maskLayer) {
	if (!maskLayer) return;
	var paths = FontRig._getLayerPaths(maskLayer);
	if (!paths) return;

	var ctx = FontRig.dom.ctx;
	var tm = FontRig.getCurrentTheme().mask;
	var zoom = FontRig.state.zoom;

	ctx.save();
	ctx.transform(zoom, 0, 0, -zoom, FontRig.state.pan.x, FontRig.state.pan.y);
	ctx.strokeStyle = tm.stroke;
	ctx.lineWidth = tm.lineWidth / zoom;
	ctx.stroke(paths.allPath);
	ctx.restore();
};

// -- Layer name label (filled badge, centered below baseline) -------
FontRig.drawLayerLabel = function(layer) {
	const ctx = FontRig.dom.ctx;
	const tl = FontRig.getCurrentTheme().label;
	if (!FontRig.state.glyphData) return;

	const layers = FontRig.state.glyphData.layers;
	const idx = layers.indexOf(layer);
	const color = FontRig.getLayerColor(idx >= 0 ? idx : 0);
	const name = layer.name || '(unnamed)';

	// Position: centered on advance width, below baseline
	const cx = layer.width / 2;
	const labelGy = -30; // 30 units below baseline
	const pos = FontRig.glyphToScreen(cx, labelGy);

	ctx.font = tl.font;
	const textW = ctx.measureText(name).width;
	const padX = 6;
	const padY = 3;
	const boxW = textW + padX * 2;
	const boxH = 14 + padY * 2;
	const boxX = pos.x - boxW / 2;
	const boxY = pos.y - boxH / 2;
	const radius = 3;

	// Filled rounded rect background
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.moveTo(boxX + radius, boxY);
	ctx.lineTo(boxX + boxW - radius, boxY);
	ctx.quadraticCurveTo(boxX + boxW, boxY, boxX + boxW, boxY + radius);
	ctx.lineTo(boxX + boxW, boxY + boxH - radius);
	ctx.quadraticCurveTo(boxX + boxW, boxY + boxH, boxX + boxW - radius, boxY + boxH);
	ctx.lineTo(boxX + radius, boxY + boxH);
	ctx.quadraticCurveTo(boxX, boxY + boxH, boxX, boxY + boxH - radius);
	ctx.lineTo(boxX, boxY + radius);
	ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
	ctx.closePath();
	ctx.fill();

	// Label text
	ctx.fillStyle = tl.textColor;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(name, pos.x, pos.y);
	ctx.textBaseline = 'alphabetic'; // reset
};
