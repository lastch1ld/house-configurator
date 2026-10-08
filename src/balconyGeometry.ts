import { polygonEdgeOutwardNormal, type Point2D } from "./polygonGeometry";
import type { WallSide } from "./types";

/**
 * The merged L-shaped footprint of two balconies on adjacent walls (PLAN.md
 * §10's own follow-up note) — one arm along the block's left/right wall,
 * one along its front/back wall, both extended into the shared corner so
 * they form one connected region rather than two rectangles that only
 * touch at a single point. `polygon` is in the block's own local space
 * (pre-rotation, same frame `BaseBlock.polygon`/`wallRecesses` already
 * use). `freeEdges` are the 4 outward-facing edges that need a railing —
 * the other 2 (where each arm meets its own wall) don't.
 */
export interface MergedBalconyFootprint {
  polygon: Point2D[];
  freeEdges: [Point2D, Point2D][];
}

/**
 * Whether `a`/`b` are adjacent walls (share a corner) rather than opposite
 * ones — front/back are never adjacent to each other, nor are left/right,
 * but any front-or-back paired with any left-or-right always shares
 * exactly one of the block's 4 corners. Returns which one is the
 * left/right ("x") arm and which is the front/back ("z") arm, in whatever
 * order `a`/`b` were given, or `null` for a non-adjacent (or identical) pair.
 */
export function adjacentBalconySides(
  a: WallSide,
  b: WallSide
): { xArmSide: "left" | "right"; zArmSide: "front" | "back" } | null {
  const isX = (s: WallSide): s is "left" | "right" => s === "left" || s === "right";
  const isZ = (s: WallSide): s is "front" | "back" => s === "front" || s === "back";
  if (isX(a) && isZ(b)) return { xArmSide: a, zArmSide: b };
  if (isZ(a) && isX(b)) return { xArmSide: b, zArmSide: a };
  return null;
}

/**
 * Builds the merged L-shape for a block of `width`×`depth`, with an arm of
 * `xArmDepth` along `xArmSide` (left/right) and `zArmDepth` along
 * `zArmSide` (front/back). Derived once for the front+right case (the
 * "canonical" shape below) and generalized to the other 3 corners by
 * scaling x by ±1 (right/left) and z by ±1 (front/back) — a pure
 * reflection, which keeps the polygon valid (just possibly reversing its
 * winding, which every consumer of this shape — `triangulatePolygon`,
 * `insetPolygon`, `polygonEdgeOutwardNormal` — already handles either way).
 */
export function mergeAdjacentBalconyFootprint(
  width: number,
  depth: number,
  xArmSide: "left" | "right",
  xArmDepth: number,
  zArmSide: "front" | "back",
  zArmDepth: number
): MergedBalconyFootprint {
  const signX = xArmSide === "right" ? 1 : -1;
  const signZ = zArmSide === "front" ? 1 : -1;
  const w2 = width / 2;
  const d2 = depth / 2;
  // Canonical shape (signX=signZ=1, i.e. right+front): the right arm's own
  // span [w2, w2+xArmDepth] × [-d2, d2], the front arm's own span
  // [-w2, w2+xArmDepth] × [d2, d2+zArmDepth] (extended into the corner so
  // the two arms share an edge, not just a point), unioned.
  const canonical: Point2D[] = [
    { x: w2, z: -d2 },
    { x: w2 + xArmDepth, z: -d2 },
    { x: w2 + xArmDepth, z: d2 + zArmDepth },
    { x: -w2, z: d2 + zArmDepth },
    { x: -w2, z: d2 },
    { x: w2, z: d2 },
  ];
  const polygon = canonical.map((p) => ({ x: p.x * signX, z: p.z * signZ }));
  // Edges 0-3 (v0v1, v1v2, v2v3, v3v4) are the outward-facing free
  // perimeter; edges 4 (v4v5) and 5 (v5v0) are where each arm meets its
  // own wall — see this function's own doc for the vertex layout.
  const freeEdges: [Point2D, Point2D][] = [0, 1, 2, 3].map((i) => [
    polygon[i],
    polygon[(i + 1) % polygon.length],
  ]);
  return { polygon, freeEdges };
}

/** A straight railing's position/rotation/span for one free edge of a
 * merged balcony — reuses `polygonEdgeOutwardNormal` (already correct for
 * any winding) to inset the rail by half its own thickness from the true
 * boundary edge, same "flush with the outer edge" convention `addBalcony`
 * already uses for a simple (non-merged) balcony. Every free edge of this
 * particular L-shape is axis-aligned by construction, so a plain 0/π-2
 * rotation (matching every other straight railing in this app) is exact,
 * not an approximation. */
export function railingForFreeEdge(
  polygon: Point2D[],
  edgeIndex: number,
  railThickness: number
): { x: number; z: number; rotationY: number; span: number } {
  const a = polygon[edgeIndex];
  const b = polygon[(edgeIndex + 1) % polygon.length];
  const normal = polygonEdgeOutwardNormal(polygon, edgeIndex);
  const midX = (a.x + b.x) / 2 - normal.x * (railThickness / 2);
  const midZ = (a.z + b.z) / 2 - normal.z * (railThickness / 2);
  const horizontal = Math.abs(a.z - b.z) < 1e-6;
  const span = horizontal ? Math.abs(a.x - b.x) : Math.abs(a.z - b.z);
  return { x: midX, z: midZ, rotationY: horizontal ? 0 : Math.PI / 2, span };
}
