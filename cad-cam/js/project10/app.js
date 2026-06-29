import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createDefaultSurface } from "./factory.js";
import { extrudeSurfaceFromCurve } from "./extrusion.js";
import { loftSurfaceFromCurves } from "./loft.js";
import { buildSurfaceExtrusionMesh } from "./bodyExtrusion.js";
import { extrudeSurfaceAlongCenterNormal } from "./surfaceNormalExtrusion.js";
import { generateZigzagToolpath } from "./toolpath.js";
import { generateMeshZigzagToolpath } from "./meshToolpath.js";
import { generateGcodeProgram } from "./gcode.js";
import {
  createCurveFromInputs, BezierCurve, BSplineCurve, NURBSCurve,
} from "./curves.js";
import { generateClampedUniformKnotVector } from "./bspline.js";
import {
  AXIS_VECTORS, DEFAULT_SURFACE_SAMPLES_U, DEFAULT_SURFACE_SAMPLES_V,
} from "./config.js";
import { downloadText } from "../shared/utils.js";

// ── State ──────────────────────────────────────────────────────────────────
let nextCurveId = 1;
let nextSurfaceId = 1;
let nextBodyId = 1;
const curves = [];
let activeCurveId = null;
let selectedCurvePointIndex = null;
const surfaces = [];
let activeSurfaceId = null;
const derivedBodies = [];
let activeBodyId = null;
let generatedPasses = [];

let planeLock = true;
let dragSensitivity = 1.0;
const visibility = {
  curves: true,
  surface: true,
  bodies: true,
  surfControlPts: true,
  controlNet: true,
  toolpath: true,
  grid: true,
};
let isDraggingCurvePoint = false;
let dragCurvePointIndex = null;

// ── Three.js ───────────────────────────────────────────────────────────────
let scene, camera, renderer, controls, raycaster, pointer;
const sceneGroups = {
  curves: new THREE.Group(),
  surface: new THREE.Group(),
  bodies: new THREE.Group(),
  controlPoints: new THREE.Group(),
  controlNet: new THREE.Group(),
  toolpath: new THREE.Group(),
};
let pickSpheres = [];
let gridHelper = null;
let axesHelper = null;

function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}

function $(id) { return document.getElementById(id); }

function activeCurveEntry() {
  return curves.find((c) => c.id === activeCurveId) ?? null;
}

function activeSurfaceEntry() {
  return surfaces.find((s) => s.id === activeSurfaceId) ?? null;
}

function activeBodyEntry() {
  return derivedBodies.find((b) => b.id === activeBodyId) ?? null;
}

function curveTypeName(curve) {
  if (curve instanceof BezierCurve) return "Bezier";
  if (curve instanceof BSplineCurve) return "B-spline";
  return "NURBS";
}

function curveUsesWeights(curve) {
  return curve instanceof NURBSCurve && curve.type === "NURBS";
}

function rebuildCurveAfterPointChange(entry) {
  const { curve, knotMode } = entry;
  const pts = curve.controlPoints.map((p) => ({ ...p }));
  if (curve instanceof BezierCurve) {
    entry.curve = new BezierCurve(pts);
    return;
  }
  const degree = Math.min(curve.degree, pts.length - 1);
  if (curve instanceof BSplineCurve) {
    const knots = knotMode === "Non-uniform"
      ? [...Array(degree + 1).fill(0), 0.25, 0.5, 0.75, ...Array(degree + 1).fill(1)].slice(0, pts.length + degree + 1)
      : generateClampedUniformKnotVector(pts.length, degree);
    entry.curve = new BSplineCurve(pts, degree, knots);
    return;
  }
  const weights = curve.weights.slice();
  while (weights.length < pts.length) weights.push(1);
  weights.length = pts.length;
  const knots = knotMode === "Non-uniform"
    ? [...Array(degree + 1).fill(0), 0.25, 0.5, 0.75, ...Array(degree + 1).fill(1)].slice(0, pts.length + degree + 1)
    : generateClampedUniformKnotVector(pts.length, degree);
  entry.curve = new NURBSCurve(pts, degree, knots, weights);
}

