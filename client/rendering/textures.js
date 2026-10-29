// ============================================================================
// Procedural pixel-art textures. Nothing is loaded from disk: every 16x16
// block texture and item icon is "painted" here at startup from code, using a
// seeded random generator so the art is the same every time.
//
// A texture name is "painter:param:param", e.g. "planks:#a8864f" runs the
// `planks` painter with that colour. Many blocks share one painter.
//
// Biome tinting: grass, leaves, ferns etc. are painted in GREY and their
// pixels get alpha = 230 (instead of 255). The chunk shader multiplies those
// pixels by the biome's grass/foliage colour, so one texture serves every biome.
//
// Output:
//   - One RGBA buffer holding every texture as a layer of a WebGL2 texture
//     array (so merged "greedy" quads can repeat a tile with GL_REPEAT).
//   - A table: block id + face -> layer number, used by the mesher.
//   - Icon images (data URLs) for the hotbar/inventory UI.
// ============================================================================
import { BLOCKS, MAX_ID, SHAPE, BOXES } from '../../shared/blocks.js';
import { dynamicBoxes } from '../../shared/shapes.js';
import { ITEMS } from '../../shared/items.js';
import { BIOME_LIST, BIOME } from '../../shared/biomes.js';
import { mulberry32, hashSeed } from '../../shared/noise.js';

const S = 16;       // texture size in pixels
const TA = 230;     // alpha value that marks a pixel as "tint me"

// ---- Tiny pixel-painting toolkit ------------------------------------------
class Img {
  constructor() { this.d = new Uint8ClampedArray(S * S * 4); }
  set(x, y, [r, g, b, a = 255]) {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    this.d[i] = r; this.d[i + 1] = g; this.d[i + 2] = b; this.d[i + 3] = a;
  }
  get(x, y) { const i = (y * S + x) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]]; }
}

function hex(h) {
  const n = parseInt(String(h).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade([r, g, b, a = 255], f) { return [r * f, g * f, b * f, a]; }
function mix(c1, c2, t) { return [0, 1, 2].map(i => c1[i] + (c2[i] - c1[i]) * t).concat(255); }
const grey = (v) => [v, v, v, TA];                   // a tintable grey pixel
const T = (c) => [c[0], c[1], c[2], TA];              // mark a colour as tintable

function fill(img, fn) { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) img.set(x, y, fn(x, y)); }
function noisy(img, base, jitter, rand) { fill(img, () => shade(base, 1 - jitter + rand() * jitter * 2)); }
function speckle(img, color, chance, rand) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (rand() < chance) img.set(x, y, shade(color, 0.85 + rand() * 0.3));
}
function clear(img) { img.d.fill(0); }
function frame(img, c) { for (let i = 0; i < S; i++) { img.set(i, 0, c); img.set(i, 15, c); img.set(0, i, c); img.set(15, i, c); } }
function oreSpots(img, color, rand) {
  // A few clusters, each a little nugget with a shiny top-left and a dark rim.
  const light = shade(color, 1.3), dark = shade(color, 0.62);
  for (let n = 0; n < 5; n++) {
    const cx = 1 + Math.floor(rand() * 12), cy = 1 + Math.floor(rand() * 12);
    const shape = [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [1, 2]].filter((_, i) => i < 3 || rand() < 0.6);
    for (const [dx, dy] of shape) img.set(cx + dx, cy + dy, color);
    for (const [dx, dy] of shape) if (!shape.some(([ex, ey]) => ex === dx + 1 && ey === dy) && rand() < 0.7) img.set(cx + dx + 1, cy + dy, dark);
    img.set(cx, cy, light);
  }
}
/** Rounded "stones with mortar" pattern (a cheap tiling Voronoi). */
function cells(img, r, colors, mortar, count) {
  const pts = [];
  for (let i = 0; i < count; i++) pts.push([r() * S, r() * S, colors[i % colors.length]]);
  fill(img, (x, y) => {
    let d1 = 1e9, d2 = 1e9, c = null;
    for (const [px, py, pc] of pts) {
      let dx = Math.abs(x - px); dx = Math.min(dx, S - dx);
      let dy = Math.abs(y - py); dy = Math.min(dy, S - dy);
      const d = dx * dx + dy * dy;
      if (d < d1) { d2 = d1; d1 = d; c = pc; } else if (d < d2) d2 = d;
    }
    if (Math.sqrt(d2) - Math.sqrt(d1) < 1.1) return shade(mortar, 0.9 + r() * 0.2);
    // domed stones: lighter in the middle, darker toward the mortar
    return shade(c, (1.1 - Math.min(Math.sqrt(d1), 5) * 0.045) * (0.93 + r() * 0.12));
  });
}
function moss(img, r, amount = 0.35) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (r() < amount * (0.5 + 0.5 * Math.sin((x + y * 0.7) * 0.8))) img.set(x, y, shade(hex('#4f7a2e'), 0.8 + r() * 0.35));
  }
}
function stem(img, x0, y0, color = hex('#3f7f2a')) { for (let y = y0; y < 16; y++) img.set(x0, y, color); }
function rect(img, x0, y0, x1, y1, c, r = null, amt = 0.1) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.set(x, y, r ? shade(c, 1 - amt + r() * amt * 2) : c);
}
/** Turn the picture n quarter-turns clockwise (sideways logs, beds facing east...). */
function rotate(img, n) {
  for (let k = 0; k < n; k++) {
    const src = new Img(); src.d.set(img.d);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) img.set(S - 1 - y, x, src.get(x, y));
  }
}
/** Soft "value noise": random values on a coarse grid, smoothly blended. Gives blotches instead of salt-and-pepper. */
function blotches(r, cell = 4) {
  const n = S / cell, g = [];
  for (let i = 0; i < n * n; i++) g.push(r());
  const at = (i, j) => g[((j + n) % n) * n + ((i + n) % n)];
  return (x, y) => {
    const fx = x / cell, fy = y / cell, i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx, b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return a + (b - a) * sy;
  };
}
/** Small irregular clump of pixels around (cx, cy). */
function clump(img, cx, cy, size, colorFn, r) {
  img.set(cx, cy, colorFn());
  for (let k = 1; k < size; k++) {
    const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1]][Math.floor(r() * 6)];
    cx = (cx + dx + S) % S; cy = (cy + dy + S) % S;
    img.set(cx, cy, colorFn());
  }
}

