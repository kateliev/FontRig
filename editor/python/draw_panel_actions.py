# MODULE: TypeRig / Core / Actions / Draw Panel
# -----------------------------------------------------------
# (C) Vassil Kateliev, 2017-2026 	(http://www.kateliev.com)
# (C) Karandash Type Foundry 		(http://www.karandash.eu)
#------------------------------------------------------------
# www.typerig.com
#
# FontRig draw panel dispatchers. Bridges JS-side draw tools to
# typerig.core.actions.draw_actions for committed (Hobby) results.
#
# This module currently lives under editor/python/ in the FontRig
# repo (loaded as a localModule by pyodide-bridge.js). Once stable
# it can be moved into TypeRig core proper at
#   Lib/typerig/core/actions/draw_panel_actions.py
# and removed from localModules.

from __future__ import absolute_import, print_function, division

import json

from typerig.core.objects.shape import Shape
from typerig.core.objects.contour import Contour
from typerig.core.objects.node import Node
from typerig.core.objects.hobbyspline import HobbyKnot
from typerig.core.actions.draw_actions import HobbyDrawActions

__version__ = '0.2'

# -- Helpers -------------------------------------------------------------------
def _iter_scope_layers(glyph, scope_layers):
	'''Yield Layer objects matching the requested scope names.'''
	if not scope_layers:
		return
	for name in scope_layers:
		try:
			lyr = glyph.layer(name)
		except Exception:
			lyr = None
		if lyr is not None:
			yield lyr


def _normalize_knots(raw):
	'''Accept either a JSON string or a Python list. Each knot may be
	either an [x, y] pair (defaults to hobby segment) or a
	{"position": [x, y], "segment": "hobby"|"line", ...} dict.
	Returns a list of dicts with at least 'position' set, preserving
	any per-knot fields (segment, alpha, beta, etc.) for hobby_path_mixed.
	'''
	if isinstance(raw, str):
		raw = json.loads(raw)

	out = []
	for k in raw:
		if isinstance(k, dict):
			pos = k.get('position') or k.get('pos')
			if not pos or len(pos) < 2:
				continue
			entry = {'position': (float(pos[0]), float(pos[1]))}
			for key in ('segment', 'alpha', 'beta', 'bcp_out', 'bcp_in',
			            'dir_out', 'dir_in'):
				if key in k:
					entry[key] = k[key]
			out.append(entry)
		elif hasattr(k, '__len__') and len(k) >= 2:
			out.append({'position': (float(k[0]), float(k[1]))})
	return out


def _has_per_knot_data(knots):
	'''True if any knot carries metadata beyond position — meaning we
	need hobby_path_mixed instead of the simpler hobby_path.'''
	for k in knots:
		if len(k) > 1:  # more than just 'position'
			return True
	return False


def _solve_hobby_contour(knots, closed=False, tension=1.0):
	'''Build a HobbySpline from normalized knot dicts and convert to
	a Contour. Returns the Contour or None on failure.'''
	if len(knots) < 2:
		return None

	if _has_per_knot_data(knots):
		spline = HobbyDrawActions.hobby_path_mixed(
			knots, closed=bool(closed), tension=float(tension)
		)
	else:
		positions = [k['position'] for k in knots]
		spline = HobbyDrawActions.hobby_path(
			positions, closed=bool(closed), tension=float(tension)
		)

	if spline is None:
		return None

	return HobbyDrawActions.hobby_to_contour(spline)


def _build_hobby_knot(entry, tension):
	'''Build a HobbyKnot from a normalized knot dict. Tension applies
	to alpha/beta only when the entry doesn't carry its own values.'''
	pos = entry['position']
	kw = {'segment_type': entry.get('segment', 'hobby')}

	# Per-knot tension wins; fall back to the contour-wide default.
	if 'alpha' in entry:
		kw['alpha'] = float(entry['alpha'])
	elif tension != 1.0:
		kw['alpha'] = float(tension)

	if 'beta' in entry:
		kw['beta'] = float(entry['beta'])
	elif tension != 1.0:
		kw['beta'] = float(tension)

	# Direction pins (radians; None means auto).
	if entry.get('dir_in') is not None:
		kw['dir_in'] = float(entry['dir_in'])
	if entry.get('dir_out') is not None:
		kw['dir_out'] = float(entry['dir_out'])

	return HobbyKnot(float(pos[0]), float(pos[1]), **kw)


