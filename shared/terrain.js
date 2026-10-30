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
//      erosion (flat vs hilly), temperature, humidity, "weirdness"
//      (rare variants) and rivers. Height AND biome are both computed from
//      these same continuous fields, so biome borders never create cliffs.
//      A very slow "range" field marks where mountain ranges run; inside a
//      range, ridged noise builds sharp crests up to ~180 blocks above the sea.
//   2. Fill: bedrock -> stone -> biome filler -> biome surface -> water/ice.
//   3. Caves: noise "spaghetti" tunnels, plus random-walk "worm" tunnels,
//      rooms and ravines (classic-style carvers). Lava fills cave floors
//      below y=10.
//   4. Ores and stone variants (granite, diorite, andesite) as random veins.
//   5. Trees and large features (huge mushrooms, ice spikes) per biome.
//   6. Small plants per biome.
//   7. Villages.
// Structures that cross chunk borders (trees, caves, villages) are planned
// from their own deterministic seed, and each chunk draws the part inside it.
// ============================================================================
import { CHUNK_SIZE as CS, CHUNK_HEIGHT as CH, SEA_LEVEL } from './config.js';
import { B, IS_SOLID, IS_LIQUID, SHAPE, MAX_ID, stateId } from './blocks.js';
import { FACINGS } from './shapes.js';
import { BIOME_LIST, BIOME, BIOME_NAMES } from './biomes.js';
import { Simplex, hashSeed, hash2, hash3, mulberry32 } from './noise.js';
import { createStructures, OP } from './structures.js';

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
const SOFT = new Uint8Array(MAX_ID);
for (const id of [B.AIR, B.TALL_GRASS, B.FERN, B.LEAVES, B.SPRUCE_LEAVES, B.BIRCH_LEAVES, B.JUNGLE_LEAVES, B.ACACIA_LEAVES,
  B.DARK_OAK_LEAVES, B.DEAD_BUSH, B.SNOW]) SOFT[id] = 1;
for (let i = 0; i < MAX_ID; i++) if (SHAPE[i] === 1 || SHAPE[i] === 3 || SHAPE[i] === 9 || SHAPE[i] === 10) SOFT[i] = 1;
const VINE = Object.fromEntries(FACINGS.map(f => [f, stateId('vine', { facing: f })]));
const COCOA = Object.fromEntries(FACINGS.map(f => [f, stateId('cocoa', { facing: f })]));
const FACING_OF = { '1,0': 'east', '-1,0': 'west', '0,1': 'south', '0,-1': 'north' };
const MOUNTAIN_BIOMES = new Set([BIOME.MOUNTAINS, BIOME.WOODED_MOUNTAINS, BIOME.SNOWY_PEAKS, BIOME.STONY_PEAKS]);