// ---- Painters: one function per texture name -------------------------------
// Each painter gets (img, rand, ...params).
const PAINTERS = {
  dirt(img, r) {
    const b = blotches(r), base = hex('#866043');
    fill(img, (x, y) => shade(base, 0.88 + b(x, y) * 0.16 + r() * 0.06));
    for (let k = 0; k < 9; k++) clump(img, Math.floor(r() * S), Math.floor(r() * S), 2 + Math.floor(r() * 2), () => shade(hex('#6a4a31'), 0.9 + r() * 0.15), r);
    for (let k = 0; k < 7; k++) img.set(Math.floor(r() * S), Math.floor(r() * S), shade(hex('#a3805a'), 0.95 + r() * 0.1));
    for (let k = 0; k < 3; k++) img.set(Math.floor(r() * S), Math.floor(r() * S), hex('#8c8682'));
  },
  coarse_dirt(img, r) { PAINTERS.dirt(img, r); speckle(img, hex('#4a3626'), 0.18, r); speckle(img, hex('#9a8a7a'), 0.05, r); },
  grass_top(img, r) {
    const b = blotches(r);
    fill(img, (x, y) => grey(160 + b(x, y) * 35 + r() * 22));
    // little blades: a dark root pixel with a bright tip above it
    for (let k = 0; k < 34; k++) {
      const x = Math.floor(r() * S), y = Math.floor(r() * S);
      img.set(x, y, grey(132 + r() * 18)); img.set(x, y - 1, grey(205 + r() * 25));
    }
  },
  grass_side(img, r) {
    PAINTERS.dirt(img, r);
    for (let x = 0; x < S; x++) {
      // a ragged fringe: most columns 3-4 deep, some drip down further
      let depth = 3 + Math.floor(r() * 2);
      if (r() < 0.25) depth += 1 + Math.floor(r() * 2);
      for (let y = 0; y < depth; y++) img.set(x, y, grey(y === depth - 1 ? 140 + r() * 15 : 165 + r() * 45));
    }
  },
  snowy_grass_side(img, r) {
    PAINTERS.dirt(img, r);
    for (let x = 0; x < S; x++) { const depth = 3 + Math.floor(r() * 2.5); for (let y = 0; y < depth; y++) img.set(x, y, shade(hex('#f4fbff'), 0.9 + r() * 0.1)); }
  },
  podzol_top(img, r) { noisy(img, hex('#6a4a22'), 0.15, r); speckle(img, hex('#8a6a30'), 0.25, r); speckle(img, hex('#3e2a12'), 0.12, r); },
  podzol_side(img, r) { PAINTERS.dirt(img, r); for (let x = 0; x < S; x++) { const d = 2 + Math.floor(r() * 2); for (let y = 0; y < d; y++) img.set(x, y, shade(hex('#6a4a22'), 0.85 + r() * 0.3)); } },
  mycelium_top(img, r) { noisy(img, hex('#7a6a78'), 0.12, r); speckle(img, hex('#9a8aa0'), 0.2, r); speckle(img, hex('#5a4a58'), 0.1, r); },
  mycelium_side(img, r) { PAINTERS.dirt(img, r); for (let x = 0; x < S; x++) { const d = 2 + Math.floor(r() * 3); for (let y = 0; y < d; y++) img.set(x, y, shade(hex('#7a6a78'), 0.85 + r() * 0.3)); } },
  stone(img, r) {
    const b = blotches(r), base = hex('#7f7f7f');
    fill(img, (x, y) => shade(base, 0.9 + b(x, y) * 0.14 + r() * 0.05));
    for (let n = 0; n < 9; n++) clump(img, Math.floor(r() * S), Math.floor(r() * S), 2 + Math.floor(r() * 3), () => shade(hex('#6c6c6c'), 0.95 + r() * 0.08), r);
    for (let n = 0; n < 5; n++) { const x = Math.floor(r() * S), y = Math.floor(r() * S); img.set(x, y, hex('#959595')); img.set(x + 1, y, hex('#8d8d8d')); }
  },
  cobblestone(img, r, variant) { cells(img, r, [hex('#8a8a8a'), hex('#6f6f6f'), hex('#9a9a9a')], hex('#4c4c4c'), 7); if (variant === 'mossy') moss(img, r); },
  speckled(img, r, base, light, dark) { noisy(img, hex(base), 0.07, r); speckle(img, hex(light), 0.14, r); speckle(img, hex(dark), 0.12, r); },
  polished(img, r, base) {
    const c = hex(base);
    noisy(img, c, 0.04, r);
    for (let i = 0; i < S; i++) { img.set(i, 0, shade(c, 1.15)); img.set(0, i, shade(c, 1.15)); img.set(i, 15, shade(c, 0.75)); img.set(15, i, shade(c, 0.75)); }
  },
  stone_bricks(img, r, variant) {
    fill(img, (x, y) => {
      const off = Math.floor(y / 8) % 2 ? 8 : 0;
      const mortar = y % 8 === 7 || (x + off) % 16 === 15;
      return mortar ? shade(hex('#5a5a5a'), 0.9 + r() * 0.1) : shade(hex('#7b7b7b'), 0.92 + r() * 0.12);
    });
    if (variant === 'mossy') moss(img, r, 0.3);
    if (variant === 'cracked') { let x = 3, y = 0; for (let k = 0; k < 22; k++) { img.set(x, y, hex('#3a3a3a')); y++; x += Math.floor(r() * 3) - 1; if (y > 15) { y = 0; x += 7; } } }
  },
  chiseled_stone(img, r) {
    PAINTERS.polished(img, r, '#7b7b7b');
    for (let i = 3; i < 13; i++) { img.set(i, 3, hex('#5a5a5a')); img.set(i, 12, hex('#5a5a5a')); img.set(3, i, hex('#5a5a5a')); img.set(12, i, hex('#5a5a5a')); }
    for (let i = 6; i < 10; i++) for (let j = 6; j < 10; j++) img.set(i, j, hex('#6a6a6a'));
  },
  sand(img, r, base) { noisy(img, hex(base), 0.06, r); speckle(img, shade(hex(base), 0.9), 0.15, r); speckle(img, shade(hex(base), 1.08), 0.08, r); },
  sandstone_side(img, r, base) {
    const c = hex(base);
    noisy(img, c, 0.04, r);
    for (let x = 0; x < S; x++) { img.set(x, 0, shade(c, 1.08)); img.set(x, 4, shade(c, 0.9)); img.set(x, 11, shade(c, 0.9)); img.set(x, 15, shade(c, 0.85)); }
  },
  sandstone_top(img, r, base) { noisy(img, shade(hex(base), 1.03), 0.04, r); },
  sandstone_bottom(img, r, base) { noisy(img, hex(base), 0.06, r); speckle(img, shade(hex(base), 0.88), 0.1, r); },
  chiseled_sandstone(img, r, base) {
    PAINTERS.sandstone_side(img, r, base);
    const d = shade(hex(base), 0.75);
    for (const [x, y] of [[5, 6], [6, 6], [9, 6], [10, 6], [5, 9], [10, 9], [6, 10], [7, 10], [8, 10], [9, 10], [7, 7], [8, 7]]) img.set(x, y, d);
  },
  smooth_sandstone(img, r, base) { noisy(img, hex(base), 0.025, r); for (let x = 0; x < S; x++) { img.set(x, 0, shade(hex(base), 1.08)); img.set(x, 15, shade(hex(base), 0.85)); } },
  gravel(img, r) {
    noisy(img, hex('#857f7c'), 0.1, r);
    for (let k = 0; k < 30; k++) {
      const c = [hex('#6c6560'), hex('#9f9894'), hex('#5a5552'), hex('#7d6a5a')][Math.floor(r() * 4)];
      const x = Math.floor(r() * S), y = Math.floor(r() * S);
      img.set(x, y, c); img.set(x + 1, y, c);
    }
  },
  noise(img, r, base, jitter) { noisy(img, hex(base), Number(jitter) || 0.05, r); },
  terracotta(img, r, base) { noisy(img, hex(base), 0.05, r); speckle(img, shade(hex(base), 0.9), 0.08, r); },
  mineral(img, r, base) {
    const c = hex(base);
    noisy(img, c, 0.05, r);
    for (let i = 0; i < S; i++) { img.set(i, 0, shade(c, 1.25)); img.set(0, i, shade(c, 1.25)); img.set(i, 15, shade(c, 0.7)); img.set(15, i, shade(c, 0.7)); }
    for (let i = 3; i < 7; i++) img.set(i, 3 + (i - 3) % 2, shade(c, 1.35));
  },
  log_side(img, r, bark) {
    // vertical bark ridges of uneven width, with dark cracks that run part-way
    const c = hex(bark);
    let x = 0;
    while (x < S) {
      const w = 2 + Math.floor(r() * 3), f = 0.88 + r() * 0.2;
      for (let i = 0; i < w && x < S; i++, x++) for (let y = 0; y < S; y++) img.set(x, y, shade(c, f * (i === 0 ? 1.08 : 1) * (0.93 + r() * 0.1)));
    }
    for (let k = 0; k < 6; k++) {
      const cx = Math.floor(r() * S), y0 = Math.floor(r() * S), len = 3 + Math.floor(r() * 7);
      for (let y = 0; y < len; y++) img.set(cx, (y0 + y) % S, shade(c, 0.62 + r() * 0.08));
    }
  },
  birch_side(img, r) {
    noisy(img, hex('#d8d7d0'), 0.05, r);
    for (let k = 0; k < 9; k++) { const x = Math.floor(r() * 14), y = Math.floor(r() * S), w = 2 + Math.floor(r() * 3); for (let i = 0; i < w; i++) img.set(x + i, y, hex('#3a3a3a')); }
  },
  log_top(img, r, inner, bark) {
    fill(img, (x, y) => {
      const edge = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (edge > 6.5) return shade(hex(bark), 0.9 + r() * 0.15);
      const d = Math.hypot(x - 7.5, y - 7.5) + (r() - 0.5) * 0.5; // growth rings
      return shade(hex(inner), (Math.floor(d * 0.75) % 2 === 0 ? 1.04 : 0.86) * (0.95 + r() * 0.08));
    });
  },
  planks(img, r, base) {
    const c = hex(base);
    const seams = [0, 1, 2, 3].map(() => 2 + Math.floor(r() * 12));
    const grain = Array.from({ length: S }, () => 0.94 + r() * 0.1); // per-row grain streaks
    fill(img, (x, y) => {
      const plank = Math.floor(y / 4);
      if (y % 4 === 3) return shade(c, 0.66);                 // gap between boards
      if (x === seams[plank]) return shade(c, 0.74);          // board ends
      const knot = (x * 7 + y * 13 + plank * 5) % 23 === 0 ? 0.85 : 1;
      return shade(c, grain[y] * knot * (y % 4 === 0 ? 1.05 : 1) * (0.95 + r() * 0.08));
    });
  },
  crafting_top(img, r) {
    PAINTERS.planks(img, r, '#a8864f');
    frame(img, hex('#5a4326'));
    for (let i = 3; i < 13; i++) { img.set(i, 5, hex('#5a4326')); img.set(i, 10, hex('#5a4326')); img.set(5, i, hex('#5a4326')); img.set(10, i, hex('#5a4326')); }
  },
  crafting_side(img, r) {
    PAINTERS.planks(img, r, '#a8864f');
    for (let x = 0; x < S; x++) { img.set(x, 0, hex('#5a4326')); img.set(x, 1, hex('#8a6a3c')); }
    for (let x = 3; x < 7; x++) img.set(x, 6, hex('#bdbdbd'));
    for (let y = 6; y < 12; y++) img.set(4, y, hex('#5a4326'));
    for (let x = 9; x < 13; x++) img.set(x, 5, hex('#8a8a8a'));
    for (let y = 5; y < 12; y++) img.set(11, y, hex('#5a4326'));
  },
  furnace_side(img, r) { cells(img, r, [hex('#7a7a7a'), hex('#6a6a6a')], hex('#454545'), 6); },
  furnace_top(img, r) { noisy(img, hex('#6e6e6e'), 0.1, r); frame(img, hex('#4a4a4a')); },
  furnace_front(img, r) {
    PAINTERS.furnace_side(img, r);
    for (let y = 8; y < 14; y++) for (let x = 4; x < 12; x++) img.set(x, y, hex('#1c1c1c'));
    for (let x = 3; x < 13; x++) { img.set(x, 7, hex('#3a3a3a')); img.set(x, 14, hex('#3a3a3a')); }
  },
  furnace_front_lit(img, r) {
    PAINTERS.furnace_front(img, r);
    for (let y = 10; y < 14; y++) for (let x = 4; x < 12; x++) img.set(x, y, r() < 0.5 ? hex('#ff9a1f') : hex('#ffd34a'));
  },
  leaves_tint(img, r) {
    const b = blotches(r, 2);
    fill(img, (x, y) => {
      const v = b(x, y);
      if (r() < 0.16) return [0, 0, 0, 0];
      return grey(v < 0.3 ? 105 + r() * 25 : 140 + v * 60 + r() * 25);
    });
  },
  leaves(img, r, base) { fill(img, () => (r() < 0.18 ? [0, 0, 0, 0] : shade(hex(base), 0.75 + r() * 0.4))); },
  glass(img) {
    clear(img);
    frame(img, hex('#dbeef2'));
    for (let i = 0; i < 4; i++) { img.set(4 + i, 3 + i, [255, 255, 255, 255]); img.set(9 + i, 8 + i, [230, 245, 250, 255]); }
  },
  water(img, r) { fill(img, (x, y) => shade(hex('#3b6fd8'), (((x + y * 2) % 7 === 0) ? 1.15 : 1) * (0.9 + r() * 0.12))); },
  lava(img, r) { fill(img, (x, y) => mix(hex('#d84a10'), hex('#ffb020'), (Math.sin(x * 0.9 + y * 0.5) * 0.5 + 0.5) * 0.6 + r() * 0.4)); },
  ice(img, r) {
    noisy(img, hex('#8cb8f0'), 0.05, r);
    for (let i = 0; i < 6; i++) { img.set(3 + i, 10 - i, hex('#d8ecff')); img.set(9 + i, 14 - i, hex('#d8ecff')); img.set(1 + i, 5 - Math.floor(i / 2), hex('#c0dcff')); }
  },
  packed_ice(img, r) { noisy(img, hex('#7fa8e0'), 0.06, r); speckle(img, hex('#a8c8f8'), 0.15, r); },
  snow(img, r) { noisy(img, hex('#f2f8fb'), 0.03, r); speckle(img, hex('#dbe8f0'), 0.1, r); },
  ore(img, r, color) { PAINTERS.stone(img, r); oreSpots(img, hex(color), r); },
  bedrock(img, r) { fill(img, () => { const v = r(); return v < 0.3 ? hex('#262626') : v < 0.7 ? hex('#555555') : hex('#7a7a7a'); }); },
  bricks(img, r) {
    fill(img, (x, y) => {
      const offset = Math.floor(y / 4) % 2 === 0 ? 0 : 4;
      const mortar = y % 4 === 3 || (x + offset) % 8 === 7;
      return mortar ? shade(hex('#b5aea2'), 0.9 + r() * 0.1) : shade(hex('#96513e'), 0.85 + r() * 0.25);
    });
  },
  cactus_side(img, r) {
    noisy(img, hex('#4f8a2c'), 0.1, r);
    for (let y = 0; y < S; y++) { img.set(0, y, hex('#2f5c1a')); img.set(15, y, hex('#2f5c1a')); img.set(5, y, hex('#3c7020')); img.set(10, y, hex('#3c7020')); }
    for (let k = 0; k < 6; k++) img.set(1 + Math.floor(r() * 14), Math.floor(r() * S), hex('#e8e0b0'));
  },
  cactus_top(img, r) { noisy(img, hex('#5a9a33'), 0.08, r); frame(img, hex('#2f5c1a')); },
  torch(img) {
    // The torch model shows rows 6-15 (10 pixels): a glowing yellow/orange tip
    // on top of a wooden stick. Its top face shows rows 6-7.
    clear(img);
    for (let y = 9; y < 16; y++) { img.set(7, y, hex('#8b6a3c')); img.set(8, y, hex('#6e5330')); }
    img.set(7, 6, hex('#fff6c0')); img.set(8, 6, hex('#ffe066'));   // white-hot top
    img.set(7, 7, hex('#ffd84a')); img.set(8, 7, hex('#ffb02e'));   // yellow
    img.set(7, 8, hex('#ff9a1f')); img.set(8, 8, hex('#e0701a'));   // orange, where the flame meets the wood
  },
  tall_grass(img, r) {
    clear(img);
    for (let k = 0; k < 8; k++) {
      const x = 1 + Math.floor(r() * 14), h = 5 + Math.floor(r() * 9);
      for (let y = 0; y < h; y++) img.set(x + (y > h * 0.6 && k % 2 ? 1 : 0), 15 - y, grey(150 + r() * 70));
    }
  },
  fern(img, r) {
    clear(img);
    for (let k = 0; k < 3; k++) {
      const x0 = 4 + k * 4;
      for (let y = 3 + k; y < 16; y++) {
        img.set(x0, y, grey(140 + r() * 40));
        if (y % 2 === 0) { img.set(x0 - 1, y - 1, grey(160 + r() * 50)); img.set(x0 + 1, y - 1, grey(160 + r() * 50)); }
      }
    }
  },
  dead_bush(img, r) {
    clear(img);
    const c = hex('#7a5a2a');
    stem(img, 8, 9, c);
    for (const [dx, dy, len] of [[-1, -1, 5], [1, -1, 5], [-1, -1, 3], [1, -1, 3]]) {
      let x = 8, y = 12 - len + (r() * 2 | 0);
      for (let i = 0; i < len; i++) { img.set(x, y, shade(c, 0.9 + r() * 0.2)); x += dx; y += dy; }
    }
  },
  flower(img, r, petal, center) {
    clear(img);
    stem(img, 7, 8);
    img.set(6, 12, hex('#3f7f2a')); img.set(8, 11, hex('#3f7f2a'));
    const p = hex(petal);
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -2], [-2, 0], [2, 0]]) img.set(7 + dx, 5 + dy, shade(p, 0.85 + r() * 0.3));
    img.set(7, 5, hex(center));
  },
  tulip(img, r, petal) {
    clear(img);
    stem(img, 7, 7);
    img.set(6, 11, hex('#3f7f2a')); img.set(5, 10, hex('#3f7f2a')); img.set(8, 12, hex('#3f7f2a')); img.set(9, 11, hex('#3f7f2a'));
    const p = hex(petal);
    for (let y = 3; y < 7; y++) for (let x = 6; x < 9; x++) img.set(x, y, shade(p, 0.85 + r() * 0.25));
    img.set(5, 3, p); img.set(9, 3, p); img.set(7, 2, shade(p, 1.1));
  },
  allium(img, r) {
    clear(img); stem(img, 7, 7);
    for (let y = 2; y < 7; y++) for (let x = 5; x < 10; x++) if ((x - 7) ** 2 + (y - 4) ** 2 < 6) img.set(x, y, shade(hex('#b060d8'), 0.8 + r() * 0.4));
  },
  bluet(img, r) {
    clear(img);
    for (const [x, y] of [[4, 6], [8, 4], [11, 7], [6, 9]]) {
      stem(img, x, y + 2);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) img.set(x + dx, y + dy, dx || dy ? hex('#f0f0f0') : hex('#f2d32b'));
    }
  },
  sunflower(img, r) {
    clear(img); stem(img, 7, 9);
    img.set(6, 12, hex('#3f7f2a')); img.set(5, 11, hex('#3f7f2a')); img.set(8, 13, hex('#3f7f2a'));
    for (let y = 1; y < 9; y++) for (let x = 3; x < 12; x++) {
      const d = (x - 7) ** 2 + (y - 5) ** 2;
      if (d < 18) img.set(x, y, d < 6 ? shade(hex('#5a3a12'), 0.8 + r() * 0.4) : shade(hex('#f8c527'), 0.85 + r() * 0.3));
    }
  },
  small_mushroom(img, r, cap) {
    clear(img);
    for (let y = 9; y < 16; y++) { img.set(7, y, hex('#e8dcc8')); img.set(8, y, hex('#d8ccb8')); }
    const c = hex(cap);
    for (let y = 6; y < 10; y++) for (let x = 4; x < 12; x++) if (y > 6 || (x > 4 && x < 11)) img.set(x, y, shade(c, 0.85 + r() * 0.3));
    if (cap === '#c22a24') { img.set(6, 7, hex('#ffffff')); img.set(9, 8, hex('#ffffff')); }
  },
  mushroom_cap(img, r, cap) { noisy(img, hex(cap), 0.08, r); if (cap === '#c22a24') for (let k = 0; k < 6; k++) { const x = 1 + Math.floor(r() * 12), y = 1 + Math.floor(r() * 12); img.set(x, y, hex('#f4f4f4')); img.set(x + 1, y, hex('#f4f4f4')); img.set(x, y + 1, hex('#e8e8e8')); } },
  mushroom_stem(img, r) { noisy(img, hex('#d8ccb4'), 0.05, r); speckle(img, hex('#c4b49a'), 0.15, r); },
  lily_pad(img, r) {
    clear(img);
    for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) {
      const d = (x - 7.5) ** 2 + (y - 7.5) ** 2;
      const notch = x > 7 && Math.abs(y - 7.5) < (x - 7) * 0.4;
      if (d < 46 && !notch) img.set(x, y, shade(hex('#3f8a2a'), 0.8 + r() * 0.35));
    }
  },
  wheat_crop(img, r) {
    clear(img);
    for (let k = 0; k < 5; k++) {
      const x = 2 + k * 3;
      for (let y = 4; y < 16; y++) img.set(x, y, y < 8 ? shade(hex('#d8b84a'), 0.85 + r() * 0.3) : shade(hex('#a89a3a'), 0.85 + r() * 0.3));
      img.set(x - 1, 5, hex('#c8a83a')); img.set(x + 1, 6, hex('#c8a83a'));
    }
  },
  farmland(img, r) { noisy(img, hex('#5a3a22'), 0.1, r); for (let y = 0; y < S; y += 4) for (let x = 0; x < S; x++) img.set(x, y, hex('#3e2614')); },
  melon_side(img, r) { fill(img, (x) => shade(x % 4 < 2 ? hex('#7aa02a') : hex('#5a8020'), 0.9 + r() * 0.15)); },
  melon_top(img, r) { noisy(img, hex('#6a9026'), 0.08, r); for (let i = 0; i < 16; i += 4) for (let k = 0; k < 16; k++) img.set(k, i, hex('#5a8020')); },
  pumpkin_side(img, r) { fill(img, (x) => shade(hex('#d07a18'), (x % 4 === 0 ? 0.8 : 1) * (0.92 + r() * 0.12))); },
  pumpkin_top(img, r) { noisy(img, hex('#c87018'), 0.06, r); for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) img.set(x, y, hex('#6a5a20')); },
  pumpkin_face(img, r, lit) {
    PAINTERS.pumpkin_side(img, r);
    const c = lit ? hex('#ffd34a') : hex('#3a2208');
    for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5], [10, 4], [11, 4], [10, 5], [11, 5]]) img.set(x, y, c);
    for (let x = 3; x < 13; x++) img.set(x, 10, c);
    for (const x of [4, 6, 9, 11]) img.set(x, 11, c);
  },
  hay_side(img, r) { fill(img, (x, y) => (y === 3 || y === 12 ? hex('#7a5a12') : shade(hex('#c8a832'), 0.85 + r() * 0.3))); },
  hay_top(img, r) { noisy(img, hex('#b8982a'), 0.15, r); frame(img, hex('#8a6a1a')); },
  bookshelf(img, r) {
    PAINTERS.planks(img, r, '#a8864f');
    const colors = ['#8a2a2a', '#2a4a8a', '#2a6a3a', '#7a5a2a', '#5a2a6a', '#3a3a3a'];
    for (const y0 of [1, 9]) for (let x = 1; x < 15; x++) {
      const c = hex(colors[Math.floor(r() * colors.length)]);
      for (let y = y0; y < y0 + 6; y++) img.set(x, y, shade(c, y === y0 ? 1.2 : 1));
    }
  },
  glowstone(img, r) { cells(img, r, [hex('#f8d070'), hex('#e8b050'), hex('#ffe8a0')], hex('#a87830'), 9); },
  sea_lantern(img, r) { noisy(img, hex('#c8e0d8'), 0.06, r); frame(img, hex('#7aa8a0')); for (let i = 3; i < 13; i++) { img.set(i, 8, hex('#f0fff8')); img.set(8, i, hex('#f0fff8')); } },
  sponge(img, r) { noisy(img, hex('#c8c040'), 0.08, r); speckle(img, hex('#8a8420'), 0.18, r); },
  cobweb(img) {
    clear(img);
    const c = [235, 235, 235, 255];
    for (let i = 0; i < 16; i++) { img.set(i, i, c); img.set(15 - i, i, c); img.set(8, i, c); img.set(i, 8, c); }
    for (const rad of [3, 6]) for (let a = 0; a < 24; a++) img.set(Math.round(8 + Math.cos(a / 24 * 6.28) * rad), Math.round(8 + Math.sin(a / 24 * 6.28) * rad), c);
  },
  wool(img, r, color) {
    const base = hex(color);
    fill(img, (x, y) => shade(base, (((x + (y % 2)) % 2 === 0) ? 1.04 : 0.94) * (0.94 + r() * 0.1)));
  },  // ---- Farming ----
  wheat_stage(img, r, n) {
    clear(img);
    n = Number(n);
    const h = 3 + Math.round(n * 1.6);
    const green = hex('#4fa52f'), ripe = hex('#c9a83c');
    const col = n >= 7 ? ripe : mix(green, hex('#9aa83a'), Math.max(0, n - 4) / 3);
    for (const x of [1, 4, 7, 10, 13]) {
      const hh = h - Math.floor(r() * 2);
      for (let y = 0; y < hh; y++) img.set(x + (y > hh / 2 && x % 2 ? 1 : 0), 15 - y, shade(col, 0.85 + r() * 0.25));
      if (n >= 5) for (let y = hh - 3; y < hh; y++) { img.set(x - 1, 15 - y, shade(n >= 7 ? hex('#a8862a') : col, 0.9)); img.set(x + 1, 15 - y, shade(col, 1.1)); }
    }
  },
  carrot_stage(img, r, n) { PAINTERS.veg_stage(img, r, n, '#e8811a'); },
  potato_stage(img, r, n) { PAINTERS.veg_stage(img, r, n, '#c8a050'); },
  beet_stage(img, r, n) { PAINTERS.veg_stage(img, r, n, '#a8283a'); },
  veg_stage(img, r, n, root) {
    // bushy leaves that get taller; when ripe the top of the root peeks out
    clear(img);
    n = Number(n);
    const h = 4 + n * 3;
    for (const x of [2, 5, 8, 11, 13]) {
      for (let y = 0; y < h - Math.floor(r() * 3); y++) {
        img.set(x, 15 - y, shade(hex('#3f9a2a'), 0.85 + r() * 0.3));
        if (y > 2 && y % 2 === 0) { img.set(x - 1, 14 - y, shade(hex('#5ab83a'), 0.9 + r() * 0.2)); img.set(x + 1, 15 - y, shade(hex('#2f7a20'), 0.9 + r() * 0.2)); }
      }
    }
    if (n >= 3) for (const x of [3, 9, 12]) { img.set(x, 15, hex(root)); img.set(x + 1, 15, shade(hex(root), 0.8)); img.set(x, 14, shade(hex(root), 1.15)); }
  },
  sapling(img, r, leaf) {
    clear(img);
    const c = hex(leaf);
    for (let y = 9; y < 16; y++) img.set(7, y, shade(hex('#6b4a2a'), 0.9 + r() * 0.2));
    for (let y = 1; y < 11; y++) for (let x = 2; x < 13; x++) {
      const d = ((x - 7) / 5.2) ** 2 + ((y - 5.5) / 4.8) ** 2;
      if (d < 1 && r() > 0.12) img.set(x, y, shade(c, 0.75 + r() * 0.45));
    }
  },
  sugar_cane(img, r) {
    clear(img);
    for (const x0 of [2, 7, 12]) {
      for (let y = 0; y < S; y++) {
        const joint = (y + x0) % 5 === 0;
        img.set(x0, y, shade(hex(joint ? '#c8e090' : '#8ac850'), 0.9 + r() * 0.15));
        img.set(x0 + 1, y, shade(hex(joint ? '#a8c070' : '#6aa83a'), 0.9 + r() * 0.15));
      }
      img.set(x0 - 1, 3 + x0 % 4, hex('#7ab848')); img.set(x0 + 2, 8 + x0 % 3, hex('#7ab848'));
    }
  },
  bush_flower(img, r, petal) {
    clear(img);
    for (let y = 2; y < 16; y++) for (let x = 1; x < 15; x++) {
      const d = ((x - 7.5) / 6.5) ** 2 + ((y - 9) / 7) ** 2;
      if (d < 1 && r() > 0.25) img.set(x, y, shade(hex('#3f8a2a'), 0.75 + r() * 0.4));
    }
    for (let k = 0; k < 9; k++) clump(img, 2 + Math.floor(r() * 12), 2 + Math.floor(r() * 9), 3, () => shade(hex(petal), 0.85 + r() * 0.3), r);
  },
  cocoa(img, r) {
    fill(img, (x, y) => shade(hex(x % 3 === 0 ? '#8a4a1a' : '#b0662a'), 0.88 + r() * 0.2));
    for (let x = 0; x < S; x++) img.set(x, 4, hex('#6a3a12'));
  },
  grass_path_top(img, r) { const b = blotches(r); fill(img, (x, y) => shade(hex('#9a7c45'), 0.9 + b(x, y) * 0.14 + r() * 0.06)); speckle(img, hex('#7a6035'), 0.08, r); },
  grass_path_side(img, r) { PAINTERS.dirt(img, r); for (let x = 0; x < S; x++) { const d = 2 + Math.floor(r() * 2); for (let y = 0; y < d; y++) img.set(x, y, shade(hex('#9a7c45'), 0.9 + r() * 0.15)); } },

  // ---- Pillars and slabs ----
  bone_side(img, r) { fill(img, (x) => shade(hex('#e4dec4'), (x % 5 === 0 ? 0.88 : 1) * (0.94 + r() * 0.08))); frame(img, hex('#c8c0a0')); },
  bone_top(img, r) {
    noisy(img, hex('#e4dec4'), 0.05, r); frame(img, hex('#c8c0a0'));
    for (const [cx, cy] of [[4, 4], [11, 4], [4, 11], [11, 11]]) { img.set(cx, cy, hex('#a8a080')); img.set(cx + 1, cy, hex('#b8b090')); }
  },
  quartz_pillar(img, r) {
    noisy(img, hex('#ece6df'), 0.03, r);
    for (let y = 0; y < S; y++) { img.set(0, y, hex('#cfc8be')); img.set(15, y, hex('#cfc8be')); img.set(4, y, hex('#ddd6cc')); img.set(11, y, hex('#ddd6cc')); }
  },
  chiseled_quartz(img, r) {
    noisy(img, hex('#ece6df'), 0.03, r); frame(img, hex('#cfc8be'));
    for (const y of [3, 6, 9, 12]) for (let x = 2; x < 14; x++) img.set(x, y, hex('#d6cfc4'));
  },
  stone_slab_side(img, r) {
    PAINTERS.polished(img, r, '#9e9e9e');
    for (let x = 0; x < S; x++) { img.set(x, 7, hex('#7a7a7a')); img.set(x, 8, hex('#b4b4b4')); }
  },
  smooth_stone_edge(img, r) { PAINTERS.polished(img, r, '#9e9e9e'); for (let x = 0; x < S; x++) img.set(x, 13, hex('#b8b8b8')); },

  // ---- Doors, trapdoors, bars ----
  door_bottom(img, r, col) { PAINTERS.door_half(img, r, col, false); },
  door_top(img, r, col) { PAINTERS.door_half(img, r, col, true); },
  door_half(img, r, col, top) {
    const iron = col === 'iron';
    const c = hex(iron ? '#c8c8c8' : col), dark = shade(c, 0.6);
    if (iron) { noisy(img, c, 0.05, r); for (let y = 0; y < S; y++) for (const x of [5, 10]) img.set(x, y, shade(c, 0.85)); }
    else fill(img, (x, y) => shade(c, (x % 4 === 0 ? 0.8 : 1) * (0.9 + r() * 0.15))); // vertical boards
    for (let i = 0; i < S; i++) { img.set(0, i, dark); img.set(15, i, dark); }
    if (top) {
      for (let x = 0; x < S; x++) img.set(x, 0, dark);
      // two little windows
      for (const x0 of [3, 9]) { rect(img, x0, 3, x0 + 4, 8, [0, 0, 0, 0]); for (let i = 0; i < 4; i++) { img.set(x0 + i, 2, dark); img.set(x0 + i, 8, dark); } img.set(x0 - 1, 5, dark); img.set(x0 + 4, 5, dark); }
    } else {
      for (let x = 0; x < S; x++) { img.set(x, 15, dark); img.set(x, 6, shade(c, 0.75)); }
      // handle
      img.set(12, 1, hex(iron ? '#6a6a6a' : '#3a3a3a')); img.set(12, 2, hex(iron ? '#6a6a6a' : '#3a3a3a'));
    }
  },
  door_item(img, r, col) {
    clear(img);
    const iron = col === 'iron';
    const c = hex(iron ? '#c8c8c8' : col), dark = shade(c, 0.55);
    rect(img, 4, 0, 12, 16, c, r, 0.08);
    for (let y = 0; y < S; y++) { img.set(4, y, dark); img.set(11, y, dark); }
    for (let x = 4; x < 12; x++) { img.set(x, 0, dark); img.set(x, 15, dark); img.set(x, 8, shade(c, 0.75)); }
    rect(img, 6, 2, 10, 6, iron ? hex('#8a8a8a') : [0, 0, 0, 0]);
    img.set(10, 9, hex('#333333'));
  },
  trapdoor(img, r, col) {
    const iron = col === 'iron';
    const c = hex(iron ? '#c8c8c8' : col), dark = shade(c, 0.6);
    noisy(img, c, 0.08, r);
    frame(img, dark);
    // a grid of holes you can see through
    for (const [x0, y0] of [[3, 3], [9, 3], [3, 9], [9, 9]]) rect(img, x0, y0, x0 + 4, y0 + 4, iron ? shade(c, 0.75) : [0, 0, 0, 0]);
    for (let i = 1; i < 15; i++) { img.set(i, 7, dark); img.set(7, i, dark); img.set(i, 8, dark); img.set(8, i, dark); }
  },
  iron_bars(img) {
    clear(img);
    const c = hex('#9a9a9a'), d = hex('#6a6a6a');
    for (const x of [1, 5, 9, 13]) for (let y = 0; y < S; y++) { img.set(x, y, c); img.set(x + 1, y, d); }
    for (let x = 0; x < S; x++) { img.set(x, 0, c); img.set(x, 15, d); }
  },
  stained_glass(img, r, col) {
    // the whole pane is see-through; a stronger coloured frame and streaks
    const c = hex(col);
    fill(img, () => [...shade(c, 0.95 + r() * 0.1).slice(0, 3), 150]);
    for (let i = 0; i < S; i++) { img.set(i, 0, c); img.set(i, 15, c); img.set(0, i, c); img.set(15, i, c); }
    for (let i = 0; i < 4; i++) { img.set(4 + i, 3 + i, [...mix(c, [255, 255, 255], 0.6).slice(0, 3), 200]); img.set(9 + i, 8 + i, [...mix(c, [255, 255, 255], 0.4).slice(0, 3), 190]); }
  },
  powder(img, r, col) {
    const c = hex(col);
    fill(img, () => shade(c, 0.9 + r() * 0.12));
    speckle(img, shade(c, 1.15), 0.18, r); speckle(img, shade(c, 0.78), 0.14, r);
  },
  glazed(img, r, terra, wool) {
    // an original four-fold tile: rotate a quarter-pattern into each corner so
    // neighbouring tiles join into bigger shapes
    const a = hex(terra), b = hex(wool), w = mix(b, [255, 255, 255], 0.6), k = shade(a, 0.6);
    const q = new Img();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const d = x + y;
      const c = d < 3 ? b : d < 5 ? w : (x === y ? k : (Math.abs(x - y) < 2 ? b : a));
      q.set(x, y, shade(c, 0.95 + r() * 0.08));
    }
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const c = q.get(x, y);
      img.set(x, y, c); img.set(15 - y, x, c); img.set(15 - x, 15 - y, c); img.set(y, 15 - x, c);
    }
  },

  // ---- Beds ----
  bed_side(img, r, wool) {
    const c = hex(wool);
    rect(img, 0, 0, 16, 9, c, r, 0.06);                     // blanket
    rect(img, 0, 9, 16, 11, hex('#e8e4dc'), r, 0.04);        // sheet
    rect(img, 0, 11, 16, 16, hex('#8a6a3c'), r, 0.1);        // wooden frame and legs
  },
  bed_foot(img, r, wool) { const c = hex(wool); rect(img, 0, 0, 16, 16, c, r, 0.06); for (let x = 0; x < S; x++) img.set(x, 0, shade(c, 0.8)); },
  bed_head(img, r, wool) {
    // pillow at the bottom of the picture = the head end for a bed facing north
    const c = hex(wool);
    rect(img, 0, 0, 16, 16, c, r, 0.06);
    rect(img, 1, 10, 15, 15, hex('#f0ece4'), r, 0.04);
    for (let x = 1; x < 15; x++) img.set(x, 9, shade(c, 0.8));
  },
  bed_item(img, r, wool) {
    clear(img);
    rect(img, 1, 7, 15, 11, hex(wool), r, 0.06);
    rect(img, 1, 6, 5, 9, hex('#f0ece4'));
    rect(img, 1, 11, 15, 12, hex('#8a6a3c'));
    for (const x of [1, 14]) for (let y = 11; y < 14; y++) img.set(x, y, hex('#6a4a2a'));
  },

  // ---- Chests and machines ----
  chest_side(img, r) {
    PAINTERS.planks(img, r, '#a0743a');
    const k = hex('#3a2a14');
    for (let i = 0; i < S; i++) { img.set(0, i, k); img.set(15, i, k); img.set(i, 2, k); img.set(i, 15, k); }
    for (let x = 0; x < S; x++) { img.set(x, 7, k); img.set(x, 8, shade(hex('#a0743a'), 0.7)); }
  },
  chest_top(img, r) { PAINTERS.planks(img, r, '#a0743a'); frame(img, hex('#3a2a14')); },
  chest_front(img, r, kind) {
    PAINTERS.chest_side(img, r);
    const latch = kind === 'trapped' ? hex('#c84a2a') : hex('#c8c8c8');
    rect(img, 7, 6, 9, 10, latch); img.set(7, 9, shade(latch, 0.6)); img.set(8, 9, shade(latch, 0.6));
  },
  dispenser_front(img, r) {
    PAINTERS.furnace_side(img, r);
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) if ((x - 7.5) ** 2 + (y - 7.5) ** 2 < 13) img.set(x, y, hex('#1e1e1e'));
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) img.set(x, y, hex('#3a3a3a'));
  },
  dropper_front(img, r) {
    PAINTERS.furnace_side(img, r);
    rect(img, 5, 5, 11, 11, hex('#1e1e1e'));
    for (let i = 5; i < 11; i++) { img.set(i, 5, hex('#3a3a3a')); img.set(5, i, hex('#3a3a3a')); }
  },
  observer_side(img, r) {
    noisy(img, hex('#5a5a5a'), 0.06, r); frame(img, hex('#3a3a3a'));
    for (let i = 3; i < 13; i++) img.set(i, 7, hex('#454545'));
    for (let i = 0; i < 4; i++) { img.set(4 + i, 7 - i, hex('#454545')); img.set(4 + i, 7 + i, hex('#454545')); }
  },
  observer_front(img, r) {
    noisy(img, hex('#4a4a4a'), 0.06, r); frame(img, hex('#2e2e2e'));
    rect(img, 2, 5, 7, 10, hex('#1a1a1a')); rect(img, 9, 5, 14, 10, hex('#1a1a1a'));
    img.set(4, 7, hex('#8a1a1a')); img.set(11, 7, hex('#8a1a1a'));
    for (let x = 3; x < 13; x++) img.set(x, 12, hex('#2a2a2a'));
  },
  hopper_side(img, r) { noisy(img, hex('#4a4a4e'), 0.06, r); for (let i = 0; i < S; i++) { img.set(i, 0, hex('#6a6a70')); img.set(0, i, hex('#3a3a3e')); img.set(15, i, hex('#3a3a3e')); } },
  hopper_top(img, r) { noisy(img, hex('#4a4a4e'), 0.06, r); frame(img, hex('#6a6a70')); rect(img, 2, 2, 14, 14, hex('#1e1e22')); },
  hopper_item(img) {
    clear(img);
    rect(img, 1, 2, 15, 7, hex('#4a4a4e')); rect(img, 4, 7, 12, 11, hex('#3e3e42')); rect(img, 6, 11, 10, 14, hex('#323236'));
    for (let x = 1; x < 15; x++) img.set(x, 2, hex('#6a6a70'));
  },
  cauldron_side(img, r) {
    noisy(img, hex('#3e3e3e'), 0.06, r);
    for (let x = 0; x < S; x++) { img.set(x, 0, hex('#5a5a5a')); img.set(x, 12, hex('#2a2a2a')); }
    for (const x of [0, 15]) for (let y = 0; y < S; y++) img.set(x, y, hex('#2e2e2e'));
    rect(img, 4, 13, 12, 16, [0, 0, 0, 0]); // gap between the feet
  },
  cauldron_top(img, r) { noisy(img, hex('#3e3e3e'), 0.06, r); frame(img, hex('#5a5a5a')); rect(img, 2, 2, 14, 14, hex('#222222')); },
  cauldron_item(img) {
    clear(img);
    rect(img, 2, 3, 14, 13, hex('#3e3e3e')); rect(img, 3, 3, 13, 5, hex('#1e1e1e'));
    for (let x = 2; x < 14; x++) img.set(x, 3, hex('#5a5a5a'));
    rect(img, 2, 13, 4, 15, hex('#2e2e2e')); rect(img, 12, 13, 14, 15, hex('#2e2e2e'));
  },
  anvil(img, r) { noisy(img, hex('#444444'), 0.08, r); speckle(img, hex('#555555'), 0.1, r); },
  furnace_like(img, r) { PAINTERS.furnace_side(img, r); },
  piston_side(img, r) {
    PAINTERS.cobblestone(img, r);
    PAINTERS.planks_band(img, r);
  },
  planks_band(img, r) { for (let y = 0; y < 4; y++) for (let x = 0; x < S; x++) img.set(x, y, shade(hex('#a8864f'), (y === 3 ? 0.7 : 1) * (0.9 + r() * 0.15))); },
  piston_top(img, r, sticky) {
    PAINTERS.planks(img, r, '#a8864f');
    frame(img, hex('#6a5030'));
    if (sticky) rect(img, 2, 2, 14, 14, hex('#6ab84a'), r, 0.15);
    else rect(img, 6, 6, 10, 10, hex('#8a8a8a'));
  },
  piston_bottom(img, r) { PAINTERS.cobblestone(img, r); rect(img, 5, 5, 11, 11, hex('#5a5a5a')); },
  note_block(img, r) {
    PAINTERS.planks(img, r, '#6a4628');
    frame(img, hex('#3e2814'));
    for (let y = 4; y < 12; y += 2) for (let x = 4; x < 12; x += 2) img.set(x, y, hex('#2a1a0e'));
  },
  jukebox_top(img, r) { PAINTERS.note_block(img, r); rect(img, 3, 7, 13, 9, hex('#1a1a1a')); },
  tnt_side(img, r) {
    // a bundle of red sticks with a pale paper band (our own design)
    fill(img, (x) => shade(hex(x % 4 === 3 ? '#a02a1e' : '#d8402e'), 0.9 + r() * 0.15));
    rect(img, 0, 5, 16, 11, hex('#ece6d8'), r, 0.04);
    for (let x = 0; x < S; x++) { img.set(x, 5, hex('#8a8070')); img.set(x, 10, hex('#8a8070')); }
    for (const [x, y] of [[7, 6], [8, 6], [6, 7], [9, 7], [6, 8], [9, 8], [7, 9], [8, 9], [7, 7], [8, 8]]) img.set(x, y, hex('#2a2a2a'));
  },
  tnt_top(img, r) {
    fill(img, (x, y) => shade(hex((x % 4 === 3 || y % 4 === 3) ? '#a02a1e' : '#d8402e'), 0.9 + r() * 0.15));
    rect(img, 7, 7, 9, 9, hex('#3a3a3a')); img.set(8, 6, hex('#5a4a3a')); img.set(9, 5, hex('#5a4a3a'));
  },
  tnt_bottom(img, r) { fill(img, (x, y) => shade(hex((x % 4 === 3 || y % 4 === 3) ? '#a02a1e' : '#d8402e'), 0.9 + r() * 0.15)); },
  redstone_lamp(img, r) {
    cells(img, r, [hex('#f8c070'), hex('#e8a050'), hex('#ffe0a0')], hex('#7a4a20'), 8);
    frame(img, hex('#6a3a18'));
  },
  slime(img, r) {
    fill(img, () => [...shade(hex('#76c85a'), 0.95 + r() * 0.1).slice(0, 3), 190]);
    for (let i = 3; i < 13; i++) for (let j = 3; j < 13; j++) img.set(i, j, [...shade(hex('#5aa848'), 0.95 + r() * 0.1).slice(0, 3), 225]);
    frame(img, hex('#8ad870'));
  },
  spawner(img, r) {
    clear(img);
    const c = hex('#3a4450'), l = hex('#5a6878');
    for (let i = 0; i < S; i++) for (const k of [0, 5, 10, 15]) { img.set(k, i, c); img.set(i, k, c); }
    for (let i = 0; i < S; i += 5) img.set(i, i, l);
  },
  prismarine(img, r) {
    const b = blotches(r);
    fill(img, (x, y) => mix(hex('#5aa898'), hex('#6ab8a8'), b(x, y)).map((v, i) => (i < 3 ? v * (0.9 + r() * 0.15) : 255)));
    speckle(img, hex('#4a8a88'), 0.08, r);
  },
  prismarine_bricks(img, r) {
    fill(img, (x, y) => {
      const off = Math.floor(y / 4) % 2 ? 4 : 0;
      return (y % 4 === 3 || (x + off) % 8 === 7) ? shade(hex('#4a8a80'), 0.9 + r() * 0.1) : shade(hex('#6ab8a8'), 0.9 + r() * 0.15);
    });
  },
  dark_prismarine(img, r) {
    noisy(img, hex('#335a4c'), 0.08, r);
    for (let i = 0; i < S; i++) for (const k of [0, 8]) { img.set(k, i, hex('#22423a')); img.set(i, k, hex('#22423a')); }
  },
  ladder(img, r) {
    clear(img);
    const w = hex('#8a6a3c'), d = hex('#5e4626');
    for (let y = 0; y < S; y++) { img.set(2, y, w); img.set(3, y, d); img.set(12, y, w); img.set(13, y, d); }
    for (const y of [1, 5, 9, 13]) for (let x = 4; x < 12; x++) { img.set(x, y, shade(w, 0.95 + r() * 0.1)); img.set(x, y + 1, d); }
  },
  vine(img, r) {
    clear(img);
    for (let k = 0; k < 5; k++) {
      let x = 1 + Math.floor(r() * 14);
      for (let y = 0; y < 13 + Math.floor(r() * 3); y++) {
        img.set(x, y, grey(110 + r() * 40));
        if (r() < 0.45) { img.set(x - 1, y, grey(150 + r() * 60)); img.set(x + 1, y, grey(150 + r() * 60)); }
        if (r() < 0.3) x += r() < 0.5 ? -1 : 1;
      }
    }
  },
  lever(img, r) {
    PAINTERS.cobblestone(img, r);
    for (let y = 0; y < 13; y++) { img.set(7, y, shade(hex('#8b6a3c'), 0.95 + r() * 0.1)); img.set(8, y, shade(hex('#6e5330'), 0.95 + r() * 0.1)); }
  },
  rail(img, r, kind) {
    clear(img);
    const tie = hex(kind === 'activator' ? '#7a3a2a' : '#6e5330');
    for (const y of [1, 5, 9, 13]) for (let x = 1; x < 15; x++) { img.set(x, y, shade(tie, 0.9 + r() * 0.15)); img.set(x, y + 1, shade(tie, 0.7)); }
    const metal = hex(kind === 'powered' ? '#e8c040' : '#a0a0a0'), md = shade(metal, 0.65);
    for (let y = 0; y < S; y++) { img.set(3, y, metal); img.set(4, y, md); img.set(11, y, metal); img.set(12, y, md); }
    if (kind === 'powered') for (const y of [3, 7, 11]) { img.set(4, y, hex('#c41a1a')); img.set(11, y, hex('#c41a1a')); }
    if (kind === 'detector') rect(img, 6, 6, 10, 10, hex('#8a8a8a'));
    if (kind === 'activator') for (const y of [3, 11]) rect(img, 6, y, 10, y + 1, hex('#c41a1a'));
  },
  redstone_dust(img, r) {
    clear(img);
    for (let i = 0; i < S; i++) {
      if (r() < 0.8) img.set(7 + (i % 3 === 0 ? 1 : 0), i, shade(hex('#c41a1a'), 0.8 + r() * 0.3));
      if (r() < 0.8) img.set(i, 7 + (i % 3 === 1 ? 1 : 0), shade(hex('#c41a1a'), 0.8 + r() * 0.3));
    }
    rect(img, 6, 6, 10, 10, hex('#d42a1a'), r, 0.15);
  },
  repeater_top(img, r) {
    PAINTERS.polished(img, r, '#9e9e9e');
    for (let y = 2; y < 14; y++) img.set(8, y, hex('#8a1a1a'));
    for (const y of [4, 11]) { img.set(7, y, hex('#e83a2a')); img.set(8, y, hex('#ff5a3a')); img.set(9, y, hex('#e83a2a')); }
  },
  repeater_item(img, r) {
    clear(img);
    rect(img, 1, 10, 15, 13, hex('#9e9e9e'), r, 0.05);
    for (const x of [4, 11]) { rect(img, x, 5, x + 1, 10, hex('#8b6a3c')); img.set(x, 4, hex('#ff3a2a')); }
  },

  // ---- Food blocks and furniture ----
  cake_side(img, r) {
    clear(img);
    rect(img, 0, 8, 16, 16, hex('#c88a4a'), r, 0.08);                     // sponge
    for (let x = 0; x < S; x++) { img.set(x, 8, hex('#f4f0ea')); img.set(x, 9, hex('#f4f0ea')); if ((x * 7) % 5 < 2) img.set(x, 10, hex('#f4f0ea')); }
    for (let x = 1; x < S; x += 3) img.set(x, 13, hex('#e8d0a0'));
  },
  cake_inner(img, r) { clear(img); rect(img, 0, 8, 16, 16, hex('#d8a060'), r, 0.08); for (let x = 0; x < S; x++) { img.set(x, 8, hex('#f4f0ea')); img.set(x, 12, hex('#c83a2a')); } },
  cake_top(img, r) {
    rect(img, 0, 0, 16, 16, hex('#f4f0ea'), r, 0.03);
    for (let k = 0; k < 7; k++) { const x = 2 + Math.floor(r() * 12), y = 2 + Math.floor(r() * 12); img.set(x, y, hex('#d82a2a')); img.set(x + 1, y, hex('#a81a1a')); }
  },
  cake_bottom(img, r) { rect(img, 0, 0, 16, 16, hex('#b8783a'), r, 0.08); },
  cake_item(img, r) {
    clear(img);
    rect(img, 2, 8, 14, 13, hex('#c88a4a'), r, 0.08);
    rect(img, 2, 6, 14, 9, hex('#f4f0ea'));
    for (const x of [4, 8, 11]) img.set(x, 6, hex('#d82a2a'));
    for (const x of [3, 7, 12]) img.set(x, 9, hex('#f4f0ea'));
  },
  flower_pot(img, r) {
    rect(img, 0, 0, 16, 16, hex('#9a5a3a'), r, 0.08);
    rect(img, 6, 5, 10, 10, hex('#4a3020'), r, 0.1);
    for (let x = 0; x < S; x++) img.set(x, 10, hex('#7a4228'));
  },
  enchant_side(img, r) {
    PAINTERS.speckled(img, r, '#140f1e', '#2a1f3e', '#0a0810');
    rect(img, 0, 4, 16, 7, hex('#a01a2a'), r, 0.1);
    for (let x = 0; x < S; x += 2) img.set(x, 6, hex('#e8c040'));
  },
  enchant_top(img, r) {
    rect(img, 0, 0, 16, 16, hex('#a01a2a'), r, 0.1);
    frame(img, hex('#140f1e'));
    for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]]) img.set(x, y, hex('#5ee8e0'));
    rect(img, 5, 5, 11, 11, hex('#2a1f3e'));
  },
  daylight_side(img, r) { PAINTERS.planks(img, r, '#a8864f'); for (let x = 0; x < S; x++) img.set(x, 10, hex('#6a5030')); },
  daylight_top(img, r) {
    PAINTERS.planks(img, r, '#a8864f');
    for (const [x0, y0] of [[2, 2], [9, 2], [2, 9], [9, 9]]) rect(img, x0, y0, x0 + 5, y0 + 5, hex('#a8c8d8'), r, 0.08);
  },
};


