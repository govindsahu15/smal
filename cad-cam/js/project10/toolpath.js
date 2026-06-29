/** Toolpath generation — ported from machining/toolpath.py */

import {
  EPSILON, linspaceInclusive, normalize, cross, sub, length, pointLineDeviation, dot,
} from "../shared/utils.js";

const COLLINEAR_TOLERANCE_MM = 0.01;
const DEFAULT_TOOLPATH_SAMPLES_U = 120;

function stableNormal(du, dv, previousNormal) {
  const crossVal = cross(du, dv);
  const crossNorm = length(crossVal);
  if (crossNorm < EPSILON) {
    return previousNormal || { x: 0, y: 0, z: 1 };
  }
  let normal = normalize(crossVal);
  if (previousNormal && dot(normal, previousNormal) < 0) {
    normal = { x: -normal.x, y: -normal.y, z: -normal.z };
  }
  return normal;
}

function estimateVStepFromMm(surface, stepoverMm, sampleCount = 120) {
  const [[uMin, uMax], [vMin, vMax]] = surface.parameterRanges();
  const uMid = 0.5 * (uMin + uMax);
  const vValues = linspaceInclusive(vMin, vMax, sampleCount);
  const points = vValues.map((v) => surface.evaluateDerivatives(uMid, v).point);
  let arcLength = 0;
  for (let i = 1; i < points.length; i += 1) {
    arcLength += length(sub(points[i], points[i - 1]));
  }
  const paramRange = vMax - vMin;
  if (arcLength < EPSILON || paramRange < EPSILON) return paramRange / 20;
  const mmPerParam = arcLength / paramRange;
  const step = stepoverMm / mmPerParam;
  return Math.max(paramRange / 300, Math.min(step, paramRange / 2));
}

function filterCollinearToolpathPoints(points, toleranceMm = COLLINEAR_TOLERANCE_MM) {
  if (points.length <= 2) return points.slice();
  const filtered = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const prev = filtered[filtered.length - 1];
    const curr = points[index];
    const next = points[index + 1];
    const devCl = pointLineDeviation(curr.clPoint, prev.clPoint, next.clPoint);
    const devContact = pointLineDeviation(curr.contactPoint, prev.contactPoint, next.contactPoint);
    if (devCl >= toleranceMm || devContact >= toleranceMm) filtered.push(curr);
  }
  filtered.push(points[points.length - 1]);
  return filtered;
}

export function generateZigzagToolpath(
  surface,
  stepoverMm = 1.0,
  toolRadiusMm = 2.0,
  uSamples = DEFAULT_TOOLPATH_SAMPLES_U,
  toleranceMm = COLLINEAR_TOLERANCE_MM,
  linkPasses = false,
  linkSamples = 12,
) {
  if (toolRadiusMm <= 0) throw new Error("tool_radius_mm must be > 0");
  const [[uMin, uMax], [vMin, vMax]] = surface.parameterRanges();
  const vStep = estimateVStepFromMm(surface, stepoverMm);
  const vValues = [vMin];
  let currentV = vMin;
  while (currentV + vStep < vMax) {
    currentV += vStep;
    vValues.push(currentV);
  }
  if (vValues[vValues.length - 1] < vMax - EPSILON) vValues.push(vMax);

  const passes = [];
  let previousNormal = null;
  for (let passIndex = 0; passIndex < vValues.length; passIndex += 1) {
    const vValue = vValues[passIndex];
    const forward = passIndex % 2 === 0;
    let uValues = linspaceInclusive(uMin, uMax, uSamples);
    if (!forward) uValues = uValues.reverse();

    const rawPoints = [];
    for (const uValue of uValues) {
      const ev = surface.evaluateDerivatives(uValue, vValue);
      const normal = stableNormal(ev.du, ev.dv, previousNormal);
      previousNormal = normal;
      const clPoint = {
        x: ev.point.x + toolRadiusMm * normal.x,
        y: ev.point.y + toolRadiusMm * normal.y,
        z: ev.point.z + toolRadiusMm * normal.z,
      };
      rawPoints.push({
        contactPoint: ev.point,
        clPoint,
        normal,
        uValue,
        vValue,
      });
    }

    passes.push({
      vParameter: vValue,
      direction: forward ? "forward" : "reverse",
      points: filterCollinearToolpathPoints(rawPoints, toleranceMm),
      linkPoints: [],
    });
  }

  if (linkPasses) {
    for (let passIndex = 0; passIndex < passes.length - 1; passIndex += 1) {
      const toolPass = passes[passIndex];
      const forward = toolPass.direction === "forward";
      const nextV = passes[passIndex + 1].vParameter;
      const uLink = forward ? uMax : uMin;
      const linkVValues = linspaceInclusive(vValue, nextV, linkSamples);
      const linkPoints = [];
      let linkNormal = previousNormal;
      linkVValues.forEach((linkV) => {
        const ev = surface.evaluateDerivatives(uLink, linkV);
        const normal = stableNormal(ev.du, ev.dv, linkNormal);
        linkNormal = normal;
        linkPoints.push({
          contactPoint: ev.point,
          clPoint: {
            x: ev.point.x + toolRadiusMm * normal.x,
            y: ev.point.y + toolRadiusMm * normal.y,
            z: ev.point.z + toolRadiusMm * normal.z,
          },
          normal,
          uValue: uLink,
          vValue: linkV,
        });
      });
      toolPass.linkPoints = linkPoints;
    }
  }
  return passes;
}
