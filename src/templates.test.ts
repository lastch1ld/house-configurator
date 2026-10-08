import { describe, expect, it } from "vitest";
import { STARTER_TEMPLATES } from "./templates";

describe("STARTER_TEMPLATES", () => {
  for (const template of STARTER_TEMPLATES) {
    it(`${template.id} builds a valid base + components`, () => {
      const { base, components } = template.build();
      expect(base.floors.length).toBeGreaterThan(0);
      for (const floor of base.floors) {
        expect(floor.blocks.length).toBeGreaterThan(0);
      }
      // Every finite number, and no NaN from a bad wall offset/edge calc.
      for (const c of components) {
        for (const n of [...c.position, ...c.rotation, ...c.scale]) {
          expect(Number.isFinite(n)).toBe(true);
        }
      }
      // Component ids are unique within a template.
      const ids = components.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  }
});