/** Paint a texture by name ("painter:param:param", optional "@rN" = N quarter turns). */
function paint(name) {
  const img = new Img();
  const at = name.indexOf('@r');
  if (at >= 0) {
    const turns = Number(name.slice(at + 2)) || 1;
    img.d.set(paint(name.slice(0, at)).d);
    rotate(img, turns);
    return img;
  }
  const [base, ...params] = name.split(':');
  const painter = PAINTERS[base];
  const rand = mulberry32(hashSeed(name));
  if (painter) painter(img, rand, ...params);
  else fill(img, (x, y) => (((x >> 2) + (y >> 2)) % 2 ? [255, 0, 255] : [0, 0, 0])); // missing: magenta checkers
  return img;
}

/**
 * Give fully transparent pixels the colour of their opaque neighbours.
 * The GPU builds smaller "mipmap" versions of each texture for distant
 * blocks by averaging pixels. Transparent pixels used to be black, so far-away
 * flowers and grass turned into black X shapes. Spreading the real colours
 * into the invisible pixels fixes the averaging.
 */
function bleedAlpha(img) {
  const d = img.d;
  for (let pass = 0; pass < 4; pass++) {
    const src = new Uint8ClampedArray(d);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      if (src[i + 3] !== 0 || (pass > 0 && (src[i] | src[i + 1] | src[i + 2]))) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = (x + dx + S) % S, ny = (y + dy + S) % S, j = (ny * S + nx) * 4;
        if (src[j + 3] !== 0 || (src[j] | src[j + 1] | src[j + 2])) { r += src[j]; g += src[j + 1]; b += src[j + 2]; n++; }
      }
      if (n) { d[i] = r / n; d[i + 1] = g / n; d[i + 2] = b / n; }
    }
  }
}

