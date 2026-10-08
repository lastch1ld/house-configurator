import * as THREE from "three";
import type { RidgeAxis } from "./types";

/**
 * Builds a full hip roof — 4 sloped panels (2 trapezoids over the "span"
 * eaves, 2 triangles closing the hip ends over the "perp" eaves) all
 * meeting at a shared ridge, all sharing the same pitch by construction —
 * as a single non-indexed BufferGeometry (flat-shaded per triangle, same
 * technique as `buildGableGeometry`). Always authored with the ridge
 * running along local X (spanning `span`, at local Z=0); a caller wanting
 * the ridge along Z instead should pass `span`/`perp` swapped and rotate
 * the resulting mesh 90° around Y, same convention `GableEnd` uses for
 * `ridgeAxis`.
 *
 * The ridge sits at height `roofHeight`, centered in Z, running from
 * `-ridgeHalf` to `+ridgeHalf` along X, where
 * `ridgeHalf = max(0, (span - perp) / 2)` — the standard hip-roof
 * construction that keeps every face's pitch identical (verified by hand:
 * both the trapezoids and the hip-end triangles rise `roofHeight` over the
 * same horizontal run, `perp / 2`). When `perp >= span` this clamps to a
 * symmetric pyramid instead of erroring — still valid, watertight geometry,
 * just not the "textbook" hip shape for that orientation.
 */
