/** Sketch2Solid reconstruction — ported from v5 (1).py generate_3d_model */

import { marchingCubes } from "./marchingCubes.js";

function kmeansSegmentation(pixels) {
  let c0 = 64;
  let c1 = 192;
  const labels = new Uint8Array(pixels.length);

  for (let iter = 0; iter < 10; iter += 1) {
    let s0 = 0;
    let s1 = 0;
    let n0 = 0;
    let n1 = 0;
    for (let i = 0; i < pixels.length; i += 1) {
      labels[i] = Math.abs(pixels[i] - c0) <= Math.abs(pixels[i] - c1) ? 0 : 1;
      if (labels[i] === 0) { s0 += pixels[i]; n0 += 1; }
      else { s1 += pixels[i]; n1 += 1; }
    }
    if (n0) c0 = s0 / n0;
    if (n1) c1 = s1 / n1;
  }

  const out = new Uint8ClampedArray(pixels.length);
  for (let i = 0; i < labels.length; i += 1) {
    out[i] = labels[i] === 0 ? c0 : c1;
  }
  return out;
}

function otsuThreshold(values) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < values.length; i += 1) hist[values[i]] += 1;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 0;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) ** 2;
    if (varBetween > maxVar) { maxVar = varBetween; threshold = t; }
  }
  return threshold;
}

function morphClose(mask, N) {
  // Dilate then erode (3x3), matching cv2.MORPH_CLOSE.
  const dilated = mask.slice();
  for (let y = 1; y < N - 1; y += 1) {
    for (let x = 1; x < N - 1; x += 1) {
      let any = false;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (mask[(x + dx) + (y + dy) * N]) any = true;
        }
      }
      dilated[x + y * N] = any;
    }
  }
  const closed = dilated.slice();
  for (let y = 1; y < N - 1; y += 1) {
    for (let x = 1; x < N - 1; x += 1) {
      let all = true;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dilated[(x + dx) + (y + dy) * N]) all = false;
        }
      }
      closed[x + y * N] = all;
    }
  }
  return closed;
}

function rgbaToGray(data, width, height) {
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i += 1) {
    gray[i] = Math.round(
      0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2],
    );
  }
  return gray;
}

function resizeGrayToMask(imageData, N) {
  const canvas = document.createElement("canvas");
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext("2d");
  const tmp = document.createElement("canvas");
  tmp.width = imageData.width;
  tmp.height = imageData.height;
  tmp.getContext("2d").putImageData(imageData, 0, 0);
  ctx.drawImage(tmp, 0, 0, N, N);
  const small = ctx.getImageData(0, 0, N, N);
  const gray = kmeansSegmentation(rgbaToGray(small.data, N, N));
  const thresh = otsuThreshold(gray);
  const mask = new Array(N * N);
  // cv2.THRESH_BINARY_INV + THRESH_OTSU: foreground where value <= threshold
  for (let i = 0; i < mask.length; i += 1) mask[i] = gray[i] <= thresh;
  return morphClose(mask, N);
}

function cannySum(mask, N) {
  let sum = 0;
  for (let y = 1; y < N - 1; y += 1) {
    for (let x = 1; x < N - 1; x += 1) {
      const i = x + y * N;
      if (!mask[i]) continue;
      const gx = (mask[i + 1] ? 1 : 0) - (mask[i - 1] ? 1 : 0);
      const gy = (mask[i + N] ? 1 : 0) - (mask[i - N] ? 1 : 0);
      if (Math.abs(gx) + Math.abs(gy) > 0) sum += 1;
    }
  }
  return sum;
}

function gaussian3D(field, N, sigma) {
  const kernelSize = Math.ceil(sigma * 3) * 2 + 1;
  const kernel = [];
  let kSum = 0;
  const mid = Math.floor(kernelSize / 2);
  for (let i = 0; i < kernelSize; i += 1) {
    const x = i - mid;
    const v = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel.push(v);
    kSum += v;
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] /= kSum;

  const tmp = new Float32Array(field.length);
  const out = new Float32Array(field.length);

  // X pass
  for (let z = 0; z < N; z += 1) {
    for (let y = 0; y < N; y += 1) {
      for (let x = 0; x < N; x += 1) {
        let v = 0;
        for (let k = 0; k < kernelSize; k += 1) {
          const sx = Math.min(N - 1, Math.max(0, x + k - mid));
          v += field[sx + y * N + z * N * N] * kernel[k];
        }
        tmp[x + y * N + z * N * N] = v;
      }
    }
  }
  // Y pass
  for (let z = 0; z < N; z += 1) {
    for (let y = 0; y < N; y += 1) {
      for (let x = 0; x < N; x += 1) {
        let v = 0;
        for (let k = 0; k < kernelSize; k += 1) {
          const sy = Math.min(N - 1, Math.max(0, y + k - mid));
          v += tmp[x + sy * N + z * N * N] * kernel[k];
        }
        out[x + y * N + z * N * N] = v;
      }
    }
  }
  // Z pass
  const final = new Float32Array(field.length);
  for (let z = 0; z < N; z += 1) {
    for (let y = 0; y < N; y += 1) {
      for (let x = 0; x < N; x += 1) {
        let v = 0;
        for (let k = 0; k < kernelSize; k += 1) {
          const sz = Math.min(N - 1, Math.max(0, z + k - mid));
          v += out[x + y * N + sz * N * N] * kernel[k];
        }
        final[x + y * N + z * N * N] = v;
      }
    }
  }
  return final;
}

