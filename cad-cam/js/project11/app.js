import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  reconstructMesh, imageDataFromFile, exportStl,
} from "./reconstruct.js";
import { downloadBinary } from "../shared/utils.js";

const VOXEL_N = 100;
const images = { top: null, front: null, side: null };
let activeSample = "sample1";
let meshObject = null;
let modelCenter = new THREE.Vector3(50, 50, 50);
let scene, camera, renderer, controls;
let axesGroup = null;

function initThree() {
  const container = document.getElementById("viewport3d");
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef2f7);

  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.set(120, -120, 120);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(modelCenter);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const d = new THREE.DirectionalLight(0xffffff, 0.9);
  d.position.set(1, 2, 1);
  scene.add(d);

  addWorkspaceAxes();

  (function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  })();

  window.addEventListener("resize", () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });
}

function addWorkspaceAxes() {
  if (axesGroup) scene.remove(axesGroup);
  axesGroup = new THREE.Group();

  // Bounding box 0..N cube outline (matplotlib set_xlim style)
  const boxGeo = new THREE.BoxGeometry(VOXEL_N, VOXEL_N, VOXEL_N);
  const boxEdges = new THREE.EdgesGeometry(boxGeo);
  const boxLines = new THREE.LineSegments(
    boxEdges,
    new THREE.LineBasicMaterial({ color: 0x90a4ae, transparent: true, opacity: 0.45 }),
  );
  boxLines.position.set(VOXEL_N / 2, VOXEL_N / 2, VOXEL_N / 2);
  axesGroup.add(boxLines);

  // RGB axes at origin — X red, Y green, Z blue
  const axes = new THREE.AxesHelper(VOXEL_N * 0.55);
  axesGroup.add(axes);

  scene.add(axesGroup);
}

function setView(name) {
  const c = modelCenter;
  const dist = 180;
  const map = {
    Top: () => { camera.position.set(c.x, c.y, c.z + dist); },
    Front: () => { camera.position.set(c.x, c.y - dist, c.z); },
    Side: () => { camera.position.set(c.x + dist, c.y, c.z); },
    Isometric: () => { camera.position.set(c.x + dist, c.y - dist, c.z + dist * 0.75); },
  };
  (map[name] || map.Isometric)();
  controls.target.copy(c);
  controls.update();
}

function showPreview(view, imageData) {
  const canvas = document.getElementById(`preview-${view}`);
  canvas.width = 200;
  canvas.height = 200;
  const tmp = document.createElement("canvas");
  tmp.width = imageData.width;
  tmp.height = imageData.height;
  tmp.getContext("2d").putImageData(imageData, 0, 0);
  canvas.getContext("2d").drawImage(tmp, 0, 0, 200, 200);
}

function cannyPreview(imageData) {
  const { width, height, data } = imageData;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i += 1) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = x + y * width;
      const gx = gray[i + 1] - gray[i - 1];
      const gy = gray[i + width] - gray[i - width];
      const v = Math.min(255, Math.abs(gx) + Math.abs(gy));
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
      out[i * 4 + 3] = 255;
    }
  }
  return new ImageData(out, width, height);
}

function updateModelCenter(result) {
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  for (const v of result.verts) {
    minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]);
    minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]);
    minZ = Math.min(minZ, v[2]); maxZ = Math.max(maxZ, v[2]);
  }
  modelCenter.set(
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  );
}

const SAMPLE_LABELS = {
  sample1: "Sample 1 — Box",
  sample2: "Sample 2 — L-Step",
  sample3: "Sample 3 — T-Shape",
};

function displayMesh(result) {
  if (meshObject) scene.remove(meshObject);
  updateModelCenter(result);

  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(result.verts.length * 3);
  result.verts.forEach((v, i) => {
    positions[i * 3] = v[0];
    positions[i * 3 + 1] = v[1];
    positions[i * 3 + 2] = v[2];
  });
  const indices = [];
  result.faces.forEach((f) => indices.push(f[0], f[1], f[2]));
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const wire = document.getElementById("wireframe").checked;
  meshObject = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
    color: 0x1565c0,
    wireframe: wire,
    side: THREE.DoubleSide,
    shininess: 40,
  }));
  scene.add(meshObject);

  const s = result.stats;
  document.getElementById("stats").textContent =
    `DATASET: ${SAMPLE_LABELS[activeSample] ?? activeSample}\n\n` +
    `AI/ML SEGMENTATION : ACTIVE\n\nOBJECT TYPE:\n${s.objectType}\n\n` +
    `OPTIMIZATION MODE:\n${s.optimizationMode}\n\nCONFIDENCE:\n${s.confidence.toFixed(2)}%\n\n` +
    `DIMENSIONS:\nX: ${s.dimensions.x.toFixed(1)}\nY: ${s.dimensions.y.toFixed(1)}\nZ: ${s.dimensions.z.toFixed(1)}\n\n` +
    `VOLUME:\n${s.voxelVolume.toLocaleString()} units³`;

  document.getElementById("btnExportStl").onclick = () => {
    downloadBinary(`${activeSample}.stl`, exportStl(result.verts, result.faces));
  };
  window._lastResult = result;
}

async function loadSampleSet(sampleId) {
  activeSample = sampleId;
  for (const view of ["top", "front", "side"]) {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error(`Missing ${sampleId}/${view}.png`));
      img.src = `assets/samples/${sampleId}/${view}.png`;
    });
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 400;
    c.getContext("2d").drawImage(img, 0, 0, 400, 400);
    images[view] = c.getContext("2d").getImageData(0, 0, 400, 400);
    showPreview(view, images[view]);
  }
  document.getElementById("stats").textContent = `Loaded ${SAMPLE_LABELS[sampleId]}. Click Generate AI 3D Model.`;
}

async function generateModel() {
  if (!images.top || !images.front || !images.side) {
    alert("Load all views first (pick a sample or upload images)!");
    return;
  }
  document.getElementById("stats").textContent = "Running AI reconstruction...";
  try {
    const result = await reconstructMesh(images.top, images.front, images.side, {
      smoothing: document.getElementById("smoothing").checked,
      aiOptimization: document.getElementById("aiOpt").checked,
      resolution: parseInt(document.getElementById("resolution").value, 10),
    });
    displayMesh(result);
    setView(document.getElementById("viewSelect").value);
  } catch (err) {
    document.getElementById("stats").textContent = "Geometry generation failed!";
    alert(err.message);
  }
}

initThree();

["top", "front", "side"].forEach((view) => {
  document.getElementById(`file-${view}`).addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    activeSample = "custom";
    images[view] = await imageDataFromFile(file);
    showPreview(view, images[view]);
  });
});

document.getElementById("btnSample1").addEventListener("click", () => loadSampleSet("sample1").then(generateModel));
document.getElementById("btnSample2").addEventListener("click", () => loadSampleSet("sample2").then(generateModel));
document.getElementById("btnSample3").addEventListener("click", () => loadSampleSet("sample3").then(generateModel));
document.getElementById("btnGenerate").addEventListener("click", generateModel);
document.getElementById("btnShowEdges").addEventListener("click", () => {
  ["top", "front", "side"].forEach((v) => {
    if (images[v]) showPreview(v, cannyPreview(images[v]));
  });
});
document.getElementById("wireframe").addEventListener("change", () => {
  if (window._lastResult) displayMesh(window._lastResult);
});
document.getElementById("viewSelect").addEventListener("change", (e) => setView(e.target.value));

loadSampleSet("sample1").then(generateModel);
