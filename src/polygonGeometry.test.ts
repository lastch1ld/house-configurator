import { describe, expect, it } from "vitest";
import {
  buildPolygonWallGeometry,
  insetPolygon,
  polygonBoundingBox,
  polygonEdgeOutwardNormal,
  polygonSignedArea,
  rotatePolygon,
  triangulatePolygon,
  type Point2D,
} from "./polygonGeometry";

const SQUARE: Point2D[] = [
  { x: 0, z: 0 },
  { x: 6, z: 0 },
  { x: 6, z: 6 },
  { x: 0, z: 6 },
];

// An L-shape: a 6x6 square with the top-right 3x3 quadrant removed.
// CCW winding; vertex 3 (3,3) is the single reflex (270°) corner.
const L_SHAPE: Point2D[] = [
  { x: 0, z: 0 },
  { x: 6, z: 0 },
  { x: 6, z: 3 },
  { x: 3, z: 3 },
  { x: 3, z: 6 },
  { x: 0, z: 6 },
];

describe("polygonBoundingBox", () => {
  it("computes the AABB of a simple square", () => {
    expect(polygonBoundingBox(SQUARE)).toEqual({ left: 0, right: 6, back: 0, front: 6 });
  });

  it("computes the AABB of the L-shape", () => {
    expect(polygonBoundingBox(L_SHAPE)).toEqual({ left: 0, right: 6, back: 0, front: 6 });
  });
});

describe("rotatePolygon", () => {
  it("is a no-op at 0 degrees", () => {
    expect(rotatePolygon(SQUARE, 0)).toEqual(SQUARE);
  });

  it("rotates a single point 90 degrees exactly (x,z) -> (z,-x)", () => {
    expect(rotatePolygon([{ x: 1, z: 0 }], 90)).toEqual([{ x: 0, z: -1 }]);
  });

  it("180 degrees negates both coordinates", () => {
    expect(rotatePolygon([{ x: 1, z: 2 }], 180)).toEqual([{ x: -1, z: -2 }]);
  });

  it("360 degrees worth of 90-steps returns to the original", () => {
    const once = rotatePolygon(SQUARE, 90);
    const twice = rotatePolygon(once, 90);
    const thrice = rotatePolygon(twice, 90);
    const full = rotatePolygon(thrice, 90);
    expect(full).toEqual(SQUARE);
  });
});

describe("polygonSignedArea", () => {
  it("is positive for CCW winding and matches the true area", () => {
    expect(polygonSignedArea(SQUARE)).toBeCloseTo(36);
  });

  it("is negative for the same polygon reversed (CW)", () => {
    expect(polygonSignedArea([...SQUARE].reverse())).toBeCloseTo(-36);
  });

  it("computes the L-shape's area correctly (6x6 minus 3x3)", () => {
    expect(polygonSignedArea(L_SHAPE)).toBeCloseTo(27);
  });
});

describe("polygonEdgeOutwardNormal", () => {
  it("points away from the centroid for each side of a square", () => {
    const n0 = polygonEdgeOutwardNormal(SQUARE, 0); // bottom edge
    expect(n0.x).toBeCloseTo(0);
    expect(n0.z).toBeCloseTo(-1);
    const n1 = polygonEdgeOutwardNormal(SQUARE, 1); // right edge
    expect(n1.x).toBeCloseTo(1);
    expect(n1.z).toBeCloseTo(0);
    const n2 = polygonEdgeOutwardNormal(SQUARE, 2); // top edge
    expect(n2.x).toBeCloseTo(0);
    expect(n2.z).toBeCloseTo(1);
    const n3 = polygonEdgeOutwardNormal(SQUARE, 3); // left edge
    expect(n3.x).toBeCloseTo(-1);
    expect(n3.z).toBeCloseTo(0);
  });
});

