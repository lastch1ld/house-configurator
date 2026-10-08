import { FLAT_ROOF_THICKNESS } from "./constants";
import { resolveComponentSize } from "./types";
import type { PlacedComponent } from "./types";

/** A flat roof panel plus two support columns under its unattached outer
 * edge — the shared geometry behind both a template's stepped-terrace
 * canopy and a live-placed porch: a rectangle (`x`/`z`/`width`/`depth`)
 * flush with `wallHeight` on one side (the attached wall, which needs no
 * column of its own) and open on the other three, with `outerAxis`/
 * `outerSign` naming which edge is the free one that gets columns. */
export function roofWithColumns(
  idPrefix: string,
  floorIndex: number,
  wallHeight: number,
  x: number,
  z: number,
  width: number,
  depth: number,
  outerAxis: "x" | "z",
  outerSign: 1 | -1
): PlacedComponent[] {
  const panel: PlacedComponent = {
    id: `${idPrefix}-canopy`,
    type: "roofSection",
    floorIndex,
    variant: "standard",
    // Bottom face flush with wallHeight, same as a real flat roof (Base.tsx
    // positions it at wallHeight + FLAT_ROOF_THICKNESS / 2, not straddling
    // the wall-top line).
    position: [x, wallHeight + FLAT_ROOF_THICKNESS / 2, z],
    rotation: [0, 0, 0],
    scale: [width, FLAT_ROOF_THICKNESS, depth],
  };

  const { scale: columnScale, centerY: columnCenterY } = resolveComponentSize(
    "column",
    "standard",
    wallHeight
  );
  const inset = columnScale[0] / 2 + 0.15;
  const outerSize = outerAxis === "x" ? width : depth;
  const outerCenter = outerAxis === "x" ? x : z;
  const outerCoord = outerCenter + outerSign * (outerSize / 2 - inset);
  const perpSize = outerAxis === "x" ? depth : width;
  const perpCenter = outerAxis === "x" ? z : x;
  const columns: PlacedComponent[] = [-1, 1].map((sign, i) => {
    const perpCoord = perpCenter + sign * (perpSize / 2 - inset);
    const cx = outerAxis === "x" ? outerCoord : perpCoord;
    const cz = outerAxis === "x" ? perpCoord : outerCoord;
    return {
      id: `${idPrefix}-column-${i}`,
      type: "column",
      floorIndex,
      variant: "standard",
      position: [cx, columnCenterY, cz],
      rotation: [0, 0, 0],
      scale: columnScale,
    };
  });

  return [panel, ...columns];
}
