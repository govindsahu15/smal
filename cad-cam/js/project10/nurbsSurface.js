/** NURBS surface — ported from surface/nurbs_surface.py */

import { EPSILON, cross, normalize, linspaceInclusive } from "../shared/utils.js";
import {
  findSpan,
  basisFunctions,
  basisFirstDerivatives,
} from "./bspline.js";

export class NURBSSurface {
  constructor(controlNet, weights, knotU, knotV, degreeU, degreeV) {
    this.controlNet = controlNet;
    this.weights = weights;
    this.knotU = knotU;
    this.knotV = knotV;
    this.degreeU = degreeU;
    this.degreeV = degreeV;
    this._homogeneous = this._buildHomogeneousControlNet();
  }

  parameterRanges() {
    return [
      [this.knotU[this.degreeU], this.knotU[this.knotU.length - this.degreeU - 1]],
      [this.knotV[this.degreeV], this.knotV[this.knotV.length - this.degreeV - 1]],
    ];
  }

  _buildHomogeneousControlNet() {
    const rows = this.controlNet.length;
    const cols = this.controlNet[0].length;
    const h = [];
    for (let i = 0; i < rows; i += 1) {
      const row = [];
      for (let j = 0; j < cols; j += 1) {
        const p = this.controlNet[i][j];
        const w = this.weights[i][j];
        row.push({ x: p.x * w, y: p.y * w, z: p.z * w, w });
      }
      h.push(row);
    }
    return h;
  }

  _evaluateHomogeneousPartials(spanU, spanV, basisU, basisV, derivU, derivV) {
    const surfaceW = { x: 0, y: 0, z: 0, w: 0 };
    const duW = { x: 0, y: 0, z: 0, w: 0 };
    const dvW = { x: 0, y: 0, z: 0, w: 0 };

    for (let localU = 0; localU <= this.degreeU; localU += 1) {
      const globalU = spanU - this.degreeU + localU;
      for (let localV = 0; localV <= this.degreeV; localV += 1) {
        const globalV = spanV - this.degreeV + localV;
        const controlH = this._homogeneous[globalU][globalV];
        const coeff = basisU[localU] * basisV[localV];
        const coeffDu = derivU[localU] * basisV[localV];
        const coeffDv = basisU[localU] * derivV[localV];

        surfaceW.x += coeff * controlH.x;
        surfaceW.y += coeff * controlH.y;
        surfaceW.z += coeff * controlH.z;
        surfaceW.w += coeff * controlH.w;
        duW.x += coeffDu * controlH.x;
        duW.y += coeffDu * controlH.y;
        duW.z += coeffDu * controlH.z;
        duW.w += coeffDu * controlH.w;
        dvW.x += coeffDv * controlH.x;
        dvW.y += coeffDv * controlH.y;
        dvW.z += coeffDv * controlH.z;
        dvW.w += coeffDv * controlH.w;
      }
    }
    return { surfaceW, duW, dvW };
  }

  evaluateDerivatives(uValue, vValue) {
    const uCount = this.controlNet.length;
    const vCount = this.controlNet[0].length;
    const spanU = findSpan(uCount, this.degreeU, uValue, this.knotU);
    const spanV = findSpan(vCount, this.degreeV, vValue, this.knotV);
    const basisU = basisFunctions(spanU, uValue, this.degreeU, this.knotU);
    const basisV = basisFunctions(spanV, vValue, this.degreeV, this.knotV);
    const derivU = basisFirstDerivatives(spanU, uValue, this.degreeU, this.knotU);
    const derivV = basisFirstDerivatives(spanV, vValue, this.degreeV, this.knotV);
    const { surfaceW, duW, dvW } = this._evaluateHomogeneousPartials(
      spanU, spanV, basisU, basisV, derivU, derivV,
    );

    const weight = surfaceW.w;
    if (Math.abs(weight) < EPSILON) throw new Error("homogeneous weight near zero");
    const point = {
      x: surfaceW.x / weight,
      y: surfaceW.y / weight,
      z: surfaceW.z / weight,
    };
    const du = {
      x: (duW.x - point.x * duW.w) / weight,
      y: (duW.y - point.y * duW.w) / weight,
      z: (duW.z - point.z * duW.w) / weight,
    };
    const dv = {
      x: (dvW.x - point.x * dvW.w) / weight,
      y: (dvW.y - point.y * dvW.w) / weight,
      z: (dvW.z - point.z * dvW.w) / weight,
    };
    return { point, du, dv };
  }

  evaluateGrid(uSamples, vSamples) {
    const [[uMin, uMax], [vMin, vMax]] = this.parameterRanges();
    const uValues = linspaceInclusive(uMin, uMax, uSamples);
    const vValues = linspaceInclusive(vMin, vMax, vSamples);
    const points = [];
    const normals = [];
    for (let iU = 0; iU < uSamples; iU += 1) {
      const row = [];
      const nRow = [];
      for (let iV = 0; iV < vSamples; iV += 1) {
        const ev = this.evaluateDerivatives(uValues[iU], vValues[iV]);
        row.push(ev.point);
        nRow.push(normalize(cross(ev.du, ev.dv)));
      }
      points.push(row);
      normals.push(nRow);
    }
    return { points, normals, uValues, vValues };
  }

  evaluateNormal(uValue, vValue) {
    const ev = this.evaluateDerivatives(uValue, vValue);
    return normalize(cross(ev.du, ev.dv));
  }

  updateControlPointInplace(row, col, newPoint, newWeight = null) {
    this.controlNet[row][col] = { ...newPoint };
    if (newWeight !== null) this.weights[row][col] = newWeight;
    this._homogeneous = this._buildHomogeneousControlNet();
  }
}
