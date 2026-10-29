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
import { BLOCKS } from '../../shared/blocks.js';
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
  const light = shade(color, 1.25), dark = shade(color, 0.7);
  for (let n = 0; n < 6; n++) {
    const cx = 1 + Math.floor(rand() * 13), cy = 1 + Math.floor(rand() * 13);
    img.set(cx, cy, color); img.set(cx + 1, cy, light); img.set(cx, cy + 1, dark);
    if (rand() < 0.6) img.set(cx + 1, cy + 1, color);
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
    return Math.sqrt(d2) - Math.sqrt(d1) < 1.1 ? shade(mortar, 0.9 + r() * 0.2) : shade(c, 0.88 + r() * 0.2);
  });
}
function moss(img, r, amount = 0.35) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (r() < amount * (0.5 + 0.5 * Math.sin((x + y * 0.7) * 0.8))) img.set(x, y, shade(hex('#4f7a2e'), 0.8 + r() * 0.35));
  }
}
function stem(img, x0, y0, color = hex('#3f7f2a')) { for (let y = y0; y < 16; y++) img.set(x0, y, color); }

// ---- Painters: one function per texture name -------------------------------
// Each painter gets (img, rand, ...params).
const PAINTERS = {
  dirt(img, r) { noisy(img, hex('#866043'), 0.12, r); speckle(img, hex('#5d4330'), 0.12, r); speckle(img, hex('#a07a55'), 0.06, r); },
  coarse_dirt(img, r) { PAINTERS.dirt(img, r); speckle(img, hex('#4a3626'), 0.18, r); speckle(img, hex('#9a8a7a'), 0.05, r); },
  grass_top(img, r) { fill(img, () => grey(170 + r() * 50)); for (let k = 0; k < 40; k++) img.set(Math.floor(r() * S), Math.floor(r() * S), grey(140 + r() * 20)); },
  grass_side(img, r) {
    PAINTERS.dirt(img, r);
    for (let x = 0; x < S; x++) {
      const depth = 3 + Math.floor(r() * 2.5);
      for (let y = 0; y < depth; y++) img.set(x, y, grey(165 + r() * 50));
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
    noisy(img, hex('#7d7d7d'), 0.08, r);
    for (let n = 0; n < 7; n++) { const x = Math.floor(r() * S), y = Math.floor(r() * S); for (let k = 0; k < 3; k++) img.set(x + k, y, shade(hex('#6a6a6a'), 0.9 + r() * 0.15)); }
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
    const c = hex(bark);
    for (let x = 0; x < S; x++) { const stripe = (x % 4 === 0) ? 0.75 : 1; for (let y = 0; y < S; y++) img.set(x, y, shade(c, stripe * (0.88 + r() * 0.2))); }
  },
  birch_side(img, r) {
    noisy(img, hex('#d8d7d0'), 0.05, r);
    for (let k = 0; k < 9; k++) { const x = Math.floor(r() * 14), y = Math.floor(r() * S), w = 2 + Math.floor(r() * 3); for (let i = 0; i < w; i++) img.set(x + i, y, hex('#3a3a3a')); }
  },
  log_top(img, r, inner, bark) {
    fill(img, (x, y) => {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      const ring = Math.floor(d) % 2 === 0 ? 1 : 0.85;
      return shade(d > 6.5 ? hex(bark) : hex(inner), ring * (0.92 + r() * 0.12));
    });
  },
  planks(img, r, base) {
    const c = hex(base);
    fill(img, (x, y) => {
      const plank = Math.floor(y / 4);
      if (y % 4 === 3) return shade(c, 0.65);
      if (x === (plank % 2 === 0 ? 4 : 11)) return shade(c, 0.75);
      return shade(c, 0.9 + r() * 0.15);
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
  leaves_tint(img, r) { fill(img, () => (r() < 0.18 ? [0, 0, 0, 0] : grey(120 + r() * 80))); },
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
    clear(img);
    for (let y = 6; y < 16; y++) { img.set(7, y, hex('#8b6a3c')); img.set(8, y, hex('#6e5330')); }
    img.set(7, 5, hex('#ffe066')); img.set(8, 5, hex('#ffb02e'));
    img.set(7, 4, hex('#fff4b0')); img.set(8, 4, hex('#ffd34a'));
    img.set(7, 3, hex('#ffb02e')); img.set(8, 3, hex('#ff8a1e'));
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
  },
};

/** Paint a texture by name ("painter:param:param"). */
function paint(name) {
  const img = new Img();
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
  apple: ['', '.......S..gg', '.......Sggg', '....kkkSkkk', '...krrrrrrllk', '..krrrrrrrrllk', '..krrrrrrrrrlk', '..krrrrrrrrrrk', '..kRrrrrrrrrrk', '..kRRrrrrrrrRk', '...kRRrrrrRRk', '....kkRRRRkk', '......kkkk'],
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
  seeds: ['', '', '', '', '', '....g...g', '......g', '..g.....g..g', '.....g', '...g...g...g', '......g', '....g.....g'],
  bread: ['', '', '', '', '...kkkkkkkkk', '..khhlhhlhhhk', '.khhhhhhhhhhhk', '.khlhhlhhlhhhk', '.kHhhhhhhhhhHk', '..kHHHHHHHHHk', '...kkkkkkkkk'],
  melon_slice: ['', '', '', '', '..kkkkkkkkkkkk', '..kgggggggggk', '...kwrrrrrrwk', '....krrrkrrk', '.....krrrrk', '......krk', '.......k'],
  shield: ['', '...kkkkkkkkkk', '...khhhhhhhhk', '...khhhhhhhhk', '...khhhhhhhhk', '...khhhhhhhhk', '...khhhhhhhhk', '....khhhhhhk', '....khhhhhhk', '.....khhhhk', '......khhk', '.......kk'],
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
  const pal = {
    h: mat, H: shade(mat, 0.6), l: mix(mat, [255, 255, 255], 0.45),
    s: hex('#8b6a3c'), S: hex('#5e4626'), k: [30, 30, 30], w: hex('#efe8d8'),
    r: hex('#d8322b'), R: hex('#9a1f1a'), g: hex('#3f9f2a'), y: hex('#e0c050'), b: hex('#a08030'),
  };
  if (shape === 'coal') { pal.h = hex('#333333'); pal.H = hex('#1a1a1a'); pal.l = hex('#5a5a5a'); }
  if (shape === 'flint') { pal.h = hex('#4a4a4a'); pal.H = hex('#2a2a2a'); pal.l = hex('#7a7a7a'); }
  if (shape === 'leather') { pal.h = hex('#8b5a2b'); pal.H = hex('#5a3a1a'); pal.l = hex('#a8784a'); }
  if (shape === 'bread') { pal.h = hex('#b8803a'); pal.H = hex('#7a5020'); pal.l = hex('#d8a860'); }
  if (shape === 'brick') { pal.h = hex('#b5603f'); pal.H = hex('#7a3a22'); pal.l = hex('#d88a6a'); }
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
  const rand = mulberry32(1234);
  const pts = [];
  for (let n = 0; n < 6; n++) {
    let x = 4 + rand() * 8, y = 4 + rand() * 8;
    for (let k = 0; k < 9; k++) {
      x += (rand() - 0.5) * 3; y += (rand() - 0.5) * 3;
      pts.push([Math.max(0, Math.min(15, Math.round(x))), Math.max(0, Math.min(15, Math.round(y))), n * 9 + k]);
    }
  }
  pts.sort((a, b) => (a[2] % 9) - (b[2] % 9));
  const stages = [];
  for (let s = 0; s < 10; s++) {
    const img = new Img();
    const n = Math.floor(((s + 1) / 10) * pts.length);
    for (let i = 0; i < n; i++) img.set(pts[i][0], pts[i][1], [20, 20, 20, 220]);
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
  const faceLayers = new Uint8Array(256 * 6);
  for (const b of BLOCKS) {
    if (!b || !b.tex) continue;
    const t = b.tex;
    const side = t.side || t.all;
    const lay = [addTex(side), addTex(side), addTex(t.top || t.all), addTex(t.bottom || t.top || t.all), addTex(side), addTex(side)];
    // Blocks with a "front" (furnace, pumpkin) show it on the +Z and -Z sides.
    if (t.front) { lay[4] = addTex(t.front); lay[5] = addTex(t.front); }
    for (let f = 0; f < 6; f++) faceLayers[b.id * 6 + f] = lay[f];
  }
  if (names.length > 255) throw new Error(`Too many textures (${names.length}); the mesher stores layers in one byte`);

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
  return {
    size: S,
    layerCount: names.length,
    data,
    faceLayers,
    cracks: paintCracks().map(img => img.d),
    icons: createIconCache(textureImgs),
  };
}

// Default tint for icons (a pleasant plains/forest green).
const ICON_GRASS = hex(BIOME_LIST[BIOME.PLAINS].grass);
const ICON_FOLIAGE = hex(BIOME_LIST[BIOME.FOREST].foliage);

// UI icons: blocks are drawn as small isometric cubes, items as flat sprites.
function createIconCache(textureImgs) {
  const cache = new Map();
  const toCanvas = (img, tint) => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const d = new Uint8ClampedArray(img.d);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === TA && tint) { d[i] = d[i] * tint[0] / 255; d[i + 1] = d[i + 1] * tint[1] / 255; d[i + 2] = d[i + 2] * tint[2] / 255; d[i + 3] = 255; }
    }
    c.getContext('2d').putImageData(new ImageData(d, S, S), 0, 0);
    return c;
  };
  return function iconURL(itemId) {
    if (cache.has(itemId)) return cache.get(itemId);
    const item = ITEMS[itemId];
    const out = document.createElement('canvas');
    out.width = out.height = 32;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (item && item.isBlock) {
      const b = BLOCKS[itemId];
      const t = b.tex;
      const tint = b.tint === 'grass' ? ICON_GRASS : b.tint === 'foliage' ? ICON_FOLIAGE : null;
      if (b.shape !== 'cube') {
        ctx.drawImage(toCanvas(textureImgs.get(t.all), tint), 0, 0, 32, 32);
      } else {
        const top = toCanvas(textureImgs.get(t.top || t.all), tint);
        const left = toCanvas(textureImgs.get(t.front || t.side || t.all), tint);
        const right = toCanvas(textureImgs.get(t.side || t.all), tint);
        // Isometric cube: three affine-transformed copies of the face textures.
        ctx.setTransform(1, 0.5, -1, 0.5, 16, 0); ctx.drawImage(top, 0, 0, 16, 16);
        ctx.setTransform(1, 0.5, 0, 1, 0, 8); ctx.drawImage(left, 0, 0, 16, 16);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, 16, 16);
        ctx.setTransform(1, -0.5, 0, 1, 16, 16); ctx.drawImage(right, 0, 0, 16, 16);
        ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, 16, 16);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    } else if (item) {
      ctx.drawImage(toCanvas(paintIcon(item.icon)), 0, 0, 32, 32);
    }
    const url = out.toDataURL();
    cache.set(itemId, url);
    return url;
  };
}
