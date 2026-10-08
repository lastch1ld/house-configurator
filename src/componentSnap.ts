import {
  edges,
  getBlockOpenings,
  localizeWorldOffsetInterval,
  nearestWithinRadius,
  wallDepthSegments,
  worldSideToLocalSide,
} from "./baseGeometry";
import type { BlockOpenings } from "./baseGeometry";
import { WALL_THICKNESS } from "./constants";
import { isGableSide } from "./gableGeometry";
import { polygonEdgeOutwardNormal, rotatePolygon } from "./polygonGeometry";
import type {
  BaseBlock,
  ComponentType,
  PlacedComponent,
  RoofType,
  WallLocation,
  WallRef,
  WallSide,
} from "./types";

const SNAP_RADIUS = 0.35;
/** Tolerance for the boundary/opening/overlap checks below — small enough
 * to not reject a legitimately flush placement due to float error, large
 * enough to actually reject a real overlap. */
const EPS = 0.01;

/** Doors/windows/openings embed into the wall opening (centerline);
 * everything else sits against whichever face (interior/exterior) it was
 * dragged onto, so a thick object never straddles and pokes through the
 * far side. */
function embedsInWall(type: ComponentType): boolean {
  return type === "door" || type === "window" || type === "opening";
}

export interface ComponentSnapResult {
  position: [number, number, number];
  /** Y-axis rotation to align the component flush with the wall it snapped to, or null if nothing snapped. */
  rotationY: number | null;
  /** Which wall/block it snapped to, or null if nothing snapped. */
  wallRef: WallRef | null;
}

interface FaceCandidate {
  axis: "x" | "z";
  value: number;
  rotationY: number;
  blockId: string;
  side: WallSide;
  /** True when this candidate is the gable triangle above `side`, not the
   * ordinary rectangular wall — see fitsOnGableCap. */
  gable?: boolean;
}

/** How far above a block's own wallHeight a click needs to be before it's
 * treated as "aiming at the gable" rather than the top of the regular
 * wall — a small margin so a click essentially at the wall/eave line
 * doesn't flicker ambiguously between the two. */
const GABLE_Y_MARGIN = 0.05;

/** True if intervals [aMin, aMax] and [bMin, bMax] overlap by more than EPS. */
function intervalsOverlap(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return aMin < bMax - EPS && bMin < aMax - EPS;
}

/** The incoming position's coordinate measured along `side`'s own wall,
 * from the block's left/back corner — same convention `alongWallPosition`
 * and `WallRef.offset` use, just read off a raw position instead of
 * derived from a stored offset. Independent of which axis a candidate on
 * that side snaps (only the *other* coordinate of `position` matters here),
 * so it's valid to compute once per block+side and reuse across every
 * candidate on that side. */
function offsetAlongSide(
  block: BaseBlock,
  side: WallSide,
  position: [number, number, number]
): number {
  const e = edges(block);
  return side === "front" || side === "back" ? position[0] - e.left : position[2] - e.back;
}

/** How far `block`'s `side` wall is stepped back from its normal outer
 * plane at world-offset `offset` (0 if that offset isn't inside any of
 * that wall's own recesses — see `BaseBlock.wallRecesses`). Lets a door/
 * window that lands inside a notch actually sit flush with the recessed
 * surface (and get a real cutout there, via `wallRunSegments` in
 * Base.tsx) instead of floating at the wall's old, un-recessed plane. */
function recessSetbackAt(block: BaseBlock, side: WallSide, offset: number): number {
  const localSide = worldSideToLocalSide(block, side);
  const recesses = block.wallRecesses?.filter((r) => r.side === localSide) ?? [];
  if (recesses.length === 0) return 0;
  const span = wallSpan(block, side);
  const [localOffset] = localizeWorldOffsetInterval(block, side, offset, offset);
  const segment = wallDepthSegments(span, recesses).find(
    (seg) => localOffset >= seg.hMin - EPS && localOffset <= seg.hMax + EPS
  );
  return segment?.setback ?? 0;
}

function wallSpan(block: BaseBlock, side: WallSide): number {
  const e = edges(block);
  return side === "front" || side === "back" ? e.right - e.left : e.front - e.back;
}