function updateWeightFieldState() {
  const active = activeCurveEntry();
  const show = active && curveUsesWeights(active.curve);
  $("curvePtW").disabled = !show;
  if (!show) $("curvePtW").value = "1";
}

function initThree() {
  const container = $("viewport");
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf8fafc);

  camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 5000);
  camera.position.set(80, -120, 90);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const dir = new THREE.DirectionalLight(0xffffff, 0.85);
  dir.position.set(1, 1, 1.5);
  scene.add(dir);

  gridHelper = new THREE.GridHelper(200, 20, 0xb0bec5, 0xe0e0e0);
  scene.add(gridHelper);

  axesHelper = new THREE.AxesHelper(25);
  scene.add(axesHelper);

  Object.values(sceneGroups).forEach((g) => scene.add(g));

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();

  window.addEventListener("resize", () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", () => {
    isDraggingCurvePoint = false;
    dragCurvePointIndex = null;
    controls.enabled = true;
  });

  (function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  })();
}

function clearGroup(group) {
  while (group.children.length) {
    const obj = group.children[0];
    group.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material.dispose();
    }
  }
}

function meshFromGrid(points, color = 0x26a69a, opacity = 0.85) {
  const rows = points.length;
  const cols = points[0].length;
  const positions = [];
  const indices = [];
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      positions.push(points[i][j].x, points[i][j].y, points[i][j].z);
    }
  }
  for (let i = 0; i < rows - 1; i += 1) {
    for (let j = 0; j < cols - 1; j += 1) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
    color, side: THREE.DoubleSide, shininess: 50, transparent: true, opacity,
  }));
}

function meshFromBody(vertices, triangles, color = 0x26a69a) {
  const positions = new Float32Array(vertices.length * 3);
  vertices.forEach((v, i) => {
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
  });
  const indices = [];
  triangles.forEach((t) => indices.push(t[0], t[1], t[2]));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
    color, side: THREE.DoubleSide, shininess: 40,
  }));
}

function buildToolpathLines(passes) {
  const positions = [];
  passes.forEach((pass) => {
    for (let i = 1; i < pass.points.length; i += 1) {
      const a = pass.points[i - 1].clPoint;
      const b = pass.points[i].clPoint;
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x2e7d32 }));
}

