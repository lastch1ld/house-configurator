import { alongWallPosition } from "./componentSnap";
import { DEFAULT_ROOF_MATERIAL, DEFAULT_WALL_MATERIAL } from "./components/materials";
import { FLAT_ROOF_THICKNESS } from "./constants";
import { computeRoofComponentPlacement } from "./floorDuplication";
import { nanoid } from "./nanoid";
import { roofWithColumns } from "./porch";
import {
  DEFAULT_CENTER_Y,
  DEFAULT_SCALE,
  resolveComponentSize,
  SKYLIGHT_RAISE,
  SOLAR_PANEL_RAISE,
} from "./types";
import type {
  BaseBlock,
  BaseConfig,
  BuildingType,
  ComponentType,
  ComponentVariant,
  PlacedComponent,
  RoofSlopeIndex,
  RoofType,
  WallSide,
} from "./types";

function blockWith(base: BaseBlock, overrides: Partial<BaseBlock>): BaseBlock {
  return { ...base, ...overrides };
}

function block(
  id: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  wallHeight: number,
  roofHeight: number
): BaseBlock {
  return { id, x, z, width, depth, wallHeight, roofHeight, rotation: 0 };
}

/** Places a door/window on `targetBlock`'s wall using the same along-wall
 * math the engine uses when a user drags a component onto a wall, so
 * preset components look identical to hand-placed ones. `floorIndex`
 * defaults to 0 (ground) since most templates are single-floor. */
function placeOnWall(
  id: string,
  type: ComponentType,
  targetBlock: BaseBlock,
  side: WallSide,
  offset: number,
  floorIndex = 0,
  variant: ComponentVariant = "standard"
): PlacedComponent {
  const { x, z, rotationY } = alongWallPosition(targetBlock, side, offset, type);
  const { scale, centerY } = resolveComponentSize(type, variant, targetBlock.wallHeight);
  return {
    id,
    type,
    floorIndex,
    variant,
    position: [x, centerY, z],
    rotation: [0, rotationY, 0],
    scale,
    wallRef: { blockId: targetBlock.id, location: { kind: "side", side }, offset },
  };
}

/** A canopy over a terrace formed where a shifted/shorter upper block
 * leaves part of the floor below's roof exposed — see `roofWithColumns` for
 * the shared geometry. `floorIndex`/`wallHeight` are the *attached* floor's
 * — the one whose wall the canopy extends out from, and whose height the
 * canopy roof matches. */
const terraceCanopy = roofWithColumns;

/** A single guardrail bar. `axis` is which world axis the bar's own length
 * runs along (its local width before rotation); `pos` is the bar's center
 * on the OTHER axis; `center`/`span` place and size it along `axis` itself. */
function railingBar(
  id: string,
  floorIndex: number,
  axis: "x" | "z",
  center: number,
  span: number,
  pos: number
): PlacedComponent {
  const [, railingHeight, railingThickness] = DEFAULT_SCALE.railing;
  const rotationY = axis === "z" ? Math.PI / 2 : 0;
  return {
    id,
    type: "railing",
    floorIndex,
    variant: "standard",
    position: [
      axis === "x" ? center : pos,
      DEFAULT_CENTER_Y.railing,
      axis === "x" ? pos : center,
    ],
    rotation: [0, rotationY, 0],
    scale: [span, railingHeight, railingThickness],
  };
}

/** Guardrails along a terrace's 3 unattached edges — the outer edge
 * (parallel to the attached wall, same as `terraceCanopy`'s support
 * columns) plus the two side edges connecting it back to the wall. Only
 * the 4th edge (flush against the attached floor's own wall) is skipped,
 * since that one's already guarded by the wall itself. Same
 * `outerAxis`/`outerSign` convention as `terraceCanopy`, typically called
 * with the same `x`/`z`/`width`/`depth` so the edges line up exactly. */
