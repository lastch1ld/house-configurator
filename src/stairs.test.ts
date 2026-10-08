import { describe, expect, it } from "vitest";
import { stairSteps } from "./stairs";

describe("stairSteps", () => {
  it("returns an empty flight for a non-positive envelope", () => {
    expect(stairSteps(1, 0, 3)).toEqual([]);
    expect(stairSteps(1, 3, 0)).toEqual([]);
    expect(stairSteps(0, 3, 3)).toEqual([]);
  });

  it("produces steps with a riser close to the 0.18m target", () => {
    const steps = stairSteps(1, 3, 4.68);
    expect(steps.length).toBeGreaterThan(0);
    for (let i = 0; i < steps.length; i++) {
      const riser = i === 0 ? steps[0].size[1] : steps[i].size[1] - steps[i - 1].size[1];
      expect(riser).toBeCloseTo(3 / steps.length, 5);
      expect(Math.abs(riser - 0.18)).toBeLessThan(0.02);
    }
  });

  it("stacks each step's height cumulatively, reaching the full rise at the top step", () => {
    const steps = stairSteps(1, 3, 4.68);
    const top = steps[steps.length - 1];
    expect(top.size[1]).toBeCloseTo(3, 5);
  });

  it("spans the full run, centered on local Z, tread by tread", () => {
    const steps = stairSteps(1, 3, 6);
    const tread = 6 / steps.length;
    expect(steps[0].position[2]).toBeCloseTo(-3 + tread / 2, 5);
    expect(steps[steps.length - 1].position[2]).toBeCloseTo(3 - tread / 2, 5);
  });

  it("keeps every step's width equal to the requested tread width", () => {
    const steps = stairSteps(1.2, 3, 4.68);
    for (const s of steps) expect(s.size[0]).toBe(1.2);
  });
});
