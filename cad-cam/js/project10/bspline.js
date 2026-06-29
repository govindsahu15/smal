/** B-spline basis — ported from core/bspline.py */

import { EPSILON, linspaceInclusive } from "../shared/utils.js";

export function generateClampedUniformKnotVector(controlCount, degree) {
  if (controlCount <= degree) throw new Error("control_count must be greater than degree");
  const knotCount = controlCount + degree + 1;
  const knots = new Array(knotCount).fill(0);
  const endStart = knotCount - degree - 1;
  for (let i = endStart; i < knotCount; i += 1) knots[i] = 1;
  const interiorCount = controlCount - degree - 1;
  if (interiorCount > 0) {
    const interior = linspaceInclusive(0, 1, interiorCount + 2).slice(1, -1);
    for (let i = 0; i < interiorCount; i += 1) knots[degree + 1 + i] = interior[i];
  }
  return knots;
}

export function findSpan(controlCount, degree, parameter, knots) {
  const n = controlCount - 1;
  if (parameter >= knots[n + 1] - EPSILON) return n;
  if (parameter <= knots[degree] + EPSILON) return degree;
  let low = degree;
  let high = n + 1;
  let mid = Math.floor((low + high) / 2);
  while (parameter < knots[mid] || parameter >= knots[mid + 1]) {
    if (parameter < knots[mid]) high = mid;
    else low = mid;
    mid = Math.floor((low + high) / 2);
  }
  return mid;
}

export function basisFunctions(span, parameter, degree, knots) {
  const left = new Array(degree + 1).fill(0);
  const right = new Array(degree + 1).fill(0);
  const values = new Array(degree + 1).fill(0);
  values[0] = 1;
  for (let j = 1; j <= degree; j += 1) {
    left[j] = parameter - knots[span + 1 - j];
    right[j] = knots[span + j] - parameter;
    let saved = 0;
    for (let r = 0; r < j; r += 1) {
      const denom = right[r + 1] + left[j - r];
      const term = Math.abs(denom) < EPSILON ? 0 : values[r] / denom;
      values[r] = saved + right[r + 1] * term;
      saved = left[j - r] * term;
    }
    values[j] = saved;
  }
  return values;
}

export function basisFirstDerivatives(span, parameter, degree, knots) {
  const derivatives = new Array(degree + 1).fill(0);
  if (degree === 0) return derivatives;
  const lowerBasis = basisFunctions(span, parameter, degree - 1, knots);
  for (let localIndex = 0; localIndex <= degree; localIndex += 1) {
    const globalIndex = span - degree + localIndex;
    const leftDenom = knots[globalIndex + degree] - knots[globalIndex];
    const rightDenom = knots[globalIndex + degree + 1] - knots[globalIndex + 1];
    let leftTerm = 0;
    let rightTerm = 0;
    if (localIndex > 0 && Math.abs(leftDenom) >= EPSILON) {
      leftTerm = (degree * lowerBasis[localIndex - 1]) / leftDenom;
    }
    if (localIndex < degree && Math.abs(rightDenom) >= EPSILON) {
      rightTerm = (degree * lowerBasis[localIndex]) / rightDenom;
    }
    derivatives[localIndex] = leftTerm - rightTerm;
  }
  return derivatives;
}
