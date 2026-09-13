/**
 * materials.js — one shared material registry.
 *
 * Every prop pulls from here, which is what makes static batching effective:
 * a whole town square can collapse into a handful of draw calls because all of
 * its planks share one material instance.
 */

import * as THREE from 'three';
import * as TEX from './textures.js';

let M = null;

const std = (o) => new THREE.MeshStandardMaterial(o);

export function createMaterials() {
  if (M) return M;

  const plank = TEX.plankTexture();
  const wood = TEX.woodTexture();
  const woodDarkTex = TEX.woodTexture('woodDark', [96, 66, 42]);
  const woodPaleTex = TEX.woodTexture('woodPale', [196, 160, 118]);

  const tiled = (t, r) => { const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(r, r); c.needsUpdate = true; return c; };

  M = {
    // --- structural -----------------------------------------------------
    plank:     std({ map: plank, roughness: 0.85 }),
    plankWorn: std({ map: tiled(plank, 2), color: 0xd8c3a6, roughness: 0.92 }),
    wood:      std({ map: wood, roughness: 0.8 }),
    woodDark:  std({ map: woodDarkTex, roughness: 0.78 }),
    woodPale:  std({ map: woodPaleTex, roughness: 0.8 }),
    bark:      std({ map: TEX.barkTexture(), roughness: 0.95 }),

    plasterWhite: std({ map: TEX.plasterTexture('plWhite', [238, 233, 224]), roughness: 0.92 }),
    plasterCream: std({ map: TEX.plasterTexture('plCream', [232, 214, 182]), roughness: 0.92 }),
    plasterBlue:  std({ map: TEX.plasterTexture('plBlue', [176, 199, 214]), roughness: 0.92 }),
    plasterRose:  std({ map: TEX.plasterTexture('plRose', [226, 188, 190]), roughness: 0.92 }),
    plasterSage:  std({ map: TEX.plasterTexture('plSage', [196, 206, 184]), roughness: 0.92 }),
    brick:        std({ map: TEX.brickTexture(), roughness: 0.95 }),
    roof:         std({ map: TEX.roofTexture(), roughness: 0.88 }),
    roofSlate:    std({ map: TEX.roofTexture(), color: 0x5c6470, roughness: 0.8 }),
    stone:        std({ map: TEX.rockTexture(), roughness: 0.95 }),
    rockFacet:    std({ color: 0x9b978f, roughness: 0.96, flatShading: true }),
    stoneLight:   std({ map: TEX.rockTexture(), color: 0xcfc9bd, roughness: 0.92 }),
    concrete:     std({ color: 0xb8b4ac, roughness: 0.96 }),
    paving:       std({ map: tiled(TEX.pavingTexture(), 1), color: 0xbfc2c0, roughness: 0.94 }),
    asphalt:      std({ map: tiled(TEX.asphaltTexture(), 1), roughness: 0.98 }),
    dirtPath:     std({ map: tiled(TEX.dirtTexture(), 1), roughness: 0.99 }),
    sand:         std({ map: TEX.sandTexture(), roughness: 0.98 }),

    // --- surfaces -------------------------------------------------------
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xbcd8ea, roughness: 0.06, metalness: 0.0, transparent: true,
      opacity: 0.32, transmission: 0.0, side: THREE.DoubleSide, depthWrite: false,
    }),
    windowLit: std({ map: TEX.windowTexture(), emissive: 0xffd9a0, emissiveIntensity: 0.0, roughness: 0.2 }),
    metal:      std({ color: 0x565c66, roughness: 0.45, metalness: 0.55 }),
    metalLight: std({ color: 0xa8b0ba, roughness: 0.38, metalness: 0.55 }),
    metalWhite: std({ color: 0xe8ecf0, roughness: 0.32, metalness: 0.4 }),
    gold:       std({ color: 0xd9a441, roughness: 0.32, metalness: 0.75 }),
    copper:     std({ color: 0xb87333, roughness: 0.38, metalness: 0.7 }),
    ceramic:    std({ color: 0xf4f4f2, roughness: 0.18, metalness: 0.02 }),
    leather:    std({ color: 0x6b4630, roughness: 0.7 }),
    rubber:     std({ color: 0x1b1d21, roughness: 0.95 }),

    // --- fabrics --------------------------------------------------------
    fabricRose:  std({ map: TEX.fabricTexture('fRose', [226, 116, 146]), roughness: 0.95 }),
    fabricCream: std({ map: TEX.fabricTexture('fCream', [235, 224, 204]), roughness: 0.95 }),
    fabricBlue:  std({ map: TEX.fabricTexture('fBlue', [92, 132, 178]), roughness: 0.95 }),
    fabricRed:   std({ map: TEX.fabricTexture('fRed', [186, 74, 70]), roughness: 0.95 }),
    fabricGreen: std({ map: TEX.fabricTexture('fGreen', [104, 150, 106]), roughness: 0.95 }),
    fabricSun:   std({ map: TEX.fabricTexture('fSun', [232, 186, 96]), roughness: 0.95 }),

    // --- emissive / lights ---------------------------------------------
    lampGlass:  std({ color: 0xfff0cf, emissive: 0xffc978, emissiveIntensity: 0.2, roughness: 0.3, transparent: true, opacity: 0.85 }),
    neonRose:   std({ color: 0xff9ab5, emissive: 0xff5c86, emissiveIntensity: 0.9, roughness: 0.4 }),
    lanternGlow:std({ color: 0xffdca8, emissive: 0xffb457, emissiveIntensity: 0.8, roughness: 0.5 }),
    crystal: new THREE.MeshPhysicalMaterial({
      color: 0xb79cff, emissive: 0x6a4fd0, emissiveIntensity: 0.5,
      roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.75,
    }),
    fire: new THREE.MeshBasicMaterial({ color: 0xff9640, transparent: true, opacity: 0.85, depthWrite: false }),

    // --- nature ---------------------------------------------------------
    foliagePine:   std({ color: 0xffffff, map: TEX.leafSurfaceTexture('pine', [74, 112, 74]), roughness: 0.98 }),
    foliageOak:    std({ color: 0xffffff, map: TEX.leafSurfaceTexture('oak', [108, 150, 78]), roughness: 0.98 }),
    foliagePalm:   std({ color: 0x5f9448, roughness: 0.98, side: THREE.DoubleSide }),
    foliageTrop:   std({ color: 0xffffff, map: TEX.leafSurfaceTexture('trop', [88, 140, 88]), roughness: 0.98 }),
    bush:          std({ color: 0xffffff, map: TEX.leafSurfaceTexture('bush', [94, 132, 72]), roughness: 0.98 }),
    petalRose:     std({ color: 0xff87b5, roughness: 0.85, side: THREE.DoubleSide }),
    petalWhite:    std({ color: 0xf4eef6, roughness: 0.85, side: THREE.DoubleSide }),
    petalGold:     std({ color: 0xffd166, roughness: 0.85, side: THREE.DoubleSide }),
    stem:          std({ color: 0x4d7a3a, roughness: 0.95 }),

    // --- accents --------------------------------------------------------
    accentRose:  std({ color: 0xe25f86, roughness: 0.6 }),
    accentTeal:  std({ color: 0x4fa3a0, roughness: 0.6 }),
    accentCream: std({ color: 0xf1e6d4, roughness: 0.7 }),
    dark:        std({ color: 0x252a33, roughness: 0.8 }),
    white:       std({ color: 0xf7f7f5, roughness: 0.6 }),
    terracotta:  std({ color: 0xb2653f, roughness: 0.9 }),
    paper:       std({ color: 0xf6efe2, roughness: 0.95, side: THREE.DoubleSide }),
  };

  return M;
}

export function materials() { return M || createMaterials(); }

/** Night lighting: switch windows and lamps on/off. */
export function setNightLighting(on, strength = 1) {
  if (!M) return;
  M.windowLit.emissiveIntensity = on ? 1.15 * strength : 0.0;
  M.lampGlass.emissiveIntensity = on ? 1.6 * strength : 0.15;
  M.lanternGlow.emissiveIntensity = on ? 1.5 * strength : 0.25;
  M.neonRose.emissiveIntensity = on ? 1.5 * strength : 0.45;
}

export function disposeMaterials() {
  if (!M) return;
  Object.values(M).forEach(m => m.dispose());
  M = null;
}
