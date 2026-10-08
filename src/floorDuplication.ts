import * as THREE from "three";
import { rotateWallSide } from "./baseGeometry";
import { alongWallPosition, wallLength } from "./componentSnap";
import { FLAT_ROOF_THICKNESS, MAX_FLOORS, MIN_FLOORS } from "./constants";
import {
  clampComponentToGable,
  gableRoofSlopes,
  monoPitchSlope,
  type RoofSlope,
} from "./gableGeometry";
import {
  clampComponentToHipFace,
  hipRoofFaces,
  shiftHipFaceAlongSlope,
} from "./hipRoofGeometry";
import { nanoid } from "./nanoid";
import { SKYLIGHT_RAISE, SOLAR_PANEL_RAISE } from "./types";
import type {
  BaseBlock,
  BaseConfig,
  BuildingType,
  PlacedComponent,
  RoofSlopeIndex,
  RoofType,
} from "./types";

/** Re-anchors components on `newBlock` after it moved/rotated, so a
 * wall-mounted door/window stays glued to its physical wall panel instead
 * of being left behind at its old world position. */
export function repositionWallComponents(
  components: PlacedComponent[],
  oldBlock: BaseBlock,
  newBlock: BaseBlock
): PlacedComponent[] {
  const steps = (((newBlock.rotation - oldBlock.rotation) / 90) % 4 + 4) % 4;
  if (steps === 0 && oldBlock.x === newBlock.x && oldBlock.z === newBlock.z) {
    return components;
  }
  return components.map((c) => {
    if (!c.wallRef || c.wallRef.blockId !== newBlock.id) return c;
    // A polygon edge index needs no rotation remap at all — see
    // `WallLocation`'s own doc (edge *i* means the same physical wall
    // regardless of the block's rotation, unlike `WallSide`).
    const location =
      c.wallRef.location.kind === "side" && steps !== 0
        ? { kind: "side" as const, side: rotateWallSide(c.wallRef.location.side, steps) }
        : c.wallRef.location;
    const { x, z, rotationY } = alongWallPosition(
      newBlock,
      location,
      c.wallRef.offset,
      c.type,
      c.wallRef.gable ?? false
    );
    return {
      ...c,
      position: [x, c.position[1], z],
      rotation: [c.rotation[0], rotationY, c.rotation[2]],
      wallRef: { ...c.wallRef, location },
    };
  });
}

/** Finds the block on `targetBlocks` that occupies the same footprint as
 * `source` — used to re-anchor a wall-mounted component onto the equivalent
 * block on the floor above (that block has its own, different id). */
function findMatchingBlock(
  source: BaseBlock | undefined,
  targetBlocks: BaseBlock[]
): BaseBlock | undefined {
  if (!source) return undefined;
  const EPS = 0.01;
  return targetBlocks.find(
    (b) =>
      Math.abs(b.x - source.x) < EPS &&
      Math.abs(b.z - source.z) < EPS &&
      Math.abs(b.width - source.width) < EPS &&
      Math.abs(b.depth - source.depth) < EPS &&
      b.rotation === source.rotation &&
      // width/depth alone aren't enough for a polygon block (PLAN.md §6) —
      // they're just its bounding box, so an ordinary rectangle block with
      // a matching bounding box would otherwise false-positive here.
      JSON.stringify(b.polygon) === JSON.stringify(source.polygon)
  );
}

/** Which of a block's roof types `computeRoofComponentPlacement` knows how
 * to place a skylight/solar panel on. Every roof type is included now that
 * hip's own trapezoid/triangle containment math exists (see PLAN.md §4 and
 * `hipRoofGeometry.ts`'s own doc) — kept as its own function (rather than
 * inlining `true`) since it's still the single source of truth the
 * Inspector gates its Skylight/Solar Panel sections on, and a future roof
 * type without placement math yet would need the same guard again. */
export function supportsRoofComponents(_roofType: RoofType): boolean {
  return true;
}

