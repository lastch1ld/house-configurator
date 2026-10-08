import * as THREE from "three";

export interface Point2D {
  x: number;
  z: number;
}

export function polygonCentroid(polygon: Point2D[]): Point2D {
  let x = 0;
  let z = 0;
  for (const p of polygon) {
    x += p.x;
    z += p.z;
  }
  return { x: x / polygon.length, z: z / polygon.length };
}

/** The axis-aligned bounding box of a polygon's own vertices. */
export function polygonBoundingBox(polygon: Point2D[]): {
  left: number;
  right: number;
  back: number;
  front: number;
} {
  let left = polygon[0].x;
  let right = polygon[0].x;
  let back = polygon[0].z;
  let front = polygon[0].z;
  for (const p of polygon) {
    left = Math.min(left, p.x);
    right = Math.max(right, p.x);
    back = Math.min(back, p.z);
    front = Math.max(front, p.z);
  }
  return { left, right, back, front };
}

/** Rotates a polygon's vertices by a quarter-turn multiple (90/180/270)
 * about the origin — the same 0/90/180/270-only rotation `BaseBlock`
 * already supports, applied exactly (no trig approximation error) since
 * every step is a plain 90° swap. */
export function rotatePolygon(polygon: Point2D[], degrees: 0 | 90 | 180 | 270): Point2D[] {
  const steps = ((degrees / 90) % 4 + 4) % 4;
  let result = polygon;
  for (let i = 0; i < steps; i++) {
    result = result.map(({ x, z }) => ({ x: z, z: -x }));
  }
  return result;
}

/** Outward unit normal of edge (a -> b), verified against the polygon's
 * own centroid so it's correct regardless of winding order (CW or CCW). */
function outwardNormal(a: Point2D, b: Point2D, centroid: Point2D): Point2D {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  let nx = dz / len;
  let nz = -dx / len;
  const midX = (a.x + b.x) / 2;
  const midZ = (a.z + b.z) / 2;
  const towardCentroidX = centroid.x - midX;
  const towardCentroidZ = centroid.z - midZ;
  if (nx * towardCentroidX + nz * towardCentroidZ > 0) {
    nx = -nx;
    nz = -nz;
  }
  return { x: nx, z: nz };
}

/** Outward unit normal of polygon edge `index` (running from
 * `polygon[index]` to `polygon[(index+1) % polygon.length]`), in the
 * polygon's own local space — see PLAN.md §6 Phase B, `componentSnap.ts`'s
 * wall-anchoring for polygon blocks. */
export function polygonEdgeOutwardNormal(polygon: Point2D[], index: number): Point2D {
  const n = polygon.length;
  return outwardNormal(polygon[index], polygon[(index + 1) % n], polygonCentroid(polygon));
}

/** Intersection of line (p1 + t*d1) and (p2 + s*d2). Falls back to `p1`
 * for parallel/collinear lines (a straight run — there's no real corner
 * to solve for there, and any point on the shared line is equally valid). */
function lineIntersection(p1: Point2D, d1: Point2D, p2: Point2D, d2: Point2D): Point2D {
  const denom = d1.x * d2.z - d1.z * d2.x;
  if (Math.abs(denom) < 1e-9) return { x: p1.x, z: p1.z };
  const t = ((p2.x - p1.x) * d2.z - (p2.z - p1.z) * d2.x) / denom;
  return { x: p1.x + t * d1.x, z: p1.z + t * d1.z };
}

/**
 * The polygon offset inward by `thickness` — vertex i is where edge
 * (i-1, i)'s inward-offset line meets edge (i, i+1)'s inward-offset line.
 * This is a wall's own inner-face boundary. Building each wall segment i
 * as the quad (outer[i], outer[i+1], inner[i+1], inner[i]) means two
 * adjacent segments automatically share an exact edge at every vertex —
 * a correct miter join at any interior angle (convex or reflex), with no
 * separate corner-post geometry needed at all (see `buildPolygonWallGeometry`).
 */
