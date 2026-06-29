/** Defaults from config.py + gui/app.py */

export const EPSILON = 1e-10;
export const COLLINEAR_TOLERANCE_MM = 0.01;
export const DEFAULT_TOOL_RADIUS_MM = 2.0;
export const DEFAULT_STEPOVER_MM = 1.0;
export const DEFAULT_FEED_RATE_MM_PER_MIN = 300.0;
export const DEFAULT_PLUNGE_RATE_MM_PER_MIN = 180.0;
export const DEFAULT_SAFE_Z_MM = 10.0;
export const DEFAULT_SPINDLE_RPM = 8000;
export const DEFAULT_SURFACE_SAMPLES_U = 45;
export const DEFAULT_SURFACE_SAMPLES_V = 45;
export const DEFAULT_TOOLPATH_SAMPLES_U = 120;
export const DEFAULT_LINK_SAMPLES = 12;
export const DEFAULT_DEGREE_U = 3;
export const DEFAULT_DEGREE_V = 3;

export const AXIS_VECTORS = {
  "X+": { x: 1, y: 0, z: 0 },
  "X-": { x: -1, y: 0, z: 0 },
  "Y+": { x: 0, y: 1, z: 0 },
  "Y-": { x: 0, y: -1, z: 0 },
  "Z+": { x: 0, y: 0, z: 1 },
  "Z-": { x: 0, y: 0, z: -1 },
};
