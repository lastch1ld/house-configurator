import { FLOOR_SLAB_THICKNESS } from "./constants";
import type { Point2D } from "./polygonGeometry";
import { polygonBoundingBox, rotatePolygon } from "./polygonGeometry";
import type { BaseBlock, BlockRotation, Floor, PlacedComponent, WallRecess, WallSide } from "./types";

const EPS = 0.05;
const SNAP_RADIUS = 0.4;

/** A floor's clearance height — the tallest wall among its blocks, so the
 * slab above it clears every block on that floor even if they differ. */
export function floorHeight(floor: Floor): number {
  return Math.max(0, ...floor.blocks.map((b) => b.wallHeight));
}

/** World-space Y of a floor's own ground level: the sum of every floor
 * below it's height plus a slab thickness. Floors are otherwise stacked
 * with no other transform — a floor's blocks keep their own x/z as-is. */
export function floorBaseY(floors: Floor[], index: number): number {
  let y = 0;
  for (let i = 0; i < index; i++) {
    y += floorHeight(floors[i]) + FLOOR_SLAB_THICKNESS;
  }
  return y;
}

export type Interval = [number, number];

export interface BlockOpenings {
  left: Interval[];
  right: Interval[];
  front: Interval[];
  back: Interval[];
}

export interface BlockEdges {
  left: number;
  right: number;
  back: number;
  front: number;
}

/**
 * A block's width/depth as they actually span world X/Z once rotation is
 * applied. A 90/270 rotation of a plain rectangular block (walls + roof
 * generated symmetrically from width/depth) is visually identical to
 * swapping the two values in place, so no 3D transform is needed anywhere
 * else — every consumer of width/depth for geometry should go through this.
 */
export function effectiveDimensions(b: BaseBlock): { width: number; depth: number } {
  return b.rotation === 90 || b.rotation === 270
    ? { width: b.depth, depth: b.width }
    : { width: b.width, depth: b.depth };
}

/** A block's axis-aligned footprint edges in world coordinates. For a
 * polygon block (`BaseBlock.polygon` set — see PLAN.md §6 Phase A), this
 * is the polygon's own bounding box after rotation, not its width/depth
 * (which are only kept in sync as a derived approximation) — computed
 * here once so every existing bounding-box-only consumer
 * (`overallFootprint`, `snapBlockPosition`, camera framing) keeps working
 * for a polygon block without needing to know one exists. */
export function edges(b: BaseBlock): BlockEdges {
  if (b.polygon) {
    const rotated = rotatePolygon(b.polygon, b.rotation);
    const box = polygonBoundingBox(rotated);
    return {
      left: b.x + box.left,
      right: b.x + box.right,
      back: b.z + box.back,
      front: b.z + box.front,
    };
  }
  const { width, depth } = effectiveDimensions(b);
  return {
    left: b.x - width / 2,
    right: b.x + width / 2,
    back: b.z - depth / 2,
    front: b.z + depth / 2,
  };
}

/** The combined world-space footprint (center + size) of every block. */
export function overallFootprint(blocks: BaseBlock[]): {
  centerX: number;
  centerZ: number;
  sizeX: number;
  sizeZ: number;
} {
  const allEdges = blocks.map(edges);
  const left = Math.min(...allEdges.map((e) => e.left));
  const right = Math.max(...allEdges.map((e) => e.right));
  const back = Math.min(...allEdges.map((e) => e.back));
  const front = Math.max(...allEdges.map((e) => e.front));
  return {
    centerX: (left + right) / 2,
    centerZ: (back + front) / 2,
    sizeX: right - left,
    sizeZ: front - back,
  };
}

/**
 * Among `candidates`, returns the one closest to `value` within `radius`,
 * or null if none qualify. Shared by the various "snap to nearest" features
 * (block edges, wall faces, block-membership) so they don't each hand-roll
 * their own best-candidate-under-threshold loop.
 */
export function nearestWithinRadius<T>(
  value: number,
  candidates: T[],
  toValue: (c: T) => number,
  radius: number
): { candidate: T; delta: number } | null {
  let best: { candidate: T; delta: number } | null = null;
  for (const c of candidates) {
    const delta = toValue(c) - value;
    if (Math.abs(delta) < radius && (!best || Math.abs(delta) < Math.abs(best.delta))) {
      best = { candidate: c, delta };
    }
  }
  return best;
}

