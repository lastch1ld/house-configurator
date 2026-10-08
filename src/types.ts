import { FLAT_ROOF_THICKNESS } from "./constants";

export type ComponentType =
  | "door"
  | "window"
  | "column"
  | "table"
  | "beam"
  | "opening"
  | "roofSection"
  | "wallSection"
  | "railing"
  | "skylight"
  /** A raised roof-mounted solar panel — same "sits proud of the roof
   * surface" placement as `skylight` (see `computeRoofComponentPlacement`
   * in floorDuplication.ts), but a flat frame+panel rather than a glazed
   * box, and freely resizable (width/depth) via the Inspector rather than
   * a fixed footprint. */
  | "solarPanel"
  /** Factory-hall only: an overhead sheet-metal duct run with joint bands
   * and ceiling hangers (see `DuctingDetails` in PlacedComponents.tsx). */
  | "ducting"
  /** Factory-hall only: a guardrail meant for near-roof/catwalk use — same
   * rendering as `railing` (reuses RailingDetails) but a separate type so
   * it gets its own context-menu entry and default near-ceiling placement. */
  | "underroofRailing"
  /** Factory-hall only: a diagonal steel cross-brace (an "X" within its own
   * bounding envelope — see `BracingDetails`), the kind of stabilizing
   * structure a steel-frame hall's bays typically have. */
  | "bracing"
  /** A ground-level swimming pool — a rim/curb envelope with a flat
   * water-colored top face (see `PoolDetails` in PlacedComponents.tsx), no
   * real-time reflection/refraction. Freestanding only, same placement as
   * `table`/`column`. */
  | "pool"
  /** A single straight flight of steps between two floors — see `Stairs`
   * in porch.ts and `addStairs` in store.ts. Freestanding only. */
  | "stairs"
  /** A cantilevered slab extending from a wall with a railing along its
   * free (outward) edge, rendered as one component rather than a
   * `roofSection` + `railing` hand-paired separately — see `addBalcony`
   * in store.ts. Wall-anchored the same way a porch is. */
  | "balcony"
  /** A user-imported 3D model (see modelImport.ts/ImportedModel.tsx) —
   * unlike every other type, its actual geometry isn't parametric/known
   * ahead of time, it's whatever file the rep uploaded. Freestanding only
   * (no wall-snapping), rendered via its own component. */
  | "model";

/** Which 3D file formats can be imported as a "model" component — see
 * modelImport.ts for the loader behind each. */
export type ModelFormat = "obj" | "gltf" | "glb" | "fbx" | "stl" | "dae" | "ply" | "3ds";

/** A size/shape preset within a component type. "standard" is every type's
 * default; the rest apply only to door/window (enforced by which
 * COMPONENT_LIBRARY entries reference them, not by this type itself). */
export type ComponentVariant =
  | "standard"
  | "fullHeight"
  | "threeQuarter"
  | "double"
  | "hangar"
  | "garage"
  /** A house entry door — taller/wider than "standard" (which now reads as
   * an interior/side door) and defaults to the "glazed" DoorStyle so it
   * looks like a proper front entrance out of the box, not a plain slab. */
  | "frontDoor"
  /** Table-only: a round tabletop on a single pedestal leg instead of the
   * rectangular top on four legs "standard" uses. */
  | "round"
  /** Table-only: a wider, shallower rectangular top — reads as a desk/
   * console rather than a dining table. */
  | "desk";

export type BlockRotation = 0 | 90 | 180 | 270;

/** A door's visual style — independent of `ComponentVariant`, which
 * controls its size/shape (standard/double/garage/hangar). "flush" is a
 * plain modern slab with one recessed panel; "paneled" is a classic 2×3
 * raised-panel look; "glazed" is "flush" with a small window lite inset near
 * the top. Doesn't apply to the "garage"/"hangar" variants, which always
 * render ribbed regardless of this field. */
export type DoorStyle = "flush" | "paneled" | "glazed";

