// ============================================================================
// Voxel raycast (Amanatides & Woo "fast voxel traversal").
//
// Instead of stepping along the ray in tiny increments (slow and can skip
// corners), we jump exactly from one block boundary to the next. At each step
// we advance along whichever axis reaches its next boundary first. This visits
// every block the ray passes through, in order, with a handful of additions.
// ============================================================================
import { BLOCKS } from './blocks.js';

/**
 * @param {(x,y,z)=>number} getBlock
 * @param {number[]} origin [x,y,z]
 * @param {number[]} dir    normalised direction [x,y,z]
 * @param {number} maxDist
 * @param {(id:number)=>boolean} [isTarget] which blocks stop the ray
 * @returns {null | {x,y,z,id, nx,ny,nz, dist}}  hit block and the face normal
 */
export function raycastBlocks(getBlock, origin, dir, maxDist, isTarget = defaultTarget) {
  let x = Math.floor(origin[0]), y = Math.floor(origin[1]), z = Math.floor(origin[2]);
  const stepX = dir[0] > 0 ? 1 : -1, stepY = dir[1] > 0 ? 1 : -1, stepZ = dir[2] > 0 ? 1 : -1;
  // Distance along the ray to cross one whole block on each axis.
  const tDeltaX = dir[0] !== 0 ? Math.abs(1 / dir[0]) : Infinity;
  const tDeltaY = dir[1] !== 0 ? Math.abs(1 / dir[1]) : Infinity;
  const tDeltaZ = dir[2] !== 0 ? Math.abs(1 / dir[2]) : Infinity;
  // Distance along the ray to the *first* boundary on each axis.
  const frac = (v, s) => (s > 0 ? Math.floor(v) + 1 - v : v - Math.floor(v));
  let tMaxX = dir[0] !== 0 ? frac(origin[0], stepX) * tDeltaX : Infinity;
  let tMaxY = dir[1] !== 0 ? frac(origin[1], stepY) * tDeltaY : Infinity;
  let tMaxZ = dir[2] !== 0 ? frac(origin[2], stepZ) * tDeltaZ : Infinity;
  let nx = 0, ny = 0, nz = 0, t = 0;

  while (t <= maxDist) {
    const id = getBlock(x, y, z);
    if (id && isTarget(id)) return { x, y, z, id, nx, ny, nz, dist: t };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
    }
  }
  return null;
}

function defaultTarget(id) {
  const b = BLOCKS[id];
  return b && !b.liquid;
}

/** Ray vs axis-aligned box (slab method). Returns hit distance or -1. */
export function rayBox(origin, dir, min, max) {
  let tmin = -Infinity, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-9) {
      if (origin[i] < min[i] || origin[i] > max[i]) return -1;
    } else {
      let t1 = (min[i] - origin[i]) / dir[i];
      let t2 = (max[i] - origin[i]) / dir[i];
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  if (tmax < 0) return -1;
  return tmin >= 0 ? tmin : 0;
}
