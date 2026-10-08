import { describe, expect, it } from "vitest";
import {
  buildGableGeometry,
  clampComponentToGable,
  gableAvailableHalfWidth,
  gableRoofSlopes,
  isGableSide,
  monoPitchSlope,
} from "./gableGeometry";

describe("gableRoofSlopes", () => {
  it("ridgeAxis x: both slopes meet at the ridge height, mirrored across z=0", () => {
    const [a, b] = gableRoofSlopes(6, 8, 2, "x");
    expect(a.position[1]).toBe(1); // roofHeight / 2
    expect(b.position[1]).toBe(1);
    expect(a.position[2]).toBe(2); // depth/4
    expect(b.position[2]).toBe(-2);
    expect(a.rotation[0]).toBeCloseTo(-b.rotation[0], 10);
    // Slope width matches the block's own width (plus overhang), depth doesn't matter for this axis.
    expect(a.size[0]).toBeCloseTo(6.4, 5);
  });

  it("ridgeAxis z: mirrored across x=0 instead, slope length driven by width", () => {
    const [a, b] = gableRoofSlopes(6, 8, 2, "z");
    expect(a.position[0]).toBe(1.5); // width/4
    expect(b.position[0]).toBe(-1.5);
    expect(a.size[2]).toBeCloseTo(8.4, 5);
  });

  it("slope length is the hypotenuse of half-span and roofHeight", () => {
    const [a] = gableRoofSlopes(6, 8, 2, "x");
    // depth/2=4, roofHeight=2 -> hypot(4,2)
    expect(a.size[2]).toBeCloseTo(Math.hypot(4, 2), 10);
  });

  it("a taller roof (larger roofHeight) produces a steeper pitch", () => {
    const [low] = gableRoofSlopes(6, 8, 1, "x");
    const [steep] = gableRoofSlopes(6, 8, 3, "x");
    expect(Math.abs(steep.rotation[0])).toBeGreaterThan(Math.abs(low.rotation[0]));
  });
});

describe("monoPitchSlope", () => {
  it("ridgeAxis x: rises the full depth (not half), high side at +depth/2", () => {
    const slope = monoPitchSlope(6, 8, 2, "x");
    // Local point (0,0,+L/2) should land at world (0, roofHeight/2, depth/2)
    // relative to the panel's own position — verified via the panel's own
    // pitch/position math rather than re-deriving forward-kinematics here:
    // slope length is the full-depth hypotenuse, not the half-depth one.
    expect(slope.size[2]).toBeCloseTo(Math.hypot(8, 2), 10);
    expect(slope.position).toEqual([0, 1, 0]);
    // Steeper than a gable of the same width/depth/roofHeight, since the
    // same rise happens over twice the run for a gable's single panel...
    // actually half the run compared to mono-pitch's full span, so the
    // mono-pitch pitch angle here should be *shallower* than a gable panel
    // covering only half the depth for the same roofHeight.
    const [gableSlope] = gableRoofSlopes(6, 8, 2, "x");
    expect(Math.abs(slope.rotation[0])).toBeLessThan(Math.abs(gableSlope.rotation[0]));
  });

  it("ridgeAxis z: rises the full width, high side at +width/2", () => {
    const slope = monoPitchSlope(6, 8, 2, "z");
    expect(slope.size[0]).toBeCloseTo(Math.hypot(6, 2), 10);
    expect(slope.position).toEqual([0, 1, 0]);
  });

  it("a taller roof produces a steeper pitch", () => {
    const low = monoPitchSlope(6, 8, 1, "x");
    const steep = monoPitchSlope(6, 8, 3, "x");
    expect(Math.abs(steep.rotation[0])).toBeGreaterThan(Math.abs(low.rotation[0]));
  });
});

describe("buildGableGeometry apexZ", () => {
  it("defaults to a centered apex (z=0), matching pre-existing gable behavior", () => {
    const geo = buildGableGeometry(6, 2, 0.2, 2);
    const pos = geo.getAttribute("position");
    // Find the max-height vertex (the apex) and confirm its z is 0.
    let apexZ = NaN;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > maxY) {
        maxY = y;
        apexZ = pos.getZ(i);
      }
    }
    expect(maxY).toBeCloseTo(2, 10);
    expect(apexZ).toBeCloseTo(0, 10);
  });

  it("an explicit apexZ shifts the ridge point to that Z, forming an asymmetric right triangle", () => {
    const geo = buildGableGeometry(6, 2, 0.2, 2, 3); // depth/2 = 3
    const pos = geo.getAttribute("position");
    let apexZ = NaN;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > maxY) {
        maxY = y;
        apexZ = pos.getZ(i);
      }
    }
    expect(maxY).toBeCloseTo(2, 10);
    expect(apexZ).toBeCloseTo(3, 10);
  });
});

describe("isGableSide", () => {
  it("ridgeAxis x: only left/right have a gable triangle above them", () => {
    expect(isGableSide("left", "x")).toBe(true);
    expect(isGableSide("right", "x")).toBe(true);
    expect(isGableSide("front", "x")).toBe(false);
    expect(isGableSide("back", "x")).toBe(false);
  });

  it("ridgeAxis z: only front/back have a gable triangle above them", () => {
    expect(isGableSide("front", "z")).toBe(true);
    expect(isGableSide("back", "z")).toBe(true);
    expect(isGableSide("left", "z")).toBe(false);
    expect(isGableSide("right", "z")).toBe(false);
  });
});