// Local wall roles in rotational order: rotating the block by one more 90°
// step shifts which world side each local wall ends up facing by one step
// along this cycle (front -> right -> back -> left -> front), matching
// three.js's rotation.y convention (world = Rotate.y(theta) * local).
const WALL_CYCLE = ["front", "right", "back", "left"] as const;
const ROTATION_STEPS: Record<BlockRotation, number> = {
  0: 0,
  90: 1,
  180: 2,
  270: 3,
};

/** Which world side a component ends up on after its block rotates by
 * `steps` quarter-turns (same cycle `localizeOpenings` uses), so a
 * wall-anchored door/window stays glued to its physical wall panel instead
 * of jumping to whatever now faces its old world direction. */
export function rotateWallSide(side: WallSide, steps: number): WallSide {
  const idx = WALL_CYCLE.indexOf(side);
  return WALL_CYCLE[(((idx + steps) % 4) + 4) % 4];
}

/** Converts a block's own local wall identity (as a user picking "Front"
 * would mean it — always the same physical wall, regardless of rotation)
 * into the world-space `WallSide` it currently occupies, for callers like
 * `addPorch` that build on `edges()`'s world-space math. */
export function localSideToWorldSide(block: BaseBlock, localSide: WallSide): WallSide {
  return rotateWallSide(localSide, ROTATION_STEPS[block.rotation]);
}

/** The inverse of `localSideToWorldSide` — which of a block's own local
 * walls currently occupies world-space side `worldSide`. Used by
 * `fitsOnWall` (componentSnap.ts) to check a wall-anchored component's
 * placement against `BaseBlock.wallRecesses`, which are stored local-native
 * (see that field's own doc) while `WallSide`/`WallRef.side` are world-space. */
export function worldSideToLocalSide(block: BaseBlock, worldSide: WallSide): WallSide {
  return rotateWallSide(worldSide, -ROTATION_STEPS[block.rotation]);
}

// Sign to convert a world-space coordinate offset (from the block's center)
// into the matching local-axis offset, per rotation. front/back local walls
// vary along local X; left/right local walls vary along local Z.
const SIGN_X: Record<BlockRotation, 1 | -1> = { 0: 1, 90: -1, 180: -1, 270: 1 };
const SIGN_Z: Record<BlockRotation, 1 | -1> = { 0: 1, 90: 1, 180: -1, 270: -1 };

function localizeAxis(
  intervals: Interval[],
  ref: number,
  sign: 1 | -1
): Interval[] {
  return intervals.map(([a, b]): Interval => {
    const la = sign * (a - ref);
    const lb = sign * (b - ref);
    return la <= lb ? [la, lb] : [lb, la];
  });
}

/** Converts a `[min, max]` interval expressed in `fitsOnWall`'s own
 * world-space-side-relative frame (0 at `worldSide`'s own left/back
 * corner, matching `WallRef.offset`) into the local raw frame
 * `BaseBlock.wallRecesses`/`wallDepthSegments` use (centered on the
 * block, matching `wallPanels`' own `fullMin`/`fullMax`) — same
 * ref+sign transform `localizeOpenings` uses per-side, just applied to a
 * single interval on demand instead of a whole `BlockOpenings` at once. */
export function localizeWorldOffsetInterval(
  block: BaseBlock,
  worldSide: WallSide,
  min: number,
  max: number
): Interval {
  const e = edges(block);
  const isXAxis = worldSide === "front" || worldSide === "back";
  const corner = isXAxis ? e.left : e.back;
  const ref = isXAxis ? block.x : block.z;
  const localSide = worldSideToLocalSide(block, worldSide);
  const sign =
    localSide === "front" || localSide === "back"
      ? SIGN_X[block.rotation]
      : SIGN_Z[block.rotation];
  return localizeAxis([[corner + min, corner + max]], ref, sign)[0];
}

/**
 * Converts a block's world-space wall openings (keyed by world direction)
 * into block-local wall openings (keyed by local wall, i.e. pre-rotation
 * front/back/left/right), accounting for the block's own rotation — a
 * rotated block's "local front" wall may physically face world left/right.
 */
