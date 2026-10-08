import { describe, expect, it } from "vitest";
import {
  edges,
  effectiveDimensions,
  getBlockOpenings,
  getPolygonBlockOpenings,
  getPolygonEdgeComponentOpenings,
  isFullyOpen,
  localizeWorldOffsetInterval,
  overallFootprint,
  rotateWallSide,
  snapBlockPosition,
  subtractIntervals,
  wallDepthSegments,
  wallPanels,
  worldSideToLocalSide,
} from "./baseGeometry";
import type { BaseBlock, PlacedComponent, WallRecess } from "./types";

function block(overrides: Partial<BaseBlock> = {}): BaseBlock {
  return {
    id: overrides.id ?? "b1",
    x: 0,
    z: 0,
    width: 4,
    depth: 6,
    wallHeight: 3,
    roofHeight: 1.5,
    rotation: 0,
    ...overrides,
  };
}

describe("effectiveDimensions", () => {
  it("keeps width/depth as-is at 0/180", () => {
    expect(effectiveDimensions(block({ rotation: 0 }))).toEqual({ width: 4, depth: 6 });
    expect(effectiveDimensions(block({ rotation: 180 }))).toEqual({ width: 4, depth: 6 });
  });

  it("swaps width/depth at 90/270", () => {
    expect(effectiveDimensions(block({ rotation: 90 }))).toEqual({ width: 6, depth: 4 });
    expect(effectiveDimensions(block({ rotation: 270 }))).toEqual({ width: 6, depth: 4 });
  });
});

describe("edges", () => {
  it("computes axis-aligned edges centered on x/z", () => {
    expect(edges(block({ x: 2, z: 3, width: 4, depth: 6 }))).toEqual({
      left: 0,
      right: 4,
      back: 0,
      front: 6,
    });
  });

  it("uses the rotated (swapped) span at 90°", () => {
    expect(edges(block({ x: 0, z: 0, width: 4, depth: 6, rotation: 90 }))).toEqual({
      left: -3,
      right: 3,
      back: -2,
      front: 2,
    });
  });

  it("uses the polygon's own bounding box when set, ignoring width/depth", () => {
    const b = block({
      x: 2,
      z: 3,
      width: 999,
      depth: 999,
      rotation: 0,
      polygon: [
        { x: -1, z: -2 },
        { x: 1, z: -2 },
        { x: 1, z: 2 },
        { x: -1, z: 2 },
      ],
    });
    expect(edges(b)).toEqual({ left: 1, right: 3, back: 1, front: 5 });
  });

  it("rotates the polygon's bounding box at 90°", () => {
    const b = block({
      x: 0,
      z: 0,
      rotation: 90,
      polygon: [
        { x: -1, z: -3 },
        { x: 1, z: -3 },
        { x: 1, z: 3 },
        { x: -1, z: 3 },
      ],
    });
    // A 1x3 half-extent rectangle rotated 90° swaps to a 3x1 half-extent.
    expect(edges(b)).toEqual({ left: -3, right: 3, back: -1, front: 1 });
  });
});

describe("overallFootprint", () => {
  it("wraps a single block exactly", () => {
    const fp = overallFootprint([block({ x: 0, z: 0, width: 4, depth: 6 })]);
    expect(fp).toEqual({ centerX: 0, centerZ: 0, sizeX: 4, sizeZ: 6 });
  });

  it("spans two disjoint blocks", () => {
    const a = block({ id: "a", x: 0, z: 0, width: 4, depth: 4 });
    const b = block({ id: "b", x: 10, z: 0, width: 4, depth: 4 });
    const fp = overallFootprint([a, b]);
    // a spans [-2,2], b spans [8,12] -> combined [-2,12], size 14, center 5
    expect(fp.sizeX).toBe(14);
    expect(fp.centerX).toBe(5);
  });
});

describe("rotateWallSide", () => {
  it("is a no-op at 0 steps", () => {
    expect(rotateWallSide("front", 0)).toBe("front");
  });

  it("cycles front -> right -> back -> left -> front", () => {
    expect(rotateWallSide("front", 1)).toBe("right");
    expect(rotateWallSide("front", 2)).toBe("back");
    expect(rotateWallSide("front", 3)).toBe("left");
    expect(rotateWallSide("front", 4)).toBe("front");
  });

  it("handles negative steps by wrapping", () => {
    expect(rotateWallSide("front", -1)).toBe("left");
  });
});

describe("worldSideToLocalSide", () => {
  it("is the inverse of localSideToWorldSide's cycle for every rotation", () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const b = block({ rotation });
      for (const local of ["front", "back", "left", "right"] as const) {
        const steps = { 0: 0, 90: 1, 180: 2, 270: 3 }[rotation];
        const world = rotateWallSide(local, steps);
        expect(worldSideToLocalSide(b, world)).toBe(local);
      }
    }
  });
});

