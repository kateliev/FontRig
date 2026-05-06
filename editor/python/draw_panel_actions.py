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
from typerig.core.actions.draw_actions import HobbyDrawActions

__version__ = '0.1'

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


# -- Dispatcher entry: committed Hobby curve -----------------------------------
def npa_draw_hobby(glyph, scope_layers, NodeActions, knots_json,
                   closed=False, tension=1.0):
	'''Build a Hobby spline from knot positions and append the
	resulting contour as a new Shape on every in-scope layer.

	Arguments:
		knots_json (str | list): JSON string or Python list of knots.
			Each knot is either [x, y] or {"position": [x, y]}.
		closed (bool): Close the resulting curve.
		tension (float): Hobby global tension.

	Returns:
		bool: True if at least one layer was committed to.
	'''
	knots = _normalize_knots(knots_json)
	contour = _solve_hobby_contour(knots, closed=closed, tension=tension)
	if contour is None:
		return False

	committed = 0
	for lyr in _iter_scope_layers(glyph, scope_layers):
		# Per-layer clone — appending the same Contour to multiple
		# Shapes/layers risks aliasing on subsequent edits.
		nodes_copy = [Node(n.x, n.y, type=n.type) for n in contour.nodes]
		c = Contour(nodes_copy, closed=contour.closed)
		# Single-element list is mandatory (FontRig dev guide §10).
		lyr.shapes.append(Shape([c]))
		committed += 1

	return committed > 0


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
