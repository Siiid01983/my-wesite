# /assets/icons/3d/ — 3D Inventory Icon Licenses

**All 39 inventory icons are ORIGINAL work authored for Hello Moving, released as
public-domain / CC0.** They are zero-cost and license-clean: no paid, subscription,
attribution-required, third-party, or AI-generated assets are used.

Rendered locally to 512 × 512 transparent PNG.

---

## Source — Original studio icon set (authored for Hello Moving)  (CC0 / Public Domain)
- Author: Hello Moving (this project). Released as **CC0 1.0 / public domain** — commercial
  use OK, no attribution required, redistribution OK.
- Method: **hand-coded deterministic vector art** (SVG), **not AI-generated**. Each object is
  built from primitives in a shared 3/4 "cabinet-projection" studio spec, then rasterised to a
  512 px transparent PNG via headless Chromium (a tool — nothing third-party ships as an asset).
- One consistent art-directed family across all 39: identical camera angle, light direction
  (top-left), neutral studio materials, and — via an automatic alpha-bbox framing pass —
  identical object scale, centering, baseline, and padding. Correct materials are baked into
  the asset (dark TV/monitor screens, dark microwave/washer/oven glass & drum doors, silver
  appliance bodies, warm wood furniture, fabric upholstery), never faked with CSS filters.
- Covers every slug in `mapping.json` (see it for slug → item → model). Examples:
  tv-s/tv-l, pc, printer, microwave, fridge-s/fridge-l, wash-v (top-load) / wash-d (front-load),
  airpurifier, ac, heater, vacuum, fan, bike, mirror, bed-s/bed-sd/bed-d, futon, sofa1/2/3,
  chair, table/lowtable/kotatsu/pcdesk, chest, dresser-s/dresser-l, shelf-s/shelf-l, bookshelf,
  colorbox, case3, kitchenboard, box, and the `_default` fallback.

## History
- Earlier releases used CC0 assets from **Kenney "Furniture Kit"** (kenney.nl, CC0) and a CC0
  **Poly Pizza** printer, rendered via three.js. Those were **fully replaced** in this pass: the
  prior studio chroma-clamp washed dark screens/doors to near-white (illegible on the charcoal
  UI), the camera/lighting was inconsistent across sources, and two pairs were byte-identical
  (tv-s==tv-l, wash-d==wash-v). No Kenney/Poly bytes remain in the shipped set.

## Mapping
See `mapping.json` — every slug is `tier: exact` (each object is authored to match its item).

## Notes
- 39 assets, filenames keyed by inventory slug (`<slug>.png`) for a 1:1 map to `BA_ITEM_SVG`
  in index.html. 0 pending · 0 attribution-required · 0 paid · 0 AI-generated.
- Reproducible: the generator is a deterministic vector→PNG pipeline (per-object seed fixed).