function terraceRailings(
  idPrefix: string,
  floorIndex: number,
  x: number,
  z: number,
  width: number,
  depth: number,
  outerAxis: "x" | "z",
  outerSign: 1 | -1
): PlacedComponent[] {
  const [, , railingThickness] = DEFAULT_SCALE.railing;
  // "a" is the axis the outer coordinate varies along (outerAxis itself);
  // "b" is the perpendicular axis the outer rail's own bar runs along.
  const aCenter = outerAxis === "x" ? x : z;
  const bCenter = outerAxis === "x" ? z : x;
  const aSize = outerAxis === "x" ? width : depth;
  const bSize = outerAxis === "x" ? depth : width;
  const bAxis = outerAxis === "x" ? "z" : "x";
  const outerCoord = aCenter + outerSign * (aSize / 2 - railingThickness / 2);

  const outerRail = railingBar(
    `${idPrefix}-railing-outer`,
    floorIndex,
    bAxis,
    bCenter,
    bSize,
    outerCoord
  );
  const sideRails = [-1, 1].map((sign) =>
    railingBar(
      `${idPrefix}-railing-side-${sign}`,
      floorIndex,
      outerAxis,
      aCenter,
      aSize,
      bCenter + sign * (bSize / 2 - railingThickness / 2)
    )
  );
  return [outerRail, ...sideRails];
}

/** An overhead duct run along a hall block's long (depth) axis, centered,
 * with a margin at each end so it doesn't poke through the end walls. */
function hallDucting(id: string, floorIndex: number, targetBlock: BaseBlock): PlacedComponent {
  const { scale, centerY } = resolveComponentSize("ducting", "standard", targetBlock.wallHeight);
  const length = Math.max(targetBlock.depth - 4, 2);
  return {
    id,
    type: "ducting",
    floorIndex,
    variant: "standard",
    position: [targetBlock.x, centerY, targetBlock.z],
    // Ducting's own length runs along local X (see DEFAULT_SCALE.ducting);
    // rotate 90° so it runs along the block's depth (its long axis) instead.
    rotation: [0, Math.PI / 2, 0],
    scale: [length, scale[1], scale[2]],
  };
}

/** A pair of diagonal stabilizing braces near the roofline on a hall
 * block's two long (left/right) side walls. */
function hallBracing(
  idPrefix: string,
  floorIndex: number,
  targetBlock: BaseBlock
): PlacedComponent[] {
  const { scale, centerY } = resolveComponentSize("bracing", "standard", targetBlock.wallHeight);
  const inset = 0.15;
  return [-1, 1].map((sign) => ({
    id: `${idPrefix}-brace-${sign}`,
    type: "bracing",
    floorIndex,
    variant: "standard",
    position: [
      targetBlock.x + sign * (targetBlock.width / 2 - inset),
      centerY,
      targetBlock.z,
    ],
    // Runs its own width along the block's depth (the side wall's own
    // length), same rotation convention as hallDucting.
    rotation: [0, Math.PI / 2, 0],
    scale: [Math.min(scale[0], targetBlock.depth - 2), scale[1], scale[2]],
  }));
}

/** A near-ceiling guardrail (e.g. a catwalk guard) along a hall block's
 * front wall, inset from the corners. */
function hallUnderroofRailing(
  id: string,
  floorIndex: number,
  targetBlock: BaseBlock
): PlacedComponent {
  const { scale, centerY } = resolveComponentSize(
    "underroofRailing",
    "standard",
    targetBlock.wallHeight
  );
  return {
    id,
    type: "underroofRailing",
    floorIndex,
    variant: "standard",
    position: [
      targetBlock.x,
      centerY,
      targetBlock.z + targetBlock.depth / 2 - 0.2,
    ],
    rotation: [0, 0, 0],
    scale: [Math.min(scale[0], targetBlock.width - 1), scale[1], scale[2]],
  };
}

/** A single-wall balcony (slab + one outer railing), inlined from
 * `addBalcony`'s own simple (non-merged) branch in store.ts — same
 * reasoning as `blockBalcony` below: every reference-house template block
 * has `rotation: 0`, so the world/local distinction that branch's
 * `toWorld` handles never actually matters here. */
