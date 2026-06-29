import {
  WIDTH, HEIGHT, GRID_SIZE, CENTER_X, CENTER_Y,
  screenToCartesian, cartesianToScreen,
  bezierCurve, bsplineCurve, nurbsCurve, createCurve,
} from "./curves.js";
import { downloadText } from "../shared/utils.js";

const canvas = document.getElementById("curveCanvas");
const ctx = canvas.getContext("2d");

let curves = [];
let activeCurveIndex = null;
let selectedPointIndex = null;
let displayMode = "ALL";
let dragging = false;

function activeCurve() {
  return activeCurveIndex === null ? null : curves[activeCurveIndex];
}

function updateCurveStatus() {
  const el = document.getElementById("curveStatus");
  if (!el) return;
  if (!curves.length) {
    el.textContent = "No curve — create one to begin";
    return;
  }
  const n = activeCurveIndex !== null ? activeCurveIndex + 1 : "—";
  const pts = activeCurve()?.points.length ?? 0;
  el.textContent = `Curve ${n} of ${curves.length} · ${pts} point(s)`;
}

function createNewCurve() {
  const degree = Math.min(parseInt(document.getElementById("degree").value, 10), 10);
  const knotMode = document.getElementById("knotMode").value;
  const curve = createCurve(curves.length, degree, knotMode);
  curves.push(curve);
  activeCurveIndex = curves.length - 1;
  selectedPointIndex = null;
  updateCurveStatus();
  redraw();
}

function deleteCurve() {
  if (!curves.length) return;
  if (activeCurveIndex === null || activeCurveIndex >= curves.length) {
    activeCurveIndex = curves.length - 1;
  }
  curves.splice(activeCurveIndex, 1);
  if (!curves.length) {
    activeCurveIndex = null;
    selectedPointIndex = null;
    document.getElementById("xEntry").value = "";
    document.getElementById("yEntry").value = "";
    updateCurveStatus();
    redraw();
    return;
  }
  activeCurveIndex = Math.min(activeCurveIndex, curves.length - 1);
  selectedPointIndex = null;
  document.getElementById("xEntry").value = "";
  document.getElementById("yEntry").value = "";
  updateCurveStatus();
  redraw();
}

function loadSelectedPointData() {
  const curve = activeCurve();
  if (!curve || selectedPointIndex === null) return;
  const p = curve.points[selectedPointIndex];
  const w = curve.weights[selectedPointIndex];
  document.getElementById("xEntry").value = p.x.toFixed(1);
  document.getElementById("yEntry").value = p.y.toFixed(1);
  document.getElementById("weightEntry").value = w.toFixed(1);
  document.getElementById("weightSlider").value = w;
}

function selectCurveAndPoint(sx, sy) {
  for (let ci = 0; ci < curves.length; ci += 1) {
    for (let pi = 0; pi < curves[ci].points.length; pi += 1) {
      const sc = cartesianToScreen(curves[ci].points[pi].x, curves[ci].points[pi].y);
      const dist = Math.hypot(sc.x - sx, sc.y - sy);
      if (dist < 12) {
        activeCurveIndex = ci;
        selectedPointIndex = pi;
        loadSelectedPointData();
        return true;
      }
    }
  }
  return false;
}

function drawGrid() {
  ctx.strokeStyle = "#dddddd";
  ctx.lineWidth = 1;
  for (let x = 0; x <= WIDTH; x += GRID_SIZE) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, HEIGHT); ctx.stroke();
  }
  for (let y = 0; y <= HEIGHT; y += GRID_SIZE) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WIDTH, y); ctx.stroke();
  }
  ctx.strokeStyle = "#999";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(CENTER_X, 0); ctx.lineTo(CENTER_X, HEIGHT); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, CENTER_Y); ctx.lineTo(WIDTH, CENTER_Y); ctx.stroke();
}

