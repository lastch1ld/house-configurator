import { TransformControls } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useMemo, useState } from "react";
import * as THREE from "three";
import { floorBaseY } from "../baseGeometry";
import { alongWallPosition, snapComponentToWalls, wallLength } from "../componentSnap";
import { clampComponentToGable } from "../gableGeometry";
import { buildPolygonSlabGeometry, polygonBoundingBox } from "../polygonGeometry";
import { stairSteps } from "../stairs";
import { useConfiguratorStore } from "../store";
import { ImportedModel } from "./ImportedModel";
import type {
  BaseBlock,
  ComponentVariant,
  DoorStyle,
  GlazingFinish,
  PlacedComponent,
  RoofType,
} from "../types";
import {
  DEFAULT_WALL_COLOR,
  ROOF_MATERIALS,
  WALL_MATERIALS,
  resolveWallMaterialId,
  useTiledMaterial,
  type MaterialDef,
  type RoofMaterialId,
} from "./materials";

// ---- Windows/skylights: slim modern glazing, frameless for full-height ----

/** A thin, minimal picture-frame profile (not a boxy casing) — the "classy"
 * read comes from how little of it there is. Two selectable finishes (see
 * `GlazingFinish`), picked per-instance via the scene context menu. */
const GLAZING_FRAME_COLORS: Record<GlazingFinish, string> = {
  anthracite: "#2b2f33",
  white: "#f2f0ea",
};
const GLAZING_FRAME_THICKNESS = 0.045;
export const GLAZING_GLASS_COLOR = "#cfe6ee";
export const GLAZING_GLASS_OPACITY = 0.35;
/** The glass pane's own thickness as a fraction of the component's full
 * depth — thin, since it sits centered within the frame's depth rather than
 * filling it. */
const GLAZING_GLASS_DEPTH_RATIO = 0.4;

/** A slim four-bar frame around a glazing opening. Skipped entirely for
 * full-height windows — deliberately frameless edge-to-edge glass per the
 * design direction, not just this component with a zero-width frame. */