// ---- Item icons drawn from ASCII pixel art ------------------------------------
// h = material colour, H = dark, l = light, k = outline, s/S = stick,
// w = white, r/R = red, g = green, y = yellow, b = brown
const ART = {
  pickaxe: ['', '', '....HHHHHH', '...HhllhhhHH', '....HHHH.ShhH', '........Ss.HhH', '.......Ss...HhH', '......Ss.....Hh', '.....Ss......Hh', '....Ss........H', '...Ss', '..Ss', '.Ss', 'Ss'],
  axe: ['', '........HH', '.......HhlH', '......HhhhhH', '......HhhhSs', '.......HHSs', '........Ss', '.......Ss', '......Ss', '.....Ss', '....Ss', '...Ss', '..Ss', '.Ss'],
  shovel: ['', '...........HHH', '..........HhlhH', '..........HhhhH', '...........HhH', '..........SH', '.........Ss', '........Ss', '.......Ss', '......Ss', '.....Ss', '....Ss', '...Ss', '..SS', '..S'],
  sword: ['..............HH', '.............HlH', '............HlH', '...........HlH', '..........HlH', '.........HhH', '........HhH', '.......HhH', '..HH..HhH', '...HHhhH', '....HhH', '...sSHHH', '..sSs..HH', '.sSs', 'SSs', '.s'],
  stick: ['', '', '............sS', '...........sS', '..........sS', '.........sS', '........sS', '.......sS', '......sS', '.....sS', '....sS', '...sS', '..sS'],
  coal: ['', '', '.....kkkk', '....khhllk', '...khhhhhhkk', '..khhlhhhhhhk', '..khhhhhhlhhk', '..kHhhhhhhhhk', '...kHhhhhhhHk', '...kHHhhhhHk', '....kkHHHHk', '......kkkk'],
  ingot: ['', '', '', '', '.....kkkkkkk', '....klllllllk', '...khlllllllhk', '..khhhhhhhhhhhk', '..kHhhhhhhhhhHk', '..kHHHHHHHHHHHk', '..kkkkkkkkkkkkk'],
  gem: ['', '', '.....kkkkkk', '....klllhhhk', '...kllhhhhhhk', '..kkkkkkkkkkkk', '..khlhhhhhhHHk', '...khlhhhhHHk', '....khhhhhHk', '.....khhhHk', '......khHk', '.......kk'],
  meat: ['', '', '......kkkk', '....kkhhllkk', '...khhhhhhllk', '..khhHhhhhhhlk', '..khhhhhhhhhhk', '..khhhhHhhhhhk', '...khhhhhhhhkk', '....kkhhhhhkwwk', '......kkkkk.kwwk', '.............kk'],
  drumstick: ['', '', '.....kkkk', '....khhhhk', '...khhlhhhk', '...khhhhhhk', '...khhhhhhk', '....khhhhkk', '.....kkkkwk', '.........kwk', '..........kwk', '...........kwwk', '...........kwwk', '............kk'],
  apple: ['', '.......S..gg', '.......Sggg', '....kkkSkkk', '...khhhhhhllk', '..khhhhhhhhllk', '..khhhhhhhhhlk', '..khhhhhhhhhhk', '..kHhhhhhhhhhk', '..kHHhhhhhhhHk', '...kHHhhhhHHk', '....kkHHHHkk', '......kkkk'],
  helmet: ['', '', '', '....kkkkkkkk', '...khhhhhhhhk', '..khlllhhhhhhk', '..khhhhhhhhhhk', '..khhkkkkkkhhk', '..khk......khk', '..kHk......kHk', '..kk........kk'],
  chestplate: ['', '..kkk......kkk', '.khhhk....khhhk', '.khlhhkkkkhhhhk', '.khhhhhhhhhhhhk', '..kkhhhhhhhhkk', '....khlhhhhk', '....khhhhhhk', '....khhhhhhk', '....khhhhhhk', '....kHHHHHHk', '.....kkkkkk'],
  leggings: ['', '...kkkkkkkkkk', '...khhhhhhhhk', '...khlhhhhhhk', '...khhhkkhhhk', '...khhk..khhk', '...khhk..khhk', '...khhk..khhk', '...khhk..khhk', '...khhk..khhk', '...kHHk..kHHk', '...kkkk..kkkk'],
  boots: ['', '', '', '', '', '..kkkk....kkkk', '..khhk....khhk', '..khhk....khhk', '..khhk....khhk', '.khhhk...khhhk', '.khlhk...khlhk', '.kHHHk...kHHHk', '.kkkkk...kkkkk'],
  dye: ['', '', '', '', '.......kk', '.....kkhhkk', '....khhllhhk', '...khhhlhhhhk', '...khhhhhhhhk', '..khhhhhhhhhhk', '..kHhhhhhhhhHk', '...kHHHHHHHHk', '....kkkkkkkk'],
  brick: ['', '', '', '', '', '....kkkkkkkk', '...khlllllhhk', '..khhhhhhhhhhk', '..kHhhhhhhhhHk', '..kHHHHHHHHHHk', '...kkkkkkkkkk'],
  ball: ['', '', '', '', '......kkkk', '.....khllhk', '....khlhhhhk', '....khhhhhhk', '....kHhhhhHk', '.....kHHHHk', '......kkkk'],
  dust: ['', '', '', '', '', '.....h..h', '...h.hh...h', '....hhHhh.h', '..h.hHhhHh', '...hhhHhhh.h', '....h.hh.h', '......h'],
  flint: ['', '', '', '....kkk', '...khhhk', '...khlhhk', '..khhhhhk', '..khhhhhhk', '..kHhhhhhk', '...kHhhhk', '....kHHk', '.....kk'],
  feather: ['', '', '............kk', '...........kwwk', '..........kwwwk', '.........kwwwk', '........kwwwk', '.......kwwwk', '......kwwwk', '.....kwwwk', '....kwwk', '...kSk', '..kSk', '..kk'],
  leather: ['', '', '...kk.....kk', '..khhkkkkkhhk', '..khhhhhhhhhk', '...khlhhhhhk', '...khhhhhhhk', '...khhhhhhhk', '..khhhhhhhhhk', '..khHhhhhhHhk', '...kk.kkk.kk'],
  string: ['', '', '', '..ww', '....w', '.....w', '......ww', '........w', '.........w', '..........ww', '............w', '.............ww'],
  wheat: ['', '..........yy', '.........yby', '........yby', '.......yby.y', '......ybyyby', '.....yby.yb', '....yby.yb', '...yyyyyb', '...gyyb', '..gg', '.gg', 'gg'],
  seeds: ['', '', '', '', '', '....h...h', '......H', '..h.....h..H', '.....h', '...H...h...h', '......h', '....h.....H'],
  bread: ['', '', '', '', '...kkkkkkkkk', '..khhlhhlhhhk', '.khhhhhhhhhhhk', '.khlhhlhhlhhhk', '.kHhhhhhhhhhHk', '..kHHHHHHHHHk', '...kkkkkkkkk'],
  melon_slice: ['', '', '', '', '..kkkkkkkkkkkk', '..kgggggggggk', '...kwhhhhhhwk', '....khhhkhhk', '.....khhhhk', '......khk', '.......k'],
  shield: ['', '...kkkkkkkkkk', '...khhhhhhhhk', '...khhhhhhhhk', '...khhhhhhhhk', '...khhhhhhhhk', '...khhhhhhhhk', '....khhhhhhk', '....khhhhhhk', '.....khhhhk', '......khhk', '.......kk'],
  // ---- newer items (all original BlockCraft pixel art) ----
  hoe: ['', '......HHHHH', '.....HhllhhSs', '......HHHHSs', '.........Ss', '........Ss', '.......Ss', '......Ss', '.....Ss', '....Ss', '...Ss', '..Ss', '.Ss'],
  shears: ['', '...........kk', '..........kllk', '.........klhk', '........klhk', '...kk..klhk', '..kllkklhk', '...klhhhk', '....khhk', '...kRRk', '..kRkRk', '.kRk.kRk', '.kRk..kk', '..k'],
  flint_and_steel: ['', '', '...kkkk', '..kGGGGk', '.kGk..kGk', '.kGk...kk', '.kGk', '..kGk....kkk', '...kGk..kdFdk', '....k..kdFFdk', '.......kdddFk', '........kddk', '.........kk'],
  fishing_rod: ['............ss', '...........sS.w', '..........sS..w', '.........sS...w', '........sS....w', '.......sS.....w', '......sS......w', '.....sS.......w', '....sS........w', '...sS........kGk', '..sS..........k', '.sS', 'sS'],
  carrot_rod: ['............ss', '...........sS.w', '..........sS..w', '.........sS...w', '........sS....w', '.......sS.....w', '......sS......w', '.....sS......gwg', '....sS........g', '...sS........kok', '..sS.........kok', '.sS...........k', 'sS'],
  bow: ['......kk', '.....ksSk', '....ksSkw', '...ksSk.w', '...ksk..w', '..ksSk..w', '..ksSk..w', '..ksSk..w', '..ksSk..w', '..ksSk..w', '...ksk..w', '...ksSk.w', '....ksSkw', '.....ksSk', '......kk'],
  arrow: ['', '...........kkk', '..........kdFk', '.........kFdk', '........sFkk', '.......sS', '......sS', '.....sS', '....sS', '.wwsS', '.wwS', '..ww', '..w'],
  compass: ['', '.....kkkkk', '....kGGGGGk', '...kGwwwwwGk', '..kGwwwwrwwGk', '..kGwwwrrwwGk', '..kGwwwrwwwGk', '..kGwwwkwwwGk', '..kGwwdwwwwGk', '..kGwddwwwwGk', '...kGwwwwwGk', '....kGGGGGk', '.....kkkkk'],
  clock: ['', '.....kkkkk', '....kyyyyyk', '...kycccccyk', '..kyccccYccyk', '..kycccYYYcyk', '..kyccccYccyk', '..kynnnnnnnyk', '..kynnnwnnnyk', '..kynnnnnnnyk', '...kynnnnnyk', '....kyyyyyk', '.....kkkkk'],
  map: ['', '..kkkkkkkkkkkk', '..kwwwwwwwwwwk', '..kwggwwccwwwk', '..kwgggwcccwwk', '..kwwggwwccwwk', '..kwcwwwggwwwk', '..kwccwgggwwwk', '..kwwcwwgwwyck', '..kwwwwwwwwwwk', '..kkkkkkkkkkkk'],
  bucket: ['', '', '..kkkkkkkkkkkk', '..kGCCCCCCCCGk', '..kGGGGGGGGGGk', '..kGhhhhhhhhGk', '...kGhhlhhhGk', '...kGhhhhhhGk', '...kGhhhhhhGk', '....kGhhhhGk', '....kkkkkkkk'],
  bottle: ['', '......kkk', '......kwk', '......kwk', '.....kwwwk', '....kwwwwwk', '...kwCCCCCwk', '...kwCCCCCwk', '...kwCCCCCwk', '....kwCCCwk', '.....kkkkk'],
  nugget: ['', '', '', '', '', '......kkk', '.....khlhk', '.....khhHk', '......kkk'],
  egg: ['', '', '......kkk', '.....kwwwk', '....kwwwwwk', '....kwwwwwk', '...kwwwwwwwk', '...kwwwwwwwk', '...kewwwwwek', '....keeeeek', '.....kkkkk'],
  bone: ['', '...........kk', '..........kwwk', '...........kwk', '..........kwk', '.........kwk', '........kwk', '.......kwk', '......kwk', '.....kwk', '....kwk', '...kwk', '..kwk', '.kwwk', '..kk'],
  paper: ['', '', '...kkkkkkkkk', '...kwwwwwwwk', '...kwGGGGGwk', '...kwwwwwwwk', '...kwGGGGGwk', '...kwwwwwwwk', '...kwGGGwwwk', '...kwwwwwwwk', '...kkkkkkkkk'],
  book: ['', '', '...kkkkkkkkk', '..khhhhhhhhwk', '..khlhhhhhhwk', '..khhhhhhhhwk', '..khhhyyhhhwk', '..khhhhhhhhwk', '..khhhhhhhhwk', '..kHHHHHHHHwk', '...kkkkkkkkk'],
  quill_book: ['............kk', '...........kwk', '..........kwk', '...kkkkkkkwkk', '..khhhhhhkwhwk', '..khlhhhkwhhwk', '..khhhhhkkhhwk', '..khhhhhhhhhwk', '..khhhhhhhhhwk', '..kHHHHHHHHHwk', '...kkkkkkkkkk'],
  eye: ['', '', '', '.....kkkk', '....khhhhk', '...khlhhhhk', '...khhkkhhk', '...khhkkhhk', '...khhhhhhk', '....kHHHHk', '.....kkkk'],
  carrot: ['..........g.g', '.........ggg', '........gggg', '.......khhk', '......khhhk', '.....khhhk', '....khHhk', '...khhHk', '..khhHk', '..khHk', '..khk', '..kk'],
  potato: ['', '', '', '.....kkkk', '....khhlhk', '...khhhhhhk', '...khHhhhhk', '...khhhhHhk', '....khhhhk', '.....kkkk'],
  beetroot: ['......g.g', '......ggg', '.......g', '.....kkkk', '....khhhhk', '...khlhhhhk', '...khhhhhhk', '...khhhhhhk', '....khhhhk', '.....khhk', '......kk'],
  fish: ['', '', '', '..k.....kkkk', '.khk...khhhhk', '.khhk.khhhlhhk', '..khhkhhhhhkhk', '..khhhhhhhhhhk', '.khhkhhhhhhhk', '.khk..kHHHHk', '..k....kkkk'],
  bowl: ['', '', '', '', '', '..kkkkkkkkkkkk', '..khhhhhhhhhhk', '...khhhhhhhhk', '....khhhhhhk', '.....kkkkkk'],
  stew: ['', '', '', '', '..kkkkkkkkkkkk', '..kCCCCCCCCCCk', '..kbbbbbbbbbbk', '...kbbbbbbbbk', '....kbbbbbbk', '.....kkkkkk'],
  cookie: ['', '', '', '.....kkkk', '....khhhhk', '...khhdhhhk', '...khhhhhdk', '...khdhhhhk', '....khhhdk', '.....kkkk'],
  pie: ['', '', '', '', '....kkkkkkk', '...khlhlhlhk', '..khhhhhhhhhk', '..kooooooooook', '..khhhhhhhhhhk', '...kkkkkkkkk'],
  rocket: ['......w', '.......w', '......kkk', '.....khhhk', '.....kwwwk', '.....khhhk', '.....kwwwk', '.....khhhk', '.....kkkkk', '.......s', '.......s', '.......s'],
  frame: ['', '..kkkkkkkkkkkk', '..ksSsSsSsSsSk', '..kSkkkkkkkksk', '..kskhhhhhhkSk', '..kSkhhlhhhksk', '..kskhhhhhhkSk', '..kSkhhhhhhksk', '..kskhhhhhhkSk', '..kSkkkkkkkksk', '..ksSsSsSsSsSk', '..kkkkkkkkkkkk'],
  painting: ['', '..kkkkkkkkkkkk', '..ksSsSsSsSsSk', '..kSccccccccsk', '..ksccccccyySk', '..kSccccccyysk', '..ksccgcccccSk', '..kSgggggcggsk', '..ksggggggggSk', '..kSggggggggsk', '..ksSsSsSsSsSk', '..kkkkkkkkkkkk'],
  armor_stand: ['......kkkk', '......ksSk', '......kkkk', '...kkkkkkkkkk', '...ksSsSsSsSk', '...kkkksSkkkk', '......ksSk', '......ksSk', '.....kksSkk', '.....ksSsSk', '.....kskksk', '.....kskksk', '..kkkkkkkkkkkk', '..kGGGGGGGGGGk', '..kkkkkkkkkkkk'],
  disc: ['', '.....kkkkk', '....kdddddk', '...kdDdddDdk', '..kddddddddDk', '..kdddhhhdddk', '..kddhhkhhddk', '..kdddhhhdddk', '..kDddddddddk', '...kdDdddDdk', '....kdddddk', '.....kkkkk'],
  minecart: ['', '', '', '', '.kkkkkkkkkkkkkk', '.kGCCCCCCCCCCGk', '.kGhhhhhhhhhhGk', '..kGGGGGGGGGGk', '..kkkkkkkkkkkk', '...kdk....kdk', '....k......k'],
  boat: ['', '', '', '', '', '', 'kk............kk', 'khkkkkkkkkkkkkhk', 'khhhhhhhhhhhhhhk', '.khhhhlhhhhhhhk', '..kHHHHHHHHHHk', '...kkkkkkkkkk'],
  lead: ['', '', '.....kkkk', '....khhhhk', '...khkkkkhk', '...khk..khk', '...khk..khk', '...khkkkkhk', '....khhhhk.k', '.....kkkkkhk', '..........khk', '...........kk'],
  name_tag: ['', '', '', '....kkkkkkkkk', '...kwwwwwwwwwk', '..kwkwwwwwwwwk', '..kwwwwwwwwwwk', '...kwwwwwwwwwk', '....kkkkkkkkk', '...w', '..w', '..w'],
  saddle: ['', '', '', '....kkk...kkk', '...khhhkkkhhhk', '...khhhhhhhhhk', '....khhlhhhhk', '.....kGkkkGk', '.....kGk.kGk', '.....kkk.kkk'],
  totem: ['......kkkk', '.....khhhhk', '.....kgkkgk', '.....khhhhk', '...kkkhhhhkkk', '..khhhhhhhhhhk', '..kkkkhhhhkkkk', '.....khhhhk', '.....khkkhk', '.....khk.khk', '.....kk..kk'],
  sign: ['', '', '.kkkkkkkkkkkkkk', '.khhhhhhhhhhhhk', '.khddddhdddhhhk', '.khhhhhhhhhhhhk', '.khdddhddddhhhk', '.khhhhhhhhhhhhk', '.kkkkkkksSkkkkk', '.......ksSk', '.......ksSk', '.......ksSk', '.......kkkk'],
  hook: ['', '', '.....kkkk', '....kGGGGk', '....kGkkGk', '....kGGGGk', '.....kSsk', '.....kSsk', '.....kSsk', '....kkSskk', '....khhhhk', '....khhhhk', '....kkkkkk'],
};