function refreshScene(resetCamera = false) {
  pickSpheres = [];
  clearGroup(sceneGroups.curves);
  clearGroup(sceneGroups.surface);
  clearGroup(sceneGroups.bodies);
  clearGroup(sceneGroups.controlPoints);
  clearGroup(sceneGroups.controlNet);
  clearGroup(sceneGroups.toolpath);

  const colors = [0xe53935, 0x1e88e5, 0x43a047, 0x8e24aa, 0xfb8c00];

  curves.forEach((entry, ci) => {
    const { curve, id } = entry;
    const isActive = id === activeCurveId;
    const color = colors[ci % colors.length];
    const samples = curve.samplePoints(Math.max(40, curve.controlPoints.length * 12));
    const linePts = samples.flatMap((p) => [p.x, p.y, p.z]);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePts, 3));
    sceneGroups.curves.add(new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({ color, linewidth: 2 }),
    ));

    curve.controlPoints.forEach((p, pi) => {
      const selected = isActive && pi === selectedCurvePointIndex;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(selected ? 2.2 : 1.4, 14, 14),
        new THREE.MeshBasicMaterial({ color: selected ? 0xff9800 : color }),
      );
      sphere.position.set(p.x, p.y, p.z);
      sphere.userData = { kind: "curvePoint", curveId: id, pointIndex: pi };
      sceneGroups.curves.add(sphere);
      pickSpheres.push(sphere);
    });
  });

  const surfEntry = activeSurfaceEntry();
  if (surfEntry) {
    const { points } = surfEntry.surface.evaluateGrid(DEFAULT_SURFACE_SAMPLES_U, DEFAULT_SURFACE_SAMPLES_V);
    sceneGroups.surface.add(meshFromGrid(points, 0x4dd0e1, 0.35));

    surfEntry.surface.controlNet.forEach((row, ri) => {
      row.forEach((p, ci) => {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(1.3, 10, 10),
          new THREE.MeshBasicMaterial({ color: 0xe53935 }),
        );
        m.position.set(p.x, p.y, p.z);
        sceneGroups.controlPoints.add(m);
      });
    });

    const net = surfEntry.surface.controlNet;
    for (let i = 0; i < net.length; i += 1) {
      for (let j = 0; j < net[i].length - 1; j += 1) {
        const a = net[i][j];
        const b = net[i][j + 1];
        const g = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(a.x, a.y, a.z),
          new THREE.Vector3(b.x, b.y, b.z),
        ]);
        sceneGroups.controlNet.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x78909c })));
      }
    }
    for (let j = 0; j < net[0].length; j += 1) {
      for (let i = 0; i < net.length - 1; i += 1) {
        const a = net[i][j];
        const b = net[i + 1][j];
        const g = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(a.x, a.y, a.z),
          new THREE.Vector3(b.x, b.y, b.z),
        ]);
        sceneGroups.controlNet.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x78909c })));
      }
    }
    syncSurfacePointEditor();
  }

  derivedBodies.forEach((body) => {
    const isActive = body.id === activeBodyId;
    sceneGroups.bodies.add(meshFromBody(
      body.vertices,
      body.triangles,
      isActive ? 0x26a69a : 0x80cbc4,
    ));
  });

  if (generatedPasses.length) {
    sceneGroups.toolpath.add(buildToolpathLines(generatedPasses));
  }

  if (resetCamera) {
    camera.position.set(80, -120, 90);
    controls.target.set(30, 0, 20);
    controls.update();
  }

  applySceneVisibility();
}

function applySceneVisibility() {
  sceneGroups.curves.visible = visibility.curves;
  sceneGroups.surface.visible = visibility.surface;
  sceneGroups.bodies.visible = visibility.bodies;
  sceneGroups.controlPoints.visible = visibility.surfControlPts;
  sceneGroups.controlNet.visible = visibility.controlNet;
  sceneGroups.toolpath.visible = visibility.toolpath;
  if (gridHelper) gridHelper.visible = visibility.grid;
  if (axesHelper) axesHelper.visible = visibility.grid;
}

// ── Curve management ───────────────────────────────────────────────────────
function refreshCurveLists() {
  const list = $("curveList");
  list.innerHTML = "";
  if (!curves.length) {
    const opt = document.createElement("option");
    opt.textContent = "(no curves)";
    list.appendChild(opt);
    $("curvePointList").innerHTML = "";
    updateWeightFieldState();
    return;
  }
  curves.forEach((entry) => {
    const opt = document.createElement("option");
    opt.value = String(entry.id);
    opt.textContent = `${entry.name} (${curveTypeName(entry.curve)})`;
    if (entry.id === activeCurveId) opt.selected = true;
    list.appendChild(opt);
  });

  const ptList = $("curvePointList");
  ptList.innerHTML = "";
  const active = activeCurveEntry();
  if (!active) return;
  active.curve.controlPoints.forEach((p, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `P${i} (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`;
    if (i === selectedCurvePointIndex) opt.selected = true;
    ptList.appendChild(opt);
  });
  syncCurvePointEditor();
  updateWeightFieldState();
}