function GlazingFrame({
  width,
  height,
  depth,
  color,
}: {
  width: number;
  height: number;
  depth: number;
  color: string;
}) {
  const t = GLAZING_FRAME_THICKNESS;
  const barHeight = Math.max(height - 2 * t, 0.01);
  return (
    <>
      <mesh position={[0, height / 2 - t / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, t, depth]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.6} />
      </mesh>
      <mesh position={[0, -height / 2 + t / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, t, depth]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.6} />
      </mesh>
      <mesh position={[-width / 2 + t / 2, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[t, barHeight, depth]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.6} />
      </mesh>
      <mesh position={[width / 2 - t / 2, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[t, barHeight, depth]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.6} />
      </mesh>
    </>
  );
}

/** A window/skylight's full visual: a slim frame (see `GlazingFrame`) with
 * an inset glass pane, or — for full-height windows — frameless glass
 * spanning the entire opening. Rendered as a sibling of `ComponentMesh`'s
 * own box, which stays a near-invisible hitbox for these two types. */
function GlazingDetails({
  scale,
  frameless,
  finish,
  isSelected,
}: {
  scale: [number, number, number];
  frameless: boolean;
  finish: GlazingFinish;
  isSelected: boolean;
}) {
  const [width, height, depth] = scale;
  const t = GLAZING_FRAME_THICKNESS;
  const paneWidth = frameless ? width : Math.max(width - 2 * t, 0.02);
  const paneHeight = frameless ? height : Math.max(height - 2 * t, 0.02);
  const glassDepth = Math.max(depth * GLAZING_GLASS_DEPTH_RATIO, 0.01);
  return (
    <>
      {!frameless && (
        <GlazingFrame
          width={width}
          height={height}
          depth={depth}
          color={GLAZING_FRAME_COLORS[finish]}
        />
      )}
      <mesh>
        <boxGeometry args={[paneWidth, paneHeight, glassDepth]} />
        <meshPhysicalMaterial
          color={GLAZING_GLASS_COLOR}
          transparent
          opacity={GLAZING_GLASS_OPACITY}
          roughness={0.05}
          metalness={0}
          reflectivity={0.6}
          depthWrite={false}
          emissive={isSelected ? "#3399ff" : "#000000"}
          emissiveIntensity={isSelected ? 0.3 : 0}
        />
      </mesh>
    </>
  );
}

/** A skylight's own shape: a shallow upstand curb (4 thin vertical walls,
 * full height, no cap on top or bottom) topped with a flat glass lid near
 * the top. Deliberately NOT `GlazingDetails`/`GlazingFrame` reused as-is —
 * those assume a window's axes (X/Y are the flat face, Z is a thin
 * wall-normal depth), but a skylight's box is oriented the other way (X/Z
 * are its flat footprint on the roof, Y is the thin raised height) — reusing
 * the vertical frame code against those swapped axes produced two solid
 * full-footprint plates (its `depth` becoming the frame bars' full-length
 * extent) instead of a real border, which is what actually made it look
 * "goofy," not just its height. */
const SKYLIGHT_CURB_THICKNESS = 0.04;
function SkylightDetails({
  scale,
  finish,
  isSelected,
}: {
  scale: [number, number, number];
  finish: GlazingFinish;
  isSelected: boolean;
}) {
  const [width, height, depth] = scale;
  const color = GLAZING_FRAME_COLORS[finish];
  const t = SKYLIGHT_CURB_THICKNESS;
  const glassThickness = Math.max(height * 0.25, 0.02);
  return (
    <>
      <mesh position={[0, 0, depth / 2 - t / 2]} castShadow receiveShadow>
        <boxGeometry args={[width, height, t]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.6} />
      </mesh>
      <mesh position={[0, 0, -depth / 2 + t / 2]} castShadow receiveShadow>
        <boxGeometry args={[width, height, t]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.6} />
      </mesh>
      <mesh position={[width / 2 - t / 2, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[t, height, depth]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.6} />
      </mesh>
      <mesh position={[-width / 2 + t / 2, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[t, height, depth]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.6} />
      </mesh>
      <mesh position={[0, height / 2 - glassThickness / 2, 0]}>
        <boxGeometry
          args={[Math.max(width - 2 * t, 0.02), glassThickness, Math.max(depth - 2 * t, 0.02)]}
        />
        <meshPhysicalMaterial
          color={GLAZING_GLASS_COLOR}
          transparent
          opacity={GLAZING_GLASS_OPACITY}
          roughness={0.05}
          metalness={0}
          reflectivity={0.6}
          depthWrite={false}
          emissive={isSelected ? "#3399ff" : "#000000"}
          emissiveIntensity={isSelected ? 0.3 : 0}
        />
      </mesh>
    </>
  );
}

const SOLAR_PANEL_FRAME_COLOR = "#4b5563";
const SOLAR_PANEL_CELL_COLOR = "#111827";
const SOLAR_PANEL_FRAME_THICKNESS = 0.04;

/** A solar panel's own shape: a thin frame border (same 4-bar approach as
 * `GlazingFrame`, but sized for a flat roof-mounted panel's X/Z footprint
 * rather than a window's X/Y face) around a darker cell face — deliberately
 * a flat color, not a photoreal PV texture, matching the app's existing
 * level of material detail elsewhere (door panels, skylight glass). */
function SolarPanelDetails({ scale }: { scale: [number, number, number] }) {
  const [width, height, depth] = scale;
  const t = SOLAR_PANEL_FRAME_THICKNESS;
  return (
    <>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={SOLAR_PANEL_FRAME_COLOR} roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh position={[0, height / 2 + 0.001, 0]}>
        <boxGeometry
          args={[Math.max(width - 2 * t, 0.02), 0.01, Math.max(depth - 2 * t, 0.02)]}
        />
        <meshStandardMaterial color={SOLAR_PANEL_CELL_COLOR} roughness={0.2} metalness={0.6} />
      </mesh>
    </>
  );
}

const POOL_RIM_COLOR = "#d8d3c7";
const POOL_WATER_COLOR = "#2f8fb0";
const POOL_RIM_THICKNESS = 0.15;
/** How far below the rim's own top the water surface sits — near the top,
 * not centered, so the rim reads as a shallow curb around a full pool
 * rather than a half-empty tub. */
const POOL_WATER_DEPTH_FROM_RIM = 0.08;

/** A pool's own shape: a solid rim/curb envelope with a flat water-colored
 * top face inset from the edges and sitting just below the rim's own top —
 * deliberately a flat tinted material, not a real-time reflection/
 * refraction shader, matching this app's existing level of material detail
 * (skylight glass, solar panel cells) rather than attempting photoreal water. */
function PoolDetails({ scale }: { scale: [number, number, number] }) {
  const [width, height, depth] = scale;
  const t = POOL_RIM_THICKNESS;
  const waterY = height / 2 - POOL_WATER_DEPTH_FROM_RIM;
  return (
    <>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={POOL_RIM_COLOR} roughness={0.7} metalness={0} />
      </mesh>
      <mesh position={[0, waterY, 0]}>
        <boxGeometry args={[Math.max(width - 2 * t, 0.1), 0.02, Math.max(depth - 2 * t, 0.1)]} />
        <meshPhysicalMaterial
          color={POOL_WATER_COLOR}
          transparent
          opacity={0.85}
          roughness={0.05}
          metalness={0}
          reflectivity={0.5}
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

const STAIRS_COLOR = "#c9c2b4";

/** A straight flight of stairs — one solid box per step (see `stairSteps`),
 * each reaching from the ground to its own tread, so it reads as an actual
 * staircase instead of a single ramp-shaped block. */
function StairsDetails({ scale }: { scale: [number, number, number] }) {
  const [width, height, depth] = scale;
  const steps = stairSteps(width, height, depth);
  return (
    <>
      {steps.map((s, i) => (
        <mesh key={i} position={s.position} castShadow receiveShadow>
          <boxGeometry args={s.size} />
          <meshStandardMaterial color={STAIRS_COLOR} roughness={0.75} metalness={0} />
        </mesh>
      ))}
    </>
  );
}

// ---- Doors: slim casing + a leaf with a recessed panel and handle,
// split into two leaves for "double", ribbed for "garage"/"hangar" ----

const DOOR_FRAME_COLOR = "#241a12";
const DOOR_FRAME_THICKNESS = 0.05;
const DOOR_PANEL_COLOR = "#3a2413";
const DOOR_HANDLE_COLOR = "#cfd3d6";
const DOOR_RIB_COLOR = "#4a4a4a";
const DOOR_HINGE_COLOR = "#1c1c1c";

/** Casing around a door leaf on the two sides and top only — a real
 * doorframe doesn't wrap the threshold. */
function DoorFrame({ width, height, depth }: { width: number; height: number; depth: number }) {
  const t = DOOR_FRAME_THICKNESS;
  return (
    <>
      <mesh position={[0, height / 2 + t / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width + 2 * t, t, depth]} />
        <meshStandardMaterial color={DOOR_FRAME_COLOR} roughness={0.6} />
      </mesh>
      <mesh position={[-width / 2 - t / 2, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[t, height, depth]} />
        <meshStandardMaterial color={DOOR_FRAME_COLOR} roughness={0.6} />
      </mesh>
      <mesh position={[width / 2 + t / 2, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[t, height, depth]} />
        <meshStandardMaterial color={DOOR_FRAME_COLOR} roughness={0.6} />
      </mesh>
    </>
  );
}

/** The classic "paneled" door face — a 2×3 grid of raised panels, each
 * proud of the slab surface (unlike "flush", which has one recessed panel;
 * see `DoorLeaf`). */
function PaneledDoorFace({
  width,
  height,
  depth,
}: {
  width: number;
  height: number;
  depth: number;
}) {
  const cols = 2;
  const rows = 3;
  const marginX = width * 0.12;
  const marginY = height * 0.05;
  const gapX = width * 0.06;
  const gapY = height * 0.04;
  const cellWidth = (width - 2 * marginX - (cols - 1) * gapX) / cols;
  const cellHeight = (height - 2 * marginY - (rows - 1) * gapY) / rows;
  const cellDepth = Math.max(depth * 0.2, 0.015);
  // The slab underneath this (rendered by `DoorLeaf`'s caller as the base
  // envelope box) has its own front face at exactly depth/2 — a cell
  // positioned at any smaller z sits *inside* that opaque slab and is
  // completely hidden behind it, not actually "proud" despite what it looks
  // like on paper. Start each cell flush with that real front face and
  // extend outward by its own thickness so it's genuinely visible.
  const cells: Array<[number, number]> = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push([
        -width / 2 + marginX + cellWidth / 2 + col * (cellWidth + gapX),
        height / 2 - marginY - cellHeight / 2 - row * (cellHeight + gapY),
      ]);
    }
  }
  return (
    <>
      {cells.map(([x, y], i) => (
        <mesh
          key={i}
          position={[x, y, depth / 2 + cellDepth / 2]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[cellWidth, cellHeight, cellDepth]} />
          <meshStandardMaterial color={DOOR_PANEL_COLOR} roughness={0.65} />
        </mesh>
      ))}
    </>
  );
}

/** A tall, slender glazed lite for a "glazed" leaf — a real inset window
 * with its own slim frame (like `GlazingFrame`, just door-proportioned),
 * not a bare pane of glass floating on the surface (which read as a cheap
 * commercial door's vision panel rather than a real entry-door sidelite). */
function DoorGlassLite({ width, height, depth }: { width: number; height: number; depth: number }) {
  const liteWidth = width * 0.28;
  const liteHeight = height * 0.5;
  const liteY = height * 0.16;
  const t = GLAZING_FRAME_THICKNESS;
  const frameDepth = Math.max(depth * 0.3, 0.012);
  const barHeight = Math.max(liteHeight - 2 * t, 0.01);
  return (
    <group position={[0, liteY, 0]}>
      <mesh position={[0, liteHeight / 2 - t / 2, depth / 2 + 0.018]} castShadow>
        <boxGeometry args={[liteWidth, t, frameDepth]} />
        <meshStandardMaterial color={DOOR_FRAME_COLOR} roughness={0.5} />
      </mesh>
      <mesh position={[0, -liteHeight / 2 + t / 2, depth / 2 + 0.018]} castShadow>
        <boxGeometry args={[liteWidth, t, frameDepth]} />
        <meshStandardMaterial color={DOOR_FRAME_COLOR} roughness={0.5} />
      </mesh>
      <mesh position={[-liteWidth / 2 + t / 2, 0, depth / 2 + 0.018]} castShadow>
        <boxGeometry args={[t, barHeight, frameDepth]} />
        <meshStandardMaterial color={DOOR_FRAME_COLOR} roughness={0.5} />
      </mesh>
      <mesh position={[liteWidth / 2 - t / 2, 0, depth / 2 + 0.018]} castShadow>
        <boxGeometry args={[t, barHeight, frameDepth]} />
        <meshStandardMaterial color={DOOR_FRAME_COLOR} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0, depth / 2 + 0.015]}>
        <boxGeometry
          args={[Math.max(liteWidth - 2 * t, 0.02), Math.max(barHeight, 0.02), Math.max(depth * 0.2, 0.008)]}
        />
        <meshPhysicalMaterial
          color={GLAZING_GLASS_COLOR}
          transparent
          opacity={GLAZING_GLASS_OPACITY}
          roughness={0.05}
          metalness={0}
          reflectivity={0.6}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/** Three hinge knuckles on the leaf's edge opposite the handle (the frame
 * side it actually swings from). */
function DoorHinges({
  width,
  height,
  depth,
  handleSide,
}: {
  width: number;
  height: number;
  depth: number;
  handleSide: 1 | -1;
}) {
  const hingeX = -handleSide * (width / 2 - width * 0.07);
  const ys = [-height * 0.35, 0, height * 0.35];
  return (
    <>
      {ys.map((y, i) => (
        <mesh key={i} position={[hingeX, y, depth / 2 + 0.01]} castShadow>
          <boxGeometry args={[0.025, 0.09, 0.02]} />
          <meshStandardMaterial color={DOOR_HINGE_COLOR} roughness={0.5} metalness={0.6} />
        </mesh>
      ))}
    </>
  );
}

/** One door leaf: "flush" (a slim recessed panel), "paneled" (a classic 2×3
 * raised-panel grid — see `PaneledDoorFace`), or "glazed" (flush plus a
 * framed glass lite — see `DoorGlassLite`). Every style gets hinges on the
 * side it swings from and a handle near its closing edge — a small lever,
 * or a long designer pull bar when `premiumHandle` is set (front doors).
 * `handleSide` flips which edge the handle/hinges sit near, since a double
 * door's two leaves open away from each other from the center. */
function DoorLeaf({
  width,
  height,
  depth,
  handleSide,
  style,
  premiumHandle,
}: {
  width: number;
  height: number;
  depth: number;
  handleSide: 1 | -1;
  style: DoorStyle;
  premiumHandle?: boolean;
}) {
  const handleX = handleSide * (width / 2 - width * 0.12);
  return (
    <>
      {style === "paneled" ? (
        <PaneledDoorFace width={width} height={height} depth={depth} />
      ) : (
        // Deliberately a thin, subtle reveal (this is "flush", the plainest
        // style) — but it still has to clear the base slab's own front face
        // at depth/2 or it's rendered entirely hidden behind it, not just
        // "subtle".
        <mesh
          position={[0, 0, depth / 2 + Math.max(depth * 0.06, 0.008) / 2]}
          castShadow
          receiveShadow
        >
          <boxGeometry
            args={[width * 0.78, height * 0.86, Math.max(depth * 0.06, 0.008)]}
          />
          <meshStandardMaterial color={DOOR_PANEL_COLOR} roughness={0.7} />
        </mesh>
      )}
      {style === "glazed" && <DoorGlassLite width={width} height={height} depth={depth} />}
      <DoorHinges width={width} height={height} depth={depth} handleSide={handleSide} />
      {premiumHandle ? (
        <mesh position={[handleX, -height * 0.05, depth / 2 + 0.02]} castShadow>
          <boxGeometry args={[0.025, height * 0.4, 0.025]} />
          <meshStandardMaterial color={DOOR_HANDLE_COLOR} roughness={0.15} metalness={0.9} />
        </mesh>
      ) : (
        <mesh position={[handleX, 0, depth / 2 + 0.015]} castShadow>
          <boxGeometry args={[0.03, 0.16, 0.03]} />
          <meshStandardMaterial color={DOOR_HANDLE_COLOR} roughness={0.3} metalness={0.8} />
        </mesh>
      )}
    </>
  );
}

const DOOR_TRACK_COLOR = "#33383c";
const DOOR_ROLLER_COLOR = "#c9c3b8";

/** The two vertical steel guide tracks a real sectional/roller door rides
 * in, one at each edge, running the full height and proud of the face —
 * plus a small roller "bump" at every section seam, echoing the rollers
 * that actually ride in the track. This is most of what made the previous
 * version read as "empty": a sectional face with nothing at its edges
 * doesn't look like a real mounted door, just a decorated slab floating in
 * its opening. */
function DoorTracks({
  width,
  height,
  depth,
  sectionCount,
}: {
  width: number;
  height: number;
  depth: number;
  sectionCount: number;
}) {
  const trackWidth = Math.min(width * 0.05, 0.08);
  const trackDepth = Math.max(depth * 0.6, 0.03);
  // Flush with the slab's real front face (depth/2) and extending outward
  // from there — the slab itself is opaque, so anything positioned at a
  // smaller z (as this used to be) sits behind it and never renders.
  const trackZ = depth / 2 + trackDepth / 2;
  const xs = [-(width / 2 - trackWidth / 2), width / 2 - trackWidth / 2];
  const rollerY = Array.from(
    { length: sectionCount + 1 },
    (_, i) => -height / 2 + (i * height) / sectionCount
  );
  return (
    <>
      {xs.map((x, i) => (
        <mesh key={i} position={[x, 0, trackZ]} castShadow receiveShadow>
          <boxGeometry args={[trackWidth, height, trackDepth]} />
          <meshStandardMaterial color={DOOR_TRACK_COLOR} roughness={0.4} metalness={0.7} />
        </mesh>
      ))}
      {xs.flatMap((x, xi) =>
        rollerY.map((y, yi) => (
          <mesh key={`${xi}-${yi}`} position={[x, y, trackZ + trackDepth / 2 + 0.015]} castShadow>
            <boxGeometry args={[trackWidth * 1.4, 0.05, 0.03]} />
            <meshStandardMaterial color={DOOR_ROLLER_COLOR} roughness={0.3} metalness={0.8} />
          </mesh>
        ))
      )}
    </>
  );
}

/** Small square lites across the topmost row of a sectional door — the
 * common real-world "garage door with windows in the top panel" detail. */
function DoorRibbingWindows({
  sectionWidth,
  sectionHeight,
  y,
  frontZ,
}: {
  sectionWidth: number;
  sectionHeight: number;
  y: number;
  /** The top row's own front face z (its box center z + half its own
   * depth) — the lites sit just proud of that. */
  frontZ: number;
}) {
  const paneSize = sectionHeight * 0.55;
  const count = Math.max(2, Math.min(6, Math.floor(sectionWidth / (paneSize * 1.8))));
  const spacing = sectionWidth / count;
  const xs = Array.from({ length: count }, (_, i) => -sectionWidth / 2 + spacing / 2 + i * spacing);
  return (
    <>
      {xs.map((x, i) => (
        <mesh key={i} position={[x, y, frontZ + 0.01]}>
          <boxGeometry args={[paneSize, paneSize, Math.max(paneSize * 0.15, 0.008)]} />
          <meshPhysicalMaterial
            color={GLAZING_GLASS_COLOR}
            transparent
            opacity={GLAZING_GLASS_OPACITY}
            roughness={0.05}
            metalness={0}
            reflectivity={0.6}
            depthWrite={false}
          />
        </mesh>
      ))}
    </>
  );
}

/** A real sectional-door face: a grid of raised panel cells (rows AND
 * columns, not just horizontal bands) proud of the base slab with a
 * visible seam gap on every edge, side guide tracks with roller bumps at
 * each row seam, and (for `withWindows`) a row of window lites in the top
 * row — the classic sectional-garage-door look, not a bare slab with a few
 * lines on it. */
function DoorRibbing({
  width,
  height,
  depth,
  withWindows,
}: {
  width: number;
  height: number;
  depth: number;
  /** Garage doors keep the classic top-row window lites; a hangar door is
   * big vehicle-bay hardware, not a house garage, so it skips them. */
  withWindows: boolean;
}) {
  const rowCount = Math.max(3, Math.round(height / 0.55));
  const colCount = Math.max(2, Math.round(width / 1.6));
  const gap = Math.max(
    Math.min(Math.min(height / rowCount, width / colCount) * 0.06, 0.03),
    0.015
  );
  const rowHeight = (height - gap * (rowCount - 1)) / rowCount;
  const colWidth = (width - gap * (colCount - 1)) / colCount;
  const sectionDepth = Math.max(depth * 0.35, 0.025);
  // Flush with the slab's real front face (depth/2) and extending outward
  // from there — the slab itself is opaque, so a cell positioned at a
  // smaller z (as this used to be) sits behind it and is never visible,
  // which is exactly why this read as one flat pane instead of sections.
  const sectionZ = depth / 2 + sectionDepth / 2;
  const topRowY = height / 2 - rowHeight / 2;
  return (
    <>
      <DoorTracks width={width} height={height} depth={depth} sectionCount={rowCount} />
      {Array.from({ length: rowCount }, (_, row) =>
        Array.from({ length: colCount }, (_, col) => {
          const y = -height / 2 + rowHeight / 2 + row * (rowHeight + gap);
          const x = -width / 2 + colWidth / 2 + col * (colWidth + gap);
          return (
            <mesh key={`${row}-${col}`} position={[x, y, sectionZ]} castShadow receiveShadow>
              <boxGeometry args={[colWidth, rowHeight, sectionDepth]} />
              <meshStandardMaterial color={DOOR_RIB_COLOR} roughness={0.55} metalness={0.35} />
            </mesh>
          );
        })
      )}
      {withWindows && rowHeight > 0.35 && (
        <DoorRibbingWindows
          sectionWidth={width * 0.98}
          sectionHeight={rowHeight}
          y={topRowY}
          frontZ={sectionZ + sectionDepth / 2}
        />
      )}
    </>
  );
}

/** A door's full visual detail — casing plus either a single leaf, a
 * center-split double leaf, or horizontal ribbing for the wide vehicle-door
 * variants. The plain colored box in `ComponentMesh` stays the base slab
 * underneath (and the interactive hitbox/shadow-caster); this only adds the
 * casing/panel/handle/ribbing on top of it. */
function DoorDetails({
  scale,
  variant,
  style,
}: {
  scale: [number, number, number];
  variant?: ComponentVariant;
  style: DoorStyle;
}) {
  const [width, height, depth] = scale;
  const ribbed = variant === "garage" || variant === "hangar";
  const double = variant === "double";
  const premiumHandle = variant === "frontDoor";
  return (
    <>
      <DoorFrame width={width} height={height} depth={depth} />
      {ribbed ? (
        <DoorRibbing
          width={width}
          height={height}
          depth={depth}
          withWindows={variant === "garage"}
        />
      ) : double ? (
        <>
          <group position={[-width / 4, 0, 0]}>
            <DoorLeaf
              width={width / 2}
              height={height}
              depth={depth}
              handleSide={1}
              style={style}
              premiumHandle={premiumHandle}
            />
          </group>
          <group position={[width / 4, 0, 0]}>
            <DoorLeaf
              width={width / 2}
              height={height}
              depth={depth}
              handleSide={-1}
              style={style}
              premiumHandle={premiumHandle}
            />
          </group>
          <mesh position={[0, 0, depth / 2 + 0.006]} castShadow>
            <boxGeometry args={[0.015, height, 0.01]} />
            <meshStandardMaterial color={DOOR_FRAME_COLOR} roughness={0.6} />
          </mesh>
        </>
      ) : (
        <DoorLeaf
          width={width}
          height={height}
          depth={depth}
          handleSide={1}
          style={style}
          premiumHandle={premiumHandle}
        />
      )}
    </>
  );
}

// ---- Tables: a thin tabletop plus legs, not a solid block ----

const TABLE_TOP_COLOR = "#b98d5f";
const TABLE_LEG_COLOR = "#6b4f37";

/** A table's real shape — a thin tabletop (round for the "round" variant,
 * a slab otherwise) raised on legs, rather than the solid box the envelope
 * mesh alone would read as. `scale` is the same [width, height, depth] box
 * `resolveComponentSize` computed for this variant. */
function TableDetails({
  scale,
  variant,
}: {
  scale: [number, number, number];
  variant?: ComponentVariant;
}) {
  const [width, height, depth] = scale;
  const round = variant === "round";
  const topThickness = Math.max(height * 0.06, 0.03);
  const topY = height / 2 - topThickness / 2;
  const legHeight = height - topThickness;
  const legY = -height / 2 + legHeight / 2;
  const legInset = Math.min(width, depth) * 0.1;
  const legSize = Math.min(width, depth) * 0.06;

  return (
    <>
      {round ? (
        <mesh position={[0, topY, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[width / 2, width / 2, topThickness, 32]} />
          <meshStandardMaterial color={TABLE_TOP_COLOR} roughness={0.5} />
        </mesh>
      ) : (
        <mesh position={[0, topY, 0]} castShadow receiveShadow>
          <boxGeometry args={[width, topThickness, depth]} />
          <meshStandardMaterial color={TABLE_TOP_COLOR} roughness={0.5} />
        </mesh>
      )}
      {round ? (
        <mesh position={[0, legY, 0]} castShadow receiveShadow>
          <cylinderGeometry
            args={[legSize * 1.3, legSize * 2, legHeight, 16]}
          />
          <meshStandardMaterial color={TABLE_LEG_COLOR} roughness={0.6} />
        </mesh>
      ) : (
        [-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) => (
            <mesh
              key={`${sx}-${sz}`}
              position={[
                sx * (width / 2 - legInset),
                legY,
                sz * (depth / 2 - legInset),
              ]}
              castShadow
              receiveShadow
            >
              <boxGeometry args={[legSize, legHeight, legSize]} />
              <meshStandardMaterial color={TABLE_LEG_COLOR} roughness={0.6} />
            </mesh>
          ))
        )
      )}
    </>
  );
}

/** A railing's own box (component.scale) is only its overall envelope —
 * RailingDetails renders the actual visible bars/posts, so the envelope
 * itself stays a near-invisible hitbox, same treatment as "opening". Also
 * reused, with a more industrial finish, for "underroofRailing". */
const RAILING_COLOR = "#9a9ea3";
/** Max spacing between railing posts — closer together for a short run
 * (still gets its two end posts), wider apart before a long run gets an
 * intermediate post added. */
const RAILING_POST_SPACING = 1.5;
const RAILING_POST_SIZE = 0.06;
const RAILING_TOP_RAIL_HEIGHT = 0.08;
const RAILING_KICK_HEIGHT = 0.06;

// ---- Factory-hall hardware: ducting, underroof railing, cross-bracing —
// a shared galvanized-steel finish ties them together as one "hall
// hardware" palette, distinct from the house-oriented door/window colors ----
const STEEL_COLOR = "#b8bcbf";
const STEEL_JOINT_COLOR = "#7d8184";

const COLOR: Record<PlacedComponent["type"], string> = {
  door: "#5c3a22",
  window: "#a9d6e5",
  column: "#9a9a9a",
  beam: "#6b4f3a",
  table: "#b98d5f",
  /** Only used as the faint selection tint — an opening otherwise renders
   * as a near-invisible cutout, not a solid box. */
  opening: "#3399ff",
  // Rendered by TexturedComponentMesh (real roof/wall material), not here.
  roofSection: "#8a6a4a",
  wallSection: "#c9c2b4",
  railing: RAILING_COLOR,
  skylight: "#a9d6e5",
  // Only used as the faint selection tint — the real frame+panel is
  // SolarPanelDetails below, same "invisible hitbox" treatment as table/bracing.
  solarPanel: "#1f2937",
  ducting: STEEL_COLOR,
  underroofRailing: RAILING_COLOR,
  // Only used as the faint selection tint — see "opening"/"bracing" branch
  // below, which renders the actual X-brace as a BracingDetails sibling.
  bracing: STEEL_COLOR,
  // Only used as the faint selection tint — the real rim+water is
  // PoolDetails below, same "invisible hitbox" treatment as table/bracing.
  pool: POOL_RIM_COLOR,
  // Only used as the faint selection tint — the real steps are
  // StairsDetails below, same "invisible hitbox" treatment as table/bracing.
  stairs: STAIRS_COLOR,
  // Balcony's own box IS the visible slab (like roofSection/wallSection's
  // solid-panel treatment) — its railing is a separate sibling `railing`
  // component baked at creation time (see `addBalcony` in store.ts), not a
  // Details sibling here.
  balcony: "#b8b2a3",
  // Rendered by ImportedModel (the file's own loaded geometry/materials),
  // not here — present only for Record exhaustiveness.
  model: "#888888",
};

/** Evenly spaced post x-offsets along a railing's own local width, always
 * including both ends. */
function railingPostOffsets(width: number): number[] {
  const count = Math.max(2, Math.ceil(width / RAILING_POST_SPACING) + 1);
  return Array.from({ length: count }, (_, i) => -width / 2 + (width * i) / (count - 1));
}

/** The actual visible parts of a railing — a thin top rail and kick plate
 * spanning its full width, plus evenly spaced posts — rendered in the
 * component's own local space so they rotate with it. Reads as an open
 * guardrail instead of the solid slab a single box would look like. `color`
 * lets "underroofRailing" reuse this with a more industrial finish. */
function RailingDetails({
  scale,
  color = RAILING_COLOR,
}: {
  scale: [number, number, number];
  color?: string;
}) {
  const [width, height, thickness] = scale;
  return (
    <>
      <mesh position={[0, height / 2 - RAILING_TOP_RAIL_HEIGHT / 2, 0]}>
        <boxGeometry args={[width, RAILING_TOP_RAIL_HEIGHT, thickness]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh position={[0, -height / 2 + RAILING_KICK_HEIGHT / 2, 0]}>
        <boxGeometry args={[width, RAILING_KICK_HEIGHT, thickness]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.5} />
      </mesh>
      {railingPostOffsets(width).map((x, i) => (
        <mesh key={i} position={[x, 0, 0]}>
          <boxGeometry args={[RAILING_POST_SIZE, height, RAILING_POST_SIZE]} />
          <meshStandardMaterial color={color} roughness={0.4} metalness={0.5} />
        </mesh>
      ))}
    </>
  );
}

/** A duct run's accessories — joint bands at regular intervals plus a
 * ceiling hanger strap at each end — layered on top of the main duct body,
 * which is `ComponentMesh`'s own visible box (like a door's slab), not
 * rendered here. */
function DuctingDetails({
  scale,
  hangers = [0.12, 0.88],
}: {
  scale: [number, number, number];
  /** Fractions (0-1) along the duct's length — see `PlacedComponent.ductHangers`. */
  hangers?: [number, number];
}) {
  const [length, crossH, crossD] = scale;
  const bandThickness = Math.max(length * 0.03, 0.02);
  const bandCount = Math.max(2, Math.round(length / 0.9));
  const bandXs = Array.from(
    { length: bandCount - 1 },
    (_, i) => -length / 2 + ((i + 1) * length) / bandCount
  );
  const hangerHeight = 0.15;
  const hangerXs = hangers.map((f) => -length / 2 + f * length);
  return (
    <>
      {bandXs.map((x, i) => (
        <mesh key={i} position={[x, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[bandThickness, crossH * 1.06, crossD * 1.06]} />
          <meshStandardMaterial color={STEEL_JOINT_COLOR} roughness={0.5} metalness={0.6} />
        </mesh>
      ))}
      {hangerXs.map((x, i) => (
        <mesh key={i} position={[x, crossH / 2 + hangerHeight / 2, 0]} castShadow>
          <boxGeometry args={[0.03, hangerHeight, 0.03]} />
          <meshStandardMaterial color={STEEL_JOINT_COLOR} roughness={0.5} metalness={0.6} />
        </mesh>
      ))}
    </>
  );
}

/** A diagonal steel "X" cross-brace spanning this component's own
 * width/height envelope — the kind of stabilizing structure a steel-frame
 * hall's bays typically have. Rendered as the component's whole visual
 * (its own box stays a near-invisible hitbox, like "opening"/"railing"). */
function BracingDetails({ scale }: { scale: [number, number, number] }) {
  const [width, height, thickness] = scale;
  const rodCross = Math.max(thickness, 0.06);
  const diagLength = Math.hypot(width, height);
  const angle = Math.atan2(height, width);
  return (
    <>
      <mesh rotation={[0, 0, angle]} castShadow receiveShadow>
        <boxGeometry args={[diagLength, rodCross, rodCross]} />
        <meshStandardMaterial color={STEEL_COLOR} roughness={0.4} metalness={0.7} />
      </mesh>
      <mesh rotation={[0, 0, -angle]} castShadow receiveShadow>
        <boxGeometry args={[diagLength, rodCross, rodCross]} />
        <meshStandardMaterial color={STEEL_COLOR} roughness={0.4} metalness={0.7} />
      </mesh>
    </>
  );
}

/** The real solid for a merged (L-shaped) balcony — `component.polygon` is
 * already absolute world x/z (see `addBalcony` in store.ts), so this needs
 * no position/rotation of its own, unlike every other *Details component
 * here which rides along on its own component's `position`/`rotation`
 * group. A simple (non-merged) balcony has no `polygon` and keeps using the
 * plain box below instead. */
function BalconySlabDetails({
  polygon,
  yMin,
  thickness,
  color,
}: {
  polygon: { x: number; z: number }[];
  yMin: number;
  thickness: number;
  color: string;
}) {
  const geometry = useMemo(
    () => buildPolygonSlabGeometry(polygon, thickness, yMin),
    [polygon, thickness, yMin]
  );
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color={color} side={THREE.DoubleSide} />
    </mesh>
  );
}

function ComponentMesh({
  component,
  blocks,
  siblingComponents,
  interactive,
  roofType,
  isTopFloor,
}: {
  component: PlacedComponent;
  /** This component's own floor's blocks — snapping must only ever
   * consider walls on the same floor. */
  blocks: BaseBlock[];
  /** Every placed component on this same floor, including this one —
   * passed down from the already-filtered per-floor list in
   * `PlacedComponents` so this never re-subscribes to the whole store. */
  siblingComponents: PlacedComponent[];
  /** Whether this component's floor is the one currently being edited. */
  interactive: boolean;
  roofType: RoofType;
  isTopFloor: boolean;
}) {
  const [mesh, setMesh] = useState<THREE.Mesh | null>(null);
  const selectedIds = useConfiguratorStore((s) => s.selectedIds);
  const selectComponent = useConfiguratorStore((s) => s.selectComponent);
  const toggleComponentSelection = useConfiguratorStore(
    (s) => s.toggleComponentSelection
  );
  const selectBlock = useConfiguratorStore((s) => s.selectBlock);
  const updateComponent = useConfiguratorStore((s) => s.updateComponent);
  // Every other same-floor component, for the drag-snap's overlap check
  // below — excludes this one so it never "overlaps itself".
  const sameFloorOthers = useMemo(
    () => siblingComponents.filter((c) => c.id !== component.id),
    [siblingComponents, component.id]
  );
  const isSelected = interactive && selectedIds.includes(component.id);

  // A merged (L-shaped) balcony's real shape comes from BalconySlabDetails
  // below (rendered straight from its own absolute-world `polygon`, no
  // position/rotation) — this hitbox just needs to roughly cover it for
  // click-to-select, sized/centered from the polygon's own bounding box.
  const isPolygonBalcony = component.type === "balcony" && !!component.polygon;
  const hitboxBox = isPolygonBalcony ? polygonBoundingBox(component.polygon!) : null;

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const additive =
      e.nativeEvent.ctrlKey || e.nativeEvent.metaKey || e.nativeEvent.shiftKey;
    if (additive) {
      toggleComponentSelection(component.id);
      return;
    }
    selectBlock(null);
    selectComponent(component.id);
  };

  const handleTransformChange = () => {
    if (!mesh) return;
    updateComponent(component.id, {
      position: mesh.position.toArray() as [number, number, number],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale: mesh.scale.toArray() as [number, number, number],
    });
  };

  // Snap to the nearest wall once the drag finishes, so the snap doesn't
  // fight TransformControls' own per-frame drag calculations.
  const handleDragEnd = () => {
    if (!mesh) return;
    const { position, rotationY, wallRef } = snapComponentToWalls(
      mesh.position.toArray() as [number, number, number],
      blocks,
      component.type,
      component.scale[0],
      sameFloorOthers,
      roofType,
      isTopFloor
    );

    // A gable candidate is only validated at the raw drag point by
    // snapComponentToWalls (see fitsOnGableCap) — now that the component's
    // real width/height are known, clamp its final offset/height so it
    // doesn't end up straddling outside the roof's taper or poking past
    // the ridge, the same finishing step addComponent (store.ts) applies.
    let finalPosition = position;
    let finalWallRef = wallRef ?? undefined;
    if (wallRef?.gable) {
      const wallBlock = blocks.find((b) => b.id === wallRef.blockId);
      if (wallBlock) {
        const span = wallLength(wallBlock, wallRef.location);
        const clickV = position[1] - wallBlock.wallHeight;
        const { offset, centerV } = clampComponentToGable(
          span,
          wallBlock.roofHeight,
          wallRef.offset,
          component.scale[0],
          clickV,
          component.scale[1]
        );
        finalWallRef = { ...wallRef, offset };
        const { x, z } = alongWallPosition(wallBlock, wallRef.location, offset, component.type, true);
        finalPosition = [x, wallBlock.wallHeight + centerV, z];
      }
    }

    mesh.position.set(...finalPosition);
    if (rotationY !== null) mesh.rotation.y = rotationY;
    updateComponent(component.id, {
      position: finalPosition,
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      wallRef: finalWallRef,
    });
  };

  return (
    <>
      <mesh
        ref={setMesh}
        position={
          hitboxBox
            ? [(hitboxBox.left + hitboxBox.right) / 2, component.position[1], (hitboxBox.back + hitboxBox.front) / 2]
            : component.position
        }
        rotation={hitboxBox ? [0, 0, 0] : component.rotation}
        scale={
          hitboxBox
            ? [hitboxBox.right - hitboxBox.left, component.scale[1], hitboxBox.front - hitboxBox.back]
            : component.scale
        }
        userData={interactive ? { componentId: component.id } : undefined}
        onClick={interactive ? handleClick : undefined}
        // Shadow maps are depth-only and don't understand transmission, so a
        // transmissive mesh would cast a fully opaque shadow blob instead of
        // a glass-like one — worse than no shadow at all. Windows/skylights
        // get their real shadow-casting from GlazingDetails' frame bars
        // below, not from this box; bracing's from BracingDetails' rods.
        castShadow={
          component.type !== "opening" &&
          component.type !== "window" &&
          component.type !== "skylight" &&
          component.type !== "solarPanel" &&
          component.type !== "bracing" &&
          component.type !== "pool" &&
          component.type !== "stairs"
        }
      >
        <boxGeometry args={[1, 1, 1]} />
        {component.type === "window" || component.type === "skylight" ? (
          // The real glazing (slim frame + glass, or frameless glass for
          // full-height windows) renders as a GlazingDetails sibling below
          // — this box stays a near-invisible hitbox so click-to-select,
          // drag, and TransformControls (which all target this exact mesh)
          // keep working unchanged.
          <meshStandardMaterial
            color={COLOR[component.type]}
            transparent
            depthWrite={false}
            opacity={isSelected ? 0.15 : 0}
            emissive={isSelected ? "#3399ff" : "#000000"}
            emissiveIntensity={isSelected ? 0.3 : 0}
          />
        ) : component.type === "opening" ? (
          // A bare cutout — no frame, so it stays a faint tint rather than
          // a solid box, but is still clickable/resizable in the editor.
          <meshStandardMaterial
            color={COLOR.opening}
            transparent
            depthWrite={false}
            opacity={isSelected ? 0.25 : 0.06}
          />
        ) : component.type === "railing" || component.type === "underroofRailing" ? (
          // The envelope itself stays a near-invisible hitbox — the actual
          // rail/posts are RailingDetails below, rendered separately so
          // they don't get squashed by this mesh's own non-uniform scale.
          <meshStandardMaterial
            color={COLOR[component.type]}
            transparent
            depthWrite={false}
            opacity={isSelected ? 0.2 : 0.04}
          />
        ) : isPolygonBalcony ? (
          // Same near-invisible-hitbox treatment — the real L-shaped solid
          // is BalconySlabDetails below.
          <meshStandardMaterial
            color={COLOR.balcony}
            transparent
            depthWrite={false}
            opacity={isSelected ? 0.2 : 0.04}
          />
        ) : component.type === "bracing" ? (
          // Same near-invisible-hitbox treatment — the real "X" is
          // BracingDetails below.
          <meshStandardMaterial
            color={COLOR.bracing}
            transparent
            depthWrite={false}
            opacity={isSelected ? 0.2 : 0.04}
          />
        ) : component.type === "table" ? (
          // Same near-invisible-hitbox treatment — the real tabletop/legs
          // are TableDetails below, so this solid-box envelope doesn't
          // render as a plain wooden block underneath them.
          <meshStandardMaterial
            color={COLOR.table}
            transparent
            depthWrite={false}
            opacity={isSelected ? 0.2 : 0.04}
          />
        ) : component.type === "solarPanel" ? (
          // Same near-invisible-hitbox treatment — the real frame+panel is
          // SolarPanelDetails below.
          <meshStandardMaterial
            color={COLOR.solarPanel}
            transparent
            depthWrite={false}
            opacity={isSelected ? 0.2 : 0.04}
          />
        ) : component.type === "pool" ? (
          // Same near-invisible-hitbox treatment — the real rim+water is
          // PoolDetails below.
          <meshStandardMaterial
            color={COLOR.pool}
            transparent
            depthWrite={false}
            opacity={isSelected ? 0.2 : 0.04}
          />
        ) : component.type === "stairs" ? (
          // Same near-invisible-hitbox treatment — the real steps are
          // StairsDetails below.
          <meshStandardMaterial
            color={COLOR.stairs}
            transparent
            depthWrite={false}
            opacity={isSelected ? 0.2 : 0.04}
          />
        ) : (
          <meshStandardMaterial
            color={COLOR[component.type]}
            emissive={isSelected ? "#3399ff" : "#000000"}
            emissiveIntensity={isSelected ? 0.3 : 0}
          />
        )}
      </mesh>
      {isPolygonBalcony && (
        <BalconySlabDetails
          polygon={component.polygon!}
          yMin={component.position[1]}
          thickness={component.scale[1]}
          color={COLOR.balcony}
        />
      )}
      {(component.type === "railing" || component.type === "underroofRailing") && (
        <group position={component.position} rotation={component.rotation}>
          <RailingDetails scale={component.scale} color={COLOR[component.type]} />
        </group>
      )}
      {component.type === "table" && (
        <group position={component.position} rotation={component.rotation}>
          <TableDetails scale={component.scale} variant={component.variant} />
        </group>
      )}
      {component.type === "door" && (
        <group position={component.position} rotation={component.rotation}>
          <DoorDetails
            scale={component.scale}
            variant={component.variant}
            style={component.doorStyle ?? "flush"}
          />
        </group>
      )}
      {component.type === "window" && (
        <group position={component.position} rotation={component.rotation}>
          <GlazingDetails
            scale={component.scale}
            frameless={component.variant === "fullHeight"}
            finish={component.glazingFinish ?? "anthracite"}
            isSelected={isSelected}
          />
        </group>
      )}
      {component.type === "skylight" && (
        <group position={component.position} rotation={component.rotation}>
          <SkylightDetails
            scale={component.scale}
            finish={component.glazingFinish ?? "anthracite"}
            isSelected={isSelected}
          />
        </group>
      )}
      {component.type === "solarPanel" && (
        <group position={component.position} rotation={component.rotation}>
          <SolarPanelDetails scale={component.scale} />
        </group>
      )}
      {component.type === "pool" && (
        <group position={component.position} rotation={component.rotation}>
          <PoolDetails scale={component.scale} />
        </group>
      )}
      {component.type === "stairs" && (
        <group position={component.position} rotation={component.rotation}>
          <StairsDetails scale={component.scale} />
        </group>
      )}
      {component.type === "ducting" && (
        <group position={component.position} rotation={component.rotation}>
          <DuctingDetails scale={component.scale} hangers={component.ductHangers} />
        </group>
      )}
      {component.type === "bracing" && (
        <group position={component.position} rotation={component.rotation}>
          <BracingDetails scale={component.scale} />
        </group>
      )}
      {isSelected && mesh && (
        <TransformControls
          object={mesh}
          mode="translate"
          onObjectChange={handleTransformChange}
          onMouseUp={handleDragEnd}
        />
      )}
    </>
  );
}

/** A freestanding roof or wall section — a plain box like the others, but
 * textured with the building's own roof/wall material (tiled to the
 * section's own width/length or width/height) instead of a flat color, so
 * it reads as an actual patch of roof or wall rather than a colored block.
 * Kept as its own component (not a branch inside `ComponentMesh`) so the
 * `useTiledMaterial` texture load only ever happens for these two types. */
function TexturedComponentMesh({
  component,
  interactive,
  def,
  tileWidth,
  tileHeight,
  color,
}: {
  component: PlacedComponent;
  interactive: boolean;
  def: MaterialDef;
  tileWidth: number;
  tileHeight: number;
  /** Only visible when `def.tintable` — see useTiledMaterial. Passed for a
   * freestanding wallSection (same wall-material texture as the walls
   * themselves) and omitted for roofSection, which is never tintable. */
  color?: string;
}) {
  const [mesh, setMesh] = useState<THREE.Mesh | null>(null);
  const selectedIds = useConfiguratorStore((s) => s.selectedIds);
  const selectComponent = useConfiguratorStore((s) => s.selectComponent);
  const toggleComponentSelection = useConfiguratorStore(
    (s) => s.toggleComponentSelection
  );
  const selectBlock = useConfiguratorStore((s) => s.selectBlock);
  const updateComponent = useConfiguratorStore((s) => s.updateComponent);
  const isSelected = interactive && selectedIds.includes(component.id);
  const materialProps = useTiledMaterial(def, tileWidth, tileHeight, false, color);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const additive =
      e.nativeEvent.ctrlKey || e.nativeEvent.metaKey || e.nativeEvent.shiftKey;
    if (additive) {
      toggleComponentSelection(component.id);
      return;
    }
    selectBlock(null);
    selectComponent(component.id);
  };

  const handleTransformChange = () => {
    if (!mesh) return;
    updateComponent(component.id, {
      position: mesh.position.toArray() as [number, number, number],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale: mesh.scale.toArray() as [number, number, number],
    });
  };

  return (
    <>
      <mesh
        ref={setMesh}
        position={component.position}
        rotation={component.rotation}
        scale={component.scale}
        userData={interactive ? { componentId: component.id } : undefined}
        onClick={interactive ? handleClick : undefined}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          {...materialProps}
          emissive={isSelected ? "#3399ff" : "#000000"}
          // Lower than other components' 0.3 — the same intensity spread
          // over a multi-meter roof/wall panel reads as a glaring wash
          // rather than a subtle tint.
          emissiveIntensity={isSelected ? 0.12 : 0}
        />
      </mesh>
      {isSelected && mesh && (
        <TransformControls
          object={mesh}
          mode="translate"
          onObjectChange={handleTransformChange}
        />
      )}
    </>
  );
}

export function PlacedComponents() {
  const components = useConfiguratorStore((s) => s.components);
  const floors = useConfiguratorStore((s) => s.base.floors);
  const activeFloorIndex = useConfiguratorStore((s) => s.activeFloorIndex);
  // "View inside" hides the roof entirely (Base.tsx) — a skylight/solar
  // panel is part of the roof, not a freestanding fixture, so it needs to
  // disappear right along with it. Otherwise it stayed fully rendered,
  // floating in place with nothing around it once the roof under it vanished.
  const transparentWalls = useConfiguratorStore((s) => s.transparentWalls);
  const roofDef = useConfiguratorStore(
    (s) => ROOF_MATERIALS[s.base.roofMaterialId as RoofMaterialId]
  );
  const wallDef = useConfiguratorStore((s) =>
    WALL_MATERIALS[resolveWallMaterialId(s.base.wallMaterialId, s.base.buildingType)]
  );
  const wallColor = useConfiguratorStore((s) => s.base.wallColor ?? DEFAULT_WALL_COLOR);
  const roofType = useConfiguratorStore((s) => s.base.roofType);

  return (
    <>
      {floors.map((floor, floorIndex) => {
        const floorComponents = components.filter(
          (c) => c.floorIndex === floorIndex
        );
        const isTopFloor = floorIndex === floors.length - 1;
        return (
        <group key={floor.id} position={[0, floorBaseY(floors, floorIndex), 0]}>
          {floorComponents
            .filter(
              (c) =>
                !((c.type === "skylight" || c.type === "solarPanel") && transparentWalls)
            )
            .map((c) => {
              const interactive = floorIndex === activeFloorIndex;
              if (c.type === "roofSection") {
                return (
                  <TexturedComponentMesh
                    key={c.id}
                    component={c}
                    interactive={interactive}
                    def={roofDef}
                    tileWidth={c.scale[0]}
                    tileHeight={c.scale[2]}
                  />
                );
              }
              if (c.type === "wallSection") {
                return (
                  <TexturedComponentMesh
                    key={c.id}
                    component={c}
                    interactive={interactive}
                    def={wallDef}
                    tileWidth={c.scale[0]}
                    tileHeight={c.scale[1]}
                    color={wallColor}
                  />
                );
              }
              if (c.type === "model") {
                return (
                  <ImportedModel key={c.id} component={c} interactive={interactive} />
                );
              }
              return (
                <ComponentMesh
                  key={c.id}
                  component={c}
                  blocks={floor.blocks}
                  siblingComponents={floorComponents}
                  interactive={interactive}
                  roofType={roofType}
                  isTopFloor={isTopFloor}
                />
              );
            })}
        </group>
        );
      })}
    </>
  );
}