describe("localizeWorldOffsetInterval", () => {
  it("is a plain shift for an unrotated block (world offset - span/2)", () => {
    const b = block({ x: 0, z: 0, width: 6, depth: 8, rotation: 0 });
    // "front" wall span = width = 6, worldOffset 0..6 from e.left.
    expect(localizeWorldOffsetInterval(b, "front", 0, 6)).toEqual([-3, 3]);
    expect(localizeWorldOffsetInterval(b, "front", 1, 3)).toEqual([-2, 0]);
  });

  it("matches the block-local 'front' wall becoming world 'right' at rotation 90 (same case as the addPorch rotation fix)", () => {
    const b = block({ x: 0, z: 0, width: 6, depth: 8, rotation: 90 });
    // wallSpan(b, "right") = 6 (the local front wall's own width), and the
    // mapping reverses direction (rotation flips which end is which).
    expect(localizeWorldOffsetInterval(b, "right", 0, 6)).toEqual([-3, 3]);
    const [lo, hi] = localizeWorldOffsetInterval(b, "right", 1, 3);
    expect(lo).toBeCloseTo(0);
    expect(hi).toBeCloseTo(2);
  });
});

describe("wallDepthSegments", () => {
  it("returns one flush segment when there are no recesses", () => {
    expect(wallDepthSegments(6, [])).toEqual([{ hMin: -3, hMax: 3, setback: 0 }]);
  });

  it("splits into normal/recessed/normal for one centered notch", () => {
    const recesses: WallRecess[] = [{ side: "front", from: -1, to: 1, depth: 0.5 }];
    expect(wallDepthSegments(6, recesses)).toEqual([
      { hMin: -3, hMax: -1, setback: 0 },
      { hMin: -1, hMax: 1, setback: 0.5 },
      { hMin: 1, hMax: 3, setback: 0 },
    ]);
  });

  it("omits the leading/trailing normal segment when the notch touches an end", () => {
    const recesses: WallRecess[] = [{ side: "front", from: -3, to: 0, depth: 0.5 }];
    expect(wallDepthSegments(6, recesses)).toEqual([
      { hMin: -3, hMax: 0, setback: 0.5 },
      { hMin: 0, hMax: 3, setback: 0 },
    ]);
  });

  it("clamps a notch that overshoots the wall's own span", () => {
    const recesses: WallRecess[] = [{ side: "front", from: -10, to: 10, depth: 0.5 }];
    expect(wallDepthSegments(6, recesses)).toEqual([{ hMin: -3, hMax: 3, setback: 0.5 }]);
  });

  it("ignores a zero-depth or degenerate (zero-width) recess", () => {
    expect(wallDepthSegments(6, [{ side: "front", from: -1, to: 1, depth: 0 }])).toEqual([
      { hMin: -3, hMax: 3, setback: 0 },
    ]);
    expect(wallDepthSegments(6, [{ side: "front", from: 1, to: 1, depth: 0.5 }])).toEqual([
      { hMin: -3, hMax: 3, setback: 0 },
    ]);
  });
});

describe("subtractIntervals", () => {
  it("returns the full span when there are no openings", () => {
    expect(subtractIntervals(0, 10, [])).toEqual([[0, 10]]);
  });

  it("cuts a single opening out of the middle", () => {
    expect(subtractIntervals(0, 10, [[4, 6]])).toEqual([
      [0, 4],
      [6, 10],
    ]);
  });

  it("merges/clamps overlapping and out-of-range openings", () => {
    expect(subtractIntervals(0, 10, [[-2, 3], [8, 20]])).toEqual([[3, 8]]);
  });

  it("drops a segment shorter than EPS instead of emitting a sliver", () => {
    // [0, 10] minus [0, 9.98] leaves a 0.02-wide sliver, under EPS (0.05).
    expect(subtractIntervals(0, 10, [[0, 9.98]])).toEqual([]);
  });
});

describe("isFullyOpen", () => {
  it("is true when openings cover the whole span", () => {
    expect(isFullyOpen(0, 10, [[0, 10]])).toBe(true);
  });

  it("is false when any solid segment remains", () => {
    expect(isFullyOpen(0, 10, [[0, 5]])).toBe(false);
  });
});

