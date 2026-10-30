// ============================================================================
// Rails: how they join up, and how a minecart rolls along them.
//
// A rail's "shape" says which two sides it connects:
//   'ns' / 'ew'                straight
//   'se' 'ne' 'nw' 'sw'        curves (plain rails only)
//   'asc_n' 'asc_e' ...        slopes, climbing one block toward that side
// When you place a rail it picks its shape from the rails around it, and
// neighbours with a loose end turn to join it, so tracks lay themselves.
//
// Powered rails push carts along when they have power (a redstone torch,
// lever or block of redstone touching them, or a powered rail next to them up
// to 8 rails away). Without power they act as brakes.
// ============================================================================
import { BLOCKS, FAMILIES, stateId, IS_SOLID } from './blocks.js';

export const RAIL_BASES = ['rail', 'powered_rail', 'detector_rail', 'activator_rail'];
const D = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
const FULL = { n: 'north', e: 'east', s: 'south', w: 'west' };
const SHORT = { north: 'n', east: 'e', south: 's', west: 'w' };
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };

/** {base, shape} for a rail block, or null if it isn't one. */
export function railInfo(id) {
  const b = BLOCKS[id];
  if (!b || !b.base) return null;
  if (RAIL_BASES.includes(b.base)) return { base: b.base, shape: b.state.dir };
  if (b.base === 'rail_curve') return { base: 'rail', shape: b.state.curve };
  if (b.railOf) return { base: b.railOf, shape: 'asc_' + SHORT[b.state.facing] };
  return null;
}
export const isRail = (id) => !!railInfo(id);

/** Block id for a rail of `base` with `shape` (curves fall back to straight for special rails). */
export function railId(base, shape) {
  if (shape === 'ns' || shape === 'ew') return stateId(base, { dir: shape });
  if (shape.startsWith('asc_')) return stateId(`${base}_slope`, { facing: FULL[shape[4]] });
  if (base !== 'rail') return stateId(base, { dir: shape.includes('n') && shape.includes('s') ? 'ns' : 'ew' });
  return stateId('rail_curve', { curve: shape });
}

/** The two ends of a shape: [side, dy] where dy = 1 if that end is one block up. */
export function railEnds(shape) {
  if (shape === 'ns') return [['n', 0], ['s', 0]];
  if (shape === 'ew') return [['e', 0], ['w', 0]];
  if (shape.startsWith('asc_')) { const d = shape[4]; return [[d, 1], [OPP[d], 0]]; }
  return [[shape[0], 0], [shape[1], 0]];
}

/** Shape joining two sides (each [side, dy]). */
function shapeFor(a, b, base) {
  const [sa, ya] = a, [sb, yb] = b;
  if (OPP[sa] === sb) {
    if (ya) return 'asc_' + sa;
    if (yb) return 'asc_' + sb;
    return sa === 'n' || sa === 's' ? 'ns' : 'ew';
  }
  if (base !== 'rail') return null;
  const key = ['n', 's'].includes(sa) ? sa + sb : sb + sa; // curve names start with n/s
  return { ne: 'ne', nw: 'nw', se: 'se', sw: 'sw' }[key] || null;
}

/** Does the rail at (x,y,z) have an end pointing at cell (tx,ty,tz)? */
function pointsAt(x, y, z, shape, tx, ty, tz) {
  return railEnds(shape).some(([s, dy]) => x + D[s][0] === tx && z + D[s][1] === tz && y + dy === ty);
}

/** Rails next to (x,y,z) that could join it: [{side, dy, x, y, z, info}] */
function neighbours(x, y, z, getBlock) {
  const out = [];
  for (const s of ['n', 'e', 's', 'w']) {
    const nx = x + D[s][0], nz = z + D[s][1];
    for (const dy of [0, 1, -1]) {
      const info = railInfo(getBlock(nx, y + dy, nz));
      if (!info) continue;
      // a rail one block down only joins if it climbs toward us
      if (dy === -1 && info.shape !== 'asc_' + OPP[s]) continue;
      out.push({ side: s, dy: dy === 1 ? 1 : 0, x: nx, y: y + dy, z: nz, info });
      break;
    }
  }
  return out;
}

/** How many of a rail's ends already lead to another rail. */
function linkedEnds(x, y, z, shape, getBlock) {
  let n = 0;
  for (const [s, dy] of railEnds(shape)) {
    const nx = x + D[s][0], nz = z + D[s][1];
    if (isRail(getBlock(nx, y + dy, nz)) || (dy === 0 && railInfo(getBlock(nx, y - 1, nz))?.shape === 'asc_' + OPP[s])) n++;
  }
  return n;
}

