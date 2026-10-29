// ============================================================================
// Procedural terrain generator.
//
// Given a seed and a chunk coordinate this returns the chunk's blocks. It is a
// *pure function* of (seed, cx, cz): the browser workers and the server both
// generate any chunk and get exactly the same result, so the network only
// needs to carry player edits, never whole chunks.
//
// Pipeline for each chunk:
//   1. Climate: smooth noise fields for continentalness (ocean vs land),
//      erosion (flat vs mountainous), temperature, humidity, "weirdness"
//      (rare variants) and rivers. Height AND biome are both computed from
//      these same continuous fields, so biome borders never create cliffs.
//   2. Fill: bedrock -> stone -> biome filler -> biome surface -> water/ice.
//   3. Caves: noise "spaghetti" tunnels, plus random-walk "worm" tunnels,
//      rooms and ravines (Minecraft-style carvers). Lava fills cave floors
//      below y=10.
//   4. Ores and stone variants (granite, diorite, andesite) as random veins.
//   5. Trees and large features (huge mushrooms, ice spikes) per biome.
//   6. Small plants per biome.
//   7. Villages.
// Structures that cross chunk borders (trees, caves, villages) are planned
// from their own deterministic seed, and each chunk draws the part inside it.
// ============================================================================
import { CHUNK_SIZE as CS, CHUNK_HEIGHT as CH, SEA_LEVEL } from './config.js';
import { B, IS_SOLID, IS_LIQUID, SHAPE } from './blocks.js';
import { BIOME_LIST, BIOME, BIOME_NAMES } from './biomes.js';
import { Simplex, hashSeed, hash2, hash3, mulberry32 } from './noise.js';

export { BIOME_NAMES };
const LAYER = CS * CS;
const S = SEA_LEVEL;

const CAVE_STEP_XZ = 4;
const CAVE_STEP_Y = 4;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
/** 1 inside [a, b], fading to 0 over `soft` outside it. */
function band(x, a, b, soft) { return smoothstep(a - soft, a + soft, x) * (1 - smoothstep(b - soft, b + soft, x)); }
const seedOf = (r) => (r() * 4294967296) >>> 0;

// Blocks that grass, trees and plants can grow on.
const SOIL = new Set([B.GRASS, B.DIRT, B.PODZOL, B.SNOWY_GRASS, B.COARSE_DIRT, B.MYCELIUM]);
// Blocks a structure may overwrite when it only fills empty space.
const SOFT = new Uint8Array(256);
for (const id of [B.AIR, B.TALL_GRASS, B.FERN, B.LEAVES, B.SPRUCE_LEAVES, B.BIRCH_LEAVES, B.JUNGLE_LEAVES, B.ACACIA_LEAVES,
  B.DARK_OAK_LEAVES, B.DEAD_BUSH, B.SNOW]) SOFT[id] = 1;
for (let i = 0; i < 256; i++) if (SHAPE[i] === 1 || SHAPE[i] === 3) SOFT[i] = 1;

