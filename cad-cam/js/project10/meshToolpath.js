/** Mesh-based zig-zag toolpath — ported from machining/toolpath.py */

import {
  EPSILON, linspaceInclusive, normalize, sub, length, pointLineDeviation,
} from "../shared/utils.js";
import { COLLINEAR_TOLERANCE_MM, DEFAULT_TOOLPATH_SAMPLES_U, DEFAULT_LINK_SAMPLES } from "./config.js";

function filterCollinear(points, toleranceMm = COLLINEAR_TOLERANCE_MM) {
  if (points.length <= 2) return points.slice();
  const filtered = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = filtered[filtered.length - 1];
    const curr = points[i];
    const next = points[i + 1];
    if (
      pointLineDeviation(curr.clPoint, prev.clPoint, next.clPoint) >= toleranceMm
      || pointLineDeviation(curr.contactPoint, prev.contactPoint, next.contactPoint) >= toleranceMm
    ) filtered.push(curr);
  }
  filtered.push(points[points.length - 1]);
  return filtered;
}

function pointInTriangleXY(px, py, tri) {
  const [x0, y0] = [tri[0].x, tri[0].y];
  const [x1, y1] = [tri[1].x, tri[1].y];
  const [x2, y2] = [tri[2].x, tri[2].y];
  const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  if (Math.abs(denom) < EPSILON) return false;
  const inv = 1 / denom;
  const a = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) * inv;
  const b = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) * inv;
  const c = 1 - a - b;
  return a >= -EPSILON && b >= -EPSILON && c >= -EPSILON;
}

function collectMeshIntersections(x, y, triData) {
  const hits = [];
  for (const tri of triData) {
    if (x < tri.minX || x > tri.maxX || y < tri.minY || y > tri.maxY) continue;
    const n = tri.normal;
    if (Math.abs(n.z) < EPSILON) continue;
    const z = (tri.d - n.x * x - n.y * y) / n.z;
    if (!Number.isFinite(z)) continue;
    if (!pointInTriangleXY(x, y, tri.verts)) continue;
    hits.push({ z, normal: n });
  }
  return hits;
}

function orientNormal(normal, previousNormal) {
  const toolAxis = { x: 0, y: 0, z: 1 };
  let oriented = normalize(normal, toolAxis);
  if (oriented.z < 0) oriented = { x: -oriented.x, y: -oriented.y, z: -oriented.z };
  if (previousNormal && (oriented.x * previousNormal.x + oriented.y * previousNormal.y + oriented.z * previousNormal.z) < 0) {
    oriented = { x: -oriented.x, y: -oriented.y, z: -oriented.z };
  }
  return oriented;
}

function buildTriData(vertices, triangles) {
  return triangles.map(([i0, i1, i2]) => {
    const v0 = vertices[i0];
    const v1 = vertices[i1];
    const v2 = vertices[i2];
    const e1 = sub(v1, v0);
    const e2 = sub(v2, v0);
    const nx = e1.y * e2.z - e1.z * e2.y;
    const ny = e1.z * e2.x - e1.x * e2.z;
    const nz = e1.x * e2.y - e1.y * e2.x;
    const len = Math.hypot(nx, ny, nz);
    if (len < EPSILON) return null;
    const normal = { x: nx / len, y: ny / len, z: nz / len };
    const d = normal.x * v0.x + normal.y * v0.y + normal.z * v0.z;
    const xs = [v0.x, v1.x, v2.x];
    const ys = [v0.y, v1.y, v2.y];
    return {
      verts: [v0, v1, v2],
      normal,
      d,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  }).filter(Boolean);
}

export function generateMeshZigzagToolpath(
  vertices,
  triangles,
  stepoverMm = 1.0,
  toolRadiusMm = 2.0,
  uSamples = DEFAULT_TOOLPATH_SAMPLES_U,
  toleranceMm = COLLINEAR_TOLERANCE_MM,
  linkPasses = false,
  envelopeMode = "top",
) {
  if (!triangles.length) return [];
  const triData = buildTriData(vertices, triangles);
  if (!triData.length) return [];

  let xMin = Infinity; let xMax = -Infinity;
  let yMin = Infinity; let yMax = -Infinity;
  vertices.forEach((v) => {
    xMin = Math.min(xMin, v.x); xMax = Math.max(xMax, v.x);
    yMin = Math.min(yMin, v.y); yMax = Math.max(yMax, v.y);
  });

  const yValues = [yMin];
  let currentY = yMin;
  while (currentY + stepoverMm < yMax) {
    currentY += stepoverMm;
    yValues.push(currentY);
  }
  if (yValues[yValues.length - 1] < yMax - EPSILON) yValues.push(yMax);

  const mode = String(envelopeMode).toLowerCase();
  const passes = [];

  yValues.forEach((yValue, passIndex) => {
    const forward = passIndex % 2 === 0;
    let xValues = linspaceInclusive(xMin, xMax, uSamples);
    if (!forward) xValues = xValues.slice().reverse();

    function buildSegment(useBottom) {
      const segment = [];
      let previousNormal = null;
      xValues.forEach((xValue) => {
        const hits = collectMeshIntersections(xValue, yValue, triData);
        if (!hits.length) {
          previousNormal = null;
          return;
        }
        const hit = useBottom
          ? hits.reduce((a, b) => (a.z < b.z ? a : b))
          : hits.reduce((a, b) => (a.z > b.z ? a : b));
        const normal = orientNormal(hit.normal, previousNormal);
        previousNormal = normal;
        const contact = { x: xValue, y: yValue, z: hit.z };
        segment.push({
          contactPoint: contact,
          clPoint: {
            x: contact.x + toolRadiusMm * normal.x,
            y: contact.y + toolRadiusMm * normal.y,
            z: contact.z + toolRadiusMm * normal.z,
          },
          normal,
          uValue: xValue,
          vValue: yValue,
        });
      });
      return filterCollinear(segment, toleranceMm);
    }

    const top = buildSegment(false);
    if (top.length >= 2) {
      passes.push({
        vParameter: yValue,
        direction: forward ? "forward" : "reverse",
        points: top,
        linkPoints: [],
      });
    }
    if (mode === "full" || mode === "bottom") {
      const bottom = buildSegment(true);
      if (bottom.length >= 2) {
        passes.push({
          vParameter: yValue,
          direction: forward ? "forward" : "reverse",
          points: bottom,
          linkPoints: [],
        });
      }
    }
  });

  return passes;
}
