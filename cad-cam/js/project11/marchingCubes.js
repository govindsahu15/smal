/** Marching cubes — local port matching skimage.measure.marching_cubes (Paul Bourke / Mikola Lysenko). */

import { marchingCubesCore } from "./marchingCubesCore.js";

export function marchingCubes(field, N, level = 0.5, step = 1) {
  const M = Math.max(2, Math.floor(N / step));
  const dims = [M, M, M];
  const span = N - 1;
  const bounds = [[0, 0, 0], [span, span, span]];

  const potential = (x, y, z) => {
    const ix = Math.min(N - 1, Math.max(0, Math.round(x)));
    const iy = Math.min(N - 1, Math.max(0, Math.round(y)));
    const iz = Math.min(N - 1, Math.max(0, Math.round(z)));
    return field[ix + iy * N + iz * N * N] - level;
  };

  const mesh = marchingCubesCore(dims, potential, bounds);
  const verts = mesh.positions.map((p) => [p[0], p[1], p[2]]);
  const faces = mesh.cells.map((c) => [c[0], c[1], c[2]]);
  return { verts, faces };
}