/** A window/skylight's frame finish — independent of `ComponentVariant`.
 * Doesn't apply to "fullHeight" windows, which are always frameless. */
export type GlazingFinish = "anthracite" | "white";

/** Which local axis a gable roof's ridge runs along. "x" (the default) runs
 * the ridge along width with slopes descending along depth — the original,
 * only behavior before this flag existed. "z" runs the ridge along depth
 * with slopes descending along width, i.e. the roof turned 90° without
 * rotating the block's walls/openings. Unused when roofType is "flat". */
export type RidgeAxis = "x" | "z";

/** Which usable roof face a skylight/solar panel is anchored to
 * (`computeRoofComponentPlacement` in floorDuplication.ts) — 0/1 for a
 * gable's two slopes, always 0 for mono-pitch/flat's one, and 0-3 for a
 * hip roof's 4 faces (`hipRoofFaces` in hipRoofGeometry.ts: front/back/
 * right/left, in that order). */
export type RoofSlopeIndex = 0 | 1 | 2 | 3;

export interface BaseBlock {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  wallHeight: number;
  /** Gable ridge height above the wall top; unused when roofType is "flat". */
  roofHeight: number;
  /** Quarter-turn rotation about the block's center. 90/270 swap the effective world width/depth. */
  rotation: BlockRotation;
  /** Defaults to "x" when unset (blocks created before this flag existed). */
  ridgeAxis?: RidgeAxis;
  /** A garage never auto-joins into whatever wall it ends up touching —
   * whichever side snaps flush against another block stays solid, so it
   * remains a separate enclosed room entered through its own door (see
   * `getBlockOpenings` in baseGeometry.ts). */
  isGarage?: boolean;
  /** Overrides the building-wide roofType (base.roofType) for just this
   * block — lets one wing be gable and another flat on the same connected
   * house (common in real builds: a pitched main volume with a flat-roofed
   * extension). Falls back to base.roofType when unset, same
   * inherit-unless-overridden pattern as wallMaterialId/roofMaterialId/
   * wallColor below. */
  roofType?: RoofType;
  /** Overrides base.wallMaterialId for just this block — e.g. a stone
   * ground floor under a timber-clad upper floor. Falls back to the
   * building default when unset. */
  wallMaterialId?: string;
  /** Overrides base.roofMaterialId for just this block. Falls back to the
   * building default when unset. */
  roofMaterialId?: string;
  /** Overrides base.wallColor for just this block (only visible when the
   * resolved wall material is tintable — see materials.ts). Falls back to
   * the building default when unset. */
  wallColor?: string;
  /** Partial notches within this block's own walls — a sub-range of one
   * wall's span sits further in than the rest of that wall, connected by
   * two short perpendicular return-wall jogs (see `wallDepthSegments` in
   * baseGeometry.ts). Named the same local way as `WallSide` (front/back/
   * left/right always mean the same physical wall, unaffected by
   * `rotation` — see Base.tsx's `local` openings for why this is safe to
   * keep local-native rather than world-space like `WallRef`). Doesn't
   * change the block's own overall footprint corners — only that wall's
   * own surface steps in locally (roof/floor slab/adjacency/corner posts
   * are untouched). */
  wallRecesses?: WallRecess[];
  /** Opt-in free-form footprint (PLAN.md §6, Phase A) — an ordered,
   * closed, counter-clockwise polygon in the block's own local space
   * (meters from the block's own center, pre-rotation — the same frame
   * `wallPanels`/`WallRecess.from`/`to` already use), at least 3
   * vertices, no self-intersection. When set, this is the block's real
   * shape and `width`/`depth` become derived (the polygon's own local
   * bounding box, recomputed by `setBlockPolygon` in store.ts whenever
   * the polygon changes) rather than independently meaningful — kept in
   * sync anyway so every bounding-box-only consumer (`overallFootprint`,
   * `snapBlockPosition`, camera framing) keeps working without knowing a
   * polygon exists at all. Phase A only: no wall-anchored components
   * (doors/windows/porches/balconies/recesses), no gable/hip/mono-pitch
   * roof, no block-to-block auto-doorway — see PLAN.md §6 for why each of
   * those is deferred to Phase B/C rather than attempted here. */
  polygon?: PolygonVertex[];
}

