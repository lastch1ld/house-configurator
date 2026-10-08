# Plan: Block Shapes & Roof Components

**Status: current plan — §0, §2, §3, §4 (all 4 roof types, including hip —
not visually verified, see its own note), §5 (not
visually verified — see its own note), §8, §10, §11, §12, §14
implemented (2026-08-31); §13 investigated, no code needed; **§1 (corner
glazing) removed entirely 2026-08-31 per user request** (not a bug fix —
see its own note); **§6 Phase
A implemented (2026-08-31, not visually verified — see its own note);
Phase B implemented (2026-08-31), including polygon wall opening
cutouts — see Phase B's own note for what's least verified**; Phase C
(block-to-block adjacency only — auto-doorways between a polygon edge and
another polygon edge or a rectangle side; mitered corner posts and pitched
roofs over non-rectangular footprints were already covered by Phase A/out
of scope) implemented (2026-08-31), not visually verified — see its own
note; §7 researched (2026-08-31, no code changes — see its own note);
§9 blocked on
user-supplied reference material. Also flagged (not fixed): a
pre-existing, unrelated bug in `fitsOnWall`'s block-to-block-opening
check — see §5's note.**
**Date: 2026-08-28**
**Signed off by: user approved the recommended option for §0, §5, §6, §8 on 2026-08-31.**

This supersedes nothing in `ROADMAP.md`/`TODO.md`; treat it as a working
document for this specific batch of work until it's approved, at which
point its items should fold into `TODO.md` and this file can be retired.

## 0. Confirmed bug: porch attaches to the wrong wall on a rotated block

Verified empirically (not guessed) by calling the real `addPorch` store
action against a live store instance:

- On an unrotated block, `addPorch` is correct on all 4 sides — checked
  numerically (canopy position/size, column position) for front/back/left/
  right against a 6×8m block; all four matched the wall they were supposed
  to attach to.
