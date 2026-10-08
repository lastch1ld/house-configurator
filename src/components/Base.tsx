import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  edges,
  floorBaseY,
  getBlockOpenings,
  getPolygonBlockOpenings,
  getComponentOpenings,
  getPolygonEdgeComponentOpenings,
  isFullyOpen,
  localizeComponentOpenings,
  localizeOpenings,
  wallPanels,
  wallRunSegments,
} from "../baseGeometry";
import type { BlockOpenings, ComponentOpenings, Interval, WallPanel, WallRunSegment } from "../baseGeometry";
import { FLAT_ROOF_THICKNESS, FLOOR_SLAB_THICKNESS, WALL_THICKNESS } from "../constants";
import { buildGableGeometry, gableRoofSlopes, monoPitchSlope } from "../gableGeometry";
import { buildHipRoofGeometry } from "../hipRoofGeometry";
import {
  buildPolygonSlabGeometry,
  buildPolygonWallGeometry,
  insetPolygon,
} from "../polygonGeometry";
import { useConfiguratorStore } from "../store";
import type { BaseBlock, PlacedComponent, RidgeAxis, RoofType } from "../types";
import {
  DEFAULT_WALL_COLOR,
  ROOF_MATERIALS,
  WALL_MATERIALS,
  resolveWallMaterialId,
  useTiledMaterial,
  type MaterialDef,
  type RoofMaterialId,
  type WallMaterialId,
} from "./materials";

/** Slightly larger than the wall thickness so the post's faces sit just
 * outside the walls' own end caps and reliably win the depth test instead
 * of z-fighting with them. */
const CORNER_POST_SIZE = WALL_THICKNESS + 0.01;

/** How far a trim band (fascia/plinth) protrudes past the wall face — just
 * enough to read as a distinct lip, not a second wall. */
const TRIM_PROTRUSION = 0.05;
const FASCIA_HEIGHT = 0.12;
const FASCIA_COLOR = "#2b2723";

interface WallShadowProps {
  castShadow: boolean;
  receiveShadow: boolean;
}

/** Folds a polygon neighbor's block-to-block openings (PLAN.md §6 Phase C —
 * `getPolygonBlockOpenings`'s `rect` side) onto a rectangle block's own
 * rect/rect openings (`getBlockOpenings`), so a polygon block touching one
 * of its flat sides opens a doorway there too, same as another rectangle
 * would. `extra` is undefined for a polygon block, which never reaches this
 * (see its call site). */
function mergeRectOpenings(base: BlockOpenings, extra: BlockOpenings | undefined): BlockOpenings {
  if (!extra) return base;
  return {
    left: [...base.left, ...extra.left],
    right: [...base.right, ...extra.right],
    front: [...base.front, ...extra.front],
    back: [...base.back, ...extra.back],
  };
}

/** A thin flat-colored band wrapping a block's whole footprint, protruding
 * slightly past the wall face — used for the fascia line just under the
 * roof and the plinth line at the wall base, so the wall-to-roof and
 * wall-to-ground junctions read as actual details instead of a bare box
 * meeting another bare box. Flat color (no texture) on purpose: it's a
 * universal trim accent, not tied to whichever wall material is active. */
function TrimBand({
  width,
  depth,
  y,
  height,
  color,
  wallShadowProps,
}: {
  width: number;
  depth: number;
  y: number;
  height: number;
  color: string;
  wallShadowProps: WallShadowProps;
}) {
  return (
    <mesh position={[0, y, 0]} {...wallShadowProps}>
      <boxGeometry args={[width + TRIM_PROTRUSION * 2, height, depth + TRIM_PROTRUSION * 2]} />
      <meshStandardMaterial color={color} roughness={0.85} />
    </mesh>
  );
}