function syncCurvePointEditor() {
  const active = activeCurveEntry();
  if (!active || selectedCurvePointIndex === null) {
    $("curvePtX").value = "";
    $("curvePtY").value = "";
    $("curvePtZ").value = "";
    return;
  }
  const p = active.curve.controlPoints[selectedCurvePointIndex];
  $("curvePtX").value = p.x.toFixed(3);
  $("curvePtY").value = p.y.toFixed(3);
  $("curvePtZ").value = p.z.toFixed(3);
  if (curveUsesWeights(active.curve)) {
    $("curvePtW").value = active.curve.weights[selectedCurvePointIndex].toFixed(3);
  }
}

function syncSurfacePointEditor() {
  const entry = activeSurfaceEntry();
  if (!entry) return;
  const rows = entry.surface.controlNet.length;
  const cols = entry.surface.controlNet[0].length;
  $("surfRow").max = rows - 1;
  $("surfCol").max = cols - 1;
  const ri = Math.min(parseInt($("surfRow").value, 10) || 0, rows - 1);
  const ci = Math.min(parseInt($("surfCol").value, 10) || 0, cols - 1);
  $("surfRow").value = ri;
  $("surfCol").value = ci;
  const p = entry.surface.controlNet[ri][ci];
  $("surfPtX").value = p.x.toFixed(3);
  $("surfPtY").value = p.y.toFixed(3);
  $("surfPtZ").value = p.z.toFixed(3);
  $("surfPtW").value = entry.surface.weights[ri][ci].toFixed(3);
}

function refreshSurfaceSelector() {
  const sel = $("surfaceSelector");
  sel.innerHTML = "";
  if (!surfaces.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "(generate a surface first)";
    sel.appendChild(opt);
    return;
  }
  surfaces.forEach((entry) => {
    const opt = document.createElement("option");
    opt.value = String(entry.id);
    opt.textContent = entry.name;
    if (entry.id === activeSurfaceId) opt.selected = true;
    sel.appendChild(opt);
  });
}

function refreshBodySelector() {
  const sel = $("bodySelector");
  sel.innerHTML = "";
  if (!derivedBodies.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "(extrude a body first)";
    sel.appendChild(opt);
    return;
  }
  derivedBodies.forEach((entry) => {
    const opt = document.createElement("option");
    opt.value = String(entry.id);
    opt.textContent = entry.name;
    if (entry.id === activeBodyId) opt.selected = true;
    sel.appendChild(opt);
  });
}

function createCurve() {
  const type = $("curveType").value;
  const degree = parseInt($("curveDegree").value, 10);
  const knotMode = $("curveKnotMode").value;
  const slot = curves.length;
  const curve = createCurveFromInputs(type, degree, knotMode, slot);
  const id = nextCurveId++;
  curves.push({ id, curve, name: `Curve ${id}`, knotMode });
  activeCurveId = id;
  selectedCurvePointIndex = 0;
  refreshCurveLists();
  refreshScene();
  setStatus(`Created ${type} curve ${id}`);
}

function deleteCurve() {
  const listId = parseInt($("curveList").value, 10);
  const targetId = Number.isFinite(listId) && listId ? listId : activeCurveId;
  const idx = curves.findIndex((c) => c.id === targetId);
  if (idx < 0) {
    setStatus("Select a curve in the list to delete");
    return;
  }
  curves.splice(idx, 1);
  if (!curves.length) {
    activeCurveId = null;
    selectedCurvePointIndex = null;
    setStatus("Curve deleted — use Create Curve to add a new one");
  } else {
    activeCurveId = curves[Math.min(idx, curves.length - 1)].id;
    selectedCurvePointIndex = 0;
    setStatus("Curve deleted");
  }
  refreshCurveLists();
  refreshScene();
}

function addCurvePoint() {
  const entry = activeCurveEntry();
  if (!entry) return;
  const pts = entry.curve.controlPoints;
  const last = pts[pts.length - 1];
  pts.push({ x: last.x + 10, y: last.y, z: planeLock ? 0 : last.z + 5 });
  rebuildCurveAfterPointChange(entry);
  selectedCurvePointIndex = entry.curve.controlPoints.length - 1;
  refreshCurveLists();
  refreshScene();
}