describe("snapBlockPosition", () => {
  it("snaps flush against a neighbor within radius", () => {
    // Neighbor spans x:[4,8]. This block (width 4, so half=2) placed with
    // its left edge just inside the 0.4 snap radius of x=8 should snap
    // flush (left edge -> 8, so x -> 10).
    const neighbor = block({ id: "n", x: 6, z: 0, width: 4, depth: 4 });
    const moving = block({ id: "m", x: 10.2, z: 0, width: 4, depth: 4 });
    const { x, z } = snapBlockPosition(moving, [neighbor]);
    expect(x).toBe(10);
    expect(z).toBe(0);
  });

  it("doesn't snap when nothing is within radius", () => {
    const neighbor = block({ id: "n", x: 0, z: 0, width: 4, depth: 4 });
    const moving = block({ id: "m", x: 20, z: 0, width: 4, depth: 4 });
    const { x, z } = snapBlockPosition(moving, [neighbor]);
    expect(x).toBe(20);
    expect(z).toBe(0);
  });
});

describe("getBlockOpenings", () => {
  it("opens a doorway where two blocks sit flush", () => {
    // a spans x:[-2,2] z:[-2,2]; b spans x:[2,6] z:[-2,2] -> flush on a.right/b.left
    const a = block({ id: "a", x: 0, z: 0, width: 4, depth: 4 });
    const b = block({ id: "b", x: 4, z: 0, width: 4, depth: 4 });
    const openings = getBlockOpenings([a, b]);
    expect(openings.a.right).toEqual([[-2, 2]]);
    expect(openings.b.left).toEqual([[-2, 2]]);
    expect(openings.a.left).toEqual([]);
  });

  it("never opens a garage's shared wall", () => {
    const a = block({ id: "a", x: 0, z: 0, width: 4, depth: 4, isGarage: true });
    const b = block({ id: "b", x: 4, z: 0, width: 4, depth: 4 });
    const openings = getBlockOpenings([a, b]);
    expect(openings.a.right).toEqual([]);
    expect(openings.b.left).toEqual([]);
  });

  it("stays closed for blocks that don't touch", () => {
    const a = block({ id: "a", x: 0, z: 0, width: 4, depth: 4 });
    const b = block({ id: "b", x: 20, z: 0, width: 4, depth: 4 });
    const openings = getBlockOpenings([a, b]);
    expect(openings.a.right).toEqual([]);
    expect(openings.b.left).toEqual([]);
  });
});

// A 4x4 square footprint, CCW starting bottom-left, matching
// polygonPresets.ts's own vertex order convention: edge 0 is the back
// (min z) edge, edge 1 is the right (max x) edge, edge 2 is front (max z),
// edge 3 is left (min x).
const SQUARE_POLYGON = [
  { x: -2, z: -2 },
  { x: 2, z: -2 },
  { x: 2, z: 2 },
  { x: -2, z: 2 },
];

describe("getPolygonBlockOpenings", () => {
  it("opens a doorway on a polygon edge flush against a rectangle block", () => {
    // a (rect) spans x:[-2,2] z:[-2,2]; b (4x4 polygon) is centered at
    // x=4 so its left edge (edge 3, world x=2) sits flush against a.right.
    const a = block({ id: "a", x: 0, z: 0, width: 4, depth: 4 });
    const b = block({ id: "b", x: 4, z: 0, width: 4, depth: 4, polygon: SQUARE_POLYGON });
    const result = getPolygonBlockOpenings([a, b]);
    expect(result.rect.a.right).toEqual([[-2, 2]]);
    expect(result.polygon.b[3]).toEqual([[0, 4]]);
    expect(result.polygon.b[0]).toEqual([]);
  });

  it("opens a doorway on both blocks' edges for two adjacent polygon blocks", () => {
    const a = block({ id: "a", x: 0, z: 0, polygon: SQUARE_POLYGON });
    const b = block({ id: "b", x: 4, z: 0, polygon: SQUARE_POLYGON });
    const result = getPolygonBlockOpenings([a, b]);
    expect(result.polygon.a[1]).toEqual([[0, 4]]);
    expect(result.polygon.b[3]).toEqual([[0, 4]]);
  });

  it("skips rect/rect pairs (left to getBlockOpenings)", () => {
    const a = block({ id: "a", x: 0, z: 0, width: 4, depth: 4 });
    const b = block({ id: "b", x: 4, z: 0, width: 4, depth: 4 });
    const result = getPolygonBlockOpenings([a, b]);
    expect(result.rect.a).toEqual({ left: [], right: [], front: [], back: [] });
    expect(result.rect.b).toEqual({ left: [], right: [], front: [], back: [] });
  });

  it("never opens a garage's shared wall", () => {
    const a = block({ id: "a", x: 0, z: 0, width: 4, depth: 4, isGarage: true });
    const b = block({ id: "b", x: 4, z: 0, width: 4, depth: 4, polygon: SQUARE_POLYGON });
    const result = getPolygonBlockOpenings([a, b]);
    expect(result.rect.a.right).toEqual([]);
    expect(result.polygon.b[3]).toEqual([]);
  });

  it("stays closed for blocks that don't touch", () => {
    const a = block({ id: "a", x: 0, z: 0, width: 4, depth: 4 });
    const b = block({ id: "b", x: 20, z: 0, polygon: SQUARE_POLYGON });
    const result = getPolygonBlockOpenings([a, b]);
    expect(result.rect.a.right).toEqual([]);
    expect(result.polygon.b[3]).toEqual([]);
  });
});