/** A single point of a `BaseBlock.polygon` — see that field's own doc for
 * the coordinate frame. */
export interface PolygonVertex {
  x: number;
  z: number;
}

/** One partial notch within a block's own wall — see `BaseBlock.wallRecesses`.
 * `from`/`to` are raw local coordinates along that wall's own span, in the
 * same frame `wallPanels`' `fullMin`/`fullMax` use (front/back run
 * -width/2..width/2, left/right run -depth/2..depth/2) — not the
 * corner-relative 0..span convention `WallRef.offset` uses, since this
 * only ever needs to feed straight into local rendering, never round-trip
 * through world space. */
export interface WallRecess {
  side: WallSide;
  from: number;
  to: number;
  /** How far this segment steps back from the wall's normal outer plane, in meters. */
  depth: number;
}

export type GarageSize = "small" | "medium" | "large";

export const GARAGE_SIZES: Record<
  GarageSize,
  { width: number; depth: number; wallHeight: number; roofHeight: number }
> = {
  small: { width: 3, depth: 6, wallHeight: 2.5, roofHeight: 1 },
  medium: { width: 3.5, depth: 6.5, wallHeight: 2.5, roofHeight: 1.1 },
  large: { width: 6, depth: 6.5, wallHeight: 2.8, roofHeight: 1.2 },
};

export type RoofType = "gable" | "flat" | "monoPitch" | "hip";
export type BuildingType = "house" | "factoryHall";
/** Every HDRI environment drei ships (see @react-three/drei's
 * environment-assets) — used both for edit-mode lighting (background
 * hidden, only affects light/reflections) and preview-mode's visible
 * backdrop (see previewMode in store.ts). */
export type LightingPreset =
  | "dawn"
  | "park"
  | "sunset"
  | "city"
  | "forest"
  | "warehouse"
  | "apartment"
  | "studio"
  | "night"
  | "lobby";

/** One level of a building. Each floor has its own independent footprint —
 * it isn't forced to share the blocks/shape of the floor below it. */
export interface Floor {
  id: string;
  blocks: BaseBlock[];
}

export interface BaseConfig {
  roofType: RoofType;
  buildingType: BuildingType;
  /** When true, editing one block's roofHeight applies it to every block
   * on the same floor. */
  linkedRoofHeight: boolean;
  /** Stacked bottom-to-top; only the last floor gets a roof (the rest get a
   * flat slab ceiling instead — see `floorBaseY` in baseGeometry.ts). */
  floors: Floor[];
  /** Keys into materials.ts's WALL_MATERIALS/ROOF_MATERIALS catalogs. Kept
   * as plain strings here (rather than importing those types) to avoid a
   * circular import between this domain-types module and the materials one. */
  wallMaterialId: string;
  roofMaterialId: string;
  /** Hex tint applied to the wall material's texture, e.g. "#e7e2d6" — only
   * has a visible effect when the current wallMaterialId's MaterialDef is
   * `tintable` (currently just "plaster"; see materials.ts). Optional (not
   * present on a build saved before this field existed) so persistence.ts's
   * schema validation doesn't reject an otherwise-valid older saved build
   * over one missing cosmetic field — falls back to DEFAULT_WALL_COLOR. */
  wallColor?: string;
}

export const BUILDING_PRESETS: Record<
  BuildingType,
  { wallHeight: number; width: number; depth: number }
> = {
  house: { wallHeight: 3, width: 6, depth: 8 },
  factoryHall: { wallHeight: 6, width: 12, depth: 24 },
};

export type WallSide = "front" | "back" | "left" | "right";

