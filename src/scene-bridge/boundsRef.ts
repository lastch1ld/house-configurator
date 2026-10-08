import type { BoundsApi } from "@react-three/drei";

/** Mutable bridge so DOM-level UI (e.g. a "Reset view" button) can trigger
 * drei's <Bounds> camera-framing from outside the R3F <Canvas> tree. */
export const boundsApiRef: { current: BoundsApi | null } = { current: null };
