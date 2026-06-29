/** Surface offset along center normal — ported from surface/providers/surface_normal_extrusion.py */

import { EPSILON } from "./config.js";
import { createSurfaceFromArrays } from "./factory.js";

export function extrudeSurfaceAlongCenterNormal(surface, distance) {
  if (distance <= 0) throw new Error("distance must be strictly positive");

  const normal = surface.evaluateNormal(0.5, 0.5);
  const nLen = Math.hypot(normal.x, normal.y, normal.z);
  if (nLen < EPSILON) throw new Error("surface normal magnitude is too small");

  const unit = { x: normal.x / nLen, y: normal.y / nLen, z: normal.z / nLen };
  const controlNet = surface.controlNet.map((row) =>
    row.map((p) => ({
      x: p.x + distance * unit.x,
      y: p.y + distance * unit.y,
      z: p.z + distance * unit.z,
    })),
  );

  return createSurfaceFromArrays(
    controlNet,
    surface.weights.map((row) => row.slice()),
    surface.degreeU,
    surface.degreeV,
    surface.knotU.slice(),
    surface.knotV.slice(),
  );
}
