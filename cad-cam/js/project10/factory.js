/** Surface factory — ported from surface/factory.py */

import { generateClampedUniformKnotVector } from "./bspline.js";
import { NURBSSurface } from "./nurbsSurface.js";

const DEFAULT_DEGREE_U = 3;
const DEFAULT_DEGREE_V = 3;

export function createSurfaceFromArrays(controlNet, weights, degreeU, degreeV, knotU = null, knotV = null) {
  const uCount = controlNet.length;
  const vCount = controlNet[0].length;
  const knotUValue = knotU || generateClampedUniformKnotVector(uCount, degreeU);
  const knotVValue = knotV || generateClampedUniformKnotVector(vCount, degreeV);
  return new NURBSSurface(controlNet, weights, knotUValue, knotVValue, degreeU, degreeV);
}

export function createDefaultSurface(rows = 4, cols = 4) {
  const xCoords = Array.from({ length: rows }, (_, i) => (60 * i) / Math.max(rows - 1, 1));
  const yCoords = Array.from({ length: cols }, (_, i) => (60 * i) / Math.max(cols - 1, 1));
  const controlNet = [];
  const weights = [];
  for (let iU = 0; iU < rows; iU += 1) {
    const row = [];
    const wRow = [];
    for (let iV = 0; iV < cols; iV += 1) {
      const z = 8 * Math.sin((iU / Math.max(rows - 1, 1)) * Math.PI)
        * Math.cos((iV / Math.max(cols - 1, 1)) * Math.PI);
      row.push({ x: xCoords[iU], y: yCoords[iV], z });
      wRow.push(1);
    }
    controlNet.push(row);
    weights.push(wRow);
  }
  return createSurfaceFromArrays(
    controlNet,
    weights,
    Math.min(DEFAULT_DEGREE_U, rows - 1),
    Math.min(DEFAULT_DEGREE_V, cols - 1),
  );
}