function GableEnd({
  offset,
  span,
  roofHeight,
  wallMaterialId,
  wallColor,
  ridgeAxis,
  blockId,
  interactive,
  onClick,
  apexZ = 0,
}: {
  /** Position along the ridge axis (±width/2 for "x", ±depth/2 for "z"). */
  offset: number;
  /** The perpendicular dimension the triangular cap spans — depth for "x",
   * width for "z". */
  span: number;
  roofHeight: number;
  wallMaterialId: WallMaterialId;
  wallColor: string;
  ridgeAxis: RidgeAxis;
  blockId: string;
  interactive: boolean;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  /** Ridge position within the cap's own span — 0 (default) for a centered
   * gable triangle, ±span/2 for a mono-pitch's asymmetric right-triangle
   * end (matching the mono-pitch slope's high side). */
  apexZ?: number;
}) {
  const def = WALL_MATERIALS[wallMaterialId];
  const geometry = useMemo(
    () => buildGableGeometry(span, roofHeight, WALL_THICKNESS, def.tileSize, apexZ),
    [span, roofHeight, def.tileSize, apexZ]
  );
  // useMemo swaps in a brand-new BufferGeometry on every recompute (span/
  // roofHeight/tileSize change) — R3F only auto-disposes a mesh's geometry
  // on unmount, not when the geometry prop value changes, so the outgoing
  // one must be disposed explicitly here or its GPU buffers leak.
  useEffect(() => {
    return () => geometry.dispose();
  }, [geometry]);
  // UVs are already pre-scaled to tile units in the geometry itself (the
  // triangle's real proportions don't map to a plain box's 0-1 UV), so ask
  // for repeat=(1,1) by passing width/height equal to the tile size.
  const materialProps = useTiledMaterial(def, def.tileSize, def.tileSize, false, wallColor);
  // The geometry is always built extruded along local X, spanning `span`
  // along Z (see buildGableGeometry) — for a "z" ridge the cap needs to sit
  // at the front/back instead, extruded along Z and spanning `span` along
  // X, which a 90° yaw achieves without rebuilding the geometry.
  const position: [number, number, number] =
    ridgeAxis === "z" ? [0, 0, offset] : [offset, 0, 0];
  const rotation: [number, number, number] =
    ridgeAxis === "z" ? [0, Math.PI / 2, 0] : [0, 0, 0];
  return (
    <mesh
      geometry={geometry}
      position={position}
      rotation={rotation}
      castShadow
      receiveShadow
      onClick={interactive ? onClick : undefined}
      userData={interactive ? { blockId } : undefined}
    >
      <meshStandardMaterial {...materialProps} />
    </mesh>
  );
}

/** A full hip roof — all 4 sloped faces as one custom geometry (see
 * `buildHipRoofGeometry`), unlike gable/mono-pitch which need a separate
 * vertical gable-end infill: a hip roof's walls stay flat at `wallHeight`
 * on every side, with the roof itself closing the volume directly, so
 * there's nothing extra to render beyond this one mesh. */
function HipRoof({
  span,
  perp,
  roofHeight,
  ridgeAxis,
  roofDef,
}: {
  /** The ridge-axis dimension (block width for ridgeAxis "x", depth for "z"). */
  span: number;
  /** The perpendicular dimension. */
  perp: number;
  roofHeight: number;
  ridgeAxis: RidgeAxis;
  roofDef: MaterialDef;
}) {
  const geometry = useMemo(
    () => buildHipRoofGeometry(span, perp, roofHeight, roofDef.tileSize),
    [span, perp, roofHeight, roofDef.tileSize]
  );
  useEffect(() => {
    return () => geometry.dispose();
  }, [geometry]);
  const materialProps = useTiledMaterial(roofDef, roofDef.tileSize, roofDef.tileSize, false);
  const rotation: [number, number, number] = ridgeAxis === "z" ? [0, Math.PI / 2, 0] : [0, 0, 0];
  return (
    <mesh geometry={geometry} rotation={rotation} castShadow receiveShadow>
      <meshStandardMaterial {...materialProps} />
    </mesh>
  );
}

/** A single wall panel with its texture tiled to its own real-world size. */
function TexturedPanel({
  def,
  size,
  position,
  rotation,
  tileWidth,
  tileHeight,
  transparentWalls = false,
  color,
  wallShadowProps,
  onClick,
  userData,
}: {
  def: MaterialDef;
  size: [number, number, number];
  position: [number, number, number];
  rotation?: [number, number, number];
  tileWidth: number;
  tileHeight: number;
  transparentWalls?: boolean;
  /** Only visible when `def.tintable` — passed for every panel built from
   * the wall material (floor/ceiling slabs, corner posts, walls) and
   * omitted for roof panels, which are never tintable. */
  color?: string;
  wallShadowProps: WallShadowProps;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  userData?: Record<string, unknown>;
}) {
  const materialProps = useTiledMaterial(def, tileWidth, tileHeight, transparentWalls, color);
  return (
    <mesh
      position={position}
      rotation={rotation}
      onClick={onClick}
      userData={userData}
      {...wallShadowProps}
    >
      <boxGeometry args={size} />
      <meshStandardMaterial
        key={transparentWalls ? "transparent" : "opaque"}
        {...materialProps}
      />
    </mesh>
  );
}

/** Renders the solid panels of a wall that runs along local X (front/back walls). */
function XWallSegments({
  panels,
  z,
  def,
  transparentWalls,
  color,
  wallShadowProps,
}: {
  panels: WallPanel[];
  z: number;
  def: MaterialDef;
  transparentWalls: boolean;
  color: string;
  wallShadowProps: WallShadowProps;
}) {
  return (
    <>
      {panels.map((p, i) => (
        <TexturedPanel
          key={i}
          def={def}
          size={[p.hMax - p.hMin, p.vMax - p.vMin, WALL_THICKNESS]}
          position={[(p.hMin + p.hMax) / 2, (p.vMin + p.vMax) / 2, z]}
          tileWidth={p.hMax - p.hMin}
          tileHeight={p.vMax - p.vMin}
          transparentWalls={transparentWalls}
          color={color}
          wallShadowProps={wallShadowProps}
        />
      ))}
    </>
  );
}

