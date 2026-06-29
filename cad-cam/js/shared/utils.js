/** Shared math helpers (ported from Python numpy/utils). */

export const EPSILON = 1e-10;

export function vec3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

export function add(a, b) {
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z);
}

export function sub(a, b) {
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function scale(v, s) {
  return vec3(v.x * s, v.y * s, v.z * s);
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a, b) {
  return vec3(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  );
}

export function length(v) {
  return Math.hypot(v.x, v.y, v.z);
}

export function normalize(v, fallback = vec3(0, 0, 1)) {
  const len = length(v);
  if (len < EPSILON) return { ...fallback };
  return scale(v, 1 / len);
}

export function linspaceInclusive(start, end, count) {
  if (count <= 1) return [start];
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(start + ((end - start) * i) / (count - 1));
  }
  return out;
}

export function pointLineDeviation(point, a, b) {
  const ab = sub(b, a);
  const ap = sub(point, a);
  const abLen = length(ab);
  if (abLen < EPSILON) return length(ap);
  const crossVal = cross(ap, ab);
  return length(crossVal) / abLen;
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadBinary(filename, buffer) {
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