export function createGenerator(seedInput) {
  const seed = hashSeed(seedInput);
  const n = (k) => new Simplex((seed + k * 7919) >>> 0);
  const nContinent = n(1), nErosion = n(2), nTemp = n(3), nHum = n(4), nWeird = n(5);
  const nRiver = n(6), nDetail = n(7), nMush = n(8), nSurface = n(9);
  const nCaveA = n(10), nCaveB = n(11), nCavern = n(12);
  const nRange = n(13), nRidge = n(14), nPeak = n(15);
  const nOver = n(16);

  // Badlands terracotta stripes: a fixed random colour per height, per world.
  const bandRand = mulberry32(seed ^ 0xba7d);
  const BAND_CHOICES = [B.TERRACOTTA, B.TERRACOTTA, B.ORANGE_TERRACOTTA, B.ORANGE_TERRACOTTA, B.YELLOW_TERRACOTTA,
    B.WHITE_TERRACOTTA, B.RED_TERRACOTTA, B.BROWN_TERRACOTTA, B.LIGHT_GRAY_TERRACOTTA, B.TERRACOTTA];
  const BANDS = new Uint16Array(CH);
  for (let y = 0; y < CH; y++) BANDS[y] = BAND_CHOICES[Math.floor(bandRand() * BAND_CHOICES.length)];

  // ---- 1. Climate -> height + biome ---------------------------------------
  /** Everything about one column. Cheap enough to call for neighbour chunks. */
  function column(x, z) {
    // Climate fields are very smooth (scales of 1-2 km), so biomes are big.
    const C = nContinent.fbm2(x / 2400, z / 2400, 4); // continentalness
    const E = nErosion.fbm2(x / 1400, z / 1400, 3);   // high = hilly
    const T = nTemp.fbm2(x / 3200, z / 3200, 3);      // temperature
    const H = nHum.fbm2(x / 2600, z / 2600, 3);       // humidity
    const W = nWeird.fbm2(x / 1000, z / 1000, 2);     // picks rare variants
    const R = nRiver.fbm2(x / 1100, z / 1100, 4);     // rivers follow R = 0
    const D = nDetail.fbm2(x / 110, z / 110, 4);      // local hills
    const M = nMush.noise2(x / 450, z / 450);         // mushroom islands

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
    // Mountain ranges. `ridge` is "ridged multifractal" noise: 1 - |noise|
    // folds the noise into sharp crests, and each finer octave is weighted by
    // the one before it, so detail piles up on the peaks and valleys stay smooth.
    const Rg = nRange.fbm2(x / 1500, z / 1500, 3);
    const rangeW = smoothstep(0.1, 0.34, Rg) * land * (1 - swampW) * (1 - plateauW);
    let ridge = 0;
    if (rangeW > 0) {
      let amp = 1, freq = 1 / 300, weight = 1;
      for (let o = 0; o < 4; o++) {
        let v = 1 - Math.abs(nRidge.noise2(x * freq + o * 31.7, z * freq - o * 17.3));
        v *= v * weight;
        weight = clamp(v * 1.8, 0, 1);
        ridge += v * amp; amp *= 0.48; freq *= 2.2;
      }
      const jag = nPeak.noise2(x / 23, z / 23) * 5 * smoothstep(0.6, 1.2, ridge); // rocky teeth on the crests
      const mountainH = S + 22 + ridge * 92 + jag;
      landH = lerp(landH, Math.max(landH, mountainH), rangeW);
    }
    let h = lerp(oceanH, landH, land);
    // Mushroom islands rise out of deep ocean.
    const mushW = smoothstep(0.55, 0.68, M) * (1 - smoothstep(-0.42, -0.36, C));
    h = lerp(h, S + 3 + D * 5, mushW);
    // Rivers cut channels where the river noise crosses zero.
    // Rivers. Work out roughly how many blocks this column is from the river's
    // centre line (R = 0) using how fast R changes here, then:
    //   - within ~4 blocks: the channel, cut down below sea level
    //   - further out: the banks may only rise about 1 block for every 2 blocks
    //     away from the water, so you can always walk out of a river.
    const aR = Math.abs(R);
    const bankFade = land * (1 - mushW) * (1 - plateauW * 0.6);
    const riverFade = bankFade * (1 - rangeW * 0.9);
    let riverW = 0;
    if (aR < 0.16 && bankFade > 0) {
      const gx = nRiver.fbm2((x + 1) / 1100, z / 1100, 4) - R;
      const gz = nRiver.fbm2(x / 1100, (z + 1) / 1100, 4) - R;
      const d = aR / Math.max(1e-6, Math.hypot(gx, gz)); // blocks from the river's centre
      riverW = (1 - smoothstep(2.5, 6, d)) * riverFade;
      // the bank starts level with the water, then climbs gently
      const bank = S + Math.max(0, d - 5) * 0.5;
      // (in mountains the gentle part only reaches ~20 blocks out, then the peaks take over)
      const w = bankFade * (1 - smoothstep(0.09, 0.16, aR)) * (1 - rangeW * smoothstep(12, 30, d));
      if (h > bank) h = lerp(h, bank, w);
    }
    if (h > S - 3) h = lerp(h, S - 3, riverW);
    const height = Math.floor(clamp(h, 4, CH - 14));
    const alt = height - S;

    // ---- Biome from the same fields ----
    let biome;
    const frozen = T < -0.33;
    if (mushW > 0.5 && height >= S - 2) biome = BIOME.MUSHROOM_FIELDS;
    else if (height < S - 1 && riverW < 0.5) biome = frozen ? BIOME.FROZEN_OCEAN : C < -0.42 ? BIOME.DEEP_OCEAN : BIOME.OCEAN;
    else if (riverW > 0.55) biome = frozen ? BIOME.FROZEN_RIVER : BIOME.RIVER;
    else if (height <= S + 2 && land < 0.9 && swampW < 0.5) biome = frozen ? BIOME.SNOWY_BEACH : hilly > 0.4 ? BIOME.STONE_BEACH : BIOME.BEACH;
    else if (rangeW > 0.35 && alt > 34) {
      // up a mountain: forests low down, bare rock higher, snow on top (lower when cold)
      const snowLine = 86 - T * 35;
      if (alt > snowLine) biome = BIOME.SNOWY_PEAKS;
      else if (alt > snowLine - 26) biome = BIOME.STONY_PEAKS;
      else biome = H > -0.05 ? BIOME.WOODED_MOUNTAINS : BIOME.MOUNTAINS;
    } else if (frozen) {
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
    return { height, biome, hilly, rangeW };
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
            const y = 12 + r() * (r() * 70);
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

  // ---- Lakes ---------------------------------------------------------------
  // Now and then a chunk has a small lake sunk into the ground: water in green
  // lowlands, and (rarely) lava anywhere. Each fits inside its own chunk.
  const DRY = new Set([BIOME.DESERT, BIOME.BADLANDS, BIOME.BADLANDS_PLATEAU, BIOME.SAVANNA_PLATEAU]);
  function lakeIn(cx, cz) {
    const roll = hash2(seed ^ 0x1a4e, cx, cz);
    const lava = roll > 0.994;
    if (roll > 0.045 && !lava) return null;
    const lx = 6 + Math.floor(hash2(seed ^ 0x1a4f, cx, cz) * 4), lz = 6 + Math.floor(hash2(seed ^ 0x1a50, cx, cz) * 4);
    const x = cx * CS + lx, z = cz * CS + lz;
    const col = column(x, z);
    if (col.height <= S + 1 || col.height > S + 70) return null;
    if (!lava && (DRY.has(col.biome) || MOUNTAIN_BIOMES.has(col.biome))) return null;
    return { lava, lx, lz, x, z, rx: 3 + hash2(seed ^ 0x1a51, cx, cz) * 1.5, rz: 3 + hash2(seed ^ 0x1a52, cx, cz) * 1.5,
      depth: 2 + Math.floor(hash2(seed ^ 0x1a53, cx, cz) * 3), snowy: BIOME_LIST[col.biome].snowy };
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
    // nothing grows where a lake is
    const lake = lakeIn(Math.floor(tx / CS), Math.floor(tz / CS));
    if (lake && ((tx - lake.x) / (lake.rx + 2)) ** 2 + ((tz - lake.z) / (lake.rz + 2)) ** 2 < 1) return null;
    // mossy boulders in the giant taigas
    if (col.biome === BIOME.GIANT_TREE_TAIGA && hash2(seed ^ 0xb01d, cellX, cellZ) < 0.05 && col.height > S) return { x: tx, z: tz, y: col.height, kind: 'boulder' };
    if (!kinds.length || hash2(seed ^ 0x51ed, cellX, cellZ) >= chance) return null;
    if (col.height <= S) return null;
    if (col.height > S + 95) return null; // above the tree line
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
    // Jungle trunks: vines climbing the sides, and the odd cocoa pod.
    const trunkExtras = (h, size) => {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const facing = FACING_OF[`${dx},${dz}`];
        for (let a = 0; a < size; a++) {
          const sx = dx > 0 ? x + size : dx < 0 ? x - 1 : x + a, sz = dz > 0 ? z + size : dz < 0 ? z - 1 : z + a;
          for (let i = 1; i < h - 2; i++) {
            if (r() < 0.35) put(sx, y + i, sz, VINE[facing], true);
            else if (i < 6 && r() < 0.04) put(sx, y + i, sz, COCOA[facing], true);
          }
        }
      }
    };

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
          // vines hanging down the outside of the leaves
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            for (let k = -2; k <= 2; k++) {
              if (r() < 0.5) continue;
              const vx = x + dx * (wide + 1) + (dz ? k : 0), vz = z + dz * (wide + 1) + (dx ? k : 0);
              for (let d = 0; d < 1 + r() * 4; d++) put(vx, top - 2 - d, vz, VINE[FACING_OF[`${dx},${dz}`]], true);
            }
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
        trunkExtras(h, 1);
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
        trunkExtras(h, 2);
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
      case 'boulder': {
        const rad = 1 + Math.floor(r() * 2);
        blob(x, y, z, rad, B.MOSSY_COBBLESTONE);
        if (r() < 0.5) blob(x + 1, y - 1, z + 1, rad, B.MOSSY_COBBLESTONE);
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
    plains: { wall: B.PLANKS, frame: B.LOG, log: 'log', base: B.COBBLESTONE, road: B.GRASS_PATH,
      stairs: 'oak_stairs', slab: 'oak_slab', door: 'oak_door', fence: B.OAK_FENCE, gate: 'oak_fence_gate' },
    taiga: { wall: B.SPRUCE_PLANKS, frame: B.SPRUCE_LOG, log: 'spruce_log', base: B.COBBLESTONE, road: B.GRASS_PATH,
      stairs: 'spruce_stairs', slab: 'spruce_slab', door: 'spruce_door', fence: B.SPRUCE_FENCE, gate: 'spruce_fence_gate' },
    savanna: { wall: B.ACACIA_PLANKS, frame: B.ACACIA_LOG, log: 'acacia_log', base: B.COBBLESTONE, road: B.GRASS_PATH,
      stairs: 'acacia_stairs', slab: 'acacia_slab', door: 'acacia_door', fence: B.ACACIA_FENCE, gate: 'acacia_fence_gate' },
    desert: { wall: B.SANDSTONE, frame: B.SMOOTH_SANDSTONE, log: 'log', base: B.SANDSTONE, road: B.SMOOTH_SANDSTONE,
      stairs: 'sandstone_stairs', slab: 'sandstone_slab', door: 'oak_door', fence: B.OAK_FENCE, gate: 'oak_fence_gate' },
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
      // world facing for a local direction (du along the road, dv away from it)
      const face = (du, dv) => FACING_OF[`${du * ax + dv * px},${du * az + dv * pz}`];
      for (let v = 0; v < d; v++) for (let u = 0; u < w; u++) {
        put(u, -2, v, style.base, OP_FILL_DOWN); // foundation down to the ground
        put(u, -1, v, style.base);
        for (let y = 0; y < 14; y++) put(u, y, v, B.AIR);  // clear trees and hills
      }
      draw(put, w, d, face);
    };
    const st = (base, state = {}) => stateId(base, state);
    const walls = (put, w, d, h, wall, frame, base = null) => {
      for (let y = 0; y < h; y++) for (let v = 0; v < d; v++) for (let u = 0; u < w; u++) {
        const edgeU = u === 0 || u === w - 1, edgeV = v === 0 || v === d - 1;
        if (!edgeU && !edgeV) continue;
        put(u, y, v, edgeU && edgeV ? frame : (y === 0 && base ? base : wall));
      }
    };
    const floor = (put, w, d, id) => { for (let v = 1; v < d - 1; v++) for (let u = 1; u < w - 1; u++) put(u, -1, v, id); };
    // A pitched roof of stairs sloping down to the front and back, with a
    // one-block overhang and the triangular gable ends filled in.
    const gableRoof = (put, face, w, d, y0, fill) => {
      for (let k = 0; ; k++) {
        const vf = k - 1, vb = d - k;
        if (vf > vb) break;
        for (let u = -1; u <= w; u++) {
          if (vf === vb) put(u, y0 + k, vf, st(style.slab, { half: 'bottom' }));
          else {
            put(u, y0 + k, vf, st(style.stairs, { half: 'bottom', facing: face(0, 1) }));
            put(u, y0 + k, vb, st(style.stairs, { half: 'bottom', facing: face(0, -1) }));
          }
        }
        for (let v = vf + 1; v < vb; v++) { put(0, y0 + k, v, fill); put(w - 1, y0 + k, v, fill); }
      }
    };
    const door = (put, face, u) => {
      put(u, 0, 0, st(style.door, { half: 'lower', open: false, facing: face(0, 1) }));
      put(u, 1, 0, st(style.door, { half: 'upper', open: false, facing: face(0, 1) }));
      put(u, 0, -1, B.AIR); put(u, 1, -1, B.AIR);
    };
    // A torch on a wall: (u, y, v) is the air cell, (du, dv) points away from the wall.
    const wallTorch = (put, face, u, y, v, du, dv) => put(u, y, v, st('wall_torch', { facing: face(du, dv) }));
    const bed = (put, face, u, v, color = 'red') => {
      put(u, 0, v, st(`${color}_bed`, { part: 'foot', facing: face(0, 1) }));
      put(u, 0, v + 1, st(`${color}_bed`, { part: 'head', facing: face(0, 1) }));
    };
    const BED_COLORS = ['red', 'white', 'light_blue', 'yellow', 'green', 'orange'];
    const CROPS = [['wheat_crop', 7], ['carrots', 3], ['potatoes', 3], ['beetroots', 3]];

    const TYPES = {
      house(put, w, d, face) {
        walls(put, w, d, 3, style.wall, style.frame, B.COBBLESTONE);
        floor(put, w, d, style.wall);
        gableRoof(put, face, w, d, 3, style.wall);
        door(put, face, 2);
        put(0, 1, 2, B.GLASS_PANE); put(0, 1, 3, B.GLASS_PANE); put(w - 1, 1, 2, B.GLASS_PANE); put(w - 1, 1, 3, B.GLASS_PANE);
        put(2, 1, d - 1, B.GLASS_PANE);
        bed(put, face, 1, d - 3, BED_COLORS[Math.floor(r() * BED_COLORS.length)]);
        put(3, 0, d - 2, B.CRAFTING_TABLE);
        wallTorch(put, face, 3, 2, d - 2, 0, -1);
        wallTorch(put, face, 1, 2, -1, 0, -1);
      },
      bighouse(put, w, d, face) {
        walls(put, w, d, 4, style.wall, style.frame, B.COBBLESTONE);
        floor(put, w, d, style.wall);
        gableRoof(put, face, w, d, 4, style.wall);
        door(put, face, 3);
        for (const v of [2, 3, d - 4, d - 3]) { put(0, 1, v, B.GLASS_PANE); put(0, 2, v, B.GLASS_PANE); put(w - 1, 1, v, B.GLASS_PANE); put(w - 1, 2, v, B.GLASS_PANE); }
        put(1, 1, 0, B.GLASS_PANE); put(5, 1, 0, B.GLASS_PANE);
        bed(put, face, 1, d - 3, BED_COLORS[Math.floor(r() * BED_COLORS.length)]);
        bed(put, face, 2, d - 3, BED_COLORS[Math.floor(r() * BED_COLORS.length)]);
        put(5, 0, d - 2, B.LOOT_CHEST); put(4, 0, d - 2, B.FURNACE); put(5, 0, d - 3, B.CRAFTING_TABLE);
        for (let u = 2; u <= 4; u++) for (let v = 2; v <= 3; v++) put(u, 0, v, B.RED_CARPET);
        wallTorch(put, face, 3, 2, d - 2, 0, -1); wallTorch(put, face, 1, 2, 1, 0, 1); wallTorch(put, face, 5, 2, 1, 0, 1);
        wallTorch(put, face, 2, 2, -1, 0, -1); wallTorch(put, face, 4, 2, -1, 0, -1);
      },
      library(put, w, d, face) {
        walls(put, w, d, 4, style.wall, style.frame, B.COBBLESTONE);
        floor(put, w, d, B.COBBLESTONE);
        gableRoof(put, face, w, d, 4, style.wall);
        door(put, face, 3);
        // shelves along the side walls, windows above them
        for (let v = 2; v < d - 1; v++) { put(1, 0, v, B.BOOKSHELF); put(w - 2, 0, v, B.BOOKSHELF); put(0, 2, v, B.GLASS_PANE); put(w - 1, 2, v, B.GLASS_PANE); }
        for (let u = 1; u < w - 1; u++) put(u, 0, d - 2, B.BOOKSHELF);
        put(3, 0, d - 3, B.CRAFTING_TABLE); put(2, 0, d - 3, st('oak_stairs', { half: 'bottom', facing: face(1, 0) }));
        wallTorch(put, face, 3, 2, d - 3, 0, -1); wallTorch(put, face, 2, 2, -1, 0, -1); wallTorch(put, face, 4, 2, -1, 0, -1);
      },
      smithy(put, w, d, face) {
        // a stone workshop at the back, a covered porch with a lava forge at the front
        for (let y = 0; y < 4; y++) for (let v = 3; v < d; v++) for (let u = 0; u < w; u++) {
          if (u === 0 || u === w - 1 || v === d - 1 || (v === 3 && u >= 3)) put(u, y, v, B.COBBLESTONE);
        }
        floor(put, w, d, B.COBBLESTONE);
        for (let u = 0; u < w; u++) put(u, -1, 0, B.COBBLESTONE);
        for (const u of [0, w - 1]) for (let y = 0; y < 4; y++) put(u, y, 0, style.frame);
        for (let u = 1; u < w - 1; u++) put(u, 0, 0, style.fence);
        put(3, 0, 0, B.AIR);
        for (let v = -1; v <= d; v++) for (let u = -1; u <= w; u++) put(u, 4, v, st('stone_slab', { half: 'bottom' }));
        put(1, -1, 1, B.LAVA); put(1, -1, 2, B.LAVA); put(1, 0, 1, B.IRON_BARS); put(1, 0, 2, B.IRON_BARS);
        put(w - 2, 0, 1, B.FURNACE); put(w - 2, 0, 2, B.FURNACE); put(w - 3, 0, 1, st('anvil', { facing: 'north' }));
        put(1, 0, d - 2, B.LOOT_CHEST); put(w - 2, 0, d - 2, B.CRAFTING_TABLE); put(2, 0, 4, B.AIR); put(2, 1, 4, B.AIR); put(2, 0, 3, B.AIR); put(2, 1, 3, B.AIR);
        wallTorch(put, face, 2, 2, d - 2, 0, -1);
      },
      church(put, w, d, face) {
        walls(put, w, d, 6, B.COBBLESTONE, B.STONE_BRICKS);
        floor(put, w, d, B.COBBLESTONE);
        door(put, face, 2);
        for (const v of [2, 4]) { put(0, 2, v, B.GLASS_PANE); put(0, 3, v, B.GLASS_PANE); put(w - 1, 2, v, B.GLASS_PANE); put(w - 1, 3, v, B.GLASS_PANE); }
        for (let v = -1; v <= d - 4; v++) for (let u = -1; u <= w; u++) put(u, 6, v, st('cobblestone_slab', { half: 'bottom' }));
        // the bell tower over the back three rows, with a ladder up inside
        for (let y = 6; y < 13; y++) for (let v = d - 3; v < d; v++) for (let u = 0; u < w; u++) {
          const edge = u === 0 || u === w - 1 || v === d - 3 || v === d - 1;
          if (edge) put(u, y, v, (y === 10 || y === 11) && (u === 2 || v === d - 2) ? B.AIR : B.COBBLESTONE);
          else if (y > 6) put(u, y, v, B.AIR);
        }
        for (let v = d - 4; v <= d; v++) for (let u = -1; u <= w; u++) put(u, 13, v, st('stone_brick_slab', { half: 'bottom' }));
        for (let y = 0; y < 12; y++) put(2, y, d - 2, st('ladder', { facing: face(0, -1) }));
        for (let u = 1; u < w - 1; u++) put(u, 6, d - 2, B.AIR);
        put(1, 0, 3, st(style.stairs, { half: 'bottom', facing: face(0, 1) })); put(3, 0, 3, st(style.stairs, { half: 'bottom', facing: face(0, 1) }));
        wallTorch(put, face, 1, 3, d - 4, 0, -1); wallTorch(put, face, 3, 3, d - 4, 0, -1);
        wallTorch(put, face, 1, 2, -1, 0, -1); wallTorch(put, face, 3, 2, -1, 0, -1);
      },
      farm(put, w, d) {
        // two crop beds either side of a water channel, framed with logs
        const crops = [CROPS[Math.floor(r() * CROPS.length)], CROPS[Math.floor(r() * CROPS.length)]];
        for (let v = 0; v < d; v++) for (let u = 0; u < w; u++) {
          const edge = u === 0 || u === w - 1 || v === 0 || v === d - 1;
          const water = u === Math.floor(w / 2) && !edge;
          put(u, -1, v, edge ? st(style.log, { axis: 'y' }) : water ? B.WATER : B.FARMLAND);
          if (!edge && !water) {
            const [base, max] = crops[u < w / 2 ? 0 : 1];
            put(u, 0, v, st(base, { age: Math.max(1, max - Math.floor(r() * 3)) }));
          }
        }
      },
      pen(put, w, d, face) {
        for (let v = 0; v < d; v++) for (let u = 0; u < w; u++) {
          put(u, -1, v, B.GRASS);
          if (u === 0 || u === w - 1 || v === 0 || v === d - 1) put(u, 0, v, style.fence);
        }
        put(3, 0, 0, st(style.gate, { open: false, facing: face(0, 1) }));
        put(1, 0, d - 2, B.HAY_BALE); put(2, 0, d - 2, B.HAY_BALE); put(1, 1, d - 2, B.HAY_BALE);
      },
      lamp(put, w, d, face) {
        put(0, 0, 0, style.fence); put(0, 1, 0, style.fence); put(0, 2, 0, style.fence); put(0, 3, 0, B.BLACK_WOOL);
        for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) wallTorch(put, face, du, 3, dv, du, dv);
      },
    };
    const SIZES = { house: [5, 6], bighouse: [7, 9], library: [7, 9], smithy: [7, 7], church: [5, 9], farm: [7, 9], pen: [7, 7], lamp: [1, 1] };
    const PICKS = ['house', 'house', 'house', 'bighouse', 'bighouse', 'library', 'farm', 'farm', 'farm', 'smithy', 'lamp', 'lamp', 'pen', 'church'];

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
      for (let y = 1; y < 3; y++) op(x, wy + y, z, (Math.abs(dx - 0.5) === 1.5 && Math.abs(dz - 0.5) === 1.5) ? style.fence : B.AIR);
      op(x, wy + 3, z, stateId('cobblestone_slab', { half: 'bottom' }));
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
    const blocks = new Uint16Array(CS * CS * CH); // 16-bit: block ids go past 255
    const ox = cx * CS, oz = cz * CS;
    const heights = new Int16Array(LAYER);
    const biomes = new Uint8Array(LAYER);
    const slopes = new Float32Array(LAYER);
    const idx = (x, y, z) => x + z * CS + y * LAYER;
    // Heights two blocks beyond the chunk edge too, to measure how steep each column is.
    const RW = CS + 4;
    const ring = new Int16Array(RW * RW);
    for (let z = -2; z < CS + 2; z++) for (let x = -2; x < CS + 2; x++) {
      if (x >= 0 && x < CS && z >= 0 && z < CS) continue;
      ring[(x + 2) + (z + 2) * RW] = column(ox + x, oz + z).height;
    }

    // ---- 2. columns ----
    const cols = [];
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const col = column(ox + x, oz + z);
      cols.push(col);
      heights[x + z * CS] = col.height;
      biomes[x + z * CS] = col.biome;
      ring[(x + 2) + (z + 2) * RW] = col.height;
    }
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const wx = ox + x, wz = oz + z;
        const col = cols[x + z * CS];
        const height = col.height, bi = col.biome, biome = BIOME_LIST[bi];
        // Steepness measured over 5 blocks, so single steps in the terrain don't
        // flip the surface back and forth between snow and rock (checkerboards).
        const rh = (dx, dz) => ring[(x + 2 + dx) + (z + 2 + dz) * RW];
        const slope = Math.max(Math.abs(rh(2, 0) - rh(-2, 0)), Math.abs(rh(0, 2) - rh(0, -2)),
          Math.abs(rh(2, 2) - rh(-2, -2)) * 0.7, Math.abs(rh(2, -2) - rh(-2, 2)) * 0.7) / 2;
        slopes[x + z * CS] = slope;
        const sn = nSurface.noise2(wx / 16, wz / 16);
        let top = B[biome.top.toUpperCase()], filler = B[biome.filler.toUpperCase()];
        const underwater = height < S;
        if (underwater && (top === B.GRASS || top === B.SNOWY_GRASS || top === B.PODZOL || top === B.MYCELIUM)) {
          top = bi === BIOME.SWAMP ? B.DIRT : sn > 0.3 ? B.GRAVEL : B.SAND; filler = B.DIRT;
        }
        if (bi === BIOME.OCEAN || bi === BIOME.RIVER) { if (sn > 0.35) { top = B.GRAVEL; filler = B.GRAVEL; } else if (sn < -0.5) { top = B.CLAY; } }
        if (MOUNTAIN_BIOMES.has(bi) || (height > S + 30 && col.rangeW > 0.2)) {
          // Mountains: steep faces are bare rock, gentle slopes keep their soil,
          // and above the snow line everything flat enough holds snow.
          // slope = blocks of rise per block across (1 = 45 degrees)
          const alt = height - S + sn * 6;
          const snowy = bi === BIOME.SNOWY_PEAKS || (alt > 70 && biome.snowy);
          const steep = slope > (snowy ? 2.4 : 1.5) + sn * 0.35; // snow clings to steeper slopes
          if (steep) { top = snowy && slope < 2.2 ? B.SNOW : sn > 0.6 ? B.GRAVEL : B.STONE; filler = B.STONE; }
          else if (snowy) { top = B.SNOW; filler = slope > 0.9 ? B.STONE : B.SNOW; }
          else if (bi === BIOME.STONY_PEAKS) { top = slope > 0.8 || sn > 0.2 ? B.STONE : B.SNOWY_GRASS; filler = B.STONE; }
          else if (slope > 1.1 + sn * 0.3) { top = sn > 0.5 ? B.GRAVEL : B.STONE; filler = B.STONE; }
          else if (alt > 58 && slope < 0.8) top = B.SNOWY_GRASS;
        } else if (slope > 2 && height > S + 6) { top = B.STONE; filler = B.STONE; } // cliffs elsewhere
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
    const mountainous = MOUNTAIN_BIOMES.has(biomes[8 + 8 * CS]);
    const ores = [
      // [block, veins per chunk, vein size, minY, maxY]
      [B.GRANITE, 2, 28, 5, 80], [B.DIORITE, 2, 28, 5, 80], [B.ANDESITE, 2, 28, 5, 80],
      [B.DIRT, 4, 16, 5, 80], [B.GRAVEL, 4, 16, 5, 70],
      [B.COAL_ORE, 16, 9, 5, 140], [B.IRON_ORE, 9, 6, 5, 66], [B.GOLD_ORE, 2.5, 6, 5, 30],
      [B.REDSTONE_ORE, 4, 6, 5, 16], [B.LAPIS_ORE, 1.2, 5, 8, 30], [B.DIAMOND_ORE, 1.3, 5, 4, 15],
      [B.EMERALD_ORE, mountainous ? 6 : 0, 1, 5, 120],
      [B.INFESTED_STONE, mountainous ? 7 : 0, 8, 5, 64],   // silverfish hide in mountain stone
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

    // ---- 4b. overhangs: hollows cut under steep hillsides, so cliffs lean out over you ----
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const k = x + z * CS, height = heights[k];
      if (slopes[k] < 1.1 || height < S + 8) continue;
      const wx = ox + x, wz = oz + z;
      for (let y = Math.max(S + 3, height - 9); y <= height - 3; y++) {
        // strongest a few blocks under the surface, fading out deeper down
        const depth = height - y;
        if (nOver.noise3(wx / 11, y / 6, wz / 11) > 0.42 + Math.abs(depth - 5) * 0.06) {
          const i = idx(x, y, z);
          if (blocks[i] !== B.BEDROCK && !IS_LIQUID[blocks[i]] && !IS_LIQUID[blocks[i + LAYER]]) blocks[i] = B.AIR;
        }
      }
    }

    // ---- 4c. a lake? ----
    const lake = lakeIn(cx, cz);
    if (lake) {
      const inside = (x, z, grow = 0) => ((x - lake.lx) / (lake.rx + grow)) ** 2 + ((z - lake.lz) / (lake.rz + grow)) ** 2;
      // the water settles at the lowest point of the rim, so it can't spill out
      let level = Infinity;
      for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) if (inside(x, z, 1.5) < 1 && inside(x, z) >= 1) level = Math.min(level, heights[x + z * CS]);
      level -= 1;
      const fluid = lake.lava ? B.LAVA : B.WATER;
      const cells = [];
      let ok = level > S && level >= heights[lake.lx + lake.lz * CS] - 8;
      for (let z = 0; z < CS && ok; z++) for (let x = 0; x < CS && ok; x++) {
        const d = inside(x, z);
        if (d >= 1) continue;
        const bottom = level - Math.max(1, Math.round(lake.depth * (1 - d)));
        cells.push([x, z, bottom]);
        // a cave or an overhang right next to the water would let it leak
        for (let y = bottom; y <= level && ok; y++) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= CS || nz >= CS || inside(nx, nz) < 1) continue;
          if (!IS_SOLID[blocks[idx(nx, y, nz)]]) ok = false;
        }
        if (!IS_SOLID[blocks[idx(x, bottom, z)]]) ok = false;
      }
      if (ok) {
        for (const [x, z, bottom] of cells) {
          const h = heights[x + z * CS];
          for (let y = bottom + 1; y <= Math.max(h, level + 1); y++) blocks[idx(x, y, z)] = y <= level ? (y === level && lake.snowy && !lake.lava ? B.ICE : fluid) : B.AIR;
          const floor = idx(x, bottom, z);
          if (lake.lava) blocks[floor] = B.STONE;
          else if (blocks[floor] === B.GRASS || blocks[floor] === B.SNOWY_GRASS) blocks[floor] = B.DIRT;
        }
        // lava bakes the ground around it to stone
        if (lake.lava) for (const [x, z, bottom] of cells) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= CS || nz >= CS) continue;
          for (let y = bottom; y <= level; y++) { const i = idx(nx, y, nz); if (blocks[i] !== B.LAVA && IS_SOLID[blocks[i]]) blocks[i] = B.STONE; }
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
        } else if (name === 'melon' || name === 'pumpkin') {
          if (SOIL.has(ground)) blocks[aboveI] = B[name.toUpperCase()];
        } else if (name.endsWith('mushroom')) {
          if (SOIL.has(ground)) blocks[aboveI] = B[name.toUpperCase()];
        } else if (ground === B.GRASS || ground === B.PODZOL) {
          blocks[aboveI] = B[name.toUpperCase()];
        }
        break;
      }
    }

    // ---- 6b. sugar cane along water's edge ----
    for (let z = 1; z < CS - 1; z++) for (let x = 1; x < CS - 1; x++) {
      const h = heights[x + z * CS];
      if (h < S - 1 || h > S + 1) continue;
      const ground = blocks[idx(x, h, z)];
      if (ground !== B.SAND && ground !== B.GRASS && ground !== B.DIRT) continue;
      if (blocks[idx(x, h + 1, z)] !== B.AIR) continue;
      const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => blocks[idx(x + dx, h, z + dz)] === B.WATER);
      if (!wet || hash2(seed ^ 0x5c4e, ox + x, oz + z) > 0.12) continue;
      const tall = 1 + Math.floor(hash2(seed ^ 0x5c4f, ox + x, oz + z) * 3);
      for (let y = 1; y <= tall; y++) blocks[idx(x, h + y, z)] = B.SUGAR_CANE;
    }

    // ---- 6c. dungeons: a mossy room with a monster cage and loot chests ----
    {
      const dr = mulberry32((hash2(seed ^ 0xd0e6, cx, cz) * 4294967296) >>> 0);
      if (dr() < 0.08) {
        const x0 = 2 + Math.floor(dr() * 5), z0 = 2 + Math.floor(dr() * 5), y0 = 12 + Math.floor(dr() * 36);
        const W = 7;
        let solid = 0;
        for (let dz = 0; dz < W; dz++) for (let dx = 0; dx < W; dx++) if (IS_SOLID[blocks[idx(x0 + dx, y0 - 1, z0 + dz)]]) solid++;
        if (solid > 40 && y0 + 5 < heights[x0 + 3 + (z0 + 3) * CS] - 4) {
          for (let dy = -1; dy <= 4; dy++) for (let dz = 0; dz < W; dz++) for (let dx = 0; dx < W; dx++) {
            const edge = dx === 0 || dz === 0 || dx === W - 1 || dz === W - 1 || dy === -1 || dy === 4;
            const i = idx(x0 + dx, y0 + dy, z0 + dz);
            if (edge) { if (IS_SOLID[blocks[i]] || dy === -1) blocks[i] = dr() < 0.35 ? B.MOSSY_COBBLESTONE : B.COBBLESTONE; }
            else blocks[i] = B.AIR;
          }
          blocks[idx(x0 + 3, y0, z0 + 3)] = B.SPAWNER;
          blocks[idx(x0 + 1, y0, z0 + 1 + Math.floor(dr() * 5))] = B.LOOT_CHEST;
          if (dr() < 0.5) blocks[idx(x0 + 5, y0, z0 + 1 + Math.floor(dr() * 5))] = B.LOOT_CHEST;
        }
      }
    }

    // ---- 6e. desert wells and buried fossils ----
    {
      const roll = hash2(seed ^ 0xde11, cx, cz);
      const mid = 8 + 8 * CS, h = heights[mid], bi = biomes[mid];
      if (bi === BIOME.DESERT && roll < 0.004 && h > S && Math.abs(heights[6 + 6 * CS] - h) <= 1 && Math.abs(heights[10 + 10 * CS] - h) <= 1) {
        // a little sandstone well with water in the middle
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          blocks[idx(8 + dx, h, 8 + dz)] = B.SANDSTONE;
          for (let y = h + 1; y <= h + 5; y++) blocks[idx(8 + dx, y, 8 + dz)] = B.AIR;
        }
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          blocks[idx(8 + dx, h + 1, 8 + dz)] = (dx || dz) ? B.SANDSTONE : B.WATER;
          if (Math.abs(dx) === 1 && Math.abs(dz) === 1) { blocks[idx(8 + dx, h + 2, 8 + dz)] = B.SANDSTONE; blocks[idx(8 + dx, h + 3, 8 + dz)] = B.SANDSTONE; }
          blocks[idx(8 + dx, h + 4, 8 + dz)] = (dx || dz) ? stateId('sandstone_slab', { half: 'bottom' }) : B.SANDSTONE;
        }
        blocks[idx(8, h, 8)] = B.WATER;
      } else if ((bi === BIOME.DESERT || bi === BIOME.SWAMP) && roll > 0.985 && B.BONE_BLOCK) {
        // the bones of something huge, deep in the rock: a spine and a row of ribs
        const y0 = 34 + Math.floor(hash2(seed ^ 0xf055, cx, cz) * 16);
        const bone = (x, y, z) => { const i = idx(x, y, z); if (IS_SOLID[blocks[i]] && blocks[i] !== B.BEDROCK) blocks[i] = B.BONE_BLOCK; };
        for (let x = 3; x <= 12; x++) {
          bone(x, y0 + 3, 8);
          if (x % 2 === 0 && x > 3 && x < 12) for (const s of [1, -1]) { bone(x, y0 + 3, 8 + s); bone(x, y0 + 2, 8 + 2 * s); bone(x, y0 + 1, 8 + 3 * s); bone(x, y0, 8 + 3 * s); }
        }
        bone(2, y0 + 3, 8); bone(1, y0 + 3, 8); bone(1, y0 + 2, 8); bone(13, y0 + 2, 8);
      }
    }

    // ---- 6d. structures: mineshafts, temples, huts, igloos, monuments, mansions ----
    for (const list of structures.opsForChunk(cx, cz)) {
      for (let k = 0; k < list.length; k += 5) {
        const lx = list[k] - ox, y = list[k + 1], lz = list[k + 2] - oz, id = list[k + 3], mode = list[k + 4];
        const i = idx(lx, y, lz), cur = blocks[i];
        if (mode === OP.SET) blocks[i] = id;
        else if (mode === OP.CARVE) { if (!IS_LIQUID[cur] && cur !== B.BEDROCK) blocks[i] = id; }
        else if (mode === OP.IF_AIR) { if (!IS_SOLID[cur]) blocks[i] = id; }
        else if (mode === OP.IF_SOLID) { if (IS_SOLID[cur] && cur !== B.BEDROCK) blocks[i] = id; }
        else if (mode === OP.SOFT) { if (SOFT[cur]) blocks[i] = id; }
        else if (mode === OP.FILL_DOWN) {
          for (let yy = y; yy > 0; yy--) {
            const j = idx(lx, yy, lz);
            if (IS_SOLID[blocks[j]] && !SOFT[blocks[j]]) break;
            blocks[j] = id;
          }
        }
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
        if (c.height > S + 1 && c.height < S + 30 && !bad.has(c.biome) && !isCave(x, c.height, z, c.height)) {
          return { x: x + 0.5, y: c.height + 1, z: z + 0.5 };
        }
      }
    }
    return { x: 0.5, y: CH - 20, z: 0.5 };
  }

  /** Grow a tree from a sapling: calls put(x, y, z, id, soft) for each block. */
  function growTree(kind, x, y, z, put) { drawFeature({ x, y, z, kind }, put); }

  const structures = createStructures(seed, column);
  /** Which monster a cage at (x, y, z) makes: cave spiders in mineshafts, else zombies, skeletons or spiders. */
  function spawnerMob(x, y, z) {
    if (structures.at(x, y, z) === 'mineshaft') return 'cave_spider';
    const h = hash3(seed ^ 0x5b, x, y, z);
    return h < 0.5 ? 'zombie' : h < 0.75 ? 'skeleton' : 'spider';
  }

  return { seed, column, generateChunk, findSpawn, villageNear, growTree, spawnerMob,
    structuresNear: (x, z, r) => structures.near(x, z, r), structureAt: (x, y, z) => structures.at(x, y, z),
    locateStructure: (kind, x, z) => (kind === 'village' ? villageNear(x, z, 4000) : structures.locate(kind, x, z)), STRUCTURE_KINDS: ['village', ...structures.kinds] };
}