/** Shared by `addSkylight`/`addSolarPanel` (store.ts) and
 * `duplicateComponentsToFloorAbove` below — computes a roof-mounted
 * component's floor-local position/rotation for slope `slopeIndex` of
 * `block` (0/1 for a gable's two slopes; always 0 for mono-pitch/flat's
 * one; 0-3 for a hip roof's 4 faces, see `RoofSlopeIndex`), tilted to the
 * slope's pitch and nudged `raise` proud of the roof surface along that
 * slope's own normal, then composed with the block's yaw so it lands
 * correctly however the block is currently rotated. `footprint` (the
 * component's own [across-eave width, along-slope length], i.e.
 * `[scale[0], scale[2]]`) is only used for a hip roof's own containment —
 * every other roof type's face is already one big rectangle, so a
 * component simply centered on it has never needed a fit check. Returns
 * null for a roof type/slope index with no matching face (out-of-range
 * `slopeIndex` only, now that every roof type is supported) — callers
 * should treat that the same as "no matching block/slope to anchor to". */
export function computeRoofComponentPlacement(
  block: BaseBlock,
  roofType: RoofType,
  slopeIndex: RoofSlopeIndex,
  raise: number,
  footprint: [number, number] = [0, 0]
): { position: [number, number, number]; rotation: [number, number, number] } | null {
  const ridgeAxis = block.ridgeAxis ?? "x";
  let slope: RoofSlope;
  switch (roofType) {
    case "gable":
      if (slopeIndex !== 0 && slopeIndex !== 1) return null;
      slope = gableRoofSlopes(block.width, block.depth, block.roofHeight, ridgeAxis)[
        slopeIndex
      ];
      break;
    case "monoPitch":
      slope = monoPitchSlope(block.width, block.depth, block.roofHeight, ridgeAxis);
      break;
    case "flat":
      // No tilt, no ridge — a flat roof's own top surface, flush with
      // where `Base.tsx` renders its slab (`wallHeight + FLAT_ROOF_THICKNESS`).
      slope = {
        position: [0, FLAT_ROOF_THICKNESS, 0],
        rotation: [0, 0, 0],
        size: [block.width, FLAT_ROOF_THICKNESS, block.depth],
      };
      break;
    case "hip": {
      const face = hipRoofFaces(block.width, block.depth, block.roofHeight, ridgeAxis)[
        slopeIndex
      ];
      if (!face) return null;
      const [footprintWidth, footprintLength] = footprint;
      const { centerV } = clampComponentToHipFace(
        face.eaveHalfWidth,
        face.ridgeHalfWidth,
        face.slopeLength,
        0,
        footprintWidth,
        face.slopeLength / 2,
        footprintLength
      );
      slope = {
        position: shiftHipFaceAlongSlope(face, centerV - face.slopeLength / 2),
        rotation: face.rotation,
        size: [footprintWidth, 0.1, footprintLength],
      };
      break;
    }
  }
  const tiltQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(...slope.rotation));
  const localPos = new THREE.Vector3(...slope.position).addScaledVector(
    new THREE.Vector3(0, 1, 0).applyQuaternion(tiltQuat),
    raise
  );
  const yawQuat = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    (block.rotation * Math.PI) / 180
  );
  localPos.applyQuaternion(yawQuat);
  const finalEuler = new THREE.Euler().setFromQuaternion(yawQuat.multiply(tiltQuat));
  return {
    position: [block.x + localPos.x, block.wallHeight + localPos.y, block.z + localPos.z],
    rotation: [finalEuler.x, finalEuler.y, finalEuler.z],
  };
}

/** The slice of ConfiguratorState that `duplicateComponentsToFloorAbove`
 * needs to read — kept as a narrow local shape (rather than importing
 * ConfiguratorState from store.ts) to avoid a circular import between this
 * module and the store. */
export interface FloorDuplicationState {
  base: BaseConfig;
  components: PlacedComponent[];
}

