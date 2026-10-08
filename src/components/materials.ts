import { useTexture } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import type { BuildingType } from "../types";

export interface MaterialDef {
  label: string;
  diff: string;
  nor: string;
  arm: string;
  /** Meters per texture repeat, so tiling scales with real wall/roof size. */
  tileSize: number;
  /** Whether this material's `color` (see useTiledMaterial) can be tinted by
   * the user — true only for the plain plaster finish, which is genuinely
   * paintable in reality. Brick/metal/concrete have their own baked-in
   * color and tinting them with an arbitrary hue would just look wrong, so
   * they stay untinted regardless of `wallColor` (see BlockMesh in Base.tsx). */
  tintable?: boolean;
}

function tex(id: string, tileSize: number, label: string, tintable?: boolean): MaterialDef {
  const base = `${import.meta.env.BASE_URL}textures/${id}/${id}`;
  return {
    label,
    diff: `${base}_diff_1k.jpg`,
    nor: `${base}_nor_gl_1k.jpg`,
    arm: `${base}_arm_1k.jpg`,
    tileSize,
    tintable,
  };
}

export const WALL_MATERIALS = {
  // A single tintable plaster finish — previously four separate pre-baked
  // color variants (blue/beige/two plain plaster textures); consolidated
  // into one entry with a user-facing color picker (Inspector's Materials
  // section) instead of a picker choice per color.
  plaster: tex("painted_plaster_wall", 2, "Plaster", true),
  concreteWorn: tex("concrete_floor_worn_001", 2, "Worn Concrete"),
  concreteWall: tex("concrete_wall_009", 2, "Concrete Wall"),
  gravelConcrete: tex("gravel_concrete", 2, "Gravel Concrete"),
  metal: tex("corrugated_iron", 2, "Corrugated Metal"),
  brick: tex("brick_wall_003", 2, "Brick"),
  concreteWall02: tex("concrete_wall_001", 2, "Concrete Wall 02"),
};

/** Wall/roof material ids saved builds may still reference from before this
 * consolidation (bluePlaster, plasteredWall, plasteredWall02, beigePlaster,
 * paintedPlaster -> all now "plaster") — see resolveWallMaterialId. */
const LEGACY_WALL_MATERIAL_IDS = new Set([
  "bluePlaster",
  "plasteredWall",
  "paintedPlaster",
  "plasteredWall02",
  "beigePlaster",
]);

export const ROOF_MATERIALS = {
  clayTile: tex("clay_roof_tiles", 2, "Clay Tile"),
  metalSheet: tex("box_profile_metal_sheet", 2, "Metal Sheet"),
  corrugatedIron: tex("corrugated_iron", 2, "Corrugated Iron"),
  corrugatedIron02: tex("corrugated_iron_02", 2, "Corrugated Iron 02"),
};

export type WallMaterialId = keyof typeof WALL_MATERIALS;
export type RoofMaterialId = keyof typeof ROOF_MATERIALS;

export const DEFAULT_WALL_MATERIAL: Record<BuildingType, WallMaterialId> = {
  house: "plaster",
  factoryHall: "metal",
};

/** Which wall materials are offered per building type — the plaster/concrete
 * looks read as house materials; sheet metal/gravel concrete as factory-hall
 * ones, with concrete wall shared across both. */
export const WALL_MATERIALS_BY_TYPE: Record<BuildingType, WallMaterialId[]> = {
  house: ["plaster", "concreteWall", "brick"],
  factoryHall: [
    "metal",
    "concreteWall",
    "concreteWorn",
    "gravelConcrete",
    "concreteWall02",
  ],
};

/** The default wall tint — a warm off-white that reads as a natural
 * unpainted plaster color rather than a stark synthetic white. */
export const DEFAULT_WALL_COLOR = "#e7e2d6";

/** Resolves a possibly-stale wallMaterialId (from a build saved before the
 * plaster consolidation above, or any other future removal) to a real
 * current material id, instead of the raw `WALL_MATERIALS[id]` lookups
 * throughout Base.tsx/PlacedComponents.tsx crashing on `undefined`. */
export function resolveWallMaterialId(
  id: string,
  buildingType: BuildingType
): WallMaterialId {
  if (id in WALL_MATERIALS) return id as WallMaterialId;
  if (LEGACY_WALL_MATERIAL_IDS.has(id)) return "plaster";
  return DEFAULT_WALL_MATERIAL[buildingType];
}

export const DEFAULT_ROOF_MATERIAL: Record<BuildingType, RoofMaterialId> = {
  house: "clayTile",
  factoryHall: "metalSheet",
};

/** Same per-building-type filtering as walls — clay tile is a house-only
 * look; the corrugated metal variants are factory-hall roofing. */
export const ROOF_MATERIALS_BY_TYPE: Record<BuildingType, RoofMaterialId[]> = {
  house: ["clayTile"],
  factoryHall: ["metalSheet", "corrugatedIron", "corrugatedIron02"],
};

export interface TiledMaterialProps {
  map: Texture;
  normalMap: Texture;
  aoMap: Texture;
  roughnessMap: Texture;
  metalnessMap: Texture;
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
  /** MeshStandardMaterial multiplies the diffuse map by this — white (the
   * default) leaves the texture unmodified; any other color tints it.
   * Always set (never left for three's own default) so a re-render that
   * drops a previously-tinted color reliably resets to white rather than
   * leaving the GPU material's last color uniform stale. */
  color: string;
}

/**
 * Loads a material's texture set and clones it with repeat scaled to the
 * surface's real-world size — box UVs are always 0-1 per face, so without
 * this a texture would stretch to fill whatever size wall/roof it's on.
 * Textures from useTexture are cached/shared by URL, so mutating repeat on
 * the shared instance would fight every other surface using it — clone
 * first.
 */
export function useTiledMaterial(
  def: MaterialDef,
  width: number,
  height: number,
  transparentWalls: boolean,
  /** Only applied when `def.tintable` is true (see MaterialDef) — an
   * untintable material (brick, metal, concrete) always renders at
   * its own baked-in color regardless of what's passed here. */
  color?: string
): TiledMaterialProps {
  const [diff, nor, arm] = useTexture([def.diff, def.nor, def.arm]);

  const clones = useMemo(() => {
    const repeatX = width / def.tileSize;
    const repeatY = height / def.tileSize;
    const cloned = [diff, nor, arm].map((t) => {
      const c = t.clone();
      c.wrapS = RepeatWrapping;
      c.wrapT = RepeatWrapping;
      c.repeat.set(repeatX, repeatY);
      c.needsUpdate = true;
      return c;
    });
    // Only the diffuse map holds color data that needs gamma-correct
    // decoding — normal/ARM maps are linear data and must NOT be sRGB.
    cloned[0].colorSpace = SRGBColorSpace;
    return cloned;
  }, [diff, nor, arm, width, height, def.tileSize]);

  // Each recomputed set of clones above uploads its own GPU-side texture
  // data; the previous set is no longer referenced anywhere once `clones`
  // changes, so it must be disposed explicitly here or it leaks GPU memory
  // (R3F only auto-disposes on unmount, not on a prop/memo value swap).
  useEffect(() => {
    return () => {
      clones.forEach((c) => c.dispose());
    };
  }, [clones]);

  const [map, normalMap, arMap] = clones;
  return {
    map,
    normalMap,
    aoMap: arMap,
    roughnessMap: arMap,
    metalnessMap: arMap,
    transparent: transparentWalls,
    opacity: transparentWalls ? 0.18 : 1,
    depthWrite: !transparentWalls,
    color: def.tintable && color ? color : "#ffffff",
  };
}