/**
 * Choose the shape of a new rail of `base` at (x,y,z), and reshape neighbours
 * with a loose end so they join it. `lookSide` ('n','e','s','w') breaks ties.
 * Returns [[x, y, z, id], ...]: the new rail first.
 */
export function placeRail(base, x, y, z, lookSide, getBlock) {
  const near = neighbours(x, y, z, getBlock);
  // prefer neighbours that point at us or still have a free end
  const free = near.filter(n => pointsAt(n.x, n.y, n.z, n.info.shape, x, y, z) || linkedEnds(n.x, n.y, n.z, n.info.shape, getBlock) < 2);
  const pool = free.length ? free : near;
  let shape = null;
  for (let i = 0; i < pool.length && !shape; i++) for (let j = i + 1; j < pool.length && !shape; j++) {
    shape = shapeFor([pool[i].side, pool[i].dy], [pool[j].side, pool[j].dy], base);
  }
  if (!shape && pool.length) { const n = pool[0]; shape = shapeFor([n.side, n.dy], [OPP[n.side], 0], base); }
  if (!shape) shape = lookSide === 'e' || lookSide === 'w' ? 'ew' : 'ns';
  return [[x, y, z, railId(base, shape)], ...joinNeighbours(x, y, z, shape, getBlock)];
}

/** Neighbours of the rail at (x,y,z) that should turn to join it: [[x, y, z, id], ...] */
export function joinNeighbours(x, y, z, shape, getBlock) {
  if (!shape) { const info = railInfo(getBlock(x, y, z)); if (!info) return []; shape = info.shape; }
  const near = neighbours(x, y, z, getBlock);
  const out = [];
  // Neighbours we now point at turn toward us if they have a loose end.
  const mine = railEnds(shape);
  for (const n of near) {
    if (!mine.some(([s]) => s === n.side)) continue;
    if (pointsAt(n.x, n.y, n.z, n.info.shape, x, y, z)) continue;
    const ends = railEnds(n.info.shape);
    const keep = ends.find(([s, dy]) => {
      const nx = n.x + D[s][0], nz = n.z + D[s][1];
      return isRail(getBlock(nx, n.y + dy, nz)) || railInfo(getBlock(nx, n.y - 1, nz))?.shape === 'asc_' + OPP[s];
    });
    const towardUs = [OPP[n.side], y > n.y ? 1 : 0];
    const ns = shapeFor(towardUs, keep || [n.side, 0], n.info.base);
    if (ns && ns !== n.info.shape) out.push([n.x, n.y, n.z, railId(n.info.base, ns)]);
  }
  return out;
}

// ---- Power for powered rails ----------------------------------------------------------
const POWER = new Set();
export function initRailPower(B) {
  for (const n of ['redstone_block', 'redstone_torch', 'lever']) if (FAMILIES[n] || B[n.toUpperCase()]) POWER.add(FAMILIES[n] ? FAMILIES[n].baseId : B[n.toUpperCase()]);
  if (FAMILIES.redstone_wall_torch) for (const id of FAMILIES.redstone_wall_torch.map.values()) POWER.add(id);
}
function touchesPower(x, y, z, getBlock) {
  for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1 && !(dy === -1 && dx === 0 && dz === 0)) continue;
    if (POWER.has(getBlock(x + dx, y + dy, z + dz))) return true;
  }
  return false;
}
/** Is the powered rail at (x,y,z) switched on? Power passes along up to 8 powered rails. */
export function railPowered(x, y, z, getBlock) {
  const seen = new Set();
  let frontier = [[x, y, z]];
  for (let step = 0; step <= 8 && frontier.length; step++) {
    const next = [];
    for (const [cx, cy, cz] of frontier) {
      const k = cx + ',' + cy + ',' + cz;
      if (seen.has(k)) continue;
      seen.add(k);
      if (touchesPower(cx, cy, cz, getBlock)) return true;
      const info = railInfo(getBlock(cx, cy, cz));
      if (!info || info.base !== 'powered_rail') continue;
      for (const [s, dy] of railEnds(info.shape)) {
        for (const yy of [cy + dy, cy - 1]) {
          const ni = railInfo(getBlock(cx + D[s][0], yy, cz + D[s][1]));
          if (ni && ni.base === 'powered_rail') next.push([cx + D[s][0], yy, cz + D[s][1]]);
        }
      }
    }
    frontier = next;
  }
  return false;
}

