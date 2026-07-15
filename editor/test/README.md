# FontRig test harness

Pure-logic regression tests for the FontRig editor. No build step, no npm
dependencies — uses Node's built-in `node:test` runner and a minimal XML
DOM shim so the browser-only parser can run headless.

## Run

```sh
node --test editor/test/*.test.js
```

(from the repo root). Requires Node 18+.

## Layout

- `helpers/load-fontrig.js` — loads the plain-`<script>` source files into
  a single `vm` context and returns the populated `FontRig` global.
- `helpers/xml-dom.js` — self-contained XML parser + the slice of the DOM
  API the parser needs (`getAttribute`, `children`, `querySelector*` with
  `:scope > tag` support). Scoped to `.trglyph` XML, not general-purpose.
- `helpers/sample-xml.js` — extracts the sample glyph XML from
  `js/sample.js`.
- `*.test.js` — parser, serializer round-trip, layer fingerprinting, and
  the `.trglyph` filename mangler.

## Notes

Arrays returned across the `vm` realm boundary fail `assert.deepStrictEqual`'s
prototype check even when contents match — wrap them with `Array.from(...)`
before comparing to an in-realm literal.