/** Which physical wall a `WallRef` points at. `{kind:"side"}` is every
 * rectangle block's own 4 named walls (unchanged from before PLAN.md §6
 * Phase B). `{kind:"edge"}` is a polygon block's own edge *index* — edge
 * *i* runs from `BaseBlock.polygon[i]` to `polygon[(i+1) % polygon.length]`.
 * Unlike `WallSide`, an edge index needs no local/world rotation
 * conversion (`localSideToWorldSide`/`worldSideToLocalSide`): a polygon's
 * own vertex list is already local-native (rotated into world space by
 * the block's `<group rotation>` at render time, same as
 * `BaseBlock.wallRecesses`), so edge *i* means the same physical wall
 * regardless of the block's current rotation. */
export type WallLocation = { kind: "side"; side: WallSide } | { kind: "edge"; index: number };

export interface WallRef {
  blockId: string;
  location: WallLocation;
  /** Distance along the wall from its start corner/vertex, in meters. */
  offset: number;
  /** True when this component sits in the gable's triangular region above
   * this wall (only meaningful for a "gable" roofType, and only on
   * whichever two sides the ridge is perpendicular to — see isGableSide in
   * gableGeometry.ts) rather than the ordinary rectangular wall area below
   * wallHeight. Reuses `location`/`offset` as-is (the gable triangle is
   * directly, coplanar-ly above that same wall) — only the component's own
   * `position[1]` (height above the eave) and its clamped width differ.
   * Never true for a `{kind:"edge"}` location — Phase A/B don't support
   * gable roofs on polygon blocks (see PLAN.md §6). */
  gable?: boolean;
}

export interface PlacedComponent {
  id: string;
  type: ComponentType;
  /** Which floor this component belongs to (index into `BaseConfig.floors`).
   * Needed independent of `wallRef.blockId` because a freestanding
   * component (column/beam/table) has no block to derive it from. */
  floorIndex: number;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  /** Which size/shape preset this instance uses; defaults to "standard" for
   * components created before variants existed. */
  variant?: ComponentVariant;
  /** Which wall this component is snapped to, if any — enables the
   * position-along-wall slider and mirror-to-opposite-wall action. */
  wallRef?: WallRef;
  /** Door-only; defaults to "flush" when unset. Ignored for
   * "garage"/"hangar" variants (always ribbed). */
  doorStyle?: DoorStyle;
  /** Window/skylight-only; defaults to "anthracite" when unset. Ignored for
   * "fullHeight" windows (always frameless). */
  glazingFinish?: GlazingFinish;
  /** Ducting-only: where its two ceiling-hanger straps attach, as a
   * fraction (0-1) along its own length — defaults to [0.12, 0.88] when
   * unset. Stored as fractions (not meters) so they stay sensible after
   * the Length field resizes the duct, rather than needing to be
   * re-clamped/rescaled. */
  ductHangers?: [number, number];
  /** Skylight/solar-panel-only: which block/slope this component was
   * placed on (see `addSkylight`/`addSolarPanel` in store.ts) — lets those
   * actions refuse a second one on a slope that already has one, and lets
   * `duplicateComponentsToFloorAbove` re-anchor the copy to the matching
   * slope on the floor above instead of reusing the source's baked
   * position/rotation verbatim (which only happens to be right if the
   * floor above has an identical block at that same footprint). */
  roofSlot?: { blockId: string; slopeIndex: RoofSlopeIndex };
  /** "model"-only: the imported file's own bytes, as a data URL — stored
   * inline (rather than an in-memory-only blob URL) so an imported model
   * survives a save/reload the same way the rest of a build does. Can be
   * sizable; a build with several large imports may approach localStorage's
   * per-origin quota (see saveBuild in persistence.ts). */
  modelData?: string;
  /** "model"-only: which loader modelData needs — see modelImport.ts. */
  modelFormat?: ModelFormat;
  /** "model"-only: the original file name, shown in the Inspector so a rep
   * can tell imported models apart. */
  modelName?: string;
  /** "balcony"-only: overrides the plain box (`scale`) with an arbitrary
   * footprint — used for a merged L-shaped balcony spanning two adjacent
   * walls (see `mergeAdjacentBalconyFootprint` in balconyGeometry.ts and
   * `addBalcony` in store.ts). Local space, same frame `BaseBlock.polygon`
   * uses. Unset for a simple single-wall balcony, which stays a plain box. */
  polygon?: PolygonVertex[];
  /** "balcony"-only: the block this balcony is attached to — balconies
   * don't carry a `wallRef` (see `addBalcony` in store.ts, same
   * no-`wallRef` precedent `addPorch` already set), so this is their own,
   * separate link back to a block; needed to find "another balcony on
   * this same block's adjacent wall" for a merge, and to distinguish two
   * unrelated blocks that happen to be positioned near each other. */
  balconyBlockId?: string;
  /** "balcony"-only: which of the block's own local walls this balcony
   * (simple or merged) occupies — lets a later `addBalcony` call on an
   * adjacent wall find and merge with it instead of adding a second,
   * disconnected balcony at the same corner. */
  balconySides?: WallSide[];
  /** "balcony"-only: the id(s) of this balcony's own paired `railing`
   * component(s) (1 for a simple balcony, up to 4 for a merged L-shape) —
   * lets a later merge remove exactly this balcony's own railings along
   * with its slab, rather than guessing by position. */
  balconyRailingIds?: string[];
}