/** Faint outline icon shown in empty armor / off-hand slots. */
export function silhouetteURL(shape) {
  const art = ART[shape] || [];
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(60, 60, 60, 0.45)';
  art.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') ctx.fillRect(x * 2, y * 2, 2, 2); }));
  return c.toDataURL();
}

function paintIcon(spec) {
  const [shape, colorHex] = spec.split(':');
  const art = ART[shape];
  const img = new Img();
  const mat = hex(colorHex || '#888888');
  if (!art) return paint('missing');
  const pal = {
    h: mat, H: shade(mat, 0.6), l: mix(mat, [255, 255, 255], 0.45),
    s: hex('#8b6a3c'), S: hex('#5e4626'), k: [30, 30, 30], w: hex('#efe8d8'),
    r: hex('#d8322b'), R: hex('#9a1f1a'), g: hex('#3f9f2a'), y: hex('#e0c050'), b: hex('#a08030'),
    G: hex('#8a8a8a'), d: hex('#3a3a3a'), F: hex('#5a5a5a'), Y: hex('#ffe066'), c: hex('#6aa8e8'), n: hex('#1a2a5a'),
    o: hex('#e07a20'), e: hex('#e8d8b0'), C: mat,
  };
  // Shapes whose default colours aren't "material" coloured.
  const defaults = {
    coal: '#333333', flint: '#4a4a4a', leather: '#8b5a2b', bread: '#b8803a', brick: '#b5603f', apple: '#d8322b', melon_slice: '#d8322b',
    seeds: '#3f9f2a', bowl: '#8a6a3c', frame: '#8b5a2b', saddle: '#7a4a2a', totem: '#f5d742', sign: '#a8864f', lead: '#c8a878',
    bucket: '#d0d0d0', bottle: '#d8ecf4', cookie: '#b8783a', pie: '#d8a050', rocket: '#c83a2a', hook: '#a8864f', name_tag: '#efe8d8',
  };
  if (!colorHex && defaults[shape]) { const m = hex(defaults[shape]); pal.h = m; pal.H = shade(m, 0.6); pal.l = mix(m, [255, 255, 255], 0.4); }
  if (colorHex && defaults[shape] && ['bucket', 'bottle'].includes(shape)) {
    // for buckets and bottles the colour is what's inside, not the container
    const m = hex(defaults[shape]); pal.h = m; pal.H = shade(m, 0.6); pal.l = mix(m, [255, 255, 255], 0.4);
    pal.C = hex(colorHex);
  }
  if (shape === 'stew') { pal.b = hex('#8a6a3c'); pal.C = mat; }
  if (shape === 'disc') { pal.d = hex('#1e1e1e'); pal.D = hex('#3a3a3a'); }
  if (shape === 'egg') pal.w = hex('#f0e6cc');
  if (!art) return paint('missing');
  for (let y = 0; y < S; y++) {
    const row = art[y] || '';
    for (let x = 0; x < S; x++) {
      const ch = row[x];
      if (ch && ch !== '.' && pal[ch]) img.set(x, y, pal[ch]);
    }
  }
  return img;
}

