import { describe, expect, it } from "vitest";
import { FLAT_ROOF_THICKNESS } from "./constants";
import { computeRoofComponentPlacement, supportsRoofComponents } from "./floorDuplication";
import type { BaseBlock } from "./types";

function makeBlock(overrides: Partial<BaseBlock> = {}): BaseBlock {
  return {
    id: "b1",
    x: 0,
    z: 0,
    width: 6,
    depth: 8,
    wallHeight: 3,
    roofHeight: 2,
    rotation: 0,
    ...overrides,
  };
}

describe("supportsRoofComponents", () => {
  it("supports every roof type, including hip", () => {
    expect(supportsRoofComponents("gable")).toBe(true);
    expect(supportsRoofComponents("monoPitch")).toBe(true);
    expect(supportsRoofComponents("flat")).toBe(true);
    expect(supportsRoofComponents("hip")).toBe(true);
  });
});

describe("computeRoofComponentPlacement", () => {
  it("places a hip-roof component above the wall top and below the ridge, tilted to the slope, for every face", () => {
    const block = makeBlock();
    for (const slopeIndex of [0, 1, 2, 3] as const) {
      const placement = computeRoofComponentPlacement(block, "hip", slopeIndex, 0.1, [1.1, 1.1]);
      expect(placement).not.toBeNull();
      expect(placement!.position[1]).toBeGreaterThan(block.wallHeight);
      expect(placement!.position[1]).toBeLessThan(block.wallHeight + block.roofHeight);
    }
  });

  it("returns null for a hip slope index past the 4 real faces", () => {
    const block = makeBlock();
    // @ts-expect-error - exercising an out-of-range index a caller could
    // still pass at runtime (e.g. stale data from before hip support
    // existed), even though RoofSlopeIndex's own type now excludes it.
    expect(computeRoofComponentPlacement(block, "hip", 4, 0.1)).toBeNull();
  });

  it("places a flat-roof component raised above the slab, centered over the block regardless of rotation", () => {
    const raise = 0.1;
    for (const rotation of [0, 90, 180, 270] as const) {
      const block = makeBlock({ x: 2, z: -3, rotation });
      const placement = computeRoofComponentPlacement(block, "flat", 0, raise);
      expect(placement).not.toBeNull();
      // Centered over the block (the local placement is exactly the
      // block's own center) regardless of yaw — a flat panel has no tilt
      // of its own, so only its in-plane facing follows the block's yaw.
      expect(placement!.position[0]).toBeCloseTo(2);
      expect(placement!.position[1]).toBeCloseTo(block.wallHeight + FLAT_ROOF_THICKNESS + raise);
      expect(placement!.position[2]).toBeCloseTo(-3);
    }
    const unrotated = computeRoofComponentPlacement(makeBlock({ rotation: 0 }), "flat", 0, raise);
    expect(unrotated!.rotation[1]).toBeCloseTo(0);
  });

  it("places a mono-pitch component above the eave and below the ridge, tilted to the slope", () => {
    const block = makeBlock();
    const placement = computeRoofComponentPlacement(block, "monoPitch", 0, 0.1);
    expect(placement).not.toBeNull();
    expect(placement!.position[1]).toBeGreaterThan(block.wallHeight);
    expect(placement!.position[1]).toBeLessThan(block.wallHeight + block.roofHeight);
    expect(placement!.rotation[0]).not.toBe(0);
  });

  it("places a gable component on the requested slope, mirrored between slope 0 and 1", () => {
    const block = makeBlock();
    const slopeA = computeRoofComponentPlacement(block, "gable", 0, 0.1)!;
    const slopeB = computeRoofComponentPlacement(block, "gable", 1, 0.1)!;
    expect(slopeA.position[1]).toBeGreaterThan(block.wallHeight);
    expect(slopeA.position[1]).toBeLessThan(block.wallHeight + block.roofHeight);
    // The two slopes are mirror images across z=0 (ridgeAxis "x" default).
    expect(slopeA.position[2]).toBeCloseTo(-slopeB.position[2]);
    expect(slopeA.rotation[0]).toBeCloseTo(-slopeB.rotation[0]);
  });
});
