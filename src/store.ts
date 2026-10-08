import { create } from "zustand";
import { edges, localSideToWorldSide, overallFootprint, snapBlockPosition } from "./baseGeometry";
import {
  alongWallPosition,
  oppositeWallSide,
  snapComponentToWalls,
  wallLength,
} from "./componentSnap";
import {
  DEFAULT_ROOF_MATERIAL,
  DEFAULT_WALL_COLOR,
  DEFAULT_WALL_MATERIAL,
} from "./components/materials";
import { FLAT_ROOF_THICKNESS, MAX_FLOORS, MIN_FLOORS } from "./constants";
import {
  computeRoofComponentPlacement,
  duplicateComponentsToAllFloorsAbove,
  duplicateComponentsToFloorAbove,
  repositionWallComponents,
} from "./floorDuplication";
import { clampComponentToGable } from "./gableGeometry";
import { createHistory } from "./history";
import { nanoid } from "./nanoid";
import { polygonBoundingBox, rotatePolygon } from "./polygonGeometry";
import { adjacentBalconySides, mergeAdjacentBalconyFootprint, railingForFreeEdge } from "./balconyGeometry";
import { POLYGON_PRESETS, type PolygonPresetKey } from "./polygonPresets";
import { roofWithColumns } from "./porch";
import {
  BUILDING_PRESETS,
  DEFAULT_SCALE,
  GARAGE_SIZES,
  resolveComponentSize,
  SKYLIGHT_RAISE,
  SOLAR_PANEL_RAISE,
} from "./types";
import type {
  BaseBlock,
  BaseConfig,
  BlockRotation,
  BuildingType,
  ComponentType,
  ComponentVariant,
  DoorStyle,
  Floor,
  GarageSize,
  LightingPreset,
  ModelFormat,
  PlacedComponent,
  RoofSlopeIndex,
  WallLocation,
  WallSide,
} from "./types";

/** Door variants that always render ribbed regardless of `doorStyle` (see
 * DoorStyle's own doc comment) — these get `undefined` instead of a style. */
const RIBBED_DOOR_VARIANTS = new Set<ComponentVariant>(["garage", "hangar"]);

/** A front door should look like a real entrance out of the box; a plain
 * "flush" slab (the old default for standard/double) read as a bare box with
 * barely a handle — "paneled"/"glazed" look like a real door immediately.
 * Keyed explicitly by variant (rather than a ternary chain) so a newly added
 * door variant that forgets to appear here is easy to spot in review instead
 * of silently inheriting the `default:` fallback. Still changeable afterward
 * via the Inspector or the scene context menu's "Door style" submenu. */
function defaultDoorStyle(variant: ComponentVariant): DoorStyle | undefined {
  if (RIBBED_DOOR_VARIANTS.has(variant)) return undefined;
  switch (variant) {
    case "frontDoor":
      return "glazed";
    default:
      return "paneled";
  }
}

/** Single place that writes the current floors/components into
 * floorsByType/componentsByType under the state's *current* buildingType —
 * setBuildingType and loadTemplate both need this exact snapshot before
 * swapping to a different type/base, so it's centralized here rather than
 * duplicated at each call site (previously a manual-sync smell: easy to
 * update one map and forget the other when adding a third per-type map). */
function snapshotCurrentTypeMaps(
  state: Pick<ConfiguratorState, "base" | "components" | "floorsByType" | "componentsByType">
): {
  floorsByType: Partial<Record<BuildingType, Floor[]>>;
  componentsByType: Partial<Record<BuildingType, PlacedComponent[]>>;
} {
  return {
    floorsByType: {
      ...state.floorsByType,
      [state.base.buildingType]: state.base.floors,
    },
    componentsByType: {
      ...state.componentsByType,
      [state.base.buildingType]: state.components,
    },
  };
}

function defaultBlocksFor(type: BuildingType): BaseBlock[] {
  const preset = BUILDING_PRESETS[type];
  return [
    {
      id: nanoid(),
      x: 0,
      z: 0,
      width: preset.width,
      depth: preset.depth,
      wallHeight: preset.wallHeight,
      roofHeight: 1.5,
      rotation: 0,
    },
  ];
}

function defaultFloorsFor(type: BuildingType): Floor[] {
  return [{ id: nanoid(), blocks: defaultBlocksFor(type) }];
}

/** Replaces only the active floor's blocks, leaving every other floor as-is. */
function updateActiveFloorBlocks(
  floors: Floor[],
  activeFloorIndex: number,
  updater: (blocks: BaseBlock[]) => BaseBlock[]
): Floor[] {
  return floors.map((f, i) =>
    i === activeFloorIndex ? { ...f, blocks: updater(f.blocks) } : f
  );
}