export interface ComponentLibraryEntry {
  type: ComponentType;
  variant: ComponentVariant;
  label: string;
}

/** The house "Add component" menu — a real separate list from
 * `FACTORY_HALL_COMPONENT_LIBRARY`, not one shared array filtered by a tag.
 * A few entries (window/column/beam/table/opening/roofSection/wallSection/
 * railing) happen to have the same shape in both lists — that's a
 * coincidence of what a building needs, not a shared source of truth, so
 * each list edits independently of the other. */
export const HOUSE_COMPONENT_LIBRARY: ComponentLibraryEntry[] = [
  { type: "door", variant: "frontDoor", label: "Front Door" },
  { type: "door", variant: "standard", label: "Door" },
  { type: "door", variant: "double", label: "Double Door" },
  { type: "door", variant: "garage", label: "Garage Door" },
  { type: "window", variant: "standard", label: "Window" },
  { type: "window", variant: "fullHeight", label: "Full-Height Window" },
  { type: "window", variant: "threeQuarter", label: "3/4 Window" },
  { type: "column", variant: "standard", label: "Column" },
  { type: "beam", variant: "standard", label: "Beam" },
  { type: "table", variant: "standard", label: "Table" },
  { type: "table", variant: "round", label: "Round Table" },
  { type: "table", variant: "desk", label: "Desk" },
  { type: "opening", variant: "standard", label: "Opening" },
  { type: "roofSection", variant: "standard", label: "Roof Section" },
  { type: "wallSection", variant: "standard", label: "Wall Section" },
  { type: "railing", variant: "standard", label: "Railing" },
  { type: "pool", variant: "standard", label: "Pool" },
  { type: "stairs", variant: "standard", label: "Stairs" },
];

/** The factory-hall "Add component" menu — see `HOUSE_COMPONENT_LIBRARY`. */
export const FACTORY_HALL_COMPONENT_LIBRARY: ComponentLibraryEntry[] = [
  { type: "door", variant: "standard", label: "Door" },
  { type: "door", variant: "double", label: "Double Door" },
  { type: "door", variant: "hangar", label: "Hangar Door" },
  { type: "window", variant: "standard", label: "Window" },
  { type: "window", variant: "fullHeight", label: "Full-Height Window" },
  { type: "window", variant: "threeQuarter", label: "3/4 Window" },
  { type: "column", variant: "standard", label: "Column" },
  { type: "beam", variant: "standard", label: "Beam" },
  { type: "table", variant: "standard", label: "Table" },
  { type: "table", variant: "round", label: "Round Table" },
  { type: "table", variant: "desk", label: "Desk" },
  { type: "opening", variant: "standard", label: "Opening" },
  { type: "roofSection", variant: "standard", label: "Roof Section" },
  { type: "wallSection", variant: "standard", label: "Wall Section" },
  { type: "railing", variant: "standard", label: "Railing" },
  { type: "ducting", variant: "standard", label: "Ducting" },
  { type: "underroofRailing", variant: "standard", label: "Underroof Railing" },
  { type: "bracing", variant: "standard", label: "Stabilizing Brace" },
];