# -- Dispatcher entry: committed Hobby curve -----------------------------------
def npa_draw_hobby(glyph, scope_layers, NodeActions, knots_json,
                   closed=False, tension=1.0):
	'''Commit a kind="hobby" Contour carrying the user's knots to
	every in-scope layer. The hobby solver is NOT run at commit time;
	knots are the persisted source of truth, the bezier shadow is
	recomputed on render/export.

	Arguments:
		knots_json (str | list): JSON string or Python list of knots.
			Each knot is either [x, y] or
			{"position": [x, y], "segment": "hobby"|"line", ...}.
		closed (bool): Close the resulting curve.
		tension (float): Hobby tension applied to alpha/beta on knots
			that don't carry their own.

	Returns:
		bool: True if at least one layer was committed to.
	'''
	knots = _normalize_knots(knots_json)
	if len(knots) < 2:
		return False

	committed = 0
	for lyr in _iter_scope_layers(glyph, scope_layers):
		# Per-layer build — sharing a Contour across layers would
		# alias knots on subsequent edits.
		c = Contour(kind='hobby', closed=bool(closed))
		for entry in knots:
			c.knots.append(_build_hobby_knot(entry, tension))

		# Single-element list is mandatory (FontRig dev guide §10).
		lyr.shapes.append(Shape([c]))
		committed += 1

	return committed > 0


# -- Conversion helpers (no glyph mutation) ------------------------------------
def hobby_knots_from_bezier_json(nodes_json):
	'''Convert a bezier contour (as a JSON list of [x, y, type] node
	triples) into a hobby knot list. Returns a JSON string of
	[{"x":..,"y":..,"segment_type":..,"alpha":..,"beta":..}, ...].

	Used by the JS-side "Convert to Hobby" action.
	'''
	from typerig.core.objects.node import Node
	from typerig.core.objects.contour import Contour
	from typerig.core.objects.hobbyspline import HobbySpline

	raw = json.loads(nodes_json) if isinstance(nodes_json, str) else nodes_json
	nodes = [Node(float(t[0]), float(t[1]), type=t[2]) for t in raw]

	# Need a Contour to drive HobbySpline.from_contour — assume closed
	# unless the JS caller indicated otherwise (for now: closed).
	# The contour kind here is whatever the source was; HobbySpline.
	# from_contour walks .nodes regardless.
	c = Contour(nodes, closed=True)
	hs = HobbySpline.from_contour(c)

	out = []
	for k in hs.data:
		out.append({
			'x': float(k.x),
			'y': float(k.y),
			'segment_type': getattr(k, 'segment_type', 'hobby'),
			'alpha': float(getattr(k, 'alpha', 1.0)),
			'beta':  float(getattr(k, 'beta',  1.0)),
		})
	return json.dumps(out)


# -- Preview helper (no glyph mutation) ----------------------------------------
def hobby_preview_solve(knots_json, closed=False, tension=1.0):
	'''Solve a Hobby spline for live preview and return a JSON string
	of [(x, y, type), ...] nodes. Does NOT touch any glyph and does
	NOT need the standard syncToPython round-trip.

	Returns:
		str: JSON-encoded list of [x, y, type] triples. Empty list
			"[]" on failure / fewer than 2 knots.
	'''
	knots = _normalize_knots(knots_json)
	contour = _solve_hobby_contour(knots, closed=closed, tension=tension)
	if contour is None:
		return '[]'

	out = [[float(n.x), float(n.y), n.type] for n in contour.nodes]
	return json.dumps(out)
