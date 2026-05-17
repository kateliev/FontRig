# MODULE: TypeRig / IO / UFO Editor Helpers
# -----------------------------------------------------------
# Editor-side glue around UfoConverter. Stays out of TypeRig core
# because it composes converter operations for FontRig workflows
# (partial single-master export, UFO -> new master merge).
# -----------------------------------------------------------
from __future__ import absolute_import, print_function, division

import os
import copy

from typerig.core.fileio.ufo    import UfoConverter
from typerig.core.objects.master import Master


def _safe_stem(s):
	out = []
	for ch in str(s or 'untitled'):
		out.append(ch if ch.isalnum() or ch in ('-', '_') else '_')
	return ''.join(out) or 'untitled'


def export_selected_masters_to_ufo(font, master_names, out_dir, stem=None, verbose=True):
	'''Write one .ufo per selected master into out_dir.

	Each .ufo contains only that master's glyphs (a partial export — the
	other masters are intentionally dropped). Reuses UfoConverter's
	per-master writer so the resulting .ufo is identical to what the
	designspace export would have produced for that master alone.

	Args:
		font          : TR Font
		master_names  : iterable of master names to export
		out_dir       : output directory (must exist or will be created)
		stem          : file stem; defaults to font.info.family_name
		verbose       : forwarded to UfoConverter

	Returns:
		list of written .ufo paths
	'''
	if not os.path.isdir(out_dir):
		os.makedirs(out_dir, exist_ok=True)

	stem = _safe_stem(stem or getattr(font.info, 'family_name', '') or 'Font')

	wanted  = set(master_names or [])
	conv    = UfoConverter(verbose=verbose)
	written = []

	for m in font.masters.data:
		if m.name not in wanted:
			continue
		ufo_path = os.path.join(out_dir, '{}-{}.ufo'.format(stem, _safe_stem(m.name)))
		conv._write_master_ufo(font, m, ufo_path)
		written.append(ufo_path)

	return written


def merge_ufo_as_new_master(current_font, ufo_path, new_master_name,
                            location=None, verbose=True):
	'''Convert one .ufo, then attach its glyphs as a new master/layer on
	current_font.

	Glyph names in the imported UFO that don't exist in current_font are
	skipped (their data is preserved in the imported Font but not merged).
	Matching glyphs gain a new layer named new_master_name carrying the
	imported shapes; an existing layer of that name on the same glyph is
	replaced.

	A new Master(name=new_master_name, layer_name=new_master_name,
	             location=location or {}, is_default=False)
	is appended to current_font.masters.

	Returns a dict summary:
		{
			'merged' : [glyph_name, ...],
			'skipped': [glyph_name, ...],
			'master' : new_master_name,
		}
	'''
	conv = UfoConverter(verbose=verbose)
	imported = conv.ufo_to_tr(ufo_path)

	# Pick the source layer name on imported. ufo_to_tr packs a single-UFO
	# import into one master whose layer_name matches the default UFO layer.
	src_layer_name = None
	for m in imported.masters.data:
		if m.is_default:
			src_layer_name = m.layer_name
			break
	if src_layer_name is None and imported.masters.data:
		src_layer_name = imported.masters.data[0].layer_name
	if src_layer_name is None:
		raise RuntimeError('Imported UFO has no master to take a layer from.')

	# Build a quick lookup on the current font.
	current_index = {g.name: g for g in current_font.glyphs}

	merged, skipped = [], []
	for src_glyph in imported.glyphs:
		dst_glyph = current_index.get(src_glyph.name)
		if dst_glyph is None:
			skipped.append(src_glyph.name)
			continue

		src_layer = src_glyph.layer(src_layer_name)
		if src_layer is None:
			skipped.append(src_glyph.name)
			continue

		new_layer = copy.deepcopy(src_layer)
		new_layer.name = new_master_name

		# Replace any existing layer with this name; otherwise append.
		existing_idx = None
		for i, lyr in enumerate(dst_glyph.layers):
			if lyr.name == new_master_name:
				existing_idx = i
				break
		if existing_idx is not None:
			dst_glyph.layers[existing_idx] = new_layer
		else:
			dst_glyph.layers.append(new_layer)

		merged.append(src_glyph.name)

	# Append the new master to current_font.masters.
	current_font.masters.data.append(Master(
		name=new_master_name,
		layer_name=new_master_name,
		location=dict(location or {}),
		is_default=False,
	))

	if verbose:
		print('[ufo_helpers] merged {} glyphs, skipped {} (no match in current font)'
		      .format(len(merged), len(skipped)))

	return {'merged': merged, 'skipped': skipped, 'master': new_master_name}
