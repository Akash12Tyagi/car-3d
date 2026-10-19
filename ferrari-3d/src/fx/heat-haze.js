import * as THREE from 'three';

const MAX_SOURCES = 4;

/**
 * Screen-space heat shimmer. The scene is rendered into an HDR target, then
 * composited to the canvas with a small, noise-driven UV refraction inside
 * "plumes": capsules in screen space that start at a hot point and rise
 * along a direction (straight up over an engine, backwards behind tailpipes).
 *
 * When no source is active the pass is bypassed and the scene renders directly.
 */
export class HeatHaze {
  constructor(renderer, { samples = 4 } = {}) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: renderer.capabilities.isWebGL2 ? samples : 0,
    });
    this.sources = [];
    this.uniforms = {
      tScene: { value: this.target.texture },
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uCount: { value: 0 },
      // xy = start (uv), zw = end (uv)
      uSeg: { value: Array.from({ length: MAX_SOURCES }, () => new THREE.Vector4()) },
      // x = width (uv), y = strength
      uParam: { value: Array.from({ length: MAX_SOURCES }, () => new THREE.Vector2()) },
    };
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        depthTest: false,
        depthWrite: false,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: /* glsl */ `
          #define MAX_SOURCES ${MAX_SOURCES}
          uniform sampler2D tScene;
          uniform float uTime;
          uniform float uAspect;
          uniform int uCount;
          uniform vec4 uSeg[MAX_SOURCES];
          uniform vec2 uParam[MAX_SOURCES];
          varying vec2 vUv;

          // distance from p to segment ab, plus how far along the segment (0..1)
          vec2 segDist(vec2 p, vec2 a, vec2 b) {
            vec2 pa = p - a, ba = b - a;
            pa.x *= uAspect; ba.x *= uAspect;
            float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
            return vec2(length(pa - ba * h), h);
          }

          void main() {
            vec2 offset = vec2(0.0);
            for (int i = 0; i < MAX_SOURCES; i++) {
              if (i >= uCount) break;
              vec2 d = segDist(vUv, uSeg[i].xy, uSeg[i].zw);
              float width = uParam[i].x * (0.55 + d.y * 0.9);      // plume widens as it rises
              float mask = (1.0 - smoothstep(0.0, width, d.x)) * smoothstep(0.0, 0.12, d.y) * (1.0 - d.y * 0.7);
              vec2 q = vUv * vec2(uAspect, 1.0) * 70.0;
              float t = uTime * 7.0;
              vec2 n = vec2(
                sin(q.y * 1.3 - t * 1.7 + sin(q.x * 0.7 + t)) + sin(q.y * 2.9 - t * 2.3),
                cos(q.x * 1.1 - t * 1.3 + sin(q.y * 0.9 - t * 0.6))
              );
              offset += n * mask * uParam[i].y;
            }
            gl_FragColor = texture2D(tScene, vUv + offset * 0.0035);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      })
    );
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad.frustumCulled = false;
  }

  setSize(width, height, pixelRatio) {
    this.target.setSize(Math.floor(width * pixelRatio), Math.floor(height * pixelRatio));
    this.uniforms.uAspect.value = width / height;
  }

  /**
   * Plumes are given in world space; they are projected with the camera each frame.
   * @param {{ from: THREE.Vector3, to: THREE.Vector3, width: number, strength: number }[]} sources
   */
  render(scene, camera, sources, time) {
    const active = sources.filter((s) => s.strength > 0.002).slice(0, MAX_SOURCES);
    if (!active.length) {
      this.renderer.render(scene, camera);
      return;
    }
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    active.forEach((s, i) => {
      a.copy(s.from).project(camera);
      b.copy(s.to).project(camera);
      this.uniforms.uSeg.value[i].set(a.x * 0.5 + 0.5, a.y * 0.5 + 0.5, b.x * 0.5 + 0.5, b.y * 0.5 + 0.5);
      this.uniforms.uParam.value[i].set(s.width, s.strength);
    });
    this.uniforms.uCount.value = active.length;
    this.uniforms.uTime.value = time;

    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.clear();
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCamera);
  }

  dispose() {
    this.target.dispose();
    this.quad.geometry.dispose();
    this.quad.material.dispose();
  }
}
