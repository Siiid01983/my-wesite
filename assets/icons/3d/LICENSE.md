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

## V2.3 — premium 2D illustration set (current)
- All 39 icons are now **premium flat 2D product illustrations** (each object in its most
  recognisable elevation; no 3D perspective, no fake extrusion). One shared rendering style:
  per-material vertical gradients, soft internal shading, restrained highlights, realistic
  colours (dark screens, off-white appliances, warm wood, cream/warm-gray fabric, dark
  metal/tyres), clean rounded edges, no heavy outlines, transparent background.
- **Original CC0 / public-domain** hand-authored SVG (deterministic, **not AI-generated**, no
  third-party/paid assets). Rasterised to 512×512 transparent PNG via headless Chromium at
  build time; auto-framed so the object fills ~70% of the canvas. Card CSS supplies the
  pedestal + contact/drop shadow (unchanged). `mapping.json` all `tier: exact`.
- Supersedes the three.js 3D pass (a design-direction change, not a licensing change — both
  were original CC0). No three.js in the repo; no runtime dependency.

## V2.2 — genuine 3D render pass (previous)
- All 39 icons are now **real 3D renders**, not 2.5D vector art. The geometry is **original
  work authored for Hello Moving** (procedural three.js primitives — boxes, cylinders, tori,
  tube curves — composed into each object), released **CC0 / public domain**. No third-party
  models, no scanned/downloaded meshes, **no AI-generated assets**.
- Renderer: **three.js r128 (MIT)** used **at BUILD TIME ONLY** in headless Chromium (real
  WebGL). three.js is a *tool*, not a shipped asset — it is **not** referenced by index.html,
  sw.js, or any production file, and is **not** a runtime/production dependency. The site ships
  only the exported static PNGs.
- One shared studio rig for the whole family: fixed perspective camera + 3/4 angle, hemisphere
  + key/fill/rim lights, PCF-soft contact shadow, ACES tone mapping, sRGB, transparent
  background; identical scale/framing via an alpha-bbox auto-frame pass. Only the object +
  its PBR materials change per icon. Believable material colours (dark screens/glass/drum
  doors, silver appliances, warm wood, fabric) — the UI gold accent never colours the objects.

## V2.2 quality pass (superseded by the 3D render pass above)
- All 39 re-rendered with richer studio materials (per-face sheen + ambient-occlusion +
  edge highlights) for a "product-render" feel, and the weaker objects were rebuilt with
  corrected geometry (chair now a real chair, vacuum a canister vacuum, sofas with a
  shallow back + arms + cushions, beds with a moderate headboard + duvet + pillows, plus
  kotatsu / low-table / pc-desk / dining-table / futon / bicycle / heater). TV, refrigerator
  and bed remain the quality benchmark. Still original CC0 authored vector→PNG; no source change.

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