function deleteCurvePoint() {
  const entry = activeCurveEntry();
  if (!entry || selectedCurvePointIndex === null) return;
  if (entry.curve.controlPoints.length <= 2) {
    setStatus("Curve needs at least 2 points");
    return;
  }
  entry.curve.controlPoints.splice(selectedCurvePointIndex, 1);
  rebuildCurveAfterPointChange(entry);
  selectedCurvePointIndex = Math.min(selectedCurvePointIndex, entry.curve.controlPoints.length - 1);
  refreshCurveLists();
  refreshScene();
}

function applyCurvePointEdit() {
  const entry = activeCurveEntry();
  if (!entry || selectedCurvePointIndex === null) return;
  const p = {
    x: parseFloat($("curvePtX").value),
    y: parseFloat($("curvePtY").value),
    z: parseFloat($("curvePtZ").value),
  };
  const w = parseFloat($("curvePtW").value);
  if (curveUsesWeights(entry.curve)) {
    entry.curve.updateControlPointInplace(selectedCurvePointIndex, p, w);
  } else {
    entry.curve.updateControlPointInplace(selectedCurvePointIndex, p);
  }
  refreshCurveLists();
  refreshScene(false);
  setStatus("Curve point updated");
}

// ── Surface / body ─────────────────────────────────────────────────────────
function registerSurface(surface, name, tag) {
  const id = nextSurfaceId++;
  surfaces.push({ id, surface, name, tag });
  activeSurfaceId = id;
  generatedPasses = [];
  refreshSurfaceSelector();
  refreshBodySelector();
  refreshScene(true);
}

function registerBody(vertices, triangles, name, mode) {
  const id = nextBodyId++;
  derivedBodies.push({ id, vertices, triangles, name, mode });
  activeBodyId = id;
  generatedPasses = [];
  refreshBodySelector();
  refreshScene(false);
}

function deleteActiveSurface() {
  const idx = surfaces.findIndex((s) => s.id === activeSurfaceId);
  if (idx < 0) {
    setStatus("No surface to delete");
    return;
  }
  surfaces.splice(idx, 1);
  activeSurfaceId = surfaces.length ? surfaces[Math.min(idx, surfaces.length - 1)].id : null;
  generatedPasses = [];
  refreshSurfaceSelector();
  refreshScene(false);
  setStatus("Active surface deleted");
}

function deleteActiveBody() {
  const idx = derivedBodies.findIndex((b) => b.id === activeBodyId);
  if (idx < 0) {
    setStatus("No body to delete");
    return;
  }
  derivedBodies.splice(idx, 1);
  activeBodyId = derivedBodies.length
    ? derivedBodies[Math.min(idx, derivedBodies.length - 1)].id
    : null;
  generatedPasses = [];
  refreshBodySelector();
  refreshScene(false);
  setStatus("Active body deleted");
}

function clearToolpath() {
  if (!generatedPasses.length) {
    setStatus("No toolpath to clear");
    return;
  }
  generatedPasses = [];
  refreshScene(false);
  setStatus("Toolpath cleared");
}

function clearAllGeometry() {
  surfaces.length = 0;
  derivedBodies.length = 0;
  activeSurfaceId = null;
  activeBodyId = null;
  generatedPasses = [];
  refreshSurfaceSelector();
  refreshBodySelector();
  refreshScene(false);
  setStatus("Surfaces, bodies, and toolpath cleared — curves kept");
}

