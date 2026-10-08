import type { PolygonVertex } from "./types";

/** Hand-authored free-form footprint presets (PLAN.md §6 Phase A) — a rep
 * drops one in and repositions/scales it as a whole; there's no
 * interactive vertex-editing UI yet (a deliberate, separate Phase D). All
 * three are centered on their own bounding box, so placing one behaves
 * the same as adding an ordinary rectangular block. */
export type PolygonPresetKey = "l-shape" | "t-shape" | "chamfered-bay";

export const POLYGON_PRESETS: Record<
  PolygonPresetKey,
  { label: string; polygon: PolygonVertex[] }
> = {
  "l-shape": {
    label: "L-Shape",
    // An 8x8 footprint with the top-right 4x4 quadrant removed.
    polygon: [
      { x: -4, z: -4 },
      { x: 4, z: -4 },
      { x: 4, z: 0 },
      { x: 0, z: 0 },
      { x: 0, z: 4 },
      { x: -4, z: 4 },
    ],
  },
  "t-shape": {
    label: "T-Shape",
    // An 8x8 footprint: an 8x2 top bar over a 3-wide stem.
    polygon: [
      { x: -1.5, z: -4 },
      { x: 1.5, z: -4 },
      { x: 1.5, z: 2 },
      { x: 4, z: 2 },
      { x: 4, z: 4 },
      { x: -4, z: 4 },
      { x: -4, z: 2 },
      { x: -1.5, z: 2 },
    ],
  },
  "chamfered-bay": {
    label: "Chamfered Bay",
    // A 6x6 footprint with one corner cut at 45° — the simplest
    // non-right-angle shape, exercising the general miter-join geometry
    // (`insetPolygon`) rather than only the 90°/270° corners the other
    // two presets use.
    polygon: [
      { x: -3, z: -3 },
      { x: 3, z: -3 },
      { x: 3, z: 1 },
      { x: 1, z: 3 },
      { x: -3, z: 3 },
    ],
  },
};