export function localizeOpenings(
  openings: BlockOpenings,
  block: BaseBlock
): BlockOpenings {
  const steps = ROTATION_STEPS[block.rotation];
  const worldSideFor = (localWallIndex: number) =>
    WALL_CYCLE[(localWallIndex + steps) % 4];
  const signX = SIGN_X[block.rotation];
  const signZ = SIGN_Z[block.rotation];

  const localize = (worldSide: (typeof WALL_CYCLE)[number], sign: 1 | -1) => {
    const isXAxis = worldSide === "front" || worldSide === "back";
    return localizeAxis(
      openings[worldSide],
      isXAxis ? block.x : block.z,
      sign
    );
  };

  return {
    front: localize(worldSideFor(0), signX),
    right: localize(worldSideFor(1), signZ),
    back: localize(worldSideFor(2), signX),
    left: localize(worldSideFor(3), signZ),
  };
}

function overlapRange(
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number
): Interval | null {
  const min = Math.max(aMin, bMin);
  const max = Math.min(aMax, bMax);
  return max - min > EPS ? [min, max] : null;
}

/** Subtracts a set of intervals from [fullMin, fullMax], returning the remaining solid segments. */
export function subtractIntervals(
  fullMin: number,
  fullMax: number,
  openings: Interval[]
): Interval[] {
  if (openings.length === 0) return [[fullMin, fullMax]];
  const sorted = [...openings].sort((a, b) => a[0] - b[0]);
  const segments: Interval[] = [];
  let cursor = fullMin;
  for (const [oMin, oMax] of sorted) {
    const clampedMin = Math.max(oMin, fullMin);
    const clampedMax = Math.min(oMax, fullMax);
    if (clampedMin > cursor + EPS) {
      segments.push([cursor, clampedMin]);
    }
    cursor = Math.max(cursor, clampedMax);
  }
  if (cursor < fullMax - EPS) {
    segments.push([cursor, fullMax]);
  }
  return segments;
}

/** Whether openings fully cover [fullMin, fullMax] (no solid wall segment remains). */
export function isFullyOpen(
  fullMin: number,
  fullMax: number,
  openings: Interval[]
): boolean {
  return subtractIntervals(fullMin, fullMax, openings).length === 0;
}

/** Snaps a block's x/z so its edges align with a neighboring block's edges when close. */
export function snapBlockPosition(
  block: BaseBlock,
  others: BaseBlock[]
): { x: number; z: number } {
  const myEdges = edges(block);

  const xTargets: number[] = [];
  const zTargets: number[] = [];
  for (const o of others) {
    const oe = edges(o);
    xTargets.push(oe.left, oe.right);
    zTargets.push(oe.back, oe.front);
  }

  let bestXDelta = 0;
  let bestXAbs = SNAP_RADIUS;
  for (const mine of [myEdges.left, myEdges.right]) {
    const best = nearestWithinRadius(mine, xTargets, (t) => t, SNAP_RADIUS);
    if (best && Math.abs(best.delta) < bestXAbs) {
      bestXAbs = Math.abs(best.delta);
      bestXDelta = best.delta;
    }
  }

  let bestZDelta = 0;
  let bestZAbs = SNAP_RADIUS;
  for (const mine of [myEdges.back, myEdges.front]) {
    const best = nearestWithinRadius(mine, zTargets, (t) => t, SNAP_RADIUS);
    if (best && Math.abs(best.delta) < bestZAbs) {
      bestZAbs = Math.abs(best.delta);
      bestZDelta = best.delta;
    }
  }

  return { x: block.x + bestXDelta, z: block.z + bestZDelta };
}

/**
 * For each block, the intervals (along the perpendicular axis, in world
 * coords) where a neighboring block sits flush against it — these spans
 * should open up as a doorway; the rest of that wall stays solid.
 * left/right openings are z-intervals, front/back openings are x-intervals.
 */
