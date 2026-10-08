import { describe, expect, it } from "vitest";
import { roofWithColumns } from "./porch";

describe("roofWithColumns", () => {
  it("produces one roof panel flush with wallHeight and two columns on the free outer edge", () => {
    const wallHeight = 3;
    const [panel, columnA, columnB] = roofWithColumns(
      "test",
      0,
      wallHeight,
      0,
      3,
      6,
      2,
      "z",
      1
    );
    expect(panel.type).toBe("roofSection");
    expect(panel.position[1]).toBeGreaterThan(wallHeight);
    expect(panel.scale).toEqual([6, panel.scale[1], 2]);

    expect(columnA.type).toBe("column");
    expect(columnB.type).toBe("column");
    // Both columns sit near the outer (+z) edge of the rectangle (z center
    // 3, depth 2 -> outer edge at z=4), not the attached (z=2) edge.
    expect(columnA.position[2]).toBeGreaterThan(3);
    expect(columnB.position[2]).toBeGreaterThan(3);
    // On opposite sides of the perpendicular (x) axis.
    expect(Math.sign(columnA.position[0])).not.toBe(Math.sign(columnB.position[0]));
  });

  it("supports all four outer-edge orientations without mixing up axes", () => {
    const [, leftCol] = roofWithColumns("t", 0, 3, -5, 0, 2, 6, "x", -1);
    expect(leftCol.position[0]).toBeLessThan(-5);

    const [, rightCol] = roofWithColumns("t", 0, 3, 5, 0, 2, 6, "x", 1);
    expect(rightCol.position[0]).toBeGreaterThan(5);
  });
});