describe("gableAvailableHalfWidth", () => {
  it("is the full half-span at the eave (v=0)", () => {
    expect(gableAvailableHalfWidth(8, 2, 0)).toBe(4);
  });

  it("is 0 at the ridge (v=roofHeight)", () => {
    expect(gableAvailableHalfWidth(8, 2, 2)).toBe(0);
  });

  it("narrows linearly between eave and ridge", () => {
    expect(gableAvailableHalfWidth(8, 2, 1)).toBe(2);
  });

  it("clamps to 0 rather than going negative past the ridge", () => {
    expect(gableAvailableHalfWidth(8, 2, 5)).toBe(0);
  });

  it("returns 0 for a degenerate (zero-height) roof", () => {
    expect(gableAvailableHalfWidth(8, 0, 0)).toBe(0);
  });
});

describe("clampComponentToGable", () => {
  // span=8 (so half-span 4), roofHeight=2 -> at v the available half-width
  // is 4*(1 - v/2).
  it("leaves an already-valid placement untouched", () => {
    const result = clampComponentToGable(8, 2, 4, 1, 0.5, 0.5);
    expect(result.offset).toBeCloseTo(4, 5);
    expect(result.centerV).toBeCloseTo(0.5, 5);
  });

  it("pulls the vertical center down so a (near-)zero-width top edge doesn't exceed the ridge", () => {
    // width=0 isolates the pure ridge-apex constraint from the width-taper
    // one below — maxVTopForWidth collapses to exactly roofHeight.
    const result = clampComponentToGable(8, 2, 4, 0, 1.9, 0.6);
    // halfHeight=0.3, so max centerV is roofHeight-halfHeight=1.7
    expect(result.centerV).toBeCloseTo(1.7, 5);
  });

  it("pulls the vertical center down further than the ridge apex alone would, when the component's own width doesn't fit that high", () => {
    // Same desired center/height as above, but width=1 this time: maxVTopForWidth
    // = roofHeight*(1-width/span) = 2*(1-1/8) = 1.75, tighter than the ridge
    // apex (2) — so the binding constraint is the taper, not the ridge.
    const result = clampComponentToGable(8, 2, 4, 1, 1.9, 0.6);
    expect(result.centerV).toBeCloseTo(1.45, 5);
    expect(result.centerV).toBeLessThan(1.7);
    // And the top edge really does fit the taper at that height.
    const vTop = result.centerV + 0.3;
    const availHalf = gableAvailableHalfWidth(8, 2, vTop);
    expect(availHalf).toBeGreaterThanOrEqual(0.5 - 1e-9);
  });

  it("keeps the vertical center at least half the height above the eave", () => {
    const result = clampComponentToGable(8, 2, 4, 1, -1, 0.6);
    expect(result.centerV).toBeCloseTo(0.3, 5);
  });

  it("pulls a too-far-off-center window back toward the ridge centerline", () => {
    // At vTop = 0.5+0.5=1, availHalf = 4*(1-1/2) = 2. Window half-width 0.5,
    // so the center (measured from the ridge) must stay within [-1.5, 1.5].
    // offset=7.9 -> centerFromRidge = 7.9-4 = 3.9, way outside.
    const result = clampComponentToGable(8, 2, 7.9, 1, 0.5, 1);
    const centerFromRidge = result.offset - 4;
    expect(centerFromRidge).toBeCloseTo(1.5, 5);
  });

  it("falls back to dead center when the window is too wide to ever fit", () => {
    const result = clampComponentToGable(8, 2, 6, 10, 0.2, 0.4);
    expect(result.offset).toBeCloseTo(4, 5);
  });

  it("the result always actually fits the taper — default house preset, default window, clicked high in a modest gable", () => {
    // house preset: depth 8 (span for left/right gable sides), default
    // block roofHeight 1.5; standard window scale [1.2, 1, 0.1]. A click
    // roughly 2/3 of the way up a 1.5m gable (clickV=1.0) is an entirely
    // plausible, unremarkable click — the regression this guards is the
    // clamp only checking the ridge apex and leaving the width still
    // poking out through the sloped roof on both sides.
    const span = 8;
    const roofHeight = 1.5;
    const width = 1.2;
    const height = 1;
    const result = clampComponentToGable(span, roofHeight, span / 2, width, 1.0, height);
    const vTop = result.centerV + height / 2;
    const vBottom = result.centerV - height / 2;
    expect(vTop).toBeLessThanOrEqual(roofHeight + 1e-9);
    expect(vBottom).toBeGreaterThanOrEqual(0 - 1e-9);
    const availHalf = gableAvailableHalfWidth(span, roofHeight, vTop);
    expect(availHalf).toBeGreaterThanOrEqual(width / 2 - 1e-9);
    const centerFromRidge = result.offset - span / 2;
    expect(Math.abs(centerFromRidge) + width / 2).toBeLessThanOrEqual(availHalf + 1e-9);
  });
});