interface ConfiguratorState {
  base: BaseConfig;
  /** Each building type's floors are kept independent — switching type
   * doesn't resize or discard the other type's layout, it swaps to it. */
  floorsByType: Partial<Record<BuildingType, Floor[]>>;
  /** Each building type's placed components are kept independent too, the
   * same way floorsByType keeps blocks independent — otherwise a door/window
   * placed on one type keeps rendering (or misrendering) against whatever
   * block now occupies its old floorIndex/wallRef.blockId after switching. */
  componentsByType: Partial<Record<BuildingType, PlacedComponent[]>>;
  /** Which floor is currently being edited — the only one whose blocks and
   * components can be selected/clicked; the rest render dimmed. */
  activeFloorIndex: number;
  components: PlacedComponent[];
  /** Selected placed components. Empty = none. */
  selectedIds: string[];
  selectedBlockId: string | null;
  /** Which panel is open as a bottom sheet on a narrow viewport (see
   * useIsNarrowViewport, BlocksSidebar, Inspector) — null means neither is
   * open. Irrelevant/unused above the narrow breakpoint, where both panels
   * are always visible side-by-side as before. Pure UI chrome, not part of
   * the undo history (the history subscribe in this file only reacts to
   * base/components changes). */
  mobilePanel: "sidebar" | "inspector" | null;
  setMobilePanel: (panel: "sidebar" | "inspector" | null) => void;
  transparentWalls: boolean;
  lightingPreset: LightingPreset;
  /** A short-lived, user-facing message for actions that partially failed
   * (e.g. a component couldn't be re-anchored on the floor above). Null when
   * there's nothing to show. */
  notice: string | null;
  dismissNotice: () => void;
  /** Whether there's a prior/later base+components snapshot to jump to —
   * kept in state (rather than read directly off the history module) purely
   * so components re-render when it changes (see the `subscribe` wiring
   * below, which is the actual source of truth). */
  canUndo: boolean;
  canRedo: boolean;
  /** Steps the building's base+components back/forward to the previous/next
   * recorded snapshot. Doesn't undo UI-only state (selection, transparent
   * walls, lighting) — only the building itself. */
  undo: () => void;
  redo: () => void;
  updateBase: (patch: Partial<Omit<BaseConfig, "floors">>) => void;
  setActiveFloor: (index: number) => void;
  setFloorCount: (count: number) => void;
  addBlock: (x?: number, z?: number) => void;
  addGarageBlock: (size: GarageSize, x?: number, z?: number) => void;
  /** Adds a free-form polygon-footprint block from a hand-authored preset
   * (PLAN.md §6 Phase A — no interactive vertex editing yet, a preset is
   * dropped in and repositioned/scaled as a whole like any other block).
   * Forces `roofType: "flat"` — Phase A doesn't support gable/hip/
   * mono-pitch over a non-rectangular footprint. */
  addPolygonBlock: (preset: PolygonPresetKey, x?: number, z?: number) => void;
  /** Adds a raised glass skylight box onto one of a block's roof slopes,
   * centered on that slope and tilted to match its pitch — works for
   * "gable" (slopeIndex 0/1, its two slopes), "monoPitch" and "flat"
   * (slopeIndex always 0, their one usable surface), and "hip" (slopeIndex
   * 0-3, its 4 faces — see `hipRoofFaces` in hipRoofGeometry.ts). Baked at
   * add-time from the block's *current* dimensions/rotation/pitch — like
   * every other component, it won't retroactively follow later changes to
   * those (see TODO.md). */
  addSkylight: (blockId: string, slopeIndex: RoofSlopeIndex) => void;
  /** Same placement rules as `addSkylight`, but adds a raised solar panel
   * instead of a glazed skylight box — a separate roofSlot-tagged type so a
   * slope can carry one of each rather than the two competing for the same
   * duplicate-guard. */
  addSolarPanel: (blockId: string, slopeIndex: RoofSlopeIndex) => void;
  /** Adds a structural porch — a flat canopy roof flush with the block's
   * own wallHeight, plus two support columns under its free outer edge —
   * extending outward from one of a block's four walls. Integrated with
   * the block it's attached to (matches its wallHeight, snaps flush against
   * its wall) rather than a freestanding, disconnected structure.
   * `side` is the block's own local wall identity (e.g. "front" always
   * means the same physical wall the Inspector's "+ Front" button labels,
   * matching how Base.tsx renders walls before applying the block's own
   * rotation) — converted to the current world-space side internally, so
   * a rotated block still gets its porch on the wall the user picked. */
  addPorch: (blockId: string, side: WallSide, porchDepth?: number) => void;
  /** Adds a cantilevered balcony slab spanning one of a block's walls, with
   * a railing baked in along its free (outward) edge — two independent
   * `PlacedComponent`s (a `balcony` slab + a `railing`), same
   * two-pieces-at-once approach `addPorch`/`roofWithColumns` already use,
   * not a single component with a details-sibling that would need to
   * re-derive which edge is "outward" from nothing but its own scale.
   * `side` is local like `addPorch`'s. Unlike a porch, not floor-restricted
   * (a balcony belongs on an upper floor at least as often as the ground
   * one) and, like a porch, doesn't carry a `wallRef` — it won't follow the
   * block if it's later rotated or moved (a known, accepted limitation
   * shared with porches; see PLAN.md §10). */
  addBalcony: (blockId: string, side: WallSide, balconyDepth?: number) => void;
  updateBlock: (id: string, patch: Partial<BaseBlock>) => void;
  removeBlock: (id: string) => void;
  duplicateBlock: (id: string) => void;
  /** Copies this block onto the floor above (creating it first if the
   * active floor is currently the top one), keeping the same x/z so the
   * copy stacks directly above its source rather than snapping elsewhere. */
  duplicateBlockToFloorAbove: (id: string) => void;
  selectBlock: (id: string | null) => void;
  addComponent: (
    type: ComponentType,
    position?: [number, number, number],
    variant?: ComponentVariant
  ) => void;
  /** Adds a "model" component from an already-read file (see
   * readFileAsDataUrl in modelImport.ts) — freestanding, no wall-snapping,
   * at 1:1 scale (the model's own real-world units, if any). Its actual
   * geometry loads asynchronously in ImportedModel.tsx once rendered, not
   * here — this only records enough to load it. */
  addImportedModel: (
    dataUrl: string,
    format: ModelFormat,
    fileName: string,
    position?: [number, number, number]
  ) => void;
  updateComponent: (id: string, patch: Partial<PlacedComponent>) => void;
  removeComponent: (id: string) => void;
  duplicateComponent: (id: string) => void;
  /** Copies this component onto the floor above, re-anchoring it to whatever
   * block up there occupies the same footprint as its current wall (falling
   * back to a floating, un-wall-refed copy if none matches). No-ops if
   * there's no floor above to attach it to. */
  duplicateComponentToFloorAbove: (id: string) => void;
  /** Same as duplicateComponentToFloorAbove, but for the whole selection. */
  duplicateSelectedComponentsToFloorAbove: () => void;
  /** Repeats duplicateComponentToFloorAbove all the way to the top floor in
   * one action — the "same window on every floor of an apartment facade"
   * case a single "to floor above" click doesn't scale to (see PLAN.md
   * §14). Each floor's copies come from the floor just below it, so the
   * chain still works correctly even if the buildings' blocks differ from
   * floor to floor. */
  duplicateComponentToAllFloorsAbove: (id: string) => void;
  /** Same as duplicateComponentToAllFloorsAbove, but for the whole selection. */
  duplicateSelectedComponentsToAllFloorsAbove: () => void;
  mirrorComponentToOppositeWall: (id: string) => void;
  /** Rotates a single component by one quarter-turn around Y — the same
   * relative Β±90Β° stepping as blocks and the whole-building rotate, so
   * every rotation control in the app behaves the same way. */
  rotateComponent: (id: string, direction: 1 | -1) => void;
  rotateSelectedComponents: (direction: 1 | -1) => void;
  /** Distributes the selected components evenly, keeping their group's
   * current center fixed. When they all share the same wall, "evenly" means
   * along that wall's own length (its natural "horizontal" axis); otherwise
   * it falls back to the world X axis, leaving each component's own Z/height
   * untouched. */
  centerSelectedComponentsHorizontally: () => void;
  /** Replaces one wall-anchored component with `count` evenly spaced
   * copies across that same wall's own full span (same even-spacing
   * formula `centerSelectedComponentsHorizontally` already uses) — turns
   * "place one window" into "fill this wall's window row" in one action
   * instead of `count` manual placements (see PLAN.md §14). No-ops for a
   * freestanding (no `wallRef`) component or a `count` under 1. */
  repeatComponentAlongWall: (id: string, count: number) => void;
  /** Replaces the selection with just this one (or clears it, for null). */
  selectComponent: (id: string | null) => void;
  /** Adds/removes this one from the selection, keeping the rest. */
  toggleComponentSelection: (id: string) => void;
  removeSelectedComponents: () => void;
  setTransparentWalls: (value: boolean) => void;
  setLightingPreset: (preset: LightingPreset) => void;
  setBuildingType: (type: BuildingType) => void;
  setLinkedRoofHeight: (linked: boolean) => void;
  loadTemplate: (base: BaseConfig, components: PlacedComponent[]) => void;
  /** Rotates every block on every floor by one quarter-turn around the
   * whole building's combined footprint center, so a multi-block L/T/U
   * shape — and every floor stacked above it — turns together as one
   * rigid assembly instead of each block (or floor) spinning in place. */
  rotateAllBlocks: (direction: 1 | -1) => void;
}

