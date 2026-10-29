// ============================================================================
// Web Worker: terrain generation + lighting + meshing off the main thread.
// The main thread stays free for input and rendering, so the game never
// freezes while new chunks stream in.
//
// Messages in:  {type:'init', seed, faceLayers}
//               {type:'gen',  id, cx, cz}
//               {type:'mesh', id, cx, cz, chunks:[9 x Uint8Array]}
// Messages out: {id, blocks} | {id, mesh:{opaque, trans}}
// ============================================================================
import { createGenerator } from '../../shared/terrain.js';
import { initMesher, meshChunk } from './mesher.js';
import { BIOME_LIST, BIOME } from '../../shared/biomes.js';
import { SEA_LEVEL } from '../../shared/config.js';

// ---- Far terrain ("distant horizons") ----------------------------------------
// A coarse height grid around the player, coloured by what the ground would be
// (snow, rock, forest, grass, sand, water). The main thread turns it into one
// low-detail mesh drawn beyond the real chunks, so mountains far away still show.
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
function farTerrain(cx, cz, radius, step) {
  const n = Math.floor((radius * 2) / step) + 1;
  const h = new Float32Array(n * n), col = new Uint8Array(n * n * 3);
  const biome = new Uint8Array(n * n);
  const x0 = cx - radius, z0 = cz - radius;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const c = generator.column(x0 + i * step, z0 + j * step);
    h[i + j * n] = c.height; biome[i + j * n] = c.biome;
  }
  const S = SEA_LEVEL;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = i + j * n, y = h[k], b = BIOME_LIST[biome[k]];
    const hl = h[Math.max(0, i - 1) + j * n], hr = h[Math.min(n - 1, i + 1) + j * n];
    const hu = h[i + Math.max(0, j - 1) * n], hd = h[i + Math.min(n - 1, j + 1) * n];
    const slope = Math.max(Math.abs(hr - hl), Math.abs(hd - hu)) / (2 * step); // rise per block
    const alt = y - S;
    let c;
    if (y < S) { c = [46, 92, 170]; h[k] = S + 0.9; }
    else if ((b.id === BIOME.SNOWY_PEAKS || (b.snowy && alt > 60) || alt > 112) && slope < 2.6) c = [236, 242, 248];
    else if (slope > 1.3 || b.id === BIOME.STONY_PEAKS) c = alt > 90 && slope < 2.2 ? [214, 220, 228] : [122, 120, 118];
    else if (b.top === 'sand') c = [218, 205, 150];
    else if (b.top === 'red_sand') c = [190, 104, 52];
    else if (b.snowy) c = [228, 236, 242];
    else {
      const g = hex(b.grass), f = hex(b.foliage);
      const forest = b.trees[0] > 0.3;
      c = forest ? f.map(v => v * 0.62) : g.map(v => v * 0.92);
      if (forest) h[k] += 4; // the tree canopy
    }
    col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
  }
  return { n, step, x0, z0, h, col };
}

let generator = null;

// Biome of every column of a chunk (for grass/leaf colours), cached because
// a chunk is often re-meshed after edits.
const biomeCache = new Map();
function biomesFor(cx, cz) {
  const key = cx + ',' + cz;
  let b = biomeCache.get(key);
  if (!b) {
    b = new Uint8Array(256);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) b[x + z * 16] = generator.column(cx * 16 + x, cz * 16 + z).biome;
    biomeCache.set(key, b);
    if (biomeCache.size > 1024) biomeCache.delete(biomeCache.keys().next().value);
  }
  return b;
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    generator = createGenerator(msg.seed);
    biomeCache.clear();
    initMesher(msg.faceLayers);
    return;
  }
  if (msg.type === 'far') {
    const far = farTerrain(msg.cx, msg.cz, msg.radius, msg.step);
    self.postMessage({ id: msg.id, far }, [far.h.buffer, far.col.buffer]);
    return;
  }
  if (msg.type === 'gen') {
    const blocks = generator.generateChunk(msg.cx, msg.cz);
    self.postMessage({ id: msg.id, blocks }, [blocks.buffer]);
    return;
  }
  if (msg.type === 'mesh') {
    const mesh = meshChunk(msg.chunks, biomesFor(msg.cx, msg.cz));
    const transfer = [];
    for (const part of [mesh.opaque, mesh.trans]) {
      transfer.push(part.pos.buffer, part.uv.buffer, part.data.buffer, part.tint.buffer, part.idx.buffer);
    }
    self.postMessage({ id: msg.id, mesh }, transfer);
  }
};