// ---- Crack overlay for block breaking (10 stages) ------------------------------
function paintCracks() {
  // Crack lines all start at the centre and wander outward. Each pixel
  // remembers how far along its crack it is; stage s reveals pixels up to a
  // growing radius, so the damage spreads from the middle as you mine.
  const rand = mulberry32(1234);
  const dist = new Float32Array(S * S).fill(Infinity);
  const mark = (x, y, d) => {
    const ix = Math.round(x), iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= S || iy >= S) return false;
    dist[iy * S + ix] = Math.min(dist[iy * S + ix], d);
    return true;
  };
  const walk = (x, y, ang, d, len, branch) => {
    for (let k = 0; k < len; k++) {
      ang += (rand() - 0.5) * 0.7;
      x += Math.cos(ang); y += Math.sin(ang); d += 1;
      if (!mark(x, y, d)) return;
      if (branch && rand() < 0.12) walk(x, y, ang + (rand() < 0.5 ? 1 : -1) * (0.6 + rand() * 0.6), d, 4 + rand() * 4, false);
    }
  };
  mark(7.5, 7.5, 0); mark(8, 8, 0.5);
  const arms = 6;
  for (let a = 0; a < arms; a++) walk(7.5, 7.5, (a / arms) * Math.PI * 2 + rand() * 0.6, 0, 12, true);
  const stages = [];
  for (let s = 0; s < 10; s++) {
    const img = new Img();
    const radius = 1 + s * 1.2;
    for (let i = 0; i < S * S; i++) if (dist[i] <= radius) img.set(i % S, Math.floor(i / S), [20, 20, 20, 225]);
    stages.push(img);
  }
  return stages;
}

