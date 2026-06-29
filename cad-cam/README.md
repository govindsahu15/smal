# CAD/CAM Portfolio — Pure Frontend (JavaScript)

All three projects run **entirely in the browser**. Python logic was ported to JavaScript — no backend, no Docker, no Streamlit.

## Run locally

```bash
cd frontend
python -m http.server 8000
```

Open **http://localhost:8000**

> ES modules require a local HTTP server (do not open HTML files directly as `file://`).

## Projects

| Page | Original `.py` | Features |
|------|------------------|----------|
| [project9.html](project9.html) | `CADCAM_project.py` | Drag control points, Bezier/B-spline/NURBS, CSV + G-code export |
| [project10.html](project10.html) | `main.py` + core modules | Default NURBS surface, toolpath, G-code, Three.js 3D |
| [project11.html](project11.html) | `v5 (1).py` | 3-view upload, voxel + marching cubes, STL export |

## Structure

```
frontend/
  index.html          # Project list
  project9.html       # Curve visualizer
  project10.html      # NURBS surface
  project11.html      # Sketch2Solid
  js/
    project9/         # Curve math + canvas UI
    project10/        # B-spline, NURBS surface, toolpath, gcode
    project11/        # Reconstruction + Three.js
  assets/samples/     # Demo orthographic images (Project 11)
```

## Notes

- **Project 10** implements the default-surface + toolpath + G-code workflow from the original app (full PyQt curve editor is not ported).
- **Project 11** uses a bundled marching-cubes implementation (same algorithm as Python `skimage.measure.marching_cubes`) — works offline, no CDN required.
- Original Python files in the repo are **unchanged** by this frontend.