const CORNER_EPS = 0.01;

/** Whether `block`'s whole footprint sits inside some single block on the
 * floor above it. When true, that upper block's own floor slab (see
 * BlockMesh's "Floor" mesh) already closes this block's top, so rendering
 * another ceiling here would just double up into a z-fighting seam. When
 * false — no block above at all, or only a partial/shifted overlap — this
 * block needs its own ceiling so it isn't left open to the sky. */
function isFullyCoveredAbove(block: BaseBlock, blocksAbove: BaseBlock[]): boolean {
  const e = edges(block);
  return blocksAbove.some((above) => {
    const ae = edges(above);
    return (
      ae.left <= e.left + CORNER_EPS &&
      ae.right >= e.right - CORNER_EPS &&
      ae.back <= e.back + CORNER_EPS &&
      ae.front >= e.front - CORNER_EPS
    );
  });
}

/** Renders the solid panels of a wall that runs along local Z (left/right
 * walls). Front/back walls run the full width of the block, corner to
 * corner; left/right walls butt up against their *inside* faces, so any
 * panel that reaches a true corner (matching `fullMin`/`fullMax`, the
 * block's untrimmed depth) is inset by a wall thickness there. Without this,
 * both walls' boxes would occupy the same corner cube and z-fight — barely
 * visible with a flat color, but a clearly visible bright seam once the
 * walls carry a real texture. */
function ZWallSegments({
  panels,
  x,
  def,
  transparentWalls,
  color,
  wallShadowProps,
  fullMin,
  fullMax,
}: {
  panels: WallPanel[];
  x: number;
  def: MaterialDef;
  transparentWalls: boolean;
  color: string;
  wallShadowProps: WallShadowProps;
  fullMin: number;
  fullMax: number;
}) {
  return (
    <>
      {panels.map((p, i) => {
        const hMin =
          Math.abs(p.hMin - fullMin) < CORNER_EPS ? p.hMin + WALL_THICKNESS : p.hMin;
        const hMax =
          Math.abs(p.hMax - fullMax) < CORNER_EPS ? p.hMax - WALL_THICKNESS : p.hMax;
        const span = Math.max(hMax - hMin, 0);
        return (
          <TexturedPanel
            key={i}
            def={def}
            size={[WALL_THICKNESS, p.vMax - p.vMin, span]}
            position={[x, (p.vMin + p.vMax) / 2, (hMin + hMax) / 2]}
            tileWidth={span}
            tileHeight={p.vMax - p.vMin}
            transparentWalls={transparentWalls}
            color={color}
            wallShadowProps={wallShadowProps}
          />
        );
      })}
    </>
  );
}

/**
 * The short perpendicular "return wall" panel connecting a wall run's own
 * plane to its neighbor's whenever a `WallRecess` boundary changes the
 * setback (see `wallRunSegments`) — the physical jog a real notch needs
 * where the wall's surface actually steps in. Skips any boundary where
 * both runs share the same setback (an ordinary door/window opening
 * boundary, not a recess). `axis` matches `XWallSegments`/`ZWallSegments`:
 * "x" for front/back walls (whose runs vary along local X), "z" for
 * left/right (varying along local Z). `planeOffset` maps a setback to that
 * wall's own depth-axis coordinate — the same formula each wall's
 * XWallSegments/ZWallSegments calls already use for `z`/`x`.
 */
function WallJogs({
  runs,
  axis,
  planeOffset,
  wallHeight,
  def,
  color,
  wallShadowProps,
}: {
  runs: WallRunSegment[];
  axis: "x" | "z";
  planeOffset: (setback: number) => number;
  wallHeight: number;
  def: MaterialDef;
  color: string;
  wallShadowProps: WallShadowProps;
}) {
  return (
    <>
      {runs.slice(1).map((run, i) => {
        const prev = runs[i];
        if (Math.abs(run.setback - prev.setback) < 1e-6) return null;
        const boundary = (prev.hMax + run.hMin) / 2;
        const p1 = planeOffset(prev.setback);
        const p2 = planeOffset(run.setback);
        const mid = (p1 + p2) / 2;
        const span = Math.abs(p1 - p2);
        const size: [number, number, number] =
          axis === "x" ? [WALL_THICKNESS, wallHeight, span] : [span, wallHeight, WALL_THICKNESS];
        const position: [number, number, number] =
          axis === "x" ? [boundary, wallHeight / 2, mid] : [mid, wallHeight / 2, boundary];
        return (
          <TexturedPanel
            key={i}
            def={def}
            size={size}
            position={position}
            tileWidth={span}
            tileHeight={wallHeight}
            color={color}
            wallShadowProps={wallShadowProps}
          />
        );
      })}
    </>
  );
}