// ---- Public: build everything ---------------------------------------------------
export const FACE = { PX: 0, NX: 1, PY: 2, NY: 3, PZ: 4, NZ: 5 };

export function buildTextures() {
  const names = [];
  const layerOf = new Map();
  const addTex = (name) => {
    if (!layerOf.has(name)) { layerOf.set(name, names.length); names.push(name); }
    return layerOf.get(name);
  };

  // Per block: which layer each of the 6 faces uses.
  const faceLayers = new Uint16Array(MAX_ID * 6);
  for (const b of BLOCKS) {
    if (!b) continue;
    const faces = faceNames(b);
    if (!faces) continue;
    for (let f = 0; f < 6; f++) faceLayers[b.id * 6 + f] = addTex(faces[f]);
  }
  if (names.length >= 4096) throw new Error(`Too many textures (${names.length}); the mesher packs layers in 12 bits`);

  // Pack all layers into one buffer for the GPU. Rows are flipped so that
  // texture coordinate v=1 is the top of the picture.
  const imgs = names.map(paint);
  const data = new Uint8Array(S * S * 4 * names.length);
  imgs.forEach((img, layer) => {
    const packed = new Img();
    packed.d.set(img.d);
    bleedAlpha(packed);
    for (let y = 0; y < S; y++) {
      const src = (S - 1 - y) * S * 4;
      data.set(packed.d.subarray(src, src + S * 4), layer * S * S * 4 + y * S * 4);
    }
  });

  const textureImgs = new Map(names.map((n, i) => [n, imgs[i]]));
  const icons = createIconCache((name) => {
    if (!textureImgs.has(name)) textureImgs.set(name, paint(name)); // item-only pictures (door_item...)
    return textureImgs.get(name);
  });
  return {
    size: S,
    layerCount: names.length,
    data,
    faceLayers,
    cracks: paintCracks().map(img => img.d),
    icons,
    iconCanvas: icons.canvas,
    /** One face (0-5: +X -X +Y -Y +Z -Z) of a block as a 16x16 canvas. */
    faceCanvas: (id, face) => toCanvas(imgs[faceLayers[id * 6 + face]], iconTint(BLOCKS[id])),
  };
}

