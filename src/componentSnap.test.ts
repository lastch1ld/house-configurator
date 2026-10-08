import { describe, expect, it } from "vitest";
import { alongWallPosition, oppositeWallSide, snapComponentToWalls, wallLength } from "./componentSnap";
import type { BaseBlock } from "./types";

function block(overrides: Partial<BaseBlock> = {}): BaseBlock {
  return {
    id: "b1",
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

describe("oppositeWallSide", () => {
  it("pairs front/back and left/right", () => {
    expect(oppositeWallSide("front")).toBe("back");
    expect(oppositeWallSide("back")).toBe("front");
    expect(oppositeWallSide("left")).toBe("right");
    expect(oppositeWallSide("right")).toBe("left");
  });
});

describe("wallLength", () => {
  it("reads the block's own span for front/back vs left/right", () => {
    const b = block({ width: 4, depth: 6 });
    expect(wallLength(b, "front")).toBe(4);
    expect(wallLength(b, "left")).toBe(6);
  });
});

describe("alongWallPosition / snapComponentToWalls round-trip", () => {
  it("a door snapped to the front wall reproduces its own wallRef.offset", () => {
    const b = block();
    const e = { left: -2, front: 3 }; // width 4, depth 6, centered at 0,0
    const near = [e.left + 1, 0, e.front - 0.1] as [number, number, number];
    const result = snapComponentToWalls(near, [b], "door", 1, []);
    expect(result.wallRef).not.toBeNull();
    expect(result.wallRef!.location).toEqual({ kind: "side", side: "front" });

    const { x, z } = alongWallPosition(b, "front", result.wallRef!.offset, "door");
    expect(x).toBeCloseTo(result.position[0], 5);
    expect(z).toBeCloseTo(result.position[2], 5);
  });

  it("doesn't snap when nothing is within radius", () => {
    const b = block();
    const far: [number, number, number] = [50, 0, 50];
    const result = snapComponentToWalls(far, [b], "door", 1, []);
    expect(result.wallRef).toBeNull();
    expect(result.rotationY).toBeNull();
    expect(result.position).toEqual(far);
  });

  it("refuses to snap a component too wide for the wall span", () => {
    const b = block({ width: 4, depth: 6 }); // front wall span is 4
    const near = [b.x - 2 + 0.1, 0, 2.9] as [number, number, number];
    const result = snapComponentToWalls(near, [b], "door", 10, []);
    expect(result.wallRef).toBeNull();
  });
});

describe("alongWallPosition with a wall recess", () => {
  const b = block({
    width: 6,
    depth: 6,
    wallRecesses: [{ side: "front", from: -1, to: 1, depth: 0.5 }],
  });

  it("sits flush with the recessed plane for an offset inside the notch", () => {
    // offset=3 -> local raw x=0, inside the recessed [-1, 1] segment.
    const { z } = alongWallPosition(b, "front", 3, "door");
    expect(z).toBeCloseTo(3 - 0.5 - 0.075); // e.front - recess.depth - WALL_THICKNESS/2
  });

  it("stays at the normal plane for an offset outside the notch", () => {
    // offset=1 -> local raw x=-2, in the normal [-3, -1] segment.
    const { z } = alongWallPosition(b, "front", 1, "door");
    expect(z).toBeCloseTo(3 - 0.075); // e.front - WALL_THICKNESS/2, no setback
  });

  it("ignores the recess entirely when gable=true", () => {
    const { z } = alongWallPosition(b, "front", 3, "door", true);
    expect(z).toBeCloseTo(3 - 0.075);
  });
});

describe("snapComponentToWalls with a wall recess", () => {
  // Front wall span = width = 6, e.left=-3, e.front=3; one recess spanning
  // local raw [-1, 1] (i.e. wallDepthSegments splits it into [-3,-1], [-1,1],
  // [1,3]).
  const b = block({
    width: 6,
    depth: 6,
    wallRecesses: [{ side: "front", from: -1, to: 1, depth: 0.5 }],
  });

  it("refuses a door that would straddle the recess boundary", () => {
    // Centered at local raw x=-1 (the boundary itself), width 2 -> spans
    // local [-2, 0], which is in neither [-3,-1] nor [-1,1] alone.
    const near: [number, number, number] = [-1, 1, 2.9];
    const result = snapComponentToWalls(near, [b], "door", 2, []);
    expect(result.wallRef).toBeNull();
  });

  it("allows a door fully within the recessed segment, flush with the recessed plane", () => {
    // Centered at local raw x=0, width 1 -> spans local [-0.5, 0.5],
    // entirely inside the recessed [-1, 1] segment. The embedded candidate
    // plane there is e.front - recess.depth(0.5) - WALL_THICKNESS/2, not
    // the wall's normal e.front - WALL_THICKNESS/2.
    const near: [number, number, number] = [0, 1, 2.4];
    const result = snapComponentToWalls(near, [b], "door", 1, []);
    expect(result.wallRef).not.toBeNull();
    expect(result.wallRef!.location).toEqual({ kind: "side", side: "front" });
    expect(result.position[2]).toBeCloseTo(3 - 0.5 - 0.075);
  });

  it("allows a door fully within a normal-depth segment", () => {
    // Centered at local raw x=-2, width 1 -> spans local [-2.5, -1.5],
    // entirely inside the normal [-3, -1] segment.
    const near: [number, number, number] = [-2, 1, 2.9];
    const result = snapComponentToWalls(near, [b], "door", 1, []);
    expect(result.wallRef).not.toBeNull();
    expect(result.wallRef!.location).toEqual({ kind: "side", side: "front" });
  });
});

describe("alongWallPosition on a polygon block edge (PLAN.md §6 Phase B)", () => {
  // A 4x6 square polygon — same dimensions as the rectangle `block()`
  // fixture, so results can be sanity-checked against the equivalent
  // rectangle-side test above. Edge 0 ((-2,-3)->(2,-3)) is the "back"-like
  // wall: outward normal (0,-1), length 4.
  const b = block({
    width: 4,
    depth: 6,
    polygon: [
      { x: -2, z: -3 },
      { x: 2, z: -3 },
      { x: 2, z: 3 },
      { x: -2, z: 3 },
    ],
  });

  it("embeds a door at the edge's own centerline, offset from its start vertex", () => {
    const { x, z } = alongWallPosition(b, { kind: "edge", index: 0 }, 1, "door");
    expect(x).toBeCloseTo(-2 + 1); // start.x + offset along the edge direction
    expect(z).toBeCloseTo(-3 + 0.075); // start.z + WALL_THICKNESS/2 inward (normal is -z)
  });

  it("surface-mounts a table flush with the edge's own outer boundary", () => {
    const { x, z } = alongWallPosition(b, { kind: "edge", index: 0 }, 1, "table");
    expect(x).toBeCloseTo(-1);
    expect(z).toBeCloseTo(-3); // flush with the polygon boundary itself, no inset
  });

  it("matches wallLength's own edge-length reading (4, same as the rectangle back/front span)", () => {
    expect(wallLength(b, { kind: "edge", index: 0 })).toBeCloseTo(4);
    expect(wallLength(b, { kind: "edge", index: 1 })).toBeCloseTo(6);
  });
});

describe("snapComponentToWalls on a polygon block edge", () => {
  const b = block({
    width: 4,
    depth: 6,
    polygon: [
      { x: -2, z: -3 },
      { x: 2, z: -3 },
      { x: 2, z: 3 },
      { x: -2, z: 3 },
    ],
  });

  it("snaps a door to the nearest polygon edge and records an edge-kind wallRef", () => {
    const near: [number, number, number] = [0, 1, -2.9]; // just inside edge 0's outer boundary
    const result = snapComponentToWalls(near, [b], "door", 1, []);
    expect(result.wallRef).not.toBeNull();
    expect(result.wallRef!.blockId).toBe(b.id);
    expect(result.wallRef!.location).toEqual({ kind: "edge", index: 0 });
    // offset = distance along the edge from its start vertex (-2,-3).
    expect(result.wallRef!.offset).toBeCloseTo(2);
  });

  it("doesn't snap when nothing is within radius of any polygon edge", () => {
    const far: [number, number, number] = [50, 0, 50];
    const result = snapComponentToWalls(far, [b], "door", 1, []);
    expect(result.wallRef).toBeNull();
  });

  it("refuses a door too wide for the edge's own span", () => {
    const near: [number, number, number] = [0, 1, -2.9];
    const result = snapComponentToWalls(near, [b], "door", 10, []); // edge length is 4
    expect(result.wallRef).toBeNull();
  });
});

describe("snapComponentToWalls gable placement", () => {
  // width 4 (left/right span the depth=6), roofHeight 1.5, ridgeAxis
  // defaults to "x" -> left/right are the gable sides, front/back are not.
  const b = block({ width: 4, depth: 6, wallHeight: 3, roofHeight: 1.5 });

  it("offers a gable candidate on a gable side when aimed above the wall on a gable-roofed top floor", () => {
    const near: [number, number, number] = [-1.9, 3.5, 0]; // near the left wall plane, above wallHeight
    const result = snapComponentToWalls(near, [b], "window", 1, [], "gable", true);
    expect(result.wallRef).not.toBeNull();
    expect(result.wallRef!.location).toEqual({ kind: "side", side: "left" });
    expect(result.wallRef!.gable).toBe(true);
  });

  it("does not offer a gable candidate on a flat roof", () => {
    const near: [number, number, number] = [-1.9, 3.5, 0];
    const result = snapComponentToWalls(near, [b], "window", 1, [], "flat", true);
    // Still snaps to the ordinary wall (height is irrelevant there) but not as a gable.
    expect(result.wallRef).not.toBeNull();
    expect(result.wallRef!.gable).toBeUndefined();
  });

  it("does not offer a gable candidate off the top floor", () => {
    const near: [number, number, number] = [-1.9, 3.5, 0];
    const result = snapComponentToWalls(near, [b], "window", 1, [], "gable", false);
    expect(result.wallRef).not.toBeNull();
    expect(result.wallRef!.gable).toBeUndefined();
  });

  it("never offers a gable candidate on a side without a gable triangle (front/back for ridgeAxis x)", () => {
    const near: [number, number, number] = [0, 3.5, 2.9]; // near the front wall plane
    const result = snapComponentToWalls(near, [b], "window", 1, [], "gable", true);
    expect(result.wallRef).not.toBeNull();
    expect(result.wallRef!.location).toEqual({ kind: "side", side: "front" });
    expect(result.wallRef!.gable).toBeUndefined();
  });

  it("refuses a click past the ridge — nothing plausible to snap to there", () => {
    const near: [number, number, number] = [-1.9, 3 + 1.5 + 0.1, 0]; // wallHeight + roofHeight + a bit
    const result = snapComponentToWalls(near, [b], "window", 1, [], "gable", true);
    expect(result.wallRef).toBeNull();
  });

  it("a block's own roofType override wins over the building default", () => {
    const near: [number, number, number] = [-1.9, 3.5, 0];
    const gableBlock = block({ width: 4, depth: 6, wallHeight: 3, roofHeight: 1.5, roofType: "gable" });
    const flatBlock = block({ width: 4, depth: 6, wallHeight: 3, roofHeight: 1.5, roofType: "flat" });

    // Building default says "flat", but this block overrides to "gable".
    expect(
      snapComponentToWalls(near, [gableBlock], "window", 1, [], "flat", true).wallRef?.gable
    ).toBe(true);

    // Building default says "gable", but this block overrides to "flat".
    expect(
      snapComponentToWalls(near, [flatBlock], "window", 1, [], "gable", true).wallRef?.gable
    ).toBeUndefined();
  });
});