function simpleBalcony(
  idPrefix: string,
  floorIndex: number,
  targetBlock: BaseBlock,
  side: WallSide,
  balconyDepth: number
): PlacedComponent[] {
  const slabThickness = FLAT_ROOF_THICKNESS;
  const [, railHeight, railThickness] = DEFAULT_SCALE.railing;
  const e = {
    front: targetBlock.z + targetBlock.depth / 2,
    back: targetBlock.z - targetBlock.depth / 2,
    left: targetBlock.x - targetBlock.width / 2,
    right: targetBlock.x + targetBlock.width / 2,
  };
  const span = side === "front" || side === "back" ? targetBlock.width : targetBlock.depth;
  let x: number;
  let z: number;
  let width: number;
  let depth: number;
  let outerAxis: "x" | "z";
  let outerSign: 1 | -1;
  switch (side) {
    case "front":
      x = targetBlock.x;
      z = e.front + balconyDepth / 2;
      width = span;
      depth = balconyDepth;
      outerAxis = "z";
      outerSign = 1;
      break;
    case "back":
      x = targetBlock.x;
      z = e.back - balconyDepth / 2;
      width = span;
      depth = balconyDepth;
      outerAxis = "z";
      outerSign = -1;
      break;
    case "left":
      x = e.left - balconyDepth / 2;
      z = targetBlock.z;
      width = balconyDepth;
      depth = span;
      outerAxis = "x";
      outerSign = -1;
      break;
    case "right":
      x = e.right + balconyDepth / 2;
      z = targetBlock.z;
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

  const railingId = `${idPrefix}-railing`;
  const slab: PlacedComponent = {
    id: `${idPrefix}-slab`,
    type: "balcony",
    variant: "standard",
    floorIndex,
    position: [x, -slabThickness / 2, z],
    rotation: [0, 0, 0],
    scale: [width, slabThickness, depth],
    balconyBlockId: targetBlock.id,
    balconySides: [side],
    balconyRailingIds: [railingId],
  };
  const railing: PlacedComponent = {
    id: railingId,
    type: "railing",
    variant: "standard",
    floorIndex,
    position: [railX, railHeight / 2, railZ],
    rotation: [0, railRotationY, 0],
    scale: [railSpan, railHeight, railThickness],
  };
  return [slab, railing];
}

/** A raised skylight/solar-panel component centered on one face of
 * `targetBlock`'s roof — same placement math `addSkylight`/`addSolarPanel`
 * (store.ts) use, via the same exported `computeRoofComponentPlacement`,
 * so a preset panel looks identical to one added by hand. Returns `[]`
 * (not a throw) for a slope index the block's own roof type doesn't have,
 * so a template can't crash on a future roof-type change to one of its
 * blocks. */
function roofSlotComponent(
  id: string,
  type: "skylight" | "solarPanel",
  targetBlock: BaseBlock,
  slopeIndex: RoofSlopeIndex,
  floorIndex: number,
  effectiveRoofType: RoofType
): PlacedComponent[] {
  const raise = type === "skylight" ? SKYLIGHT_RAISE : SOLAR_PANEL_RAISE;
  const [footprintWidth, , footprintLength] = DEFAULT_SCALE[type];
  const placement = computeRoofComponentPlacement(targetBlock, effectiveRoofType, slopeIndex, raise, [
    footprintWidth,
    footprintLength,
  ]);
  if (!placement) return [];
  return [
    {
      id,
      type,
      variant: "standard",
      floorIndex,
      position: placement.position,
      rotation: placement.rotation,
      scale: DEFAULT_SCALE[type],
      roofSlot: { blockId: targetBlock.id, slopeIndex },
    },
  ];
}

/** A regular grid of small square punched windows across one wall of
 * `targetBlock` — the decorative concrete-screen gable-end pattern seen on
 * Villa Poggiolina's two end walls. `marginAlong`/`marginUp` are the gap
 * from the wall's own edges/wall-top to the first row/column, not the
 * spacing between openings. */
function squareWindowGrid(
  idPrefix: string,
  floorIndex: number,
  targetBlock: BaseBlock,
  side: WallSide,
  cols: number,
  rows: number,
  size: number,
  marginAlong: number,
  marginUp: number
): PlacedComponent[] {
  const span = side === "front" || side === "back" ? targetBlock.width : targetBlock.depth;
  const usableSpan = span - 2 * marginAlong;
  const usableHeight = targetBlock.wallHeight - marginUp - size / 2;
  const colStep = cols > 1 ? usableSpan / (cols - 1) : 0;
  const rowStep = rows > 1 ? usableHeight / (rows - 1) : 0;
  const result: PlacedComponent[] = [];
  for (let row = 0; row < rows; row++) {
    const centerY = marginUp + size / 2 + row * rowStep;
    for (let col = 0; col < cols; col++) {
      const offset = marginAlong + col * colStep;
      const { x, z, rotationY } = alongWallPosition(targetBlock, side, offset, "window");
      result.push({
        id: `${idPrefix}-${row}-${col}`,
        type: "window",
        variant: "standard",
        floorIndex,
        position: [x, centerY, z],
        rotation: [0, rotationY, 0],
        scale: [size, size, 0.1],
      });
    }
  }
  return result;
}

/** Every starter template is a single-floor building — `blocks` becomes
 * that one floor. */
function baseConfig(
  buildingType: BuildingType,
  roofType: RoofType,
  blocks: BaseBlock[]
): BaseConfig {
  return baseConfigMultiFloor(buildingType, roofType, [blocks]);
}

/** Same as `baseConfig`, but for templates with more than one floor — one
 * entry in `floorsBlocks` per floor, stacked bottom-to-top. */
function baseConfigMultiFloor(
  buildingType: BuildingType,
  roofType: RoofType,
  floorsBlocks: BaseBlock[][]
): BaseConfig {
  return {
    roofType,
    buildingType,
    linkedRoofHeight: true,
    floors: floorsBlocks.map((blocks) => ({ id: nanoid(), blocks })),
    wallMaterialId: DEFAULT_WALL_MATERIAL[buildingType],
    roofMaterialId: DEFAULT_ROOF_MATERIAL[buildingType],
  };
}

export interface StarterTemplate {
  id: string;
  label: string;
  buildingType: BuildingType;
  build: () => { base: BaseConfig; components: PlacedComponent[] };
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "small-house",
    label: "Small House (6×8m)",
    buildingType: "house",
    build: () => {
      const main = block("main", 0, 0, 6, 8, 3, 1.5);
      return {
        base: baseConfig("house", "gable", [main]),
        components: [
          placeOnWall("door", "door", main, "front", 3, 0, "frontDoor"),
          placeOnWall("window-left", "window", main, "left", 4),
          placeOnWall("window-right", "window", main, "right", 4),
        ],
      };
    },
  },
  {
    id: "family-house",
    label: "Family House (10×12m)",
    buildingType: "house",
    build: () => {
      const main = block("main", 0, 0, 10, 12, 3, 1.8);
      return {
        base: baseConfig("house", "gable", [main]),
        components: [
          placeOnWall("door", "door", main, "front", 5, 0, "frontDoor"),
          placeOnWall("window-front-left", "window", main, "front", 2.5, 0, "threeQuarter"),
          placeOnWall("window-front-right", "window", main, "front", 7.5, 0, "threeQuarter"),
          placeOnWall("window-left", "window", main, "left", 6),
          placeOnWall("window-right", "window", main, "right", 6),
        ],
      };
    },
  },
  {
    id: "l-shaped-house",
    label: "L-Shaped House",
    buildingType: "house",
    build: () => {
      // Mono-pitch main volume with a gable-roofed wing — mixing roof
      // types per block, the way real modular houses combine a plain main
      // box with a distinct-looking attached wing.
      const main = block("main", 0, 0, 10, 8, 3, 2.4);
      const wing = blockWith(block("wing", 2.5, -7, 5, 6, 3, 1.5), {
        roofType: "gable",
      });
      return {
        base: baseConfig("house", "monoPitch", [main, wing]),
        components: [
          placeOnWall("door", "door", main, "front", 3, 0, "frontDoor"),
          placeOnWall("window-main", "window", main, "front", 7, 0, "fullHeight"),
          placeOnWall("window-wing", "window", wing, "right", 3),
        ],
      };
    },
  },
  {
    id: "u-shaped-house",
    label: "U-Shaped House",
    buildingType: "house",
    build: () => {
      const main = block("main", 0, 0, 10, 5, 3, 1.5);
      const leftWing = block("left-wing", -3.5, 6, 3, 7, 3, 1.5);
      const rightWing = block("right-wing", 3.5, 6, 3, 7, 3, 1.5);
      return {
        base: baseConfig("house", "gable", [main, leftWing, rightWing]),
        components: [
          placeOnWall("door", "door", main, "front", 5, 0, "double"),
          placeOnWall("window-left-wing", "window", leftWing, "left", 3.5),
          placeOnWall("window-right-wing", "window", rightWing, "right", 3.5),
        ],
      };
    },
  },
  {
    id: "two-story-house",
    label: "Two-Story House",
    buildingType: "house",
    build: () => {
      const ground = block("ground", 0, 0, 8, 10, 3, 1.5);
      // Same footprint as the ground floor, fresh block id so it's an
      // independent floor rather than a shared reference.
      const upper = block("upper", 0, 0, 8, 10, 3, 1.5);
      return {
        base: baseConfigMultiFloor("house", "hip", [[ground], [upper]]),
        components: [
          placeOnWall("door", "door", ground, "front", 4, 0, "frontDoor"),
          placeOnWall("window-left", "window", ground, "left", 5, 0),
          placeOnWall("window-right", "window", ground, "right", 5, 0),
          placeOnWall("window-upper-front", "window", upper, "front", 4, 1, "threeQuarter"),
          placeOnWall("window-upper-left", "window", upper, "left", 5, 1, "threeQuarter"),
          placeOnWall("window-upper-right", "window", upper, "right", 5, 1, "threeQuarter"),
        ],
      };
    },
  },
  {
    id: "overhang-entry-house",
    label: "Two-Story House (Overhang Entry)",
    buildingType: "house",
    build: () => {
      const ground = block("ground", 0, 0, 8, 8, 3, 1.5);
      // Same footprint as the ground floor, but shifted forward (not a
      // symmetric inset) so it cantilevers 3m past the ground floor's front
      // wall — that overhanging strip has no ground-floor wall beneath it,
      // so it reads as a covered entry porch. The same shift leaves an
      // equal-sized strip of the ground floor's roof exposed at the back,
      // which becomes an open-air balcony/terrace off the upper floor.
      const upper = block("upper", 0, 3, 8, 8, 3, 1.5);
      // One support column under each front corner of the cantilevered
      // strip, not a single central one — reads as an actual structural
      // porch rather than a lone post in the middle of the walkway.
      const { scale: columnScale, centerY: columnCenterY } = resolveComponentSize(
        "column",
        "standard",
        ground.wallHeight
      );
      const cornerInset = columnScale[0] / 2 + 0.15;
      const columnZ = upper.z + upper.depth / 2 - cornerInset;
      const porchColumns: PlacedComponent[] = [
        { id: "porch-column-left", x: -(ground.width / 2 - cornerInset) },
        { id: "porch-column-right", x: ground.width / 2 - cornerInset },
      ].map(({ id, x }) => ({
        id,
        type: "column",
        floorIndex: 0,
        variant: "standard",
        position: [x, columnCenterY, columnZ],
        rotation: [0, 0, 0],
        scale: columnScale,
      }));
      const groundBack = ground.z - ground.depth / 2;
      const upperBack = upper.z - upper.depth / 2;
      return {
        base: baseConfigMultiFloor("house", "flat", [[ground], [upper]]),
        components: [
          // Entry door on the ground floor's front wall, opening straight
          // into the covered porch formed by the overhang above.
          placeOnWall("door", "door", ground, "front", 4, 0, "frontDoor"),
          placeOnWall("window-left", "window", ground, "left", 4, 0),
          placeOnWall("window-right", "window", ground, "right", 4, 0),
          ...porchColumns,
          placeOnWall("window-upper-front", "window", upper, "front", 4, 1, "fullHeight"),
          placeOnWall("window-upper-left", "window", upper, "left", 4, 1),
          placeOnWall("window-upper-right", "window", upper, "right", 4, 1),
          // Onto the open-air balcony/terrace formed on the ground floor's
          // roof at the back — the strip the upper floor doesn't reach
          // since it was shifted forward for the entry overhang.
          placeOnWall("door-upper-balcony", "door", upper, "back", 4, 1),
          ...terraceCanopy(
            "balcony",
            1,
            upper.wallHeight,
            0,
            (groundBack + upperBack) / 2,
            upper.width,
            upperBack - groundBack,
            "z",
            -1
          ),
          ...terraceRailings(
            "balcony",
            1,
            0,
            (groundBack + upperBack) / 2,
            upper.width,
            upperBack - groundBack,
            "z",
            -1
          ),
        ],
      };
    },
  },
  {
    id: "shifted-upper-villa",
    label: "Shifted Upper Floor Villa",
    buildingType: "house",
    build: () => {
      const ground = block("ground", 0, 0, 10, 8, 3, 1.5);
      // Same depth, narrower and shifted along X — modeled on villas like
      // MUS Architects' "Void & Mass Villa", where the upper volume slides
      // sideways relative to the one below: a modest 1m cantilever past
      // the ground floor's right edge for that "floating volume" look,
      // and a wide covered terrace on the left where it doesn't reach.
      const upper = block("upper", 2, 0, 8, 8, 3, 1.5);
      // The terrace strip left exposed on the ground floor's roof, from the
      // ground floor's own left edge to the upper block's left wall.
      const groundLeft = ground.x - ground.width / 2;
      const upperLeft = upper.x - upper.width / 2;
      return {
        base: baseConfigMultiFloor("house", "flat", [[ground], [upper]]),
        components: [
          placeOnWall("door", "door", ground, "front", 3, 0, "frontDoor"),
          placeOnWall("window-ground-back", "window", ground, "back", 4, 0),
          placeOnWall("window-upper-front", "window", upper, "front", 4, 1, "fullHeight"),
          // Onto the terrace left exposed by the shift.
          placeOnWall("door-upper-terrace", "door", upper, "left", 4, 1),
          placeOnWall("window-upper-right", "window", upper, "right", 4, 1, "fullHeight"),
          ...terraceCanopy(
            "terrace",
            1,
            upper.wallHeight,
            (groundLeft + upperLeft) / 2,
            upper.z,
            upperLeft - groundLeft,
            upper.depth,
            "x",
            -1
          ),
          ...terraceRailings(
            "terrace",
            1,
            (groundLeft + upperLeft) / 2,
            upper.z,
            upperLeft - groundLeft,
            upper.depth,
            "x",
            -1
          ),
        ],
      };
    },
  },
  {
    id: "tiered-villa",
    label: "Tiered Villa (Stepped Rear Terraces)",
    buildingType: "house",
    build: () => {
      // A symmetric setback on every side reads as a ziggurat, not a
      // house — real stepped villas keep one unified front facade and
      // only step back at the rear, tied to what each floor actually is:
      // ground (entry + living, full depth) → first floor (bedrooms,
      // pulled back 3m for a rear terrace over the living room roof) →
      // second floor (a primary suite, pulled back another 3m for its
      // own terrace). Same width and the same front line on every floor,
      // so the facade reads as one continuous 3-story front, not a stack
      // of shrinking boxes.
      const FRONT_Z = 5;
      const ground = block("ground", 0, 0, 12, 10, 3, 1.5);
      const bedroomsDepth = 7;
      const bedrooms = block(
        "bedrooms",
        0,
        FRONT_Z - bedroomsDepth / 2,
        12,
        bedroomsDepth,
        3,
        1.5
      );
      const suiteDepth = 4;
      const suite = block(
        "suite",
        0,
        FRONT_Z - suiteDepth / 2,
        12,
        suiteDepth,
        3,
        1.5
      );
      // Each stepped-back terrace spans the full width, from the block
      // above's own back wall to the wider block's back wall below it.
      const groundBack = ground.z - ground.depth / 2;
      const bedroomsBack = bedrooms.z - bedrooms.depth / 2;
      const suiteBack = suite.z - suite.depth / 2;
      return {
        base: baseConfigMultiFloor("house", "flat", [[ground], [bedrooms], [suite]]),
        components: [
          placeOnWall("door", "door", ground, "front", 6, 0, "frontDoor"),
          placeOnWall("window-ground-left", "window", ground, "left", 5, 0),
          placeOnWall("window-ground-right", "window", ground, "right", 5, 0),
          placeOnWall("window-bedrooms-front", "window", bedrooms, "front", 6, 1, "threeQuarter"),
          // Onto the terrace formed by the ground floor's roof.
          placeOnWall("door-bedrooms-terrace", "door", bedrooms, "back", 6, 1),
          ...terraceCanopy(
            "bedrooms-terrace",
            1,
            bedrooms.wallHeight,
            0,
            (groundBack + bedroomsBack) / 2,
            bedrooms.width,
            bedroomsBack - groundBack,
            "z",
            -1
          ),
          ...terraceRailings(
            "bedrooms-terrace",
            1,
            0,
            (groundBack + bedroomsBack) / 2,
            bedrooms.width,
            bedroomsBack - groundBack,
            "z",
            -1
          ),
          placeOnWall("window-suite-front", "window", suite, "front", 6, 2, "threeQuarter"),
          // Onto the terrace formed by the bedroom floor's roof.
          placeOnWall("door-suite-terrace", "door", suite, "back", 6, 2),
          ...terraceCanopy(
            "suite-terrace",
            2,
            suite.wallHeight,
            0,
            (bedroomsBack + suiteBack) / 2,
            suite.width,
            suiteBack - bedroomsBack,
            "z",
            -1
          ),
          ...terraceRailings(
            "suite-terrace",
            2,
            0,
            (bedroomsBack + suiteBack) / 2,
            suite.width,
            suiteBack - bedroomsBack,
            "z",
            -1
          ),
        ],
      };
    },
  },
  {
    // Recreates a reference Villa Poggiolina (single-story, twin gable
    // volumes linked by a lower flat-roofed glazed hall) from
    // Downloads/poggiolina — see PLAN.md's reference-house note for what's
    // approximated vs. exact.
    id: "villa-poggiolina",
    label: "Villa Poggiolina (Twin Gable + Glazed Link)",
    buildingType: "house",
    build: () => {
      const leftWing = block("left-wing", -8.25, 0, 11, 7.5, 3, 1.8);
      const rightWing = block("right-wing", 8.25, 0, 11, 7.5, 3, 1.8);
      const connector = blockWith(block("connector", 0, 0, 5.5, 6, 2.6, 0), {
        roofType: "flat",
      });
      return {
        base: baseConfig("house", "gable", [leftWing, connector, rightWing]),
        components: [
          // Entry door near the wing/connector seam, under the eave, plus
          // the tall glazed corner beside it (the connector's own front
          // wall) — matches the front elevation's lit entry.
          placeOnWall("door", "door", leftWing, "front", 9, 0, "frontDoor"),
          placeOnWall("window-connector-front", "window", connector, "front", 2.75, 0, "fullHeight"),
          placeOnWall("window-connector-back", "window", connector, "back", 2.75, 0, "threeQuarter"),
          // The wide sliding terrace door on the main wing's front wall.
          placeOnWall("window-left-terrace", "window", leftWing, "front", 3, 0, "fullHeight"),
          placeOnWall("window-right-front", "window", rightWing, "front", 5.5, 0),
          placeOnWall("window-right-back", "window", rightWing, "back", 5.5, 0),
          // The decorative punched-square-grid gable ends, on both wings'
          // outer walls.
          ...squareWindowGrid("grid-left", 0, leftWing, "left", 5, 6, 0.35, 0.9, 0.4),
          ...squareWindowGrid("grid-right", 0, rightWing, "right", 5, 6, 0.35, 0.9, 0.4),
          ...roofSlotComponent("solar-right", "solarPanel", rightWing, 0, 0, "gable"),
        ],
      };
    },
  },
  {
    // Recreates a reference Chalet Sara (two-story, twin steep-gable
    // volumes with deep overhanging eaves and a wraparound upper-floor
    // balcony) from Downloads/Sara — see PLAN.md's reference-house note.
    id: "chalet-sara",
    label: "Chalet Sara (Twin Gable + Balcony)",
    buildingType: "house",
    build: () => {
      const leftGround = blockWith(block("left-ground", -4.5, 0, 9, 11, 3, 2.6), { ridgeAxis: "z" });
      const rightGround = blockWith(block("right-ground", 4.5, 0, 9, 11, 3, 3.2), { ridgeAxis: "z" });
      const leftUpper = blockWith(block("left-upper", -4.5, 0, 9, 11, 2.8, 2.6), { ridgeAxis: "z" });
      const rightUpper = blockWith(block("right-upper", 4.5, 0, 9, 11, 2.8, 3.2), { ridgeAxis: "z" });
      return {
        base: baseConfigMultiFloor("house", "gable", [
          [leftGround, rightGround],
          [leftUpper, rightUpper],
        ]),
        components: [
          placeOnWall("window-left-ground", "window", leftGround, "front", 4.5, 0, "fullHeight"),
          placeOnWall("window-right-ground", "window", rightGround, "front", 4.5, 0, "fullHeight"),
          placeOnWall("door-left-ground", "door", leftGround, "back", 4.5, 0, "frontDoor"),
          placeOnWall("door-left-balcony", "door", leftUpper, "front", 3, 1),
          placeOnWall("window-left-upper", "window", leftUpper, "front", 6, 1, "threeQuarter"),
          placeOnWall("door-right-balcony", "door", rightUpper, "front", 3, 1),
          placeOnWall("window-right-upper", "window", rightUpper, "front", 6, 1, "threeQuarter"),
          ...simpleBalcony("balcony-left", 1, leftUpper, "front", 1.8),
          ...simpleBalcony("balcony-right", 1, rightUpper, "front", 1.8),
          ...roofSlotComponent("solar-left", "solarPanel", leftUpper, 0, 1, "gable"),
        ],
      };
    },
  },
  {
    id: "compact-hall",
    label: "Compact Hall (12×20m)",
    buildingType: "factoryHall",
    build: () => {
      const main = block("main", 0, 0, 12, 20, 6, 1.5);
      return {
        base: baseConfig("factoryHall", "flat", [main]),
        components: [
          placeOnWall("door", "door", main, "front", 6, 0, "hangar"),
          placeOnWall("window-left", "window", main, "left", 5),
          placeOnWall("window-right", "window", main, "right", 5),
          hallDucting("ducting", 0, main),
          ...hallBracing("main", 0, main),
          hallUnderroofRailing("railing-underroof", 0, main),
        ],
      };
    },
  },
  {
    id: "large-factory-hall",
    label: "Large Factory Hall (24×40m)",
    buildingType: "factoryHall",
    build: () => {
      const main = block("main", 0, 0, 24, 40, 6, 2.5);
      return {
        base: baseConfig("factoryHall", "flat", [main]),
        components: [
          placeOnWall("door", "door", main, "front", 12, 0, "hangar"),
          placeOnWall("window-left-1", "window", main, "left", 10, 0, "fullHeight"),
          placeOnWall("window-left-2", "window", main, "left", 30, 0, "fullHeight"),
          placeOnWall("window-right-1", "window", main, "right", 10, 0, "fullHeight"),
          placeOnWall("window-right-2", "window", main, "right", 30, 0, "fullHeight"),
          hallDucting("ducting", 0, main),
          ...hallBracing("main", 0, main),
          hallUnderroofRailing("railing-underroof", 0, main),
        ],
      };
    },
  },
  {
    id: "u-shaped-factory-hall",
    label: "U-Shaped Factory Hall",
    buildingType: "factoryHall",
    build: () => {
      const main = block("main", 0, 0, 20, 8, 6, 1.5);
      const leftWing = block("left-wing", -7, 11, 6, 14, 6, 1.5);
      const rightWing = block("right-wing", 7, 11, 6, 14, 6, 1.5);
      return {
        base: baseConfig("factoryHall", "flat", [main, leftWing, rightWing]),
        components: [
          placeOnWall("door", "door", main, "front", 10, 0, "double"),
          placeOnWall("window-left-wing", "window", leftWing, "left", 7),
          placeOnWall("window-right-wing", "window", rightWing, "right", 7),
          hallUnderroofRailing("railing-underroof", 0, main),
          hallDucting("ducting-left-wing", 0, leftWing),
          ...hallBracing("left-wing", 0, leftWing),
          hallDucting("ducting-right-wing", 0, rightWing),
          ...hallBracing("right-wing", 0, rightWing),
        ],
      };
    },
  },
];
