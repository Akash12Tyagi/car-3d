import * as THREE from 'three';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/* ==================================================================== */
/* Studio environment                                                     */
/* A virtual photo studio rendered once into a PMREM cube map. The car is  */
/* lit and reflected only by this (no real-time lights), so it costs       */
/* nothing per frame. Every element has one job:                           */
/*   key     long overhead softbox — the top reflection that draws the     */
/*           roof, bonnet and shoulder lines                               */
/*   rims    four tall strips at the corners — edge highlights that lift   */
/*           the silhouette off the black background from any camera angle */
/*   horizon a thin bright band at sill height — the "horizon line" that   */
/*           runs along the flanks and makes body curvature readable       */
/*   fill    two broad, dim cards front and back — detail in the dark      */
/*           parts (tyres, grilles, cabin) without flattening the paint    */
/*   floor   a dark gradient below, so lower surfaces reflect a floor      */
/* Colour stays neutral: a faint warm key against faintly cool strips,     */
/* not coloured lighting.                                                  */
/* ==================================================================== */
export function createStudioEnvironment(renderer, { size = 512 } = {}) {
  const env = new THREE.Scene();

  // Cyclorama: dark floor rising to a narrow horizon band, black above
  const cyc = new THREE.Mesh(
    new THREE.SphereGeometry(40, 64, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          float y = vDir.y;
          float floorGlow = 0.035 * smoothstep(-1.0, -0.05, y) * (1.0 - smoothstep(-0.05, 0.0, y));
          float horizon = 1.1 * exp(-pow((y - 0.03) / 0.014, 2.0));
          float sky = 0.004;
          gl_FragColor = vec4(vec3(floorGlow + horizon + sky), 1.0);
        }`,
    })
  );
  env.add(cyc);

  const plane = new THREE.PlaneGeometry(1, 1);
  const emitter = (intensity, rgb = [1, 1, 1]) =>
    new THREE.MeshBasicMaterial({ color: new THREE.Color(...rgb).multiplyScalar(intensity), side: THREE.DoubleSide });
  const place = (mat, [x, y, z], [sx, sy], lookAt = [0, 0.6, 0]) => {
    const m = new THREE.Mesh(plane, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, 1);
    m.lookAt(...lookAt);
    env.add(m);
    return m;
  };

  // Key: twin long overhead strips — two crisp parallel highlights along bonnet, roof and deck —
  // over a broad, dim panel that grades the top surfaces between them
  for (const x of [-1.3, 1.3]) place(emitter(5.5, [1, 0.975, 0.95]), [x, 6.5, 0.3], [1.5, 9.5], [x, 0, 0.3]);
  place(emitter(0.55, [1, 0.98, 0.96]), [0, 7.2, 0.3], [7, 11], [0, 0, 0.3]);
  // Horizon strips: long, low and level at both sides — one clean line along each flank
  for (const x of [-7.5, 7.5]) place(emitter(2.2), [x, 0.95, 0], [16, 0.32], [0, 0.95, 0]);
  // Rims: tall strips at the four corners
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) place(emitter(9, [0.94, 0.965, 1]), [x * 6.2, 2.2, z * 6.2], [0.6, 4.4]);
  // Fill: broad, dim, low cards front and back
  place(emitter(0.3), [0, 1.4, -9], [12, 3.2]);
  place(emitter(0.18), [0, 1.4, 9], [12, 3.2]);

  // PMREMGenerator.fromScene is fixed at 256 px per face in r170, which softens
  // clearcoat reflections. Capture the studio at `size` px (HDR) and filter that.
  // GPU cost of the result: ~25 MB at 512 px, ~6 MB at 256 px.
  const cube = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
  new THREE.CubeCamera(0.1, 100, cube).update(renderer, env);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromCubemap(cube.texture).texture;
  pmrem.dispose();
  cube.dispose();
  env.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  return texture;
}

/* ==================================================================== */
/* Contact shadow, baked once from the real geometry                      */
/* Renders the car's depth from below the ground plane (orthographic,     */
/* looking up), turns nearness-to-ground into darkness, then blurs it at   */
/* two radii: a tight layer for the tyre contact patches and sill line,    */
/* and a broad layer for the soft occlusion under the body. The result     */
/* is parented to the car, so it costs nothing per frame and follows the   */
/* car's yaw.                                                              */
/* ==================================================================== */
export function bakeContactShadow(renderer, object, { width, depth, height = 1.1, resolution = 1024, tight = { blur: 1.2, passes: 1, opacity: 0.95 }, soft = { blur: 5, passes: 4, opacity: 0.75 } }) {
  const rtA = new THREE.WebGLRenderTarget(resolution, resolution);
  const rtB = new THREE.WebGLRenderTarget(resolution, resolution);
  const rtTight = new THREE.WebGLRenderTarget(resolution, resolution);
  const rtSoft = new THREE.WebGLRenderTarget(resolution / 2, resolution / 2);
  [rtA, rtB, rtTight, rtSoft].forEach((rt) => (rt.texture.generateMipmaps = false));

  const camera = new THREE.OrthographicCamera(-width / 2, width / 2, depth / 2, -depth / 2, 0, height);
  camera.rotation.x = Math.PI / 2; // look up from the floor

  const depthMaterial = new THREE.MeshDepthMaterial({ depthTest: false, depthWrite: false });
  depthMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
      // nearer the ground = darker; squared so the falloff concentrates at the contact
      'float near = 1.0 - fragCoordZ; gl_FragColor = vec4( vec3( 0.0 ), near * near * 1.6 );'
    );
  };

  const hBlur = new FullScreenQuad(new THREE.ShaderMaterial(HorizontalBlurShader));
  const vBlur = new FullScreenQuad(new THREE.ShaderMaterial(VerticalBlurShader));
  const blur = (source, target, amount, passes) => {
    let src = source;
    for (let i = 0; i < passes; i++) {
      hBlur.material.uniforms.tDiffuse.value = src.texture;
      hBlur.material.uniforms.h.value = amount / 256;
      renderer.setRenderTarget(rtB);
      hBlur.render(renderer);
      vBlur.material.uniforms.tDiffuse.value = rtB.texture;
      vBlur.material.uniforms.v.value = amount / 256;
      renderer.setRenderTarget(target);
      vBlur.render(renderer);
      src = target;
    }
  };

  // Render the object on its own, then put it back where it was
  const parent = object.parent;
  const index = parent ? parent.children.indexOf(object) : -1;
  const stage = new THREE.Scene();
  stage.overrideMaterial = depthMaterial;
  stage.add(object);
  object.updateMatrixWorld(true);

  const prev = { target: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), autoClear: renderer.autoClear };
  renderer.autoClear = true;
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(rtA);
  renderer.render(stage, camera);
  blur(rtA, rtTight, tight.blur, tight.passes);
  blur(rtTight, rtSoft, soft.blur, soft.passes);
  renderer.setRenderTarget(prev.target);
  renderer.setClearColor(prev.color, prev.alpha);
  renderer.autoClear = prev.autoClear;

  if (parent) {
    parent.add(object);
    parent.children.splice(parent.children.indexOf(object), 1);
    parent.children.splice(index, 0, object);
  }

  [rtA, rtB].forEach((rt) => rt.dispose());
  hBlur.dispose();
  vBlur.dispose();
  hBlur.material.dispose();
  vBlur.material.dispose();
  depthMaterial.dispose();

  const group = new THREE.Group();
  group.name = 'contact-shadow';
  const geo = new THREE.PlaneGeometry(width, depth);
  for (const [rt, opts, y, order] of [[rtSoft, soft, 0.0008, 1], [rtTight, tight, 0.0016, 2]]) {
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ map: rt.texture, transparent: true, depthWrite: false, opacity: opts.opacity, side: THREE.DoubleSide, toneMapped: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.y = -1; // the bake camera looks up, so its image is mirrored in Z
    mesh.position.y = y;
    mesh.renderOrder = order;
    group.add(mesh);
  }
  group.userData.dispose = () => {
    geo.dispose();
    [rtTight, rtSoft].forEach((rt) => rt.dispose());
    group.children.forEach((m) => m.material.dispose());
  };
  return group;
}

/* ==================================================================== */
/* Floor light pool                                                       */
/* The studio floor exists only where the key light lands on it: a soft,  */
/* neutral, elliptical pool under the car. Additive, so it reads on the   */
/* carbon-black chapters and disappears on the paper ones.                */
/* ==================================================================== */
export function createFloorPool({ width = 9, depth = 13, intensity = 0.1 } = {}) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      // add light without touching canvas alpha, so the page background stays visible around it
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      uniforms: { uIntensity: { value: intensity } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform float uIntensity;
        varying vec2 vUv;
        void main() {
          float d = length((vUv - 0.5) * 2.0);
          float pool = pow(1.0 - smoothstep(0.0, 1.0, d), 2.2);
          gl_FragColor = vec4(vec3(0.92, 0.94, 1.0) * pool * uIntensity, 1.0);
        }`,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.0002;
  mesh.renderOrder = 0;
  mesh.name = 'floor-pool';
  return mesh;
}
