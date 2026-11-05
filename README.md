# Rosso — 458 Italia, a 3D scroll experience

An unofficial, pitch-ready concept: a premium car website built around a real-time 3D Ferrari 458 Italia.
See [RESEARCH.md](./RESEARCH.md) for the design research, roadmap and pitch demo script.

## Run

```bash
cd ferrari-3d
npm install
npm run dev        # http://localhost:5173
npm run build      # validates the 3D asset registries, then outputs dist/ (relative paths, works offline)
npm run check:assets   # full component report for both models
npm run preview
```

Append `?snap` to the URL to turn off camera damping (useful for screenshots).

## Structure

```
index.html            chapters (DOM copy, hotspots, HUD, configurator)
src/main.js           boot, loader, Lenis + GSAP, camera keyframes per chapter, all chapter interactions
src/experience.js     three.js scene: studio env map, materials, paint-sweep shader, streaks, hotspot projection
src/engine-sound.js   procedural Web Audio V8 driven by rpm
src/engine/           the Engine chapter: a procedural, component-separated V8 (see docs/ENGINE.md)
  v8.js               22 assemblies, exact slider-crank/cam kinematics, teardown posing, x-ray, highlight
  materials.js        procedural cast/crinkle/carbon/braid finishes, exhaust heat tint, x-ray shell
  timeline.js         states and channels (x-ray, rpm, heat, teardown, rotating assembly), camera keys
  stage.js            dark studio, lights, combustion and header glow, picking
src/cinematic/        the Anatomy chapter: exploded-view cinematic
  manifest.js         part manifest for the 458: body, wheel layers, steering, mounted V8
  exploder.js         poses the manifest for any explode value (pure function → exact reversal)
  anatomy.js          stage: lighting, fog, shadows, camera path, beats, power-unit FX
src/fx/
  exhaust.js          tailpipe exhaust: smoke, flame bodies, light, bangs and crackle (docs/EXHAUST.md)
  heat-haze.js        screen-space heat shimmer pass (bypassed when idle)
src/style.css         design tokens, typography, layout, responsive rules
src/vehicle/          asset foundation: component registries, VehicleModel, shared loader (see docs/ASSETS.md)
src/lookdev/          studio environment, baked contact shadow, per-slot materials (see docs/LOOKDEV.md)
src/scene/views.js    named camera views with distance fitted to the car's real bounds
scripts/check-assets.mjs  validates registries against the GLB files (runs before every build)
public/models         Draco-compressed glTF: ferrari.glb (the one car, used in every chapter)
public/posters        static image used when WebGL is unavailable
public/draco          Draco decoder
```

## Tuning the camera

Each chapter has a keyframe in `keyframes()` in `src/main.js`:
`az` (azimuth°), `el` (elevation°), `dist`, `fov`, target `tx/ty/tz`, car yaw `rot`, horizontal framing `shift`
and `roll`. The camera blends to the next keyframe while the next chapter slides in, then holds while its
copy is read. Portrait screens get their own values.

## Opening film

The site opens on a 9-second film in five beats on the 458 (see [docs/HERO-INTRO.md](docs/HERO-INTRO.md)):

1. **Dark.** Total black for a moment.
2. **Light.** The LED signature wakes in a flickering start-up sequence.
3. **Line.** A raking light draws the flank from nose to tail.
4. **Fire.** A low rear three-quarter, then ignition: flame from the three tailpipes, a blip, and the overrun crackle.
5. **Reveal.** A rising arc into the ROSSO poster.

Skipping always lands on the same settled frame and never fires the bangs.

## Exhaust

Flame bodies from the three real tailpipes, a light that hits the bodywork, heat haze, a camera kick and (with
sound on) an audible pop on every bang. Performance bounces off the limiter and crackles on the overrun, and
Launch bangs on every upshift. See [docs/EXHAUST.md](docs/EXHAUST.md).

## Anatomy: the exploded-view cinematic

Chapter 04 takes apart **the same 458** as the rest of the site, in the visitor's chosen paint and wheels, and
only where the model really is separate. The one-piece body lifts off the tub, and each wheel comes apart along
its axle in six layers (cap, nuts, spokes, tyre, rim, brake disc). The steering wheel rises, and the tub turns to
glass to show the mid-mounted V8, which then lifts out with its transaxle. The V8 is the procedural engine from
chapter 05, mounted at 1:1 on the 458's measured rear hubs. See [docs/EXPLODED-VIEW.md](docs/EXPLODED-VIEW.md).

**How it stays smooth and reversible:** the page does the pinning (a tall section with sticky content, so
there's no scroll hijack). Section progress is the only input, damped once, and every pose is a pure function
of it. Scrolling up replays the film backwards, and every part returns to its stored rest transform exactly.
While a cinematic is on screen the main scene sleeps, and a black curtain covers each hand-over.

**Loading:** Anatomy parses its own copy of the main car from the bytes already downloaded (one fetch). Without
WebGL, the chapter shows a poster of the exploded 458.

## Engine: the V8, running and taken apart

Chapter 05 is a procedural 90° flat-plane V8 (4,497 cc, 94 × 81 mm) built from 22 separate assemblies, with more
than 120 moving parts. Its mechanism is exact: slider-crank pistons and rods, four cams phased to the firing order
1-5-3-7-4-8-2-6, and 32 valves on pent-roof geometry. Scroll through five states:

1. **Reveal.** The assembled engine comes out of the dark.
2. **Ignition.** The castings turn to glass and the engine revs to 9,000 rpm in labelled slow motion, with
   combustion flashes, glowing headers and heat haze.
3. **Teardown.** Every part leaves in workshop order; point at any part to name it.
4. **Rotating assembly.** The crank, rods and pistons turn in a glass block.
5. **Assembled.** Everything goes back in reverse order.

The same engine is mounted in the 458 in Anatomy, so the car opens on a real engine.
See [docs/ENGINE.md](docs/ENGINE.md).

## Credits

3D model "Ferrari 458 Italia" by vicent091036 (via the three.js examples). The V8 and transaxle are procedural
(built in code for this site). Unofficial concept; not affiliated with or endorsed by Ferrari S.p.A.

