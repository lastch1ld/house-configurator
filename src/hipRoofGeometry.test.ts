import { describe, expect, it } from "vitest";
import {
  buildHipRoofGeometry,
  clampComponentToHipFace,
  hipFaceAvailableHalfWidth,
  hipRoofFaces,
  shiftHipFaceAlongSlope,
} from "./hipRoofGeometry";

/** Every triangle's face normal, read straight back off the (non-indexed,
 * one-normal-per-vertex) geometry — since there's no index buffer, each
 * triangle owns 3 private vertices and `computeVertexNormals` degenerates
 * to a plain per-triangle face normal, so this is exactly what got baked
 * into the mesh. */
function faceNormals(geo: ReturnType<typeof buildHipRoofGeometry>) {
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  const tris: { normal: [number, number, number]; centroid: [number, number, number] }[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    tris.push({
      normal: [nor.getX(i), nor.getY(i), nor.getZ(i)],
      centroid: [cx, cy, cz],
    });
  }
  return tris;
}

describe("buildHipRoofGeometry", () => {
  it("every non-degenerate triangle's normal points outward and upward", () => {
    const geo = buildHipRoofGeometry(10, 6, 2);
    const tris = faceNormals(geo);
    for (const { normal, centroid } of tris) {
      const [nx, ny, nz] = normal;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-6) continue; // degenerate (zero-area) triangle, skip
      // Every roof face must face at least somewhat upward — a downward
      // normal here means backface culling would hide it from any camera
      // looking at the building from outside/above, i.e. the roof would
      // silently render invisible.
      expect(ny).toBeGreaterThan(0);
      // And the horizontal component of the normal should point away from
      // the building's own center (0,*,0), not back into it.
      const [cx, , cz] = centroid;
      const outwardDot = nx * cx + nz * cz;
      if (Math.hypot(cx, cz) > 1e-6) {
        expect(outwardDot).toBeGreaterThan(-1e-6);
      }
    }
  });

  it("the ridge sits at roofHeight, eaves sit at y=0", () => {
    const geo = buildHipRoofGeometry(10, 6, 2);
    const pos = geo.getAttribute("position");
    let maxY = -Infinity;
    let minY = Infinity;
    for (let i = 0; i < pos.count; i++) {
      maxY = Math.max(maxY, pos.getY(i));
      minY = Math.min(minY, pos.getY(i));
    }
    expect(maxY).toBeCloseTo(2, 10);
    expect(minY).toBeCloseTo(0, 10);
  });

  it("all 4 faces share the same pitch (span > perp, a real hip roof)", () => {
    // span=10, perp=6 -> ridgeHalf=(10-6)/2=2, run=perp/2=3, roofHeight=2 ->
    // every face should slope at atan2(2,3) from horizontal, whether it's a
    // trapezoid (back/front) or a hip-end triangle (left/right) — read this
    // back from each face's own normal instead of trusting the formula.
    const geo = buildHipRoofGeometry(10, 6, 2);
    const tris = faceNormals(geo).filter(({ normal }) => Math.hypot(...normal) > 1e-6);
    const expectedPitch = Math.atan2(2, 3);
    for (const { normal } of tris) {
      const [nx, ny, nz] = normal;
      const horiz = Math.hypot(nx, nz);
      // The normal is tilted `pitch` away from straight up (0,1,0); the
      // angle between the normal and vertical equals the slope's own pitch
      // angle from horizontal (standard perpendicular-to-slope relation).
      const angleFromVertical = Math.atan2(horiz, ny);
      expect(angleFromVertical).toBeCloseTo(expectedPitch, 5);
    }
  });

  it("clamps to a symmetric pyramid (no negative ridge length) when perp >= span", () => {
    const geo = buildHipRoofGeometry(6, 10, 2);
    const pos = geo.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isFinite(pos.getX(i))).toBe(true);
      expect(Number.isFinite(pos.getY(i))).toBe(true);
      expect(Number.isFinite(pos.getZ(i))).toBe(true);
    }
    // Ridge collapses to a single point on the center line (x=0).
    let maxY = -Infinity;
    let ridgeX = NaN;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > maxY) {
        maxY = pos.getY(i);
        ridgeX = pos.getX(i);
      }
    }
    expect(ridgeX).toBeCloseTo(0, 10);
  });

  it("a square footprint (span === perp) produces a full pyramid", () => {
    const geo = buildHipRoofGeometry(8, 8, 2);
    const pos = geo.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0) {
        expect(pos.getX(i)).toBeCloseTo(0, 10);
        expect(pos.getZ(i)).toBeCloseTo(0, 10);
      }
    }
  });
});

