import { describe, expect, it } from "vitest";
import { polygonSignedArea } from "./polygonGeometry";
import {
  adjacentBalconySides,
  mergeAdjacentBalconyFootprint,
  railingForFreeEdge,
} from "./balconyGeometry";

describe("adjacentBalconySides", () => {
  it("pairs any front/back side with any left/right side", () => {
    expect(adjacentBalconySides("front", "right")).toEqual({ xArmSide: "right", zArmSide: "front" });
    expect(adjacentBalconySides("right", "front")).toEqual({ xArmSide: "right", zArmSide: "front" });
    expect(adjacentBalconySides("back", "left")).toEqual({ xArmSide: "left", zArmSide: "back" });
  });

  it("refuses opposite pairs (front/back or left/right)", () => {
    expect(adjacentBalconySides("front", "back")).toBeNull();
    expect(adjacentBalconySides("left", "right")).toBeNull();
  });

  it("refuses an identical pair", () => {
    expect(adjacentBalconySides("front", "front")).toBeNull();
  });
});

describe("mergeAdjacentBalconyFootprint", () => {
  it("builds the canonical (right+front) L-shape exactly as hand-derived", () => {
    const { polygon } = mergeAdjacentBalconyFootprint(6, 8, "right", 1.5, "front", 1.2);
    expect(polygon).toEqual([
      { x: 3, z: -4 },
      { x: 4.5, z: -4 },
      { x: 4.5, z: 5.2 },
      { x: -3, z: 5.2 },
      { x: -3, z: 4 },
      { x: 3, z: 4 },
    ]);
  });

  it("covers exactly the union area of the two arms, corner counted once", () => {
    const width = 6, depth = 8, xArmDepth = 1.5, zArmDepth = 1.2;
    const { polygon } = mergeAdjacentBalconyFootprint(width, depth, "right", xArmDepth, "front", zArmDepth);
    // The X-arm keeps its own full depth (not extended); the Z-arm is the
    // one extended to also cover the corner square — so the two pieces
    // are edge-adjacent (no overlap), and area is a plain sum, not an
    // inclusion-exclusion subtraction.
    const xArmArea = xArmDepth * depth;
    const zArmAreaExtended = (width + xArmDepth) * zArmDepth;
    const expectedArea = xArmArea + zArmAreaExtended;
    expect(Math.abs(polygonSignedArea(polygon))).toBeCloseTo(expectedArea);
  });

  it("mirrors correctly for the other 3 corners (left/back arm reflects right/front's x and z)", () => {
    const rightFront = mergeAdjacentBalconyFootprint(6, 8, "right", 1.5, "front", 1.2);
    const leftBack = mergeAdjacentBalconyFootprint(6, 8, "left", 1.5, "back", 1.2);
    for (let i = 0; i < rightFront.polygon.length; i++) {
      expect(leftBack.polygon[i].x).toBeCloseTo(-rightFront.polygon[i].x);
      expect(leftBack.polygon[i].z).toBeCloseTo(-rightFront.polygon[i].z);
    }
  });

  it("has exactly 4 free edges, none of them the two wall-attachment edges", () => {
    const { polygon, freeEdges } = mergeAdjacentBalconyFootprint(6, 8, "right", 1.5, "front", 1.2);
    expect(freeEdges).toHaveLength(4);
    // The attachment edges are (v4,v5) and (v5,v0) — neither should appear
    // among the free edges.
    const attachmentEdges = [
      [polygon[4], polygon[5]],
      [polygon[5], polygon[0]],
    ];
    for (const [a, b] of attachmentEdges) {
      const appears = freeEdges.some(
        ([fa, fb]) =>
          (fa.x === a.x && fa.z === a.z && fb.x === b.x && fb.z === b.z) ||
          (fa.x === b.x && fa.z === b.z && fb.x === a.x && fb.z === a.z)
      );
      expect(appears).toBe(false);
    }
  });
});

describe("railingForFreeEdge", () => {
  it("insets the rail by half its thickness from the true outer boundary, spans the edge's own length", () => {
    const { polygon } = mergeAdjacentBalconyFootprint(6, 8, "right", 1.5, "front", 1.2);
    // Free edge 0: (3,-4) -> (4.5,-4), a horizontal edge outward-facing -z.
    const rail = railingForFreeEdge(polygon, 0, 0.05);
    expect(rail.span).toBeCloseTo(1.5);
    expect(rail.rotationY).toBeCloseTo(0);
    expect(rail.x).toBeCloseTo(3.75); // midpoint of the edge
    expect(rail.z).toBeCloseTo(-4 + 0.025); // inset inward (+z) by half thickness
  });

  it("picks rotationY = pi/2 for a vertical free edge", () => {
    const { polygon } = mergeAdjacentBalconyFootprint(6, 8, "right", 1.5, "front", 1.2);
    // Free edge 1: (4.5,-4) -> (4.5,5.2), vertical, outward-facing +x.
    const rail = railingForFreeEdge(polygon, 1, 0.05);
    expect(rail.rotationY).toBeCloseTo(Math.PI / 2);
    expect(rail.x).toBeCloseTo(4.5 - 0.025); // inset inward (-x) by half thickness
  });
});
