/** Solid/shell body from surface — ported from surface/providers/surface_body_extrusion.py */

import { EPSILON } from "./config.js";

function triangulateGrid(rows, cols, indexOffset, reverse) {
  const tris = [];
  for (let i = 0; i < rows - 1; i += 1) {
    for (let j = 0; j < cols - 1; j += 1) {
      const a = indexOffset + i * cols + j;
      const b = indexOffset + (i + 1) * cols + j;
      const c = indexOffset + (i + 1) * cols + (j + 1);
      const d = indexOffset + i * cols + (j + 1);
      if (reverse) { tris.push([a, c, b], [a, d, c]); }
      else { tris.push([a, b, c], [a, c, d]); }
    }
  }
  return tris;
}

function boundaryLoop(rows, cols) {
  const loop = [];
  for (let j = 0; j < cols; j += 1) loop.push(j);
  for (let i = 1; i < rows; i += 1) loop.push(i * cols + (cols - 1));
  for (let j = cols - 2; j >= 0; j -= 1) loop.push((rows - 1) * cols + j);
  for (let i = rows - 2; i > 0; i -= 1) loop.push(i * cols);
  return loop;
}

function sideTriangles(loop, lowerOffset, upperOffset) {
  const tris = [];
  for (let i = 0; i < loop.length; i += 1) {
    const la = lowerOffset + loop[i];
    const lb = lowerOffset + loop[(i + 1) % loop.length];
    const ua = upperOffset + loop[i];
    const ub = upperOffset + loop[(i + 1) % loop.length];
    tris.push([la, lb, ub], [la, ub, ua]);
  }
  return tris;
}

export function buildSurfaceExtrusionMesh(surface, distance, mode, uSamples = 45, vSamples = 45) {
  const normalized = String(mode).toLowerCase();
  if (!["solid", "shell"].includes(normalized)) throw new Error("mode must be solid or shell");
  if (distance <= 0) throw new Error("distance must be positive");

  const { points, normals } = surface.evaluateGrid(uSamples, vSamples);
  const rows = points.length;
  const cols = points[0].length;

  let unitNormal = surface.evaluateNormal(0.5, 0.5);
  const nLen = Math.hypot(unitNormal.x, unitNormal.y, unitNormal.z);
  if (nLen < EPSILON) throw new Error("center normal too small");
  unitNormal = { x: unitNormal.x / nLen, y: unitNormal.y / nLen, z: unitNormal.z / nLen };

  const flat = (grid) => grid.flat();
  const loop = boundaryLoop(rows, cols);
  const baseCount = rows * cols;

  if (normalized === "solid") {
    const bottom = flat(points);
    const top = flat(points.map((row, i) =>
      row.map((p, j) => ({
        x: p.x + unitNormal.x * distance,
        y: p.y + unitNormal.y * distance,
        z: p.z + unitNormal.z * distance,
      })),
    ));
    const vertices = [...bottom, ...top];
    const triangles = [
      ...triangulateGrid(rows, cols, 0, false),
      ...triangulateGrid(rows, cols, baseCount, true),
      ...sideTriangles(loop, 0, baseCount),
    ];
    return { vertices, triangles };
  }

  const half = 0.5 * distance;
  const outer = flat(points.map((row) =>
    row.map((p) => ({
      x: p.x + unitNormal.x * half,
      y: p.y + unitNormal.y * half,
      z: p.z + unitNormal.z * half,
    })),
  ));
  const inner = flat(points.map((row) =>
    row.map((p) => ({
      x: p.x - unitNormal.x * half,
      y: p.y - unitNormal.y * half,
      z: p.z - unitNormal.z * half,
    })),
  ));
  const vertices = [...outer, ...inner];
  const triangles = [
    ...triangulateGrid(rows, cols, 0, false),
    ...triangulateGrid(rows, cols, baseCount, true),
    ...sideTriangles(loop, 0, baseCount),
  ];
  return { vertices, triangles };
}
