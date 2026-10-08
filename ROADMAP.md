# Roadmap: Near-Fidelity Configurator for Marketing & Sales

Goal: evolve this from a functional configurator into a near-photorealistic tool sales reps can use client-facing, without adding quote/materials-list export (out of scope).

Phases are ordered by priority but each is independently demoable — don't need to finish one to get value from the next.

Done and removed from this file: Lighting & Atmosphere (Environment HDRI, ACESFilmic tone mapping, ContactShadows, N8AO), Default Example Models / Starter Presets (multi-shape L/U-shaped templates, template dropdown picker), and Multi-Floor Support (1-5 floors, independent per-floor blocks, floor stepper/selector, roof only on the top floor, per-floor component association).

## Materials Catalog
- Build a small PBR material library from Poly Haven (CC0): brick, wood siding, stucco, corrugated metal (factory halls), concrete, roofing (tile + metal) — albedo/normal/roughness/AO maps.
- Downscale to 1-2K and compress via KTX2/Basis (`glTF-Transform` CLI) before shipping.
- Replace `materials.ts`'s flat-color `wallMaterialFor`/`roofMaterialFor` with a material-selection system: per building type, pick cladding color/texture, roof material, trim color.
- Glass for windows: drei's `MeshTransmissionMaterial` for a handful of window instances — budget its use, it's the most expensive material here.
- A prior pass built this and then reverted it back to flat color (see TODO.md history) — re-attempt with real textures should also fix the wall-tiling-across-floor-slabs seam noted there.

## Real Geometry for Placeables (partial — door/window/skylight done)
- Door, window, and skylight already have real procedural geometry (not sourced models — Poly Haven's catalog has no generic door/window/column/beam models, confirmed directly via `api.polyhaven.com`, and Kenney's CC0 kits had the wrong aesthetic for this app; see `PlacedComponents.tsx`'s `GlazingDetails`/`DoorDetails`/`SkylightDetails`).
- **Remaining**: column and beam are still plain scaled boxes. No good CC0 source model was found for either; would need its own procedural design pass (an I-beam/column detail profile), not a copy of the glazing/door treatment.

## Sales/Marketing Workflow Features
- **Screenshot export**: render the current camera view at 2-4x canvas resolution, download as PNG. Not started.
- **Camera presets**: bound buttons ("Exterior," "Interior," "Aerial") that animate the camera to fixed viewpoints, instead of relying on manual orbiting in front of a client. Not started.
- **Shareable config link**: local save/load already works (`persistence.ts`, `localStorage`-backed). Still open: a backend record + short URL so a rep can send "this exact building" to a client without them needing the same browser/device.
- Explicitly out of scope: quote generation, materials-list export.

## Performance Safety Net
- Cap texture resolution; use instancing for repeated elements (wall segments, roof trusses) to cut draw calls given the current one-mesh-per-segment approach.
- Add drei's `PerformanceMonitor`/adaptive DPR so the scene degrades gracefully on unknown sales-laptop hardware.
- Skip LOD — not needed at this scale (single building, not an open world) unless a future site-context feature requires it.

## Reference notes (from research)
- HDRIs/PBR textures/CC0 models: [Poly Haven](https://polyhaven.com) — no attribution required, commercial use allowed. Its model catalog lacks generic building-element models (door/window/column/beam) — confirmed by pulling the full catalog via `api.polyhaven.com/assets?t=models`, not by browsing.
- Compression pipeline: [glTF-Transform](https://gltf-transform.dev/) (Draco/Meshopt geometry + KTX2/Basis textures).
- AO: [N8AO](https://github.com/N8python/n8ao) over built-in SSAO.
- Glass: drei's `MeshTransmissionMaterial`.
- KTX2 + `useGLTF` needs manual `KTX2Loader` wiring (not automatic — see drei issue #2639).
- Texture sources to evaluate for the Materials Catalog phase:
  - https://architextures.org/textures
  - https://www.poliigon.com/textures/architectural/exterior-wall-cladding