export interface FloorDuplicationResult {
  components: PlacedComponent[];
  activeFloorIndex: number;
  selectedIds: string[];
  selectedBlockId: null;
  notice?: string | null;
  /** How many of the copies this call made couldn't be re-anchored (see
   * `notice`'s own wording) — a plain count, kept alongside the
   * human-readable `notice` so a caller that chains multiple calls (see
   * `duplicateComponentsToAllFloorsAbove`) can accumulate it without
   * parsing `notice`'s text back apart. */
  unanchoredCount: number;
}

/** Shared by duplicateComponentToFloorAbove and its selection-wide sibling.
 * Copies every given component (must all share one floor) onto the floor
 * above, re-anchoring wall-mounted ones to whichever block up there occupies
 * the same footprint as their current wall (falling back to a floating,
 * un-wall-refed copy if none matches). Returns null (no-op) if there's no
 * floor above yet, or none of the ids resolve to a component. */
export function duplicateComponentsToFloorAbove(
  state: FloorDuplicationState,
  ids: string[]
): FloorDuplicationResult | null {
  const maxAllowed: number =
    state.base.buildingType === ("factoryHall" as BuildingType) ? MIN_FLOORS : MAX_FLOORS;
  const sources = state.components.filter((c) => ids.includes(c.id));
  if (sources.length === 0) return null;
  const floorIndex = sources[0].floorIndex;
  const targetFloorIndex = floorIndex + 1;
  if (
    targetFloorIndex >= maxAllowed ||
    targetFloorIndex >= state.base.floors.length
  ) {
    return null;
  }
  const sourceBlocks = state.base.floors[floorIndex]?.blocks ?? [];
  const targetBlocks = state.base.floors[targetFloorIndex].blocks;

  let unanchoredCount = 0;
  const duplicates: PlacedComponent[] = sources
    .filter((source) => source.floorIndex === floorIndex)
    .map((source) => {
      const newId = nanoid();
      if ((source.type === "skylight" || source.type === "solarPanel") && source.roofSlot) {
        // Re-anchor to the matching block's own slope on the floor above,
        // recomputed fresh — reusing the source's baked position/rotation
        // verbatim only happens to be right if that floor has an
        // identical block at the identical footprint, which isn't
        // guaranteed (each floor's blocks are independent).
        const sourceBlock = sourceBlocks.find(
          (b) => b.id === source.roofSlot!.blockId
        );
        const targetBlock = findMatchingBlock(sourceBlock, targetBlocks);
        const targetRoofType = targetBlock
          ? targetBlock.roofType ?? state.base.roofType
          : undefined;
        const placement = targetBlock
          ? computeRoofComponentPlacement(
              targetBlock,
              targetRoofType!,
              source.roofSlot.slopeIndex,
              source.type === "skylight" ? SKYLIGHT_RAISE : SOLAR_PANEL_RAISE,
              [source.scale[0], source.scale[2]]
            )
          : null;
        if (!targetBlock || !placement) {
          // No matching block up there to anchor to (or its roof type
          // doesn't support roof components yet, e.g. hip) — drop the
          // roofSlot rather than keep a stale reference and fall back to a
          // floating copy at the source's old position (still better than
          // silently failing to copy at all).
          unanchoredCount += 1;
          return { ...source, id: newId, floorIndex: targetFloorIndex, roofSlot: undefined };
        }
        return {
          ...source,
          id: newId,
          floorIndex: targetFloorIndex,
          position: placement.position,
          rotation: placement.rotation,
          roofSlot: { blockId: targetBlock.id, slopeIndex: source.roofSlot.slopeIndex },
        };
      }
      if (!source.wallRef) {
        return { ...source, id: newId, floorIndex: targetFloorIndex };
      }
      const sourceBlock = sourceBlocks.find(
        (b) => b.id === source.wallRef!.blockId
      );
      const targetBlock = findMatchingBlock(sourceBlock, targetBlocks);
      if (!targetBlock) {
        unanchoredCount += 1;
        return {
          ...source,
          id: newId,
          floorIndex: targetFloorIndex,
          wallRef: undefined,
        };
      }
      // A gable-anchored component needs one more step than a regular wall
      // one: the target floor's matching block is a wholly independent
      // block (own roofHeight/span), so the source's offset/height that fit
      // its own gable may not fit this one — reclamp against the target's
      // own taper instead of copying blindly.
      let offset = source.wallRef.offset;
      let centerY = source.position[1];
      if (source.wallRef.gable) {
        const span = wallLength(targetBlock, source.wallRef.location);
        const clamped = clampComponentToGable(
          span,
          targetBlock.roofHeight,
          offset,
          source.scale[0],
          source.position[1] - targetBlock.wallHeight,
          source.scale[1]
        );
        offset = clamped.offset;
        centerY = targetBlock.wallHeight + clamped.centerV;
      }
      const { x, z, rotationY } = alongWallPosition(
        targetBlock,
        source.wallRef.location,
        offset,
        source.type,
        source.wallRef.gable ?? false
      );
      return {
        ...source,
        id: newId,
        floorIndex: targetFloorIndex,
        position: [x, centerY, z],
        rotation: [source.rotation[0], rotationY, source.rotation[2]],
        wallRef: {
          blockId: targetBlock.id,
          location: source.wallRef.location,
          offset,
          gable: source.wallRef.gable,
        },
      };
    });
  if (duplicates.length === 0) return null;

  return {
    components: [...state.components, ...duplicates],
    activeFloorIndex: targetFloorIndex,
    selectedIds: duplicates.map((d) => d.id),
    selectedBlockId: null,
    // A fully-anchored copy clears any notice left over from an earlier
    // partial failure — otherwise a stale "couldn't re-anchor" message can
    // linger (within its 5s auto-dismiss window, see App.tsx) over an
    // operation that actually fully succeeded.
    notice:
      unanchoredCount > 0
        ? unanchoredCount === 1
          ? "Copied, but couldn't re-anchor it — the floor above has no matching wall/roof there."
          : `Copied, but couldn't re-anchor ${unanchoredCount} of them — the floor above has no matching wall/roof there.`
        : null,
    unanchoredCount,
  };
}