export function buildHipRoofGeometry(
  span: number,
  perp: number,
  roofHeight: number,
  /** Meters per texture repeat, matching the roof material's tiling scale. */
  tileSize = 2
): THREE.BufferGeometry {
  const w = span / 2;
  const d = perp / 2;
  const h = roofHeight;
  const ridgeHalf = Math.max(0, (span - perp) / 2);
  const run = perp / 2;
  const slopeLength = Math.hypot(h, run);

  const nw: [number, number, number] = [-w, 0, -d];
  const ne: [number, number, number] = [w, 0, -d];
  const se: [number, number, number] = [w, 0, d];
  const sw: [number, number, number] = [-w, 0, d];
  const r1: [number, number, number] = [-ridgeHalf, h, 0];
  const r2: [number, number, number] = [ridgeHalf, h, 0];

  // Each entry is a vertex's position plus its own UV, computed per
  // occurrence (not inferred from position) since the two shared ridge
  // points (r1/r2) need a different "along the eave" coordinate depending
  // on which panel they're currently part of. Winding on every triangle is
  // hand-verified (via the cross product of its own two edge vectors) to
  // produce an outward-and-upward-facing normal — getting this wrong would
  // silently backface-cull the whole roof from every camera angle that
  // matters (i.e. from outside/above).
  const verts: [[number, number, number], number, number][] = [
    // Back slope, over the -z eave.
    [nw, 0, 0],
    [r1, w - ridgeHalf, slopeLength],
    [r2, w + ridgeHalf, slopeLength],
    [nw, 0, 0],
    [r2, w + ridgeHalf, slopeLength],
    [ne, 2 * w, 0],
    // Front slope, over the +z eave.
    [sw, 0, 0],
    [r2, w + ridgeHalf, slopeLength],
    [r1, w - ridgeHalf, slopeLength],
    [sw, 0, 0],
    [se, 2 * w, 0],
    [r2, w + ridgeHalf, slopeLength],
    // Left hip end, over the -x eave.
    [nw, 0, 0],
    [sw, 2 * d, 0],
    [r1, d, slopeLength],
    // Right hip end, over the +x eave.
    [ne, 0, 0],
    [r2, d, slopeLength],
    [se, 2 * d, 0],
  ];

  const positions = new Float32Array(verts.length * 3);
  const uvs = new Float32Array(verts.length * 2);
  verts.forEach(([p, u, v], i) => {
    positions[i * 3] = p[0];
    positions[i * 3 + 1] = p[1];
    positions[i * 3 + 2] = p[2];
    uvs[i * 2] = u / tileSize;
    uvs[i * 2 + 1] = v / tileSize;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

export type HipFaceKind = "back" | "front" | "left" | "right";

/**
 * A hip roof's one sloped face (PLAN.md §4), as a placement descriptor for
 * a roof-mounted component (skylight/solar panel) to tilt onto — the
 * trapezoid/triangle analogue of `gableGeometry.ts`'s `RoofSlope`, minus a
 * `size` (unlike a gable/mono-pitch slope, a hip face isn't itself the
 * rendered roof surface — `buildHipRoofGeometry` already renders the real
 * mesh — so there's no rectangular box for a `size` to describe).
 */
export interface HipFace {
  kind: HipFaceKind;
  /** Position/rotation of the face's own slope-surface midpoint, same
   * convention as `RoofSlope` (composed with a block's yaw and nudged along
   * its own normal by `computeRoofComponentPlacement`, unchanged from how
   * it already handles gable/mono-pitch/flat). */
  position: [number, number, number];
  rotation: [number, number, number];
  /** Half-width of the face at the eave (v=0 in `clampComponentToHipFace`'s
   * own frame) — perpendicular to the slope direction. */
  eaveHalfWidth: number;
  /** Half-width of the face at the ridge (v=`slopeLength`) — 0 for the two
   * triangular hip-end faces (`left`/`right`); possibly still >0 for the
   * two trapezoid faces (`back`/`front`), whose top edge is the ridge
   * itself, not a point. */
  ridgeHalfWidth: number;
  /** Distance from eave to ridge along the face's own slope surface — the
   * same for all 4 faces by construction (see this file's own top-level
   * doc: every face rises `roofHeight` over the same horizontal run,
   * `perp / 2`). */
  slopeLength: number;
  /** The face's own local "toward the ridge" unit direction, in its own
   * unrotated local frame (i.e. before `rotation` — (0,0,±1) for the
   * back/front trapezoids, (±1,0,0) for the left/right triangles) — see
   * `shiftHipFaceAlongSlope`. */
  towardRidgeAxis: [number, number, number];
}

/**
 * The 4 sloped faces of a hip roof (PLAN.md §4) as placement descriptors —
 * `computeRoofComponentPlacement` (floorDuplication.ts) tilts a roof
 * component onto whichever one `slopeIndex` selects, then
 * `clampComponentToHipFace` (below) keeps it off the trapezoid's narrow
 * ridge end or the hip-end triangle's point.
 *
 * Every position/rotation here is empirically verified (a throwaway
 * three.js script this session, not just hand-derived trig — the same
 * category of "looks fine in the numbers, wrong in 3D" bug this codebase's
 * own comments warn about for exactly this kind of tilt math) against this
 * file's own `buildHipRoofGeometry` corner points (`nw`/`ne`/`se`/`sw`/
 * `r1`/`r2`): the back/front trapezoids are `gableGeometry.ts`'s
 * `gableRoofSlopes` default (ridge-along-X) case, generalized from a
 * triangle's zero-width ridge point to a possibly-nonzero one (`ridgeHalf`,
 * substituted for that function's hardcoded 0) by replacing its `depth`
 * parameter with this roof's `perp`; the left/right hip-end triangles are
 * `gableRoofSlopes`' ridge-along-Z case (including that case's own
 * hand-verified rotation-sign flip — see its comment) generalized the same
 * way. Uses this file's own "ridge along local X, caller swaps span/perp
 * and the caller then rotates 90° for ridgeAxis z" convention (see this
 * file's top-level doc) rather than hand-deriving a second internal branch
 * the way `gableRoofSlopes` does — verified to produce the exact same
 * result (`Base.tsx`'s own `HipRoof` component rotates the whole mesh 90°
 * about Y for `ridgeAxis === "z"`, so rotating each face's own
 * position/rotation by the same 90° is the identical transform, not an
 * independent derivation to get wrong a second way).
 */
export function hipRoofFaces(
  width: number,
  depth: number,
  roofHeight: number,
  ridgeAxis: RidgeAxis
): HipFace[] {
  const span = ridgeAxis === "z" ? depth : width;
  const perp = ridgeAxis === "z" ? width : depth;
  const w = span / 2;
  const d = perp / 2;
  const h = roofHeight;
  const ridgeHalf = Math.max(0, (span - perp) / 2);
  const run = perp / 2;
  const slopeLength = Math.hypot(h, run);
  const pitch = Math.atan2(h, run);

  const faces: HipFace[] = [
    {
      kind: "front",
      position: [0, h / 2, perp / 4],
      rotation: [pitch, 0, 0],
      eaveHalfWidth: w,
      ridgeHalfWidth: ridgeHalf,
      slopeLength,
      towardRidgeAxis: [0, 0, -1],
    },
    {
      kind: "back",
      position: [0, h / 2, -perp / 4],
      rotation: [-pitch, 0, 0],
      eaveHalfWidth: w,
      ridgeHalfWidth: ridgeHalf,
      slopeLength,
      towardRidgeAxis: [0, 0, 1],
    },
    {
      kind: "right",
      position: [(w + ridgeHalf) / 2, h / 2, 0],
      rotation: [0, 0, -pitch],
      eaveHalfWidth: d,
      ridgeHalfWidth: 0,
      slopeLength,
      towardRidgeAxis: [-1, 0, 0],
    },
    {
      kind: "left",
      position: [-(w + ridgeHalf) / 2, h / 2, 0],
      rotation: [0, 0, pitch],
      eaveHalfWidth: d,
      ridgeHalfWidth: 0,
      slopeLength,
      towardRidgeAxis: [1, 0, 0],
    },
  ];

  if (ridgeAxis !== "z") return faces;
  return faces.map(rotateHipFaceYawY90);
}

/** Rotates a canonical (ridge-along-X) face's position/rotation by the same
 * rigid 90° yaw `HipRoof` (Base.tsx) applies to the whole mesh for
 * `ridgeAxis === "z"` — composed the same order `computeRoofComponentPlacement`
 * already composes a block's own yaw onto a slope's tilt (yaw ∘ tilt), so
 * this is the same transform already exercised elsewhere, not a new one.
 * `towardRidgeAxis`/half-widths/`slopeLength` are unchanged: they're
 * expressed in the face's own local (unrotated) frame, which this rotation
 * doesn't touch. */
function rotateHipFaceYawY90(face: HipFace): HipFace {
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(...face.rotation));
  const pos = new THREE.Vector3(...face.position).applyQuaternion(yaw);
  const rot = new THREE.Euler().setFromQuaternion(yaw.multiply(tilt));
  return {
    ...face,
    position: [pos.x, pos.y, pos.z],
    rotation: [rot.x, rot.y, rot.z],
  };
}

/** Generalizes `gableAvailableHalfWidth` (gableGeometry.ts) to a possibly
 * nonzero-width ridge end — a hip trapezoid narrows to `ridgeHalfWidth`
 * (a real edge), not a point, unlike a gable triangle or hip-end triangle
 * (`ridgeHalfWidth` 0, the special case this reduces to). The available
 * half-width at distance `v` along the slope surface from the eave (v=0,
 * width `eaveHalfWidth`) to the ridge (v=`slopeLength`, width
 * `ridgeHalfWidth`), linearly interpolated — clamped to the [0,
 * slopeLength] domain so a caller doesn't need its own bounds check first. */
export function hipFaceAvailableHalfWidth(
  eaveHalfWidth: number,
  ridgeHalfWidth: number,
  slopeLength: number,
  v: number
): number {
  if (slopeLength <= 0) return eaveHalfWidth;
  const t = Math.max(0, Math.min(1, v / slopeLength));
  return eaveHalfWidth + (ridgeHalfWidth - eaveHalfWidth) * t;
}

/**
 * Nudges a roof component's along-slope center (`centerV`, distance from
 * the eave) and across-slope offset (`offset`, distance from the face's own
 * centerline) so its full width×height footprint actually fits inside the
 * face's trapezoid/triangle silhouette instead of hanging off the narrow
 * ridge end or poking past the hip-end triangle's point — the roof-surface
 * equivalent of `clampComponentToGable` (which solves the same "widest
 * point is always at the component's own top/near edge" problem for a
 * gable's vertical end-wall triangle instead of a tilted roof face, hence
 * the different v-domain: vertical height there, distance along the slope
 * surface here). Same clamp-not-reject philosophy: an imperfect placement
 * beats discarding the user's action.
 */
export function clampComponentToHipFace(
  eaveHalfWidth: number,
  ridgeHalfWidth: number,
  slopeLength: number,
  offset: number,
  width: number,
  centerV: number,
  height: number
): { offset: number; centerV: number } {
  const halfHeight = height / 2;
  const half = width / 2;

  // hipFaceAvailableHalfWidth(..., vTop) = eaveHalfWidth - taper*(vTop/slopeLength)
  // >= half  =>  vTop <= slopeLength * (eaveHalfWidth - half) / taper. A
  // non-positive taper (a degenerate zero-size roof) means the face's width
  // never narrows, so nothing needs clamping to a lower vTop.
  const taper = eaveHalfWidth - ridgeHalfWidth;
  const maxVTopForWidth = taper > 0 ? (slopeLength * (eaveHalfWidth - half)) / taper : slopeLength;
  const maxVTop = Math.min(slopeLength, maxVTopForWidth);
  const highestValidCenterV = Math.max(halfHeight, maxVTop - halfHeight);
  const clampedV = Math.min(Math.max(centerV, halfHeight), highestValidCenterV);

  const vTop = clampedV + halfHeight;
  const availHalf = hipFaceAvailableHalfWidth(eaveHalfWidth, ridgeHalfWidth, slopeLength, vTop);
  const clampedOffset =
    availHalf >= half ? Math.min(Math.max(offset, -availHalf + half), availHalf - half) : 0;

  return { offset: clampedOffset, centerV: clampedV };
}

/** Moves a face's placement `deltaV` along its own slope surface, toward
 * the ridge for a positive `deltaV` (see `HipFace.towardRidgeAxis`) — used
 * to apply `clampComponentToHipFace`'s clamped `centerV` (relative to the
 * slope midpoint the face's own `position` already represents). Applies
 * the face's *current* `rotation` (already including the ridgeAxis-z yaw,
 * if any) to the local axis, so this is correct however the face was
 * built — the local axis meaning doesn't change just because the frame
 * it's expressed in was itself rotated (verified alongside
 * `rotateHipFaceYawY90` in the same throwaway script). */
export function shiftHipFaceAlongSlope(
  face: HipFace,
  deltaV: number
): [number, number, number] {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...face.rotation));
  const offset = new THREE.Vector3(...face.towardRidgeAxis)
    .applyQuaternion(q)
    .multiplyScalar(deltaV);
  return [face.position[0] + offset.x, face.position[1] + offset.y, face.position[2] + offset.z];
}
