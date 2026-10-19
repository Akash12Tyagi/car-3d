import * as THREE from 'three';

/**
 * Highlights a component of the car without touching its materials.
 *
 * Each highlighted mesh gets a "shell": a second mesh sharing its geometry,
 * parented to it (so it follows wheels as they turn), drawn on top with a
 * fresnel rim light. A box `region` in car space can restrict the glow to part
 * of a mesh — needed where one mesh holds several features (every grille of
 * the car, or the tailpipe tips together with all other chrome).
 *
 * Light is added without touching canvas alpha (the page shows through the
 * canvas), and shells are hidden while their intensity is zero, so they cost
 * nothing when idle.
 */
const vertexShader = /* glsl */ `
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vNormalV = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uSweep;
  uniform mat4 uCarInverse;
  uniform vec3 uMin;
  uniform vec3 uMax;
  uniform float uUseRegion;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  varying vec3 vWorld;
  void main() {
    vec3 p = (uCarInverse * vec4(vWorld, 1.0)).xyz;
    float mask = 1.0;
    if (uUseRegion > 0.5) {
      vec3 inside = smoothstep(uMin - 0.02, uMin + 0.03, p) * (1.0 - smoothstep(uMax - 0.03, uMax + 0.02, p));
      mask = inside.x * inside.y * inside.z;
    }
    float facing = abs(dot(normalize(vNormalV), normalize(vViewDir)));
    float rim = pow(1.0 - facing, 2.2);
    // a band of light passes once across the part when it is selected
    float band = exp(-pow((p.y - mix(-0.2, 1.4, uSweep)) / 0.08, 2.0)) * step(uSweep, 0.999);
    float glow = (0.3 + 1.25 * rim + 1.4 * band) * uIntensity * mask;
    gl_FragColor = vec4(uColor * glow, 1.0);
  }`;

export class ComponentHighlight {
  /**
   * @param {THREE.Object3D} car  the car root (car space = its local frame)
   * @param {THREE.Mesh[]} meshes
   * @param {{ region?: { min: number[], max: number[] }, color?: string }} options
   */
  constructor(car, meshes, { region = null, color = '#eef3ff' } = {}) {
    this.car = car;
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthFunc: THREE.LessEqualDepth,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uIntensity: { value: 0 },
        uSweep: { value: 1 },
        uCarInverse: { value: new THREE.Matrix4() },
        uMin: { value: new THREE.Vector3(...(region?.min ?? [0, 0, 0])) },
        uMax: { value: new THREE.Vector3(...(region?.max ?? [0, 0, 0])) },
        uUseRegion: { value: region ? 1 : 0 },
      },
    });
    this.shells = meshes.map((mesh) => {
      const shell = new THREE.Mesh(mesh.geometry, this.material);
      shell.name = `highlight:${mesh.name}`;
      shell.renderOrder = 5;
      shell.visible = false;
      shell.raycast = () => {};
      mesh.add(shell);
      return shell;
    });
    this.intensity = 0;
    this.sweep = 1;
  }

  /** Apply intensity/sweep and keep the car-space mask in step with the car. */
  update() {
    const on = this.intensity > 0.001;
    for (const s of this.shells) s.visible = on;
    if (!on) return;
    const u = this.material.uniforms;
    u.uIntensity.value = this.intensity;
    u.uSweep.value = this.sweep;
    u.uCarInverse.value.copy(this.car.matrixWorld).invert();
  }

  dispose() {
    for (const s of this.shells) s.removeFromParent();
    this.material.dispose();
  }
}