interface PolygonEdgeWorld {
  startX: number;
  startZ: number;
  dirX: number;
  dirZ: number;
  length: number;
  normalX: number;
  normalZ: number;
}

/** A polygon block's edge `index` (see `WallLocation`'s own doc), resolved
 * to world space — start point, unit direction, length, and outward unit
 * normal, all after applying the block's own rotation/translation. Unlike
 * `WallSide`, an edge index needs no separate "local vs world" conversion
 * (see `WallLocation`'s doc), so this is the only per-edge lookup
 * `componentSnap.ts`'s polygon-aware functions need. */
function polygonEdgeWorld(block: BaseBlock, index: number): PolygonEdgeWorld {
  const polygon = block.polygon!;
  const n = polygon.length;
  const rotated = rotatePolygon(polygon, block.rotation);
  const a = rotated[((index % n) + n) % n];
  const b = rotated[(((index + 1) % n) + n) % n];
  const startX = block.x + a.x;
  const startZ = block.z + a.z;
  const dx = block.x + b.x - startX;
  const dz = block.z + b.z - startZ;
  const length = Math.hypot(dx, dz) || 1;
  const localNormal = polygonEdgeOutwardNormal(polygon, index);
  const worldNormal = rotatePolygon([localNormal], block.rotation)[0];
  return {
    startX,
    startZ,
    dirX: dx / length,
    dirZ: dz / length,
    length,
    normalX: worldNormal.x,
    normalZ: worldNormal.z,
  };
}

/** Same idea as `wallSpan`/`offsetAlongSide` but for either kind of
 * `WallLocation` — the single dispatch point every exported function below
 * goes through so a caller never has to branch on `location.kind` itself. */
function locationSpan(block: BaseBlock, location: WallLocation): number {
  return location.kind === "edge"
    ? polygonEdgeWorld(block, location.index).length
    : wallSpan(block, location.side);
}

function offsetAlongLocation(
  block: BaseBlock,
  location: WallLocation,
  position: [number, number, number]
): number {
  if (location.kind === "side") return offsetAlongSide(block, location.side, position);
  const edge = polygonEdgeWorld(block, location.index);
  return (position[0] - edge.startX) * edge.dirX + (position[2] - edge.startZ) * edge.dirZ;
}

/**
 * Whether a component of `width` centered at `offset` along a polygon
 * block's edge `index` fits there — the polygon-edge counterpart of
 * `fitsOnWall`, minus the pieces that don't apply yet (Phase B — see
 * PLAN.md §6): no block-to-block opening check (auto-doorways between
 * polygon edges are Phase C), no recess check (`wallRecesses` aren't
 * supported on a polygon block). Just the span bound and sibling-overlap
 * checks.
 */
function fitsOnEdge(
  block: BaseBlock,
  index: number,
  offset: number,
  width: number,
  others: PlacedComponent[]
): boolean {
  const half = width / 2;
  const min = offset - half;
  const max = offset + half;
  const span = polygonEdgeWorld(block, index).length;
  if (min < -EPS || max > span + EPS) return false;

  for (const other of others) {
    if (other.wallRef?.blockId !== block.id) continue;
    if (other.wallRef.location.kind !== "edge" || other.wallRef.location.index !== index) {
      continue;
    }
    const otherHalf = other.scale[0] / 2;
    const otherOffset = other.wallRef.offset;
    if (intervalsOverlap(min, max, otherOffset - otherHalf, otherOffset + otherHalf)) {
      return false;
    }
  }
  return true;
}

/**
 * Whether a placement spanning world-offset `[min, max]` on `block`'s
 * `side` straddles the boundary of one of that wall's own recesses (see
 * `BaseBlock.wallRecesses`) — a door/window can sit entirely within the
 * normal-depth run or entirely within the recessed run, but not span both,
 * same category of check `fitsOnWall` already does for block-to-block/
 * sibling-component overlaps.
 */