export function getBlockOpenings(
  blocks: BaseBlock[]
): Record<string, BlockOpenings> {
  const result: Record<string, BlockOpenings> = {};
  for (const b of blocks) {
    result[b.id] = { left: [], right: [], front: [], back: [] };
  }

  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];
      const ea = edges(a);
      const eb = edges(b);

      // A garage never auto-joins into whatever wall it's touching — it
      // stays a separate enclosed room entered through its own door,
      // regardless of which side of it (or the other block) happens to be
      // the one touching. Skips the opening for *both* sides of the pair,
      // not just the garage's, otherwise the other block would get a
      // doorway leading straight into a solid wall.
      const eitherIsGarage = a.isGarage || b.isGarage;

      if (Math.abs(ea.right - eb.left) < EPS) {
        const overlap = overlapRange(ea.back, ea.front, eb.back, eb.front);
        if (overlap && !eitherIsGarage) {
          result[a.id].right.push(overlap);
          result[b.id].left.push(overlap);
        }
      }
      if (Math.abs(ea.left - eb.right) < EPS) {
        const overlap = overlapRange(ea.back, ea.front, eb.back, eb.front);
        if (overlap && !eitherIsGarage) {
          result[a.id].left.push(overlap);
          result[b.id].right.push(overlap);
        }
      }
      if (Math.abs(ea.front - eb.back) < EPS) {
        const overlap = overlapRange(ea.left, ea.right, eb.left, eb.right);
        if (overlap && !eitherIsGarage) {
          result[a.id].front.push(overlap);
          result[b.id].back.push(overlap);
        }
      }
      if (Math.abs(ea.back - eb.front) < EPS) {
        const overlap = overlapRange(ea.left, ea.right, eb.left, eb.right);
        if (overlap && !eitherIsGarage) {
          result[a.id].back.push(overlap);
          result[b.id].front.push(overlap);
        }
      }
    }
  }

  return result;
}

interface WorldEdgeSegment {
  a: Point2D;
  b: Point2D;
  tag: { kind: "edge"; index: number } | { kind: "side"; side: WallSide };
}

/** A block's boundary as world-space line segments — the four flat sides
 * for a rectangle block (in `edges()`'s left/right/back/front world
 * coordinates), or one segment per polygon edge (PLAN.md §6 Phase A),
 * rotated and translated into world space. Shared basis for the general
 * "does any edge of A touch any edge of B" adjacency test Phase C needs,
 * in place of the 4 fixed edge-pairs a rectangle-only `getBlockOpenings`
 * could get away with. */
function worldEdgeSegments(b: BaseBlock): WorldEdgeSegment[] {
  if (b.polygon) {
    const rotated = rotatePolygon(b.polygon, b.rotation);
    return rotated.map((p, i) => {
      const q = rotated[(i + 1) % rotated.length];
      return {
        a: { x: b.x + p.x, z: b.z + p.z },
        b: { x: b.x + q.x, z: b.z + q.z },
        tag: { kind: "edge", index: i },
      };
    });
  }
  const e = edges(b);
  return [
    { a: { x: e.left, z: e.back }, b: { x: e.left, z: e.front }, tag: { kind: "side", side: "left" } },
    { a: { x: e.right, z: e.back }, b: { x: e.right, z: e.front }, tag: { kind: "side", side: "right" } },
    { a: { x: e.left, z: e.front }, b: { x: e.right, z: e.front }, tag: { kind: "side", side: "front" } },
    { a: { x: e.left, z: e.back }, b: { x: e.right, z: e.back }, tag: { kind: "side", side: "back" } },
  ];
}

/**
 * Where two world-space segments lie on the same line (within `eps`, on
 * both perpendicular distance and their overlap along it) and their
 * projected ranges overlap, returns the overlap as a world-space sub-segment
 * (its own two endpoints, not yet expressed in either segment's local
 * frame — see `recordPolygonAdjacencyOpening`). Otherwise null. This is the
 * general angle-agnostic version of the axis-aligned check `getBlockOpenings`
 * inlines for its 4 fixed rectangle side-pairs.
 */
function collinearOverlap(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D,
  eps: number
): { p0: Point2D; p1: Point2D } | null {
  const dirX = a2.x - a1.x;
  const dirZ = a2.z - a1.z;
  const len = Math.hypot(dirX, dirZ);
  if (len < eps) return null;
  const ux = dirX / len;
  const uz = dirZ / len;
  const nx = -uz;
  const nz = ux;

  const perp = (p: Point2D) => (p.x - a1.x) * nx + (p.z - a1.z) * nz;
  if (Math.abs(perp(b1)) > eps || Math.abs(perp(b2)) > eps) return null;

  const along = (p: Point2D) => (p.x - a1.x) * ux + (p.z - a1.z) * uz;
  const tA0 = 0;
  const tA1 = len;
  const tB0 = along(b1);
  const tB1 = along(b2);

  const lo = Math.max(tA0, Math.min(tB0, tB1));
  const hi = Math.min(tA1, Math.max(tB0, tB1));
  if (hi - lo < eps) return null;

  return {
    p0: { x: a1.x + ux * lo, z: a1.z + uz * lo },
    p1: { x: a1.x + ux * hi, z: a1.z + uz * hi },
  };
}

