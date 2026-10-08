import { beforeEach, describe, expect, it } from "vitest";
import { loadSavedBuilds } from "./persistence";

const STORAGE_KEY = "house-configurator.savedBuilds";

/** Minimal in-memory localStorage stub — this suite runs under vitest's
 * "node" environment (see vitest.config.ts), which has no localStorage. */
function installLocalStorageStub(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
}

function validBase() {
  return {
    roofType: "flat",
    buildingType: "house",
    linkedRoofHeight: true,
    floors: [{ id: "f1", blocks: [{ id: "b1", x: 0, z: 0, width: 4, depth: 4, wallHeight: 3, roofHeight: 1.5, rotation: 0 }] }],
    wallMaterialId: "paintedPlaster",
    roofMaterialId: "clayTile",
  };
}

describe("loadSavedBuilds", () => {
  beforeEach(() => {
    installLocalStorageStub();
  });

  it("accepts a well-formed build", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: "s1", name: "My House", savedAt: 1, base: validBase(), components: [] }])
    );
    expect(loadSavedBuilds()).toHaveLength(1);
  });

  it("accepts a block with a polygon footprint (PLAN.md §6 Phase A) — an optional field, no schema change needed", () => {
    const withPolygon = validBase();
    withPolygon.floors[0].blocks[0] = {
      ...withPolygon.floors[0].blocks[0],
      polygon: [
        { x: -4, z: -4 },
        { x: 4, z: -4 },
        { x: 4, z: 0 },
        { x: 0, z: 0 },
        { x: 0, z: 4 },
        { x: -4, z: 4 },
      ],
    } as (typeof withPolygon.floors)[0]["blocks"][0];
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: "s1", name: "L-Shape", savedAt: 1, base: withPolygon, components: [] }])
    );
    const loaded = loadSavedBuilds();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].base.floors[0].blocks[0].polygon).toHaveLength(6);
  });

  it("migrates a pre-§6-Phase-B wallRef ({side} directly) into the new {location} shape", () => {
    const oldStyleComponent = {
      id: "c1",
      type: "door",
      floorIndex: 0,
      position: [0, 1, 3],
      rotation: [0, 0, 0],
      scale: [1, 2.1, 0.1],
      wallRef: { blockId: "b1", side: "front", offset: 2, gable: false },
    };
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: "s1", name: "Old Save", savedAt: 1, base: validBase(), components: [oldStyleComponent] },
      ])
    );
    const loaded = loadSavedBuilds();
    expect(loaded).toHaveLength(1);
    const wallRef = loaded[0].components[0].wallRef;
    expect(wallRef).toEqual({
      blockId: "b1",
      location: { kind: "side", side: "front" },
      offset: 2,
      gable: false,
    });
  });

  it("rejects a floor with an empty blocks array instead of loading a floor that crashes the first block-adding action", () => {
    const corrupt = validBase();
    corrupt.floors = [{ id: "f1", blocks: [] }];
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: "s1", name: "Corrupt", savedAt: 1, base: corrupt, components: [] }])
    );
    expect(loadSavedBuilds()).toEqual([]);
  });
});