// ---- Minecart movement ---------------------------------------------------------------------
const MAX_SPEED = 8;     // blocks per second
const GRAVITY = 9;       // pull along a slope
/** The path a cart follows through one rail cell: two end points in world space. */
function railSegment(x, y, z, shape) {
  const [[s1, y1], [s2, y2]] = railEnds(shape);
  const p = (s, dy) => [x + 0.5 + D[s][0] * 0.5, y + dy, z + 0.5 + D[s][1] * 0.5];
  return [p(s1, y1), p(s2, y2)];
}
/** The rail under a cart at this position (looks one block down too, for slopes). */
function railUnder(pos, getBlock) {
  const x = Math.floor(pos.x), z = Math.floor(pos.z);
  for (const y of [Math.floor(pos.y + 0.05), Math.floor(pos.y + 0.05) - 1]) {
    const info = railInfo(getBlock(x, y, z));
    if (info) return { x, y, z, info };
  }
  return null;
}

/**
 * Move a minecart for one frame. cart = {pos:{x,y,z}, speed, dir:{x,y,z}} (dir = unit
 * direction of travel along the track). push = -1..1 from the rider's W/S keys
 * relative to the direction they face (lookX, lookZ).
 * Returns false if the cart is off the rails.
 */
export function cartStep(cart, dt, getBlock, push = 0, look = null) {
  const steps = Math.max(1, Math.ceil(Math.abs(cart.speed) * dt / 0.3));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const r = railUnder(cart.pos, getBlock);
    if (!r) return false;
    const [a, b] = railSegment(r.x, r.y, r.z, r.info.shape);
    let ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const len = Math.hypot(ux, uy, uz); ux /= len; uy /= len; uz /= len;
    // keep heading the same way along the new piece of track
    if (ux * cart.dir.x + uy * cart.dir.y + uz * cart.dir.z < 0) { ux = -ux; uy = -uy; uz = -uz; }
    cart.dir = { x: ux, y: uy, z: uz };
    // snap onto the track line
    const t = Math.max(0, Math.min(1, ((cart.pos.x - a[0]) * (b[0] - a[0]) + (cart.pos.z - a[2]) * (b[2] - a[2])) / ((b[0] - a[0]) ** 2 + (b[2] - a[2]) ** 2)));
    cart.pos.x = a[0] + (b[0] - a[0]) * t; cart.pos.z = a[2] + (b[2] - a[2]) * t; cart.pos.y = a[1] + (b[1] - a[1]) * t;
    // forces along the track
    let s = cart.speed;
    s -= GRAVITY * uy * h;                         // downhill speeds up, uphill slows down
    if (look && push) {                             // the rider leans forward / back
      const facing = Math.sign(look.x * ux + look.z * uz) || 1;
      if (Math.abs(s) < 4) s += push * facing * 5 * h;
    }
    if (r.info.base === 'powered_rail') {
      if (railPowered(r.x, r.y, r.z, getBlock)) {
        if (Math.abs(s) < 0.05) {
          // starting from a standstill: kick away from a block at one end
          const blockedAhead = IS_SOLID[getBlock(Math.floor(cart.pos.x + ux * 0.8), r.y, Math.floor(cart.pos.z + uz * 0.8))];
          s = blockedAhead ? -0.5 : 0.5;
        }
        s += Math.sign(s) * 14 * h;
      } else s *= Math.exp(-h * 8);               // unpowered: brakes
    }
    s *= Math.exp(-h * 0.12);                       // rolling friction
    if (Math.abs(s) < 0.02 && !push) s = 0;
    s = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, s));
    if (s < 0) { cart.dir = { x: -ux, y: -uy, z: -uz }; s = -s; ux = -ux; uy = -uy; uz = -uz; }
    cart.speed = s;
    // move, and stop at the end of the line
    const nx = cart.pos.x + ux * s * h, ny = cart.pos.y + uy * s * h, nz = cart.pos.z + uz * s * h;
    const leaving = Math.floor(nx) !== r.x || Math.floor(nz) !== r.z;
    if (leaving && !railUnder({ x: nx + ux * 0.01, y: ny + 0.02, z: nz + uz * 0.01 }, getBlock) && !railUnder({ x: nx + ux * 0.01, y: ny + 1.02, z: nz + uz * 0.01 }, getBlock)) {
      cart.speed = 0;
      return true;
    }
    cart.pos.x = nx; cart.pos.y = ny; cart.pos.z = nz;
  }
  return true;
}