export function createGenerator(seedInput) {
  const seed = hashSeed(seedInput);
  const n = (k) => new Simplex((seed + k * 7919) >>> 0);
  const nContinent = n(1), nErosion = n(2), nTemp = n(3), nHum = n(4), nWeird = n(5);
  const nRiver = n(6), nDetail = n(7), nMush = n(8), nSurface = n(9);
  const nCaveA = n(10), nCaveB = n(11), nCavern = n(12);

  // Badlands terracotta stripes: a fixed random colour per height, per world.
  const bandRand = mulberry32(seed ^ 0xba7d);
  const BAND_CHOICES = [B.TERRACOTTA, B.TERRACOTTA, B.ORANGE_TERRACOTTA, B.ORANGE_TERRACOTTA, B.YELLOW_TERRACOTTA,
    B.WHITE_TERRACOTTA, B.RED_TERRACOTTA, B.BROWN_TERRACOTTA, B.LIGHT_GRAY_TERRACOTTA, B.TERRACOTTA];
  const BANDS = new Uint8Array(CH);
  for (let y = 0; y < CH; y++) BANDS[y] = BAND_CHOICES[Math.floor(bandRand() * BAND_CHOICES.length)];

  // ---- 1. Climate -> height + biome ---------------------------------------
  /** Everything about one column. Cheap enough to call for neighbour chunks. */
  function column(x, z) {
    const C = nContinent.fbm2(x / 900, z / 900, 4);   // continentalness
    const E = nErosion.fbm2(x / 520, z / 520, 3);     // high = mountainous
    const T = nTemp.fbm2(x / 1100, z / 1100, 3);      // temperature
    const H = nHum.fbm2(x / 900, z / 900, 3);         // humidity
    const W = nWeird.fbm2(x / 350, z / 350, 2);       // picks rare variants
    const R = nRiver.fbm2(x / 750, z / 750, 4);       // rivers follow R = 0
    const D = nDetail.fbm2(x / 110, z / 110, 4);      // local hills
    const M = nMush.noise2(x / 280, z / 280);         // mushroom islands

    const land = smoothstep(-0.3, -0.18, C);
    const hilly = smoothstep(0.08, 0.45, E);
    const oceanH = S - 7 - smoothstep(-0.34, -0.5, C) * 20 + D * 3;
    let landH = S + 3 + (C + 0.18) * 10 + D * (4 + hilly * hilly * 46) + hilly * 8;
    // Swamps: warm-ish, wet and flat -> squash to just above sea level.
    const swampW = smoothstep(0.24, 0.38, H) * band(T, -0.1, 0.2, 0.06) * (1 - hilly);
    landH = lerp(landH, S + 0.7 + D * 1.5, swampW * 0.9);
    // Plateaus (mesa, savanna plateau): hot and "weird" -> stepped table land.
    const plateauW = smoothstep(0.17, 0.3, T) * smoothstep(0.2, 0.4, W) * (1 - hilly);
    const pt = (S + 18 + D * 10) / 7;
    const terraced = (Math.floor(pt) + smoothstep(0.6, 1, pt - Math.floor(pt))) * 7;
    landH = lerp(landH, terraced, plateauW);
    let h = lerp(oceanH, landH, land);
    // Mushroom islands rise out of deep ocean.
    const mushW = smoothstep(0.55, 0.68, M) * (1 - smoothstep(-0.42, -0.36, C));
    h = lerp(h, S + 3 + D * 5, mushW);
    // Rivers cut channels where the river noise crosses zero.
    const riverW = (1 - smoothstep(0.012, 0.04, Math.abs(R))) * land * (1 - mushW) * (1 - plateauW * 0.6);
    if (h > S - 3) h = lerp(h, S - 3, riverW);
    const height = Math.floor(clamp(h, 4, CH - 24));

    // ---- Biome from the same fields ----
    let biome;
    const frozen = T < -0.33;
    if (mushW > 0.5 && height >= S - 2) biome = BIOME.MUSHROOM_FIELDS;
    else if (height < S - 1 && riverW < 0.5) biome = frozen ? BIOME.FROZEN_OCEAN : C < -0.42 ? BIOME.DEEP_OCEAN : BIOME.OCEAN;
    else if (riverW > 0.55) biome = frozen ? BIOME.FROZEN_RIVER : BIOME.RIVER;
    else if (height <= S + 2 && land < 0.9 && swampW < 0.5) biome = frozen ? BIOME.SNOWY_BEACH : hilly > 0.4 ? BIOME.STONE_BEACH : BIOME.BEACH;
    else if (frozen) {
      if (hilly > 0.55) biome = BIOME.MOUNTAINS;
      else if (W > 0.32 && H < 0.1) biome = BIOME.ICE_SPIKES;
      else biome = H > 0.0 ? BIOME.SNOWY_TAIGA : BIOME.SNOWY_TUNDRA;
    } else if (T < -0.12) {
      if (hilly > 0.55) biome = H > 0 ? BIOME.WOODED_MOUNTAINS : BIOME.MOUNTAINS;
      else biome = H > 0.2 ? BIOME.GIANT_TREE_TAIGA : BIOME.TAIGA;
    } else if (T < 0.2) {
      if (hilly > 0.6) biome = H > 0.05 ? BIOME.WOODED_MOUNTAINS : BIOME.MOUNTAINS;
      else if (swampW > 0.5) biome = BIOME.SWAMP;
      else if (H > 0.19) biome = BIOME.DARK_FOREST;
      else if (H > -0.1) biome = W > 0.3 ? BIOME.FLOWER_FOREST : W < -0.3 ? BIOME.BIRCH_FOREST : BIOME.FOREST;
      else biome = W > 0.3 ? BIOME.SUNFLOWER_PLAINS : BIOME.PLAINS;
    } else if (T < 0.36) {
      if (plateauW > 0.5) biome = BIOME.SAVANNA_PLATEAU;
      else if (H > 0.15) biome = BIOME.JUNGLE;
      else if (H > 0.05) biome = BIOME.JUNGLE_EDGE;
      else biome = BIOME.SAVANNA;
    } else {
      if (plateauW > 0.5) biome = BIOME.BADLANDS_PLATEAU;
      else if (W > 0.15) biome = BIOME.BADLANDS;
      else if (H > 0.25) biome = BIOME.JUNGLE;
      else biome = BIOME.DESERT;
    }
    return { height, biome, hilly };
  }

  // ---- Noise caves (spaghetti tunnels + deep caverns) ----------------------
  function caveSample(x, y, z) {
    const a = nCaveA.noise3(x / 48, y / 32, z / 48);
    const b = nCaveB.noise3(x / 48, y / 32, z / 48);
    let v = a * a + b * b;
    const cav = nCavern.noise3(x / 70, y / 40, z / 70);
    if (y < 40) v = Math.min(v, (0.75 - cav) * 0.08);
    return v;
  }
  const CAVE_THRESHOLD = 0.012;
  function trilerp(c000, c100, c010, c110, c001, c101, c011, c111, fx, fy, fz) {
    const x00 = lerp(c000, c100, fx), x10 = lerp(c010, c110, fx);
    const x01 = lerp(c001, c101, fx), x11 = lerp(c011, c111, fx);
    return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
  }
  /** Interpolated cave value at one block, bit-identical to the per-chunk grid. */
  function caveAt(x, y, z) {
    const gx = Math.floor(x / CAVE_STEP_XZ) * CAVE_STEP_XZ;
    const gy = Math.floor(y / CAVE_STEP_Y) * CAVE_STEP_Y;
    const gz = Math.floor(z / CAVE_STEP_XZ) * CAVE_STEP_XZ;
    const sx = CAVE_STEP_XZ, sy = CAVE_STEP_Y;
    return trilerp(caveSample(gx, gy, gz), caveSample(gx + sx, gy, gz), caveSample(gx, gy + sy, gz), caveSample(gx + sx, gy + sy, gz),
      caveSample(gx, gy, gz + sx), caveSample(gx + sx, gy, gz + sx), caveSample(gx, gy + sy, gz + sx), caveSample(gx + sx, gy + sy, gz + sx),
      (x - gx) / sx, (y - gy) / sy, (z - gz) / sx);
  }
  function caveAllowed(y, height) {
    if (y < 3 || y > height) return false;
    if (height <= S + 2 && y > height - 5) return false; // keep a crust under water
    return true;
  }
  function isCave(x, y, z, height) {
    return caveAllowed(y, height) && caveAt(x, y, z) < CAVE_THRESHOLD;
  }

  // ---- Worm caves and ravines (carvers) ---------------------------------------
  // Every chunk within CARVE_RANGE may start cave systems. A cave is a random
  // walk ("worm") that carves an ellipsoid at each step. The walk is fully
  // determined by its start chunk, so neighbouring chunks agree on where it goes.
  const CARVE_RANGE = 7;
  function carveWorms(blocks, cx, cz, heights) {
    const ox = cx * CS, oz = cz * CS;
    const carve = (x, y, z, rad, vrad) => {
      const lx = x - ox, lz = z - oz;
      if (lx + rad < 0 || lx - rad >= CS || lz + rad < 0 || lz - rad >= CS) return;
      const x0 = Math.max(0, Math.floor(lx - rad)), x1 = Math.min(CS - 1, Math.floor(lx + rad));
      const z0 = Math.max(0, Math.floor(lz - rad)), z1 = Math.min(CS - 1, Math.floor(lz + rad));
      const y0 = Math.max(1, Math.floor(y - vrad)), y1 = Math.min(CH - 2, Math.floor(y + vrad));
      for (let bz = z0; bz <= z1; bz++) {
        const dz = (bz + 0.5 - lz) / rad;
        for (let bx = x0; bx <= x1; bx++) {
          const dx = (bx + 0.5 - lx) / rad;
          if (dx * dx + dz * dz >= 1) continue;
          const height = heights[bx + bz * CS];
          for (let by = y1; by >= y0; by--) {
            const dy = (by + 0.5 - y) / vrad;
            if (dx * dx + dy * dy + dz * dz >= 1) continue;
            if (height <= S + 2 && by > height - 5) continue;
            const i = bx + bz * CS + by * LAYER;
            const id = blocks[i];
            if (id === B.BEDROCK || IS_LIQUID[id] || id === B.ICE) continue;
            const above = by + 1 < CH ? blocks[i + LAYER] : 0;
            if (IS_LIQUID[above] && above !== B.LAVA) continue; // don't drain oceans/rivers
            blocks[i] = by <= 10 ? B.LAVA : B.AIR;
          }
        }
      }
    };
    const worm = (wseed, x, y, z, yaw, pitch, width, len, branch, ravine) => {
      const r = mulberry32(wseed);
      let yawV = 0, pitchV = 0;
      const branchAt = branch ? Math.floor(len / 4 + r() * len / 2) : -1;
      for (let i = 0; i < len; i++) {
        const rad = 1.5 + Math.sin((i * Math.PI) / len) * width;
        const vrad = ravine ? rad * 3 : rad * 0.8;
        const cp = Math.cos(pitch);
        x += Math.cos(yaw) * cp; z += Math.sin(yaw) * cp; y += Math.sin(pitch);
        pitch *= ravine ? 0.7 : 0.92;
        pitch += pitchV * 0.1; yaw += yawV * 0.1;
        pitchV = pitchV * (ravine ? 0.8 : 0.9) + (r() - r()) * r() * 2;
        yawV = yawV * 0.75 + (r() - r()) * r() * 4;
        if (i === branchAt && width > 1) {
          worm(seedOf(r), x, y, z, yaw - Math.PI / 2, pitch / 3, width * 0.7, len - i, false, false);
          worm(seedOf(r), x, y, z, yaw + Math.PI / 2, pitch / 3, width * 0.7, len - i, false, false);
          return;
        }
        if (r() < 0.25 && !ravine) continue;
        carve(x, y, z, rad, vrad);
      }
    };
    for (let sz = cz - CARVE_RANGE; sz <= cz + CARVE_RANGE; sz++) {
      for (let sx = cx - CARVE_RANGE; sx <= cx + CARVE_RANGE; sx++) {
        const r = mulberry32((hash2(seed ^ 0xc4e5, sx, sz) * 4294967296) >>> 0);
        if (r() < 0.2) {
          const systems = 1 + Math.floor(r() * r() * 3);
          for (let s = 0; s < systems; s++) {
            const x = sx * CS + r() * CS, z = sz * CS + r() * CS;
            const y = 12 + r() * (r() * 52);
            let tunnels = 1;
            if (r() < 0.25) { carve(x, y, z, 3 + r() * 4, 2.5 + r() * 2); tunnels += Math.floor(r() * 3); }
            for (let t = 0; t < tunnels; t++) {
              const width = 0.8 + r() * r() * (r() < 0.1 ? 4 : 2);
              worm(seedOf(r), x, y, z, r() * Math.PI * 2, (r() - 0.5) * 0.25, width, 70 + Math.floor(r() * 40), true, false);
            }
          }
        }
        if (r() < 0.02) {
          const x = sx * CS + r() * CS, z = sz * CS + r() * CS, y = 25 + r() * 25;
          worm(seedOf(r), x, y, z, r() * Math.PI * 2, (r() - 0.5) * 0.12, 1.5 + r() * 2, 80 + Math.floor(r() * 30), false, true);
        }
      }
    }
  }

  // ---- Trees and big features ----------------------------------------------
  // The world is divided into 5x5 cells; each cell has one candidate position
  // chosen by hashing the cell coordinate, and the biome decides how likely a
  // tree is there and which kind.
  const TREE_CELL = 5;
  const TREE_REACH = 5; // how far a tree's leaves can stick out of its cell
  function featureInCell(cellX, cellZ) {
    const tx = cellX * TREE_CELL + Math.floor(hash2(seed ^ 0xa11, cellX, cellZ) * TREE_CELL);
    const tz = cellZ * TREE_CELL + Math.floor(hash2(seed ^ 0xb22, cellX, cellZ) * TREE_CELL);
    const col = column(tx, tz);
    const biome = BIOME_LIST[col.biome];
    const [chance, kinds] = biome.trees;
    if (!kinds.length || hash2(seed ^ 0x51ed, cellX, cellZ) >= chance) return null;
    if (col.height <= S) return null;
    if ((col.biome === BIOME.MOUNTAINS || col.biome === BIOME.WOODED_MOUNTAINS) && col.height > 86) return null;
    if (isCave(tx, col.height, tz, col.height)) return null;
    let total = 0;
    for (const [, w] of kinds) total += w;
    let pick = hash2(seed ^ 0x7e11, cellX, cellZ) * total;
    let kind = kinds[0][0];
    for (const [k, w] of kinds) { if ((pick -= w) < 0) { kind = k; break; } }
    return { x: tx, z: tz, y: col.height + 1, kind };
  }

  /**
   * Draw one tree/feature. `put(x, y, z, id, soft)` takes WORLD coordinates and
   * ignores blocks outside the chunk being generated; soft = only fill empty space.
   */
  function drawFeature(t, put) {
    const r = mulberry32((hash3(seed ^ 0x7ee, t.x, t.y, t.z) * 4294967296) >>> 0);
    const { x, y, z } = t;
    const trunk = (id, h, size = 1) => { for (let i = 0; i < h; i++) for (let a = 0; a < size; a++) for (let b = 0; b < size; b++) put(x + a, y + i, z + b, id, false); };
    const disc = (cy, rad, id, cornerChance = 0.5, ox = x, oz = z, size = 1) => {
      const e = size - 1;
      for (let dz = -rad; dz <= rad + e; dz++) for (let dx = -rad; dx <= rad + e; dx++) {
        const ddx = dx < 0 ? dx : Math.max(0, dx - e), ddz = dz < 0 ? dz : Math.max(0, dz - e);
        if (ddx * ddx + ddz * ddz > rad * rad + 0.5) continue;
        const corner = Math.abs(ddx) === rad && Math.abs(ddz) === rad;
        if (corner && r() < cornerChance) continue;
        put(ox + dx, cy, oz + dz, id, true);
      }
    };
    const blob = (cx, cy, cz, rad, id) => {
      for (let dy = -rad; dy <= rad; dy++) for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dy * dy + dz * dz <= rad * rad + 0.6 + r() * 0.8) put(cx + dx, cy + dy, cz + dz, id, true);
      }
    };
    const ground = (size = 1) => { for (let a = 0; a < size; a++) for (let b = 0; b < size; b++) put(x + a, y - 1, z + b, B.DIRT, false); };

    switch (t.kind) {
      case 'oak': case 'birch': case 'swamp_oak': {
        const log = t.kind === 'birch' ? B.BIRCH_LOG : B.LOG;
        const leaves = t.kind === 'birch' ? B.BIRCH_LEAVES : B.LEAVES;
        const h = (t.kind === 'birch' ? 5 : 4) + Math.floor(r() * 3);
        const top = y + h - 1;
        const wide = t.kind === 'swamp_oak' ? 3 : 2;
        disc(top - 2, wide, leaves); disc(top - 1, wide, leaves);
        disc(top, 1, leaves); disc(top + 1, 1, leaves, 1);
        if (t.kind === 'swamp_oak') {
          // hanging "vines" made of leaves
          for (let k = 0; k < 6; k++) {
            const vx = x + Math.floor(r() * 7) - 3, vz = z + Math.floor(r() * 7) - 3;
            for (let d = 0; d < 1 + r() * 3; d++) put(vx, top - 3 - d, vz, leaves, true);
          }
        }
        trunk(log, h); ground();
        break;
      }
      case 'big_oak': {
        const h = 7 + Math.floor(r() * 3);
        blob(x, y + h - 1, z, 3, B.LEAVES);
        for (let b = 0; b < 3; b++) {
          const ang = r() * Math.PI * 2, by = y + 3 + Math.floor(r() * (h - 4));
          const bx = x + Math.round(Math.cos(ang) * 3), bz = z + Math.round(Math.sin(ang) * 3);
          put(Math.round((x + bx) / 2), by, Math.round((z + bz) / 2), B.LOG, false);
          blob(bx, by + 1, bz, 2, B.LEAVES);
        }
        trunk(B.LOG, h); ground();
        break;
      }
      case 'spruce': case 'pine': {
        const h = (t.kind === 'pine' ? 9 : 7) + Math.floor(r() * 4);
        const top = y + h;
        put(x, top, z, B.SPRUCE_LEAVES, true);
        if (t.kind === 'pine') {
          disc(top - 1, 1, B.SPRUCE_LEAVES, 1); disc(top - 2, 2, B.SPRUCE_LEAVES); disc(top - 3, 1, B.SPRUCE_LEAVES, 1);
        } else {
          let rad = 0;
          for (let cy = top - 1; cy >= y + 2; cy--) {
            rad = (top - cy) % 2 === 1 ? Math.min(3, 1 + Math.floor((top - cy) / 3)) : Math.max(0, rad - 1);
            if (rad > 0) disc(cy, rad, B.SPRUCE_LEAVES, rad > 1 ? 0.5 : 1); else put(x, cy, z, B.SPRUCE_LEAVES, true);
          }
        }
        trunk(B.SPRUCE_LOG, h); ground();
        break;
      }
      case 'mega_spruce': {
        const h = 14 + Math.floor(r() * 8);
        const top = y + h;
        for (let cy = top; cy >= top - Math.floor(h * 0.55); cy--) {
          const rad = Math.min(4, Math.floor((top - cy) / 3) + ((top - cy) % 3 === 0 ? 0 : 1));
          disc(cy, rad, B.SPRUCE_LEAVES, 0.5, x, z, 2);
        }
        trunk(B.SPRUCE_LOG, h, 2); ground(2);
        for (let dz = -2; dz <= 3; dz++) for (let dx = -2; dx <= 3; dx++) if (r() < 0.5) put(x + dx, y - 1, z + dz, B.PODZOL, false);
        break;
      }
      case 'dark_oak': {
        const h = 6 + Math.floor(r() * 3);
        const top = y + h;
        disc(top - 2, 3, B.DARK_OAK_LEAVES, 0.5, x, z, 2);
        disc(top - 1, 3, B.DARK_OAK_LEAVES, 0.7, x, z, 2);
        disc(top, 2, B.DARK_OAK_LEAVES, 0.6, x, z, 2);
        trunk(B.DARK_OAK_LOG, h, 2); ground(2);
        break;
      }
      case 'acacia': {
        const h = 4 + Math.floor(r() * 2);
        trunk(B.ACACIA_LOG, h); ground();
        const ang = Math.floor(r() * 4) * Math.PI / 2;
        const dx = Math.round(Math.cos(ang)), dz = Math.round(Math.sin(ang));
        let bx = x, bz = z, by = y + h - 1;
        const lean = 2 + Math.floor(r() * 2);
        for (let k = 0; k < lean; k++) { bx += dx; bz += dz; by++; put(bx, by, bz, B.ACACIA_LOG, false); }
        disc(by + 1, 3, B.ACACIA_LEAVES, 1, bx, bz);
        disc(by + 2, 1, B.ACACIA_LEAVES, 0, bx, bz);
        break;
      }
      case 'jungle': {
        const h = 8 + Math.floor(r() * 6);
        const top = y + h - 1;
        disc(top - 2, 3, B.JUNGLE_LEAVES); disc(top - 1, 3, B.JUNGLE_LEAVES, 0.7); disc(top, 2, B.JUNGLE_LEAVES); disc(top + 1, 1, B.JUNGLE_LEAVES, 1);
        trunk(B.JUNGLE_LOG, h); ground();
        break;
      }
      case 'mega_jungle': {
        const h = 16 + Math.floor(r() * 8);
        const top = y + h - 1;
        disc(top - 1, 4, B.JUNGLE_LEAVES, 0.6, x, z, 2); disc(top, 4, B.JUNGLE_LEAVES, 0.8, x, z, 2); disc(top + 1, 3, B.JUNGLE_LEAVES, 0.6, x, z, 2);
        for (let b = 0; b < 3; b++) {
          const by = y + 6 + Math.floor(r() * (h - 10));
          const bx = x + (r() < 0.5 ? -3 : 4), bz = z + Math.floor(r() * 4) - 1;
          disc(by, 2, B.JUNGLE_LEAVES, 0.6, bx, bz); disc(by + 1, 1, B.JUNGLE_LEAVES, 0.6, bx, bz);
        }
        trunk(B.JUNGLE_LOG, h, 2); ground(2);
        break;
      }
      case 'jungle_bush': {
        put(x, y, z, B.JUNGLE_LOG, false); ground();
        disc(y, 2, B.LEAVES, 0.6); disc(y + 1, 1, B.LEAVES, 0.4);
        break;
      }
      case 'huge_red_mushroom': case 'huge_brown_mushroom': {
        const h = 5 + Math.floor(r() * 3);
        const top = y + h;
        if (t.kind === 'huge_red_mushroom') {
          for (let cy = top - 3; cy < top; cy++) {
            for (let d = -2; d <= 2; d++) { put(x + d, cy, z - 2, B.RED_MUSHROOM_BLOCK, true); put(x + d, cy, z + 2, B.RED_MUSHROOM_BLOCK, true); put(x - 2, cy, z + d, B.RED_MUSHROOM_BLOCK, true); put(x + 2, cy, z + d, B.RED_MUSHROOM_BLOCK, true); }
          }
          disc(top, 1, B.RED_MUSHROOM_BLOCK, 0);
          for (let d = -1; d <= 1; d++) { put(x + d, top, z - 2, B.RED_MUSHROOM_BLOCK, true); put(x + d, top, z + 2, B.RED_MUSHROOM_BLOCK, true); put(x - 2, top, z + d, B.RED_MUSHROOM_BLOCK, true); put(x + 2, top, z + d, B.RED_MUSHROOM_BLOCK, true); }
        } else {
          disc(top, 3, B.BROWN_MUSHROOM_BLOCK, 1);
        }
        trunk(B.MUSHROOM_STEM, h); ground();
        break;
      }
      case 'ice_spike': {
        const h = 7 + Math.floor(r() * (r() < 0.15 ? 25 : 10));
        const base = 1 + Math.floor(h / 8);
        for (let i = 0; i < h; i++) {
          const rad = Math.max(0, base * (1 - i / h));
          const ir = Math.ceil(rad);
          for (let dz = -ir; dz <= ir; dz++) for (let dx = -ir; dx <= ir; dx++) {
            if (dx * dx + dz * dz <= rad * rad + 0.3) put(x + dx, y - 1 + i, z + dz, B.PACKED_ICE, false);
          }
        }
        break;
      }
      default: break;
    }
  }

  // ---- Villages -------------------------------------------------------------------
  // One possible village per 512x512 region, at a hashed spot, in plains,
  // desert, savanna, taiga or snowy-plains biomes. A village is planned once as
  // a list of block operations in world coordinates; each chunk applies the
  // operations that fall inside it.
  const VREGION = 512;
  const OP_SET = 0, OP_SOFT = 1, OP_FILL_DOWN = 2, OP_ROAD = 3;
  const villageCache = new Map();

  const STYLES = {
    plains: { wall: B.PLANKS, frame: B.LOG, base: B.COBBLESTONE, roof: B.PLANKS, road: B.GRAVEL },
    taiga: { wall: B.SPRUCE_PLANKS, frame: B.SPRUCE_LOG, base: B.COBBLESTONE, roof: B.SPRUCE_PLANKS, road: B.GRAVEL },
    savanna: { wall: B.ACACIA_PLANKS, frame: B.ACACIA_LOG, base: B.COBBLESTONE, roof: B.ACACIA_PLANKS, road: B.GRAVEL },
    desert: { wall: B.SANDSTONE, frame: B.SMOOTH_SANDSTONE, base: B.SANDSTONE, roof: B.SMOOTH_SANDSTONE, road: B.SMOOTH_SANDSTONE },
  };
  const styleFor = (biome) => (biome === BIOME.DESERT ? STYLES.desert : biome === BIOME.SAVANNA ? STYLES.savanna
    : biome === BIOME.TAIGA || biome === BIOME.SNOWY_TUNDRA ? STYLES.taiga : STYLES.plains);

  function villageInRegion(rx, rz) {
    const key = rx + ',' + rz;
    if (villageCache.has(key)) return villageCache.get(key);
    let v = null;
    const r = mulberry32((hash2(seed ^ 0x71a6e, rx, rz) * 4294967296) >>> 0);
    if (r() < 0.7) {
      const cx = rx * VREGION + 96 + Math.floor(r() * (VREGION - 192));
      const cz = rz * VREGION + 96 + Math.floor(r() * (VREGION - 192));
      const col = column(cx, cz);
      if (BIOME_LIST[col.biome].village && col.height > S + 1 && col.height < S + 30) v = planVillage(r, cx, cz, col);
    }
    villageCache.set(key, v);
    if (villageCache.size > 64) villageCache.delete(villageCache.keys().next().value);
    return v;
  }

  function planVillage(r, vx, vz, centerCol) {
    const style = styleFor(centerCol.biome);
    const ops = [];
    const op = (x, y, z, id, mode = OP_SET) => ops.push(x, y, z, id, mode);
    const surface = (x, z) => column(x, z).height;

    // A building is drawn in local (u, v, y) coordinates: u runs along the
    // road, v away from it (v = 0 is the front wall), then rotated into place.
    const placed = []; // bounding boxes of buildings so far, to avoid overlaps
    const building = (bx, bz, ax, az, px, pz, w, d, draw) => {
      const cu = Math.floor(w / 2), cv = Math.floor(d / 2);
      const toX = (u, v) => bx + (u - cu) * ax + v * px, toZ = (u, v) => bz + (u - cu) * az + v * pz;
      const xs = [toX(0, 0), toX(w - 1, d - 1)], zs = [toZ(0, 0), toZ(w - 1, d - 1)];
      const box = [Math.min(...xs) - 1, Math.min(...zs) - 1, Math.max(...xs) + 1, Math.max(...zs) + 1];
      if (placed.some(o => box[0] <= o[2] && box[2] >= o[0] && box[1] <= o[3] && box[3] >= o[1])) return;
      const ground = surface(toX(cu, cv), toZ(cu, cv));
      if (ground < S) return; // don't build on water
      placed.push(box);
      const fy = ground + 1;
      const put = (u, y, v, id, mode = OP_SET) => op(toX(u, v), fy + y, toZ(u, v), id, mode);
      for (let v = 0; v < d; v++) for (let u = 0; u < w; u++) {
        put(u, -2, v, style.base, OP_FILL_DOWN); // foundation down to the ground
        put(u, -1, v, style.base);
        for (let y = 0; y < 9; y++) put(u, y, v, B.AIR);   // clear trees and hills
      }
      draw(put, w, d);
    };
    const walls = (put, w, d, h, wall, frame) => {
      for (let y = 0; y < h; y++) for (let v = 0; v < d; v++) for (let u = 0; u < w; u++) {
        const edgeU = u === 0 || u === w - 1, edgeV = v === 0 || v === d - 1;
        if (!edgeU && !edgeV) continue;
        put(u, y, v, edgeU && edgeV ? frame : wall);
      }
    };
    const roof = (put, w, d, y0, mat) => {
      for (let k = 0; k * 2 < Math.min(w, d); k++) {
        for (let v = k; v < d - k; v++) for (let u = k; u < w - k; u++) put(u, y0 + k, v, mat);
        if (k >= 1) break;
      }
    };
    const door = (put, u) => { put(u, 0, 0, B.AIR); put(u, 1, 0, B.AIR); };

    const TYPES = {
      house(put, w, d) {
        walls(put, w, d, 3, style.wall, style.frame);
        roof(put, w, d, 3, style.roof);
        door(put, Math.floor(w / 2));
        put(0, 1, Math.floor(d / 2), B.GLASS); put(w - 1, 1, Math.floor(d / 2), B.GLASS); put(Math.floor(w / 2), 1, d - 1, B.GLASS);
        put(1, 0, d - 2, B.CRAFTING_TABLE); put(w - 2, 0, d - 2, B.TORCH);
      },
      bighouse(put, w, d) {
        walls(put, w, d, 4, style.wall, style.frame);
        roof(put, w, d, 4, style.roof);
        door(put, Math.floor(w / 2));
        for (const v of [2, d - 3]) { put(0, 1, v, B.GLASS); put(0, 2, v, B.GLASS); put(w - 1, 1, v, B.GLASS); put(w - 1, 2, v, B.GLASS); }
        put(1, 0, d - 2, B.BOOKSHELF); put(2, 0, d - 2, B.BOOKSHELF); put(w - 2, 0, d - 2, B.FURNACE); put(w - 2, 0, 1, B.TORCH); put(1, 0, 1, B.TORCH);
      },
      smithy(put, w, d) {
        walls(put, w, d, 4, B.COBBLESTONE, style.frame);
        for (let u = 1; u < w - 1; u++) { put(u, 0, 0, B.AIR); put(u, 1, 0, B.AIR); put(u, 2, 0, B.AIR); }
        roof(put, w, d, 4, style.roof);
        put(1, 0, d - 2, B.FURNACE); put(2, 0, d - 2, B.FURNACE); put(w - 2, 0, d - 2, B.CRAFTING_TABLE); put(w - 2, 0, 1, B.TORCH);
      },
      church(put, w, d) {
        walls(put, w, d, 5, B.COBBLESTONE, B.COBBLESTONE);
        roof(put, w, d, 5, B.COBBLESTONE);
        // bell tower over the back three rows
        for (let y = 5; y < 10; y++) for (let v = d - 3; v < d; v++) for (let u = 0; u < w; u++) {
          if (u === 0 || u === w - 1 || v === d - 3 || v === d - 1) put(u, y, v, y === 8 && u === Math.floor(w / 2) ? B.GLASS : B.COBBLESTONE);
        }
        for (let v = d - 3; v < d; v++) for (let u = 0; u < w; u++) put(u, 10, v, B.COBBLESTONE);
        door(put, Math.floor(w / 2));
        put(0, 2, 2, B.GLASS); put(w - 1, 2, 2, B.GLASS); put(0, 2, d - 3, B.GLASS); put(w - 1, 2, d - 3, B.GLASS);
        put(1, 0, d - 2, B.TORCH); put(w - 2, 0, d - 2, B.TORCH);
      },
      farm(put, w, d) {
        for (let v = 0; v < d; v++) for (let u = 0; u < w; u++) {
          const edge = u === 0 || u === w - 1 || v === 0 || v === d - 1;
          const water = u === Math.floor(w / 2) && !edge;
          put(u, -1, v, edge ? style.frame : water ? B.WATER : B.FARMLAND);
          if (!edge && !water) put(u, 0, v, B.WHEAT);
        }
      },
      lamp(put) {
        put(0, 0, 0, style.frame); put(0, 1, 0, style.frame); put(0, 2, 0, style.frame); put(0, 3, 0, B.TORCH);
      },
    };
    const SIZES = { house: [5, 5], bighouse: [7, 7], smithy: [7, 6], church: [5, 9], farm: [7, 9], lamp: [1, 1] };
    const PICKS = ['house', 'house', 'house', 'bighouse', 'bighouse', 'farm', 'farm', 'smithy', 'lamp', 'church'];

    // Roads: four arms from the centre.
    const arms = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let reach = 0;
    for (const [ax, az] of arms) {
      const len = 16 + Math.floor(r() * 22);
      reach = Math.max(reach, len);
      const px = -az, pz = ax; // perpendicular
      for (let s = 2; s <= len; s++) for (let o = -1; o <= 1; o++) {
        const x = vx + ax * s + px * o, z = vz + az * s + pz * o;
        op(x, surface(x, z), z, style.road, OP_ROAD);
      }
      for (let s = 7; s + 4 <= len + 4; s += 11) {
        for (const side of [1, -1]) {
          if (r() < 0.25) continue;
          const type = PICKS[Math.floor(r() * PICKS.length)];
          const [w, d] = SIZES[type];
          const bx = vx + ax * s + px * side * 3, bz = vz + az * s + pz * side * 3;
          building(bx, bz, ax, az, px * side, pz * side, w, d, TYPES[type]);
        }
      }
    }
    // The well in the middle (4x4).
    const wy = surface(vx, vz) + 1;
    for (let dz = -1; dz <= 2; dz++) for (let dx = -1; dx <= 2; dx++) {
      const x = vx + dx, z = vz + dz;
      const inner = dx >= 0 && dx <= 1 && dz >= 0 && dz <= 1;
      op(x, wy - 4, z, B.COBBLESTONE, OP_FILL_DOWN);
      for (let y = -3; y < 0; y++) op(x, wy + y, z, inner ? B.WATER : B.COBBLESTONE);
      op(x, wy, z, inner ? B.AIR : B.COBBLESTONE);
      for (let y = 1; y < 4; y++) op(x, wy + y, z, (Math.abs(dx - 0.5) === 1.5 && Math.abs(dz - 0.5) === 1.5) ? style.frame : B.AIR);
      op(x, wy + 4, z, B.COBBLESTONE);
    }
    const typed = new Int32Array(ops);
    const pad = 14;
    return { x: vx, z: vz, y: wy, ops: typed, minX: vx - reach - pad, maxX: vx + reach + pad, minZ: vz - reach - pad, maxZ: vz + reach + pad };
  }

  function villagesTouching(minX, minZ, maxX, maxZ) {
    const out = [];
    for (let rz = Math.floor((minZ - 64) / VREGION); rz <= Math.floor((maxZ + 64) / VREGION); rz++) {
      for (let rx = Math.floor((minX - 64) / VREGION); rx <= Math.floor((maxX + 64) / VREGION); rx++) {
        const v = villageInRegion(rx, rz);
        if (v && v.maxX >= minX && v.minX <= maxX && v.maxZ >= minZ && v.minZ <= maxZ) out.push(v);
      }
    }
    return out;
  }

  /** Nearest village centre within `maxDist` blocks, or null (used to spawn villagers). */
  function villageNear(x, z, maxDist = 96) {
    let best = null, bd = maxDist;
    for (const v of villagesTouching(x - maxDist, z - maxDist, x + maxDist, z + maxDist)) {
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < bd) { bd = d; best = { x: v.x, y: v.y, z: v.z, id: `${v.x},${v.z}` }; }
    }
    return best;
  }

  // ---- Main entry point ---------------------------------------------------------
  function generateChunk(cx, cz) {
    const blocks = new Uint8Array(CS * CS * CH);
    const ox = cx * CS, oz = cz * CS;
    const heights = new Int16Array(LAYER);
    const biomes = new Uint8Array(LAYER);
    const idx = (x, y, z) => x + z * CS + y * LAYER;

    // ---- 2. columns ----
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const wx = ox + x, wz = oz + z;
        const col = column(wx, wz);
        const height = col.height, bi = col.biome, biome = BIOME_LIST[bi];
        heights[x + z * CS] = height;
        biomes[x + z * CS] = bi;
        const sn = nSurface.noise2(wx / 16, wz / 16);
        let top = B[biome.top.toUpperCase()], filler = B[biome.filler.toUpperCase()];
        const underwater = height < S;
        if (underwater && (top === B.GRASS || top === B.SNOWY_GRASS || top === B.PODZOL || top === B.MYCELIUM)) {
          top = bi === BIOME.SWAMP ? B.DIRT : sn > 0.3 ? B.GRAVEL : B.SAND; filler = B.DIRT;
        }
        if (bi === BIOME.OCEAN || bi === BIOME.RIVER) { if (sn > 0.35) { top = B.GRAVEL; filler = B.GRAVEL; } else if (sn < -0.5) { top = B.CLAY; } }
        if (bi === BIOME.MOUNTAINS || bi === BIOME.WOODED_MOUNTAINS || bi === BIOME.SNOWY_TUNDRA || bi === BIOME.SNOWY_TAIGA) {
          if (height > 98 + sn * 3) { top = B.SNOW; filler = B.STONE; }
          else if (height > 84 + sn * 5 || (col.hilly > 0.8 && sn > 0.3)) { top = B.STONE; filler = B.STONE; }
        }
        if (bi === BIOME.GIANT_TREE_TAIGA && sn > 0.4) top = B.COARSE_DIRT;
        if (bi === BIOME.SAVANNA_PLATEAU && sn > 0.45) top = B.COARSE_DIRT;
        const badlands = bi === BIOME.BADLANDS || bi === BIOME.BADLANDS_PLATEAU;
        const fillerDepth = 3 + Math.floor((sn + 1) * 1.5);

        for (let y = 0; y <= height; y++) {
          let id;
          if (y === 0) id = B.BEDROCK;
          else if (y < 4 && hash3(seed, wx, y, wz) < 0.6 - y * 0.15) id = B.BEDROCK;
          else if (y === height) id = top;
          else if (badlands && y > height - 2 && y > S) id = filler;   // thin red sand, stripes below
          else if (badlands && y > Math.min(height - 3, S - 8)) id = BANDS[y];
          else if (y > height - fillerDepth) id = filler;
          else if ((top === B.SAND || bi === BIOME.DESERT) && y > height - fillerDepth - 3) id = B.SANDSTONE;
          else id = B.STONE;
          blocks[idx(x, y, z)] = id;
        }
        for (let y = height + 1; y <= S; y++) blocks[idx(x, y, z)] = (y === S && biome.snowy) ? B.ICE : B.WATER;
      }
    }

    // ---- 3a. noise caves ----
    const gw = CS / CAVE_STEP_XZ + 1, gh = CH / CAVE_STEP_Y + 1;
    const grid = new Float64Array(gw * gw * gh); // Float64 so values match caveAt() bit-for-bit
    for (let gy = 0; gy < gh; gy++) for (let gz = 0; gz < gw; gz++) for (let gx = 0; gx < gw; gx++) {
      grid[gx + gz * gw + gy * gw * gw] = caveSample(ox + gx * CAVE_STEP_XZ, gy * CAVE_STEP_Y, oz + gz * CAVE_STEP_XZ);
    }
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const height = heights[x + z * CS];
      const gx = Math.floor(x / CAVE_STEP_XZ), gz = Math.floor(z / CAVE_STEP_XZ);
      const fx = (x - gx * CAVE_STEP_XZ) / CAVE_STEP_XZ, fz = (z - gz * CAVE_STEP_XZ) / CAVE_STEP_XZ;
      for (let y = 3; y <= height; y++) {
        if (!caveAllowed(y, height)) continue;
        const gy = Math.floor(y / CAVE_STEP_Y);
        const fy = (y - gy * CAVE_STEP_Y) / CAVE_STEP_Y;
        const b0 = gx + gz * gw + gy * gw * gw, up = gw * gw, south = gw;
        const v = trilerp(grid[b0], grid[b0 + 1], grid[b0 + up], grid[b0 + up + 1],
          grid[b0 + south], grid[b0 + south + 1], grid[b0 + up + south], grid[b0 + up + south + 1], fx, fy, fz);
        if (v < CAVE_THRESHOLD) {
          const i = idx(x, y, z);
          if (blocks[i] !== B.BEDROCK && !IS_LIQUID[blocks[i + LAYER]]) blocks[i] = y <= 10 ? B.LAVA : B.AIR;
        }
      }
    }
    // ---- 3b. worm caves and ravines ----
    carveWorms(blocks, cx, cz, heights);

    // ---- 4. ores and stone variants ----
    const rand = mulberry32(hash2(seed ^ 0x0e5, cx, cz) * 4294967296 >>> 0);
    const mountainous = biomes[8 + 8 * CS] === BIOME.MOUNTAINS || biomes[8 + 8 * CS] === BIOME.WOODED_MOUNTAINS;
    const ores = [
      // [block, veins per chunk, vein size, minY, maxY]
      [B.GRANITE, 2, 28, 5, 80], [B.DIORITE, 2, 28, 5, 80], [B.ANDESITE, 2, 28, 5, 80],
      [B.DIRT, 4, 16, 5, 80], [B.GRAVEL, 4, 16, 5, 70],
      [B.COAL_ORE, 16, 9, 5, 110], [B.IRON_ORE, 9, 6, 5, 62], [B.GOLD_ORE, 2.5, 6, 5, 30],
      [B.REDSTONE_ORE, 4, 6, 5, 16], [B.LAPIS_ORE, 1.2, 5, 8, 30], [B.DIAMOND_ORE, 1.3, 5, 4, 15],
      [B.EMERALD_ORE, mountainous ? 4 : 0, 1, 5, 32],
    ];
    for (const [ore, count, size, minY, maxY] of ores) {
      let k = Math.floor(count) + (rand() < count % 1 ? 1 : 0);
      while (k-- > 0) {
        let x = Math.floor(rand() * CS), z = Math.floor(rand() * CS);
        let y = minY + Math.floor(rand() * (maxY - minY));
        for (let s = 0; s < size; s++) {
          const i = idx(x, y, z);
          if (blocks[i] === B.STONE) blocks[i] = ore;
          const dir = Math.floor(rand() * 6);
          if (dir === 0) x = Math.min(CS - 1, x + 1); else if (dir === 1) x = Math.max(0, x - 1);
          else if (dir === 2) z = Math.min(CS - 1, z + 1); else if (dir === 3) z = Math.max(0, z - 1);
          else if (dir === 4) y = Math.min(maxY, y + 1); else y = Math.max(minY, y - 1);
        }
      }
    }

    // ---- 5. trees and big features ----
    const put = (x, y, z, id, soft) => {
      const lx = x - ox, lz = z - oz;
      if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || y < 1 || y >= CH) return;
      const i = idx(lx, y, lz);
      if (soft && !SOFT[blocks[i]]) return;
      blocks[i] = id;
    };
    const c0x = Math.floor((ox - TREE_REACH) / TREE_CELL), c1x = Math.floor((ox + CS + TREE_REACH) / TREE_CELL);
    const c0z = Math.floor((oz - TREE_REACH) / TREE_CELL), c1z = Math.floor((oz + CS + TREE_REACH) / TREE_CELL);
    for (let czc = c0z; czc <= c1z; czc++) for (let cxc = c0x; cxc <= c1x; cxc++) {
      const t = featureInCell(cxc, czc);
      if (t) drawFeature(t, put);
    }

    // ---- 6. small plants (single column, inside this chunk only) ----
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const wx = ox + x, wz = oz + z;
      const h = heights[x + z * CS];
      const biome = BIOME_LIST[biomes[x + z * CS]];
      if (!biome.plants.length || h + 2 >= CH) continue;
      const ground = blocks[idx(x, h, z)];
      const aboveI = idx(x, h + 1, z);
      let roll = hash2(seed ^ 0xf10, wx, wz);
      for (const [name, chance] of biome.plants) {
        if (roll >= chance) { roll -= chance; continue; }
        if (name === 'lily_pad') {
          if (h < S - 1 && blocks[idx(x, S, z)] === B.WATER && blocks[idx(x, S + 1, z)] === B.AIR) blocks[idx(x, S + 1, z)] = B.LILY_PAD;
        } else if (blocks[aboveI] !== B.AIR) {
          // something already grows here
        } else if (name === 'cactus' || name === 'dead_bush') {
          if (ground === B.SAND || ground === B.RED_SAND || (name === 'dead_bush' && (ground === B.PODZOL || ground === B.TERRACOTTA))) {
            if (name === 'dead_bush') blocks[aboveI] = B.DEAD_BUSH;
            else { const tall = 1 + Math.floor(hash2(seed ^ 0xca7, wx, wz) * 3); for (let y = 1; y <= tall; y++) put(wx, h + y, wz, B.CACTUS, true); }
          }
        } else if (name === 'coarse_patch') {
          if (ground === B.GRASS) blocks[idx(x, h, z)] = B.COARSE_DIRT;
        } else if (name === 'melon') {
          if (SOIL.has(ground)) blocks[aboveI] = B.MELON;
        } else if (name.endsWith('mushroom')) {
          if (SOIL.has(ground)) blocks[aboveI] = B[name.toUpperCase()];
        } else if (ground === B.GRASS || ground === B.PODZOL) {
          blocks[aboveI] = B[name.toUpperCase()];
        }
        break;
      }
    }

    // ---- 7. villages ----
    for (const v of villagesTouching(ox, oz, ox + CS - 1, oz + CS - 1)) {
      const ops = v.ops;
      for (let k = 0; k < ops.length; k += 5) {
        const lx = ops[k] - ox, lz = ops[k + 2] - oz;
        if (lx < 0 || lx >= CS || lz < 0 || lz >= CS) continue;
        const y = ops[k + 1], id = ops[k + 3], mode = ops[k + 4];
        if (y < 1 || y >= CH - 1) continue;
        const i = idx(lx, y, lz);
        if (mode === OP_SET) blocks[i] = id;
        else if (mode === OP_SOFT) { if (SOFT[blocks[i]]) blocks[i] = id; }
        else if (mode === OP_FILL_DOWN) {
          for (let yy = y; yy > 0; yy--) {
            const j = idx(lx, yy, lz);
            if (IS_SOLID[blocks[j]] && !SOFT[blocks[j]]) break;
            blocks[j] = id;
          }
        } else if (mode === OP_ROAD) {
          if (!IS_LIQUID[blocks[i]]) blocks[i] = id;
          for (let yy = y + 1; yy <= y + 2; yy++) { const j = idx(lx, yy, lz); if (SOFT[blocks[j]]) blocks[j] = B.AIR; }
        }
      }
    }
    return blocks;
  }

  /** Find a dry place near the origin for players to spawn. */
  function findSpawn() {
    const bad = new Set([BIOME.OCEAN, BIOME.DEEP_OCEAN, BIOME.FROZEN_OCEAN, BIOME.RIVER, BIOME.FROZEN_RIVER]);
    for (let r = 0; r < 2000; r += 16) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(r * Math.cos((a / 16) * Math.PI * 2)), z = Math.round(r * Math.sin((a / 16) * Math.PI * 2));
        const c = column(x, z);
        if (c.height > S + 1 && !bad.has(c.biome) && !isCave(x, c.height, z, c.height)) {
          return { x: x + 0.5, y: c.height + 1, z: z + 0.5 };
        }
      }
    }
    return { x: 0.5, y: CH - 20, z: 0.5 };
  }

  return { seed, column, generateChunk, findSpawn, villageNear };
}