function crossesRecessBoundary(block: BaseBlock, side: WallSide, min: number, max: number): boolean {
  const localSide = worldSideToLocalSide(block, side);
  const recesses = block.wallRecesses?.filter((r) => r.side === localSide) ?? [];
  if (recesses.length === 0) return false;

  const span = wallSpan(block, side);
  const [localMin, localMax] = localizeWorldOffsetInterval(block, side, min, max);
  const segments = wallDepthSegments(span, recesses);
  return !segments.some(
    (seg) => localMin >= seg.hMin - EPS && localMax <= seg.hMax + EPS
  );
}

/**
 * Whether a component of `width` centered at `offset` along `block`'s
 * `side` is actually placeable there: fully within that wall's own span
 * (doesn't stick out past its corners), not overlapping a span where an
 * adjoining block has opened a passage through that wall (so a door/window
 * can't snap into what's actually an open archway between two joined
 * blocks), not overlapping any `others` already anchored to that same
 * wall (so two components can't land on top of each other), and not
 * straddling one of that wall's own recess boundaries (see
 * `crossesRecessBoundary`).
 */
function fitsOnWall(
  block: BaseBlock,
  side: WallSide,
  offset: number,
  width: number,
  openings: Record<string, BlockOpenings>,
  others: PlacedComponent[]
): boolean {
  const half = width / 2;
  const min = offset - half;
  const max = offset + half;

  const span = wallSpan(block, side);
  if (min < -EPS || max > span + EPS) return false;
  if (crossesRecessBoundary(block, side, min, max)) return false;

  const sideOpenings = openings[block.id]?.[side] ?? [];
  for (const [oMin, oMax] of sideOpenings) {
    if (intervalsOverlap(min, max, oMin, oMax)) return false;
  }

  for (const other of others) {
    if (other.wallRef?.blockId !== block.id) continue;
    if (other.wallRef.location.kind !== "side" || other.wallRef.location.side !== side) continue;
    const otherHalf = other.scale[0] / 2;
    const otherOffset = other.wallRef.offset;
    if (intervalsOverlap(min, max, otherOffset - otherHalf, otherOffset + otherHalf)) {
      return false;
    }
  }

  return true;
}

/**
 * Whether a component roughly `width` wide, centered at `offset` (the same
 * corner-based convention as `fitsOnWall`), and vertically aimed at height
 * `v` above the eave, is a plausible gable-cap candidate: `v` still leaves
 * room for *some* component before hitting the ridge, there's no
 * block-to-block opening spanning the whole wall beneath (which would mean
 * there's no gable cap there to place anything on at all — see
 * getBlockOpenings), and the click point doesn't land inside another
 * gable-anchored component already there. This is deliberately loose (only
 * a validity/existence check at the raw click point) — snapComponentToWalls
 * doesn't yet know the component's real final width/height when choosing a
 * candidate, so the precise fit (does the *actual* rectangle fit the taper,
 * and does it truly not overlap a sibling) is finished by
 * `clampComponentToGable` once the caller knows those.
 */
function fitsOnGableCap(
  block: BaseBlock,
  side: WallSide,
  offset: number,
  v: number,
  openings: Record<string, BlockOpenings>,
  others: PlacedComponent[]
): boolean {
  if (v <= EPS || v >= block.roofHeight - EPS) return false;
  const sideOpenings = openings[block.id]?.[side] ?? [];
  for (const [oMin, oMax] of sideOpenings) {
    if (intervalsOverlap(offset - EPS, offset + EPS, oMin, oMax)) return false;
  }
  for (const other of others) {
    if (
      other.wallRef?.blockId !== block.id ||
      other.wallRef.location.kind !== "side" ||
      other.wallRef.location.side !== side ||
      !other.wallRef.gable
    ) {
      continue;
    }
    const otherHalf = other.scale[0] / 2;
    const otherHalfHeight = other.scale[1] / 2;
    const otherCenterV = other.position[1] - block.wallHeight;
    const horizontallyInside =
      offset > other.wallRef.offset - otherHalf - EPS &&
      offset < other.wallRef.offset + otherHalf + EPS;
    const verticallyInside =
      v > otherCenterV - otherHalfHeight - EPS && v < otherCenterV + otherHalfHeight + EPS;
    if (horizontallyInside && verticallyInside) return false;
  }
  return true;
}

