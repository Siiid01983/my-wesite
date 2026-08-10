# /assets/icons/3d/ — 3D Inventory Icon Licenses

All inventory 3D icons in this folder are **zero-cost and license-clean**: every asset is
either **CC0 / public-domain**, or **original work authored for Hello Moving** (released as
public-domain/CC0). No paid, subscription, or attribution-required assets are used.

Rendered/rasterised locally to 512px PNG, transparent background (the earlier Kenney/Poly
set was downscaled to 192px; the V2.2 authored appliances in Source 4 are kept at 512px).

---

## Source 1 — Kenney "Furniture Kit"  (CC0)
- Author: Kenney — https://kenney.nl
- License: **CC0 1.0 Universal (public domain)** — commercial use OK, no attribution required, redistribution OK.
- Source URL: https://kenney.nl/assets/furniture-kit
- Downloaded: 2026-08-08 (kenney_furniture-kit.zip, GLB models)
- Used for (rendered): bedSingle, bedDouble,
  tableCoffee, tableCoffeeSquare, bookcaseOpenLow, bookcaseOpen, bookcaseClosed,
  bookcaseClosedDoors, sideTableDrawers, cabinetBedDrawer, computerScreen, desk,
  table, chair, bathroomMirror, kitchenCabinet, cardboardBoxClosed.
- NOTE (V2.2): the TV / fridge (×2) / washer / microwave renders from this kit were **replaced**
  (see Source 4). The studio chroma-clamp had washed their dark screens/doors/glass to near-white,
  leaving them illegible on the charcoal (#151812) dark UI.

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

## Source 4 — Original appliance icons, V2.2 (authored for Hello Moving)  (CC0 / Public Domain)
- Author: Hello Moving (this project). Released as **public-domain / CC0**.
- Hand-coded **deterministic vector art** (SVG, cabinet-projection 3/4 studio style to match the
  render family) — **NOT AI-generated; no third-party, attribution, or paid assets**. Rasterised
  to transparent 512px PNG via headless Chromium (Playwright — a tool, not shipped as an asset).
- Used for (correct materials baked into the asset, not CSS-filtered white renders):
  - `tv-s` / `tv-l` — hmFlatTV: dark screen + visible bezel + stand (small vs large sized).
  - `microwave` — hmMicrowave: dark glass door + recognisable control panel (display + buttons).
  - `wash-d` — hmWasherFrontLoad: dark circular drum door (metal rim + dark glass).
  - `wash-v` — hmWasherTopLoad: dark top lid + control panel (now an EXACT top-load match).
  - `fridge-s` — hmFridge2Door / `fridge-l` — hmFridge3Door: silver/white body, visible handles +
    door grooves, darker side face for clear separation from the charcoal UI.
- Also fixes two duplicates in the prior set: `tv-s`==`tv-l` and `wash-d`==`wash-v` were
  byte-identical renders; they are now distinct objects.
- Also re-authored (pale/ambiguous on the dark UI): `sofa1` / `sofa2` / `sofa3` (hmSofa1–3 —
  neutral fabric, distinguishable arms + back/seat cushions, widening 1→2→3 seats) and
  `airpurifier` (hmAirPurifier — neutral tower body + dark vent grille + top control; replaces
  the earlier `speaker` proxy, so 空気清浄機 is now an EXACT match).

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
- Icon origins: Kenney Furniture Kit (CC0), Poly Pizza CC0 (printer), and original CC0 work
  authored for this project (Source 3 small appliances + Source 4 V2.2 appliances).
- EXACT direct matches for TV / fridge / washer (top & front) / microwave via Source 4;
  remaining PROXIES are furniture silhouettes (e.g. futon→single bed, kotatsu→low table,
  ceiling fan→扇風機). 0 pending, 0 attribution-required, 0 paid.
- Filenames are keyed by inventory slug (`<slug>.png`) for a 1:1 map to `BA_ITEM_SVG`.