export interface PolygonAdjacencyOpenings {
  /** Per polygon-block id, one full-height `Interval[]` per edge index (the
   * same local `[0, edgeLength]` frame `getPolygonEdgeComponentOpenings`
   * and `buildPolygonWallGeometry`'s `edgePanels` already use), for edges
   * that touch a neighboring block. */
  polygon: Record<string, Interval[][]>;
  /** Extra world-space openings for a rectangle block's own `BlockOpenings`,
   * from a polygon neighbor touching one of its 4 flat sides — meant to be
   * concatenated onto `getBlockOpenings`'s own per-side arrays for that
   * block, not used standalone. */
  rect: Record<string, BlockOpenings>;
}

function recordPolygonAdjacencyOpening(
  result: PolygonAdjacencyOpenings,
  block: BaseBlock,
  seg: WorldEdgeSegment,
  p0: Point2D,
  p1: Point2D
): void {
  if (seg.tag.kind === "edge") {
    const t0 = Math.hypot(p0.x - seg.a.x, p0.z - seg.a.z);
    const t1 = Math.hypot(p1.x - seg.a.x, p1.z - seg.a.z);
    result.polygon[block.id][seg.tag.index].push([Math.min(t0, t1), Math.max(t0, t1)]);
  } else {
    const side = seg.tag.side;
    const coord: "x" | "z" = side === "left" || side === "right" ? "z" : "x";
    const v0 = p0[coord];
    const v1 = p1[coord];
    result.rect[block.id][side].push([Math.min(v0, v1), Math.max(v0, v1)]);
  }
}

/**
 * Block-to-block adjacency for any pair involving at least one polygon
 * block (PLAN.md §6 Phase C) — a real O(edges_A × edges_B) collinear-overlap
 * test per pair, generalizing the 4-fixed-edge-pair check `getBlockOpenings`
 * does for two rectangles (which this function leaves untouched and doesn't
 * duplicate: a rect/rect pair is skipped here). Two garages never auto-join
 * (same rule as `getBlockOpenings`, for the same reason — a garage stays a
 * separate enclosed room).
 */
export function getPolygonBlockOpenings(blocks: BaseBlock[]): PolygonAdjacencyOpenings {
  const result: PolygonAdjacencyOpenings = { polygon: {}, rect: {} };
  for (const b of blocks) {
    if (b.polygon) {
      result.polygon[b.id] = b.polygon.map(() => []);
    } else {
      result.rect[b.id] = { left: [], right: [], front: [], back: [] };
    }
  }

  const polygonBlocks = blocks.filter((b) => b.polygon);
  if (polygonBlocks.length === 0) return result;

  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];
      if (!a.polygon && !b.polygon) continue;
      if (a.isGarage || b.isGarage) continue;

      for (const sa of worldEdgeSegments(a)) {
        for (const sb of worldEdgeSegments(b)) {
          const overlap = collinearOverlap(sa.a, sa.b, sb.a, sb.b, EPS);
          if (!overlap) continue;
          recordPolygonAdjacencyOpening(result, a, sa, overlap.p0, overlap.p1);
          recordPolygonAdjacencyOpening(result, b, sb, overlap.p0, overlap.p1);
        }
      }
    }
  }

  return result;
}

const WALL_CUTOUT_TYPES = new Set(["door", "window", "opening"]);

export interface WallOpening {
  interval: Interval;
  /** Height above the floor where the opening starts (0 for a door). */
  sill: number;
  /** Height above the floor where the opening ends (solid wall resumes above, if less than wall height). */
  head: number;
}

export interface ComponentOpenings {
  left: WallOpening[];
  right: WallOpening[];
  front: WallOpening[];
  back: WallOpening[];
}

/**
 * World-space door/window cutouts, derived from placed components bound to
 * a wall (`wallRef`). Unlike block-to-block openings these aren't
 * necessarily full-height — a window leaves solid wall below and above it.
 */
