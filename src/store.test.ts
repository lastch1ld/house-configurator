import { describe, expect, it } from "vitest";
import { edges } from "./baseGeometry";
import { useConfiguratorStore } from "./store";

describe("addPolygonBlock", () => {
  it("adds an L-shaped block with roofType forced flat and derived width/depth", () => {
    const { addPolygonBlock } = useConfiguratorStore.getState();
    const before = useConfiguratorStore.getState().base.floors[0].blocks.length;

    addPolygonBlock("l-shape", 20, 20);

    const blocks = useConfiguratorStore.getState().base.floors[0].blocks;
    expect(blocks).toHaveLength(before + 1);
    const block = blocks[blocks.length - 1];
    expect(block.polygon).toHaveLength(6);
    expect(block.roofType).toBe("flat");
    // The l-shape preset's own bounding box is 8x8 (see polygonPresets.ts).
    expect(block.width).toBeCloseTo(8);
    expect(block.depth).toBeCloseTo(8);
  });

  it("stays usable by generic block operations — edges()/rotation work via the polygon's own bounding box", () => {
    const { addPolygonBlock, updateBlock } = useConfiguratorStore.getState();
    addPolygonBlock("t-shape", 40, 40);
    const blocks = useConfiguratorStore.getState().base.floors[0].blocks;
    const block = blocks[blocks.length - 1];

    const flat = edges(block);
    expect(flat.right - flat.left).toBeCloseTo(8);
    expect(flat.front - flat.back).toBeCloseTo(8);

    updateBlock(block.id, { rotation: 90 });
    const rotatedBlock = useConfiguratorStore
      .getState()
      .base.floors[0].blocks.find((b) => b.id === block.id)!;
    // The t-shape preset isn't square (8 wide x 8 deep bounding box happens
    // to be square here, so just confirm edges() doesn't throw/degenerate
    // after rotating a polygon block — a real shape-swap check lives in
    // baseGeometry.test.ts's own "rotates the polygon's bounding box" case.
    expect(() => edges(rotatedBlock)).not.toThrow();
  });
});

describe("addPorch on a rotated block", () => {
  it("attaches to the block's own local wall, not whichever wall now sits at that world edge", () => {
    const { updateBlock, addPorch } = useConfiguratorStore.getState();
    const blockId = useConfiguratorStore.getState().base.floors[0].blocks[0].id;
    updateBlock(blockId, { width: 6, depth: 8, rotation: 90 });

    addPorch(blockId, "front", 2.2);

    const block = useConfiguratorStore.getState().base.floors[0].blocks[0];
    const canopy = useConfiguratorStore
      .getState()
      .components.find((c) => c.type === "roofSection");
    expect(canopy).toBeDefined();
    // The block's local front wall (its own width=6 side) ends up, after a
    // 90° rotation, at the world +x ("right") edge — not the world +z
    // ("front") edge, which after rotating is actually the block's local
    // right wall (width=8 side).
    expect(canopy!.position[0]).toBeCloseTo(block.x + block.depth / 2 + 1.1);
    expect(canopy!.position[2]).toBeCloseTo(block.z);
    expect(canopy!.scale[2]).toBeCloseTo(block.width);
  });
});

describe("repeatComponentAlongWall", () => {
  it("replaces the component with N evenly spaced copies across the wall", () => {
    const { updateBlock, addComponent, repeatComponentAlongWall } =
      useConfiguratorStore.getState();
    const blockId = useConfiguratorStore.getState().base.floors[0].blocks[0].id;
    updateBlock(blockId, { x: 0, z: 0, width: 6, depth: 6, rotation: 0 });

    addComponent("window", [1, 1.5, 2.9]); // near the front wall (e.front = 3)
    const placed = useConfiguratorStore
      .getState()
      .components.find((c) => c.type === "window" && c.wallRef?.blockId === blockId)!;
    expect(placed.wallRef).toBeDefined();

    repeatComponentAlongWall(placed.id, 3);

    const windows = useConfiguratorStore
      .getState()
      .components.filter((c) => c.type === "window" && c.wallRef?.blockId === blockId);
    expect(windows).toHaveLength(3);
    expect(windows.some((c) => c.id === placed.id)).toBe(false); // original replaced

    const offsets = windows.map((c) => c.wallRef!.offset).sort((a, b) => a - b);
    const spacing = 6 / 4; // span 6 (front wall), 3 copies -> 4 gaps
    expect(offsets[0]).toBeCloseTo(spacing);
    expect(offsets[1]).toBeCloseTo(spacing * 2);
    expect(offsets[2]).toBeCloseTo(spacing * 3);
  });

  it("no-ops for a freestanding component", () => {
    const { addComponent, repeatComponentAlongWall } = useConfiguratorStore.getState();
    addComponent("table", [0, 0, 0]);
    const table = useConfiguratorStore.getState().components.find((c) => c.type === "table")!;
    const before = useConfiguratorStore.getState().components.length;
    repeatComponentAlongWall(table.id, 3);
    expect(useConfiguratorStore.getState().components.length).toBe(before);
  });
});

