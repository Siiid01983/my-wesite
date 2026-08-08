# /assets/icons/3d/ — 3D Inventory Icon Licenses

All inventory 3D icons in this folder are **zero-cost and license-clean**: every asset is
either **CC0 / public-domain**, or **original work authored for Hello Moving** (released as
public-domain/CC0). No paid, subscription, or attribution-required assets are used.

Rendered locally to 512px, then downscaled to 192px PNG (transparent background).

---

## Source 1 — Kenney "Furniture Kit"  (CC0)
- Author: Kenney — https://kenney.nl
- License: **CC0 1.0 Universal (public domain)** — commercial use OK, no attribution required, redistribution OK.
- Source URL: https://kenney.nl/assets/furniture-kit
- Downloaded: 2026-08-08 (kenney_furniture-kit.zip, GLB models)
- Used for (rendered): televisionModern, bedSingle, bedDouble, loungeChair, loungeSofa,
  loungeSofaLong, tableCoffee, tableCoffeeSquare, bookcaseOpenLow, bookcaseOpen, bookcaseClosed,
  bookcaseClosedDoors, sideTableDrawers, cabinetBedDrawer, computerScreen, desk, kitchenFridgeSmall,
  kitchenFridgeLarge, washer, table, chair, bathroomMirror, kitchenCabinet,
  kitchenMicrowave, speaker, cardboardBoxClosed.

## Source 2 — "Printer" by CreativeTrio  (CC0 / Public Domain)
- License: **Public Domain (CC0)** — via Poly Pizza.
- Source URL: https://poly.pizza/m/77K2TCL5Lz
- Downloaded: 2026-08-08 (GLB)
- Used for: printer.

## Source 3 — Original low-poly models (authored for Hello Moving)  (CC0 / Public Domain)
- Author: Hello Moving (this project). Released as **public-domain / CC0**.
- Authored as three.js geometry in the render pipeline (scratchpad/renderer.html `PROC`).
- Used for: ac (エアコン), heater (ヒーター), vacuum (掃除機), bike (自転車), fan (扇風機 — pedestal fan).
- Reason: no CC0 model of matching style existed for these; Poly-by-Google versions were
  CC-BY (attribution) and were deliberately NOT used. `fan` was authored as a pedestal fan
  (rather than reuse Kenney's ceiling fan) so the 扇風機 card is unambiguous to customers.

---

## Rendering / modifications (all assets)
- Renderer: three.js r128 (**MIT** — a tool, not shipped as an asset).
- Fixed studio setup for a consistent family: perspective camera (30° FOV, 3/4 view),
  key + fill + rim directional lights + hemisphere, soft contact shadow (ShadowMaterial),
  ACES tone mapping, sRGB, transparent background.
- Palette normalized to neutral realistic materials via a global chroma-clamp (~0.05).
  No object recolored to brand colors. No geometry altered on downloaded models.
- Reproducible pipeline lives in the render harness (renderer.html + models/glb/*.glb).

## Mapping
See `mapping.json` — slug → item → model → EXACT | PROXY.

## Notes
- 22 EXACT direct matches, 10 PROXY (closest CC0 object, e.g. futon→single bed,
  kotatsu→low table, top-load washer→front-load, ceiling fan→扇風機), 0 pending.
- Filenames are keyed by inventory slug (`<slug>.png`) for a 1:1 map to `BA_ITEM_SVG`.