// Default tint for icons (a pleasant plains/forest green).
const ICON_GRASS = hex(BIOME_LIST[BIOME.PLAINS].grass);
const ICON_FOLIAGE = hex(BIOME_LIST[BIOME.FOREST].foliage);

// UI icons: blocks are drawn as small isometric cubes, items as flat sprites.
/** A texture as a 16x16 canvas, with biome-tint pixels coloured by `tint`. */
function toCanvas(img, tint) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const d = new Uint8ClampedArray(img.d);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === TA && tint) { d[i] = d[i] * tint[0] / 255; d[i + 1] = d[i + 1] * tint[1] / 255; d[i + 2] = d[i + 2] * tint[2] / 255; d[i + 3] = 255; }
  }
  c.getContext('2d').putImageData(new ImageData(d, S, S), 0, 0);
  return c;
}
const iconTint = (b) => (b.tint === 'grass' ? ICON_GRASS : b.tint === 'foliage' ? ICON_FOLIAGE : null);

/** The six face texture names (+X -X +Y -Y +Z -Z) of a block, or null. */
export function faceNames(b) {
  if (b.faces) return b.faces;
  const t = b.tex;
  if (!t) return null;
  const side = t.side || t.all;
  const f = [side, side, t.top || t.all, t.bottom || t.top || t.all, side, side];
  // Blocks with a "front" (furnace, pumpkin) show it on the +Z and -Z sides.
  if (t.front) { f[4] = t.front; f[5] = t.front; }
  return f;
}

/** Boxes to draw for a block's icon / held model, or null for flat sprites. */
export function iconBoxes(b) {
  const s = SHAPE[b.id];
  if (s === 0) return [[0, 0, 0, 1, 1, 1]];
  if (s === 5) return BOXES[b.id];
  // fences and walls are shown joined left and right, like a piece of a fence line
  if (s === 6) return dynamicBoxes('fence', [false, true, false, true]);
  if (s === 7) return dynamicBoxes('wall', [false, true, false, true]);
  return null;
}

/** Copy of a canvas with its colours darkened (alpha untouched), for shaded icon faces. */
function darken(canvas, f) {
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < id.data.length; i += 4) { id.data[i] *= f; id.data[i + 1] *= f; id.data[i + 2] *= f; }
  ctx.putImageData(id, 0, 0);
  return c;
}

/**
 * Draw boxes as a little isometric picture on a 32x32 canvas.
 * World (x, y, z) in 0..1 maps to screen (16 + 16x - 16z, 8x + 8z + 16(1 - y)) in
 * 16-pixel units, then everything is scaled by `scale` and centred.
 * Each visible face (top, +Z on the left, +X on the right) is one affine-transformed
 * drawImage of the matching part of the face texture, painted back to front.
 */
function drawIsoBoxes(ctx, boxes, faceCanvas) {
  const sorted = [...boxes].sort((a, b) => (a[0] + a[3] + a[1] + a[4] + a[2] + a[5]) - (b[0] + b[3] + b[1] + b[4] + b[2] + b[5]));
  // fit: compute screen bounds so tall fences and flat carpets both fill the icon
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  const proj = (x, y, z) => [16 + 16 * x - 16 * z, 8 * x + 8 * z + 16 * (1 - y)];
  for (const b of boxes) for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) {
    const [sx, sy] = proj(x, y, z);
    minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
  }
  const scale = Math.min(1, 31 / Math.max(maxX - minX, maxY - minY));
  const ox = 16 - ((minX + maxX) / 2) * scale, oy = 16 - ((minY + maxY) / 2) * scale;
  const put = (a, b, c, d, [ex, ey]) => ctx.setTransform(a * scale, b * scale, c * scale, d * scale, ox + ex * scale, oy + ey * scale);
  const P = 16;
  for (const b of sorted) {
    const [x0, y0, z0, x1, y1, z1] = b;
    const w = (x1 - x0) * P, h = (y1 - y0) * P, d = (z1 - z0) * P;
    // top face: picture columns = x, rows = z
    if (w > 0 && d > 0) { put(1, 0.5, -1, 0.5, proj(x0, y1, z0)); ctx.drawImage(faceCanvas(2, 1), x0 * P, z0 * P, w, d, 0, 0, w, d); }
    // +Z face (left): columns = x, rows = height from the top
    if (w > 0 && h > 0) { put(1, 0.5, 0, 1, proj(x0, y1, z1)); ctx.drawImage(faceCanvas(4, 0.78), x0 * P, (1 - y1) * P, w, h, 0, 0, w, h); }
    // +X face (right): columns = 1 - z, rows = height from the top
    if (d > 0 && h > 0) { put(1, -0.5, 0, 1, proj(x1, y1, z1)); ctx.drawImage(faceCanvas(0, 0.58), (1 - z1) * P, (1 - y1) * P, d, h, 0, 0, d, h); }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function createIconCache(texImg) {
  const cache = new Map();
  const canvases = new Map();
  const shaded = new Map(); // "name|tint|shade" -> canvas
  const faceCanvasOf = (name, tint, f) => {
    const key = `${name}|${tint ? tint.join() : ''}|${f}`;
    if (!shaded.has(key)) { const c = toCanvas(texImg(name), tint); shaded.set(key, f === 1 ? c : darken(c, f)); }
    return shaded.get(key);
  };
  const iconURL = function (itemId) {
    if (cache.has(itemId)) return cache.get(itemId);
    const item = ITEMS[itemId];
    const out = document.createElement('canvas');
    out.width = out.height = 32;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (item && item.isBlock) {
      const b = BLOCKS[itemId];
      const tint = iconTint(b);
      const faces = faceNames(b);
      const boxes = b.itemTex ? null : iconBoxes(b);
      if (boxes) drawIsoBoxes(ctx, boxes, (f, sh) => faceCanvasOf(faces[f], tint, sh));
      else ctx.drawImage(toCanvas(texImg(b.itemTex || faces[SHAPE[b.id] === 3 ? 2 : 0]), tint), 0, 0, 32, 32);
    } else if (item) {
      ctx.drawImage(toCanvas(paintIcon(item.icon)), 0, 0, 32, 32);
    }
    const url = out.toDataURL();
    cache.set(itemId, url);
    canvases.set(itemId, out);
    return url;
  };
  /** The 32x32 icon as a canvas (used for items held in hand). */
  iconURL.canvas = (itemId) => { if (!canvases.has(itemId)) iconURL(itemId); return canvases.get(itemId); };
  return iconURL;
}