describe("duplicateComponentsToAllFloorsAbove (via store)", () => {
  it("copies a wall-anchored component all the way to the top floor", () => {
    const { setFloorCount, setActiveFloor, updateBlock, addComponent } =
      useConfiguratorStore.getState();
    setFloorCount(3);

    for (let floor = 0; floor < 3; floor++) {
      setActiveFloor(floor);
      const blockId = useConfiguratorStore.getState().base.floors[floor].blocks[0].id;
      updateBlock(blockId, { x: 0, z: 0, width: 6, depth: 6, rotation: 0 });
    }

    setActiveFloor(0);
    // Diff against a snapshot rather than filtering by type/floor — this
    // store is a shared singleton across every test in this file, so
    // earlier tests may have already left other doors/windows behind. Uses
    // the *left* wall specifically (not front) since `repeatComponentAlongWall`'s
    // own test above already fills most of the front wall's span.
    const beforeAdd = useConfiguratorStore.getState().components;
    addComponent("door", [-2.9, 1.5, 1]);
    const afterAdd = useConfiguratorStore.getState().components;
    const placed = afterAdd.find((c) => !beforeAdd.some((b) => b.id === c.id))!;
    expect(placed.wallRef).toBeDefined();

    const { duplicateComponentToAllFloorsAbove } = useConfiguratorStore.getState();
    duplicateComponentToAllFloorsAbove(placed.id);

    const afterDuplicate = useConfiguratorStore.getState().components;
    const newCopies = afterDuplicate.filter((c) => !afterAdd.some((b) => b.id === c.id));
    expect(newCopies.map((c) => c.floorIndex).sort()).toEqual([1, 2]);
    expect(useConfiguratorStore.getState().activeFloorIndex).toBe(2);

    // Restore floor 0 as active — every test after this one assumes it.
    setActiveFloor(0);
  });
});

describe("addBalcony", () => {
  it("adds a balcony slab and a railing along its outer edge", () => {
    const { updateBlock, addBalcony } = useConfiguratorStore.getState();
    const blockId = useConfiguratorStore.getState().base.floors[0].blocks[0].id;
    updateBlock(blockId, { x: 0, z: 0, width: 6, depth: 8, rotation: 0 });

    addBalcony(blockId, "front", 1.5);

    const components = useConfiguratorStore.getState().components;
    const slab = components.find((c) => c.type === "balcony");
    const railing = components.find((c) => c.type === "railing");
    expect(slab).toBeDefined();
    expect(railing).toBeDefined();
    // Front wall: e.front = depth/2 = 4, slab centered 0.75m further out.
    expect(slab!.position[2]).toBeCloseTo(4 + 0.75);
    expect(slab!.scale[0]).toBeCloseTo(6); // spans the full wall (width)
    expect(slab!.scale[2]).toBeCloseTo(1.5); // protrudes by balconyDepth
    // Railing sits on the slab's own outer (further, +z) edge.
    expect(railing!.position[2]).toBeGreaterThan(slab!.position[2]);
    expect(railing!.rotation[1]).toBeCloseTo(0); // front/back: no rotation
  });

  it("orients the railing perpendicular on a left/right wall", () => {
    const { updateBlock, addBalcony } = useConfiguratorStore.getState();
    const blockId = useConfiguratorStore.getState().base.floors[0].blocks[0].id;
    updateBlock(blockId, { x: 0, z: 0, width: 6, depth: 8, rotation: 0 });
    // Clear the previous test's front balcony first — otherwise adding one
    // on "right" (adjacent to "front") would merge into an L-shape instead
    // of the simple single-side balcony this test is exercising.
    useConfiguratorStore.setState({
      components: useConfiguratorStore.getState().components.filter(
        (c) => c.type !== "balcony" && c.type !== "railing"
      ),
    });

    addBalcony(blockId, "right", 1.5);

    const components = useConfiguratorStore.getState().components;
    const slab = [...components].reverse().find((c) => c.type === "balcony")!;
    const railing = [...components].reverse().find((c) => c.type === "railing")!;
    expect(slab.scale[0]).toBeCloseTo(1.5); // protrusion along width (x)
    expect(slab.scale[2]).toBeCloseTo(8); // spans the full wall (depth)
    expect(railing.rotation[1]).toBeCloseTo(Math.PI / 2);
    expect(railing.position[0]).toBeGreaterThan(slab.position[0]);
  });

  it("merges a balcony on an adjacent wall into one L-shaped balcony", () => {
    const { updateBlock, addBalcony } = useConfiguratorStore.getState();
    const blockId = useConfiguratorStore.getState().base.floors[0].blocks[0].id;
    updateBlock(blockId, { x: 0, z: 0, width: 6, depth: 8, rotation: 0 });
    useConfiguratorStore.setState({
      components: useConfiguratorStore.getState().components.filter(
        (c) => c.type !== "balcony" && c.type !== "railing"
      ),
    });

    addBalcony(blockId, "front", 1.2);
    const afterFirst = useConfiguratorStore.getState().components;
    const firstSlabId = afterFirst.find((c) => c.type === "balcony")!.id;

    addBalcony(blockId, "right", 1.5);
    const afterSecond = useConfiguratorStore.getState().components;

    const balconies = afterSecond.filter((c) => c.type === "balcony");
    const railings = afterSecond.filter((c) => c.type === "railing");
    // The first (simple) balcony/railing were replaced, not kept alongside.
    expect(balconies).toHaveLength(1);
    expect(balconies[0].id).not.toBe(firstSlabId);
    expect(balconies[0].polygon).toBeDefined();
    expect(balconies[0].balconySides).toEqual(["front", "right"]);
    expect(railings).toHaveLength(4);
    expect(balconies[0].balconyRailingIds).toEqual(railings.map((r) => r.id));
  });
});