/** A short column of the wall's own material at each of a block's 4
 * corners, covering the seam left by trimming the left/right walls away
 * from the corner (see `ZWallSegments`). Uses `CORNER_POST_SIZE` as the
 * tile width — a real wall-sized repeat here would squish the whole
 * texture into this post's ~0.16m visible face, same problem as the
 * inter-floor slab — so instead it shows a naturally-scaled narrow crop of
 * the wall pattern, reading as a continuation of the wall rather than a
 * seam or a mismatched flat patch. */
function CornerPosts({
  width,
  depth,
  wallHeight,
  def,
  color,
  wallShadowProps,
}: {
  width: number;
  depth: number;
  wallHeight: number;
  def: MaterialDef;
  color: string;
  wallShadowProps: WallShadowProps;
}) {
  const xs: number[] = [-width / 2 + WALL_THICKNESS / 2, width / 2 - WALL_THICKNESS / 2];
  const zs: number[] = [-depth / 2 + WALL_THICKNESS / 2, depth / 2 - WALL_THICKNESS / 2];
  return (
    <>
      {xs.map((x) =>
        zs.map((z) => (
          <TexturedPanel
            key={`${x}-${z}`}
            def={def}
            size={[CORNER_POST_SIZE, wallHeight, CORNER_POST_SIZE]}
            position={[x, wallHeight / 2, z]}
            tileWidth={CORNER_POST_SIZE}
            tileHeight={wallHeight}
            color={color}
            wallShadowProps={wallShadowProps}
          />
        ))
      )}
    </>
  );
}

/** Flat, untextured fallback for a polygon block's walls/floor/ceiling —
 * `useTiledMaterial`'s texture maps need real UV coordinates, which the
 * polygon extrusion geometry (`buildPolygonWallGeometry`/
 * `buildPolygonSlabGeometry`) doesn't compute in this Phase A pass (see
 * PLAN.md §6) — a deliberate, documented simplification, not an oversight.
 * `wallColor` already carries the rep's own tint choice, so walls/floor/
 * ceiling still look intentional; the roof gets a plain, neutral tone
 * matching `roofSection`'s own flat-color fallback in PlacedComponents.tsx. */
const POLYGON_ROOF_COLOR = "#8a6a4a";

/** Renders a Phase A/B free-form polygon block (see PLAN.md §6) — solid
 * mitered walls (with real door/window cutouts, Phase B), a flat floor
 * slab, and either a flat roof (top floor) or a flat ceiling slab (any
 * floor below one that doesn't fully cover it), all built from the same
 * triangulated-polygon extrusion. Still no block-to-block auto-doorways
 * or recesses (Phase C), no gable/hip/mono-pitch roof — `roofType` is
 * forced to `"flat"` at creation time (`addPolygonBlock` in store.ts) so
 * this component never needs to branch on it. */
