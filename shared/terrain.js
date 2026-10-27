// ============================================================================
// Procedural terrain generator.
//
// Given a seed and a chunk coordinate this returns the chunk's blocks. It is a
// *pure function* of (seed, cx, cz): the browser workers and the server can
// both generate any chunk and get exactly the same result, so the network
// only needs to carry player edits, never whole chunks.
//
// Pipeline for each column (x, z):
//   1. Height: large-scale "continent" noise + detail noise scaled by a
//      "hilliness" noise, so flat plains and steep hills blend smoothly.
//   2. Biome: from temperature and humidity noise (plus hilliness).
//   3. Fill: bedrock -> stone -> dirt/sand -> surface block -> water.
//   4. Caves: 3D noise "spaghetti tunnels" carved out of the solid ground.
//   5. Ores: random-walk veins at depth-dependent heights.
//   6. Decoration: trees, cactus, flowers, tall grass.
// ============================================================================
import { CHUNK_SIZE as CS, CHUNK_HEIGHT as CH, SEA_LEVEL } from './config.js';
import { B } from './blocks.js';
import { Simplex, hashSeed, hash2, hash3, mulberry32 } from './noise.js';

const LAYER = CS * CS;

export const BIOMES = { PLAINS: 0, FOREST: 1, DESERT: 2, SNOW: 3, HILLS: 4 };
export const BIOME_NAMES = ['Plains', 'Forest', 'Desert', 'Snowy Tundra', 'Hills'];

