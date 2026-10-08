import { nanoid } from "./nanoid";
import type { BaseBlock, BaseConfig, Floor, PlacedComponent } from "./types";

const STORAGE_KEY = "house-configurator.savedBuilds";

export interface SavedBuild {
  id: string;
  name: string;
  savedAt: number;
  base: BaseConfig;
  components: PlacedComponent[];
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every(isNumber);
}

function isBaseBlock(v: unknown): v is BaseBlock {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.id === "string" &&
    isNumber(b.x) &&
    isNumber(b.z) &&
    isNumber(b.width) &&
    isNumber(b.depth) &&
    isNumber(b.wallHeight) &&
    isNumber(b.roofHeight) &&
    isNumber(b.rotation)
  );
}

function isFloor(v: unknown): v is Floor {
  if (typeof v !== "object" || v === null) return false;
  const f = v as Record<string, unknown>;
  return (
    typeof f.id === "string" &&
    Array.isArray(f.blocks) &&
    // Every block-adding action (addBlock, addGarageBlock, duplicateBlock in
    // store.ts) reads activeBlocks[activeBlocks.length - 1] and crashes on
    // an empty floor — a floor must have at least one block to be usable.
    f.blocks.length > 0 &&
    f.blocks.every(isBaseBlock)
  );
}

function isBaseConfig(v: unknown): v is BaseConfig {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    (b.roofType === "gable" ||
      b.roofType === "flat" ||
      b.roofType === "monoPitch" ||
      b.roofType === "hip") &&
    (b.buildingType === "house" || b.buildingType === "factoryHall") &&
    typeof b.linkedRoofHeight === "boolean" &&
    Array.isArray(b.floors) &&
    b.floors.length > 0 &&
    b.floors.every(isFloor) &&
    typeof b.wallMaterialId === "string" &&
    typeof b.roofMaterialId === "string"
  );
}

function isPlacedComponent(v: unknown): v is PlacedComponent {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.type === "string" &&
    isNumber(c.floorIndex) &&
    isVec3(c.position) &&
    isVec3(c.rotation) &&
    isVec3(c.scale)
  );
}

/** Guards against malformed/corrupted/schema-drifted localStorage data (e.g.
 * hand-edited via devtools, a truncated write, or a build saved by an older
 * incompatible version) — otherwise it flows straight into store state and
 * either throws deep inside rendering/geometry code or silently produces
 * nonsensical geometry (NaN positions, negative dimensions). */
function isSavedBuild(v: unknown): v is SavedBuild {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.id === "string" &&
    typeof b.name === "string" &&
    isNumber(b.savedAt) &&
    isBaseConfig(b.base) &&
    Array.isArray(b.components) &&
    b.components.every(isPlacedComponent)
  );
}

/** Old saves store `wallRef: { blockId, side: WallSide, offset, gable }`
 * directly; PLAN.md §6 Phase B widened `WallRef.side` into
 * `location: {kind:"side";side}|{kind:"edge";index}` for polygon-edge
 * support. Wraps the old shape into the new one, on the raw (still
 * `unknown`) JSON before `isPlacedComponent` even runs, so an existing
 * saved build's wall-anchored doors/windows/etc. still load with a
 * `wallRef.location` the rest of the app can actually read — this is the
 * real, if mechanical, migration cost PLAN.md §6 flagged for choosing the
 * discriminated-union restructure over a non-breaking type-widen. */
function migrateWallRefShape(rawComponent: unknown): unknown {
  if (typeof rawComponent !== "object" || rawComponent === null) return rawComponent;
  const c = rawComponent as Record<string, unknown>;
  if (typeof c.wallRef !== "object" || c.wallRef === null) return rawComponent;
  const w = c.wallRef as Record<string, unknown>;
  if (typeof w.side !== "string" || w.location !== undefined) return rawComponent;
  return {
    ...c,
    wallRef: {
      blockId: w.blockId,
      location: { kind: "side", side: w.side },
      offset: w.offset,
      gable: w.gable,
    },
  };
}

function migrateSavedBuildShape(rawBuild: unknown): unknown {
  if (typeof rawBuild !== "object" || rawBuild === null) return rawBuild;
  const b = rawBuild as Record<string, unknown>;
  if (!Array.isArray(b.components)) return rawBuild;
  return { ...b, components: b.components.map(migrateWallRefShape) };
}

export function loadSavedBuilds(): SavedBuild[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.map(migrateSavedBuildShape).filter(isSavedBuild);
    if (valid.length < parsed.length) {
      // Surface schema-drifted/corrupted entries instead of dropping them
      // with no trace — a rep who saved a build before a schema change
      // would otherwise see it vanish with no explanation.
      console.warn(
        `[house-configurator] Dropped ${parsed.length - valid.length} saved build(s) that failed validation (corrupted or from an incompatible older version).`
      );
    }
    return valid;
  } catch {
    return [];
  }
}

function writeSavedBuilds(builds: SavedBuild[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(builds));
  } catch {
    // Most commonly QuotaExceededError — imported "model" components embed
    // their whole source file as a data URL (see modelData on
    // PlacedComponent), which can push a build well past localStorage's
    // typical ~5-10MB per-origin quota. Re-thrown with a message a rep can
    // actually act on rather than a raw DOMException reaching the console.
    throw new Error(
      "Couldn't save this build — it's too large for browser storage (often caused by an imported model file). Try removing or replacing large imported models."
    );
  }
}

/** Saves the current base/components as a new build and returns the
 * refreshed list, most-recent first. */
export function saveBuild(
  name: string,
  base: BaseConfig,
  components: PlacedComponent[]
): SavedBuild[] {
  const build: SavedBuild = {
    id: nanoid(),
    name,
    savedAt: Date.now(),
    base,
    components,
  };
  const builds = [build, ...loadSavedBuilds()];
  writeSavedBuilds(builds);
  return builds;
}

export function deleteBuild(id: string): SavedBuild[] {
  const builds = loadSavedBuilds().filter((b) => b.id !== id);
  writeSavedBuilds(builds);
  return builds;
}

/** Validates a build that arrived from outside this browser (a share link), applying the same checks and
 * migrations as a saved build. Returns null for anything that does not fit. */
export function parseSharedBuild(raw: unknown): Pick<SavedBuild, "base" | "components"> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const candidate = migrateSavedBuildShape({
    id: "shared",
    name: "Shared build",
    savedAt: 0,
    base: r.base,
    components: r.components,
  });
  return isSavedBuild(candidate) ? { base: candidate.base, components: candidate.components } : null;
}