function doorAtEdge(blockId: string, index: number, offset: number): PlacedComponent {
  return {
    id: `door-${index}-${offset}`,
    type: "door",
    floorIndex: 0,
    position: [0, 1.05, 0],
    rotation: [0, 0, 0],
    scale: [1, 2.1, 0.1],
    wallRef: { blockId, location: { kind: "edge", index }, offset },
  };
}

describe("getPolygonEdgeComponentOpenings", () => {
  const b = block({
    id: "p1",
    polygon: [
      { x: -2, z: -3 },
      { x: 2, z: -3 },
      { x: 2, z: 3 },
      { x: -2, z: 3 },
    ],
  });

  it("places a door's cutout on its own edge index, in that edge's own [0, edgeLength] frame", () => {
    const door = doorAtEdge("p1", 1, 2); // edge 1 has length 6 (depth)
    const openings = getPolygonEdgeComponentOpenings(b, [door]);
    expect(openings).toHaveLength(4); // one entry per polygon edge
    expect(openings[0]).toEqual([]);
    expect(openings[1]).toHaveLength(1);
    expect(openings[1][0].interval).toEqual([1.5, 2.5]); // offset 2 +/- half width 0.5
    expect(openings[1][0].sill).toBeCloseTo(0);
    expect(openings[1][0].head).toBeCloseTo(2.1);
  });

  it("ignores components on a different block or a side-kind location", () => {
    const otherBlock = doorAtEdge("other-block", 0, 1);
    const sideKind: PlacedComponent = {
      ...doorAtEdge("p1", 0, 1),
      wallRef: { blockId: "p1", location: { kind: "side", side: "front" }, offset: 1 },
    };
    const openings = getPolygonEdgeComponentOpenings(b, [otherBlock, sideKind]);
    expect(openings.every((o) => o.length === 0)).toBe(true);
  });

  it("ignores a freestanding (non-cutout) component type like a table", () => {
    const table: PlacedComponent = { ...doorAtEdge("p1", 0, 1), type: "table" };
    const openings = getPolygonEdgeComponentOpenings(b, [table]);
    expect(openings.every((o) => o.length === 0)).toBe(true);
  });
});

describe("wallPanels", () => {
  it("returns one full panel when there are no openings", () => {
    expect(wallPanels(0, 10, 3, [], [])).toEqual([{ hMin: 0, hMax: 10, vMin: 0, vMax: 3 }]);
  });

  it("leaves a lintel above a door-height opening and none below (sill 0)", () => {
    const panels = wallPanels(0, 10, 3, [], [{ interval: [4, 5], sill: 0, head: 2.1 }]);
    // Segments either side of the door, plus a lintel above it (head < wallHeight).
    expect(panels).toContainEqual({ hMin: 0, hMax: 4, vMin: 0, vMax: 3 });
    expect(panels).toContainEqual({ hMin: 5, hMax: 10, vMin: 0, vMax: 3 });
    expect(panels).toContainEqual({ hMin: 4, hMax: 5, vMin: 2.1, vMax: 3 });
    expect(panels.some((p) => p.vMin === 0 && p.hMin === 4 && p.hMax === 5)).toBe(false);
  });

  it("leaves both an apron and a lintel around a window", () => {
    const panels = wallPanels(0, 10, 3, [], [{ interval: [4, 5], sill: 0.9, head: 1.9 }]);
    expect(panels).toContainEqual({ hMin: 4, hMax: 5, vMin: 0, vMax: 0.9 });
    expect(panels).toContainEqual({ hMin: 4, hMax: 5, vMin: 1.9, vMax: 3 });
  });

  it("full-height block opening removes the segment entirely, ignoring component openings inside it", () => {
    const panels = wallPanels(0, 10, 3, [[3, 7]], [{ interval: [4, 5], sill: 0, head: 2 }]);
    expect(panels).toEqual([
      { hMin: 0, hMax: 3, vMin: 0, vMax: 3 },
      { hMin: 7, hMax: 10, vMin: 0, vMax: 3 },
    ]);
  });
});
