/** Loft curves to surface — ported from surface/providers/loft.py */

import { DEFAULT_DEGREE_U, DEFAULT_DEGREE_V } from "./config.js";
import { convertCurveToNurbs } from "./curves.js";
import { createSurfaceFromArrays } from "./factory.js";

export function loftSurfaceFromCurves(curves, samplesPerCurve = 40) {
  if (curves.length < 2) throw new Error("at least two curves required");
  if (samplesPerCurve < 2) throw new Error("samples_per_curve must be at least 2");

  const nurbsCurves = curves.map(convertCurveToNurbs);
  const sampleCount = Math.max(
    samplesPerCurve,
    ...nurbsCurves.map((c) => c.controlPoints.length),
  );

  const controlNet = nurbsCurves.map((curve) => curve.samplePoints(sampleCount));
  const weights = controlNet.map((row) => row.map(() => 1));

  return createSurfaceFromArrays(
    controlNet,
    weights,
    Math.min(DEFAULT_DEGREE_U, nurbsCurves.length - 1),
    Math.min(DEFAULT_DEGREE_V, sampleCount - 1),
  );
}
