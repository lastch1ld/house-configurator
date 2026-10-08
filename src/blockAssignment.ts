import { edges, nearestWithinRadius } from "./baseGeometry";
import type { BaseBlock, PlacedComponent } from "./types";

/**
 * Margin added around a block's footprint when testing containment. Needed
 * for two reasons: raycast-derived positions can land a hair past an exact
 * edge from float rounding, and a component snapped flush against a wall's
 * outer face sits half its own thickness beyond the block's true boundary —
 * both should still read as "belongs to this block", not unplaced.
 */
const MARGIN = 0.5;

/** 0 if (x, z) is inside the block, else how far outside its nearest edge. */
function outsideDistance(x: number, z: number, b: BaseBlock): number {
  const e = edges(b);
  const dx = Math.max(0, e.left - x, x - e.right);
  const dz = Math.max(0, e.back - z, z - e.front);
  return Math.hypot(dx, dz);
}

/**
 * Which block a component visually belongs to, inferred from its position
 * falling inside (or just past the edge of) that block's footprint — not
 * stored, so moving a component or resizing a block always keeps the
 * grouping correct with no sync step. When several blocks are close enough
 * to both qualify (e.g. an L-shape join), picks whichever is actually
 * nearer instead of just the first match.
 */
export function findBlockForComponent(
  component: PlacedComponent,
  blocks: BaseBlock[]
): BaseBlock | null {
  const [x, , z] = component.position;

  const best = nearestWithinRadius(
    0,
    blocks,
    (b) => outsideDistance(x, z, b),
    MARGIN
  );
  return best?.candidate ?? null;
}
