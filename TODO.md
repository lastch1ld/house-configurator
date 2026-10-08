# TODO

Near-term punch list. See `ROADMAP.md` for the longer-range phase plan.
Completed items are cleared out of this file once done — check git history
(`git log -- apps/house-configurator/TODO.md`) for the record of past work.

## Next up

- [ ] **Shareable build link (backend record + short URL).** Local
  save/load already works (`persistence.ts`, `localStorage`-backed) — this
  is the remaining part of ROADMAP.md's Sales/Marketing Workflow phase: a
  backend record + shareable short ID/URL so a rep can send a build to a
  client without them needing the same browser.
- [ ] **Wall-fit checks not applied to every placement path.**
  `componentSnap.ts`'s `fitsOnWall` (span/opening/overlap validation) only
  guards the two interactive paths — `addComponent` and drag-end
  (`PlacedComponents.tsx`). `mirrorComponentToOppositeWall` and
  `duplicateComponentsToFloorAbove` (`store.ts`) both place a component via
  `alongWallPosition` directly, bypassing it — a mirrored/duplicated copy
  can still land in an open passage or overlapping another component.
  Smaller blast radius than the drag path (manual actions, not the primary
  interaction), which is why it wasn't folded into that fix.
- [ ] **Continuous wall texture across floor slabs.** Blocked on
  ROADMAP.md's Materials Catalog phase (walls are flat-color only right
  now) — once that's redone with real textures, make sure the tiling spans
  a multi-floor wall's full height continuously rather than resetting per
  floor, otherwise the inter-floor slab (`components/Base.tsx`'s
  `!isTopFloor` ceiling-slab mesh) will show up as a visible seam/darker
  band against the texture.
- [ ] **Bracing doesn't literally follow the gable's slope angle.** It's
  wide/shallow and defaults near the roofline (fixed from standing
  floor-to-ceiling like a column), but it isn't tilted to the actual roof
  pitch the way a skylight is (`addSkylight`'s slope-aware quaternion
  math). Worth doing if "along the roof" was meant literally rather than
  just "not vertical."
- [ ] **Door panel bevel/frame trim is still basic.** Flat recessed/raised
  panels, a plain rectangular casing — a deeper bevel profile or a
  non-rectangular trim would read as more detailed if more door polish is
  wanted later.