describe("insetPolygon", () => {
  it("insets a square by exactly `thickness` on every side", () => {
    const inset = insetPolygon(SQUARE, 0.5);
    expect(inset[0]).toEqual({ x: 0.5, z: 0.5 });
    expect(inset[1]).toEqual({ x: 5.5, z: 0.5 });
    expect(inset[2]).toEqual({ x: 5.5, z: 5.5 });
    expect(inset[3]).toEqual({ x: 0.5, z: 5.5 });
  });

  it("insets the L-shape's convex corners toward the interior", () => {
    const inset = insetPolygon(L_SHAPE, 0.5);
    expect(inset[0]).toEqual({ x: 0.5, z: 0.5 }); // convex corner at origin
  });

  it("insets the L-shape's one reflex corner outward along the diagonal, same magnitude as a convex corner", () => {
    const inset = insetPolygon(L_SHAPE, 0.5);
    // Vertex 3 (3,3) is the reflex corner — verified by hand: both lines
    // (z=2.5 and x=2.5) cross at (2.5, 2.5), the same sqrt(2)*thickness
    // diagonal distance a convex right-angle corner gets, just receding
    // into the solid material instead of toward the shape's exterior.
    expect(inset[3]).toEqual({ x: 2.5, z: 2.5 });
    const dist = Math.hypot(inset[3].x - 3, inset[3].z - 3);
    expect(dist).toBeCloseTo(0.5 * Math.SQRT2);
  });
});

describe("triangulatePolygon", () => {
  it("triangulates a square into 2 triangles covering the full area", () => {
    const tris = triangulatePolygon(SQUARE);
    expect(tris).toHaveLength(2 * 3);
    const area = sumTriangleAreas(SQUARE, tris);
    expect(area).toBeCloseTo(36);
  });

  it("triangulates the concave L-shape into 4 triangles covering the full area", () => {
    const tris = triangulatePolygon(L_SHAPE);
    expect(tris).toHaveLength(4 * 3);
    const area = sumTriangleAreas(L_SHAPE, tris);
    expect(area).toBeCloseTo(27);
  });

  it("uses every vertex exactly once as an ear tip across all triangles combined (no vertex dropped)", () => {
    const tris = triangulatePolygon(L_SHAPE);
    const usedIndices = new Set(tris);
    expect(usedIndices.size).toBe(L_SHAPE.length);
  });
});

describe("buildPolygonWallGeometry", () => {
  const outer = SQUARE;
  const inner = insetPolygon(SQUARE, 0.15);

  it("renders each edge as one solid quad-prism (4 faces, no end caps) with no openings", () => {
    const geometry = buildPolygonWallGeometry(outer, inner, 3);
    // 4 edges x 4 faces (outer/inner/top/bottom) x 2 triangles x 3 vertices.
    expect(geometry.attributes.position.count).toBe(4 * 4 * 2 * 3);
  });

  it("adds end-cap (reveal) faces only where a panel's own boundary doesn't land on the edge's true start/end", () => {
    // Edge 0 has one panel spanning [1, 4] of its own length-6 span — both
    // ends fall strictly inside the edge, so both need a cap; the other 3
    // edges stay unpanelled (full-edge, no caps).
    const geometry = buildPolygonWallGeometry(outer, inner, 3, [
      [{ hMin: 1, hMax: 4, vMin: 0, vMax: 3 }],
    ]);
    const perEdgeBase = 4 * 2 * 3; // 4 faces, no caps
    const withCaps = perEdgeBase + 2 * 2 * 3; // + 2 end caps
    expect(geometry.attributes.position.count).toBe(withCaps + 3 * perEdgeBase);
  });

  it("a panel spanning the edge's own full length reproduces the no-opening vertex count exactly", () => {
    const edgeLength = 6; // SQUARE's own edge length
    const geometry = buildPolygonWallGeometry(outer, inner, 3, [
      [{ hMin: 0, hMax: edgeLength, vMin: 0, vMax: 3 }],
    ]);
    expect(geometry.attributes.position.count).toBe(4 * 4 * 2 * 3);
  });
});

function sumTriangleAreas(polygon: Point2D[], tris: number[]): number {
  let total = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const a = polygon[tris[i]];
    const b = polygon[tris[i + 1]];
    const c = polygon[tris[i + 2]];
    total += Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
  }
  return total;
}