describe("hipRoofFaces", () => {
  it("returns front/back/right/left, all sharing the same pitch and slopeLength", () => {
    const faces = hipRoofFaces(10, 6, 2, "x");
    expect(faces.map((f) => f.kind)).toEqual(["front", "back", "right", "left"]);
    const [front, back, right, left] = faces;
    for (const f of faces) {
      expect(f.slopeLength).toBeCloseTo(Math.hypot(2, 3), 10);
    }
    // Trapezoid faces (back/front) narrow to the shared ridge half-width;
    // triangle faces (left/right) narrow to a point.
    const ridgeHalf = (10 - 6) / 2;
    expect(front.eaveHalfWidth).toBeCloseTo(5, 10);
    expect(front.ridgeHalfWidth).toBeCloseTo(ridgeHalf, 10);
    expect(back.eaveHalfWidth).toBeCloseTo(5, 10);
    expect(back.ridgeHalfWidth).toBeCloseTo(ridgeHalf, 10);
    expect(right.eaveHalfWidth).toBeCloseTo(3, 10);
    expect(right.ridgeHalfWidth).toBeCloseTo(0, 10);
    expect(left.eaveHalfWidth).toBeCloseTo(3, 10);
    expect(left.ridgeHalfWidth).toBeCloseTo(0, 10);
  });

  it("every face's midpoint sits strictly between the wall top and the ridge", () => {
    const faces = hipRoofFaces(10, 6, 2, "x");
    for (const f of faces) {
      expect(f.position[1]).toBeGreaterThan(0);
      expect(f.position[1]).toBeLessThan(2);
    }
  });

  it("shifting a face by ±slopeLength/2 along its own slope lands exactly at its eave/ridge", () => {
    // Matches this file's own `buildHipRoofGeometry` corner points for the
    // same span/perp/roofHeight (empirically cross-checked against a
    // throwaway three.js script during development, not just the formula
    // re-derived a second way). `width`/`depth` are swapped between the two
    // calls so both end up with the same canonical span=10/perp=6 (see
    // `hipRoofFaces`'s own span/perp selection) — the ridgeAxis "z" case is
    // then just the "x" case's world points rotated 90° about Y, i.e.
    // (x, z) -> (z, -x), matching `HipRoof` (Base.tsx) rotating the whole
    // mesh the same way.
    const ridgeHalf = (10 - 6) / 2;
    const canonical: Record<string, { eave: [number, number, number]; ridge: [number, number, number] }> = {
      front: { eave: [0, 0, 3], ridge: [0, 2, 0] },
      back: { eave: [0, 0, -3], ridge: [0, 2, 0] },
      right: { eave: [5, 0, 0], ridge: [ridgeHalf, 2, 0] },
      left: { eave: [-5, 0, 0], ridge: [-ridgeHalf, 2, 0] },
    };
    const rotateY90 = (p: [number, number, number]): [number, number, number] => [p[2], p[1], -p[0]];

    for (const ridgeAxis of ["x", "z"] as const) {
      const faces =
        ridgeAxis === "x" ? hipRoofFaces(10, 6, 2, "x") : hipRoofFaces(6, 10, 2, "z");
      for (const f of faces) {
        const expectedEave = ridgeAxis === "x" ? canonical[f.kind].eave : rotateY90(canonical[f.kind].eave);
        const expectedRidge = ridgeAxis === "x" ? canonical[f.kind].ridge : rotateY90(canonical[f.kind].ridge);
        const eave = shiftHipFaceAlongSlope(f, -f.slopeLength / 2);
        const ridge = shiftHipFaceAlongSlope(f, f.slopeLength / 2);
        for (let i = 0; i < 3; i++) {
          expect(eave[i]).toBeCloseTo(expectedEave[i], 5);
          expect(ridge[i]).toBeCloseTo(expectedRidge[i], 5);
        }
      }
    }
  });
});

describe("hipFaceAvailableHalfWidth", () => {
  it("interpolates linearly from the eave to the ridge half-width", () => {
    expect(hipFaceAvailableHalfWidth(5, 2, 4, 0)).toBeCloseTo(5, 10);
    expect(hipFaceAvailableHalfWidth(5, 2, 4, 4)).toBeCloseTo(2, 10);
    expect(hipFaceAvailableHalfWidth(5, 2, 4, 2)).toBeCloseTo(3.5, 10);
  });

  it("clamps v outside [0, slopeLength]", () => {
    expect(hipFaceAvailableHalfWidth(5, 2, 4, -1)).toBeCloseTo(5, 10);
    expect(hipFaceAvailableHalfWidth(5, 2, 4, 10)).toBeCloseTo(2, 10);
  });
});

describe("clampComponentToHipFace", () => {
  it("leaves a component that already fits centered and untouched", () => {
    // eave half-width 5, ridge half-width 2, slopeLength 4 — a 1-wide,
    // 1-long component centered at the midpoint easily fits throughout.
    const { offset, centerV } = clampComponentToHipFace(5, 2, 4, 0, 1, 2, 1);
    expect(offset).toBeCloseTo(0, 10);
    expect(centerV).toBeCloseTo(2, 10);
  });

  it("pulls a component down toward the eave when it wouldn't fit at the ridge", () => {
    // Triangle face (ridgeHalfWidth 0): a 2-wide component can't fit at all
    // near the point, so it must be pulled down toward the wider eave end.
    const { centerV } = clampComponentToHipFace(3, 0, 5, 0, 2, 4.5, 1);
    expect(centerV).toBeLessThan(4.5);
    // And the resulting position must actually have room for the full
    // width at its own top edge.
    const vTop = centerV + 0.5;
    expect(hipFaceAvailableHalfWidth(3, 0, 5, vTop)).toBeGreaterThanOrEqual(1 - 1e-9);
  });

  it("falls back to centered when the component is too wide to ever fit", () => {
    const { offset, centerV } = clampComponentToHipFace(1, 0, 4, 0, 10, 2, 1);
    expect(offset).toBe(0);
    expect(centerV).toBeGreaterThanOrEqual(0.5);
  });
});
