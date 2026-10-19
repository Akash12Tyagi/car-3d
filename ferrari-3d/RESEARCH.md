# Rosso — 3D car experience: research and direction

A pitch-ready prototype of a premium, scroll-driven 3D car website. It covers what makes this kind of
site impressive, which parts the prototype in this folder already does, and what to build next to get it
to award level.

---

## 1. Brand choice: Ferrari over BMW

| | Ferrari | BMW (507 reference) |
|---|---|---|
| Visual identity | One iconic colour (Rosso), so the page can be built around colour | Silver/greige classic; elegant but quieter |
| Reference poster | Bold red type, top-down car, script signature: strong, ownable art direction | Studio photography sequence: great mood, harder to make interactive |
| Free 3D asset | High-quality Draco-compressed **458 Italia** with named parts (body, rims, glass, wheels) and baked AO | No comparable free, part-separated 507 model |
| Story arc | Engine (9,000 rpm), speed, colour personalisation | Heritage, craft, interior |

**Decision: Ferrari 458 Italia.** The second reference (BMW 507) still shapes the dark "studio" chapters:
black seamless backdrop, single soft key light and long reflection lines on the body.

---

## 2. What the references teach

**Poster (Ferrari SF-25)**
- **Type behind the car, script in front.** Three depth layers (giant type, then object, then signature) make a 2D page feel 3D before any WebGL runs. The prototype uses the same sandwich: DOM type, WebGL canvas, DOM script.
- **Top-down hero.** A top-down view is rare on car sites and makes a strong first frame. The camera then swoops down to ground level, which turns the poster into a film.
- **Editorial microtype.** Tiny justified copy, vertical labels and numbers make it read like a magazine, not a template.

**BMW 507 photo series**
- **Black seamless studio and one sculpted light.** The body reads through its reflections, not its colour.
- **Telephoto side profile.** A long lens flattens perspective, which looks expensive. The prototype's Design chapter uses a 17° FOV for this.
- **Detail crops** (grille, interior, engine). The next version should add close-up "macro" shots (see §5).

**Video** — only the HLS master playlist (`.m3u8`) came through. Its video segments didn't, so it couldn't be reviewed. To include it, send the MP4 or a public link.

---

## 3. Patterns in award-winning 3D product sites

These recur across Awwwards / FWA-level automotive and product launches:

1. **Scroll as a timeline.** The camera is choreographed per chapter and scroll only scrubs it. The user never "fights" orbit controls until they're invited to.
2. **The camera has mass.** Positions are damped (critically-damped lerp), never snapped, so motion feels physical.
3. **Studio lighting, not scene lighting.** Lightformer softboxes or HDRIs baked into an environment map give the paint its long reflection strips. This matters more than polygon count.
4. **Restrained, editorial typography.** One condensed display face, one serif italic for emotion and one mono for data. Text arrives with masked line reveals.
5. **One "wow" interaction per chapter.** Examples: a colour change that sweeps across the body, numbers that count up, a speed sequence with streaks and camera shake.
6. **Theme shifts as punctuation.** Switching between light and dark at chapter boundaries resets attention.
7. **Sound, off by default.** An opt-in engine note makes a pitch room react.
8. **Polish details.** Preloader with a real progress count, custom cursor, magnetic buttons, film grain and a chapter rail.
9. **Performance as a feature.** Draco/KTX2 assets, shader pre-compilation, capped DPR on mobile and no layout thrash in the scroll loop.

---

## 4. What the prototype already does

| Chapter | Camera / 3D | Interaction and motion |
|---|---|---|
| 01 Prologue (paper) | Top-down, car horizontal across giant **ROSSO** type | Counter preloader with a clip-path wipe, staggered character rise on the giant type, script "Italia" signature that writes on |
| 02 Overture (ink) | Swoops from top-down to a low front ¾ view; the theme flips to the black studio | Masked line reveals; italic serif accent in Rosso |
| 03 Design | Telephoto side profile (17° FOV) | **3D-anchored hotspots** projected from model space to screen every frame |
| 04 Performance | Rear ¾, high | Count-up specs, live SVG **tachometer** scrubbed to 9,000 rpm with a redline |
| 05 Launch | Low front ¾ with a slight Dutch angle | Real acceleration model (0–100 in 3.4 s), gear shifts, wheel spin, **speed streaks**, camera shake, counter-scrolling marquee |
| 06 Atelier | Front ¾ that can be **dragged to orbit** | **Paint-sweep shader**: a world-space wipe with a glowing edge between colours; per-paint metallic or solid finish; three rim finishes |
| 07 Finale (paper) | Back to top-down as a bookend with the giant type | Character reveal, magnetic CTA, credits and disclaimer |

