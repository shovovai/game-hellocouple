/**
 * batching.js — static geometry merger.
 *
 * The world is built from thousands of small meshes (planks, chairs, window
 * frames…). Drawing them individually would cost thousands of draw calls, so
 * once the world is assembled every *static* mesh is merged by
 * (spatial cell × material). Cells keep frustum culling meaningful: distant
 * parts of the island are skipped instead of being drawn because one giant
 * merged mesh happened to touch the view.
 *
 * Meshes opt out with `mesh.userData.dynamic = true`.
 */

import * as THREE from 'three';

function toNonIndexed(geo) {
  return geo.index ? geo.toNonIndexed() : geo;
}

/** Concatenate compatible geometries (position / normal / uv only). */
export function mergeGeometries(list) {
  let total = 0;
  for (const g of list) total += g.attributes.position.count;

  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o = 0;

  for (const g of list) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const t = g.attributes.uv;
    const c = p.count;
    pos.set(p.array.subarray(0, c * 3), o * 3);
    if (n) nrm.set(n.array.subarray(0, c * 3), o * 3);
    if (t) uv.set(t.array.subarray(0, c * 2), o * 2);
    o += c;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/**
 * Merge every static descendant of `root` in place.
 * @param {THREE.Object3D} root
 * @param {number} cell  spatial bucket size in metres
 * @returns {{meshes:number, batches:number, tris:number}}
 */
export function batchStatic(root, cell = 90) {
  root.updateMatrixWorld(true);

  const buckets = new Map();           // key -> { material, geos[], castShadow, receiveShadow }
  const originals = [];
  let meshCount = 0;

  root.traverse(obj => {
    if (!obj.isMesh || obj.userData.dynamic) return;
    if (Array.isArray(obj.material)) return;
    if (!obj.geometry || !obj.geometry.attributes.position) return;
    if (obj.isInstancedMesh || obj.isSkinnedMesh) return;
    // Anything under a dynamic parent stays dynamic.
    for (let p = obj.parent; p && p !== root; p = p.parent) if (p.userData.dynamic) return;
    originals.push(obj);
  });

  for (const obj of originals) {
    const g = toNonIndexed(obj.geometry).clone();
    g.applyMatrix4(obj.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    g.computeBoundingSphere();
    const c = g.boundingSphere.center;
    const key = `${Math.floor(c.x / cell)}|${Math.floor(c.z / cell)}|${obj.material.uuid}|${obj.castShadow ? 1 : 0}${obj.receiveShadow ? 1 : 0}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = {
      material: obj.material, geos: [],
      castShadow: obj.castShadow, receiveShadow: obj.receiveShadow,
    }));
    b.geos.push(g);
    meshCount++;
  }

  // Detach originals. Their geometry is NOT disposed here: some of it is the
  // shared unit primitives from props.js, which later builds still need.
  for (const obj of originals) {
    if (obj.parent) obj.parent.remove(obj);
  }

  let tris = 0;
  const container = new THREE.Group();
  container.name = 'static-batches';
  for (const b of buckets.values()) {
    const geo = mergeGeometries(b.geos);
    b.geos.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(geo, b.material);
    mesh.castShadow = b.castShadow;
    mesh.receiveShadow = b.receiveShadow;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    container.add(mesh);
    tris += geo.attributes.position.count / 3;
  }
  root.add(container);

  // Drop now-empty groups so traversal stays cheap.
  const prune = (node) => {
    for (let i = node.children.length - 1; i >= 0; i--) {
      const c = node.children[i];
      if (c === container) continue;
      prune(c);
      if (c.type === 'Group' && c.children.length === 0 && !c.userData.keep) node.remove(c);
    }
  };
  prune(root);

  return { meshes: meshCount, batches: buckets.size, tris };
}