// Cave noise is sampled on a coarse grid and interpolated (much cheaper than
// evaluating 3D noise for all 32,768 blocks of a chunk).
const CAVE_STEP_XZ = 4;
const CAVE_STEP_Y = 4;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function createGenerator(seedInput) {
  const seed = hashSeed(seedInput);
  const nContinent = new Simplex(seed);
  const nDetail = new Simplex(seed + 1);
  const nHill = new Simplex(seed + 2);
  const nTemp = new Simplex(seed + 3);
  const nHum = new Simplex(seed + 4);
  const nCaveA = new Simplex(seed + 5);
  const nCaveB = new Simplex(seed + 6);
  const nCavern = new Simplex(seed + 7);
  const nSurface = new Simplex(seed + 8);

  /** Terrain height and biome for one column. Cheap enough to call often. */
  function column(x, z) {
    const continent = nContinent.fbm2(x / 700, z / 700, 4);         // -1..1
    const hilly = smoothstep(-0.1, 0.6, nHill.fbm2(x / 450, z / 450, 2)); // 0..1
    const detail = nDetail.fbm2(x / 110, z / 110, 4);
    let h = SEA_LEVEL + 5 + continent * 16 + detail * (5 + hilly * hilly * 42);
    h = Math.floor(clamp(h, 6, CH - 24));

    const temp = nTemp.fbm2(x / 800, z / 800, 2);
    const hum = nHum.fbm2(x / 600, z / 600, 2);
    let biome;
    if (temp < -0.25) biome = BIOMES.SNOW;
    else if (temp > 0.25 && hum < 0.1) biome = BIOMES.DESERT;
    else if (hilly > 0.55) biome = BIOMES.HILLS;
    else if (hum > 0.05) biome = BIOMES.FOREST;
    else biome = BIOMES.PLAINS;
    return { height: h, biome };
  }

  // ---- Caves -------------------------------------------------------------
  // Two 3D noise fields; a tunnel exists where BOTH are close to zero, which
  // traces out long winding tubes ("spaghetti caves"). A third field opens
  // larger caverns deep underground.
  function caveSample(x, y, z) {
    const a = nCaveA.noise3(x / 48, y / 32, z / 48);
    const b = nCaveB.noise3(x / 48, y / 32, z / 48);
    let v = a * a + b * b;                       // small inside tunnels
    const cav = nCavern.noise3(x / 70, y / 40, z / 70);
    if (y < 40) v = Math.min(v, (0.75 - cav) * 0.08); // caverns below y=40
    return v;
  }
  const CAVE_THRESHOLD = 0.012;

  /**
   * Interpolated cave value at a single block, using the same grid points and
   * the same arithmetic order as the per-chunk grid below. This guarantees
   * identical results, which matters when deciding whether a tree in a
   * neighbouring chunk has solid ground under it.
   */
  function caveAt(x, y, z) {
    const gx = Math.floor(x / CAVE_STEP_XZ) * CAVE_STEP_XZ;
    const gy = Math.floor(y / CAVE_STEP_Y) * CAVE_STEP_Y;
    const gz = Math.floor(z / CAVE_STEP_XZ) * CAVE_STEP_XZ;
    const c000 = caveSample(gx, gy, gz), c100 = caveSample(gx + CAVE_STEP_XZ, gy, gz);
    const c010 = caveSample(gx, gy + CAVE_STEP_Y, gz), c110 = caveSample(gx + CAVE_STEP_XZ, gy + CAVE_STEP_Y, gz);
    const c001 = caveSample(gx, gy, gz + CAVE_STEP_XZ), c101 = caveSample(gx + CAVE_STEP_XZ, gy, gz + CAVE_STEP_XZ);
    const c011 = caveSample(gx, gy + CAVE_STEP_Y, gz + CAVE_STEP_XZ), c111 = caveSample(gx + CAVE_STEP_XZ, gy + CAVE_STEP_Y, gz + CAVE_STEP_XZ);
    return trilerp(c000, c100, c010, c110, c001, c101, c011, c111,
      (x - gx) / CAVE_STEP_XZ, (y - gy) / CAVE_STEP_Y, (z - gz) / CAVE_STEP_XZ);
  }

  function trilerp(c000, c100, c010, c110, c001, c101, c011, c111, fx, fy, fz) {
    const x00 = lerp(c000, c100, fx), x10 = lerp(c010, c110, fx);
    const x01 = lerp(c001, c101, fx), x11 = lerp(c011, c111, fx);
    return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
  }

  /** Can a cave carve block (y) in a column of this height? */
  function caveAllowed(y, height) {
    if (y < 3 || y > height) return false;
    // Near/below sea level, keep a solid crust so oceans don't leak into caves.
    if (height <= SEA_LEVEL + 2 && y > height - 5) return false;
    return true;
  }

  function isCave(x, y, z, height) {
    return caveAllowed(y, height) && caveAt(x, y, z) < CAVE_THRESHOLD;
  }

  // ---- Trees -------------------------------------------------------------
  // The world is divided into 5x5 cells. Each cell has one candidate tree
  // position chosen by hashing the cell coordinate; the biome decides how
  // likely a tree is. This spreads trees out evenly without any storage.
  const TREE_CELL = 5;
  const TREE_CHANCE = [0.07, 0.75, 0, 0.3, 0.18]; // per biome

  function treeInCell(cellX, cellZ) {
    const r = hash2(seed ^ 0x51ed, cellX, cellZ);
    const tx = cellX * TREE_CELL + Math.floor(hash2(seed ^ 0xa11, cellX, cellZ) * TREE_CELL);
    const tz = cellZ * TREE_CELL + Math.floor(hash2(seed ^ 0xb22, cellX, cellZ) * TREE_CELL);
    const col = column(tx, tz);
    if (r >= TREE_CHANCE[col.biome]) return null;
    if (col.height <= SEA_LEVEL + 1) return null;               // no trees on beaches
    if (col.biome === BIOMES.HILLS && col.height > 88) return null; // bare rock peaks
    if (isCave(tx, col.height, tz, col.height)) return null;     // ground was carved away
    const trunk = 4 + Math.floor(hash2(seed ^ 0xc33, tx, tz) * 3);
    return { x: tx, z: tz, y: col.height + 1, trunk, biome: col.biome };
  }

  // ---- Main entry point ---------------------------------------------------
  function generateChunk(cx, cz) {
    const blocks = new Uint8Array(CS * CS * CH);
    const ox = cx * CS, oz = cz * CS;
    const heights = new Int16Array(LAYER);
    const biomes = new Uint8Array(LAYER);

    // 1-3: columns
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const wx = ox + x, wz = oz + z;
        const { height, biome } = column(wx, wz);
        heights[x + z * CS] = height;
        biomes[x + z * CS] = biome;
        const surfaceNoise = nSurface.noise2(wx / 16, wz / 16);
        const beach = height <= SEA_LEVEL + 1 && height >= SEA_LEVEL - 3;
        const underwater = height < SEA_LEVEL;

        let top, filler;
        if (biome === BIOMES.DESERT) { top = B.SAND; filler = B.SAND; }
        else if (underwater) { top = surfaceNoise > 0.2 ? B.GRAVEL : height < SEA_LEVEL - 4 ? B.DIRT : B.SAND; filler = top === B.GRAVEL ? B.GRAVEL : B.DIRT; }
        else if (beach) { top = B.SAND; filler = B.SAND; }
        else if (biome === BIOMES.SNOW) { top = B.SNOWY_GRASS; filler = B.DIRT; }
        else if (biome === BIOMES.HILLS && height > 96) { top = B.SNOW; filler = B.STONE; }
        else if (biome === BIOMES.HILLS && height > 84 + surfaceNoise * 4) { top = B.STONE; filler = B.STONE; }
        else { top = B.GRASS; filler = B.DIRT; }
        const fillerDepth = 3 + Math.floor((surfaceNoise + 1) * 1.5);

        for (let y = 0; y <= height; y++) {
          let id;
          if (y === 0) id = B.BEDROCK;
          else if (y < 4 && hash3(seed, wx, y, wz) < 0.6 - y * 0.15) id = B.BEDROCK;
          else if (y === height) id = top;
          else if (y > height - fillerDepth) id = filler;
          else if (biome === BIOMES.DESERT && y > height - fillerDepth - 3) id = B.SANDSTONE;
          else id = B.STONE;
          blocks[x + z * CS + y * LAYER] = id;
        }
        // Water fills the gap between the ground and sea level.
        for (let y = height + 1; y <= SEA_LEVEL; y++) {
          blocks[x + z * CS + y * LAYER] = (y === SEA_LEVEL && biome === BIOMES.SNOW) ? B.ICE : B.WATER;
        }
      }
    }

    // 4: caves. Sample a coarse grid of the cave field covering the chunk...
    const gw = CS / CAVE_STEP_XZ + 1;
    const gh = CH / CAVE_STEP_Y + 1;
    // Float64 (not Float32) so values match caveAt() bit-for-bit.
    const grid = new Float64Array(gw * gw * gh);
    for (let gy = 0; gy < gh; gy++)
      for (let gz = 0; gz < gw; gz++)
        for (let gx = 0; gx < gw; gx++)
          grid[gx + gz * gw + gy * gw * gw] = caveSample(ox + gx * CAVE_STEP_XZ, gy * CAVE_STEP_Y, oz + gz * CAVE_STEP_XZ);
    // ...then interpolate per block and carve.
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const height = heights[x + z * CS];
        const gx = Math.floor(x / CAVE_STEP_XZ), gz = Math.floor(z / CAVE_STEP_XZ);
        const fx = (x - gx * CAVE_STEP_XZ) / CAVE_STEP_XZ, fz = (z - gz * CAVE_STEP_XZ) / CAVE_STEP_XZ;
        for (let y = 3; y <= height; y++) {
          if (!caveAllowed(y, height)) continue;
          const gy = Math.floor(y / CAVE_STEP_Y);
          const fy = (y - gy * CAVE_STEP_Y) / CAVE_STEP_Y;
          const b0 = gx + gz * gw + gy * gw * gw;   // grid index of corner (0,0,0)
          const up = gw * gw, south = gw;
          const v = trilerp(grid[b0], grid[b0 + 1], grid[b0 + up], grid[b0 + up + 1],
            grid[b0 + south], grid[b0 + south + 1], grid[b0 + up + south], grid[b0 + up + south + 1], fx, fy, fz);
          if (v < CAVE_THRESHOLD) {
            const i = x + z * CS + y * LAYER;
            if (blocks[i] !== B.BEDROCK) blocks[i] = B.AIR;
          }
        }
      }
    }

    // 5: ores. Random-walk veins kept inside this chunk.
    const rand = mulberry32(hash2(seed ^ 0x0e5, cx, cz) * 4294967296 >>> 0);
    const ores = [
      // [block, veins per chunk, vein size, minY, maxY]
      [B.COAL_ORE, 16, 9, 5, 110],
      [B.IRON_ORE, 9, 6, 5, 60],
      [B.GOLD_ORE, 3, 5, 5, 30],
      [B.DIAMOND_ORE, 1.5, 4, 4, 15],
      [B.GRAVEL, 6, 10, 5, 70],
      [B.DIRT, 6, 10, 5, 80],
    ];
    for (const [ore, count, size, minY, maxY] of ores) {
      let n = Math.floor(count) + (rand() < count % 1 ? 1 : 0);
      while (n-- > 0) {
        let x = Math.floor(rand() * CS), z = Math.floor(rand() * CS);
        let y = minY + Math.floor(rand() * (maxY - minY));
        for (let s = 0; s < size; s++) {
          const i = x + z * CS + y * LAYER;
          if (blocks[i] === B.STONE) blocks[i] = ore;
          // wander one step in a random axis direction, clamped to the chunk
          const dir = Math.floor(rand() * 6);
          if (dir === 0) x = Math.min(CS - 1, x + 1); else if (dir === 1) x = Math.max(0, x - 1);
          else if (dir === 2) z = Math.min(CS - 1, z + 1); else if (dir === 3) z = Math.max(0, z - 1);
          else if (dir === 4) y = Math.min(maxY, y + 1); else y = Math.max(minY, y - 1);
        }
      }
    }

    // 6: decorations.
    const set = (x, y, z, id, onlyAir) => {
      if (x < 0 || x >= CS || z < 0 || z >= CS || y < 0 || y >= CH) return;
      const i = x + z * CS + y * LAYER;
      if (onlyAir && blocks[i] !== B.AIR && blocks[i] !== B.TALL_GRASS) return;
      blocks[i] = id;
    };
    // Trees can overlap chunk borders (leaves reach 2 blocks out), so look at
    // tree cells slightly beyond this chunk and draw the parts that fall inside.
    const minCell = Math.floor((ox - 3) / TREE_CELL), maxCell = Math.floor((ox + CS + 3) / TREE_CELL);
    const minCellZ = Math.floor((oz - 3) / TREE_CELL), maxCellZ = Math.floor((oz + CS + 3) / TREE_CELL);
    for (let czc = minCellZ; czc <= maxCellZ; czc++) {
      for (let cxc = minCell; cxc <= maxCell; cxc++) {
        const t = treeInCell(cxc, czc);
        if (!t) continue;
        const lx = t.x - ox, lz = t.z - oz;
        const top = t.y + t.trunk - 1;
        const tall = t.biome === BIOMES.SNOW; // narrower, taller "spruce-like" canopy
        // canopy
        for (let dy = -2; dy <= 1; dy++) {
          const r = tall ? (dy <= -1 ? 2 : 1) : (dy <= -1 ? 2 : 1);
          for (let dz = -r; dz <= r; dz++) {
            for (let dx = -r; dx <= r; dx++) {
              const corner = Math.abs(dx) === r && Math.abs(dz) === r;
              if (corner && (dy === 1 || hash3(seed ^ 0x1eaf, t.x + dx, top + dy, t.z + dz) < 0.5)) continue;
              set(lx + dx, top + dy, lz + dz, B.LEAVES, true);
            }
          }
        }
        if (tall) set(lx, top + 2, lz, B.LEAVES, true);
        // trunk (drawn after leaves so it overwrites them)
        for (let y = t.y; y <= top; y++) set(lx, y, lz, B.LOG, false);
        set(lx, t.y - 1, lz, B.DIRT, false);
      }
    }

    // Single-column decorations inside this chunk only.
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const wx = ox + x, wz = oz + z;
        const h = heights[x + z * CS];
        const biome = biomes[x + z * CS];
        if (h + 1 >= CH) continue;
        const ground = blocks[x + z * CS + h * LAYER];
        const above = blocks[x + z * CS + (h + 1) * LAYER];
        if (above !== B.AIR) continue;
        const r = hash2(seed ^ 0xf10, wx, wz);
        if (ground === B.SAND && biome === BIOMES.DESERT && h > SEA_LEVEL + 1) {
          if (r < 0.006) {
            const tall = 1 + Math.floor(hash2(seed ^ 0xca7, wx, wz) * 3);
            for (let y = 1; y <= tall; y++) set(x, h + y, z, B.CACTUS, true);
          }
        } else if (ground === B.GRASS) {
          if (r < 0.006) set(x, h + 1, z, B.RED_FLOWER, true);
          else if (r < 0.012) set(x, h + 1, z, B.YELLOW_FLOWER, true);
          else if (r < (biome === BIOMES.PLAINS ? 0.14 : 0.05)) set(x, h + 1, z, B.TALL_GRASS, true);
        }
      }
    }
    return blocks;
  }

  /** Find a dry place near the origin for players to spawn. */
  function findSpawn() {
    for (let r = 0; r < 400; r += 8) {
      for (let a = 0; a < 8; a++) {
        const x = Math.round(r * [1, 0.7, 0, -0.7, -1, -0.7, 0, 0.7][a]);
        const z = Math.round(r * [0, 0.7, 1, 0.7, 0, -0.7, -1, -0.7][a]);
        const c = column(x, z);
        if (c.height > SEA_LEVEL + 1 && !isCave(x, c.height, z, c.height)) {
          return { x: x + 0.5, y: c.height + 1, z: z + 0.5 };
        }
      }
    }
    return { x: 0.5, y: CH - 20, z: 0.5 };
  }

  return { seed, column, generateChunk, findSpawn };
}