function generateSurface() {
  const source = $("surfaceSource").value;
  try {
    let surface;
    let name;
    let tag;
    if (source === "control-net") {
      surface = createDefaultSurface(
        parseInt($("surfRows").value, 10),
        parseInt($("surfCols").value, 10),
      );
      name = `Control Net Surface ${nextSurfaceId}`;
      tag = "control-net";
    } else if (source === "curve-loft") {
      if (curves.length < 2) throw new Error("Need at least 2 curves for loft");
      surface = loftSurfaceFromCurves(
        curves.map((c) => c.curve),
        parseInt($("curveSamples").value, 10),
      );
      name = `Loft Surface ${nextSurfaceId}`;
      tag = "curve-loft";
    } else {
      const entry = activeCurveEntry();
      if (!entry) throw new Error("Select an active curve before extrusion");
      const axis = AXIS_VECTORS[$("extrudeAxis").value];
      surface = extrudeSurfaceFromCurve(
        entry.curve,
        axis,
        parseFloat($("extrudeHeight").value),
        parseInt($("extrudeLayers").value, 10),
        parseInt($("curveSamples").value, 10),
      );
      name = `Curve Extrusion Surface ${nextSurfaceId}`;
      tag = "curve-extrude";
    }
    registerSurface(surface, name, tag);
    setStatus(`Surface generated (${tag})`);
  } catch (err) {
    setStatus(`Surface generation failed: ${err.message}`);
  }
}

function extrudeSelectedSurface() {
  const entry = activeSurfaceEntry();
  if (!entry) {
    setStatus("Select or generate a surface before extrusion");
    return;
  }
  const mode = $("extrusionMode").value;
  const distance = parseFloat($("extrudeDistance").value);
  if (distance <= 0) {
    setStatus("Extrusion distance must be positive");
    return;
  }
  try {
    if (mode === "offset") {
      const derived = extrudeSurfaceAlongCenterNormal(entry.surface, distance);
      if ($("replaceSurface").checked) {
        entry.surface = derived;
        entry.name = `${entry.name} (normal extrude)`;
        entry.tag = "surface-normal-extrude-replace";
      } else {
        registerSurface(derived, `Surface normal extrusion ${nextSurfaceId}`, "surface-normal-extrude");
      }
      setStatus("Derived offset surface generated");
    } else {
      const { vertices, triangles } = buildSurfaceExtrusionMesh(
        entry.surface,
        distance,
        mode,
        DEFAULT_SURFACE_SAMPLES_U,
        DEFAULT_SURFACE_SAMPLES_V,
      );
      registerBody(vertices, triangles, `${mode.charAt(0).toUpperCase() + mode.slice(1)} Body ${nextBodyId}`, mode);
      setStatus(`Generated ${mode} extrusion body from active surface`);
    }
    generatedPasses = [];
    refreshScene(false);
  } catch (err) {
    setStatus(`Surface extrusion failed: ${err.message}`);
  }
}

function applySurfacePointEdit() {
  const entry = activeSurfaceEntry();
  if (!entry) return;
  const ri = parseInt($("surfRow").value, 10);
  const ci = parseInt($("surfCol").value, 10);
  const p = {
    x: parseFloat($("surfPtX").value),
    y: parseFloat($("surfPtY").value),
    z: parseFloat($("surfPtZ").value),
  };
  const w = parseFloat($("surfPtW").value);
  entry.surface.updateControlPointInplace(ri, ci, p, w);
  generatedPasses = [];
  refreshScene(false);
  setStatus("Surface control point updated");
}

function generateToolpath() {
  const stepover = parseFloat($("stepover").value);
  const toolRadius = parseFloat($("toolRadius").value);
  const tolerance = parseFloat($("chordTol").value);
  const source = $("toolpathSource").value;

  try {
    if (source === "mesh") {
      const body = activeBodyEntry() ?? derivedBodies[derivedBodies.length - 1];
      if (!body) throw new Error("Generate a solid/shell body first");
      activeBodyId = body.id;
      generatedPasses = generateMeshZigzagToolpath(
        body.vertices,
        body.triangles,
        stepover,
        toolRadius,
        120,
        tolerance,
        $("linkPasses").checked,
        $("meshEnvelope").value,
      );
    } else {
      const entry = activeSurfaceEntry();
      if (!entry) throw new Error("Generate or select a surface first");
      generatedPasses = generateZigzagToolpath(entry.surface, stepover, toolRadius);
    }
    if (!generatedPasses.length) throw new Error("No toolpath passes generated");
    refreshScene(false);
    setStatus(`Generated ${generatedPasses.length} toolpath pass(es)`);
  } catch (err) {
    setStatus(`Toolpath failed: ${err.message}`);
  }
}