function drawPolyline(points, color, width) {
  if (points.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  const s0 = cartesianToScreen(points[0].x, points[0].y);
  ctx.moveTo(s0.x, s0.y);
  for (let i = 1; i < points.length; i += 1) {
    const s = cartesianToScreen(points[i].x, points[i].y);
    ctx.lineTo(s.x, s.y);
  }
  ctx.stroke();
}

function drawCurve(curve, isActive) {
  if (!isActive) return;
  const pts = curve.points;
  const wts = curve.weights;
  if (displayMode === "BEZIER" || displayMode === "ALL") {
    drawPolyline(bezierCurve(pts), "blue", 3);
  }
  if (displayMode === "BSPLINE" || displayMode === "ALL") {
    drawPolyline(bsplineCurve(pts, curve.degree, curve.bsplineMode), "green", 3);
  }
  if (displayMode === "NURBS" || displayMode === "ALL") {
    drawPolyline(nurbsCurve(pts, wts, curve.degree, curve.bsplineMode), "red", 4);
  }
}

function redraw() {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawGrid();
  ctx.fillStyle = "#1a1a2e";
  ctx.font = "bold 24px Arial";
  ctx.textAlign = "center";
  ctx.fillText("Advanced Curve Visualizer", WIDTH / 2, 30);
  ctx.font = "bold 12px Arial";
  ctx.fillStyle = "darkblue";
  ctx.fillText(`Mode : ${displayMode}`, WIDTH - 120, 30);
  ctx.textAlign = "left";
  ctx.fillStyle = "blue"; ctx.fillText("Blue : Bezier", 60, 60);
  ctx.fillStyle = "green"; ctx.fillText("Green : B-Spline", 60, 85);
  ctx.fillStyle = "red"; ctx.fillText("Red : NURBS", 60, 110);

  curves.forEach((curve, i) => drawCurve(curve, i === activeCurveIndex));

  curves.forEach((curve) => {
    for (let j = 0; j < curve.points.length - 1; j += 1) {
      const a = cartesianToScreen(curve.points[j].x, curve.points[j].y);
      const b = cartesianToScreen(curve.points[j + 1].x, curve.points[j + 1].y);
      ctx.strokeStyle = "gray";
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  curves.forEach((curve, ci) => {
    curve.points.forEach((p, pi) => {
      const s = cartesianToScreen(p.x, p.y);
      const selected = ci === activeCurveIndex && pi === selectedPointIndex;
      ctx.fillStyle = selected ? "orange" : "black";
      const r = selected ? 8 : 5;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = curve.color;
      ctx.font = "bold 9px Arial";
      ctx.textAlign = "center";
      ctx.fillText(`P${pi}`, s.x, s.y - 15);
      ctx.fillStyle = "darkred";
      ctx.fillText(`W=${curve.weights[pi].toFixed(1)}`, s.x, s.y + 18);
    });
  });
  updateCurveStatus();
}

canvas.addEventListener("mousedown", (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = (e.clientX - rect.left) * (WIDTH / rect.width);
  const sy = (e.clientY - rect.top) * (HEIGHT / rect.height);
  if (selectCurveAndPoint(sx, sy)) { dragging = true; redraw(); return; }
  const curve = activeCurve();
  if (!curve) return;
  const c = screenToCartesian(sx, sy);
  curve.points.push(c);
  curve.weights.push(1);
  redraw();
});

canvas.addEventListener("mousemove", (e) => {
  if (!dragging || activeCurveIndex === null || selectedPointIndex === null) return;
  const rect = canvas.getBoundingClientRect();
  const sx = (e.clientX - rect.left) * (WIDTH / rect.width);
  const sy = (e.clientY - rect.top) * (HEIGHT / rect.height);
  const c = screenToCartesian(sx, sy);
  curves[activeCurveIndex].points[selectedPointIndex] = c;
  loadSelectedPointData();
  redraw();
});

canvas.addEventListener("mouseup", () => { dragging = false; });
window.addEventListener("mouseup", () => { dragging = false; });

document.getElementById("btnNewCurve").addEventListener("click", createNewCurve);
document.getElementById("btnDeleteCurve").addEventListener("click", deleteCurve);
document.getElementById("btnToggleMode").addEventListener("click", () => {
  const modes = ["BEZIER", "BSPLINE", "NURBS", "ALL"];
  displayMode = modes[(modes.indexOf(displayMode) + 1) % modes.length];
  redraw();
});
document.getElementById("btnDeletePoint").addEventListener("click", () => {
  const curve = activeCurve();
  if (!curve || curve.points.length === 0) return;
  // Delete the selected point if one is selected, otherwise drop the last point.
  const idx = selectedPointIndex !== null ? selectedPointIndex : curve.points.length - 1;
  curve.points.splice(idx, 1);
  curve.weights.splice(idx, 1);
  selectedPointIndex = null;
  redraw();
});
document.getElementById("btnUpdatePoint").addEventListener("click", () => {
  if (activeCurveIndex === null || selectedPointIndex === null) return;
  curves[activeCurveIndex].points[selectedPointIndex] = {
    x: parseFloat(document.getElementById("xEntry").value),
    y: parseFloat(document.getElementById("yEntry").value),
  };
  redraw();
});
document.getElementById("weightSlider").addEventListener("input", (e) => {
  if (activeCurveIndex === null || selectedPointIndex === null) return;
  const w = parseFloat(e.target.value);
  curves[activeCurveIndex].weights[selectedPointIndex] = w;
  document.getElementById("weightEntry").value = w.toFixed(1);
  redraw();
});
document.getElementById("weightEntry").addEventListener("change", (e) => {
  if (activeCurveIndex === null || selectedPointIndex === null) return;
  const w = parseFloat(e.target.value);
  curves[activeCurveIndex].weights[selectedPointIndex] = w;
  document.getElementById("weightSlider").value = w;
  redraw();
});
document.getElementById("btnExportCsv").addEventListener("click", () => {
  const curve = activeCurve();
  if (!curve) return;
  const pts = nurbsCurve(curve.points, curve.weights, curve.degree, curve.bsplineMode);
  const lines = ["X,Y", ...pts.map((p) => `${p.x},${p.y}`)];
  downloadText("curve.csv", lines.join("\n"));
});
document.getElementById("btnExportGcode").addEventListener("click", () => {
  const curve = activeCurve();
  if (!curve) return;
  const pts = nurbsCurve(curve.points, curve.weights, curve.degree, curve.bsplineMode);
  const lines = ["G21", "G90", "G0 Z5"];
  if (pts.length) {
    lines.push(`G0 X${pts[0].x.toFixed(3)} Y${pts[0].y.toFixed(3)}`, "G1 Z0 F300");
    pts.forEach((p) => lines.push(`G1 X${p.x.toFixed(3)} Y${p.y.toFixed(3)} F1000`));
  }
  lines.push("G0 Z5", "M30");
  downloadText("curve.gcode", lines.join("\n"));
});

createNewCurve();
curves[0].points.push({ x: -150, y: 0 }, { x: -50, y: 120 }, { x: 80, y: -80 }, { x: 180, y: 40 });
curves[0].weights.push(1, 1, 1, 1);
redraw();
