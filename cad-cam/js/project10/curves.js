/** 3D curves — ported from core/curves.py */

import { EPSILON, linspaceInclusive, normalize } from "../shared/utils.js";
import {
  findSpan, basisFunctions, basisFirstDerivatives, generateClampedUniformKnotVector,
} from "./bspline.js";

export class BezierCurve {
  constructor(controlPoints) {
    if (controlPoints.length < 2) throw new Error("Bezier needs at least 2 control points");
    this.controlPoints = controlPoints.map((p) => ({ ...p }));
    this.degree = this.controlPoints.length - 1;
    this.type = "Bezier";
  }

  parameterRange() {
    return [0, 1];
  }

  evaluatePoint(t) {
    let work = this.controlPoints.map((p) => ({ ...p }));
    for (let level = 1; level <= this.degree; level += 1) {
      const upper = this.degree - level + 1;
      for (let i = 0; i < upper; i += 1) {
        work[i] = {
          x: (1 - t) * work[i].x + t * work[i + 1].x,
          y: (1 - t) * work[i].y + t * work[i + 1].y,
          z: (1 - t) * work[i].z + t * work[i + 1].z,
        };
      }
    }
    return work[0];
  }

  evaluateDerivatives(t) {
    const point = this.evaluatePoint(t);
    if (this.degree === 0) return { point, tangent: { x: 0, y: 0, z: 0 } };
    const derivPts = [];
    for (let i = 0; i < this.controlPoints.length - 1; i += 1) {
      derivPts.push({
        x: this.degree * (this.controlPoints[i + 1].x - this.controlPoints[i].x),
        y: this.degree * (this.controlPoints[i + 1].y - this.controlPoints[i].y),
        z: this.degree * (this.controlPoints[i + 1].z - this.controlPoints[i].z),
      });
    }
    const derivCurve = new BezierCurve(derivPts);
    return { point, tangent: derivCurve.evaluatePoint(t) };
  }

  samplePoints(sampleCount) {
    const [tMin, tMax] = this.parameterRange();
    return linspaceInclusive(tMin, tMax, sampleCount).map((t) => this.evaluatePoint(t));
  }

  updateControlPointInplace(index, newPoint) {
    if (index < 0 || index >= this.controlPoints.length) throw new Error("index out of bounds");
    this.controlPoints[index] = { ...newPoint };
  }
}

export class NURBSCurve {
  constructor(controlPoints, degree, knots, weights) {
    this.controlPoints = controlPoints.map((p) => ({ ...p }));
    this.degree = degree;
    this.knots = knots.slice();
    this.weights = weights.slice();
    this.type = "NURBS";
    this._homogeneous = this.controlPoints.map((p, i) => ({
      x: p.x * weights[i], y: p.y * weights[i], z: p.z * weights[i], w: weights[i],
    }));
  }

  parameterRange() {
    const n = this.controlPoints.length;
    return [this.knots[this.degree], this.knots[n]];
  }

  evaluateDerivatives(t) {
    const n = this.controlPoints.length;
    const span = findSpan(n, this.degree, t, this.knots);
    const basis = basisFunctions(span, t, this.degree, this.knots);
    const deriv = basisFirstDerivatives(span, t, this.degree, this.knots);
    const curveW = { x: 0, y: 0, z: 0, w: 0 };
    const tangentW = { x: 0, y: 0, z: 0, w: 0 };
    for (let i = 0; i <= this.degree; i += 1) {
      const gi = span - this.degree + i;
      const h = this._homogeneous[gi];
      curveW.x += basis[i] * h.x;
      curveW.y += basis[i] * h.y;
      curveW.z += basis[i] * h.z;
      curveW.w += basis[i] * h.w;
      tangentW.x += deriv[i] * h.x;
      tangentW.y += deriv[i] * h.y;
      tangentW.z += deriv[i] * h.z;
      tangentW.w += deriv[i] * h.w;
    }
    const weight = curveW.w;
    if (Math.abs(weight) < EPSILON) throw new Error("weight near zero");
    const point = { x: curveW.x / weight, y: curveW.y / weight, z: curveW.z / weight };
    const tangent = {
      x: (tangentW.x - point.x * tangentW.w) / weight,
      y: (tangentW.y - point.y * tangentW.w) / weight,
      z: (tangentW.z - point.z * tangentW.w) / weight,
    };
    return { point, tangent };
  }

  evaluatePoint(t) {
    return this.evaluateDerivatives(t).point;
  }

  samplePoints(sampleCount) {
    const [tMin, tMax] = this.parameterRange();
    return linspaceInclusive(tMin, tMax, sampleCount).map((t) => this.evaluatePoint(t));
  }

  updateControlPointInplace(index, newPoint, newWeight = null) {
    if (index < 0 || index >= this.controlPoints.length) throw new Error("index out of bounds");
    this.controlPoints[index] = { ...newPoint };
    if (newWeight !== null) this.weights[index] = newWeight;
    const w = this.weights[index];
    this._homogeneous[index] = { x: newPoint.x * w, y: newPoint.y * w, z: newPoint.z * w, w };
  }
}

export class BSplineCurve extends NURBSCurve {
  constructor(controlPoints, degree, knots) {
    const weights = Array(controlPoints.length).fill(1);
    super(controlPoints, degree, knots, weights);
    this.type = "B-spline";
  }
}

export function convertCurveToNurbs(curve) {
  if (curve instanceof NURBSCurve) {
    return new NURBSCurve(curve.controlPoints, curve.degree, curve.knots, curve.weights);
  }
  if (curve instanceof BSplineCurve) {
    return new NURBSCurve(curve.controlPoints, curve.degree, curve.knots, curve.weights.slice());
  }
  if (curve instanceof BezierCurve) {
    const n = curve.controlPoints.length;
    const degree = curve.degree;
    const knots = [...Array(degree + 1).fill(0), ...Array(n).fill(1)];
    const weights = Array(n).fill(1);
    return new NURBSCurve(curve.controlPoints, degree, knots, weights);
  }
  throw new TypeError("unsupported curve type");
}

export function createCurveFromInputs(type, degree, knotMode, slot) {
  const count = type === "Bezier" ? 4 : Math.max(degree + 1, 4);
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / Math.max(count - 1, 1);
    points.push({ x: -30 + 60 * t, y: 20 * slot, z: 0 });
  }
  if (type === "Bezier") return new BezierCurve(points);
  const knots = knotMode === "Non-uniform"
    ? [...Array(degree + 1).fill(0), 0.25, 0.5, 0.75, ...Array(degree + 1).fill(1)].slice(0, count + degree + 1)
    : generateClampedUniformKnotVector(count, degree);
  if (type === "B-spline") return new BSplineCurve(points, degree, knots);
  const weights = Array(count).fill(1);
  return new NURBSCurve(points, degree, knots, weights);
}