/** Undo/redo history for the building itself (base+components) — deliberately
 * excludes UI-only state (selection, transparent walls, lighting, active
 * floor) so undo steps through meaningful edits rather than every click.
 * Lives outside the store (see the `subscribe` call below the store
 * definition) so the history stack itself never becomes part of what a
 * later undo would revert. */
const history = createHistory();
/** Guards the `subscribe` listener below from recording the store's own
 * undo/redo writes as new history entries, which would otherwise turn every
 * undo into an unremovable extra step. */
let isTimeTraveling = false;

/** Shared by `addSkylight` and `addSolarPanel` — both are "one raised
 * roofSlot-tagged component per block+slope" actions that only differ in
 * `type`/`raise`/`DEFAULT_SCALE` key, so the find-block/duplicate-guard/
 * placement/build-component steps live here once instead of twice. */
function addRoofSlotComponent(
  state: Pick<ConfiguratorState, "base" | "activeFloorIndex" | "components">,
  blockId: string,
  slopeIndex: RoofSlopeIndex,
  type: "skylight" | "solarPanel",
  raise: number
): Pick<ConfiguratorState, "components"> | null {
  const blocks = state.base.floors[state.activeFloorIndex].blocks;
  const block = blocks.find((b) => b.id === blockId);
  if (!block) return null;

  // Cap at one per slope, per type — the "+ Slope A/B"/"+ Add" buttons used
  // to let you click endlessly and stack an unbounded number of skylights
  // on the exact same spot.
  const alreadyExists = state.components.some(
    (c) =>
      c.type === type &&
      c.floorIndex === state.activeFloorIndex &&
      c.roofSlot?.blockId === blockId &&
      c.roofSlot?.slopeIndex === slopeIndex
  );
  if (alreadyExists) return null;

  const roofType = block.roofType ?? state.base.roofType;
  const [footprintWidth, , footprintLength] = DEFAULT_SCALE[type];
  const placement = computeRoofComponentPlacement(block, roofType, slopeIndex, raise, [
    footprintWidth,
    footprintLength,
  ]);
  if (!placement) return null;

  const newComponent: PlacedComponent = {
    id: nanoid(),
    type,
    variant: "standard",
    floorIndex: state.activeFloorIndex,
    position: placement.position,
    rotation: placement.rotation,
    scale: DEFAULT_SCALE[type],
    roofSlot: { blockId, slopeIndex },
  };
  return { components: [...state.components, newComponent] };
}

