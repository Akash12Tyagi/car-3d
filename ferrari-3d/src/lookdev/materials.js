import * as THREE from 'three';

/**
 * Look-development materials for the main car, one instance per material slot
 * (slots are defined in the vehicle registry). The source asset's own materials
 * are FBX2glTF defaults — metalness 0.2 / roughness 0.8 on everything, no
 * textures — and several are shared by unrelated parts, so each slot gets its
 * own material instead of editing the shared ones.
 *
 * Values are tuned together with the studio environment and Khronos PBR Neutral
 * tone mapping (exposure 1.0). Colours are authored in sRGB; three.js converts
 * them to linear.
 */

/** Rosso: a solid (non-metallic) red under a deep, glassy clearcoat. */
export const PAINT = {
  color: '#94050c',
  metalness: 0.05,
  roughness: 0.3,
  clearcoat: 1,
  clearcoatRoughness: 0.018,
};

export function createLookdevMaterials() {
  const std = (p) => new THREE.MeshStandardMaterial(p);
  const phys = (p) => new THREE.MeshPhysicalMaterial(p);
  return {
    // Wheels — the finish the configurator restyles covers spokes AND barrel
    rims: std({ name: 'lookdev/rims', color: '#d8d9db', metalness: 1, roughness: 0.3 }),
    rubber: std({ name: 'lookdev/rubber', color: '#141414', metalness: 0, roughness: 0.88 }),
    brakeDiscs: std({ name: 'lookdev/brake-discs', color: '#76777a', metalness: 1, roughness: 0.52 }),
    wheelNuts: std({ name: 'lookdev/wheel-nuts', color: '#2b2c2e', metalness: 1, roughness: 0.32 }),
    badges: phys({ name: 'lookdev/badges', color: '#f2cf00', metalness: 0, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 }),

    // Exterior trim
    chrome: std({ name: 'lookdev/chrome', color: '#f2f2f2', metalness: 1, roughness: 0.06 }),
    metalTrim: std({ name: 'lookdev/metal-trim', color: '#8f9195', metalness: 1, roughness: 0.38 }),
    plastic: std({ name: 'lookdev/satin-black', color: '#151515', metalness: 0, roughness: 0.5 }),
    blackTrim: std({ name: 'lookdev/black-trim', color: '#0d0d0d', metalness: 0.1, roughness: 0.62 }),

    // Glass and lamps
    glass: phys({ name: 'lookdev/glass', color: '#0c0e10', metalness: 0, roughness: 0.03, transparent: true, opacity: 0.58, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 1.8, depthWrite: false }),
    headLenses: phys({ name: 'lookdev/head-lenses', color: '#cfd4da', metalness: 0.6, roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.85 }),
    drl: std({ name: 'lookdev/drl', color: '#d7dbe0', metalness: 0.2, roughness: 0.3, emissive: '#e8eef8', emissiveIntensity: 0.55 }),
    tailLenses: phys({ name: 'lookdev/tail-lenses', color: '#5c0307', metalness: 0, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: 0.9 }),
    tailUnits: std({ name: 'lookdev/tail-units', color: '#7a0a0e', metalness: 0.3, roughness: 0.35, emissive: '#ff1a1a', emissiveIntensity: 0.12 }),

    // Cabin (visible through the open top)
    leather: std({ name: 'lookdev/leather', color: '#1a1919', metalness: 0, roughness: 0.62 }),
    stitching: std({ name: 'lookdev/stitching', color: '#9c0d14', metalness: 0, roughness: 0.6 }),
    interiorPanels: std({ name: 'lookdev/interior-panels', color: '#1d1d1f', metalness: 0, roughness: 0.7 }),
    tub: std({ name: 'lookdev/tub', color: '#0b0b0c', metalness: 0, roughness: 0.85 }),
    carpet: std({ name: 'lookdev/carpet', color: '#121212', metalness: 0, roughness: 0.95 }),
    carbon: phys({ name: 'lookdev/carbon', color: '#141518', metalness: 0.35, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.06 }),
  };
}
