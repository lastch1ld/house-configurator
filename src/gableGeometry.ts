import * as THREE from "three";
import type { RidgeAxis, WallSide } from "./types";

/**
 * Builds a solid triangular slab (like an extruded wall) that fills the
 * gable-end gap between the flat top of a side wall and the sloped roof
 * above it. Cross-section triangle lies in the YZ plane, extruded along X
 * by `thickness`. Local origin sits at the wall top (y=0), z centered.
 */
export function buildGableGeometry(
  depth: number,
  roofHeight: number,
  thickness: number,
  /** Meters per texture repeat, matching the wall material's tiling scale. */
  tileSize = 2,
  /** Z position of the apex (ridge point). 0 (default) gives the classic
   * centered gable triangle. ±depth/2 gives the asymmetric right-triangle
   * needed for a mono-pitch roof's high-side gable end, where the ridge
   * sits directly above one eave rather than centered between them. */
  apexZ = 0
): THREE.BufferGeometry {
  const t = thickness / 2;
  const d = depth / 2;
  const h = roofHeight;

  const A0 = [t, 0, -d];
  const B0 = [t, h, apexZ];
  const C0 = [t, 0, d];
  const A1 = [-t, 0, -d];
  const B1 = [-t, h, apexZ];
  const C1 = [-t, 0, d];

  const tris: number[][] = [
    // front cap (+x), back cap (-x)
    A0, B0, C0,
    A1, C1, B1,
    // side quads (2 triangles each)
    A0, B0, B1,
    A0, B1, A1,
    B0, C0, C1,
    B0, C1, B1,
    C0, A0, A1,
    C0, A1, C1,
  ];

  const positions = new Float32Array(tris.length * 3);
  const uvs = new Float32Array(tris.length * 2);
  tris.forEach((v, i) => {
    positions[i * 3] = v[0];
    positions[i * 3 + 1] = v[1];
    positions[i * 3 + 2] = v[2];
    // Project onto the triangle's own YZ plane, scaled to real-world tile
    // units (so it can share the wall's tiled material at repeat=(1,1)).
    uvs[i * 2] = (v[2] + d) / tileSize;
    uvs[i * 2 + 1] = v[1] / tileSize;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

/** Whether `side` is one of the two wall sides that actually have a
 * triangular gable region above them for a block with the given
 * `ridgeAxis` — the other two sides are where the roof slope itself starts
 * immediately at the wall top (no vertical gable wall at all). Only
 * meaningful for a "gable" roofType; irrelevant for "flat". */
export function isGableSide(side: WallSide, ridgeAxis: RidgeAxis): boolean {
  return ridgeAxis === "z"
    ? side === "front" || side === "back"
    : side === "left" || side === "right";
}

/** The maximum half-width of usable space at height `v` above the eave
 * (0 at the eave/wall-top, `roofHeight` at the ridge) — the gable
 * triangle narrows linearly to a point at the ridge, so a component near
 * the ridge must be narrower and closer to centered than one near the
 * eave. Returns 0 at/past the ridge (v >= roofHeight) or for a
 * degenerate (zero-height) roof. */
export function gableAvailableHalfWidth(
  span: number,
  roofHeight: number,
  v: number
): number {
  if (roofHeight <= 0) return 0;
  return Math.max(0, (span / 2) * (1 - v / roofHeight));
}

/**
 * Nudges a component's horizontal offset (the same corner-based convention
 * `WallRef.offset` uses) and vertical center (height above the eave) so its
 * full width×height rectangle actually fits inside the gable's triangular
 * silhouette — clamping rather than rejecting, since both a fresh placement
 * and an in-progress drag need *some* valid resting position, not a bounce-
 * back-to-nowhere. The tightest width constraint is always at the
 * component's own top edge (the triangle only narrows going up).
 *
 * Vertical clamping has to account for the component's own width too, not
 * just the ridge apex — a component can be too wide to fit well before its
 * top edge reaches the ridge, so pulling it down only as far as "doesn't
 * poke past the ridge" can still leave it wider than the taper allows at
 * that height (its sides poking out through the sloped roof instead). This
 * solves for the actual maximum height at which the full width fits —
 * `gableAvailableHalfWidth(span, roofHeight, vTop) >= width/2` — and clamps
 * to that instead.
 *
 * When the component is simply too wide to ever fit (even at the eave) at
 * any height that leaves room for its own full height, this falls back to
 * resting flush at the eave, centered — an imperfect placement is still
 * better than throwing away a user's action outright, matching how the rest
 * of this app prefers "clamp to nearest valid" over hard rejection wherever
 * it reasonably can.
 */
export function clampComponentToGable(
  span: number,
  roofHeight: number,
  offset: number,
  width: number,
  centerV: number,
  height: number
): { offset: number; centerV: number } {
  const halfHeight = height / 2;
  const half = width / 2;

  // gableAvailableHalfWidth(span, roofHeight, vTop) = (span/2)*(1-vTop/roofHeight)
  // >= half  =>  vTop <= roofHeight * (1 - width/span). Negative/non-finite
  // means the component is too wide to ever fit, even flush at the eave.
  const maxVTopForWidth = span > 0 ? roofHeight * (1 - width / span) : 0;
  const maxVTop = Math.min(roofHeight, maxVTopForWidth);
  // If maxVTop leaves no room for the component's own height above the
  // eave (including the fully-degenerate too-wide case, where maxVTop is
  // negative), this collapses to exactly halfHeight — resting flush at the
  // eave, the widest point available — rather than a separate branch.
  const highestValidCenterV = Math.max(halfHeight, maxVTop - halfHeight);
  const clampedV = Math.min(Math.max(centerV, halfHeight), highestValidCenterV);

  const vTop = clampedV + halfHeight;
  const availHalf = gableAvailableHalfWidth(span, roofHeight, vTop);
  const centerFromRidge = offset - span / 2;
  const clampedCenterFromRidge =
    availHalf >= half
      ? Math.min(Math.max(centerFromRidge, -availHalf + half), availHalf - half)
      : 0;

  return { offset: clampedCenterFromRidge + span / 2, centerV: clampedV };
}

export interface RoofSlope {
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number, number];
}

/** The two sloped roof panels of a gable roof. With `ridgeAxis` "x" (the
 * default) the ridge runs along width and the panels are mirrored across
 * z=0, sloping down along depth. With "z" the ridge runs along depth and
 * the panels are mirrored across x=0, sloping down along width instead. */
export function gableRoofSlopes(
  width: number,
  depth: number,
  roofHeight: number,
  ridgeAxis: "x" | "z" = "x"
): [RoofSlope, RoofSlope] {
  if (ridgeAxis === "z") {
    const slopeLength = Math.sqrt((width / 2) ** 2 + roofHeight ** 2);
    const size: [number, number, number] = [slopeLength, 0.1, depth + 0.4];
    const pitch = Math.atan2(roofHeight, width / 2);
    // Rotation.z sign here is the opposite of what it looks like it should
    // be: a positive-Z rotation on a box centered at [width/4, roofHeight/2]
    // walks its "outer" local-X end DOWN toward y=0 at x=width/4-ish and its
    // "inner" end UP past roofHeight — i.e. the ridge (should be x=0,
    // y=roofHeight) and the eave (should be x=width/2, y=0) end up swapped,
    // so the whole slope renders upside down. Negating pitch here fixes it
    // (verified by hand: the positive-local-X end then lands at
    // (width/2, 0) — the eave — and the negative end at (0, roofHeight) —
    // the ridge).
    return [
      { position: [width / 4, roofHeight / 2, 0], rotation: [0, 0, -pitch], size },
      { position: [-width / 4, roofHeight / 2, 0], rotation: [0, 0, pitch], size },
    ];
  }
  const slopeLength = Math.sqrt((depth / 2) ** 2 + roofHeight ** 2);
  const size: [number, number, number] = [width + 0.4, 0.1, slopeLength];
  const pitch = Math.atan2(roofHeight, depth / 2);
  return [
    { position: [0, roofHeight / 2, depth / 4], rotation: [pitch, 0, 0], size },
    { position: [0, roofHeight / 2, -depth / 4], rotation: [-pitch, 0, 0], size },
  ];
}

/** The single sloped panel of a mono-pitch (shed) roof — rises the full
 * `roofHeight` across the full width/depth (whichever `ridgeAxis` picks as
 * the slope direction) instead of a gable's two half-span panels. High side
 * sits at +depth/2 (or +width/2 for ridgeAxis "z"); low side at the
 * opposite eave, matching `buildGableGeometry`'s `apexZ` convention so the
 * gable-end infill triangle and the slope panel meet flush. */
export function monoPitchSlope(
  width: number,
  depth: number,
  roofHeight: number,
  ridgeAxis: "x" | "z" = "x"
): RoofSlope {
  if (ridgeAxis === "z") {
    const slopeLength = Math.sqrt(width ** 2 + roofHeight ** 2);
    const size: [number, number, number] = [slopeLength, 0.1, depth + 0.4];
    const pitch = Math.atan2(roofHeight, width);
    return { position: [0, roofHeight / 2, 0], rotation: [0, 0, pitch], size };
  }
  const slopeLength = Math.sqrt(depth ** 2 + roofHeight ** 2);
  const size: [number, number, number] = [width + 0.4, 0.1, slopeLength];
  const pitch = Math.atan2(roofHeight, depth);
  return { position: [0, roofHeight / 2, 0], rotation: [-pitch, 0, 0], size };
}