export function insetPolygon(polygon: Point2D[], thickness: number): Point2D[] {
  const n = polygon.length;
  const centroid = polygonCentroid(polygon);
  const normals = polygon.map((v, i) => outwardNormal(v, polygon[(i + 1) % n], centroid));
  return polygon.map((v, i) => {
    const prev = polygon[(i - 1 + n) % n];
    const next = polygon[(i + 1) % n];
    const prevNormal = normals[(i - 1 + n) % n];
    const thisNormal = normals[i];
    const dA = { x: v.x - prev.x, z: v.z - prev.z };
    const dB = { x: next.x - v.x, z: next.z - v.z };
    const p1 = { x: v.x - prevNormal.x * thickness, z: v.z - prevNormal.z * thickness };
    const p2 = { x: v.x - thisNormal.x * thickness, z: v.z - thisNormal.z * thickness };
    return lineIntersection(p1, dA, p2, dB);
  });
}

function cross(o: Point2D, a: Point2D, b: Point2D): number {
  return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
}

function pointInTriangle(p: Point2D, a: Point2D, b: Point2D, c: Point2D): boolean {
  const d1 = cross(a, b, p);
  const d2 = cross(b, c, p);
  const d3 = cross(c, a, p);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/** Signed area (positive for CCW winding, negative for CW). */
export function polygonSignedArea(polygon: Point2D[]): number {
  let area = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    area += a.x * b.z - b.x * a.z;
  }
  return area / 2;
}

/**
 * Ear-clipping triangulation of a simple (non-self-intersecting) polygon,
 * convex or concave, either winding order — returns a flat list of vertex
 * indices into `polygon`, 3 per triangle. The standard approach for
 * turning an arbitrary footprint into fillable triangles (needed for a
 * flat roof/floor/ceiling slab's top and bottom faces — see
 * `buildPolygonSlabGeometry`).
 */
