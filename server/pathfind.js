// ============================================================================
// Pathfinding for mobs: A* search over the block grid.
//
// A mob can stand in a cell if the block under it is solid and the cells its
// body fills are open. From one cell it can walk to a neighbour (diagonals too,
// if both sides are clear), hop up one block, or drop down up to three. Water
// is allowed but costs extra (land mobs would rather walk around a pond), and
// lava, fire and cactus are never stepped into. A* always expands the cell
// that looks cheapest (steps so far + straight-line distance left), so it
// finds a good route while looking at only a few hundred cells.
// ============================================================================
import { BLOCKS, IS_SOLID, IS_LIQUID, SHAPE, B } from '../shared/blocks.js';

const DANGER = new Set([B.LAVA, B.CACTUS, B.FIRE].filter(Boolean));
// Fences and walls are 1.5 blocks tall: mobs can't hop over them or stand on them.
const TALL = (id) => SHAPE[id] === 6 || SHAPE[id] === 7 || (BLOCKS[id] && BLOCKS[id].gate && !BLOCKS[id].state.open);

/** Can a mob `height` blocks tall stand with its feet in cell (x, y, z)? */
export function standable(get, x, y, z, height = 2) {
  const below = get(x, y - 1, z);
  if (!IS_SOLID[below] && !IS_LIQUID[get(x, y, z)]) return false;
  if (TALL(below) || DANGER.has(below)) return false;
  for (let i = 0; i < Math.ceil(height); i++) {
    const id = get(x, y + i, z);
    if ((IS_SOLID[id] && SHAPE[id] !== 3) || DANGER.has(id)) return false; // (flat things like rails don't block)
  }
  return true;
}

const key = (x, y, z) => `${x},${y},${z}`;

/**
 * Find a walking route. Returns [{x, y, z}, ...] (cell centres' feet positions,
 * not including the start) or null if there's no route within the search budget.
 */
export function findPath(get, from, to, { height = 2, maxNodes = 400, maxDrop = 3, swim = false } = {}) {
  const sx = Math.floor(from.x), sy = Math.floor(from.y + 0.01), sz = Math.floor(from.z);
  const tx = Math.floor(to.x), ty = Math.floor(to.y + 0.01), tz = Math.floor(to.z);
  const h = (x, y, z) => Math.hypot(x - tx, (y - ty) * 1.5, z - tz);
  const open = [{ x: sx, y: sy, z: sz, g: 0, f: h(sx, sy, sz), parent: null }];
  const best = new Map([[key(sx, sy, sz), 0]]);
  let closest = open[0], expanded = 0;
  while (open.length && expanded < maxNodes) {
    // take the cheapest-looking node (a simple scan is fine for a few hundred nodes)
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const n = open[bi];
    open[bi] = open[open.length - 1]; open.pop();
    expanded++;
    if (n.f - n.g < closest.f - closest.g) closest = n;
    if (Math.abs(n.x - tx) <= 1 && Math.abs(n.z - tz) <= 1 && Math.abs(n.y - ty) <= 1) return build(n);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = n.x + dx, nz = n.z + dz;
      if (dx && dz && !(standable(get, n.x + dx, n.y, n.z, height) && standable(get, n.x, n.y, n.z + dz, height))) continue;
      let ny = null;
      if (standable(get, nx, n.y, nz, height)) ny = n.y;
      else if (standable(get, nx, n.y + 1, nz, height) && !IS_SOLID[get(n.x, n.y + Math.ceil(height), n.z)] && !(dx && dz)) ny = n.y + 1;
      else for (let d = 1; d <= maxDrop; d++) {
        if (IS_SOLID[get(nx, n.y - d + 1, nz)]) break;
        if (standable(get, nx, n.y - d, nz, height)) { ny = n.y - d; break; }
      }
      if (ny === null) continue;
      const wet = IS_LIQUID[get(nx, ny, nz)];
      const step = (dx && dz ? 1.414 : 1) + (ny > n.y ? 0.5 : 0) + (wet && !swim ? 6 : 0);
      const g = n.g + step, k = key(nx, ny, nz);
      if (best.has(k) && best.get(k) <= g) continue;
      best.set(k, g);
      open.push({ x: nx, y: ny, z: nz, g, f: g + h(nx, ny, nz), parent: n });
    }
  }
  // Couldn't reach it: head for the closest point we found instead (if it's any closer).
  return closest !== open[0] && closest.parent ? build(closest) : null;
}

function build(n) {
  const out = [];
  for (let c = n; c && c.parent; c = c.parent) out.push({ x: c.x + 0.5, y: c.y, z: c.z + 0.5 });
  return out.reverse();
}

/** A random spot a mob could walk to, within `r` blocks of (x, y, z). */
export function randomSpot(get, x, y, z, r, height = 2) {
  for (let tries = 0; tries < 8; tries++) {
    const px = Math.floor(x + (Math.random() * 2 - 1) * r), pz = Math.floor(z + (Math.random() * 2 - 1) * r);
    for (let py = Math.floor(y) + 4; py >= Math.floor(y) - 6; py--) {
      if (standable(get, px, py, pz, height) && !IS_LIQUID[get(px, py, pz)]) return { x: px + 0.5, y: py, z: pz + 0.5 };
    }
  }
  return null;
}
