/** Extrude curve to surface — ported from surface/providers/extrusion.py */

import { EPSILON, linspaceInclusive } from "../shared/utils.js";
import { DEFAULT_DEGREE_U, DEFAULT_DEGREE_V } from "./config.js";
import { convertCurveToNurbs } from "./curves.js";
import { createSurfaceFromArrays } from "./factory.js";

export function extrudeSurfaceFromCurve(curve, direction, height, layerCount, samplesAlongCurve = 40) {
  if (height <= 0) throw new Error("height must be positive");
  if (layerCount < 2) throw new Error("layer_count must be at least 2");
  if (samplesAlongCurve < 2) throw new Error("samples_along_curve must be at least 2");

  const dirLen = Math.hypot(direction.x, direction.y, direction.z);
  if (dirLen < EPSILON) throw new Error("direction must be non-zero");
  const unit = { x: direction.x / dirLen, y: direction.y / dirLen, z: direction.z / dirLen };

  const source = convertCurveToNurbs(curve);
  const sampleCount = Math.max(samplesAlongCurve, source.controlPoints.length);
  const baseProfile = source.samplePoints(sampleCount);
  const offsets = linspaceInclusive(0, height, layerCount);

  const controlNet = offsets.map((offset) =>
    baseProfile.map((p) => ({
      x: p.x + unit.x * offset,
      y: p.y + unit.y * offset,
      z: p.z + unit.z * offset,
    })),
  );
  const weights = controlNet.map((row) => row.map(() => 1));

  return createSurfaceFromArrays(
    controlNet,
    weights,
    Math.min(DEFAULT_DEGREE_U, layerCount - 1),
    Math.min(DEFAULT_DEGREE_V, sampleCount - 1),
  );
}