export async function reconstructMesh(topImg, frontImg, sideImg, options = {}) {
  const N = options.resolution ?? 100;
  const smoothing = options.smoothing ?? true;
  const aiOptimization = options.aiOptimization ?? true;

  const maskTop = resizeGrayToMask(topImg, N);
  const maskFront = resizeGrayToMask(frontImg, N);
  const maskSide = resizeGrayToMask(sideImg, N);

  const voxels = new Float32Array(N * N * N);
  let voxelVolume = 0;
  for (let x = 0; x < N; x += 1) {
    for (let y = 0; y < N; y += 1) {
      for (let z = 0; z < N; z += 1) {
        if (!maskTop[y * N + x]) continue;
        if (!maskFront[(N - 1 - z) * N + x]) continue;
        if (!maskSide[(N - 1 - z) * N + y]) continue;
        voxels[x + y * N + z * N * N] = 1;
        voxelVolume += 1;
      }
    }
  }

  if (voxelVolume === 0) {
    throw new Error("No overlapping shape in the three views — check that top/front/side sketches match the same object");
  }

  let sigma;
  let stepSize;
  let objectType;
  let optimizationMode;
  if (aiOptimization) {
    const edgeComplexity = cannySum(maskTop, N);
    if (edgeComplexity > 50000) {
      sigma = 2.5;
      stepSize = 1;
      objectType = "FREEFORM";
    } else {
      sigma = 0.8;
      stepSize = 2;
      objectType = "MECHANICAL";
    }
    optimizationMode = "AI OPTIMIZED";
  } else {
    sigma = 1.2;
    stepSize = 2;
    objectType = "STANDARD";
    optimizationMode = "MANUAL";
  }

  let smoothField;
  let title;
  if (smoothing) {
    smoothField = gaussian3D(voxels, N, sigma);
    title = `AI Optimized Model (${objectType})`;
  } else {
    smoothField = gaussian3D(voxels, N, 0.5);
    title = "Rigid Mechanical CAD Model";
  }

  const { verts, faces } = marchingCubes(smoothField, N, 0.5, stepSize);
  if (!verts.length) {
    throw new Error(voxelVolume === 0
      ? "No overlapping shape in the three views — check that top/front/side sketches match the same object"
      : "Geometry generation failed");
  }

  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  for (const v of verts) {
    minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]);
    minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]);
    minZ = Math.min(minZ, v[2]); maxZ = Math.max(maxZ, v[2]);
  }

  const reconstructed = new Array(N * N * N).fill(0);
  for (let i = 0; i < smoothField.length; i += 1) {
    if (smoothField[i] > 0.5) reconstructed[i] = 1;
  }
  const projTop = new Array(N * N).fill(0);
  const projFront = new Array(N * N).fill(0);
  const projSide = new Array(N * N).fill(0);
  for (let x = 0; x < N; x += 1) {
    for (let y = 0; y < N; y += 1) {
      for (let z = 0; z < N; z += 1) {
        if (!reconstructed[x + y * N + z * N * N]) continue;
        projTop[y * N + x] = 1;
        projFront[(N - 1 - z) * N + x] = 1;
        projSide[(N - 1 - z) * N + y] = 1;
      }
    }
  }
  let totalError = 0;
  for (let i = 0; i < N * N; i += 1) {
    if (projTop[i] !== maskTop[i]) totalError += 1;
    if (projFront[i] !== maskFront[i]) totalError += 1;
    if (projSide[i] !== maskSide[i]) totalError += 1;
  }
  const maxPossible = 3 * N * N;
  let confidence = 100 * (1 - totalError / maxPossible);
  if (aiOptimization) confidence += objectType === "FREEFORM" ? 5 : 3;
  confidence = Math.max(0, Math.min(confidence, 100));

  return {
    verts,
    faces,
    title,
    resolution: N,
    stats: {
      objectType,
      optimizationMode,
      confidence,
      dimensions: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
      voxelVolume,
    },
  };
}

export function imageDataFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 400;
      canvas.height = 400;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, 400, 400);
      resolve(ctx.getImageData(0, 0, 400, 400));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export function exportStl(verts, faces) {
  const triCount = faces.length;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = DataView(buffer);
  let offset = 84;
  for (const face of faces) {
    const v0 = verts[face[0]];
    const v1 = verts[face[1]];
    const v2 = verts[face[2]];
    const ux = v1[0] - v0[0]; const uy = v1[1] - v0[1]; const uz = v1[2] - v0[2];
    const vx = v2[0] - v0[0]; const vy = v2[1] - v0[1]; const vz = v2[2] - v0[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    view.setFloat32(offset, nx, true); offset += 4;
    view.setFloat32(offset, ny, true); offset += 4;
    view.setFloat32(offset, nz, true); offset += 4;
    for (const vi of face) {
      view.setFloat32(offset, verts[vi][0], true); offset += 4;
      view.setFloat32(offset, verts[vi][1], true); offset += 4;
      view.setFloat32(offset, verts[vi][2], true); offset += 4;
    }
    view.setUint16(offset, 0, true); offset += 2;
  }
  return buffer;
}
