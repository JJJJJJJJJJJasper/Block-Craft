// ============================================================================
// Structures out in the world: mineshafts, desert and jungle temples, witch
// huts, igloos, ocean monuments and woodland mansions (villages live in
// terrain.js). They're our own simplified designs in the spirit of the classic
// ones.
//
// Like villages, each structure is planned once, from its own seed, as a list
// of block operations in world coordinates, sorted into the chunks they fall
// in. Every chunk applies its share, so a structure can span many chunks and
// still come out exactly the same on the server and in every browser.
//
// The world is cut into square regions per kind of structure (bigger regions
// = rarer structures). Each region rolls once for whether it has one, then
// looks for a spot in the right biome.
// ============================================================================
import { SEA_LEVEL as S, CHUNK_HEIGHT as CH, CHUNK_SIZE as CS } from './config.js';
import { B, stateId } from './blocks.js';
import { BIOME } from './biomes.js';
import { hash2, hash3, mulberry32 } from './noise.js';

// How each operation writes its block (terrain.js applies them).
export const OP = { SET: 0, SOFT: 1, FILL_DOWN: 2, ROAD: 3, CARVE: 4, IF_AIR: 5, IF_SOLID: 6 };

const st = (base, state = {}) => stateId(base, state);
const stairs = (base, facing, half = 'bottom') => st(base, { half, facing });
const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };

/** Collects block operations and remembers the bounding box. */
function builder(kind, x, z) {
  const ops = [];
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const set = (bx, by, bz, id, mode = OP.SET) => {
    if (by < 1 || by >= CH - 1 || id === undefined) return;
    ops.push(bx, by, bz, id, mode);
    if (bx < box.minX) box.minX = bx; if (bx > box.maxX) box.maxX = bx;
    if (by < box.minY) box.minY = by; if (by > box.maxY) box.maxY = by;
    if (bz < box.minZ) box.minZ = bz; if (bz > box.maxZ) box.maxZ = bz;
  };
  const fill = (x0, y0, z0, x1, y1, z1, id, mode) => {
    for (let by = y0; by <= y1; by++) for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) set(bx, by, bz, typeof id === 'function' ? id(bx, by, bz) : id, mode);
  };
  /** Walls, floor and ceiling of `wall`, the inside filled with `inside`. */
  const shell = (x0, y0, z0, x1, y1, z1, wall, inside = B.AIR) => {
    fill(x0, y0, z0, x1, y1, z1, (bx, by, bz) => (bx === x0 || bx === x1 || by === y0 || by === y1 || bz === z0 || bz === z1
      ? (typeof wall === 'function' ? wall(bx, by, bz) : wall) : inside));
  };
  const done = (extra = {}) => {
    // Sort the operations into the chunks they touch.
    const byChunk = new Map();
    for (let k = 0; k < ops.length; k += 5) {
      const key = `${Math.floor(ops[k] / CS)},${Math.floor(ops[k + 2] / CS)}`;
      let list = byChunk.get(key);
      if (!list) byChunk.set(key, list = []);
      list.push(ops[k], ops[k + 1], ops[k + 2], ops[k + 3], ops[k + 4]);
    }
    for (const [key, list] of byChunk) byChunk.set(key, new Int32Array(list));
    return { kind, id: `${kind}:${x},${z}`, x, z, ...box, byChunk, mobs: [], ...extra };
  };
  return { set, fill, shell, done };
}