function PolygonBlockMesh({
  block,
  wallColor,
  transparentWalls,
  isTopFloor,
  needsOwnCeiling,
  interactive,
  floorComponents,
  edgeOpenings,
}: {
  block: BaseBlock;
  wallColor: string;
  transparentWalls: boolean;
  isTopFloor: boolean;
  needsOwnCeiling: boolean;
  interactive: boolean;
  /** Every same-floor component, used to find this block's own polygon-edge-
   * anchored doors/windows/openings and cut them into the wall ring (see
   * `getPolygonEdgeComponentOpenings` in baseGeometry.ts). */
  floorComponents: PlacedComponent[];
  /** Full-height block-to-block openings for this block's own edges (PLAN.md
   * §6 Phase C — `getPolygonBlockOpenings`), one `Interval[]` per edge index,
   * same local frame as `getPolygonEdgeComponentOpenings`. */
  edgeOpenings: Interval[][];
}) {
  const polygon = block.polygon!;
  const { x, z, wallHeight } = block;
  const selectBlock = useConfiguratorStore((s) => s.selectBlock);
  const selectComponent = useConfiguratorStore((s) => s.selectComponent);
  const handleFloorClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    selectComponent(null);
    selectBlock(block.id);
  };

  const wallGeometry = useMemo(() => {
    const inner = insetPolygon(polygon, WALL_THICKNESS);
    const componentOpenings = getPolygonEdgeComponentOpenings(block, floorComponents);
    const edgePanels = componentOpenings.map((openings, index) => {
      const edgeLength = Math.hypot(
        polygon[(index + 1) % polygon.length].x - polygon[index].x,
        polygon[(index + 1) % polygon.length].z - polygon[index].z
      );
      return wallPanels(0, edgeLength, wallHeight, edgeOpenings[index] ?? [], openings);
    });
    return buildPolygonWallGeometry(polygon, inner, wallHeight, edgePanels);
  }, [polygon, wallHeight, block, floorComponents, edgeOpenings]);

  const floorGeometry = useMemo(
    () => buildPolygonSlabGeometry(polygon, FLOOR_SLAB_THICKNESS, -FLOOR_SLAB_THICKNESS),
    [polygon]
  );

  const roofGeometry = useMemo(
    () => buildPolygonSlabGeometry(polygon, FLAT_ROOF_THICKNESS, wallHeight),
    [polygon, wallHeight]
  );

  const ceilingGeometry = useMemo(
    () => buildPolygonSlabGeometry(polygon, FLOOR_SLAB_THICKNESS, wallHeight),
    [polygon, wallHeight]
  );

  return (
    <group position={[x, 0, z]} rotation={[0, (block.rotation * Math.PI) / 180, 0]}>
      <mesh
        geometry={floorGeometry}
        castShadow
        receiveShadow
        onClick={interactive ? handleFloorClick : undefined}
        userData={interactive ? { blockId: block.id } : undefined}
      >
        <meshStandardMaterial color={wallColor} roughness={0.8} metalness={0} side={THREE.DoubleSide} />
      </mesh>

      <mesh geometry={wallGeometry} castShadow={!transparentWalls} receiveShadow={!transparentWalls}>
        <meshStandardMaterial
          color={wallColor}
          roughness={0.8}
          metalness={0}
          transparent={transparentWalls}
          opacity={transparentWalls ? 0.15 : 1}
          depthWrite={!transparentWalls}
          // This geometry's own winding (especially the door/window reveal
          // faces `buildPolygonWallGeometry` adds per opening) hasn't been
          // checked in a running browser this session — DoubleSide is a
          // deliberate safety net against a wrongly-wound face rendering as
          // invisible rather than just wrongly lit, at a small perf cost.
          side={THREE.DoubleSide}
        />
      </mesh>

      {!transparentWalls && isTopFloor && (
        <mesh geometry={roofGeometry} castShadow receiveShadow>
          <meshStandardMaterial color={POLYGON_ROOF_COLOR} roughness={0.75} metalness={0} side={THREE.DoubleSide} />
        </mesh>
      )}

      {!isTopFloor && needsOwnCeiling && (
        <mesh geometry={ceilingGeometry} castShadow receiveShadow>
          <meshStandardMaterial color={wallColor} roughness={0.8} metalness={0} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

function BlockMesh({
  block,
  roofHeight,
  roofType,
  wallMaterialId,
  wallColor,
  roofMaterialId,
  openings,
  componentOpenings,
  transparentWalls,
  isTopFloor,
  needsOwnCeiling,
  interactive,
  floorComponents,
  polygonEdgeOpenings,
}: {
  block: BaseBlock;
  roofHeight: number;
  roofType: RoofType;
  wallMaterialId: WallMaterialId;
  wallColor: string;
  roofMaterialId: RoofMaterialId;
  openings: BlockOpenings;
  componentOpenings: ComponentOpenings;
  transparentWalls: boolean;
  /** Only the topmost floor gets a real roof; other floors get a flat
   * ceiling slab instead. */
  isTopFloor: boolean;
  /** True when no block on the floor above fully covers this one — it needs
   * its own ceiling slab instead of relying on the floor above's own floor
   * slab (see isFullyCoveredAbove). Always false for the top floor. */
  needsOwnCeiling: boolean;
  /** Whether this block's floor is the one currently being edited — only
   * its blocks are clickable/selectable, so other floors don't steal
   * clicks meant for the active one. */
  interactive: boolean;
  /** Every same-floor component — only actually used by the polygon-block
   * branch below (see `PolygonBlockMesh`'s own doc); an ordinary rectangle
   * block gets its door/window cutouts from `componentOpenings` instead. */
  floorComponents: PlacedComponent[];
  /** This block's own block-to-block edge openings (PLAN.md §6 Phase C) —
   * only used by the polygon branch below; an ordinary rectangle block gets
   * its block-to-block openings from `openings` instead. */
  polygonEdgeOpenings: Interval[][];
}) {
  // Both hooks (needed by the polygon branch's own click-to-select too)
  // must run before any early return — conditionally skipping a hook call
  // would violate React's rules of hooks across renders.
  const selectBlock = useConfiguratorStore((s) => s.selectBlock);
  const selectComponent = useConfiguratorStore((s) => s.selectComponent);
  const handleFloorClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    selectComponent(null);
    selectBlock(block.id);
  };

  // Phase A free-form polygon blocks (PLAN.md §6) render through a wholly
  // separate, much simpler path — solid walls with no openings (doors/
  // windows/porches/balconies/recesses aren't supported on one yet, see
  // Phase B/C), flat roof only, mitered corners built into the wall ring
  // geometry itself (see `buildPolygonWallGeometry`) rather than a
  // separate corner-post step.
  if (block.polygon) {
    return (
      <PolygonBlockMesh
        block={block}
        wallColor={wallColor}
        transparentWalls={transparentWalls}
        isTopFloor={isTopFloor}
        needsOwnCeiling={needsOwnCeiling}
        interactive={interactive}
        floorComponents={floorComponents}
        edgeOpenings={polygonEdgeOpenings}
      />
    );
  }

  const { x, z, wallHeight, width, depth } = block;
  const wallDef = WALL_MATERIALS[wallMaterialId];
  const roofDef = ROOF_MATERIALS[roofMaterialId];
  const wallShadowProps: WallShadowProps = transparentWalls
    ? { castShadow: false, receiveShadow: false }
    : { castShadow: true, receiveShadow: true };

  const local = localizeOpenings(openings, block);
  const localComponentOpenings = localizeComponentOpenings(componentOpenings, block);
  const recessesBySide = block.wallRecesses ?? [];
  const recessesFor = (side: "front" | "back" | "left" | "right") =>
    recessesBySide.filter((r) => r.side === side);

  const frontRuns = wallRunSegments(-width / 2, width / 2, wallHeight, local.front, localComponentOpenings.front, recessesFor("front"));
  const backRuns = wallRunSegments(-width / 2, width / 2, wallHeight, local.back, localComponentOpenings.back, recessesFor("back"));
  const leftRuns = wallRunSegments(-depth / 2, depth / 2, wallHeight, local.left, localComponentOpenings.left, recessesFor("left"));
  const rightRuns = wallRunSegments(-depth / 2, depth / 2, wallHeight, local.right, localComponentOpenings.right, recessesFor("right"));

  const ridgeAxis: RidgeAxis = block.ridgeAxis ?? "x";
  // With ridgeAxis "x" the gable caps sit on the left/right walls (the ridge
  // runs along width); with "z" they sit on the front/back walls instead
  // (the ridge runs along depth) — each cap is skipped only when its own
  // wall is fully open, same as before.
  const capMinusOpen =
    ridgeAxis === "z"
      ? isFullyOpen(-width / 2, width / 2, local.back)
      : isFullyOpen(-depth / 2, depth / 2, local.left);
  const capPlusOpen =
    ridgeAxis === "z"
      ? isFullyOpen(-width / 2, width / 2, local.front)
      : isFullyOpen(-depth / 2, depth / 2, local.right);

  return (
    <group position={[x, 0, z]} rotation={[0, (block.rotation * Math.PI) / 180, 0]}>
      {/* Floor — a real slab sitting entirely below local y=0 (flush with
       * where the walls start), so it's always present under this block
       * regardless of whether a block on the floor below happens to share
       * its footprint. Occupies exactly the FLOOR_SLAB_THICKNESS gap that
       * `floorBaseY` reserves between floors, so it never overlaps the
       * floor above or below it. */}
      <TexturedPanel
        def={wallDef}
        size={[width, FLOOR_SLAB_THICKNESS, depth]}
        position={[0, -FLOOR_SLAB_THICKNESS / 2, 0]}
        tileWidth={width}
        tileHeight={FLOOR_SLAB_THICKNESS}
        color={wallColor}
        wallShadowProps={{ castShadow: true, receiveShadow: true }}
        onClick={interactive ? handleFloorClick : undefined}
        userData={interactive ? { blockId: block.id } : undefined}
      />

      {/* Front wall (+z) — one XWallSegments per depth-segment (see
       * BaseBlock.wallRecesses), so a notch renders as its own inset run
       * instead of forcing the whole wall to one plane. */}
      {frontRuns.map((run, i) => (
        <XWallSegments
          key={i}
          panels={run.panels}
          z={depth / 2 - WALL_THICKNESS / 2 - run.setback}
          def={wallDef}
          transparentWalls={transparentWalls}
          color={wallColor}
          wallShadowProps={wallShadowProps}
        />
      ))}
      <WallJogs
        runs={frontRuns}
        axis="x"
        planeOffset={(setback) => depth / 2 - WALL_THICKNESS / 2 - setback}
        wallHeight={wallHeight}
        def={wallDef}
        color={wallColor}
        wallShadowProps={wallShadowProps}
      />

      {/* Back wall (-z) */}
      {backRuns.map((run, i) => (
        <XWallSegments
          key={i}
          panels={run.panels}
          z={-depth / 2 + WALL_THICKNESS / 2 + run.setback}
          def={wallDef}
          transparentWalls={transparentWalls}
          color={wallColor}
          wallShadowProps={wallShadowProps}
        />
      ))}
      <WallJogs
        runs={backRuns}
        axis="x"
        planeOffset={(setback) => -depth / 2 + WALL_THICKNESS / 2 + setback}
        wallHeight={wallHeight}
        def={wallDef}
        color={wallColor}
        wallShadowProps={wallShadowProps}
      />

      {/* Left wall (-x) */}
      {leftRuns.map((run, i) => (
        <ZWallSegments
          key={i}
          panels={run.panels}
          x={-width / 2 + WALL_THICKNESS / 2 + run.setback}
          def={wallDef}
          transparentWalls={transparentWalls}
          color={wallColor}
          wallShadowProps={wallShadowProps}
          fullMin={-depth / 2}
          fullMax={depth / 2}
        />
      ))}
      <WallJogs
        runs={leftRuns}
        axis="z"
        planeOffset={(setback) => -width / 2 + WALL_THICKNESS / 2 + setback}
        wallHeight={wallHeight}
        def={wallDef}
        color={wallColor}
        wallShadowProps={wallShadowProps}
      />

      {/* Right wall (+x) */}
      {rightRuns.map((run, i) => (
        <ZWallSegments
          key={i}
          panels={run.panels}
          x={width / 2 - WALL_THICKNESS / 2 - run.setback}
          def={wallDef}
          transparentWalls={transparentWalls}
          color={wallColor}
          wallShadowProps={wallShadowProps}
          fullMin={-depth / 2}
          fullMax={depth / 2}
        />
      ))}
      <WallJogs
        runs={rightRuns}
        axis="z"
        planeOffset={(setback) => width / 2 - WALL_THICKNESS / 2 - setback}
        wallHeight={wallHeight}
        def={wallDef}
        color={wallColor}
        wallShadowProps={wallShadowProps}
      />

      <CornerPosts
        width={width}
        depth={depth}
        wallHeight={wallHeight}
        def={wallDef}
        color={wallColor}
        wallShadowProps={wallShadowProps}
      />

      {/* Fascia trim at the roofline — only the top floor actually has a
       * roof under it; other floors have another story above instead, so a
       * fascia there would read as a fake roofline mid-building. Hidden
       * entirely while viewing inside, same as the roof itself. */}
      {!transparentWalls && isTopFloor && (
        <TrimBand
          width={width}
          depth={depth}
          y={wallHeight - FASCIA_HEIGHT / 2}
          height={FASCIA_HEIGHT}
          color={FASCIA_COLOR}
          wallShadowProps={wallShadowProps}
        />
      )}

      {/* Roof (only the topmost floor gets one; hidden entirely while viewing inside) */}
      {!transparentWalls && isTopFloor && roofType === "gable" && (
        <group position={[0, wallHeight, 0]}>
          {gableRoofSlopes(width, depth, roofHeight, ridgeAxis).map((slope, i) => (
            <TexturedPanel
              key={i}
              def={roofDef}
              size={slope.size}
              position={slope.position}
              rotation={slope.rotation}
              tileWidth={slope.size[0]}
              tileHeight={slope.size[2]}
              wallShadowProps={{ castShadow: true, receiveShadow: true }}
            />
          ))}

          {!capMinusOpen && (
            <GableEnd
              offset={ridgeAxis === "z" ? -depth / 2 : -width / 2}
              span={ridgeAxis === "z" ? width : depth}
              roofHeight={roofHeight}
              wallMaterialId={wallMaterialId}
              wallColor={wallColor}
              ridgeAxis={ridgeAxis}
              blockId={block.id}
              interactive={interactive}
              onClick={handleFloorClick}
            />
          )}
          {!capPlusOpen && (
            <GableEnd
              offset={ridgeAxis === "z" ? depth / 2 : width / 2}
              span={ridgeAxis === "z" ? width : depth}
              roofHeight={roofHeight}
              wallMaterialId={wallMaterialId}
              wallColor={wallColor}
              ridgeAxis={ridgeAxis}
              blockId={block.id}
              interactive={interactive}
              onClick={handleFloorClick}
            />
          )}
        </group>
      )}

      {!transparentWalls && isTopFloor && roofType === "monoPitch" && (
        <group position={[0, wallHeight, 0]}>
          {(() => {
            const slope = monoPitchSlope(width, depth, roofHeight, ridgeAxis);
            return (
              <TexturedPanel
                def={roofDef}
                size={slope.size}
                position={slope.position}
                rotation={slope.rotation}
                tileWidth={slope.size[0]}
                tileHeight={slope.size[2]}
                wallShadowProps={{ castShadow: true, receiveShadow: true }}
              />
            );
          })()}

          {/* Both gable-end caps share the same apex (the slope's raised
           * eave) — unlike a symmetric gable, a mono-pitch's ridge sits at
           * one edge, not centered, so it isn't mirrored between the two
           * ends. */}
          {!capMinusOpen && (
            <GableEnd
              offset={ridgeAxis === "z" ? -depth / 2 : -width / 2}
              span={ridgeAxis === "z" ? width : depth}
              roofHeight={roofHeight}
              wallMaterialId={wallMaterialId}
              wallColor={wallColor}
              ridgeAxis={ridgeAxis}
              blockId={block.id}
              interactive={interactive}
              onClick={handleFloorClick}
              apexZ={ridgeAxis === "z" ? width / 2 : depth / 2}
            />
          )}
          {!capPlusOpen && (
            <GableEnd
              offset={ridgeAxis === "z" ? depth / 2 : width / 2}
              span={ridgeAxis === "z" ? width : depth}
              roofHeight={roofHeight}
              wallMaterialId={wallMaterialId}
              wallColor={wallColor}
              ridgeAxis={ridgeAxis}
              blockId={block.id}
              interactive={interactive}
              onClick={handleFloorClick}
              apexZ={ridgeAxis === "z" ? width / 2 : depth / 2}
            />
          )}

          {/* Knee wall on the raised eave — closes the gap between the flat
           * wall top and the slope's high edge, which (unlike a gable's
           * eaves) sits roofHeight above the wall here rather than flush
           * with it. */}
          <TexturedPanel
            def={wallDef}
            size={
              ridgeAxis === "z"
                ? [WALL_THICKNESS, roofHeight, depth]
                : [width, roofHeight, WALL_THICKNESS]
            }
            position={
              ridgeAxis === "z"
                ? [width / 2 - WALL_THICKNESS / 2, roofHeight / 2, 0]
                : [0, roofHeight / 2, depth / 2 - WALL_THICKNESS / 2]
            }
            tileWidth={ridgeAxis === "z" ? depth : width}
            tileHeight={roofHeight}
            color={wallColor}
            wallShadowProps={wallShadowProps}
          />
        </group>
      )}

      {!transparentWalls && isTopFloor && roofType === "hip" && (
        <group position={[0, wallHeight, 0]}>
          <HipRoof
            span={ridgeAxis === "z" ? depth : width}
            perp={ridgeAxis === "z" ? width : depth}
            roofHeight={roofHeight}
            ridgeAxis={ridgeAxis}
            roofDef={roofDef}
          />
        </group>
      )}

      {!transparentWalls && isTopFloor && roofType === "flat" && (
        <TexturedPanel
          def={roofDef}
          size={[width + 0.4, FLAT_ROOF_THICKNESS, depth + 0.4]}
          position={[0, wallHeight + FLAT_ROOF_THICKNESS / 2, 0]}
          tileWidth={width + 0.4}
          tileHeight={depth + 0.4}
          wallShadowProps={{ castShadow: true, receiveShadow: true }}
        />
      )}

      {/* Non-top floor, not (fully) covered by a block above — without this
       * it would be open to the sky wherever the floor above doesn't share
       * its footprint (see isFullyCoveredAbove). Stays visible even in
       * "View inside" mode, same as the floor slab. */}
      {!isTopFloor && needsOwnCeiling && (
        <TexturedPanel
          def={wallDef}
          size={[width, FLOOR_SLAB_THICKNESS, depth]}
          position={[0, wallHeight + FLOOR_SLAB_THICKNESS / 2, 0]}
          tileWidth={width}
          tileHeight={FLOOR_SLAB_THICKNESS}
          color={wallColor}
          wallShadowProps={{ castShadow: true, receiveShadow: true }}
        />
      )}
    </group>
  );
}

export function Base() {
  const base = useConfiguratorStore((s) => s.base);
  const transparentWalls = useConfiguratorStore((s) => s.transparentWalls);
  const components = useConfiguratorStore((s) => s.components);
  const activeFloorIndex = useConfiguratorStore((s) => s.activeFloorIndex);
  const { floors } = base;

  return (
    <group>
      {floors.map((floor, floorIndex) => {
        const isTopFloor = floorIndex === floors.length - 1;
        const interactive = floorIndex === activeFloorIndex;
        const floorComponents = components.filter(
          (c) => c.floorIndex === floorIndex
        );
        const openings = getBlockOpenings(floor.blocks);
        const polygonAdjacency = getPolygonBlockOpenings(floor.blocks);
        const componentOpenings = getComponentOpenings(floor.blocks, floorComponents);
        const blocksAbove = isTopFloor ? [] : floors[floorIndex + 1].blocks;

        return (
          <group key={floor.id} position={[0, floorBaseY(floors, floorIndex), 0]}>
            {floor.blocks.map((block) => (
              <BlockMesh
                key={block.id}
                block={block}
                roofHeight={block.roofHeight}
                // Each of these falls back to the building-wide default
                // when the block doesn't set its own — an optional
                // per-block override, not a forced split (a build that
                // never touches these fields behaves exactly as before).
                roofType={block.roofType ?? base.roofType}
                wallMaterialId={resolveWallMaterialId(
                  block.wallMaterialId ?? base.wallMaterialId,
                  base.buildingType
                )}
                wallColor={block.wallColor ?? base.wallColor ?? DEFAULT_WALL_COLOR}
                roofMaterialId={
                  (block.roofMaterialId ?? base.roofMaterialId) as RoofMaterialId
                }
                openings={
                  block.polygon
                    ? openings[block.id]
                    : mergeRectOpenings(openings[block.id], polygonAdjacency.rect[block.id])
                }
                polygonEdgeOpenings={polygonAdjacency.polygon[block.id]}
                componentOpenings={componentOpenings[block.id]}
                transparentWalls={transparentWalls}
                isTopFloor={isTopFloor}
                needsOwnCeiling={!isTopFloor && !isFullyCoveredAbove(block, blocksAbove)}
                interactive={interactive}
                floorComponents={floorComponents}
              />
            ))}
          </group>
        );
      })}
    </group>
  );
}