/**
 * Snaps a component's X/Z position flush against the nearest wall *face* (of
 * any block) when within range. Each wall has two faces — offering both and
 * picking whichever is closer to the component's current position means it
 * snaps flush to whichever side (interior/exterior) it was already on,
 * instead of collapsing to the wall's centerline (which made anything
 * thicker than the wall straddle it and visually poke out the far side).
 *
 * A candidate is only offered if the component would actually fit there:
 * within the wall's own span, not over a passage opened by an adjoining
 * block (see `getBlockOpenings`), and not overlapping another component
 * already anchored to that same wall — otherwise the *nearest* wall face
 * could be one that's structurally not really there, or already occupied,
 * and the component would snap into/onto it anyway.
 */
export function snapComponentToWalls(
  position: [number, number, number],
  blocks: BaseBlock[],
  type: ComponentType,
  /** This component's own along-wall width (`scale[0]`) — needed to check
   * it actually fits at a candidate spot. Pass 0 to skip the fit checks
   * (e.g. a caller that doesn't yet know its own width) and fall back to
   * the old face-only behavior. */
  width = 0,
  /** Other same-floor components to avoid overlapping — should already
   * exclude the component being moved/added itself. */
  others: PlacedComponent[] = [],
  /** The building's default roof type — each block may override this
   * individually (see BaseBlock.roofType), so this is only the fallback
   * used for blocks that don't. A click well above a wall's own wallHeight
   * only offers a gable-triangle candidate there instead of the ordinary
   * rectangular wall when the block's *effective* roofType is "gable" and
   * this is its top floor (see isGableSide/fitsOnGableCap). Defaults
   * preserve old behavior exactly for callers that don't care about gable
   * placement. */
  roofType: RoofType = "flat",
  isTopFloor = false
): ComponentSnapResult {
  interface Resolved {
    dist: number;
    position: [number, number, number];
    rotationY: number;
    wallRef: WallRef;
  }
  let best: Resolved | null = null;
  const embed = embedsInWall(type);
  const openings = getBlockOpenings(blocks);

  for (const b of blocks) {
    if (b.polygon) continue; // handled in the separate polygon-edge pass below
    const t = WALL_THICKNESS;
    const e = edges(b);
    const ridgeAxis = b.ridgeAxis ?? "x";
    const blockRoofType = b.roofType ?? roofType;
    const sides: WallSide[] = ["left", "right", "front", "back"];
    // A click well above this block's own wallHeight, on a gable-roofed top
    // floor, is aiming at the gable triangle rather than the wall below it.
    const aimingAtGable =
      embed &&
      blockRoofType === "gable" &&
      isTopFloor &&
      position[1] > b.wallHeight + GABLE_Y_MARGIN;
    const fits = Object.fromEntries(
      sides.map((side) => {
        const offset = offsetAlongSide(b, side, position);
        if (width <= 0) return [side, true];
        if (aimingAtGable && isGableSide(side, ridgeAxis)) {
          return [
            side,
            fitsOnGableCap(b, side, offset, position[1] - b.wallHeight, openings, others),
          ];
        }
        return [side, fitsOnWall(b, side, offset, width, openings, others)];
      })
    ) as Record<WallSide, boolean>;
    const gableSide = (side: WallSide) => aimingAtGable && isGableSide(side, ridgeAxis);
    // The recess setback at the *current click's* own offset on each side —
    // same "only check the point under the cursor" approximation `fits`
    // above already makes. A gable-tagged side ignores it: the gable
    // triangle above the wall is unaffected by a recess in the rectangular
    // wall below it (see `alongWallPosition`'s own `gable` param).
    const setbackAt = (side: WallSide) =>
      gableSide(side) ? 0 : recessSetbackAt(b, side, offsetAlongSide(b, side, position));

    const candidates: FaceCandidate[] = embed
      ? [
          // Embedded (door/window): one candidate per wall, at its centerline.
          // Coplanar with (and using the exact same x/z formula as) the
          // ordinary rectangular wall below it — only whether it's tagged
          // `gable` (and so validated/clamped against the taper instead of
          // the wall's own rectangular span) differs.
          { axis: "x", value: e.left + setbackAt("left") + t / 2, rotationY: Math.PI / 2, blockId: b.id, side: "left", gable: gableSide("left") },
          { axis: "x", value: e.right - setbackAt("right") - t / 2, rotationY: Math.PI / 2, blockId: b.id, side: "right", gable: gableSide("right") },
          { axis: "z", value: e.back + setbackAt("back") + t / 2, rotationY: 0, blockId: b.id, side: "back", gable: gableSide("back") },
          { axis: "z", value: e.front - setbackAt("front") - t / 2, rotationY: 0, blockId: b.id, side: "front", gable: gableSide("front") },
        ]
      : [
          // Surface-mounted: outer + inner face, whichever the object is closer to.
          { axis: "x", value: e.left + setbackAt("left"), rotationY: Math.PI / 2, blockId: b.id, side: "left" },
          { axis: "x", value: e.left + setbackAt("left") + t, rotationY: Math.PI / 2, blockId: b.id, side: "left" },
          { axis: "x", value: e.right - setbackAt("right") - t, rotationY: Math.PI / 2, blockId: b.id, side: "right" },
          { axis: "x", value: e.right - setbackAt("right"), rotationY: Math.PI / 2, blockId: b.id, side: "right" },
          { axis: "z", value: e.back + setbackAt("back"), rotationY: 0, blockId: b.id, side: "back" },
          { axis: "z", value: e.back + setbackAt("back") + t, rotationY: 0, blockId: b.id, side: "back" },
          { axis: "z", value: e.front - setbackAt("front") - t, rotationY: 0, blockId: b.id, side: "front" },
          { axis: "z", value: e.front - setbackAt("front"), rotationY: 0, blockId: b.id, side: "front" },
        ];
    const eligible = candidates.filter((c) => fits[c.side]);

    const xCandidates = eligible.filter((c) => c.axis === "x");
    const zCandidates = eligible.filter((c) => c.axis === "z");

    const resolve = (candidate: FaceCandidate): Resolved => {
      const snapped: [number, number, number] = [...position];
      if (candidate.axis === "x") snapped[0] = candidate.value;
      else snapped[2] = candidate.value;
      return {
        dist: 0, // overwritten by the caller with the actual axis delta
        position: snapped,
        rotationY: candidate.rotationY,
        wallRef: {
          blockId: candidate.blockId,
          location: { kind: "side", side: candidate.side },
          offset:
            candidate.side === "front" || candidate.side === "back"
              ? snapped[0] - e.left
              : snapped[2] - e.back,
          gable: candidate.gable || undefined,
        },
      };
    };

    const xBest = nearestWithinRadius(position[0], xCandidates, (c) => c.value, SNAP_RADIUS);
    if (xBest && (!best || Math.abs(xBest.delta) < best.dist)) {
      best = { ...resolve(xBest.candidate), dist: Math.abs(xBest.delta) };
    }
    const zBest = nearestWithinRadius(position[2], zCandidates, (c) => c.value, SNAP_RADIUS);
    if (zBest && (!best || Math.abs(zBest.delta) < best.dist)) {
      best = { ...resolve(zBest.candidate), dist: Math.abs(zBest.delta) };
    }
  }

  // Polygon-block edges (PLAN.md §6 Phase B) — no gable support (polygon
  // blocks are flat-roof-only), no per-axis decomposition (an edge can run
  // at any angle), so this is a genuinely different search: real
  // perpendicular distance from `position` to each edge's own line, offered
  // as the embedded-centerline plane or both surface-mount faces exactly
  // like the rectangle candidates above, just computed via the edge's own
  // direction/normal instead of a fixed world axis.
  for (const b of blocks) {
    if (!b.polygon) continue;
    const n = b.polygon.length;
    for (let index = 0; index < n; index++) {
      const edge = polygonEdgeWorld(b, index);
      const offset = offsetAlongLocation(b, { kind: "edge", index }, position);
      if (width > 0 && !fitsOnEdge(b, index, offset, width, others)) continue;

      const perp =
        (position[0] - edge.startX) * edge.normalX + (position[2] - edge.startZ) * edge.normalZ;
      const faceOffsets = embed ? [-WALL_THICKNESS / 2] : [0, -WALL_THICKNESS];
      for (const fo of faceOffsets) {
        const dist = Math.abs(perp - fo);
        if (dist >= SNAP_RADIUS) continue;
        if (best && dist >= best.dist) continue;
        const px = edge.startX + edge.dirX * offset + edge.normalX * fo;
        const pz = edge.startZ + edge.dirZ * offset + edge.normalZ * fo;
        best = {
          dist,
          position: [px, position[1], pz],
          rotationY: Math.atan2(edge.normalX, edge.normalZ),
          wallRef: { blockId: b.id, location: { kind: "edge", index }, offset },
        };
      }
    }
  }

  if (!best) return { position, rotationY: null, wallRef: null };
  return { position: best.position, rotationY: best.rotationY, wallRef: best.wallRef };
}