export const COMPONENT_LIBRARY_BY_BUILDING_TYPE: Record<
  BuildingType,
  ComponentLibraryEntry[]
> = {
  house: HOUSE_COMPONENT_LIBRARY,
  factoryHall: FACTORY_HALL_COMPONENT_LIBRARY,
};

export const DEFAULT_SCALE: Record<ComponentType, [number, number, number]> = {
  door: [1, 2.1, 0.1],
  window: [1.2, 1, 0.1],
  column: [0.3, 3, 0.3],
  beam: [4, 0.3, 0.3],
  table: [1.4, 0.75, 0.8],
  /** A frameless, freely resizable cutout — the Width/Height fields in
   * ComponentEditor let it be reshaped after placement. */
  opening: [1.2, 2.1, 0.1],
  /** A freestanding flat panel (canopy, porch roof, lean-to) — width/depth
   * (its horizontal face) are the resizable dimensions; thickness matches a
   * real flat roof panel's so it reads as the same kind of roof. */
  roofSection: [4, FLAT_ROOF_THICKNESS, 3],
  /** A freestanding wall panel — width/height are the resizable dimensions,
   * thickness is fixed, matching the real wall thickness look. */
  wallSection: [3, 3, 0.15],
  /** A guardrail along a terrace/balcony edge — width is the resizable
   * dimension; height is standard railing height, thickness is just the
   * rail bar's own profile (see the top-rail/kick/post breakdown in
   * PlacedComponents.tsx's RailingDetails, which reads this box as the
   * overall envelope rather than rendering it as a solid panel). */
  railing: [3, 1, 0.05],
  /** A raised glazed box sitting proud of the roof surface (see
   * `addSkylight` in store.ts) rather than a flush cutout — width/depth
   * are its footprint on the roof plane, height is how far it protrudes.
   * Low-profile on purpose (real skylight upstands are shallow, a few
   * inches, not a tall box) — 0.3 read as "goofy and too tall". */
  skylight: [1.1, 0.14, 1.1],
  /** A raised, freely resizable solar panel sitting proud of the roof
   * surface (see `addSolarPanel` in store.ts) — wider and shallower than a
   * skylight since it's a flat mounted panel, not a glazed box with sides. */
  solarPanel: [1.8, 0.06, 1],
  /** A duct run — length along its own local X (same convention as `beam`),
   * square cross-section for height/depth. */
  ducting: [3, 0.4, 0.4],
  /** Same envelope shape as `railing` (see above) — a catwalk/near-roof
   * guardrail reuses RailingDetails' width/height/thickness reading. */
  underroofRailing: [3, 1, 0.05],
  /** A diagonal "X" cross-brace within this envelope (see `BracingDetails`
   * in PlacedComponents.tsx) — width/height are the brace's span, thickness
   * is the rod cross-section. Wide and shallow, not square: this runs
   * horizontally under the roof/along a gable bay, not floor-to-ceiling
   * like a column. */
  bracing: [3, 1.2, 0.08],
  /** A shallow rim/curb envelope with a flat water-colored top face (see
   * `PoolDetails` in PlacedComponents.tsx) — width/depth are the pool's own
   * footprint, height is the curb's height above ground (no below-ground
   * excavation; this app has no terrain to dig into). */
  pool: [4, 0.4, 2.5],
  /** Overridden by `resolveComponentSize`'s dedicated "stairs" case below,
   * which derives height (the rise, from the current floor's own height)
   * and depth (the run, from a fixed real-world riser/tread ratio) —
   * present only for Record exhaustiveness; only the width (tread width)
   * is ever actually used from here. */
  stairs: [1, 3, 4.68],
  /** Unused — `addBalcony` (store.ts) bakes its own slab/railing scale
   * directly from the wall it's attached to (like `addPorch`), the same
   * way `skylight`'s and `porch`'s pieces don't go through this generic
   * per-type default either. Present only for Record exhaustiveness. */
  balcony: [3, FLAT_ROOF_THICKNESS, 1.5],
  /** Unscaled (1:1) by default — an imported model's own real-world units
   * are the most honest starting point (see ImportedModel.tsx), rather
   * than guessing a "reasonable" size for a file that could be anything
   * from a doorknob to a garage. The Inspector's Scale field is how a rep
   * fixes a model whose source units don't happen to be meters. */
  model: [1, 1, 1],
};

