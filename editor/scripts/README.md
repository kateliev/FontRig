# FontRig Scripts

This folder is the on-disk home for example scripts shipped with FontRig and a working template for your own.

## Contents

| File | Role |
|---|---|
| `playground.py` | A real Python script — pure TypeRig core, prints a glyph walkthrough. Edit freely. |
| `scripts.json`  | The Scripts panel's config format. References `playground.py` by path. |

## How the panel uses these files

On first launch (or after you clear `fr-scripting-config-v1` in localStorage), the **Scripts** panel fetches `scripts.json`, reads every script referenced by `path`, and seeds the tree. After that, the panel reads from localStorage so your in-panel edits persist across reloads.

## Writing your own script

Inside the panel's Python runtime you get a `glyph` global — the currently active glyph, mirrored from the editor every time you Run. Mutate it however you like; changes propagate back to the canvas and count as one undo step.

```python
# my_script.py
from typerig.core.actions.node_actions import NodeActions

for layer in glyph.data:
    for shape in layer.shapes:
        for contour in shape.contours:
            for node in contour.data:
                node.x = round(node.x)
                node.y = round(node.y)
```

## Your own scripts workflow

The panel is designed for this loop:

1. Keep a folder of `.py` scripts on your hard drive (anywhere — your projects directory, a Dropbox folder, etc.).
2. In the Scripts panel, click **Add Script** to add one or more from that folder. Organize them into folders inside the panel.
3. Click **Save Config** — a JSON file with **references only** (no script source) is downloaded. The file looks like:

   ```json
   {
     "_type": "fontrig-scripting-config",
     "_version": 1,
     "folders": [
       { "name": "tools",  "expanded": true,
         "scripts": [
           { "name": "Round coordinates", "path": "round_coords.py" },
           { "name": "Italic skew",       "path": "italic_skew.py" }
         ]
       }
     ]
   }
   ```

4. Next session: click **Load Config**, pick that JSON, then pick the folder containing the referenced `.py` files. The panel resolves every `path` against that folder and you're back where you left off.

Why references only: configs are safe to commit, share, or paste into a chat — they never carry executable code. The script bodies always live in your `.py` files where you control them.

If a path can't be resolved at Load time (file moved or renamed), the entry shows as `⚠ name` (greyed out). Fix it by either renaming the file back or editing the config's `path`.

The Load Config flow also accepts the legacy inline `source` form for back-compat with older configs.

## Available API

Anything in [TypeRig core](https://github.com/kateliev/TypeRig) that lands in the browser manifest is importable. Useful starting points:

- `typerig.core.objects.glyph.Glyph`
- `typerig.core.objects.contour.Contour`
- `typerig.core.actions.node_actions.NodeActions`
- `typerig.core.actions.draw_actions.DrawActions`
- `typerig.core.actions.contour_actions.ContourActions`

Use the Python REPL panel for ad-hoc experimentation; promote anything you reach for repeatedly into a script here.