/** A wall's length — the span a "position along wall" slider should cover.
 * Accepts either a rectangle block's `WallSide` (unchanged) or a polygon
 * block's `WallLocation` (its own edge's length) — see `WallLocation`'s doc. */
export function wallLength(block: BaseBlock, location: WallSide | WallLocation): number {
  return locationSpan(block, toLocation(location));
}

/** Normalizes a bare `WallSide` (every existing rectangle-block call site)
 * into a `WallLocation`, so `wallLength`/`alongWallPosition` can accept
 * either without every caller needing its own `{kind:"side",...}` wrapper. */
function toLocation(location: WallSide | WallLocation): WallLocation {
  return typeof location === "string" ? { kind: "side", side: location } : location;
}

export function oppositeWallSide(side: WallSide): WallSide {
  switch (side) {
    case "front":
      return "back";
    case "back":
      return "front";
    case "left":
      return "right";
    case "right":
      return "left";
  }
}

/**
 * World X/Z + facing rotation for a point at `offset` along a block's wall —
 * flush with the outer face for surface-mounted types, or centered in the
 * wall's thickness for embedded types (door/window), matching whichever
 * candidate set snapComponentToWalls would have offered. Follows that
 * wall's own recess setback at `offset` (see `BaseBlock.wallRecesses`,
 * `WallSide` locations only — polygon edges don't support recesses yet) so
 * a component inside a notch sits flush with the recessed surface — unless
 * `gable` is true, since a gable triangle's own plane is unaffected by any
 * recess in the rectangular wall below it (the two are coplanar only on an
 * un-recessed wall; also always true for `gable` since polygon blocks are
 * flat-roof-only).
 */