/** How far a skylight's box protrudes outward from the roof surface it sits
 * on, along that surface's own normal — half the box's own height plus half
 * the gable roof panel's thickness (see gableRoofSlopes' hardcoded `0.1`)
 * plus a small gap so it never z-fights with the roof panel underneath it. */
export const SKYLIGHT_RAISE = DEFAULT_SCALE.skylight[1] / 2 + 0.05 + 0.02;

/** Same idea as `SKYLIGHT_RAISE`, for a solar panel's own (thinner) height. */
export const SOLAR_PANEL_RAISE = DEFAULT_SCALE.solarPanel[1] / 2 + 0.05 + 0.02;

const WINDOW_SILL_HEIGHT = 0.9;

/** Default vertical center for a newly placed component. Most types sit on
 * the floor; a window is elevated to a typical sill height so it reads as a
 * proper window opening (solid wall below/above) rather than a floor-level hole. */
export const DEFAULT_CENTER_Y: Record<ComponentType, number> = {
  door: DEFAULT_SCALE.door[1] / 2,
  window: WINDOW_SILL_HEIGHT + DEFAULT_SCALE.window[1] / 2,
  column: DEFAULT_SCALE.column[1] / 2,
  beam: DEFAULT_SCALE.beam[1] / 2,
  table: DEFAULT_SCALE.table[1] / 2,
  opening: DEFAULT_SCALE.opening[1] / 2,
  /** Typical canopy/porch-roof height — lower than a full wall so it reads
   * as an attached roof rather than a second story. */
  roofSection: 2.5,
  wallSection: DEFAULT_SCALE.wallSection[1] / 2,
  railing: DEFAULT_SCALE.railing[1] / 2,
  /** Unused — a skylight's position is computed directly from the roof
   * slope it sits on (`addSkylight` in store.ts), not via this generic
   * wall-relative default. Present only so this Record stays exhaustive
   * over ComponentType. */
  skylight: 0,
  /** Unused — same as `skylight` above, see `addSolarPanel` in store.ts. */
  solarPanel: 0,
  /** Overridden by `resolveComponentSize`'s near-ceiling special case below
   * for actual placement — present only for Record exhaustiveness. */
  ducting: DEFAULT_SCALE.ducting[1] / 2,
  /** Overridden the same way as `ducting` above. */
  underroofRailing: DEFAULT_SCALE.underroofRailing[1] / 2,
  /** Overridden by `resolveComponentSize`'s near-roofline special case
   * below — present only for Record exhaustiveness. */
  bracing: DEFAULT_SCALE.bracing[1] / 2,
  pool: DEFAULT_SCALE.pool[1] / 2,
  /** Overridden by `resolveComponentSize`'s dedicated "stairs" case —
   * present only for Record exhaustiveness. */
  stairs: DEFAULT_SCALE.stairs[1] / 2,
  /** Unused — see `DEFAULT_SCALE.balcony`. */
  balcony: 0,
  /** Unused — ImportedModel.tsx rests the model's own loaded bounding box
   * on the floor at render time instead (it can't know the right offset
   * until the file is actually parsed, which happens after placement).
   * Present only for Record exhaustiveness. */
  model: 0,
};