export function createStructures(seed, column) {
  // ---- Desert temple ----------------------------------------------------------------------
  // A sandstone hall with two striped towers in front. Under the blue tile in the middle
  // of the floor, a shaft drops into a hidden room with four chests... and a pressure
  // plate wired to nine TNT.
  function desertTemple(r, cx, cz) {
    const y0 = column(cx, cz).height;
    const x0 = cx - 10, z0 = cz - 10;
    const b = builder('desert_temple', cx, cz);
    const SS = B.SANDSTONE, CUT = B.SMOOTH_SANDSTONE, CHIS = B.CHISELED_SANDSTONE, OR = B.ORANGE_TERRACOTTA, BL = B.BLUE_TERRACOTTA;
    const at = (u, y, v, id, mode) => b.set(x0 + u, y0 + y, z0 + v, id, mode);
    const fill = (u0, y0_, v0, u1, y1, v1, id, mode) => b.fill(x0 + u0, y0 + y0_, z0 + v0, x0 + u1, y0 + y1, z0 + v1, id, mode);
    // foundation down to the ground, then clear the space above
    fill(0, 0, 0, 20, 0, 20, SS, OP.FILL_DOWN);
    fill(-2, 1, -2, 22, 16, 22, B.AIR);
    // main hall with a stepped roof
    b.shell(x0, y0, z0 + 4, x0 + 20, y0 + 9, z0 + 20, (x, y, z) => (y === y0 + 4 || y === y0 + 7) && (x === x0 || x === x0 + 20 || z === z0 + 20) ? CUT : SS);
    for (let k = 1; k <= 4; k++) fill(k, 9 + k, 4 + k, 20 - k, 9 + k, 20 - k, k === 4 ? CUT : SS);
    // two towers with orange and blue stripes
    for (const u of [0, 16]) {
      b.shell(x0 + u, y0, z0, x0 + u + 4, y0 + 12, z0 + 4, (x, y, z) => (y === y0 + 5 || y === y0 + 9 ? OR : y === y0 + 7 ? BL : y === y0 + 12 ? CUT : SS));
      fill(u + 1, 13, 1, u + 3, 13, 3, CUT);
      fill(u + 2, 14, 2, u + 2, 14, 2, CHIS);
      fill(u + 2, 1, 4, u + 2, 2, 4, B.AIR);           // doorway into the hall
      fill(u + 2, 10, 0, u + 2, 11, 0, B.AIR);         // little windows
    }
    // the front: an entrance between the towers, with a striped wall above it
    fill(5, 0, 4, 15, 8, 4, (x, y) => (y === y0 + 5 || y === y0 + 6 ? OR : SS));
    fill(9, 1, 4, 11, 3, 4, B.AIR);
    fill(8, 4, 4, 12, 4, 4, CHIS);
    for (let u = 8; u <= 12; u++) at(u, 0, 3, SS);
    for (let u = 8; u <= 12; u++) at(u, 0, 2, stairs('sandstone_stairs', 'south'));
    // the floor pattern in the middle of the hall
    for (let v = 9; v <= 15; v++) for (let u = 7; u <= 13; u++) {
      const ring = Math.max(Math.abs(u - 10), Math.abs(v - 12));
      at(u, 0, v, ring === 0 ? BL : ring === 1 ? OR : ring === 3 ? OR : SS);
    }
    // columns inside the hall
    for (const [u, v] of [[4, 8], [16, 8], [4, 16], [16, 16]]) fill(u, 1, v, u, 8, v, (x, y) => (y === y0 + 4 ? CHIS : CUT));
    // the hidden room, 14 blocks down
    const yb = -14;
    fill(6, yb - 1, 8, 14, -1, 16, SS);
    fill(8, yb + 1, 10, 12, yb + 3, 14, B.AIR);
    fill(10, yb + 4, 12, 10, -1, 12, B.AIR);           // the shaft
    for (const [u, v] of [[10, 9], [10, 15], [7, 12], [13, 12]]) { at(u, yb + 1, v, B.LOOT_CHEST); at(u, yb + 2, v, B.AIR); }
    for (const [u, v] of [[8, 10], [12, 10], [8, 14], [12, 14]]) fill(u, yb + 1, v, u, yb + 3, v, CHIS);
    at(10, yb + 1, 12, B.STONE_PRESSURE_PLATE);
    fill(9, yb - 1, 11, 11, yb - 1, 13, B.TNT);
    return b.done({ y: y0 });
  }

  // ---- Jungle temple ------------------------------------------------------------------------
  // Mossy cobblestone, three floors, vines, a lever puzzle and a trapped corridor.
  function jungleTemple(r, cx, cz) {
    const y0 = column(cx, cz).height;
    const x0 = cx - 6, z0 = cz - 7;
    const b = builder('jungle_temple', cx, cz);
    const stone = (x, y, z) => (hash3(seed ^ 0x61e, x, y, z) < 0.55 ? B.MOSSY_COBBLESTONE : B.COBBLESTONE);
    const fill = (u0, a, v0, u1, c, v1, id, mode) => b.fill(x0 + u0, y0 + a, z0 + v0, x0 + u1, y0 + c, z0 + v1, id, mode);
    const at = (u, y, v, id, mode) => b.set(x0 + u, y0 + y, z0 + v, id, mode);
    fill(0, -4, 0, 11, -4, 14, stone, OP.FILL_DOWN);
    fill(-1, 1, -1, 12, 14, 15, B.AIR);
    // basement, ground floor, upper floor, roof
    b.shell(x0, y0 - 4, z0, x0 + 11, y0, z0 + 14, stone);
    b.shell(x0, y0, z0, x0 + 11, y0 + 4, z0 + 14, stone);
    b.shell(x0 + 1, y0 + 4, z0 + 1, x0 + 10, y0 + 8, z0 + 13, stone);
    b.shell(x0 + 3, y0 + 8, z0 + 4, x0 + 8, y0 + 11, z0 + 10, stone);
    // doorway and windows
    fill(5, 1, 0, 6, 3, 0, B.AIR);
    for (let u = 4; u <= 7; u++) at(u, 0, -1, stairs('cobblestone_stairs', 'south'));
    for (const v of [3, 7, 11]) { fill(0, 2, v, 0, 2, v, B.AIR); fill(11, 2, v, 11, 2, v, B.AIR); fill(1, 6, v, 1, 6, v, B.AIR); fill(10, 6, v, 10, 6, v, B.AIR); }
    fill(5, 5, 1, 6, 6, 1, B.AIR);
    // ladders up and stairs down
    // a ladder up the side of a pillar to the upper floor, and stairs down to the basement
    for (let y = 1; y <= 3; y++) at(10, y, 11, stone(x0 + 10, y0 + y, z0 + 11));
    for (let y = 1; y <= 7; y++) at(9, y, 11, st('ladder', { facing: 'west' }));
    for (let k = 0; k < 4; k++) { at(2, -k, 4 + k, stairs('cobblestone_stairs', 'north')); fill(2, -k + 1, 4 + k, 2, 2, 4 + k, B.AIR); }
    // the lever puzzle (three levers by the wall) and the hidden chest behind it
    for (const u of [4, 5, 6]) at(u, -3, 13, B.LEVER);
    at(8, -3, 13, B.LOOT_CHEST);
    // a trapped corridor: two dispensers face down it
    fill(9, -3, 2, 10, -2, 9, B.AIR);
    at(10, -2, 1, st('dispenser', { facing: 'south' }));
    at(9, -3, 9, B.LOOT_CHEST);
    // vines on the outside
    for (let v = 0; v <= 14; v++) for (let y = 1; y <= 7; y++) {
      if (hash3(seed ^ 0x71e, x0 + v, y0 + y, z0) < 0.3) at(-1, y, v, st('vine', { facing: 'west' }));
      if (hash3(seed ^ 0x72e, x0 + v, y0 + y, z0) < 0.3) at(12, y, v, st('vine', { facing: 'east' }));
    }
    return b.done({ y: y0 });
  }

  // ---- Witch hut ----------------------------------------------------------------------------
  // A little spruce cabin on log stilts above the swamp, with a cauldron inside.
  function witchHut(r, cx, cz) {
    const ground = column(cx, cz).height;
    const y0 = Math.max(ground, S) + 3;
    const x0 = cx - 3, z0 = cz - 4;
    const b = builder('witch_hut', cx, cz);
    const SP = B.SPRUCE_PLANKS;
    const fill = (u0, a, v0, u1, c, v1, id, mode) => b.fill(x0 + u0, y0 + a, z0 + v0, x0 + u1, y0 + c, z0 + v1, id, mode);
    const at = (u, y, v, id, mode) => b.set(x0 + u, y0 + y, z0 + v, id, mode);
    for (const [u, v] of [[0, 0], [6, 0], [0, 8], [6, 8]]) for (let y = -1; y >= -12; y--) at(u, y, v, B.LOG, OP.IF_AIR);
    fill(0, 0, 0, 6, 0, 8, SP);
    fill(0, 1, 2, 6, 3, 8, (x, y, z) => ((x === x0 || x === x0 + 6) && (z === z0 + 2 || z === z0 + 8) ? B.LOG : SP));
    fill(1, 1, 3, 5, 3, 7, B.AIR);
    fill(3, 1, 2, 3, 2, 2, B.AIR);                      // doorway
    for (const v of [4, 6]) { at(0, 2, v, B.SPRUCE_FENCE); at(6, 2, v, B.SPRUCE_FENCE); }
    at(2, 2, 8, B.SPRUCE_FENCE); at(4, 2, 8, B.SPRUCE_FENCE);
    at(0, 1, 0, B.SPRUCE_FENCE); at(6, 1, 0, B.SPRUCE_FENCE);
    // roof: a ring of stairs around a flat top
    fill(0, 4, 1, 6, 4, 9, SP);
    for (let v = 0; v <= 10; v++) { at(-1, 4, v, stairs('spruce_stairs', 'east')); at(7, 4, v, stairs('spruce_stairs', 'west')); }
    for (let u = -1; u <= 7; u++) { at(u, 4, 0, stairs('spruce_stairs', 'south')); at(u, 4, 10, stairs('spruce_stairs', 'north')); }
    fill(1, 5, 2, 5, 5, 8, B.SPRUCE_SLAB ? st('spruce_slab', { half: 'bottom' }) : SP);
    // inside
    at(5, 1, 7, B.CAULDRON);
    at(1, 1, 7, B.CRAFTING_TABLE);
    at(1, 1, 3, B.FLOWER_POT);
    const out = b.done({ y: y0 });
    out.mobs = [['witch', cx, y0 + 1, cz + 1]];
    return out;
  }

  // ---- Igloo ---------------------------------------------------------------------------------
  // A snow dome with a bed and furnace inside. Half of them hide a trapdoor under the carpet:
  // a ladder goes down to a stone basement with a chest, a cauldron and two cells.
  function igloo(r, cx, cz) {
    const y0 = column(cx, cz).height;
    const b = builder('igloo', cx, cz);
    const at = (dx, dy, dz, id, mode) => b.set(cx + dx, y0 + dy, cz + dz, id, mode);
    for (let dy = 0; dy <= 5; dy++) for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) {
      const d = Math.hypot(dx, (dy - 0.5) * 1.15, dz);
      if (dy === 0 && d < 4.4) at(dx, 0, dz, B.SNOW);
      else if (d < 3.3) at(dx, dy, dz, B.AIR);
      else if (d < 4.4) at(dx, dy, dz, B.SNOW);
    }
    // entrance tunnel facing south
    for (let dz = 3; dz <= 5; dz++) for (let dy = 0; dy <= 3; dy++) for (let dx = -1; dx <= 1; dx++) at(dx, dy, dz, (dy === 0 || dy === 3 || dx !== 0) ? B.SNOW : B.AIR);
    at(0, 1, 3, B.AIR); at(0, 2, 3, B.AIR);
    at(-3, 2, 0, B.ICE); at(3, 2, 0, B.ICE);
    // furniture
    at(-1, 1, -2, st('red_bed', { part: 'foot', facing: 'north' })); at(-1, 1, -3, st('red_bed', { part: 'head', facing: 'north' }));
    at(2, 1, -1, B.FURNACE); at(2, 1, 0, B.CRAFTING_TABLE); at(-2, 1, 1, B.REDSTONE_TORCH);
    for (let dz = -1; dz <= 2; dz++) for (let dx = -2; dx <= 1; dx++) if (!(dx === -2 && dz === 1) && !(dx === -1 && dz <= -2)) at(dx, 1, dz, B.WHITE_CARPET);
    const out = { mobs: [] };
    if (r() < 0.5) {
      // the basement
      const yb = -9;
      const brick = (x, y, z) => { const h = hash3(seed ^ 0x1910, x, y, z); return h < 0.2 ? B.MOSSY_STONE_BRICKS : h < 0.35 ? B.CRACKED_STONE_BRICKS : B.STONE_BRICKS; };
      b.shell(cx - 4, y0 + yb, cz - 1, cx + 4, y0 + yb + 4, cz + 7, brick);
      at(0, 1, 0, B.AIR);
      at(0, 0, 0, st('oak_trapdoor', { half: 'top', open: false, facing: 'north' }));
      for (let dy = yb + 1; dy <= -1; dy++) { at(0, dy, 0, st('ladder', { facing: 'south' })); if (dy > yb + 4) at(0, dy, -1, B.STONE_BRICKS); }
      // two cells at the back, behind iron bars
      for (let dz = 4; dz <= 6; dz++) for (let dy = 1; dy <= 3; dy++) at(0, yb + dy, dz, B.STONE_BRICKS);
      for (const dx of [-3, -2, -1, 1, 2, 3]) for (let dy = 1; dy <= 2; dy++) at(dx, yb + dy, 3, B.IRON_BARS);
      for (const dx of [-3, -2, -1, 1, 2, 3]) at(dx, yb + 3, 3, B.STONE_BRICKS);
      at(3, yb + 1, 0, B.LOOT_CHEST); at(-3, yb + 1, 0, B.CAULDRON); at(-3, yb + 1, 1, B.CRAFTING_TABLE);
      at(-2, yb + 3, 0, st('wall_torch', { facing: 'south' })); at(2, yb + 3, 0, st('wall_torch', { facing: 'south' }));
      out.mobs = [['villager', cx - 2, y0 + yb + 1, cz + 5], ['zombie_villager', cx + 2, y0 + yb + 1, cz + 5]];
    }
    const res = b.done({ y: y0 });
    res.mobs = out.mobs;
    return res;
  }

  // ---- Mineshaft -------------------------------------------------------------------------------
  // Abandoned tunnels deep underground: a dirt-floored room in the middle, and corridors
  // branching out from it, held up by fence-and-plank frames. Some have old rails, some
  // have chests, and a few are full of cobwebs around a cave spider cage.
  function mineshaft(r, cx, cz) {
    const surface = column(cx, cz).height;
    const cy = 14 + Math.floor(r() * Math.min(28, Math.max(4, surface - 30)));
    if (cy > surface - 12) return null;
    const b = builder('mineshaft', cx, cz);
    const PL = B.PLANKS, FENCE = B.OAK_FENCE;
    // the central room
    b.fill(cx - 5, cy - 1, cz - 5, cx + 5, cy - 1, cz + 5, B.DIRT, OP.IF_AIR);
    b.fill(cx - 5, cy, cz - 5, cx + 5, cy + 3, cz + 5, B.AIR, OP.CARVE);
    let segments = 0;
    const queue = [];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (r() < 0.85) queue.push({ x: cx + dx * 6, y: cy, z: cz + dz * 6, dx, dz, depth: 0 });
    while (queue.length && segments < 44) {
      const c = queue.shift();
      if (Math.hypot(c.x - cx, c.z - cz) > 72 || c.y < 6) continue;
      segments++;
      const px = c.dz !== 0 ? 1 : 0, pz = c.dx !== 0 ? 1 : 0; // across the corridor
      const len = 8 + Math.floor(r() * 4) * 4;
      const rails = r() < 0.6, spiders = r() < 0.08;
      const railId = st('rail', { dir: c.dx !== 0 ? 'ew' : 'ns' });
      let x = c.x, y = c.y, z = c.z;
      // stop at the surface (column heights are cheap to look up)
      if (column(x + c.dx * len, z + c.dz * len).height - 8 < y) continue;
      for (let i = 0; i < len; i++) {
        for (let w = -1; w <= 1; w++) {
          const bx = x + px * w, bz = z + pz * w;
          b.set(bx, y - 1, bz, PL, OP.IF_AIR);
          for (let h = 0; h <= 2; h++) b.set(bx, y + h, bz, spiders && hash3(seed ^ 0xc0b, bx, y + h, bz) < 0.4 ? B.COBWEB
            : hash3(seed ^ 0xc0c, bx, y + h, bz) < 0.025 ? B.COBWEB : B.AIR, OP.CARVE);
        }
        if (i % 4 === 2) {
          // a support frame: two fence posts and a plank beam
          for (let h = 0; h <= 1; h++) { b.set(x - px, y + h, z - pz, FENCE); b.set(x + px, y + h, z + pz, FENCE); }
          for (let w = -1; w <= 1; w++) b.set(x + px * w, y + 2, z + pz * w, PL);
        } else if (hash3(seed ^ 0xc4e, x, y, z) < 0.03) {
          const side = hash2(seed ^ 0xc4f, x, z) < 0.5 ? -1 : 1;
          b.set(x + px * side, y, z + pz * side, B.LOOT_CHEST);
        } else if (hash3(seed ^ 0x7c4, x, y, z) < 0.04) {
          const side = hash2(seed ^ 0x7c5, x, z) < 0.5 ? -1 : 1;
          b.set(x + px * side, y, z + pz * side, B.TORCH);
        }
        if (rails && hash3(seed ^ 0x4a1, x, y, z) < 0.9 && i % 4 !== 2) b.set(x, y, z, railId);
        else if (rails && i % 4 === 2) b.set(x, y, z, railId);
        if (spiders && i === Math.floor(len / 2)) b.set(x, y, z, B.SPAWNER);
        x += c.dx; z += c.dz;
      }
      if (c.depth > 6) continue;
      // what's at the end: a crossing (branches both ways), a turn, stairs, or more corridor
      const roll = r();
      if (roll < 0.35) {
        b.fill(x - 2, y - 1, z - 2, x + 2, y - 1, z + 2, PL, OP.IF_AIR);
        b.fill(x - 2, y, z - 2, x + 2, y + 2, z + 2, B.AIR, OP.CARVE);
        for (const [dx, dz] of [[c.dx, c.dz], [px, pz], [-px, -pz]]) if (r() < 0.75) queue.push({ x: x + dx * 3, y, z: z + dz * 3, dx, dz, depth: c.depth + 1 });
      } else if (roll < 0.55) {
        const s = r() < 0.5 ? 1 : -1;
        b.fill(x - 1, y - 1, z - 1, x + 1, y - 1, z + 1, PL, OP.IF_AIR);
        b.fill(x - 1, y, z - 1, x + 1, y + 2, z + 1, B.AIR, OP.CARVE);
        queue.push({ x: x + px * s * 2, y, z: z + pz * s * 2, dx: px * s, dz: pz * s, depth: c.depth + 1 });
      } else if (roll < 0.75) {
        // a staircase up or down four blocks
        const dy = r() < 0.5 ? 1 : -1;
        for (let i = 0; i < 4; i++) {
          y += dy;
          for (let w = -1; w <= 1; w++) {
            const bx = x + px * w, bz = z + pz * w;
            b.set(bx, y - 1, bz, PL, OP.IF_AIR);
            for (let h = 0; h <= 3; h++) b.set(bx, y + h - (dy < 0 ? 0 : 1), bz, B.AIR, OP.CARVE);
          }
          x += c.dx; z += c.dz;
        }
        queue.push({ x, y, z, dx: c.dx, dz: c.dz, depth: c.depth + 1 });
      } else {
        queue.push({ x, y, z, dx: c.dx, dz: c.dz, depth: c.depth + 1 });
      }
    }
    return b.done({ y: cy });
  }

  // ---- Ocean monument --------------------------------------------------------------------------
  // A great prismarine temple on the floor of the deep ocean: two wing towers, a long main
  // hall with a tower on top, a core of gold blocks, and a room hung with sponges.
  // Guardians patrol around it; three elder guardians live inside.
  function monument(r, cx, cz) {
    const y0 = S - 24;
    const x0 = cx - 29, z0 = cz - 29;
    const b = builder('monument', cx, cz);
    const P = B.PRISMARINE, PB = B.PRISMARINE_BRICKS, DP = B.DARK_PRISMARINE, W = B.WATER, L = B.SEA_LANTERN;
    const fill = (u0, a, v0, u1, c, v1, id, mode) => b.fill(x0 + u0, y0 + a, z0 + v0, x0 + u1, y0 + c, z0 + v1, id, mode);
    const shell = (u0, a, v0, u1, c, v1, wall, inside = W) => b.shell(x0 + u0, y0 + a, z0 + v0, x0 + u1, y0 + c, z0 + v1, wall, inside);
    // trim: dark bands every four blocks up the walls
    const walls = (x, y, z) => ((y - y0) % 4 === 0 ? DP : (x + z) % 7 === 0 ? PB : P);
    fill(0, -1, 0, 57, -1, 57, P, OP.FILL_DOWN);
    fill(0, 0, 0, 57, 0, 57, PB);
    fill(0, 1, 0, 57, 22, 57, W);
    // wing towers at the front corners, side halls running back from them
    shell(0, 0, 0, 13, 14, 13, walls); shell(44, 0, 0, 57, 14, 13, walls);
    shell(0, 0, 13, 9, 8, 57, walls); shell(48, 0, 13, 57, 8, 57, walls);
    // the main hall, the upper hall on top of it, and the top tower
    shell(10, 0, 20, 47, 12, 57, walls);
    shell(18, 12, 28, 39, 18, 49, walls);
    shell(25, 18, 35, 32, 22, 42, walls);
    fill(28, 22, 38, 29, 22, 39, L);
    // the entrance hall in front, between the wings
    shell(20, 0, 10, 37, 8, 20, walls);
    fill(26, 1, 10, 31, 5, 10, W); fill(26, 1, 20, 31, 5, 20, W);
    // openings between the parts
    for (const [u0, v0, u1, v1] of [[13, 4, 13, 8], [44, 4, 44, 8], [9, 30, 10, 34], [47, 30, 48, 34], [5, 13, 7, 13], [50, 13, 52, 13], [20, 14, 20, 16], [37, 14, 37, 16]]) fill(u0, 1, v0, u1, 4, v1, W);
    fill(27, 12, 36, 30, 12, 39, W); fill(27, 18, 37, 30, 18, 40, W);
    // pillars and lanterns in the main hall
    for (let u = 14; u <= 43; u += 7) for (let v = 24; v <= 53; v += 7) {
      if (u > 22 && u < 36 && v > 32 && v < 46) continue;
      fill(u, 1, v, u, 11, v, (x, y) => ((y - y0) % 4 === 0 ? DP : PB));
      fill(u, 11, v, u, 11, v, L);
    }
    for (const [u, v] of [[3, 3], [10, 3], [3, 10], [10, 10], [47, 3], [54, 3], [47, 10], [54, 10]]) fill(u, 13, v, u, 13, v, L);
    // the gold core
    shell(26, 0, 36, 31, 6, 41, DP);
    fill(28, 2, 38, 29, 3, 39, B.GOLD_BLOCK);
    fill(28, 1, 36, 29, 2, 36, W);
    // the sponge room, high in the left wing
    for (let u = 2; u <= 11; u++) for (let v = 2; v <= 11; v++) if (hash2(seed ^ 0x5b0, x0 + u, z0 + v) < 0.35) fill(u, 13, v, u, 13, v, B.SPONGE);
    const out = b.done({ y: y0 });
    out.mobs = [['elder_guardian', x0 + 7, y0 + 5, z0 + 7], ['elder_guardian', x0 + 50, y0 + 5, z0 + 7], ['elder_guardian', x0 + 28, y0 + 14, z0 + 44]];
    return out;
  }

  // ---- Woodland mansion -------------------------------------------------------------------------
  // A huge dark oak house in the dark forest: three floors of rooms off long corridors,
  // grand stairs, a steep roof, and vindicators and evokers living inside.
  function mansion(r, cx, cz) {
    const W = 32, D = 20;
    const x0 = cx - W / 2, z0 = cz - D / 2;
    let y0 = 0;
    for (const [u, v] of [[0, 0], [W - 1, 0], [0, D - 1], [W - 1, D - 1], [W / 2, D / 2]]) y0 = Math.max(y0, column(x0 + u, z0 + v).height);
    const b = builder('mansion', cx, cz);
    const PL = B.DARK_OAK_PLANKS, LOG = B.DARK_OAK_LOG, FLOOR = B.BIRCH_PLANKS, COB = B.COBBLESTONE;
    const fill = (u0, a, v0, u1, c, v1, id, mode) => b.fill(x0 + u0, y0 + a, z0 + v0, x0 + u1, y0 + c, z0 + v1, id, mode);
    const at = (u, y, v, id, mode) => b.set(x0 + u, y0 + y, z0 + v, id, mode);
    const PILLAR_U = new Set([0, 6, 12, 19, 25, 31]), PILLAR_V = new Set([0, 8, 12, 19]);
    // clear the ground (trees!) and lay a cobblestone foundation
    fill(-3, 1, -3, W + 2, 30, D + 2, B.AIR);
    fill(-1, 0, -1, W, 0, D, COB, OP.FILL_DOWN);
    const FLOORS = [0, 6, 12];
    // outer walls
    for (let y = 1; y <= 17; y++) for (let v = 0; v < D; v++) for (let u = 0; u < W; u++) {
      if (u !== 0 && u !== W - 1 && v !== 0 && v !== D - 1) continue;
      const level = FLOORS.includes(y) || y === 17;
      const pillar = (u === 0 || u === W - 1) ? PILLAR_V.has(v) : PILLAR_U.has(u);
      at(u, y, v, pillar ? LOG : level ? st('dark_oak_log', { axis: u === 0 || u === W - 1 ? 'z' : 'x' }) : PL);
    }
    // windows on every floor, between the pillars
    for (const f of FLOORS) {
      for (let u = 1; u < W - 1; u++) if (!PILLAR_U.has(u) && !PILLAR_U.has(u - 1) && !PILLAR_U.has(u + 1)) for (const y of [f + 2, f + 3]) { at(u, y, 0, B.GLASS_PANE); at(u, y, D - 1, B.GLASS_PANE); }
      for (let v = 1; v < D - 1; v++) if (!PILLAR_V.has(v) && !PILLAR_V.has(v - 1) && !PILLAR_V.has(v + 1)) for (const y of [f + 2, f + 3]) { at(0, y, v, B.GLASS_PANE); at(W - 1, y, v, B.GLASS_PANE); }
    }
    // floors
    for (const f of FLOORS) fill(1, f, 1, W - 2, f, D - 2, f === 0 ? FLOOR : FLOOR);
    fill(1, 18, 1, W - 2, 18, D - 2, PL);
    // the front door
    for (const u of [15, 16]) {
      at(u, 1, 0, st('dark_oak_door', { half: 'lower', open: false, facing: 'south' }));
      at(u, 2, 0, st('dark_oak_door', { half: 'upper', open: false, facing: 'south' }));
      at(u, 0, -1, COB); at(u, 0, -2, stairs('cobblestone_stairs', 'south'));
    }
    at(14, 3, -1, st('wall_torch', { facing: 'north' })); at(17, 3, -1, st('wall_torch', { facing: 'north' }));
    // rooms: front rooms v 1..7, corridor v 9..11, back rooms v 13..18
    const ROOM_U = [[1, 5], [7, 11], [20, 24], [26, 30]];
    const KINDS = ['bedroom', 'library', 'storage', 'dining', 'wool', 'flowers', 'bedroom', 'library'];
    const mobs = [];
    FLOORS.forEach((f, level) => {
      const wall = (u0, v0, u1, v1) => fill(u0, f + 1, v0, u1, f + 5, v1, PL);
      wall(1, 8, W - 2, 8); wall(1, 12, W - 2, 12);       // corridor walls
      for (const u of [6, 12, 19, 25]) { wall(u, 1, u, 7); wall(u, 13, u, D - 2); }
      if (level === 0) { fill(13, 1, 8, 18, 5, 8, B.AIR); }  // the foyer opens onto the corridor
      // a red carpet runner and torches down the corridor
      fill(2, f + 1, 10, W - 3, f + 1, 10, B.RED_CARPET);
      for (let u = 3; u < W - 2; u += 6) { at(u, f + 3, 9, st('wall_torch', { facing: 'south' })); at(u, f + 3, 11, st('wall_torch', { facing: 'north' })); }
      // the middle back room on each floor
      const rooms = [...ROOM_U.map(([a, c]) => [a, 1, c, 7, 'north']), ...ROOM_U.map(([a, c]) => [a, 13, c, D - 2, 'south']), [13, 13, 18, D - 2, 'south']];
      if (level > 0) rooms.push([13, 1, 18, 7, 'north', 'gallery']);   // the stairs come up here
      for (const [u0, v0, u1, v1, side, fixed] of rooms) {
        const kind = fixed || KINDS[Math.floor(hash3(seed ^ 0x3a2, x0 + u0, f, z0 + v0) * KINDS.length)];
        // a door from the corridor
        const du = Math.floor((u0 + u1) / 2), dv = side === 'north' ? 8 : 12;
        at(du, f + 1, dv, st('dark_oak_door', { half: 'lower', open: false, facing: side }));
        at(du, f + 2, dv, st('dark_oak_door', { half: 'upper', open: false, facing: side }));
        const back = side === 'north' ? v0 : v1, front = side === 'north' ? v1 : v0;
        furnish(kind, u0, v0, u1, v1, f, back, front, side, du);
        if (hash3(seed ^ 0x3a3, x0 + u0, f, z0 + v0) < 0.35) mobs.push([level === 2 && mobs.length % 3 === 0 ? 'evoker' : 'vindicator', x0 + du, y0 + f + 1, z0 + Math.floor((v0 + v1) / 2)]);
      }
      mobs.push(['vindicator', x0 + 8 + level * 7, y0 + f + 1, z0 + 10]);
      if (level === 2) mobs.push(['evoker', x0 + 22, y0 + f + 1, z0 + 10]);
    });
    // grand stairs: ground floor up to the first floor in the foyer, then on up to the top
    for (let i = 0; i < 6; i++) {
      for (const v of [6, 7]) {
        at(13 + i, 1 + i, v, stairs('dark_oak_stairs', 'east'));
        fill(13 + i, 1, v, 13 + i, i, v, PL);
      }
      for (const v of [1, 2]) {
        at(13 + i, 7 + i, v, stairs('dark_oak_stairs', 'east'));
        fill(13 + i, 7, v, 13 + i, 6 + i, v, PL);
      }
    }
    fill(13, 6, 6, 17, 6, 7, B.AIR); fill(13, 12, 1, 17, 12, 2, B.AIR);
    fill(13, 7, 6, 18, 7, 7, B.AIR); fill(13, 13, 1, 18, 13, 2, B.AIR);
    // a steep roof of stairs over the whole house, with the gable ends filled in
    for (let k = 0; ; k++) {
      const vf = k - 1, vb = D - k;
      if (vf > vb) break;
      for (let u = -1; u <= W; u++) {
        if (vf === vb) at(u, 18 + k, vf, st('dark_oak_slab', { half: 'bottom' }));
        else { at(u, 18 + k, vf, stairs('dark_oak_stairs', 'south')); at(u, 18 + k, vb, stairs('dark_oak_stairs', 'north')); }
      }
      for (let v = vf + 1; v < vb; v++) { at(0, 18 + k, v, PL); at(W - 1, 18 + k, v, PL); }
    }
    const out = b.done({ y: y0 });
    out.mobs = mobs;
    return out;

    function furnish(kind, u0, v0, u1, v1, f, back, front, side, du) {
      const y = f + 1;
      const inward = side === 'north' ? 'south' : 'north'; // from the back wall into the room
      const carpet = { bedroom: B.LIGHT_BLUE_CARPET, library: B.BROWN_CARPET, storage: B.GRAY_CARPET, dining: B.RED_CARPET, wool: null, flowers: B.LIME_CARPET, gallery: B.RED_CARPET }[kind];
      if (carpet) fill(u0, y, v0, u1, y, v1, carpet);
      fill(du, y, front, du, y, front, B.AIR);
      if (kind === 'gallery') return;
      if (kind === 'bedroom') {
        const bv = side === 'north' ? back + 1 : back - 1;
        at(u0 + 1, y, bv, st('white_bed', { part: 'foot', facing: OPPOSITE[inward] })); at(u0 + 1, y, back, st('white_bed', { part: 'head', facing: OPPOSITE[inward] }));
        at(u1 - 1, y, back, B.LOOT_CHEST);
        at(u1, y + 2, back, B.AIR);
      } else if (kind === 'library') {
        for (let u = u0; u <= u1; u++) for (let h = 0; h < 3; h++) at(u, y + h, back, B.BOOKSHELF);
        at(u0, y, front === v0 ? v0 + 1 : v1 - 1, B.CRAFTING_TABLE);
      } else if (kind === 'storage') {
        at(u0, y, back, B.LOOT_CHEST); at(u0 + 1, y, back, B.LOOT_CHEST); at(u1, y, back, B.FURNACE); at(u1 - 1, y, back, B.CRAFTING_TABLE);
      } else if (kind === 'dining') {
        const mv = Math.floor((v0 + v1) / 2);
        for (let u = u0 + 1; u <= u1 - 1; u++) { at(u, y, mv, B.DARK_OAK_FENCE); at(u, y + 1, mv, B.WHITE_CARPET); }
        at(u0, y, mv, stairs('dark_oak_stairs', 'west')); at(u1, y, mv, stairs('dark_oak_stairs', 'east'));
      } else if (kind === 'wool') {
        for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) at(u, f, v, (u + v) % 2 ? B.WHITE_WOOL : B.BLACK_WOOL);
      } else {
        for (let u = u0; u <= u1; u += 2) at(u, y, back, B.FLOWER_POT);
        at(u0, y + 2, back, st('wall_torch', { facing: inward }));
      }
    }
  }

  // ---- Where structures go -------------------------------------------------------------------
  const KINDS = {
    mineshaft: { region: 176, chance: 0.45, salt: 0x3a11e, plan: mineshaft, reach: 110, biomes: null },
    desert_temple: { region: 352, chance: 0.6, salt: 0xde5e7, plan: desertTemple, reach: 14, biomes: [BIOME.DESERT] },
    jungle_temple: { region: 352, chance: 0.6, salt: 0x1a6e1, plan: jungleTemple, reach: 12, biomes: [BIOME.JUNGLE, BIOME.JUNGLE_EDGE] },
    witch_hut: { region: 288, chance: 0.7, salt: 0x3177c, plan: witchHut, reach: 8, biomes: [BIOME.SWAMP] },
    igloo: { region: 288, chance: 0.6, salt: 0x1e100, plan: igloo, reach: 8, biomes: [BIOME.SNOWY_TUNDRA, BIOME.SNOWY_TAIGA] },
    monument: { region: 416, chance: 0.6, salt: 0x30e4, plan: monument, reach: 32, biomes: [BIOME.DEEP_OCEAN] },
    mansion: { region: 896, chance: 0.9, salt: 0x3a4510, plan: mansion, reach: 22, biomes: [BIOME.DARK_FOREST] },
  };
  const cache = new Map();

  function planIn(kind, rx, rz) {
    const key = `${kind}:${rx},${rz}`;
    if (cache.has(key)) return cache.get(key);
    const k = KINDS[kind];
    const r = mulberry32((hash2(seed ^ k.salt, rx, rz) * 4294967296) >>> 0);
    let plan = null;
    if (r() < k.chance) {
      const margin = Math.min(k.reach + 8, k.region / 4);
      // a few tries to find the right biome somewhere in the region
      for (let tries = 0; tries < (k.biomes ? 6 : 1) && !plan; tries++) {
        const x = rx * k.region + margin + Math.floor(r() * (k.region - margin * 2));
        const z = rz * k.region + margin + Math.floor(r() * (k.region - margin * 2));
        const col = column(x, z);
        if (k.biomes && !k.biomes.includes(col.biome)) continue;
        if (kind === 'monument' && col.height > S - 14) continue;
        if (kind !== 'monument' && kind !== 'mineshaft' && kind !== 'witch_hut' && col.height <= S) continue;
        plan = k.plan(r, x, z);
      }
    }
    cache.set(key, plan);
    if (cache.size > 160) cache.delete(cache.keys().next().value);
    return plan;
  }

  function* inBox(minX, minZ, maxX, maxZ) {
    for (const kind of Object.keys(KINDS)) {
      const k = KINDS[kind];
      for (let rz = Math.floor((minZ - k.reach) / k.region); rz <= Math.floor((maxZ + k.reach) / k.region); rz++) {
        for (let rx = Math.floor((minX - k.reach) / k.region); rx <= Math.floor((maxX + k.reach) / k.region); rx++) {
          const p = planIn(kind, rx, rz);
          if (p && p.maxX >= minX && p.minX <= maxX && p.maxZ >= minZ && p.minZ <= maxZ) yield p;
        }
      }
    }
  }

  return {
    /** The block operations of every structure that reaches into chunk (cx, cz). */
    opsForChunk(cx, cz) {
      const out = [];
      const key = `${cx},${cz}`;
      for (const p of inBox(cx * CS, cz * CS, cx * CS + CS - 1, cz * CS + CS - 1)) { const l = p.byChunk.get(key); if (l) out.push(l); }
      return out;
    },
    /** Structures within `r` blocks of (x, z): {kind, id, x, y, z, mobs}. */
    near(x, z, r) {
      return [...inBox(x - r, z - r, x + r, z + r)].map(p => ({ kind: p.kind, id: p.id, x: p.x, y: p.y, z: p.z, mobs: p.mobs }));
    },
    /** The nearest structure of one kind to (x, z), searching outward ring by ring: {x, y, z} or null. */
    locate(kind, x, z, maxDist = 4000) {
      const k = KINDS[kind];
      if (!k) return null;
      const rx0 = Math.floor(x / k.region), rz0 = Math.floor(z / k.region);
      let best = null, bd = Infinity;
      for (let ring = 0; ring <= Math.ceil(maxDist / k.region); ring++) {
        if (best && bd < (ring - 1) * k.region) break; // anything in this ring or beyond is farther
        for (let rz = rz0 - ring; rz <= rz0 + ring; rz++) for (let rx = rx0 - ring; rx <= rx0 + ring; rx++) {
          if (Math.max(Math.abs(rx - rx0), Math.abs(rz - rz0)) !== ring) continue;
          const p = planIn(kind, rx, rz);
          if (!p) continue;
          const d = Math.hypot(p.x - x, p.z - z);
          if (d < bd) { bd = d; best = p; }
        }
      }
      return best && bd <= maxDist ? { x: best.x, y: best.y, z: best.z } : null;
    },
    kinds: Object.keys(KINDS),
    /** Which kind of structure is the block (x, y, z) part of, or null. */
    at(x, y, z) {
      for (const p of inBox(x, z, x, z)) if (y >= p.minY && y <= p.maxY) return p.kind;
      return null;
    },
  };
}