/**
 * Repeats `duplicateComponentsToFloorAbove` one floor at a time, all the
 * way up — the "same window on every floor of an apartment facade" case
 * (see PLAN.md §14) that hand-duplicating one floor at a time doesn't
 * scale to. Each step's own copies become the *next* step's source (so a
 * `roofSlot`/`wallRef` mismatch on floor 3 doesn't silently stop floors
 * 4-5 from getting a copy too — every floor is anchored independently
 * against its own blocks, exactly like the single-floor version). Returns
 * null under the same conditions `duplicateComponentsToFloorAbove` does
 * (no floor above at all, or no id resolves to a component) — a *partial*
 * climb (reaches floor 3 of 5, say, because floor 4 has no matching wall)
 * still returns its own result rather than null, with the accumulated
 * unanchored count across every floor it did copy to.
 */
export function duplicateComponentsToAllFloorsAbove(
  state: FloorDuplicationState,
  ids: string[]
): FloorDuplicationResult | null {
  let currentState: FloorDuplicationState = state;
  let currentIds = ids;
  let lastResult: FloorDuplicationResult | null = null;
  let totalUnanchored = 0;

  for (;;) {
    const result = duplicateComponentsToFloorAbove(currentState, currentIds);
    if (!result) break;
    lastResult = result;
    currentState = { base: currentState.base, components: result.components };
    currentIds = result.selectedIds;
    totalUnanchored += result.unanchoredCount;
  }
  if (!lastResult) return null;

  return {
    ...lastResult,
    notice:
      totalUnanchored > 0
        ? totalUnanchored === 1
          ? "Copied to every floor above, but couldn't re-anchor it on one of them — no matching wall/roof there."
          : `Copied to every floor above, but couldn't re-anchor ${totalUnanchored} placement(s) — no matching wall/roof there.`
        : null,
    unanchoredCount: totalUnanchored,
  };
}