export function getComponentOpenings(
  blocks: BaseBlock[],
  components: PlacedComponent[]
): Record<string, ComponentOpenings> {
  const result: Record<string, ComponentOpenings> = {};
  for (const b of blocks) {
    result[b.id] = { left: [], right: [], front: [], back: [] };
  }

  for (const c of components) {
    if (!c.wallRef || !WALL_CUTOUT_TYPES.has(c.type)) continue;
    // Polygon-edge cutouts aren't rendered yet (Phase B — see PLAN.md §6;
    // `buildPolygonWallGeometry` doesn't know how to cut an opening into
    // its own wall ring) — this `ComponentOpenings` shape is consumed only
    // by `wallPanels`, which only ever runs for a rectangle block's 4
    // named sides.
    if (c.wallRef.location.kind !== "side") continue;
    const block = blocks.find((b) => b.id === c.wallRef!.blockId);
    if (!block) continue;
    const e = edges(block);
    const { offset } = c.wallRef;
    const side = c.wallRef.location.side;
    const center = side === "front" || side === "back" ? e.left + offset : e.back + offset;
    const half = c.scale[0] / 2;
    const sill = c.position[1] - c.scale[1] / 2;
    const head = c.position[1] + c.scale[1] / 2;
    result[block.id][side].push({ interval: [center - half, center + half], sill, head });
  }

  return result;
}

/**
 * Door/window/opening cutouts for a polygon block's own edges (PLAN.md §6
 * Phase B) — one `WallOpening[]` per edge index, in that edge's own local
 * `[0, edgeLength]` frame (an edge index needs no world/local conversion
 * at all, unlike `WallSide` — see `WallLocation`'s own doc — so this is
 * simpler than `getComponentOpenings`'s rectangle-side equivalent: no
 * `edges()`/world-corner math, `WallRef.offset` is already the right
 * number to use directly).
 */
export function getPolygonEdgeComponentOpenings(
  block: BaseBlock,
  components: PlacedComponent[]
): WallOpening[][] {
  const edgeCount = block.polygon?.length ?? 0;
  const result: WallOpening[][] = Array.from({ length: edgeCount }, () => []);
  for (const c of components) {
    if (!c.wallRef || !WALL_CUTOUT_TYPES.has(c.type)) continue;
    if (c.wallRef.blockId !== block.id || c.wallRef.location.kind !== "edge") continue;
    const { index } = c.wallRef.location;
    if (index < 0 || index >= edgeCount) continue;
    const half = c.scale[0] / 2;
    const offset = c.wallRef.offset;
    const sill = c.position[1] - c.scale[1] / 2;
    const head = c.position[1] + c.scale[1] / 2;
    result[index].push({ interval: [offset - half, offset + half], sill, head });
  }
  return result;
}

/** Rotation-aware world-to-local conversion for door/window openings, mirroring localizeOpenings. */
export function localizeComponentOpenings(
  openings: ComponentOpenings,
  block: BaseBlock
): ComponentOpenings {
  const steps = ROTATION_STEPS[block.rotation];
  const worldSideFor = (localWallIndex: number) =>
    WALL_CYCLE[(localWallIndex + steps) % 4];
  const signX = SIGN_X[block.rotation];
  const signZ = SIGN_Z[block.rotation];

  const localize = (
    worldSide: (typeof WALL_CYCLE)[number],
    sign: 1 | -1
  ): WallOpening[] => {
    const isXAxis = worldSide === "front" || worldSide === "back";
    const ref = isXAxis ? block.x : block.z;
    return openings[worldSide].map((o) => ({
      interval: localizeAxis([o.interval], ref, sign)[0],
      sill: o.sill,
      head: o.head,
    }));
  };

  return {
    front: localize(worldSideFor(0), signX),
    right: localize(worldSideFor(1), signZ),
    back: localize(worldSideFor(2), signX),
    left: localize(worldSideFor(3), signZ),
  };
}

export interface WallPanel {
  hMin: number;
  hMax: number;
  vMin: number;
  vMax: number;
}

/**
 * Splits a wall's horizontal span into solid rectangular panels: first cuts
 * full-height block-to-block openings (as before), then within each
 * resulting segment, cuts door/window openings only across their own
 * sill-to-head band — leaving a lintel above a door and both an apron and
 * lintel around a window, instead of a floor-to-ceiling gap.
 */