function exportGcode() {
  if (!generatedPasses.length) {
    setStatus("Generate a toolpath before exporting G-code");
    return;
  }
  const text = generateGcodeProgram(generatedPasses, {
    feedRate: parseFloat($("feedRate").value),
    plungeRate: parseFloat($("plungeRate").value),
    safeZ: parseFloat($("safeZ").value),
    spindleRpm: parseInt($("spindleRpm").value, 10),
  });
  downloadText("toolpath.nc", text);
  setStatus("G-code exported");
}

// ── Viewport interaction ───────────────────────────────────────────────────
function pointerToNdc(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function raycastPlane() {
  raycaster.setFromCamera(pointer, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
}

function onPointerDown(event) {
  if (event.button !== 0) return;

  pointerToNdc(event);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickSpheres);

  if (hits.length) {
    const { curveId, pointIndex } = hits[0].object.userData;
    activeCurveId = curveId;
    selectedCurvePointIndex = pointIndex;
    $("curveList").value = String(curveId);
    $("curvePointList").value = String(pointIndex);
    refreshCurveLists();
    isDraggingCurvePoint = true;
    dragCurvePointIndex = pointIndex;
    controls.enabled = false;
    refreshScene(false);
    return;
  }

  if (event.shiftKey) {
    const entry = activeCurveEntry();
    if (!entry) {
      setStatus("Create or select a curve first");
      return;
    }
    const hit = raycastPlane();
    if (!hit) return;
    controls.enabled = false;
    const p = { x: hit.x, y: hit.y, z: planeLock ? 0 : hit.z };
    entry.curve.controlPoints.push(p);
    rebuildCurveAfterPointChange(entry);
    selectedCurvePointIndex = entry.curve.controlPoints.length - 1;
    refreshCurveLists();
    refreshScene(false);
    setStatus("Point added (Shift+click on plane)");
    return;
  }

  controls.enabled = true;
}

function onPointerMove(event) {
  if (!isDraggingCurvePoint || dragCurvePointIndex === null) return;
  const entry = activeCurveEntry();
  if (!entry) return;
  pointerToNdc(event);
  const hit = raycastPlane();
  if (!hit) return;
  const sens = dragSensitivity;
  const old = entry.curve.controlPoints[dragCurvePointIndex];
  const p = {
    x: old.x + (hit.x - old.x) * sens,
    y: old.y + (hit.y - old.y) * sens,
    z: planeLock ? 0 : old.z + (hit.z - old.z) * sens,
  };
  if (entry.curve instanceof NURBSCurve) {
    entry.curve.updateControlPointInplace(dragCurvePointIndex, p);
  } else {
    entry.curve.updateControlPointInplace(dragCurvePointIndex, p);
  }
  refreshCurveLists();
  refreshScene(false);
}

function syncSurfaceSourceUi() {
  const source = $("surfaceSource").value;
  const isNet = source === "control-net";
  const isExtrude = source === "curve-extrude";
  $("surfRows").disabled = !isNet;
  $("surfCols").disabled = !isNet;
  $("extrudeAxis").disabled = !isExtrude;
  $("extrudeHeight").disabled = !isExtrude;
  $("extrudeLayers").disabled = !isExtrude;
}

function createDefaultArchCurve() {
  const id = nextCurveId++;
  const points = [
    { x: -40, y: 0, z: 0 },
    { x: -15, y: 25, z: 0 },
    { x: 15, y: 25, z: 0 },
    { x: 40, y: 0, z: 0 },
  ];
  const curve = new BezierCurve(points);
  curves.push({ id, curve, name: `Curve ${id}`, knotMode: "Uniform" });
  activeCurveId = id;
  selectedCurvePointIndex = 0;
}

// ── Wire UI ────────────────────────────────────────────────────────────────
function bindUi() {
  $("btnCreateCurve").addEventListener("click", createCurve);
  $("btnDeleteCurve").addEventListener("click", deleteCurve);
  $("btnAddCurvePoint").addEventListener("click", addCurvePoint);
  $("btnDeleteCurvePoint").addEventListener("click", deleteCurvePoint);
  $("btnApplyCurvePoint").addEventListener("click", applyCurvePointEdit);
  $("btnApplySurfPoint").addEventListener("click", applySurfacePointEdit);
  $("btnGenerateSurface").addEventListener("click", generateSurface);
  $("btnExtrudeSurface").addEventListener("click", extrudeSelectedSurface);
  $("btnGenerateToolpath").addEventListener("click", generateToolpath);
  $("btnExportGcode").addEventListener("click", exportGcode);
  $("btnDeleteSurface").addEventListener("click", deleteActiveSurface);
  $("btnDeleteBody").addEventListener("click", deleteActiveBody);
  $("btnClearToolpath").addEventListener("click", clearToolpath);
  $("btnClearAll").addEventListener("click", clearAllGeometry);

  $("curveList").addEventListener("change", (e) => {
    const id = parseInt(e.target.value, 10);
    if (!id) return;
    if (id !== activeCurveId) selectedCurvePointIndex = 0;
    activeCurveId = id;
    refreshCurveLists();
    refreshScene(false);
  });
  $("curvePointList").addEventListener("change", (e) => {
    selectedCurvePointIndex = parseInt(e.target.value, 10);
    syncCurvePointEditor();
    refreshScene(false);
  });
  $("curvePlaneLock").addEventListener("change", (e) => { planeLock = e.target.checked; });
  const visMap = {
    visCurves: "curves",
    visSurface: "surface",
    visBodies: "bodies",
    visSurfControlPts: "surfControlPts",
    visControlNet: "controlNet",
    visToolpath: "toolpath",
    visGrid: "grid",
  };
  Object.entries(visMap).forEach(([elId, key]) => {
    $(elId).addEventListener("change", (e) => {
      visibility[key] = e.target.checked;
      applySceneVisibility();
    });
  });
  $("dragSensitivity").addEventListener("input", (e) => {
    dragSensitivity = parseFloat(e.target.value);
  });
  $("surfaceSource").addEventListener("change", syncSurfaceSourceUi);
  $("surfaceSelector").addEventListener("change", (e) => {
    const id = parseInt(e.target.value, 10);
    if (!id) return;
    activeSurfaceId = id;
    generatedPasses = [];
    refreshScene(false);
    setStatus(`Active surface: ${activeSurfaceEntry()?.name ?? ""}`);
  });
  $("bodySelector").addEventListener("change", (e) => {
    const id = parseInt(e.target.value, 10);
    if (!id) return;
    activeBodyId = id;
    generatedPasses = [];
    refreshScene(false);
    setStatus(`Active body: ${activeBodyEntry()?.name ?? ""}`);
  });
  $("surfRow").addEventListener("input", syncSurfacePointEditor);
  $("surfCol").addEventListener("input", syncSurfacePointEditor);

  $("curveType").addEventListener("change", (e) => {
    $("curveDegree").disabled = e.target.value === "Bezier";
    $("curveKnotMode").disabled = e.target.value === "Bezier";
  });
  $("curveType").dispatchEvent(new Event("change"));
}

// ── Init ───────────────────────────────────────────────────────────────────
initThree();
createDefaultArchCurve();
bindUi();
syncSurfaceSourceUi();
refreshCurveLists();
refreshSurfaceSelector();
refreshBodySelector();
refreshScene(true);
setStatus("Step 1: Review the arch curve → Step 2: Generate Surface (Extrude Active Curve)");
