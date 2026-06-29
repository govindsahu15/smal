/** Curve math ported from CADCAM_project.py */

export const WIDTH = 1200;
export const HEIGHT = 600;
export const GRID_SIZE = 50;
export const CENTER_X = WIDTH / 2;
export const CENTER_Y = HEIGHT / 2;

export const CURVE_COLORS = [
  "red", "blue", "green", "purple", "orange", "brown", "magenta", "cyan",
];

export function screenToCartesian(sx, sy) {
  return { x: sx - CENTER_X, y: CENTER_Y - sy };
}

export function cartesianToScreen(x, y) {
  return { x: x + CENTER_X, y: CENTER_Y - y };
}

export function generateUniformKnotVector(n, degree) {
  const totalKnots = n + degree + 1;
  const interiorCount = totalKnots - 2 * (degree + 1);
  const knots = Array(degree + 1).fill(0);
  if (interiorCount > 0) {
    for (let i = 1; i <= interiorCount; i += 1) {
      knots.push(i / (interiorCount + 1));
    }
  }
  return knots.concat(Array(degree + 1).fill(1));
}

export function generateNonuniformKnotVector(n, degree) {
  const totalKnots = n + degree + 1;
  const knots = Array(degree + 1).fill(0);
  const interiorCount = totalKnots - 2 * (degree + 1);
  if (interiorCount <= 0) return knots.concat(Array(degree + 1).fill(1));
  const values = [0.05, 0.08, 0.12, 0.2, 0.35, 0.55, 0.75, 0.9];
  return knots.concat(values.slice(0, interiorCount), Array(degree + 1).fill(1));
}

function bezierPoint(t, pts) {
  let temp = pts.map((p) => ({ x: p.x, y: p.y }));
  while (temp.length > 1) {
    const next = [];
    for (let i = 0; i < temp.length - 1; i += 1) {
      next.push({
        x: (1 - t) * temp[i].x + t * temp[i + 1].x,
        y: (1 - t) * temp[i].y + t * temp[i + 1].y,
      });
    }
    temp = next;
  }
  return temp[0];
}

export function bezierCurve(points, numPoints = 80) {
  if (points.length < 2) return [];
  const curve = [];
  for (let step = 0; step < numPoints; step += 1) {
    const t = step / (numPoints - 1);
    curve.push(bezierPoint(t, points));
  }
  return curve;
}

function basis(i, k, t, knot, n) {
  if (k === 0) {
    if (knot[i] <= t && t < knot[i + 1]) return 1;
    if (t === knot[knot.length - 1] && i === n - 1) return 1;
    return 0;
  }
  const denom1 = knot[i + k] - knot[i];
  const denom2 = knot[i + k + 1] - knot[i + 1];
  let term1 = 0;
  let term2 = 0;
  if (denom1 !== 0) term1 = ((t - knot[i]) / denom1) * basis(i, k - 1, t, knot, n);
  if (denom2 !== 0) term2 = ((knot[i + k + 1] - t) / denom2) * basis(i + 1, k - 1, t, knot, n);
  return term1 + term2;
}

export function nurbsCurve(pts, wts, degree = 3, knotMode = "UNIFORM", numPoints = 80) {
  if (pts.length < 2) return [];
  const deg = Math.min(degree, pts.length - 1);
  const n = pts.length;
  const knot = knotMode === "UNIFORM"
    ? generateUniformKnotVector(n, deg)
    : generateNonuniformKnotVector(n, deg);

  const tMin = knot[deg];
  const tMax = knot[knot.length - deg - 1];
  const curve = [];

  for (let step = 0; step < numPoints; step += 1) {
    const t = tMin + ((tMax - tMin) * step) / (numPoints - 1);
    let numX = 0;
    let numY = 0;
    let den = 0;
    for (let i = 0; i < n; i += 1) {
      const b = basis(i, deg, t, knot, n);
      const w = wts[i];
      numX += pts[i].x * b * w;
      numY += pts[i].y * b * w;
      den += b * w;
    }
    if (den !== 0) curve.push({ x: numX / den, y: numY / den });
  }
  return curve;
}

export function bsplineCurve(points, degree = 3, knotMode = "UNIFORM", numPoints = 80) {
  if (points.length <= degree) return [];
  const weights = Array(points.length).fill(1);
  return nurbsCurve(points, weights, degree, knotMode, numPoints);
}

export function createCurve(index, degree, knotMode) {
  return {
    points: [],
    weights: [],
    color: CURVE_COLORS[index % CURVE_COLORS.length],
    name: `Curve ${index + 1}`,
    degree,
    bsplineMode: knotMode,
  };
}
