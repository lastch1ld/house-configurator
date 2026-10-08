export interface StairStep {
  size: [number, number, number];
  position: [number, number, number];
}

/** Target riser height, matching the comfortable real-world stair-code
 * range (~0.17-0.19m) rather than an arbitrary round number. */
const TARGET_RISER = 0.18;

/**
 * A straight flight of solid stepped-block stairs spanning the given
 * envelope: `width` (tread width), `totalRise` (floor-to-floor height),
 * `totalRun` (horizontal footprint along the flight, centered on local Z).
 * Each step is a solid box reaching from the ground up to its own tread
 * (the classic "stepped block" stair silhouette) rather than one ramp box,
 * so it actually reads as stairs once the individual risers are the target
 * height instead of one arbitrary slope.
 */
export function stairSteps(
  width: number,
  totalRise: number,
  totalRun: number
): StairStep[] {
  if (width <= 0 || totalRise <= 0 || totalRun <= 0) return [];
  const count = Math.max(1, Math.round(totalRise / TARGET_RISER));
  const riser = totalRise / count;
  const tread = totalRun / count;
  return Array.from({ length: count }, (_, i) => {
    const stepHeight = riser * (i + 1);
    return {
      size: [width, stepHeight, tread],
      position: [0, stepHeight / 2, -totalRun / 2 + tread * (i + 0.5)],
    };
  });
}