export const useConfiguratorStore = create<ConfiguratorState>((set, get) => ({
  base: {
    roofType: "flat",
    buildingType: "house",
    linkedRoofHeight: true,
    floors: defaultFloorsFor("house"),
    wallMaterialId: DEFAULT_WALL_MATERIAL.house,
    roofMaterialId: DEFAULT_ROOF_MATERIAL.house,
    wallColor: DEFAULT_WALL_COLOR,
  },
  floorsByType: {},
  componentsByType: {},
  activeFloorIndex: 0,
  components: [],
  selectedIds: [],
  selectedBlockId: null,
  mobilePanel: null,
  setMobilePanel: (panel) => set({ mobilePanel: panel }),
  canUndo: false,
  canRedo: false,
  undo: () => {
    const state = get();
    const prev = history.undo({ base: state.base, components: state.components });
    if (!prev) return;
    isTimeTraveling = true;
    set({
      base: prev.base,
      // A restored snapshot's floors array can be shorter than the one
      // being replaced (e.g. undoing a setFloorCount that grew it) — clamp
      // so activeFloorIndex never points past the end, which would crash
      // every reader of base.floors[activeFloorIndex] (BlocksSidebar,
      // Inspector) on the very next render.
      activeFloorIndex: Math.min(state.activeFloorIndex, prev.base.floors.length - 1),
      components: prev.components,
      selectedIds: [],
      selectedBlockId: null,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    });
    isTimeTraveling = false;
  },
  redo: () => {
    const state = get();
    const next = history.redo({ base: state.base, components: state.components });
    if (!next) return;
    isTimeTraveling = true;
    set({
      base: next.base,
      activeFloorIndex: Math.min(state.activeFloorIndex, next.base.floors.length - 1),
      components: next.components,
      selectedIds: [],
      selectedBlockId: null,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    });
    isTimeTraveling = false;
  },
  transparentWalls: false,
  lightingPreset: "park",
  notice: null,
  dismissNotice: () => set({ notice: null }),
  updateBase: (patch) =>
    set((state) => ({ base: { ...state.base, ...patch } })),
  setActiveFloor: (index) =>
    set((state) => {
      const clamped = Math.max(0, Math.min(index, state.base.floors.length - 1));
      if (clamped === state.activeFloorIndex) return state;
      return { activeFloorIndex: clamped, selectedBlockId: null, selectedIds: [] };
    }),
  setFloorCount: (count) =>
    set((state) => {
      // Factory halls are always single-story — multiple floors are a
      // house-only feature.
      const maxAllowed =
        state.base.buildingType === "factoryHall" ? MIN_FLOORS : MAX_FLOORS;
      const target = Math.max(MIN_FLOORS, Math.min(count, maxAllowed));
      const floors = state.base.floors;
      if (target === floors.length) return state;
      const nextFloors = [...floors];
      // Each new floor starts as a copy of the one below it (fresh block
      // ids so they don't collide with the floor it was copied from) —
      // a blank single-block floor is rarely what you want above an
      // already-shaped one. The rep can still reshape it afterwards.
      // Note: this only seeds the new floor's roofHeight from today's
      // values below — linkedRoofHeight (see updateBlock) keeps blocks in
      // sync *within* a floor only, so a later roofHeight edit on one floor
      // does not retroactively propagate to floors created from it here.
      while (nextFloors.length < target) {
        const below = nextFloors[nextFloors.length - 1];
        nextFloors.push({
          id: nanoid(),
          blocks: below.blocks.map((b) => ({ ...b, id: nanoid() })),
        });
      }
      nextFloors.length = target;
      const components =
        target < floors.length
          ? state.components.filter((c) => c.floorIndex < target)
          : state.components;
      return {
        base: { ...state.base, floors: nextFloors },
        activeFloorIndex: Math.min(state.activeFloorIndex, target - 1),
        components,
        selectedBlockId: null,
        selectedIds: [],
      };
    }),
  addBlock: (x, z) =>
    set((state) => {
      const activeBlocks = state.base.floors[state.activeFloorIndex].blocks;
      const last = activeBlocks[activeBlocks.length - 1];
      const width = 4;
      const depth = 4;
      const provisional: BaseBlock = {
        id: nanoid(),
        x: x ?? last.x + last.width / 2 + width / 2 + 2,
        z: z ?? last.z,
        width,
        depth,
        wallHeight: last.wallHeight,
        roofHeight: last.roofHeight,
        rotation: 0,
      };
      const newBlock: BaseBlock = {
        ...provisional,
        ...snapBlockPosition(provisional, activeBlocks),
      };
      return {
        base: {
          ...state.base,
          floors: updateActiveFloorBlocks(
            state.base.floors,
            state.activeFloorIndex,
            (blocks) => [...blocks, newBlock]
          ),
        },
      };
    }),
  addGarageBlock: (size, x, z) =>
    set((state) => {
      const activeBlocks = state.base.floors[state.activeFloorIndex].blocks;
      const last = activeBlocks[activeBlocks.length - 1];
      const preset = GARAGE_SIZES[size];
      const provisional: BaseBlock = {
        id: nanoid(),
        x: x ?? last.x + last.width / 2 + preset.width / 2 + 2,
        z: z ?? last.z,
        width: preset.width,
        depth: preset.depth,
        // Match the ground floor's existing wall/roof height (same pattern
        // as `addBlock`) rather than the size preset's own fixed values, so
        // the garage doesn't stick out at a mismatched height.
        wallHeight: last.wallHeight,
        roofHeight: last.roofHeight,
        rotation: 0,
        isGarage: true,
      };
      const newBlock: BaseBlock = {
        ...provisional,
        ...snapBlockPosition(provisional, activeBlocks),
      };
      return {
        base: {
          ...state.base,
          floors: updateActiveFloorBlocks(
            state.base.floors,
            state.activeFloorIndex,
            (blocks) => [...blocks, newBlock]
          ),
        },
      };
    }),
  addPolygonBlock: (preset, x, z) =>
    set((state) => {
      const activeBlocks = state.base.floors[state.activeFloorIndex].blocks;
      const last = activeBlocks[activeBlocks.length - 1];
      const polygon = POLYGON_PRESETS[preset].polygon;
      const box = polygonBoundingBox(polygon);
      const width = box.right - box.left;
      const depth = box.front - box.back;
      const provisional: BaseBlock = {
        id: nanoid(),
        x: x ?? last.x + last.width / 2 + width / 2 + 2,
        z: z ?? last.z,
        width,
        depth,
        wallHeight: last.wallHeight,
        roofHeight: last.roofHeight,
        rotation: 0,
        roofType: "flat",
        polygon,
      };
      const newBlock: BaseBlock = {
        ...provisional,
        ...snapBlockPosition(provisional, activeBlocks),
      };
      return {
        base: {
          ...state.base,
          floors: updateActiveFloorBlocks(
            state.base.floors,
            state.activeFloorIndex,
            (blocks) => [...blocks, newBlock]
          ),
        },
      };
    }),
  addSkylight: (blockId, slopeIndex) =>
    set((state) => addRoofSlotComponent(state, blockId, slopeIndex, "skylight", SKYLIGHT_RAISE) ?? state),
  addSolarPanel: (blockId, slopeIndex) =>
    set(
      (state) =>
        addRoofSlotComponent(state, blockId, slopeIndex, "solarPanel", SOLAR_PANEL_RAISE) ?? state
    ),
  addPorch: (blockId, side, porchDepth = 2.2) =>
    set((state) => {
      // Ground floor only — a porch roof/columns above floor 0 would be
      // hanging in mid-air with nothing structural connecting it downward.
      if (state.activeFloorIndex !== 0) return state;
      const blocks = state.base.floors[state.activeFloorIndex].blocks;
      const block = blocks.find((b) => b.id === blockId);
      if (!block) return state;

      const worldSide = localSideToWorldSide(block, side);
      const e = edges(block);
      const span = wallLength(block, worldSide);
      let x: number;
      let z: number;
      let width: number;
      let depth: number;
      let outerAxis: "x" | "z";
      let outerSign: 1 | -1;
      switch (worldSide) {
        case "front":
          x = block.x;
          z = e.front + porchDepth / 2;
          width = span;
          depth = porchDepth;
          outerAxis = "z";
          outerSign = 1;
          break;
        case "back":
          x = block.x;
          z = e.back - porchDepth / 2;
          width = span;
          depth = porchDepth;
          outerAxis = "z";
          outerSign = -1;
          break;
        case "left":
          x = e.left - porchDepth / 2;
          z = block.z;
          width = porchDepth;
          depth = span;
          outerAxis = "x";
          outerSign = -1;
          break;
        case "right":
          x = e.right + porchDepth / 2;
          z = block.z;
          width = porchDepth;
          depth = span;
          outerAxis = "x";
          outerSign = 1;
          break;
      }

      const newComponents = roofWithColumns(
        `porch-${nanoid()}`,
        state.activeFloorIndex,
        block.wallHeight,
        x,
        z,
        width,
        depth,
        outerAxis,
        outerSign
      );
      return { components: [...state.components, ...newComponents] };
    }),
  addBalcony: (blockId, side, balconyDepth = 1.5) =>
    set((state) => {
      const blocks = state.base.floors[state.activeFloorIndex].blocks;
      const block = blocks.find((b) => b.id === blockId);
      if (!block) return state;

      const slabThickness = FLAT_ROOF_THICKNESS;
      const [, railHeight, railThickness] = DEFAULT_SCALE.railing;
      const toWorld = ({ x, z }: { x: number; z: number }): { x: number; z: number } => {
        const [r] = rotatePolygon([{ x, z }], block.rotation);
        return { x: block.x + r.x, z: block.z + r.z };
      };

      // A balcony already on an ADJACENT wall of this same block merges
      // into one L-shaped balcony instead of adding a second, disconnected
      // one at the same corner (see PLAN.md §10's own follow-up note).
      // Deliberately only matches a *simple* (single-side) existing
      // balcony — merging a 3rd wall onto an already-merged L (a U-shape)
      // isn't supported yet, flagged in the plan rather than guessed at.
      const existing = state.components.find(
        (c) =>
          c.type === "balcony" &&
          c.floorIndex === state.activeFloorIndex &&
          c.balconyBlockId === blockId &&
          c.balconySides?.length === 1 &&
          adjacentBalconySides(c.balconySides[0], side) !== null
      );

      if (existing?.balconySides) {
        const existingSide = existing.balconySides[0];
        const adjacency = adjacentBalconySides(existingSide, side)!;
        // The existing balcony's own protrusion depth is whichever of its
        // scale components isn't the wall-span one — front/back arms are
        // [span, thickness, depth], left/right arms are [depth, thickness, span].
        const existingIsZArm = existingSide === "front" || existingSide === "back";
        const existingDepth = existingIsZArm ? existing.scale[2] : existing.scale[0];
        const xArmDepth = adjacency.xArmSide === existingSide ? existingDepth : balconyDepth;
        const zArmDepth = adjacency.zArmSide === existingSide ? existingDepth : balconyDepth;

        const { polygon: localPolygon, freeEdges } = mergeAdjacentBalconyFootprint(
          block.width,
          block.depth,
          adjacency.xArmSide,
          xArmDepth,
          adjacency.zArmSide,
          zArmDepth
        );

        const newRailings: PlacedComponent[] = freeEdges.map((_, i) => {
          const rail = railingForFreeEdge(localPolygon, i, railThickness);
          const worldPos = toWorld({ x: rail.x, z: rail.z });
          return {
            id: nanoid(),
            type: "railing",
            variant: "standard",
            floorIndex: state.activeFloorIndex,
            position: [worldPos.x, railHeight / 2, worldPos.z],
            rotation: [0, rail.rotationY + (block.rotation * Math.PI) / 180, 0],
            scale: [rail.span, railHeight, railThickness],
          };
        });

        const mergedSlab: PlacedComponent = {
          id: nanoid(),
          type: "balcony",
          variant: "standard",
          floorIndex: state.activeFloorIndex,
          // X/Z are unused for a polygon-footprint balcony — `polygon`
          // below is already absolute world coordinates (see `toWorld`).
          position: [0, -slabThickness / 2, 0],
          rotation: [0, 0, 0],
          scale: [1, slabThickness, 1],
          polygon: localPolygon.map(toWorld),
          balconyBlockId: blockId,
          balconySides: [existingSide, side],
          balconyRailingIds: newRailings.map((r) => r.id),
        };

        const removeIds = new Set([existing.id, ...(existing.balconyRailingIds ?? [])]);
        return {
          components: [
            ...state.components.filter((c) => !removeIds.has(c.id)),
            mergedSlab,
            ...newRailings,
          ],
        };
      }

      const worldSide = localSideToWorldSide(block, side);
      const e = edges(block);
      const span = wallLength(block, worldSide);
      let x: number;
      let z: number;
      let width: number;
      let depth: number;
      let outerAxis: "x" | "z";
      let outerSign: 1 | -1;
      switch (worldSide) {
        case "front":
          x = block.x;
          z = e.front + balconyDepth / 2;
          width = span;
          depth = balconyDepth;
          outerAxis = "z";
          outerSign = 1;
          break;
        case "back":
          x = block.x;
          z = e.back - balconyDepth / 2;
          width = span;
          depth = balconyDepth;
          outerAxis = "z";
          outerSign = -1;
          break;
        case "left":
          x = e.left - balconyDepth / 2;
          z = block.z;
          width = balconyDepth;
          depth = span;
          outerAxis = "x";
          outerSign = -1;
          break;
        case "right":
          x = e.right + balconyDepth / 2;
          z = block.z;
          width = balconyDepth;
          depth = span;
          outerAxis = "x";
          outerSign = 1;
          break;
      }

      const outerSize = outerAxis === "x" ? width : depth;
      const outerCenter = outerAxis === "x" ? x : z;
      const railOuterCoord = outerCenter + outerSign * (outerSize / 2 - railThickness / 2);
      const railSpan = outerAxis === "x" ? depth : width;
      const railRotationY = outerAxis === "x" ? Math.PI / 2 : 0;
      const railX = outerAxis === "x" ? railOuterCoord : x;
      const railZ = outerAxis === "x" ? z : railOuterCoord;

      const railingId = nanoid();
      const slab: PlacedComponent = {
        id: nanoid(),
        type: "balcony",
        variant: "standard",
        floorIndex: state.activeFloorIndex,
        position: [x, -slabThickness / 2, z],
        rotation: [0, 0, 0],
        scale: [width, slabThickness, depth],
        balconyBlockId: blockId,
        balconySides: [side],
        balconyRailingIds: [railingId],
      };
      const railing: PlacedComponent = {
        id: railingId,
        type: "railing",
        variant: "standard",
        floorIndex: state.activeFloorIndex,
        position: [railX, railHeight / 2, railZ],
        rotation: [0, railRotationY, 0],
        scale: [railSpan, railHeight, railThickness],
      };
      return { components: [...state.components, slab, railing] };
    }),
  updateBlock: (id, patch) =>
    set((state) => {
      const activeBlocks = state.base.floors[state.activeFloorIndex].blocks;
      const oldBlock = activeBlocks.find((b) => b.id === id);
      const blocks = activeBlocks.map((b) => {
        if (b.id !== id) {
          if (state.base.linkedRoofHeight && patch.roofHeight !== undefined) {
            return { ...b, roofHeight: patch.roofHeight };
          }
          return b;
        }
        const merged = { ...b, ...patch };
        if (
          patch.x !== undefined ||
          patch.z !== undefined ||
          patch.rotation !== undefined
        ) {
          const others = activeBlocks.filter((o) => o.id !== id);
          return { ...merged, ...snapBlockPosition(merged, others) };
        }
        return merged;
      });
      const newBlock = blocks.find((b) => b.id === id);
      const components =
        oldBlock && newBlock
          ? repositionWallComponents(state.components, oldBlock, newBlock)
          : state.components;
      return {
        base: {
          ...state.base,
          floors: updateActiveFloorBlocks(
            state.base.floors,
            state.activeFloorIndex,
            () => blocks
          ),
        },
        components,
      };
    }),
  removeBlock: (id) =>
    set((state) => {
      const activeBlocks = state.base.floors[state.activeFloorIndex].blocks;
      if (activeBlocks.length <= 1) return state;
      return {
        base: {
          ...state.base,
          floors: updateActiveFloorBlocks(
            state.base.floors,
            state.activeFloorIndex,
            (blocks) => blocks.filter((b) => b.id !== id)
          ),
        },
        selectedBlockId:
          state.selectedBlockId === id ? null : state.selectedBlockId,
      };
    }),
  duplicateBlock: (id) =>
    set((state) => {
      const activeBlocks = state.base.floors[state.activeFloorIndex].blocks;
      const source = activeBlocks.find((b) => b.id === id);
      if (!source) return state;
      const provisional: BaseBlock = {
        ...source,
        id: nanoid(),
        x: source.x + source.width / 2 + 2,
      };
      const newBlock: BaseBlock = {
        ...provisional,
        ...snapBlockPosition(provisional, activeBlocks),
      };
      return {
        base: {
          ...state.base,
          floors: updateActiveFloorBlocks(
            state.base.floors,
            state.activeFloorIndex,
            (blocks) => [...blocks, newBlock]
          ),
        },
        selectedBlockId: newBlock.id,
      };
    }),
  duplicateBlockToFloorAbove: (id) =>
    set((state) => {
      // Factory halls are always single-story — there's never a floor above.
      const maxAllowed =
        state.base.buildingType === "factoryHall" ? MIN_FLOORS : MAX_FLOORS;
      const activeBlocks = state.base.floors[state.activeFloorIndex].blocks;
      const source = activeBlocks.find((b) => b.id === id);
      if (!source) return state;
      const targetFloorIndex = state.activeFloorIndex + 1;
      if (targetFloorIndex >= maxAllowed) return state;

      const newBlock: BaseBlock = { ...source, id: nanoid() };
      let floors = state.base.floors;
      if (targetFloorIndex >= floors.length) {
        floors = [...floors, { id: nanoid(), blocks: [newBlock] }];
      } else {
        floors = floors.map((f, i) =>
          i === targetFloorIndex ? { ...f, blocks: [...f.blocks, newBlock] } : f
        );
      }

      // Bring the block's own components along too: wall-mounted ones
      // (door/window/opening/railing) via wallRef, freestanding ones
      // (canopy roofSection, corner columns) via footprint containment —
      // those have no wallRef to key off, so a margin around the block's
      // edges catches the columns/canopies templates place just outside them.
      const blockEdges = edges(source);
      const margin = 3;
      const ownComponents = state.components.filter((c) => {
        if (c.floorIndex !== state.activeFloorIndex) return false;
        if (c.wallRef) return c.wallRef.blockId === source.id;
        const [x, , z] = c.position;
        return (
          x >= blockEdges.left - margin &&
          x <= blockEdges.right + margin &&
          z >= blockEdges.back - margin &&
          z <= blockEdges.front + margin
        );
      });
      const duplicatedComponents = ownComponents.map((c) => ({
        ...c,
        id: nanoid(),
        floorIndex: targetFloorIndex,
        wallRef: c.wallRef ? { ...c.wallRef, blockId: newBlock.id } : undefined,
      }));

      return {
        base: { ...state.base, floors },
        components: [...state.components, ...duplicatedComponents],
        activeFloorIndex: targetFloorIndex,
        selectedBlockId: newBlock.id,
        selectedIds: [],
      };
    }),
  selectBlock: (id) => set({ selectedBlockId: id }),
  addComponent: (type, position, variant = "standard") =>
    set((state) => {
      const id = nanoid();
      const activeBlocks = state.base.floors[state.activeFloorIndex].blocks;
      const [px, py, pz] = position ?? [0, 0, 0];
      // Width doesn't depend on wallHeight for any variant (only height
      // does) — safe to resolve it before wallHeight is known (which in
      // turn depends on which wall this snaps to) with a placeholder.
      const width = resolveComponentSize(type, variant, 3).scale[0];
      const sameFloorComponents = state.components.filter(
        (c) => c.floorIndex === state.activeFloorIndex
      );
      const isTopFloor = state.activeFloorIndex === state.base.floors.length - 1;
      const { position: snappedXZ, rotationY, wallRef } = snapComponentToWalls(
        [px, py, pz],
        activeBlocks,
        type,
        width,
        sameFloorComponents,
        state.base.roofType,
        isTopFloor
      );
      const wallBlock = activeBlocks.find((b) => b.id === wallRef?.blockId);
      const wallHeight = wallBlock?.wallHeight ?? activeBlocks[0]?.wallHeight ?? 3;
      const { scale, centerY } = resolveComponentSize(type, variant, wallHeight);

      // A gable candidate's height/width both need one more clamp beyond
      // what snapComponentToWalls could check — it only validated the raw
      // click point, since the component's actual final width/height (from
      // resolveComponentSize, just above) wasn't known yet at that point.
      let finalCenterY = centerY;
      let finalPositionXZ = snappedXZ;
      let finalWallRef = wallRef ?? undefined;
      if (wallRef?.gable && wallBlock) {
        const span = wallLength(wallBlock, wallRef.location);
        const clickV = py - wallHeight;
        const { offset, centerV } = clampComponentToGable(
          span,
          wallBlock.roofHeight,
          wallRef.offset,
          scale[0],
          clickV,
          scale[1]
        );
        finalCenterY = wallHeight + centerV;
        finalWallRef = { ...wallRef, offset };
        const { x, z } = alongWallPosition(wallBlock, wallRef.location, offset, type, true);
        finalPositionXZ = [x, 0, z];
      }

      const component: PlacedComponent = {
        id,
        type,
        floorIndex: state.activeFloorIndex,
        variant,
        position: [finalPositionXZ[0], finalCenterY, finalPositionXZ[2]],
        rotation: [0, rotationY ?? 0, 0],
        scale,
        wallRef: finalWallRef,
        doorStyle: type === "door" ? defaultDoorStyle(variant) : undefined,
      };
      return {
        components: [...state.components, component],
        selectedIds: [id],
      };
    }),
  addImportedModel: (dataUrl, format, fileName, position) =>
    set((state) => {
      const id = nanoid();
      const [px, , pz] = position ?? [0, 0, 0];
      const component: PlacedComponent = {
        id,
        type: "model",
        floorIndex: state.activeFloorIndex,
        variant: "standard",
        // y=0: ImportedModel.tsx rests the loaded geometry's own bounding
        // box on this floor once it actually knows the box (see its own
        // comment) — there's no sensible height to pick before that.
        position: [px, 0, pz],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        modelData: dataUrl,
        modelFormat: format,
        modelName: fileName,
      };
      return {
        components: [...state.components, component],
        selectedIds: [id],
      };
    }),
  updateComponent: (id, patch) =>
    set((state) => ({
      components: state.components.map((c) =>
        c.id === id ? { ...c, ...patch } : c
      ),
    })),
  removeComponent: (id) =>
    set((state) => ({
      components: state.components.filter((c) => c.id !== id),
      selectedIds: state.selectedIds.filter((s) => s !== id),
    })),
  duplicateComponent: (id) =>
    set((state) => {
      const source = state.components.find((c) => c.id === id);
      if (!source) return state;
      const newId = nanoid();
      const [x, y, z] = source.position;
      const duplicate: PlacedComponent = {
        ...source,
        id: newId,
        position: [x + 0.5, y, z + 0.5],
      };
      return {
        components: [...state.components, duplicate],
        selectedIds: [newId],
      };
    }),
  duplicateComponentToFloorAbove: (id) =>
    set((state) => duplicateComponentsToFloorAbove(state, [id]) ?? state),
  duplicateSelectedComponentsToFloorAbove: () =>
    set((state) => duplicateComponentsToFloorAbove(state, state.selectedIds) ?? state),
  duplicateComponentToAllFloorsAbove: (id) =>
    set((state) => duplicateComponentsToAllFloorsAbove(state, [id]) ?? state),
  duplicateSelectedComponentsToAllFloorsAbove: () =>
    set((state) => duplicateComponentsToAllFloorsAbove(state, state.selectedIds) ?? state),
  mirrorComponentToOppositeWall: (id) =>
    set((state) => {
      const source = state.components.find((c) => c.id === id);
      if (!source?.wallRef) return state;
      // No "opposite edge" concept for a polygon block (PLAN.md §6) — only
      // a rectangle's 4 named sides pair up naturally.
      if (source.wallRef.location.kind !== "side") return state;
      const block = state.base.floors[source.floorIndex]?.blocks.find(
        (b) => b.id === source.wallRef!.blockId
      );
      if (!block) return state;

      const location: WallLocation = {
        kind: "side",
        side: oppositeWallSide(source.wallRef.location.side),
      };
      const { x, z, rotationY } = alongWallPosition(
        block,
        location,
        source.wallRef.offset,
        source.type,
        source.wallRef.gable ?? false
      );
      const newId = nanoid();
      const mirrored: PlacedComponent = {
        ...source,
        id: newId,
        position: [x, source.position[1], z],
        rotation: [source.rotation[0], rotationY, source.rotation[2]],
        wallRef: {
          blockId: block.id,
          location,
          offset: source.wallRef.offset,
          gable: source.wallRef.gable,
        },
      };
      return {
        components: [...state.components, mirrored],
        selectedIds: [newId],
      };
    }),
  rotateComponent: (id, direction) =>
    set((state) => ({
      components: state.components.map((c) =>
        c.id === id
          ? {
              ...c,
              rotation: [
                c.rotation[0],
                c.rotation[1] + direction * (Math.PI / 2),
                c.rotation[2],
              ],
            }
          : c
      ),
    })),
  rotateSelectedComponents: (direction) =>
    set((state) => ({
      components: state.components.map((c) =>
        state.selectedIds.includes(c.id)
          ? {
              ...c,
              rotation: [
                c.rotation[0],
                c.rotation[1] + direction * (Math.PI / 2),
                c.rotation[2],
              ],
            }
          : c
      ),
    })),
  centerSelectedComponentsHorizontally: () =>
    set((state) => {
      const selected = state.components.filter((c) =>
        state.selectedIds.includes(c.id)
      );
      if (selected.length < 2) return state;

      const firstWallRef = selected[0].wallRef;
      const sameWall =
        !!firstWallRef &&
        selected.every(
          (c) =>
            c.wallRef?.blockId === firstWallRef.blockId &&
            JSON.stringify(c.wallRef?.location) === JSON.stringify(firstWallRef.location)
        );

      if (sameWall) {
        const { blockId, location } = firstWallRef!;
        const floorIndex = selected[0].floorIndex;
        const block = state.base.floors[floorIndex]?.blocks.find(
          (b) => b.id === blockId
        );
        if (!block) return state;
        const length = wallLength(block, location);
        const sorted = [...selected].sort(
          (a, b) => a.wallRef!.offset - b.wallRef!.offset
        );
        const spacing = length / (sorted.length + 1);
        const updates = new Map(
          sorted.map((c, i) => {
            const offset = spacing * (i + 1);
            const { x, z, rotationY } = alongWallPosition(
              block,
              location,
              offset,
              c.type,
              c.wallRef!.gable ?? false
            );
            return [
              c.id,
              {
                position: [x, c.position[1], z] as [number, number, number],
                rotation: [c.rotation[0], rotationY, c.rotation[2]] as [
                  number,
                  number,
                  number
                ],
                wallRef: { ...c.wallRef!, offset },
              },
            ];
          })
        );
        return {
          components: state.components.map((c) =>
            updates.has(c.id) ? { ...c, ...updates.get(c.id)! } : c
          ),
        };
      }

      const sorted = [...selected].sort((a, b) => a.position[0] - b.position[0]);
      const minX = sorted[0].position[0];
      const maxX = sorted[sorted.length - 1].position[0];
      const centerX = (minX + maxX) / 2;
      const span = maxX - minX;
      const spacing = sorted.length > 1 ? span / (sorted.length - 1) : 0;
      const startX = centerX - span / 2;
      const updates = new Map(
        sorted.map((c, i) => [
          c.id,
          [startX + spacing * i, c.position[1], c.position[2]] as [
            number,
            number,
            number
          ],
        ])
      );
      return {
        components: state.components.map((c) =>
          updates.has(c.id) ? { ...c, position: updates.get(c.id)! } : c
        ),
      };
    }),
  repeatComponentAlongWall: (id, count) =>
    set((state) => {
      const source = state.components.find((c) => c.id === id);
      if (!source?.wallRef || count < 1) return state;
      const { blockId, location } = source.wallRef;
      const block = state.base.floors[source.floorIndex]?.blocks.find(
        (b) => b.id === blockId
      );
      if (!block) return state;

      const span = wallLength(block, location);
      const spacing = span / (count + 1);
      const gable = source.wallRef.gable ?? false;
      const copies: PlacedComponent[] = Array.from({ length: count }, (_, i) => {
        const offset = spacing * (i + 1);
        const { x, z, rotationY } = alongWallPosition(block, location, offset, source.type, gable);
        return {
          ...source,
          id: nanoid(),
          position: [x, source.position[1], z],
          rotation: [source.rotation[0], rotationY, source.rotation[2]],
          wallRef: { ...source.wallRef!, offset },
        };
      });
      return {
        components: [...state.components.filter((c) => c.id !== id), ...copies],
        selectedIds: copies.map((c) => c.id),
      };
    }),
  selectComponent: (id) => set({ selectedIds: id ? [id] : [] }),
  toggleComponentSelection: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((s) => s !== id)
        : [...state.selectedIds, id],
    })),
  removeSelectedComponents: () =>
    set((state) => ({
      components: state.components.filter(
        (c) => !state.selectedIds.includes(c.id)
      ),
      selectedIds: [],
    })),
  setTransparentWalls: (value) => set({ transparentWalls: value }),
  setLightingPreset: (preset) => set({ lightingPreset: preset }),
  setLinkedRoofHeight: (linked) =>
    set((state) => {
      if (!linked) return { base: { ...state.base, linkedRoofHeight: false } };
      const activeBlocks = state.base.floors[state.activeFloorIndex].blocks;
      const roofHeight = activeBlocks[0]?.roofHeight ?? 1.5;
      return {
        base: {
          ...state.base,
          linkedRoofHeight: true,
          floors: updateActiveFloorBlocks(
            state.base.floors,
            state.activeFloorIndex,
            (blocks) => blocks.map((b) => ({ ...b, roofHeight }))
          ),
        },
      };
    }),
  setBuildingType: (type) =>
    set((state) => {
      if (type === state.base.buildingType) return state;
      const { floorsByType, componentsByType } = snapshotCurrentTypeMaps(state);
      return {
        base: {
          ...state.base,
          buildingType: type,
          floors: floorsByType[type] ?? defaultFloorsFor(type),
          wallMaterialId: DEFAULT_WALL_MATERIAL[type],
          roofMaterialId: DEFAULT_ROOF_MATERIAL[type],
        },
        floorsByType,
        componentsByType,
        components: componentsByType[type] ?? [],
        activeFloorIndex: 0,
        selectedBlockId: null,
        selectedIds: [],
      };
    }),
  loadTemplate: (base, components) =>
    set((state) => {
      const snapshot = snapshotCurrentTypeMaps(state);
      const floorsByType = { ...snapshot.floorsByType, [base.buildingType]: base.floors };
      const componentsByType = {
        ...snapshot.componentsByType,
        [base.buildingType]: components,
      };
      return {
        base,
        components,
        floorsByType,
        componentsByType,
        activeFloorIndex: 0,
        selectedBlockId: null,
        selectedIds: [],
      };
    }),
  rotateAllBlocks: (direction) =>
    set((state) => {
      const floors = state.base.floors;
      const allBlocks = floors.flatMap((f) => f.blocks);
      if (allBlocks.length === 0) return state;
      // One shared pivot for every floor (the whole building's combined
      // footprint, not each floor's own) — so upper floors turn together
      // with the ground floor as one rigid building, instead of drifting
      // out of alignment with whatever's below them.
      const { centerX: pivotX, centerZ: pivotZ } = overallFootprint(allBlocks);
      const step = direction > 0 ? 90 : -90;
      const rotateBlock = (b: BaseBlock): BaseBlock => {
        const dx = b.x - pivotX;
        const dz = b.z - pivotZ;
        const [rx, rz] = direction > 0 ? [dz, -dx] : [-dz, dx];
        const rotation = ((((b.rotation + step) % 360) + 360) %
          360) as BlockRotation;
        return { ...b, x: pivotX + rx, z: pivotZ + rz, rotation };
      };
      let components = state.components;
      const rotatedFloors = floors.map((floor) => {
        const rotatedBlocks = floor.blocks.map(rotateBlock);
        floor.blocks.forEach((oldBlock, i) => {
          components = repositionWallComponents(components, oldBlock, rotatedBlocks[i]);
        });
        return { ...floor, blocks: rotatedBlocks };
      });
      return {
        base: { ...state.base, floors: rotatedFloors },
        components,
      };
    }),
}));

// Records a history entry whenever base or components actually changes
// (reference inequality — every action above replaces rather than mutates
// them), except during undo/redo itself. Kept outside the store definition
// since it needs to observe every action generically rather than have each
// one remember to record history individually.
useConfiguratorStore.subscribe((state, prevState) => {
  if (isTimeTraveling) return;
  if (state.base === prevState.base && state.components === prevState.components) {
    return;
  }
  history.push({ base: prevState.base, components: prevState.components });
  useConfiguratorStore.setState({
    canUndo: history.canUndo,
    canRedo: history.canRedo,
  });
});