export function wallPanels(
  fullMin: number,
  fullMax: number,
  wallHeight: number,
  blockOpenings: Interval[],
  componentOpenings: WallOpening[]
): WallPanel[] {
  const fullHeightSegments = subtractIntervals(fullMin, fullMax, blockOpenings);
  const panels: WallPanel[] = [];

  for (const [segMin, segMax] of fullHeightSegments) {
    const openingsInSegment: WallOpening[] = [];
    for (const o of componentOpenings) {
      const min = Math.max(o.interval[0], segMin);
      const max = Math.min(o.interval[1], segMax);
      if (max - min > EPS) {
        openingsInSegment.push({ interval: [min, max], sill: o.sill, head: o.head });
      }
    }

    if (openingsInSegment.length === 0) {
      panels.push({ hMin: segMin, hMax: segMax, vMin: 0, vMax: wallHeight });
      continue;
    }

    const betweenOpenings = subtractIntervals(
      segMin,
      segMax,
      openingsInSegment.map((o) => o.interval)
    );
    for (const [min, max] of betweenOpenings) {
      panels.push({ hMin: min, hMax: max, vMin: 0, vMax: wallHeight });
    }
    for (const o of openingsInSegment) {
      const [min, max] = o.interval;
      if (o.sill > EPS) {
        panels.push({ hMin: min, hMax: max, vMin: 0, vMax: o.sill });
      }
      if (o.head < wallHeight - EPS) {
        panels.push({ hMin: min, hMax: max, vMin: o.head, vMax: wallHeight });
      }
    }
  }

  return panels;
}

export interface WallDepthSegment {
  hMin: number;
  hMax: number;
  /** How far this segment is set back from the wall's normal outer plane
   * (0 = flush, matching every wall before this feature existed). */
  setback: number;
}

/**
 * Splits a wall's full local span [0, span] (see `WallRecess`'s own doc for
 * why this is span-relative, not corner-relative) into alternating
 * normal/recessed depth segments, given that wall's own notches. Recesses
 * are expected non-overlapping (the Inspector's own add/edit UI keeps them
 * that way) — an overlap here is simply resolved by processing them in
 * `from`-order, which is a reasonable "last-clamped-in wins the boundary"
 * fallback rather than a hard requirement callers must never violate.
 * Always returns at least one (flush) segment.
 */
export function wallDepthSegments(span: number, recesses: WallRecess[]): WallDepthSegment[] {
  const clamped = recesses
    .map((r) => ({
      from: Math.max(-span / 2, Math.min(r.from, r.to)),
      to: Math.min(span / 2, Math.max(r.from, r.to)),
      depth: r.depth,
    }))
    .filter((r) => r.to - r.from > EPS && r.depth > EPS)
    .sort((a, b) => a.from - b.from);

  const segments: WallDepthSegment[] = [];
  let cursor = -span / 2;
  for (const r of clamped) {
    if (r.from > cursor + EPS) segments.push({ hMin: cursor, hMax: r.from, setback: 0 });
    segments.push({ hMin: Math.max(r.from, cursor), hMax: r.to, setback: r.depth });
    cursor = Math.max(cursor, r.to);
  }
  if (cursor < span / 2 - EPS) segments.push({ hMin: cursor, hMax: span / 2, setback: 0 });
  if (segments.length === 0) segments.push({ hMin: -span / 2, hMax: span / 2, setback: 0 });
  return segments;
}

export interface WallRunSegment extends WallDepthSegment {
  panels: WallPanel[];
}

/**
 * Combines `wallDepthSegments` with `wallPanels` — one run per depth
 * segment of a wall (see `WallRecess`), each with its own door/window
 * cutouts computed only within its own `hMin`/`hMax` sub-range.
 * `fullMin`/`fullMax` must be `-span/2`/`span/2` (the same frame
 * `wallPanels` and `WallRecess.from`/`to` already use for this wall), same
 * as every existing `wallPanels(-width/2, width/2, ...)`-style call.
 */
export function wallRunSegments(
  fullMin: number,
  fullMax: number,
  wallHeight: number,
  blockOpenings: Interval[],
  componentOpenings: WallOpening[],
  recesses: WallRecess[]
): WallRunSegment[] {
  return wallDepthSegments(fullMax - fullMin, recesses).map((seg) => ({
    ...seg,
    panels: wallPanels(seg.hMin, seg.hMax, wallHeight, blockOpenings, componentOpenings),
  }));
}
