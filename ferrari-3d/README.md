# Rosso — 458 Italia, a 3D scroll experience

An unofficial, pitch-ready concept: a premium car website built around a real-time 3D Ferrari 458 Italia.
See [RESEARCH.md](./RESEARCH.md) for the design research, roadmap and pitch demo script.

| | |
|---|---|
| ![Prologue](docs/01-prologue.jpg) | ![Overture](docs/02-overture.jpg) |
| ![Design](docs/03-design.jpg) | ![Launch](docs/05-launch.jpg) |
| ![Atelier paint sweep](docs/06-atelier-paint-sweep.jpg) | ![Finale](docs/07-finale.jpg) |

## Run

```bash
cd ferrari-3d
npm install
npm run dev        # http://localhost:5173
npm run build      # outputs dist/ (relative paths, works offline from any static server)
npm run preview
```

Append `?snap` to the URL to turn off camera damping (useful for screenshots).

## Structure

```
index.html            chapters (DOM copy, hotspots, HUD, configurator)
src/main.js           boot, loader, Lenis + GSAP, camera keyframes per chapter, all chapter interactions
src/experience.js     three.js scene: studio env map, materials, paint-sweep shader, streaks, hotspot projection
src/engine-sound.js   procedural Web Audio V8 driven by rpm
src/style.css         design tokens, typography, layout, responsive rules
public/models         Draco-compressed Ferrari 458 glTF + baked AO shadow
public/draco          Draco decoder
```

## Tuning the camera

Each chapter has a keyframe in `keyframes()` in `src/main.js`:
`az` (azimuth°), `el` (elevation°), `dist`, `fov`, target `tx/ty/tz`, car yaw `rot`, horizontal framing `shift`
and `roll`. The camera blends to the next keyframe while the next chapter slides in, then holds while its
copy is read. Portrait screens get their own values.

## Credits

3D model "Ferrari 458 Italia" by vicent091036 (via the three.js examples). Unofficial concept; not affiliated
with or endorsed by Ferrari S.p.A.
