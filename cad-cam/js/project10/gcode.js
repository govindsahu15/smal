/** G-code export — ported from gcode/exporter.py */

const DEFAULT_FEED_RATE = 300;
const DEFAULT_PLUNGE_RATE = 180;
const DEFAULT_SAFE_Z = 10;
const DEFAULT_SPINDLE_RPM = 8000;

export function generateGcodeProgram(passes, settings = {}) {
  const safeZ = settings.safeZ ?? DEFAULT_SAFE_Z;
  const feed = settings.feedRate ?? DEFAULT_FEED_RATE;
  const plunge = settings.plungeRate ?? DEFAULT_PLUNGE_RATE;
  const spindle = settings.spindleRpm ?? DEFAULT_SPINDLE_RPM;

  const lines = [
    "(NURBS Surface Toolpath)",
    "G21", "G90",
    `S${spindle}`, "M3", "M8",
    `G0 Z${safeZ.toFixed(3)}`,
  ];

  if (!passes.length) {
    lines.push("M9", "M5", "M30");
    return `${lines.join("\n")}\n`;
  }

  passes.forEach((toolPass, passIndex) => {
    if (!toolPass.points.length) return;
    const start = toolPass.points[0].clPoint;
    lines.push(`(Pass ${passIndex + 1}, v=${toolPass.vParameter.toFixed(6)}, ${toolPass.direction})`);
    lines.push(`G0 X${start.x.toFixed(3)} Y${start.y.toFixed(3)}`);
    lines.push(`G1 Z${start.z.toFixed(3)} F${plunge.toFixed(1)}`);
    for (const point of toolPass.points) {
      const p = point.clPoint;
      lines.push(`G1 X${p.x.toFixed(3)} Y${p.y.toFixed(3)} Z${p.z.toFixed(3)} F${feed.toFixed(1)}`);
    }
    lines.push(`G0 Z${safeZ.toFixed(3)}`);
  });

  lines.push("M9", "M5", "M30");
  return `${lines.join("\n")}\n`;
}
