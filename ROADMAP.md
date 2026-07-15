# FontRig — Roadmap / tracked TODOs

Items that previously lived only in source comments, surfaced here so they
are tracked rather than forgotten. Add the corresponding code-comment
reference when you pick one up.

## Draw tool

- **Snapping during drawing** — snap new/dragged points to nodes, grid, and
  extrema. Currently disabled.
  - `editor/js/tools/draw-tool.js:16` — "TODO v2: snapping (nodes, grid, extrema)"
  - `editor/js/tools/draw-handlers.js:17` — "TODO v2: snapping during preview"

## Import / export

- **SVG import** (`File ▸ Import ▸ SVG`) — the menu item exists but is
  disabled ("Not yet implemented"), `editor/index.html`. The export half is
  done; the Python side lives in `editor/python/svgio.py`. Either finish the
  import path or keep it parked here rather than as a dead menu item.