/** Scale + vertical center for a component variant, given the wall height it
 * sits against — full-height/three-quarter windows and the hangar door scale
 * with the wall they're placed on rather than using a fixed size. */
export function resolveComponentSize(
  type: ComponentType,
  variant: ComponentVariant,
  wallHeight: number
): { scale: [number, number, number]; centerY: number } {
  switch (variant) {
    case "fullHeight": {
      const height = wallHeight;
      return { scale: [1.5, height, 0.1], centerY: height / 2 };
    }
    case "threeQuarter": {
      const height = wallHeight * 0.75;
      const sill = wallHeight * 0.15;
      return { scale: [1.2, height, 0.1], centerY: sill + height / 2 };
    }
    case "double": {
      const height = DEFAULT_SCALE.door[1];
      return { scale: [1.8, height, 0.1], centerY: height / 2 };
    }
    case "hangar": {
      // Clamped to wallHeight too — the floor at 2.5 was previously
      // unconditional, so on a wall shorter than 2.9 the door poked above
      // the wall top into the roofline instead of actually scaling with it.
      const height = Math.min(Math.max(wallHeight - 0.4, 2.5), wallHeight);
      return { scale: [4, height, 0.15], centerY: height / 2 };
    }
    case "garage": {
      // Same clamp as hangar — 2.2 was a bare constant with no relation to
      // wallHeight at all, so any wall shorter than 2.2 (reachable via the
      // Inspector's min=2 wall-height slider) got a door taller than itself.
      const height = Math.min(2.2, wallHeight);
      return { scale: [2.7, height, 0.1], centerY: height / 2 };
    }
    case "frontDoor": {
      // A genuine step up from "standard" (1 × 2.1), not just a relabel —
      // wider and taller, the way a real entry door reads next to an
      // interior/side door.
      const height = 2.3;
      return { scale: [1.15, height, 0.12], centerY: height / 2 };
    }
    case "round": {
      // Depth mirrors width — TableDetails reads a round table's footprint
      // as a circle of that diameter, so a non-square box would ellipse it.
      const [, height] = DEFAULT_SCALE.table;
      const diameter = 1.2;
      return { scale: [diameter, height, diameter], centerY: height / 2 };
    }
    case "desk": {
      const [, height] = DEFAULT_SCALE.table;
      return { scale: [1.6, height, 0.7], centerY: height / 2 };
    }
    case "standard":
    default: {
      if (type === "column") {
        const [w, , d] = DEFAULT_SCALE.column;
        return { scale: [w, wallHeight, d], centerY: wallHeight / 2 };
      }
      if (type === "ducting" || type === "underroofRailing") {
        // Defaults near the ceiling rather than the floor — these read as
        // "underroof" hardware, not ground-level fixtures.
        const centerY = Math.max(wallHeight - 0.6, 1.5);
        return { scale: DEFAULT_SCALE[type], centerY };
      }
      if (type === "bracing") {
        // Wide/shallow (see DEFAULT_SCALE.bracing) and defaulted up near
        // the roofline — a stabilizing structure spans a bay horizontally
        // under the roof, it doesn't stand floor-to-ceiling like a column.
        const centerY = Math.max(wallHeight - 0.9, 1.5);
        return { scale: DEFAULT_SCALE.bracing, centerY };
      }
      if (type === "stairs") {
        // Rise defaults to the current floor's own height, so a straight
        // flight naturally reaches the floor above without per-instance
        // tuning; run is derived from a real-world riser/tread ratio
        // (~0.18m riser / ~0.28m tread, matching `stairSteps`' own
        // TARGET_RISER) rather than a fixed depth that wouldn't match a
        // taller or shorter floor.
        const [w] = DEFAULT_SCALE.stairs;
        const rise = wallHeight;
        const run = rise * (0.28 / 0.18);
        return { scale: [w, rise, run], centerY: rise / 2 };
      }
      return { scale: DEFAULT_SCALE[type], centerY: DEFAULT_CENTER_Y[type] };
    }
  }
}