export function alongWallPosition(
  block: BaseBlock,
  location: WallSide | WallLocation,
  offset: number,
  type: ComponentType,
  gable = false
): { x: number; z: number; rotationY: number } {
  const resolved = toLocation(location);
  const embed = embedsInWall(type);
  if (resolved.kind === "edge") {
    const edge = polygonEdgeWorld(block, resolved.index);
    const faceOffset = embed ? -WALL_THICKNESS / 2 : 0;
    const px = edge.startX + edge.dirX * offset + edge.normalX * faceOffset;
    const pz = edge.startZ + edge.dirZ * offset + edge.normalZ * faceOffset;
    return { x: px, z: pz, rotationY: Math.atan2(edge.normalX, edge.normalZ) };
  }
  const side = resolved.side;
  const e = edges(block);
  const t = WALL_THICKNESS;
  const setback = gable ? 0 : recessSetbackAt(block, side, offset);
  switch (side) {
    case "front": {
      const z = e.front - setback;
      return { x: e.left + offset, z: embed ? z - t / 2 : z, rotationY: 0 };
    }
    case "back": {
      const z = e.back + setback;
      return { x: e.left + offset, z: embed ? z + t / 2 : z, rotationY: 0 };
    }
    case "left": {
      const x = e.left + setback;
      return { x: embed ? x + t / 2 : x, z: e.back + offset, rotationY: Math.PI / 2 };
    }
    case "right": {
      const x = e.right - setback;
      return { x: embed ? x - t / 2 : x, z: e.back + offset, rotationY: Math.PI / 2 };
    }
  }
}