export function triangulatePolygon(polygon: Point2D[]): number[] {
  const n = polygon.length;
  if (n < 3) return [];
  // Ear-clipping needs CCW winding to use the standard convex/ear tests below.
  const ccw = polygonSignedArea(polygon) >= 0;
  const indices = Array.from({ length: n }, (_, i) => (ccw ? i : n - 1 - i));
  const triangles: number[] = [];
  const remaining = [...indices];

  let guard = 0;
  while (remaining.length > 3 && guard++ < n * n) {
    const m = remaining.length;
    let clipped = false;
    for (let i = 0; i < m; i++) {
      const iPrev = remaining[(i - 1 + m) % m];
      const iCur = remaining[i];
      const iNext = remaining[(i + 1) % m];
      const a = polygon[iPrev];
      const b = polygon[iCur];
      const c = polygon[iNext];
      // A valid "ear" at b is convex (cross > 0 for CCW) and contains no
      // other remaining vertex inside its own triangle.
      if (cross(a, b, c) <= 1e-9) continue;
      let containsOther = false;
      for (const idx of remaining) {
        if (idx === iPrev || idx === iCur || idx === iNext) continue;
        if (pointInTriangle(polygon[idx], a, b, c)) {
          containsOther = true;
          break;
        }
      }
      if (containsOther) continue;
      triangles.push(iPrev, iCur, iNext);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate input — stop rather than loop forever
  }
  if (remaining.length === 3) triangles.push(remaining[0], remaining[1], remaining[2]);
  return triangles;
}

/**
 * Extrudes a filled polygon into a solid slab (a flat roof panel, floor,
 * or ceiling for a polygon block — see PLAN.md §6 Phase A) from `yMin` to
 * `yMin + thickness`: a triangulated top and bottom cap plus a rim wall
 * around the polygon's own perimeter.
 */
export function buildPolygonSlabGeometry(
  polygon: Point2D[],
  thickness: number,
  yMin = 0
): THREE.BufferGeometry {
  const yMax = yMin + thickness;
  const tris = triangulatePolygon(polygon);
  const positions: number[] = [];

  for (let i = 0; i < tris.length; i += 3) {
    const a = polygon[tris[i]];
    const b = polygon[tris[i + 1]];
    const c = polygon[tris[i + 2]];
    // Top cap faces up: CCW when viewed from +Y needs (a,b,c) with
    // positive signed area — triangulatePolygon already normalizes to CCW.
    positions.push(a.x, yMax, a.z, b.x, yMax, b.z, c.x, yMax, c.z);
    // Bottom cap faces down: reverse winding.
    positions.push(a.x, yMin, a.z, c.x, yMin, c.z, b.x, yMin, b.z);
  }

  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    positions.push(
      a.x, yMin, a.z, b.x, yMin, b.z, b.x, yMax, b.z,
      a.x, yMin, a.z, b.x, yMax, b.z, a.x, yMax, a.z
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** One solid rectangular run within a single polygon edge's own span — the
 * polygon-wall equivalent of baseGeometry.ts's `WallPanel` (same shape,
 * redeclared here rather than imported to avoid a circular import between
 * this module and baseGeometry.ts, which already imports from this one). */
export interface PolygonWallPanel {
  hMin: number;
  hMax: number;
  vMin: number;
  vMax: number;
}

function lerpPoint(a: Point2D, b: Point2D, t: number): Point2D {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/**
 * A closed ring of wall segments between `outer` (the polygon's own
 * boundary) and `inner` (`insetPolygon(outer, thickness)`). Each edge *i*
 * renders as one solid quad-prism from y=0 to `height` by default, or — if
 * `edgePanels[i]` is given (see `getPolygonEdgeComponentOpenings` in
 * baseGeometry.ts) — as a run of narrower quad-prisms interpolated along
 * that edge's own outer/inner boundary per panel's `hMin`/`hMax` and
 * extruded only `vMin` to `vMax`, the same "cut by door/window openings"
 * result `wallPanels` already produces for a rectangle wall, applied to an
 * edge instead of an axis-aligned span. Adjacent full-edge segments still
 * share an exact edge at every vertex when unpanelled, so the ring tiles
 * with no gaps or overlaps and every corner is correctly mitered
 * regardless of its angle (see `insetPolygon`'s own doc) — panelling one
 * edge for its own openings doesn't disturb that at its two ends, since a
 * panel spanning the edge's own full `[0, edgeLength]` reproduces the
 * unpanelled corners exactly.
 */
export function buildPolygonWallGeometry(
  outer: Point2D[],
  inner: Point2D[],
  height: number,
  edgePanels?: PolygonWallPanel[][]
): THREE.BufferGeometry {
  const n = outer.length;
  const positions: number[] = [];
  const push = (p: Point2D, y: number) => positions.push(p.x, y, p.z);

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const oA = outer[i];
    const oB = outer[j];
    const iA = inner[i];
    const iB = inner[j];
    const edgeLength = Math.hypot(oB.x - oA.x, oB.z - oA.z) || 1;
    const panels = edgePanels?.[i] ?? [{ hMin: 0, hMax: edgeLength, vMin: 0, vMax: height }];

    for (const panel of panels) {
      const t0 = panel.hMin / edgeLength;
      const t1 = panel.hMax / edgeLength;
      const oA2 = lerpPoint(oA, oB, t0);
      const oB2 = lerpPoint(oA, oB, t1);
      const iA2 = lerpPoint(iA, iB, t0);
      const iB2 = lerpPoint(iA, iB, t1);
      const y0 = panel.vMin;
      const y1 = panel.vMax;

      // Outer face.
      push(oA2, y0); push(oB2, y0); push(oB2, y1);
      push(oA2, y0); push(oB2, y1); push(oA2, y1);
      // Inner face (reversed winding — faces the opposite direction).
      push(iA2, y0); push(iA2, y1); push(iB2, y1);
      push(iA2, y0); push(iB2, y1); push(iB2, y0);
      // Top.
      push(oA2, y1); push(oB2, y1); push(iB2, y1);
      push(oA2, y1); push(iB2, y1); push(iA2, y1);
      // Bottom.
      push(oA2, y0); push(iA2, y0); push(iB2, y0);
      push(oA2, y0); push(iB2, y0); push(oB2, y0);

      // End caps (the door/window reveal, or the sill/lintel jamb above or
      // below one) — only where this panel's own boundary doesn't already
      // land on the edge's true start/end vertex, since a full-edge panel's
      // ends coincide with the neighboring segment there and need no cap
      // (see this function's own doc on how corners stay gap-free).
      const EPS = 1e-6;
      if (t0 > EPS) {
        push(oA2, y0); push(iA2, y0); push(iA2, y1);
        push(oA2, y0); push(iA2, y1); push(oA2, y1);
      }
      if (t1 < 1 - EPS) {
        push(oB2, y0); push(oB2, y1); push(iB2, y1);
        push(oB2, y0); push(iB2, y1); push(iB2, y0);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}