The whole time: Lenis smooth scroll, damped camera with mouse parallax, wheels that roll with scroll speed,
a procedural Web Audio V8 tied to rpm (flat-plane firing order: 4 pulses per revolution), animated film grain,
a difference-blend custom cursor, a chapter rail and responsive keyframes (portrait has its own camera shots).

---

## 5. What to improve next (prioritised)

### P0 — before a client pitch
1. **Licensed hero asset.** Get the official CAD/visualisation model through the brand or agency, or commission one. Pipeline: CAD → Blender (retopo, UVs, material IDs) → glTF → `gltf-transform` (Draco or Meshopt plus **KTX2/Basis** textures). Target under 8 MB.
2. **Real engine audio.** Replace the synth with recorded on-board loops at 1k/3k/6k/9k rpm, cross-faded by rpm (granular, the same way racing games do it).
3. **Ground reflection.** A blurred, distance-faded floor reflection in the dark chapters (`MeshReflectorMaterial`-style mirror with blur) makes it look like a real studio.
4. **Post-processing.** Use the `postprocessing` library: subtle bloom on the lights, SMAA, a touch of vignette and chromatic aberration only during Launch.

### P1 — "wow" upgrades
5. **Macro chapter.** Depth-of-field close-ups of the headlamp, wheel and badge, matching the BMW detail crops. Animate focus distance with scroll.
6. **Headlight and tail-light ignition.** Light up the emissive LED meshes in sequence when the engine starts (pairs with the sound toggle).
7. **Exploded view.** Animate parts apart along their normals to tell the engineering story (needs a part-separated model).
8. **Environment switch in the Atelier.** Studio, Maranello street at dusk, track. Swap the HDRI and floor with a dissolve.
9. **Scroll-velocity distortion.** A post-pass RGB split and stretch driven by Lenis velocity.
10. **Page transitions** to a configurator summary or a booking page (Barba.js or view-transitions API).

### P2 — production hardening
11. **WebGPU renderer** (three.js r170+ `WebGPURenderer` with TSL) and progressive enhancement to WebGL2.
12. **Adaptive quality.** Measure FPS for the first 2 seconds, then drop DPR or post-processing (`PerformanceMonitor` pattern).
13. **Accessibility.** Honour `prefers-reduced-motion` (already partly done), keep the specs as real text (done), keyboard-operable configurator, captions for sound.
14. **CMS-driven chapters** (copy and keyframes in JSON) so the same engine can pitch other models.
15. **Analytics.** Record which chapter people drop off at and which colours they pick, as data for the pitch.

---

## 6. Tech stack

| Concern | Choice | Why |
|---|---|---|
| 3D | three.js r170 | Industry standard, huge ecosystem, WebGPU path |
| Animation | GSAP 3.13 + ScrollTrigger + SplitText | SplitText is now free; masked line reveals in a few lines |
| Scroll | Lenis | Smooth, inertial scroll that syncs with GSAP's ticker |
| Build | Vite | Instant HMR; `base: './'` so `dist/` runs from anywhere, offline included |
| Fonts | Self-hosted via Fontsource | No network dependency during a live pitch |
| Type | Anton (display), Instrument Serif italic (emotion), Inter Tight (body), JetBrains Mono (data), Mrs Saint Delafield (signature) | Matches the poster's condensed-plus-script pairing |

If the team prefers React: port it to **React Three Fiber + drei** (`<Lightformer>`, `<MeshReflectorMaterial>`,
`<PerformanceMonitor>`, `<ScrollControls>`). The architecture maps one to one: chapter keyframes → `useFrame` damping.

---

## 7. Demo script for the pitch (about 90 seconds)

1. Open on the loader as the counter climbs. Say: *"Everything you'll see is real-time 3D in the browser — no video."*
2. Hero: pause on the poster frame and move the mouse to show parallax.
3. Scroll slowly into Overture. The swoop from top-down to the studio is the first wow.
4. Design: point at the hotspots and how they stay pinned to the car.
5. **Turn sound on** before Performance and Launch, then scroll steadily: rpm, gear shifts and streaks.
6. Atelier: drag around the car, switch Rosso → Giallo → Nero, then change the wheels.
7. Finale: the top-down bookend and the CTA.

Before presenting: run `npm run build && npm run preview` (or open `dist/` on a static server), use Chrome on a
machine with a dedicated GPU, set the display to 100% scale, and keep the laptop on mains power.

---

## 8. Legal note

This is an **unofficial concept**. Ferrari, 458 Italia and the prancing horse are trademarks of Ferrari S.p.A.
The model ("Ferrari 458 Italia" by vicent091036 on Sketchfab, distributed with the three.js examples) is
credited on the page. Check its licence terms before any public or commercial use. For a real client
engagement, get brand approval and licensed assets. The prototype deliberately uses no brand logos in its UI.