describe("addSolarPanel", () => {
  it("adds one solar panel per block+slope and refuses a duplicate", () => {
    const { updateBlock, addSolarPanel } = useConfiguratorStore.getState();
    const blockId = useConfiguratorStore.getState().base.floors[0].blocks[0].id;
    updateBlock(blockId, { roofType: "gable", roofHeight: 2 });

    addSolarPanel(blockId, 0);
    const afterFirst = useConfiguratorStore
      .getState()
      .components.filter((c) => c.type === "solarPanel");
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].roofSlot).toEqual({ blockId, slopeIndex: 0 });

    addSolarPanel(blockId, 0);
    expect(
      useConfiguratorStore.getState().components.filter((c) => c.type === "solarPanel")
    ).toHaveLength(1);

    addSolarPanel(blockId, 1);
    expect(
      useConfiguratorStore.getState().components.filter((c) => c.type === "solarPanel")
    ).toHaveLength(2);
  });

  it("no-ops on a hip-roofed block (no placement math yet)", () => {
    const { updateBlock, addSolarPanel } = useConfiguratorStore.getState();
    const blockId = useConfiguratorStore.getState().base.floors[0].blocks[0].id;
    updateBlock(blockId, { roofType: "hip" });

    const before = useConfiguratorStore.getState().components.length;
    addSolarPanel(blockId, 0);
    expect(useConfiguratorStore.getState().components.length).toBe(before);
  });
});

describe("addPorch is ground-floor only", () => {
  it("refuses to add a porch on a floor above 0", () => {
    const { setFloorCount, setActiveFloor, addBlock, addPorch } =
      useConfiguratorStore.getState();
    setFloorCount(2);
    setActiveFloor(1);
    addBlock();
    const block = useConfiguratorStore.getState().base.floors[1].blocks[0];

    const before = useConfiguratorStore.getState().components.length;
    addPorch(block.id, "front");
    expect(useConfiguratorStore.getState().components.length).toBe(before);
  });
});

describe("undo/redo activeFloorIndex clamping", () => {
  it("clamps activeFloorIndex after undoing a floor count that shrinks the floors array", () => {
    const { setFloorCount, setActiveFloor, addBlock, undo } = useConfiguratorStore.getState();

    // Start at 1 floor (default), grow to 3, move to the top floor, then
    // make an edit there so there's something to undo before the floor
    // count change itself.
    setFloorCount(3);
    setActiveFloor(2);
    addBlock();

    undo(); // reverts addBlock — still 3 floors
    expect(useConfiguratorStore.getState().base.floors).toHaveLength(3);

    undo(); // reverts setFloorCount(3) — back to 1 floor

    const state = useConfiguratorStore.getState();
    expect(state.base.floors.length).toBeGreaterThan(0);
    expect(state.activeFloorIndex).toBeLessThan(state.base.floors.length);
    // Must not throw — this is exactly what BlocksSidebar/Inspector do on
    // every render.
    expect(() => state.base.floors[state.activeFloorIndex].blocks).not.toThrow();
  });
});