- On a block with `rotation: 90`, `addPorch(id, "front")` placed the
  canopy at the world edge `edges(block).front` — but the wall that's
  actually *rendered* as the block's local "front" wall ends up, after the
  90° group rotation Base.tsx applies, at a **different** world edge
  (`edges(block).right`, confirmed by hand-tracing the rotation matrix
  against `Base.tsx`'s wall-panel positions). So "+ Front" attaches the
  porch to whichever wall happens to be at the world-space front edge —
  which, after rotating the block, is a different physical wall than the
  one a user watching the model would call "front".

**Root cause**: `WallSide` ("front"/"back"/"left"/"right") is defined
purely in world space via `edges()` (`b.z + depth/2` etc., using the
rotation-aware effective width/depth for the bounding box only) — it does
not track which of the block's own 4 walls that world edge actually is
once the block's `rotation` isn't 0. `alongWallPosition`/`wallLength`/
`addPorch` are all built on this same `edges()`-based definition, so this
almost certainly affects door/window placement identically — it's just
much less visually obvious for a single door than for a whole
canopy+columns sticking out the "wrong" side, which is presumably why it
surfaced now.

**Fix options** (need a decision before implementing):

1. **Leave `WallSide` as world-space** (cheap — revert nothing) but make
   this the *documented, intentional* behavior, and just note that
   rotating a block after placing wall-anchored components will re-target
   them to whichever wall is now at that world edge. Simplest, but keeps
   the surprise for anyone who rotates a block with a porch/door/window
   already on it.
2. **Make `WallSide` block-local** (the wall keeps its identity — "front"
   always means the same physical wall — and follows the block visually
   when rotated). Requires reworking `edges()`-based placement math
   (`alongWallPosition`, `wallLength`, `snapComponentToWalls`,
   `fitsOnWall`, `isGableSide`, `addPorch`, `CornerPosts`' corner-naming)
   to work in the block's own local frame and let the existing per-block
   `<group rotation>` carry it into world space, instead of computing
   world coordinates directly. Bigger, touches the snapping system used by
   every wall-anchored component (doors, windows, gable windows, corner
   glazing, porches), but fixes the bug at its actual source rather than
   working around it per-feature, and is the *correct* long-term behavior
   for the polygon-block work below (a polygon's edges are inherently
   local — rotation has to be handled once, consistently).

**My read**: this is worth fixing as part of §1 below (free-form polygon
blocks) rather than patched twice — option 2 is close to required
groundwork for polygon blocks anyway, since a polygon edge only makes
sense as "the block's own edge #N", never as "whichever edge is at world
+Z". Patching porches alone with a workaround now would likely need
redoing when polygon blocks land. **Recommend**: fix `WallSide` to be
block-local once, as the first concrete step of the polygon-blocks work,
rather than as a standalone porch patch. Flag if you'd rather have a
narrow porch-only patch shipped immediately instead.

**Implemented 2026-08-31 — turned out narrower than either option above.**
Re-reading the actual code before touching it: `wallRef.side` (the
`WallSide` stored on doors/windows/openings) is already handled correctly
under rotation — `Base.tsx` renders every wall/corner in the block's own
*local*, unrotated frame via `localizeOpenings`/`localizeComponentOpenings`
and wraps it in a `<group rotation={block.rotation}>`, and `updateBlock`
already calls `repositionWallComponents` (using the existing
`rotateWallSide` helper) to re-anchor wall-mounted components when a
block's rotation changes. Corner glazing was already confirmed bug-free
in §1 below for the same reason. The *only* place a literal
"front"/"back"/"left"/"right" is passed in with **local** intent (the
Inspector's "+ Front/Back/Left/Right" porch buttons, matching what a user
looking at the block would call its front) but interpreted as a
**world-space** side is `addPorch`. So the actual fix was: add
`localSideToWorldSide(block, localSide)` to `baseGeometry.ts` (wraps the
existing `rotateWallSide` with the block's own rotation) and call it once
at the top of `addPorch` in `store.ts` before its `edges()`-based math —
no rework of `alongWallPosition`/`wallLength`/`fitsOnWall`/`CornerPosts`
needed, since those were never actually broken. Added a regression test
in `store.test.ts` (6×8m block rotated 90°, porch on local "front" lands
on the world "right" edge). No polygon-block groundwork was laid by this
— §6 still starts from scratch.

## 1. Corner glazing — investigated, no bug found yet; **removed 2026-08-31 per your request**

Removed entirely: `BaseBlock.openCorners`/`BlockCorner` (types.ts),
`CornerPosts`'s glazed-corner branch (Base.tsx, back to a plain textured
post at every corner, no `openCorners` prop), the "Corner Glazing"
Inspector section, and the two starter templates
(`l-shaped-house`/`shifted-upper-villa`) that used it — their own
`openCorners` overrides dropped, blocks now built plainly via `block(...)`
instead of `blockWith(block(...), {openCorners:...})`. No persistence
change needed (the field was optional/permissive, same as its own
addition was). 133 tests still pass, `tsc`/lint/`vite build` all clean.
Superseded the investigation below, kept for history:

`openCorners` (`frontLeft`/`frontRight`/`backLeft`/`backRight`) is
computed and rendered entirely in the block's own **local** space inside
`CornerPosts` (`Base.tsx`) — it doesn't go through `edges()`/`WallSide` at
all, so it isn't subject to the same rotation bug as porches. Persistence
(`persistence.ts`) is permissive about optional `BaseBlock` fields, so
save/reload shouldn't drop it either — checked by reading the validator,
not run against a real save/reload cycle (no browser access this
session).

No other placement issue found via code reading. **Need from you**: if
corner glazing is still visibly broken after the porch/`WallSide` fix
above, a specific repro (which corner, what you expected vs. what
happened) — I don't have browser access this session to find it by
poking at the UI myself.

## 2. Pergola (porch) — ground floor only

**Implemented 2026-08-31.** Did both: the "Porch" section in
`Inspector.tsx`'s `BlockEditor` is now hidden unless `activeFloorIndex ===
0` (new `isGroundFloor`, same pattern as `isTopFloor`), and `addPorch`
itself now refuses (returns state unchanged) when
`state.activeFloorIndex !== 0`, so it's safe even if called some other
way later. Regression test added in `store.test.ts`.

## 3. Solar panel roof component

Per your answer: **raised, sitting proud on the slope** (not embedded
like a skylight) — closer to how real rooftop solar looks, and lets its
size be independent of the roof material's own geometry.

- New `ComponentType: "solarPanel"`, added to `HOUSE_COMPONENT_LIBRARY`
  (not factory halls, unless you want it there too — assumed house-only
  for now).
- Geometry: a thin box (frame + a darker panel face, similar tier of
  detail to the existing `DoorGlassLite`/`SkylightDetails` treatment, not
  a photoreal PV texture) offset a few cm above the roof slope's own
  surface along its normal, tilted to match the slope's pitch — same
  quaternion-from-slope-normal approach `computeSkylightPlacement` already
  uses for skylights, just offset outward instead of embedded.
- "Modifiable size": exposed as width/depth `NumberField`s in the
  Inspector once selected, same pattern used for door/window custom sizes
  — need to check whether door/window already support arbitrary
  width/height overrides via `scale` or only fixed variants; if only fixed
  variants exist today, solar panel would be the first roof component with
  a free-form size, which is a small but real precedent-setting change.

**Implemented 2026-08-31, together with §4.** Added `solarPanel` as a
`ComponentType` (not in `HOUSE_COMPONENT_LIBRARY` — placed via its own
"+ Slope A/B"/"+ Add" buttons in the Inspector's new "Solar Panels"
section, same UI pattern as skylights, not the generic "Add component"
menu). `SolarPanelDetails` (`PlacedComponents.tsx`) renders a plain frame
box + darker cell face — flat colors, no PV texture, matching the plan's
intent. Width/depth are freely editable post-placement via a "Solar Panel
Size" section in the Inspector (`ComponentEditor`), same pattern as
`opening`'s Width/Height fields — door/window turned out to only support
fixed variants, so this *is* the first roof component with a free-form
size, as flagged above. `addSolarPanel` mirrors `addSkylight`'s one-per-
slope duplicate guard exactly (shared via a new `addRoofSlotComponent`
helper in `store.ts` — see §4 for why that generalization was needed).

## 4. Roof components must adapt to roof type

Today `addSkylight` (and the new solar panel above) are gated to
`roofType === "gable"` and computed via `gableRoofSlopes`/
`computeSkylightPlacement`, which assume exactly 2 rectangular slopes.
Mono-pitch (1 slope), hip (a trapezoid pair + 2 triangle ends), and flat
(no slope at all — a roof component there would just be a raised box on a
horizontal surface, which is a different, simpler case) all need their
own placement math:

- **Mono-pitch**: easiest extension — 1 slope instead of 2, reuse
  `monoPitchSlope`'s already-computed position/rotation/size directly, no
  new geometry needed.
- **Hip**: harder — the 4 hip-roof faces aren't simple boxes
  (`buildHipRoofGeometry`'s custom trapezoid/triangle mesh), so "where can
  a solar panel/skylight legally sit on this slope without hanging off the
  triangular hip-end or poking past the ridge" needs its own containment
  math, conceptually similar to `gableAvailableHalfWidth`/
  `clampComponentToGable` but for a trapezoid face instead of a triangle.
  Real risk of the same kind of "looks fine in the numbers, wrong in 3D"
  bug the gable clamp had earlier this session, given no browser
  verification available.
- **Flat**: skylight/solar panel on a flat roof is just "a box resting on
  a horizontal plane" — much simpler than the sloped cases, probably worth
  doing first since it de-risks nothing else but ships value fast.

Proposed order: flat → mono-pitch → gable (already done) → hip last (same
risk-ordering logic used for the roof-type work earlier this session).

**Implemented 2026-08-31 for flat/mono-pitch/gable — hip deliberately
NOT implemented**, per the ordering above and the plan's own risk
warning: no browser access this session, and hip's containment math is
real, non-trivial new geometry (not a mechanical extension of the
existing gable/mono-pitch code path), so shipping it unverified risked
exactly the "looks fine in the numbers, wrong in 3D" failure this section
called out. Concretely:
- `computeSkylightPlacement` (`floorDuplication.ts`) is now
  `computeRoofComponentPlacement(block, roofType, slopeIndex, raise)` —
  takes the effective roof type and a `raise` distance (so it serves both
  skylight and solar panel) and switches on `gable`/`monoPitch`/`flat` to
  build the same tilted-slope-plus-yaw placement as before; returns
  `null` for `hip`.
- A new `supportsRoofComponents(roofType)` (also `floorDuplication.ts`)
  is the single source of truth for which roof types the Inspector should
  even offer the Skylights/Solar Panels sections for — currently
  everything except `hip`.
- `addSkylight`/`addSolarPanel` (`store.ts`) both resolve the block's
  effective roof type and no-op (return state unchanged) if placement
  comes back `null` — so a stray call against a hip-roofed block (there
  shouldn't be one, since the Inspector no longer offers the buttons
  there) fails safe instead of crashing or placing something wrong.
  `duplicateComponentsToFloorAbove` (`floorDuplication.ts`) treats a
  `null` placement the same as "no matching block on the floor above" —
  drops the roofSlot rather than keeping a stale/wrong one.
- Regression tests added in `floorDuplication.test.ts`
  (`computeRoofComponentPlacement`/`supportsRoofComponents` for all 4 roof
  types, including the `hip` → `null` case) and `store.test.ts`
  (`addSolarPanel`'s duplicate guard and its hip no-op).
- **Hip implemented 2026-08-31** — a later pass, per the note above. A new
  `hipRoofFaces(width, depth, roofHeight, ridgeAxis)` (`hipRoofGeometry.ts`)
  returns the 4 faces (`front`/`back`/`right`/`left`) as placement
  descriptors (position/rotation, plus each face's eave/ridge half-widths
  and slope length for containment) — the back/front trapezoids are
  `gableRoofSlopes`' default (ridge-along-X) case generalized from a
  triangle's zero-width ridge point to a possibly-nonzero one (`ridgeHalf`,
  substituted for that function's hardcoded 0) with `depth` replaced by
  `perp`; the left/right hip-end triangles are that function's
  ridge-along-Z case (including its own hand-verified rotation-sign flip)
  generalized the same way. Every position/rotation/eave/ridge value was
  cross-checked against a throwaway three.js script (not just the formula
  re-derived a second way) before being written into the real module — the
  exact "looks fine in the numbers, wrong in 3D" risk this section warned
  about, addressed by verifying the numbers computationally instead of
  visually, since no browser access existed this session either. A new
  `hipFaceAvailableHalfWidth`/`clampComponentToHipFace` pair (same file) is
  the trapezoid/triangle containment math this section asked for — the
  roof-surface analogue of `gableAvailableHalfWidth`/`clampComponentToGable`
  (which solve the same "widest point is always at the component's own
  near edge" problem for a gable's vertical end-wall triangle instead, a
  different v-domain: vertical height there, distance along the tilted
  slope surface here), generalized the same "substitute a real ridge
  half-width for gable's hardcoded 0" way. `computeRoofComponentPlacement`
  now takes an extra `footprint: [width, length]` param (only meaningful
  for `hip`; defaults to `[0, 0]`, a no-op clamp, for the other roof types
  that never needed one) and no longer returns `null` for `hip` except for
  an out-of-range `slopeIndex`; `supportsRoofComponents` now returns `true`
  unconditionally. `RoofSlopeIndex` (`types.ts`) widens `slopeIndex` from
  `0 | 1` to `0 | 1 | 2 | 3` everywhere it appears (`PlacedComponent.roofSlot`,
  `addSkylight`/`addSolarPanel`, `computeRoofComponentPlacement`); the
  Inspector's Skylights/Solar Panels sections now render 4 buttons
  (Front/Back/Right/Left, matching `hipRoofFaces`' own order) for a
  hip-roofed block instead of hiding those sections. The 2 pre-existing
  regression tests asserting the old hip → `null`/hidden behavior were
  updated to assert real placement instead; new tests cover
  `hipRoofFaces`/`clampComponentToHipFace`/`shiftHipFaceAlongSlope`
  directly. **Not visually verified this session (no browser access)** —
  place a skylight and a solar panel on each of a hip-roofed block's 4
  faces (including a case where `ridgeHalf` is 0, e.g. a square footprint)
  and confirm each one sits flush on its face, right-side up, not hanging
  off a hip-end triangle's point, before calling this fully done.

## 5. Recessed wall (partial notch)

Per your answer: **a partial notch within one wall**, not a whole-wall
inset — the rest of that wall stays flush, only part of its length steps
back.

This is the most structurally involved item on this list short of
free-form polygons. Today a wall is one flat plane at a fixed offset from
the block's centerline (`WALL_THICKNESS`-thin panels arranged by
`wallPanels()` for openings, but all coplanar). A notch needs:

- A wall segment that's a different *depth offset*, not just a gap — i.e.
  a sub-range `[a, b]` of one wall's span sits at, say, 0.5m further in,
  connected to the rest of the wall by two short return walls (perpendicular
  jogs) at `a` and `b`.
- **"Corners match up with others"** (your requirement) — I read this as:
  the notch shouldn't change the block's own footprint corners (the
  overall width×depth rectangle stays the source of truth for adjacency/
  snapping/roof/floor-slab sizing), only that one wall's *surface* steps
  in locally. That keeps every other system (roof, floor slab, corner
  posts, block-to-block adjacency) untouched — only wall-panel generation
  and the two new return-wall segments are new. **Confirm this reading is
  right before I build it** — if you instead meant the notch should be
  able to reach all the way to an adjacent block's wall (a true recess
  that meets another block's structure), that's a different, harder
  feature (needs cross-block awareness, not just one wall's own geometry).
- Data model: something like
  `BaseBlock.wallRecesses?: { side: WallSide; from: number; to: number; depth: number }[]`
  — a list so a wall can have more than one notch.
  Door/window placement (`fitsOnWall`) would need to know not to let a
  component straddle a notch boundary (same category of check it already
  does for openings/overlaps).

**Implemented 2026-08-31 — the "footprint stays intact" reading, as
confirmed.** `WallRecess` (`types.ts`) matches the sketch above almost
exactly, with one deliberate deviation: `from`/`to` are stored **local
to the block's own wall** (the same -span/2..+span/2 frame `wallPanels`
already uses), and `side` is **local** too (front always means the same
physical wall, like `openCorners` — not world-space like `WallRef.side`).
This was a real design decision, not just following the sketch verbatim:
storing world-space (matching `WallRef`) would have meant re-deriving the
same block-to-block-opening-style rotation math (`localizeAxis`'s ref+sign
handling) both at render time *and* every time the Inspector needs to
show/edit a notch, for no benefit — recesses only ever exist to be
rendered in the block's own local frame (`Base.tsx`, wrapped in the
block's own `<group rotation>`), so storing them local-native removes an
entire class of rotation bugs the local-vs-world investigation in §0
already had to spend real effort on. The one place this still needs a
rotation-aware conversion is the *reverse* direction — `fitsOnWall`
(componentSnap.ts) works in world-space `WallRef` terms, so it needs to
check a world-space candidate against local-native recesses. New
`localizeWorldOffsetInterval` (`baseGeometry.ts`) does exactly that
conversion (reusing the same `localizeAxis` ref+sign logic
`localizeOpenings` already uses), and its test is the same rotated-block
scenario the `addPorch` fix in §0 used, to make sure this feature doesn't
quietly reintroduce that class of bug.

Pieces, all covered by new unit tests
(`baseGeometry.test.ts`/`componentSnap.test.ts`):
- `wallDepthSegments(span, recesses)` (`baseGeometry.ts`) — pure function,
  splits a wall's own span into alternating normal/recessed runs.
- `wallRunSegments` (`baseGeometry.ts`) — combines that with `wallPanels`,
  one door/window-cutout pass per depth-segment instead of one for the
  whole wall.
- `fitsOnWall`'s new `crossesRecessBoundary` guard (`componentSnap.ts`) —
  rejects a door/window placement that would straddle a notch boundary,
  via `localizeWorldOffsetInterval` above.
- **`alongWallPosition`/`snapComponentToWalls` are now recess-aware**
  (added after your review caught that a door/window inside a notch was
  landing at the wall's old, un-recessed plane instead of flush with the
  recessed surface, floating in front of it rather than getting a real
  cutout there). New `recessSetbackAt(block, side, offset)`
  (`componentSnap.ts`) looks up the setback at a given point via
  `wallDepthSegments`; `alongWallPosition` takes a new `gable` parameter
  (default `false`) and applies that setback to its returned plane unless
  `gable` is true — a gable triangle's own plane is unaffected by a recess
  in the rectangular wall below it, so every existing gable-anchored call
  site (`Inspector.tsx`, `PlacedComponents.tsx`, `store.ts`'s `addComponent`
  gable branch) now passes `gable: true` explicitly, and every other
  wall-anchored call site (`mirrorComponentToOppositeWall`,
  `centerSelectedComponentsHorizontally`, `repositionWallComponents`,
  `duplicateComponentsToFloorAbove`) passes through the component's own
  `wallRef.gable ?? false` to preserve exactly its prior behavior.
  `snapComponentToWalls`'s own candidate-plane values get the same
  per-side setback (evaluated at the current drag point's own offset,
  same "check only under the cursor" approximation the existing `fits`
  gate already makes) so a fresh drag-to-wall placement inside a notch
  snaps flush immediately, not just on a later reposition.
- `Base.tsx`'s `BlockMesh` now renders each wall as its own list of runs
  (one `XWallSegments`/`ZWallSegments` call per depth-segment, offset by
  that segment's own setback) plus a new `WallJogs` component rendering
  the perpendicular return-wall panel at each setback transition.
- Inspector: a new "Recessed Wall" section (`BlockEditor`) with one
  "+ Front/Back/Left/Right" button per side (adds a default centered
  notch) and, per existing notch, From/To/Depth `NumberField`s and a
  Remove button — same direct `updateBlock({ wallRecesses: ... })`
  pattern `openCorners` already uses, not a new store action.
- `persistence.ts` needed no change — its `BaseBlock` validation is
  already permissive about optional fields (confirmed, not assumed).

**Not visually verified — no browser access this session.** The pure
geometry (`wallDepthSegments`/`wallRunSegments`/`localizeWorldOffsetInterval`)
is unit-tested and `tsc`/`vite build` both pass, but the actual 3D result
(does a notch's return-wall jog really look flush, does the corner-post
trim still line up with a notch near a true corner) has not been checked
in the running app. Please add a notch from the Inspector and look at it
before treating this as done — this is exactly the "looks fine in the
numbers, wrong in 3D" risk this plan already flagged for hip roofs, and
recess geometry is at least as involved.

**Also found, unrelated, not fixed (flagging rather than fixing per scope
discipline)**: `fitsOnWall`'s existing block-to-block-opening check
(`componentSnap.ts`, the `sideOpenings`/`intervalsOverlap` loop, predates
this session's changes) compares a candidate's *wall-corner-relative*
offset range against `getBlockOpenings`'s output, which is in *absolute
world coordinates* — these are only the same numbers when a block's own
`e.left`/`e.back` happens to be 0. For an ordinary block not sitting
exactly astride the world origin (i.e. most blocks), this can accept a
door/window placement that should have been rejected as opening into a
block-to-block join, or reject one that should be fine, depending on
where along the wall it lands. Did not touch this — it's pre-existing,
unrelated to recesses, and probably deserves its own repro + fix pass
rather than a drive-by change while implementing an unrelated feature.

## 6. Free-form polygon blocks

Confirmed scope: **free-form**, not chamfered-corner or fixed L/T
presets. This is the big one. Rough shape of the change (not a committed
design yet):

- `BaseBlock.width`/`depth` (+ `rotation`) replaced or supplemented by an
  explicit ordered vertex list (a closed polygon in the block's own local
  space) — likely keeping width/depth as the *default* 4-corner rectangle
  so every existing template/save stays valid without migration, and
  polygon blocks are an opt-in additional shape.
- Every one of these needs a rewrite from "4 fixed sides" to "N edges,
  each with its own `WallSide`-equivalent identity":
  - Wall generation (`wallPanels`, `XWallSegments`/`ZWallSegments` in
    `Base.tsx` are hardcoded to 4 sides)
  - Corner posts (`CornerPosts` — currently literally 4 fixed corners,
    including the new `openCorners` glazing feature)
  - Roof generation — gable/mono-pitch/hip all assume a rectangle; a
    pentagon or L-shaped single block has no well-defined "ridge" without
    new rules (real houses handle this with intersecting roof volumes, not
    one continuous surface — likely the actual right model here, and
    would let combining rectangular blocks — already supported — cover a
    lot of the same ground with far less new code than a truly generic
    polygon roof solver)
  - Door/window/porch/corner-glazing snapping (`componentSnap.ts`) — needs
    to work against an edge list instead of 4 named sides
  - `edges()`/`overallFootprint`/adjacency and grid-snap
    (`snapBlockPosition`) — currently assume an axis-aligned rectangle for
    bounding-box math
- **Given the depth of this, and that item 0 (`WallSide` going local) is
  effectively a prerequisite**, my recommendation is: do 0 first, get real
  confirmation it's solid (tests + your own check once you're back in the
  browser), then come back to scope polygon blocks as its own dedicated
  planning pass — trying to design the polygon data model in the abstract
  right now, before `WallSide` is fixed, risks designing against the wrong
  foundation.

### Data model scoping pass (2026-08-31) — this is the dedicated planning
pass the note above called for. §0 landed and is solid (block-local
`WallSide` conversion via `localSideToWorldSide`/`worldSideToLocalSide`,
proven correct with the exact rotated-block scenario reused again for
§5's `localizeWorldOffsetInterval`), so this is designed against the
real, current foundation — not a guess. **This is a design proposal, not
yet implemented** — deliberately sequenced last per your instruction, and
still needs your sign-off on the phasing/open-questions below before any
code changes.

Checked `Downloads/3D_Models/Components` (`Front_Door`, `Garage_Door`,
`Modern_Stairs`, `Window_Pack`) for anything reusable here first, since
you flagged them as references — all four are plain single-mesh Blender/
3ds-Max exports with generic node names (`Cube.026`, etc.) and no
embedded thumbnail (unlike the `Modern_Urban_Villa` SketchUp file), so
there was nothing concrete to extract without actually rendering them
(no browser/3D-viewer this session, same limitation as before). They
don't change anything below — this doc's existing door/garage-door/
stairs implementations already follow this app's own established
parametric conventions (slim-frame doors, ribbed garage doors, stepped-
block stairs), and nothing in these 4 files contradicts that. If you
open them yourself and see a detail worth matching (a specific frame
profile, handle style, etc.), that's a small follow-up independent of
this polygon-blocks scope, not something this pass needs to wait on.

**Core decision: polygon support is additive, not a replacement.** Every
existing rectangle block keeps using exactly the code paths it does
today (`width`/`depth`/`rotation`, `WallSide`, `edges()`'s 90°-swap
shortcut) completely unchanged. A polygon block is a new, parallel shape
a block can opt into. This isn't just for save-compatibility (though it
gives that for free, no migration needed) — it also means a rectangle
block never pays for the more expensive general-polygon math (point-in-
polygon checks, arbitrary-angle wall snapping, triangulated roof/slab
geometry), and the two implementations can be verified independently.

**`BaseBlock.polygon?: { x: number; z: number }[]`** — an ordered,
closed, counter-clockwise polygon in the block's own *local* space
(meters from the block's own center, pre-rotation — the exact same frame
`wallPanels`'/`WallRecess`'s `from`/`to` already use, so nothing new to
learn there), minimum 3 vertices, no self-intersection (validated on
edit, not structurally enforced by the type). When present, this is the
block's real shape; `width`/`depth` become **derived** (the polygon's own
local bounding box, recomputed whenever the polygon changes) rather than
independently editable — kept on the object so every coarse bounding-box
consumer (see "free wins" below) keeps working without even knowing a
polygon exists.

**Per-system generalization, in the order a real implementation would
tackle them:**

1. **`edges()` (baseGeometry.ts)** — becomes the single seam: for a
   rectangle block, unchanged (today's `effectiveDimensions` 90° swap);
   for a polygon block, rotate each vertex by the block's own
   `rotation` (still only 0/90/180/270 — no arbitrary-angle block
   rotation in v1 either, so this is exact, cheap min/max over rotated
   points, not an approximation) and take the min/max. Every consumer
   that only ever reads `edges()`'s `{left,right,back,front}` shape —
   `overallFootprint`, `snapBlockPosition`'s neighbor-edge snapping,
   camera framing — **keeps working unchanged** for polygon blocks once
   this one function is polygon-aware. A polygon block only gets
   *bounding-box* alignment against neighbors this way (not true edge-to-
   edge snapping along its own angled sides) — an accepted v1
   simplification, matching how most parametric tools treat irregular
   footprints for coarse alignment.
2. **Wall generation** (`wallPanels`/`wallRunSegments`/
   `XWallSegments`/`ZWallSegments` in Base.tsx) — `wallPanels`'s own
   interval-cutting logic is already edge-agnostic (it just cuts
   `[fullMin, fullMax]` by openings, no axis assumption baked in); what's
   new is a per-edge 3D placement step: each polygon edge gets its own
   length (`fullMax` for that edge), direction, and world rotation
   (`atan2` of the edge vector, not the fixed 0°/90° rectangle walls
   use). `WallRecess`/`wallRunSegments`'s "centered -span/2..+span/2"
   convention doesn't fit a polygon edge (no natural center) — recommend
   switching a polygon edge's own local frame to "0 at the edge's start
   vertex," and leaving the rectangle convention exactly as-is (another
   place the two shapes' code stays genuinely separate, not unified
   under one awkward convention).
3. **Corner posts** (`CornerPosts`) — generalize to "one post per
   vertex," each oriented to bisect its two adjacent edges (a real miter-
   joint problem — acute or obtuse vertex angles need actual computation,
   not just a 90°-corner constant). I recommended skipping this (a plain
   `WALL_THICKNESS` cube at every vertex regardless of angle) as a v1
   simplification; **you confirmed mitered corners instead** (see the
   decisions list below) — so Phase A needs the real per-vertex bisector
   computation from the start, which is more geometry risk in that phase
   than my original recommendation carried, and more reason to get it
   browser-verified before calling Phase A done. `openCorners`/corner-glazing has no polygon
   equivalent in v1 for the same reason — stays rectangle-only.
4. **Roof + floor/ceiling slabs** — the hardest part, and where I'd
   actually spend the design caution the earlier note above was pointing
   at. **Recommend flat-roof-only for polygon blocks** (already the
   original plan's own reasoning: gable/hip/mono-pitch stay rectangle-
   only; a pitched roof over an irregular footprint should be composed
   from multiple rectangular blocks, already fully supported, rather than
   built by a generic polygon-roof solver). Flat still needs real new
   geometry, though — `TexturedPanel`'s plain box won't render a
   non-rectangular slab, so the floor slab, any ceiling slab, and the
   flat roof itself all need an actual polygon-extrusion mesh (triangulate
   the footprint — an ear-clipping triangulator is the standard,
   well-tested approach for this — then extrude by the slab's own
   thickness). This is one new geometry builder reused three ways (floor/
   ceiling/roof), not three separate ones.
5. **Door/window/porch/balcony/skylight/solar-panel snapping**
   (`componentSnap.ts`) — the genuinely hardest, most error-prone piece,
   and the reason Phase B below exists as its own step. `WallRef` needs a
   way to reference a polygon edge index (edge *i* runs from
   `polygon[i]` to `polygon[(i+1) % polygon.length]`) alongside its
   existing `WallSide`. I recommended a non-breaking `WallSide | number`
   widen (every existing saved `side` string stays valid, no migration
   needed); **you confirmed a proper discriminated union instead**
   (`{kind:"side"; side: WallSide} | {kind:"edge"; index: number}`) — see
   the decisions list below for what that adds: a real, if mechanical,
   `persistence.ts` migration step for every existing saved building.
   Every function keyed on `side` — `fitsOnWall`, `wallSpan`,
   `offsetAlongSide`, `alongWallPosition`, `wallLength`,
   `oppositeWallSide`, `rotateWallSide`/`localSideToWorldSide`/
   `worldSideToLocalSide`, `crossesRecessBoundary`,
   `localizeWorldOffsetInterval` — needs a polygon-edge branch alongside
   its existing `WallSide` one. The genuinely new algorithmic problem is
   in `snapComponentToWalls`: today's candidate search decomposes into
   two independent 1D nearest-searches (`xCandidates`/`zCandidates`)
   because every rectangle wall is axis-aligned; an arbitrary-angle
   polygon edge can't be decomposed that way — dragging a door near a
   polygon wall needs real 2D point-to-line-segment distance, one
   candidate per edge, not a per-axis split. `oppositeWallSide` has no
   general meaning for a polygon (no "opposite" edge notion) —
   `mirrorComponentToOppositeWall` should just no-op for a polygon-
   anchored component rather than guess. Gable-cap snapping
   (`fitsOnGableCap`/`isGableSide`) is skipped entirely for polygon
   blocks, consistent with the flat-roof-only decision above.
6. **Block-to-block adjacency** (`getBlockOpenings`) — today checks 4
   fixed edge-pairs per block-pair via `edges()`; a polygon generalizes
   this to "does any edge of block A touch any edge of block B," a real
   O(edges_A × edges_B) collinear-overlap test per pair (are two edges
   parallel/collinear within tolerance, and do their projected ranges
   overlap) rather than 4 constant-time checks. Doable, but the fiddliest
   piece to get numerically robust — recommend Phase C, after the rest is
   proven solid, rather than bundling it into the first cut.
   **Implemented 2026-08-31** as a new `getPolygonBlockOpenings` in
   `baseGeometry.ts`, left alongside the existing rectangle-only
   `getBlockOpenings` rather than folded into it (that function's own
   tests and its `componentSnap.ts` caller stay untouched; the new one
   only ever runs for a pair with at least one polygon block). Both blocks'
   boundaries are reduced to world-space line segments (`worldEdgeSegments`
   — a polygon's own rotated+translated edges, or a rectangle's 4 flat
   sides), then every segment pair is run through a general
   `collinearOverlap` (perpendicular-distance + projected-range test, not
   the axis-aligned-only shortcut `getBlockOpenings` uses). A polygon
   block's result is a full-height `Interval[]` per edge index in the same
   local `[0, edgeLength]` frame `getPolygonEdgeComponentOpenings` and
   `buildPolygonWallGeometry`'s `edgePanels` already use, so `Base.tsx`
   feeds it straight into the existing `wallPanels` call for that edge
   alongside its door/window openings — no change needed to the panel-
   cutting logic itself. A rectangle block's result folds into its
   existing `BlockOpenings` (`mergeRectOpenings` in `Base.tsx`), so a
   polygon neighbor opens a doorway on the rectangle's flat side too, the
   same way another rectangle would. Not visually verified this session
   (no browser access) — click through a polygon-preset block placed flush
   against both another polygon block and a plain rectangle block on each
   of the 3 polygon presets, and confirm a doorway opens on both sides at
   the right span, before calling this fully done.

**Recommended phased delivery** (this is genuinely the biggest single
item in this whole plan — phasing is how a change this size stays
reviewable and testable rather than one enormous, hard-to-verify diff):

- **Phase A — shape only.** `BaseBlock.polygon`, polygon-aware `edges()`,
  flat-only floor/ceiling/roof via the new extrusion geometry, plain-cube
  (non-mitered) corners. A polygon block can be placed, moved, rotated
  (0/90/180/270), resized by re-editing its vertex list, and duplicated —
  but **no doors, windows, porches, balconies, or anything else anchored
  to one of its walls yet**. This alone unlocks real non-rectangular
  *massing* (visibly solving "does this footprint match Villa_01/the
  apartment building's shape") without touching the hardest, riskiest
  code (`componentSnap.ts`).
- **Phase B — wall-anchored components.** The `componentSnap.ts`
  generalization above (widened `WallRef.side`, arbitrary-angle snap
  candidates) — what actually lets a rep put a door in a polygon block's
  wall.
- **Phase C — adjacency + polish.** Block-to-block auto-doorways between
  polygon edges (or a polygon and a rectangle), mitered corner posts, and
  (only if it turns out to be wanted) pitched roofs over non-rectangular
  footprints.

**Editing UI is a separate, real scope item, not covered by the above** —
the data model says nothing about *how* a rep actually draws a polygon.
Two options, worth deciding before Phase A's UI work (not before its data
model, which doesn't depend on the answer): (a) a handful of hand-authored
preset polygon shapes (an L, a T, a pentagon bay) the rep drops in and
only repositions/scales as a whole — much smaller UI lift, no new
interaction pattern; or (b) true interactive vertex editing (drag
individual points in the 3D scene, or a 2D top-down footprint editor) —
the real "free-form" experience implied by the name, but its own
significant feature. Recommend (a) first, matching the narrow-then-widen
pattern already used for roof-type support (flat → mono-pitch → gable →
hip) — free-form vertex dragging as a deliberate Phase D once presets
prove the rest of the pipeline is solid.

**Decisions — confirmed by you on 2026-08-31** (2 of 5 went against my
own recommendation; noted below since that changes real scope):
1. **Phased delivery confirmed** — Phase A (shape only) → Phase B
   (wall-anchored components) → Phase C (adjacency/polish), not one
   combined first cut.
2. **Flat-roof-only confirmed** for polygon blocks in v1 — pitched roofs
   stay rectangle-only, composed from multiple blocks as today.
3. **Mitered corners** — went with the harder option over my plain-cube
   recommendation. Phase A's corner-post step is now a real miter-joint
   computation (bisecting each vertex's two adjacent edges, correct at
   any angle) rather than a constant-size cube — more geometry risk in
   Phase A specifically, and more important to get browser-verified
   before calling it done, given this session still has no browser
   access.
4. **Preset shapes confirmed** for the first editing UI — a rep drops in
   a hand-authored L/T/pentagon-bay shape and repositions/scales it as a
   whole; true interactive vertex dragging is a later Phase D, not part
   of this work.
5. **`WallRef` restructure** — went with the discriminated union
   (`{kind:"side"; side: WallSide} | {kind:"edge"; index: number}`) over
   my recommended non-breaking `WallSide | number` widen. This means
   Phase B needs an actual **persistence migration**: every saved
   building's components currently store `wallRef: { side: WallSide,
   ... }` directly (no `kind` wrapper) — `persistence.ts`'s load path
   will need to detect the old shape and wrap it as `{kind:"side", side:
   ...}` on read, so existing saved buildings keep opening correctly.
   Flagging this now so it isn't a surprise when Phase B is scoped in
   detail — it's a real, if mechanical, extra step this choice adds that
   the widen option wouldn't have needed.

Phase A itself doesn't depend on decision 5 (that's a Phase B concern) —
it can start once you're ready, using decisions 1-4 above.

### Phase A — implemented 2026-08-31

`BaseBlock.polygon?: PolygonVertex[]`, `edges()` made polygon-aware, three
preset shapes (L, T, chamfered-bay — the last one deliberately non-right-
angle, to exercise the general miter math rather than only 90°/270°
corners), placeable via a new "Add free-form shape" section in the scene
right-click menu (`SceneContextMenu.tsx`), rendered through a wholly
separate `PolygonBlockMesh` component in `Base.tsx` (solid mitered walls,
flat floor/roof/ceiling — no openings, no gable/hip/mono-pitch, matching
the confirmed decisions). `BlockEditor` (Inspector.tsx) hides every
section that assumes a rectangle or a wall-anchored/roof-anchored
component (Dimensions' Width/Length sliders, Corner Glazing, Recessed
Wall, Skylights, Solar Panels, Porch, Balcony) when `block.polygon` is
set — Position/Wall Height/Appearance/Rotation/duplicate/remove all stay,
since those are genuinely still meaningful.

**Design turned out better than originally scoped, worth recording why**:
the corner-post section above recommended either a plain-cube
simplification or (since you chose mitered) a separate per-vertex miter-
post computation layered on top of ordinary axis-aligned wall boxes.
While implementing, a cleaner approach emerged: **each wall segment is
its own quad-prism** — built from the polygon's own outer boundary and an
`insetPolygon(polygon, WALL_THICKNESS)` inner boundary (a standard
polygon-offset computation: vertex *i*'s inset point is where edge
(*i*-1,*i*)'s inward-offset line meets edge (*i*,*i*+1)'s), so adjacent
segments automatically share an exact edge at *every* vertex angle
(convex, reflex, whatever) with **no separate corner-post geometry at
all** — mitering falls out of the wall geometry itself rather than being
a distinct step. This is simpler than what was scoped, not a shortcut:
verified by unit test against a hand-derived reflex-corner case (an
L-shape's inner notch corner, worked out by hand and matched exactly by
the code — see `polygonGeometry.test.ts`).

New `polygonGeometry.ts` (all pure functions, fully unit-tested — this is
the part correctness *can* be verified without a browser, and was):
- `insetPolygon` — the miter-join computation above.
- `triangulatePolygon` — standard ear-clipping, handles convex or concave
  (tested against the same L-shape, confirming total triangle area
  matches the polygon's own true area and every vertex is used).
- `buildPolygonSlabGeometry`/`buildPolygonWallGeometry` — the actual
  `THREE.BufferGeometry` builders (floor/roof/ceiling extrusion; the
  wall ring), built on the two functions above.
- `polygonBoundingBox`/`rotatePolygon`/`polygonSignedArea` — the smaller
  pieces `edges()` and the triangulator need.

**Known, deliberate Phase A simplifications** (beyond what the phasing
already excludes):
- **No wall texture/tiling** — `useTiledMaterial`'s texture maps need real
  UV coordinates, which the extrusion geometry doesn't compute yet; walls/
  floor/ceiling render as a flat, untextured `wallColor` fill, and the
  roof as a flat neutral tone. Visual parity with rectangle blocks'
  textured walls is real remaining work, not attempted here.
- **No eave overhang** on the flat roof slab (rectangle blocks' flat roof
  is oversized by 0.4m per axis for a visible overhang; the polygon
  version matches the wall footprint exactly).
- The `insetPolygon`'s outward-normal detection (which side of an edge is
  "outside") uses a centroid-relative heuristic that's exact for every
  case checked (including a reflex corner) but has one theoretical
  degenerate case noted in the code: an edge running exactly perpendicular
  to its own midpoint-to-centroid line could go either way. None of the
  three shipped presets hit this; a future free-form vertex-editing UI
  (Phase D) might need a more robust check if a user-drawn shape does.

**Not visually verified — no browser access this session**, same caveat
as §5's wall recesses and every other 3D feature built this way. The
geometry math is unit-tested and internally consistent (`tsc`/`vite
build`/125 tests all pass), but whether a mitered polygon block actually
*looks* right — walls meeting cleanly at the chamfered-bay's 135° corner,
the flat roof sitting flush, no z-fighting or backface-culling gaps from
the wall ring's winding — has not been checked in the running app. Please
add each of the three presets from the scene's right-click menu and look
at them before treating Phase A as done.

### Phase B — implemented 2026-08-31, including wall-opening cutouts

The `WallRef` restructure (decision 5) plus polygon-edge wall-anchoring:

- **`WallLocation`** (`types.ts`): `{kind:"side";side:WallSide} | {kind:"edge";index:number}`,
  replacing `WallRef.side: WallSide`. Done as the discriminated union you
  confirmed, not the non-breaking widen I'd recommended — see the real
  cost that added, below.
- **`componentSnap.ts`** fully generalized: `fitsOnWall`→`fitsOnEdge`,
  `offsetAlongSide`→`offsetAlongLocation`, `wallLength`/`alongWallPosition`
  now accept either a bare `WallSide` (every existing rectangle call site
  keeps compiling unchanged) or a full `WallLocation`. A polygon edge
  needs no `localSideToWorldSide`-style rotation conversion at all — an
  edge index already means the same physical wall regardless of the
  block's rotation (unlike `WallSide`), which turned out to make Phase B
  *simpler* than scoped in one specific way.
- **`snapComponentToWalls`** got a genuinely new algorithm for polygon
  edges (real 2D point-to-line-segment distance, since an edge can run at
  any angle — the rectangle side search's per-axis decomposition doesn't
  generalize), merged into the same "closest candidate wins" comparison
  as the existing rectangle-side search rather than replacing it.
- **Persistence migration** (the cost of choosing the discriminated union
  over the non-breaking widen, exactly as flagged when you made that
  call): `persistence.ts` now detects the old `wallRef: {side, ...}`
  shape on load and wraps it into `{location: {kind:"side", side}, ...}`
  before validation runs, so an existing saved building's doors/windows
  still load correctly. Verified by test with a hand-written old-shape
  fixture, not assumed.
- `mirrorComponentToOppositeWall` no-ops for an edge-anchored component
  (no "opposite edge" concept for a polygon — confirmed in `PLAN.md`'s
  own scoping) and the Inspector hides its button in that case rather
  than showing a button that does nothing.
- Every mechanical call-site fix (9 files: `componentSnap.ts`,
  `floorDuplication.ts`, `store.ts`, `Inspector.tsx`,
  `PlacedComponents.tsx`, `templates.ts`, plus the two test files) was
  driven by `tsc`'s own error list rather than a manual file-by-file
  search — every stale `.side` access became a compile error the moment
  the type changed, which is how completeness here was actually verified
  rather than assumed.
- New tests: `polygonGeometry.test.ts` (`polygonEdgeOutwardNormal`),
  `componentSnap.test.ts` (embedding/surface-mounting on a polygon edge,
  snapping to the nearest edge, span-too-wide refusal, all against a
  hand-derived 4×6 square-as-polygon fixture cross-checked against the
  equivalent rectangle-side test), `persistence.test.ts` (the migration).
  133 tests total, all passing; `tsc -b`/lint/`vite build` all clean.

**Polygon wall openings — implemented 2026-08-31.** The gap above is
closed, and with full sill/head banding (a real window opening, not just
full-height door-style holes — didn't need to defer that after all):
- New `getPolygonEdgeComponentOpenings` (baseGeometry.ts) — the
  `{kind:"edge"}` counterpart to `getComponentOpenings`, and genuinely
  simpler than it: an edge index needs no `edges()`/world-corner
  conversion at all (same reason Phase B's core mechanism above turned
  out simpler than scoped), so a cutout's interval is just
  `wallRef.offset ± half-width` directly, in the edge's own
  `[0, edgeLength]` frame.
- `buildPolygonWallGeometry` (polygonGeometry.ts) now takes an optional
  `edgePanels` — reuses `wallPanels` (the *exact* same interval-cutting
  function a rectangle wall already uses, called once per edge with that
  edge's own openings) to get a list of solid sub-runs, then lerps each
  edge's outer/inner boundary per sub-run's own `hMin`/`hMax` instead of
  the whole edge at once. A sub-run reaching a panel's full length exactly
  reproduces the no-opening geometry (verified by test), so this is a
  strict generalization, not a rewrite.
- Added the door/window **reveal (jamb) faces** at any sub-run boundary
  that doesn't land on the edge's true start/end vertex — without them, a
  door reveal or a window's sill/lintel would be an open gap rather than
  a solid framed edge (the same faces a rectangle wall's own per-panel
  box gets "for free" from being a real 6-sided box; a polygon wall's
  segments aren't boxes, so these needed adding explicitly).
- `PolygonBlockMesh` (Base.tsx) now receives `floorComponents` and builds
  the wall geometry from real per-edge panels instead of always-solid.
- **Defensive `side={THREE.DoubleSide}`** added to all 4 of
  `PolygonBlockMesh`'s materials (floor/wall/roof/ceiling) — this pass
  added meaningfully more triangle winding (the new reveal faces) on top
  of Phase A's own unverified winding, and getting one backwards would
  make it invisible under the default `FrontSide`, not just wrongly lit.
  DoubleSide trades a small perf cost to rule that failure mode out
  entirely until this can be checked in a real browser.
- New tests: `baseGeometry.test.ts` (`getPolygonEdgeComponentOpenings` —
  correct edge/interval targeting, ignores other blocks/side-kind refs/
  non-cutout types), `polygonGeometry.test.ts` (`buildPolygonWallGeometry`
  vertex counts: solid baseline, a mid-span opening adding exactly the 2
  expected reveal faces, and a full-length panel reproducing the solid
  baseline exactly). 139 tests total, all passing.

**Still not checked: the scene's right-click "Add Door/Window/…" flow**
(`SceneContextMenu.tsx`) end-to-end against a polygon wall — the
underlying `snapComponentToWalls`/geometry are both exercised by tests,
but the actual UI path hasn't been clicked through, and this pass's own
new reveal-face geometry is the least browser-verified piece in the
whole polygon-blocks effort so far. Please check a door/window on each of
the 3 presets before treating Phase B as done.

## 7. Optimization research (requested: rendering performance + real-world patterns)

**Researched 2026-08-31 (research only, no code changes — see below).**

- **Rendering performance, confirmed by reading the code**: every
  `PlacedComponents.tsx`/`Base.tsx` element is a plain `<mesh>`, no
  `InstancedMesh`/`Instances` anywhere in the codebase
  (`grep InstancedMesh src/components` → 0 hits). Each `PlacedComponent`
  (skylight, solar panel, balcony, stairs step, etc.) is its own React
  subtree with its own geometry+material, so N solar panels on one roof or
  N repeated floors (§14) means N full draw calls, not one instanced
  batch. Concretely: `SolarPanelDetails`/`PoolDetails` are 2 meshes each,
  `StairsDetails` is one `<mesh>` per step (`stairSteps().map`),
  `DoorTracks`/`DoorRibbingWindows` add 2-10 small meshes per garage
  door. None of this is a problem yet at today's typical component counts
  (a handful of doors/skylights per floor), but §14 (repeated
  apartment-block facades) and "numerous solar panels on a large roof"
  are exactly the cases that will start multiplying it — a 4-story
  building with a repeated window+balcony grid could easily reach
  hundreds of small meshes.
- **External validation**: three.js community guidance confirms this is
  the right thing to fix before it becomes visible — one cited case
  dropped draw calls from 9,000 to 300 by switching a repeated prop
  (chairs) to `InstancedMesh`, and a solar-panel-on-roof project is
  called out by name as a canonical `InstancedMesh` use case (same
  geometry, varying transform only) ([Three.js Instances, Codrops](https://tympanus.net/codrops/2025/07/10/three-js-instances-rendering-multiple-objects-simultaneously/), [100 Three.js Tips](https://www.utsubo.com/blog/threejs-best-practices-100-tips)). The react-three-fiber
  equivalent is `@react-three/drei`'s `<Instances>`/`<Instance>` (already
  an indirect dependency via drei, not yet imported anywhere in this
  codebase) — a drop-in for exactly this "same geometry, many transforms"
  shape, without hand-rolling raw `InstancedMesh` buffer updates.
- **Recommendation, not yet implemented**: when §14 (repeated facades) or
  large solar arrays are revisited, batch identical repeated elements
  (solar panel frames+cells, stairs steps, railing posts, repeated
  window/balcony units) through `<Instances>` per component-type-per-floor
  rather than one `<mesh>` each. Skip it for one-off components (doors,
  single balconies) where the count never gets large enough to matter —
  instancing has its own overhead and isn't free below a few dozen
  identical objects ([three.js forum: when is InstancedMesh worth it](https://discourse.threejs.org/t/when-is-instancedmesh-worth-it-in-three/62044)).
- **Real-world patterns**: not separately investigated beyond the
  rendering-technique research above — no specific competing configurator
  was reviewed for its data model. If this still matters when §6/§14 data
  models are being finalized, revisit as its own targeted look rather than
  a generic survey.

## 8. Keyboard shortcut: number keys switch floors

**Implemented 2026-08-31**, no-op default confirmed. `1`-`5` call
`setActiveFloor(index)` directly in `App.tsx`'s `onKeyDown`, relying on
that action's own existing clamp (no extra range check needed) — pressing
a number past the building's floor count is a silent no-op there already.
Added to the `SHORTCUTS` list shown in the header's popover.

Added 2026-08-28. Small, independent of everything above — doesn't touch
`WallSide`, roofs, or blocks, so it isn't blocked on any of the open
decisions and can ship on its own.

- `1`–`5` (matching `MAX_FLOORS`) select floor index 0-4 directly, calling
  the existing `setActiveFloor(index)` store action (already clamps to the
  current floor count, so pressing e.g. `4` on a 2-floor building is a
  no-op rather than an error).
- Wire into `App.tsx`'s existing `onKeyDown` handler, same place
  Ctrl+Z/R/T/Delete already live — same `INPUT`/`SELECT`/`TEXTAREA` guard
  so it doesn't fire while typing in a field.
- Add the new shortcuts to the `SHORTCUTS` list shown in the header's
  keyboard-shortcuts popover, so it's discoverable the same way the
  existing ones are.
- Open question: factory halls cap at `MIN_FLOORS` (1) — should `2`-`5`
  just be no-ops there (simplest, matches `setActiveFloor`'s existing
  clamp), or should the shortcut not fire at all for a building with only
  1 floor? Defaulting to **simplest (no-op)** unless you say otherwise.

## 9. Redo U-shaped/L-shaped templates from real reference buildings

Added 2026-08-28. Your call: the current `u-shaped-house`/`l-shaped-house`
starter templates (plain rectangular wings bolted onto a plain rectangular
main block, arbitrary dimensions I picked, not modeled on anything real)
"look ridiculous" — agreed they were never actually checked against a
real reference, unlike the reference-gallery-driven work earlier this
session (per-block roof type, corner glazing, etc., which *was* grounded
in real houses from the screenshots you shared).

Plan: before touching template code again, gather real reference
buildings for these two shapes specifically (either you share
photos/links the way you did with the reference gallery earlier, or point
me at a source I can browse) and redesign proportions, wing placement,
roofline, and window/door layout to actually match something real, rather
than guessing plausible-sounding numbers. Applies to `u-shaped-house` and
`l-shaped-house` at minimum — worth checking the rest of the template
list (`family-house`, `two-story-house`, `overhang-entry-house`,
`shifted-upper-villa`, `tiered-villa`) against real references too while
we're at it, rather than assuming those are fine just because no one's
flagged them yet.

Blocked on: reference material from you. Not blocked on §0–§7 — doesn't
need `WallSide`/polygon-block work, though a redesign might reasonably
want to *use* mono-pitch/hip/corner-glazing/porches once those are
solid.

## 10. Balcony (cantilevered slab + railing) component

Added 2026-08-31, from the 3D-model reference gap analysis (see below) —
`Modern_House_CGTrader`'s `Balcony`/`Balcony2` objects and the SketchUp
`Modern_Urban_Villa` thumbnail both show a proper cantilevered balcony
slab with a railing along its free edge, which today's `roofSection`
(flat freestanding panel) + `railing` (guardrail bar) can only
approximate by hand-placing two unrelated components with no shared
identity — no "this is a balcony" concept, no single click-to-select, no
automatic alignment between the slab's free edge and the railing.

Scope: a new `ComponentType: "balcony"` — a shallow slab (like
`roofSection`'s geometry treatment) that snaps to a wall the same way a
porch does (reusing `alongWallPosition`/`wallLength`, local-side
button semantics like `addPorch`), plus a railing automatically rendered
along its outward-facing free edge (reusing `RailingDetails` from
`PlacedComponents.tsx`) as part of the same component rather than a
second placed object. Width/depth editable like `roofSection` already
is. Not floor-restricted like porches (a balcony makes sense on any
floor, including the top one, off any wall) but does need a floor
check: only floors above ground level really need a railing on the
free edge floor-to-floor. **Open question**: should the railing be
optional (toggle) for a ground-floor "balcony" that's really just a
terrace, or should ground-floor placement just reuse `roofSection` and
the new type stay upper-floor-only? Defaulting to **always render the
railing** — simplest, matches every visible reference — flag if you
want a ground-floor terrace variant without one.

**Implemented 2026-08-31 — with one deliberate deviation from the scope
above.** Rather than a single `balcony` component whose Details sibling
tries to re-derive "which edge is outward" from nothing but its own
scale (ambiguous — front/back and left/right walls can share the exact
same `rotation` value, see `alongWallPosition`), `addBalcony` follows
`addPorch`'s own precedent instead: it bakes **two** independent
`PlacedComponent`s at once — a `balcony`-typed slab (a plain visible box,
same "no Details sibling, just a solid material" treatment as
`roofSection`) and a `railing`-typed component positioned/rotated along
the slab's free edge, computed at creation time using the exact same
`outerAxis`/`outerSign` math `roofWithColumns` already uses for porch
columns. This reuses `RailingDetails` entirely — zero new rendering code
for the rail. Not floor-restricted (works on any floor via the
Inspector's "Balcony" section, unconditional unlike Porch's
`isGroundFloor` gate). Like a porch, it does **not** carry a `wallRef` —
it won't follow the block if later rotated or moved (the same accepted
limitation porches already have; verified `alongWallPosition` doesn't
account for a surface-mounted component's own protrusion depth, so
wiring a `wallRef` in without also fixing that would have *silently
mispositioned* the balcony on any future rotation/floor-duplication —
worse than the current honest limitation). Regression tests added in
`store.test.ts` covering both wall-axis cases (front/back vs left/right
railing orientation).

**Follow-up noted 2026-08-31, resolved 2026-08-31**: two balconies added
on a block's *adjacent* walls (e.g. "+ Front" and "+ Right" on the same
block) now merge into one continuous L-shaped balcony instead of
rendering as two independent slabs with an open/unrailed corner —
explicitly chosen over the smaller "close each short end with a railing
return" alternative.

Implementation: new pure-geometry module `balconyGeometry.ts`
(fully unit-tested, `balconyGeometry.test.ts`) —
`adjacentBalconySides` detects whether two `WallSide`s share a corner,
`mergeAdjacentBalconyFootprint` builds the L-shaped polygon (one arm's
depth extended into the shared corner so the two arms share an edge, not
just a point) in block-local space, `railingForFreeEdge` places a
straight railing on each of the merged shape's 4 free edges (the 2 edges
where each arm meets its own wall get no railing, same as a simple
balcony's wall-side edge). `addBalcony` (store.ts) now looks for an
existing *simple* (single-side) balcony on the same block via new
`PlacedComponent` fields (`balconyBlockId`/`balconySides`/
`balconyRailingIds`) — if the new side is adjacent, it deletes the old
slab+railing and creates one merged `balcony` (carrying an absolute
world-space `polygon`, transformed from local via `rotatePolygon` +
translation) plus up to 4 new railings; otherwise it falls back to the
original simple single-wall behavior, now tagging its own components so
a *later* balcony can still find and merge with it.

Rendering (`PlacedComponents.tsx`): a `balcony` component with `polygon`
set renders its real solid via new `BalconySlabDetails` (extrudes the
polygon directly via `buildPolygonSlabGeometry`, reused as-is from the
§6 polygon-block work) instead of the plain box; the box itself becomes
a near-invisible hitbox sized from the polygon's bounding box, same
"invisible hitbox + Details sibling" pattern already used for
railing/table/bracing.

**Scope limit, not built**: only a two-wall (single-corner) merge is
supported. Adding a *third* balcony adjacent to an already-merged
L-shaped one does not fold into a U-shape — it only matches against
still-simple (single-side) balconies, so it would currently create a
separate, likely-overlapping simple balcony at that corner instead.
Flagging this rather than guessing at 3-way merge geometry that wasn't
asked for. **Not visually verified** (no Chrome calls this session) —
checked only via `balconyGeometry.test.ts` (9 tests), `store.test.ts`'s
new merge-specific test, `tsc -b --noEmit`, lint, and `vite build`.

## 11. Swimming pool component

Added 2026-08-31, from `Modern_House_CGTrader`'s `Pool` object. No
existing component approximates this — every current type is either a
solid opaque box (wrong material read entirely) or the transparent glass
treatment used for windows/skylights (wrong — a pool reads as a flat
tinted-blue water surface with a rim, not vertical glass panes).

Scope: a new `ComponentType: "pool"` — a shallow rectangular recess
(rim box + a flat water-colored top face, similar tier of detail to
`SolarPanelDetails`'s frame+face approach: no real-time reflection/
refraction shader, just a convincing flat material, consistent with
this app's existing "flat colors, not photoreal" materials policy).
Freestanding (ground-level placement only, like `table`/`column` — a
pool doesn't snap to a wall), width/depth/depth-of-water resizable via
the Inspector the same way `opening`/`solarPanel` are. Ground-floor only
(a rooftop pool is a real but much rarer case — out of scope unless you
ask for it).

**Implemented 2026-08-31** as scoped: `pool` added to
`HOUSE_COMPONENT_LIBRARY` (freestanding, placed via the generic "Add
component" menu like `table`/`column` — no dedicated button needed since
it doesn't attach to anything). `PoolDetails` (`PlacedComponents.tsx`)
renders a solid rim box + a flat semi-transparent water-colored face
inset near the top — same "invisible hitbox + Details sibling" pattern
as `solarPanel`/`table`. A new "Pool Size" section in `ComponentEditor`
(Inspector.tsx) exposes Width/Depth `NumberField`s, same pattern as the
existing "Solar Panel Size"/"Opening Size" sections. No "ground-floor
only" *enforcement* added (unlike porch's explicit guard) — placement is
freestanding/manual like `table`, so there's no wall/floor-index concept
to gate on in the first place; a rep placing one on an upper floor is
just placing a freestanding object there, same as they could already do
with a table.

## 12. Stairs component

Added 2026-08-31, from `Modern_House_CGTrader`'s `Stairs` object —
needed once a building has more than one floor and the model should
show how someone actually gets between them (currently floors stack with
no visual connection at all between them).

Scope: a new `ComponentType: "stairs"` — a run of steps generated from
overall width/rise/run (like `roofWithColumns`'s procedural-array
approach for porch columns, not a single box): N step boxes computed
from the component's own height (floor-to-floor) and a target riser
height (~0.18m, real-world stair-code range), each step's own box offset
up-and-along by that amount. Freestanding placement (like `column`), no
wall-snapping, height defaults to the *current floor's* clearance
(`floorHeight`) so a straight run naturally reaches the floor above
without per-instance tuning. **Not** attempting a landing/turn (L- or
U-shaped stair) in this first pass — a single straight run only. Adding
turned runs with a landing is a real but separate follow-up if you want
the full Modern House look exactly, given the added geometry complexity.

**Implemented 2026-08-31**, mostly as scoped, one refinement: the step
geometry (`stairSteps`) lives in its own new `stairs.ts` module (not
inlined in `PlacedComponents.tsx`) specifically so it's a pure,
independently unit-testable function — `stairs.test.ts` checks the
riser stays within ~0.18m of the target, the top step reaches the full
rise, and the flight is centered/spans the requested run. Each step
renders as a *solid stepped block* (a box reaching from the ground to
its own tread, not a single ramp) — the shape that actually reads as
stairs rather than a slope. `resolveComponentSize`'s new `"stairs"` case
derives rise from the current floor's `wallHeight` and run from the
same real-world riser/tread ratio the geometry itself targets (~0.18m
riser / ~0.28m tread), so a freshly placed flight already reaches the
floor above without manual tuning. Added to `HOUSE_COMPONENT_LIBRARY`
(freestanding, like `pool`/`table`).

## 13. Fencing — resolved, no new work needed

Added 2026-08-31, from `Modern_House_CGTrader`'s `Fence`/`Railing`
objects (both present, visually similar: horizontal bars + poles around
the pool/terrace perimeter). Investigated: the existing `railing`
component already covers this — same "top rail + kick + posts" geometry
(`RailingDetails`) works equally well as a ground-level pool/terrace
fence as it does as a balcony guardrail. No data-model or rendering gap;
this is a labeling/discoverability question at most (should the
component library list a "Fence" entry that's really just `railing` with
different default height/position?), not a code gap. **No action
planned** unless you want that extra menu entry for discoverability.

## 14. Multi-story apartment-block massing (repeated window/balcony grid)

Added 2026-08-31, from `Apartment_Building_01_CGTrader` — its own mesh
names were too generic to confirm details, but the genre (and the
folder's own title) strongly implies a multi-story building with a
*repeated* facade: the same window (and likely balcony) placed at the
same spot on every floor, many times across a long facade. Today that
means manually placing every window on every floor by hand — for a
5-story, 6-bay-per-floor facade that's 30 individual placements with no
way to edit them as a group afterward (move one bay's window width, and
every copy has to be edited separately).

Scope (biggest of the reference-gap items, not counting §6): a "repeat
along wall" / "copy to every floor" tool — conceptually close to the
existing `duplicateComponentsToFloorAbove` (which already re-anchors a
wall-mounted component onto the matching block on the floor above, one
floor at a time) but extended to **all** floors at once in one action,
plus a **repeat-along-this-wall** action (evenly spaced copies at a
given spacing/count, reusing `alongWallPosition`/`wallLength`, similar
math to `centerSelectedComponentsHorizontally`'s even-spacing logic).
Together these turn "place a window once" into "place it on every floor,
every bay" without 30 manual placements — the copies stay independent
`PlacedComponent`s afterward (no live-linked "master" concept), matching
how `duplicateComponentsToFloorAbove` already works today. **Open
question**: is independent-copies-after-placement enough, or do you want
true linked instances (edit one, all copies update) for a real apartment
facade workflow? Independent copies is far less new architecture
(no new "instance group" concept needed anywhere else in the app) —
recommending that first, revisit linked instances only if it turns out
to be a real workflow pain.

**Implemented 2026-08-31 with independent copies (the recommended
option, per the open question above — revisit linked instances only if
you actually hit the edit-one-update-all workflow pain in practice).**
- **Repeat along wall**: `repeatComponentAlongWall(id, count)`
  (`store.ts`) — new Inspector "Repeat Along Wall" section on any
  wall-anchored component, with a `count` field and a "Repeat N×" button.
  *Replaces* the one component with `count` evenly spaced copies across
  the wall's full span (same spacing formula
  `centerSelectedComponentsHorizontally` already uses) — the original is
  consumed, not left behind as an extra copy. No-ops for a freestanding
  component or `count < 1`.
- **Copy to all floors above**: `duplicateComponentsToAllFloorsAbove`
  (`floorDuplication.ts`) repeats the existing single-floor version
  floor-by-floor up to the top, chaining forward (each floor's own
  copies become the next floor's source) so re-anchoring is still
  checked independently against every floor's own blocks — a mismatch on
  floor 3 doesn't stop floors 4-5 from getting a copy too. Wired as
  `duplicateComponentToAllFloorsAbove`/
  `duplicateSelectedComponentsToAllFloorsAbove` in `store.ts`, with
  "Duplicate to All Floors Above"/"Duplicate All to All Floors Above"
  buttons next to the existing single-floor ones in the Inspector. Had to
  add an `unanchoredCount` field to `FloorDuplicationResult` so the
  chaining function could accumulate the total across every floor it
  climbed, without parsing the human-readable `notice` string back apart.
- Regression tests added in `store.test.ts` for both — including one
  discovered while writing them: this file's tests share one zustand
  store instance, so a new test's own wall-placement math has to account
  for what earlier tests already left on that same wall (fixed by
  targeting an empty wall/using a diff-against-snapshot assertion instead
  of filtering by type, rather than assuming a clean slate).

## Reference-gap analysis (2026-08-31): what 4 example buildings need

You pointed at 4 downloaded 3D models (`Downloads/3D_Models`) as
"somewhat recreatable" targets. Investigated without browser/3D-viewer
access this session — one (`Modern_Urban_Villa_SketchUp`) had an
embedded SketchUp thumbnail I extracted directly from the binary and
actually looked at; `Modern_House_CGTrader`'s binary FBX had well-labeled
mesh names (`Floor1`/`Floor2`, `Walls_upstairs`, `Balcony`, `Pool`,
`Stairs`, `Fence`, multiple glass walls/terrace doors) readable via a
plain string scan; `Villa_01_CGTrader`'s OBJ is plain text but its object
names are generic 3ds Max defaults inside a full landscaped scene (road,
sidewalk, streetlamps, furniture) — only got a rough multi-material,
large-footprint read, no roof type; `Apartment_Building_01_CGTrader`'s
FBX has no thumbnail and only 13 generically-named mesh parts — genuinely
couldn't determine its shape, this read is inferred from genre/name only.

**Already reproducible today, no changes**: multi-material facades
(per-block `wallMaterialId`/`wallColor`), flat roofs + `fullHeight`
glazing + corner glazing, 2+ story stacking with independent per-floor
footprints (tiered massing), a covered terrace/carport (`addPorch`).

**New work identified**: §10 (balcony), §11 (pool), §12 (stairs), §13
(fencing — resolved, no work), §14 (apartment repeat/array tooling).
§6 (free-form polygon blocks) covers the case where Villa_01 or the
apartment building turn out to have genuinely non-rectangular massing
once actually viewed — **you asked for §6 to be done last** among all of
this, so it's sequenced at the end below regardless of its position in
this document.

**Implementation order for this batch** (§10-§14, then §6 last, per your
instruction): §11 (pool) and §13 (fencing, no-op) first — fully
independent, no shared groundwork; then §10 (balcony) and §12 (stairs) —
each a self-contained new component type; then §14 (apartment massing) —
benefits from §10/§12 existing so a repeated facade has real balconies to
repeat; then §6 last.

## Starter templates for the 4 reference buildings (2026-08-31, reverted)

Added, then reverted same-day at your request ("these look terrible,
remove the house templates for now, we will look at these later") — the
4 templates below were removed from `templates.ts` (and their
now-unused-elsewhere helpers `blockBalcony`/`standalonePool`/
`exteriorStairs`); `templates.test.ts` (the generic
"every template builds cleanly" check) was kept since it's not specific
to these 4. Recorded here so a future attempt doesn't restart from
scratch without knowing this was already tried and rejected on
appearance — needs an actual look at the 3D viewport (or your own
guidance on proportions/composition) before trying again, not just more
guessing from mesh names/thumbnails.

Original entries (for reference, not currently in the codebase),
recreating each of the 4 downloaded reference models from the
reference-gap analysis above, using only features already supported by
that point (balcony, pool, stairs — §10-§12):

- **`modern-house-pool`** ("Modern House (Pool & Balcony)"): 2-story flat
  roof, full-height glazing facing a freestanding backyard pool, a
  balcony off the upper floor overlooking the pool, exterior side
  stairs — recreates `Modern_House_CGTrader`'s own labeled mesh set
  (Floor1/Floor2, Balcony, Pool, Stairs; its `Fence` is a no-op, §13).
- **`modern-urban-villa`** ("Modern Urban Villa (Flat Roof + Carport)"):
  single flat-roofed volume, wide glazing on every side, a covered
  carport beside the entry — recreates `Modern_Urban_Villa_SketchUp`'s
  own embedded thumbnail.
- **`villa-estate`** ("Villa Estate (Multi-Material Wing)"): a large
  two-material footprint (plaster main volume + wood-clad wing) —
  recreates `Villa_01_CGTrader`'s multi-material facade finding; its
  roof type and the OBJ's landscaping (road/sidewalk/streetlamps/
  furniture) couldn't be determined/aren't in scope, so this uses a flat
  roof and models only the building envelope.
- **`apartment-building`** ("Apartment Building (4-Story)"): 4 stacked
  floors with an identical repeated window+balcony grid on every upper
  floor — recreates the *genre* `Apartment_Building_01_CGTrader` implied
  (its FBX had no thumbnail and only generic mesh names, so its actual
  shape was never determined), built around §14's repeated-facade scope.

New `templates.ts` helpers: `blockBalcony` (a simple single-wall
balcony+railing pair, inlined from `addBalcony`'s own simple branch since
every template block has `rotation: 0`), `standalonePool` (a freestanding
pool not attached to any wall), `exteriorStairs` (a straight flight
alongside a block's left/right wall, rise auto-matched to that floor's
own height via `resolveComponentSize`).

New `templates.test.ts`: for every `STARTER_TEMPLATES` entry, asserts it
builds without throwing, every floor has at least one block, every
component's position/rotation/scale are finite numbers (catches a bad
wall-offset/edge calculation silently producing `NaN`), and component ids
are unique. **Not visually verified** (no Chrome calls this session) —
checked only via that test, `tsc -b --noEmit`, lint, and `vite build`.

## 15. Reference-house recreation: Poggiolina / Sara / Ulissys (2026-08-31)

Superseded §9's placeholder (no reference material had arrived yet) — you
sent 3 real reference house photo sets instead of the old U/L-shaped ask:
`Downloads/poggiolina` (Villa Poggiolina), `Downloads/Sara` (Chalet Sara),
`Downloads/Ullisys` (Villa Ulissys). Reviewed each set's photos directly
(no 3D models this time, just stills) and built 2 of the 3 as new
`templates.ts` entries, block-shape/window/door placement prioritized over
material accuracy per your explicit steer ("Structure and Model is more
important than textures here"):

- **`villa-poggiolina`** and **`chalet-sara`**: added, and confirmed
  "almost right" by you looking at the live dev server. Kept in
  `templates.ts` as-is for now — the specific remaining tweaks are
  deliberately not listed here since you asked to hold that feedback
  until the 4 items below are sorted first, not to guess at it.
- **`villa-ulissys`**: added, then called out by you as looking wrong
  ("an abomination with the components we had") and **removed** the same
  session rather than left in a known-bad state — same call as the
  earlier starter-template revert (see "Starter templates..." section
  above). Its composition (a stone-toned ground floor cantilevered under
  a wood-toned upper floor, mono-pitch roof, wraparound balcony,
  freestanding lap pool) is still a reasonable target; it needs
  revisiting once at least the window-group and rotation items below
  exist, not just parameter tweaking of what was there.

What actually went wrong, per your own diagnosis: I was bending existing
components to fake shapes they were never meant for (dozens of individual
tiny `window` components standing in for a punched decorative grid; 3
separate non-merging balcony slabs standing in for a real wraparound
terrace; a plain block-material tint standing in for a genuinely
different-shaped stone plinth) instead of building the right primitive.
The 4 concrete gaps that surfaced, in your own words, with the technical
reality behind each (**documented here only — none of this is
implemented yet**, per your explicit instruction to record and hold
rather than start coding):

1. **A real "window group" component.** Today, a decorative grid of small
   punched openings (Poggiolina's gable-end screens) can only be faked by
   placing one `window`-type `PlacedComponent` per opening — dozens of
   components for one visual feature, none of them selectable/movable as
   the single thing they actually are. Needs a new `ComponentType` (e.g.
   `windowGroup`) carrying its own rows/cols/cell-size/spacing, rendered
   as one repeated-geometry unit (this pairs naturally with §7's
   `InstancedMesh`/drei `<Instances>` recommendation — a window group is
   exactly the "same geometry, many transforms" case that research
   flagged) and selectable/editable as one placed component in the
   Inspector, not N of them.
2. **Recessed walls should let a window/skylight actually cut a hole,
   not just sit on the surface.** For **walls**, this already works today
   — `wallRunSegments`/`wallDepthSegments` (`baseGeometry.ts`) route each
   depth segment's own component openings through independently, so a
   window placed within a `WallRecess`'s span already cuts a real
   opening in that recessed (thinner) wall face; confirmed by reading
   `Base.tsx`'s `frontRuns`/`backRuns`/`leftRuns`/`rightRuns` construction,
   not assumed. The templates just never exercised this pairing — worth
   redoing Poggiolina's gable screens as a shallow `WallRecess` with real
   window cutouts once (1) exists, for the actual shadow/depth a punched
   concrete screen needs, instead of flat window planes glued onto a flat
   wall. For **roofs**, this genuinely doesn't exist — `skylight`/
   `solarPanel` are deliberately "a raised box sitting proud of the roof
   surface" (see `DEFAULT_SCALE.skylight`'s own comment in `types.ts`),
   not a flush cutout with light actually passing through a hole in the
   roof mesh. Making a skylight a real cutout needs the roof surface
   geometry itself to subtract a hole per placed skylight — a real
   geometry change (roof mesh generation, not just placement math),
   sized similarly to the hip-roof containment work in §4.
3. **Joining blocks at angles / more complex shapes.** `BlockRotation`
   (`types.ts`) is hardcoded to `0 | 90 | 180 | 270` everywhere, including
   for polygon blocks — `rotatePolygon` (`polygonGeometry.ts`) only ever
   does a 90°-swap (`{x, z} -> {z, -x}` repeated), never real
   trigonometry. Poggiolina's own two wings sit at a slight kink to each
   other in the reference photos, which today's engine simply cannot
   represent. **Your direction**: make free rotation an opt-in toggle,
   not the new default — ordinary blocks keep snapping the way they do
   today, and a separate mode unlocks non-snapping arbitrary-angle
   placement for whoever wants it. **Also add 45° increments to the
   default snapping set** (0/45/90/135/180/225/270/315), independent of
   the free-rotation toggle — a fixed, still-discrete option partway
   between today's quarter-turns and full freedom. Real arbitrary rotation
   requires `rotatePolygon` (and everything built on its 90°-swap
   assumption — `edges()`, wall panel generation, block-to-block
   adjacency, snapping, roof slope math, camera framing) to switch to
   actual sin/cos rotation instead — the widest-blast-radius item of the
   four, which is why it's documented rather than started.
4. Rectangle (non-polygon) blocks still can't be genuinely non-rectangular
   — free-form footprints already exist for polygon blocks (§6), so
   "more complex shapes" mostly means: (a) finish §6 Phase C's own
   loose ends rather than a new mechanism, and (b) once (3) lands, polygon
   blocks joined at a real angle rather than only 90°-swapped.

**Sequencing, per your instruction**: document all 4 here now; none
started. When picked back up, revisit `villa-ulissys` (and polish
`villa-poggiolina`/`chalet-sara` per your held-back feedback) using
whichever of the 4 items are done by then, rather than patching the
current templates' parameters in place.

## Open decisions needed from you before implementation starts

1. §0: fix `WallSide` globally now (my recommendation), or ship a
   porch-only patch first and defer the real fix to the polygon-blocks
   work?
2. §5: confirm the "notch doesn't change the block's footprint corners"
   reading is what you meant.
3. §6: confirmed free-form, but do you want it scoped as its own
   follow-up planning pass after §0 lands (my recommendation), or do you
   want a full polygon data-model proposal written now regardless?
4. §8: confirm the no-op default for floor numbers beyond the building's
   actual floor count, or say if you want something else.
5. §9: send reference photos/links for the U-shaped and L-shaped houses
   (and flag any of the other templates you also want redone) whenever
   you're ready — this one just waits on that, no decision needed from me.
