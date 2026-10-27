// ============================================================================
// Procedural pixel-art textures. Nothing is loaded from disk: every 16x16
// block texture and item icon is "painted" here at startup from code, using a
// seeded random generator so the art is the same every time.
//
// Output:
//   - One RGBA buffer holding every texture as a layer, uploaded to the GPU as
//     a texture *array*. (A classic texture atlas packs tiles side by side in
//     one image; an array keeps them as separate layers, which lets merged
//     "greedy" quads repeat a tile across their surface with GL_REPEAT.)
//   - A table: block id + face -> layer number, used by the mesher.
//   - Icon images (data URLs) for the hotbar/inventory UI.
// ============================================================================
import { BLOCKS } from '../../shared/blocks.js';
import { ITEMS } from '../../shared/items.js';
import { mulberry32, hashSeed } from '../../shared/noise.js';

const S = 16; // texture size in pixels

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
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade([r, g, b, a = 255], f) { return [r * f, g * f, b * f, a]; }
function mix(c1, c2, t) { return [0, 1, 2].map(i => c1[i] + (c2[i] - c1[i]) * t).concat(255); }

/** Fill with a base colour plus random brightness jitter (the classic "noisy" block look). */
function noisy(img, base, jitter, rand) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    img.set(x, y, shade(base, 1 - jitter + rand() * jitter * 2));
  }
}
function speckle(img, color, chance, rand) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (rand() < chance) img.set(x, y, shade(color, 0.85 + rand() * 0.3));
  }
}
/** Ore clusters: little 2-4 pixel blobs on top of stone. */
function oreSpots(img, color, rand) {
  const light = shade(color, 1.25), dark = shade(color, 0.7);
  for (let n = 0; n < 6; n++) {
    const cx = 1 + Math.floor(rand() * 13), cy = 1 + Math.floor(rand() * 13);
    img.set(cx, cy, color); img.set(cx + 1, cy, light); img.set(cx, cy + 1, dark);
    if (rand() < 0.6) img.set(cx + 1, cy + 1, color);
  }
}

// ---- Painters: one function per texture name -------------------------------
const PAINTERS = {
  dirt(img, r) { noisy(img, hex('#866043'), 0.12, r); speckle(img, hex('#5d4330'), 0.12, r); speckle(img, hex('#a07a55'), 0.06, r); },
  grass_top(img, r) { noisy(img, hex('#5f9e3a'), 0.15, r); speckle(img, hex('#4a832b'), 0.2, r); speckle(img, hex('#79b84d'), 0.08, r); },
  grass_side(img, r) {
    PAINTERS.dirt(img, r);
    for (let x = 0; x < S; x++) {
      const depth = 3 + Math.floor(r() * 2.5);
      for (let y = 0; y < depth; y++) img.set(x, y, shade(hex('#5f9e3a'), 0.85 + r() * 0.3));
    }
  },
  snowy_grass_side(img, r) {
    PAINTERS.dirt(img, r);
    for (let x = 0; x < S; x++) {
      const depth = 3 + Math.floor(r() * 2.5);
      for (let y = 0; y < depth; y++) img.set(x, y, shade(hex('#f4fbff'), 0.9 + r() * 0.1));
    }
  },
  stone(img, r) {
    noisy(img, hex('#7d7d7d'), 0.08, r);
    for (let n = 0; n < 7; n++) { // short darker streaks
      let x = Math.floor(r() * S), y = Math.floor(r() * S);
      for (let k = 0; k < 3; k++) img.set(x + k, y, shade(hex('#6a6a6a'), 0.9 + r() * 0.15));
    }
  },
  cobblestone(img, r) { cells(img, r, [hex('#8a8a8a'), hex('#6f6f6f'), hex('#9a9a9a')], hex('#4c4c4c'), 7); },
  furnace_side(img, r) { cells(img, r, [hex('#7a7a7a'), hex('#6a6a6a')], hex('#454545'), 6); },
  furnace_top(img, r) { noisy(img, hex('#6e6e6e'), 0.1, r); frame(img, hex('#4a4a4a')); },
  furnace_front(img, r) {
    PAINTERS.furnace_side(img, r);
    for (let y = 8; y < 14; y++) for (let x = 4; x < 12; x++) img.set(x, y, hex('#1c1c1c'));
    for (let x = 3; x < 13; x++) { img.set(x, 7, hex('#3a3a3a')); img.set(x, 14, hex('#3a3a3a')); }
  },
  furnace_front_lit(img, r) {
    PAINTERS.furnace_front(img, r);
    for (let y = 10; y < 14; y++) for (let x = 4; x < 12; x++) {
      img.set(x, y, r() < 0.5 ? hex('#ff9a1f') : hex('#ffd34a'));
    }
  },
  sand(img, r) { noisy(img, hex('#dbd3a0'), 0.06, r); speckle(img, hex('#c9bf8a'), 0.15, r); },
  sandstone_side(img, r) {
    noisy(img, hex('#d8cc90'), 0.05, r);
    for (let x = 0; x < S; x++) { img.set(x, 0, hex('#c7b878')); img.set(x, 5, hex('#c9ba7c')); img.set(x, 11, hex('#c9ba7c')); img.set(x, 15, hex('#b8a96a')); }
  },
  sandstone_top(img, r) { noisy(img, hex('#ddd29a'), 0.05, r); },
  gravel(img, r) {
    noisy(img, hex('#857f7c'), 0.1, r);
    for (let n = 0; n < 30; n++) {
      const c = [hex('#6c6560'), hex('#9f9894'), hex('#5a5552'), hex('#7d6a5a')][Math.floor(r() * 4)];
      const x = Math.floor(r() * S), y = Math.floor(r() * S);
      img.set(x, y, c); img.set(x + 1, y, c);
    }
  },
  log_side(img, r) {
    for (let x = 0; x < S; x++) {
      const stripe = (x % 4 === 0) ? 0.75 : 1;
      for (let y = 0; y < S; y++) img.set(x, y, shade(hex('#6b5132'), stripe * (0.88 + r() * 0.2)));
    }
  },
  log_top(img, r) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      const ring = Math.floor(d) % 2 === 0 ? 1 : 0.85;
      const base = d > 6.5 ? hex('#6b5132') : hex('#b39462');
      img.set(x, y, shade(base, ring * (0.92 + r() * 0.12)));
    }
  },
  planks(img, r) {
    for (let y = 0; y < S; y++) {
      const plank = Math.floor(y / 4);
      for (let x = 0; x < S; x++) {
        let c = shade(hex('#a8864f'), 0.9 + r() * 0.15);
        if (y % 4 === 3) c = hex('#6e5631');
        const seam = (plank % 2 === 0 ? 4 : 11);
        if (x === seam && y % 4 !== 3) c = hex('#7e6239');
        img.set(x, y, c);
      }
    }
  },
  crafting_top(img, r) {
    PAINTERS.planks(img, r);
    frame(img, hex('#5a4326'));
    for (let i = 3; i < 13; i++) { img.set(i, 5, hex('#5a4326')); img.set(i, 10, hex('#5a4326')); img.set(5, i, hex('#5a4326')); img.set(10, i, hex('#5a4326')); }
  },
  crafting_side(img, r) {
    PAINTERS.planks(img, r);
    for (let x = 0; x < S; x++) { img.set(x, 0, hex('#5a4326')); img.set(x, 1, hex('#8a6a3c')); }
    // a little saw and hammer
    for (let x = 3; x < 7; x++) img.set(x, 6, hex('#bdbdbd'));
    for (let y = 6; y < 12; y++) img.set(4, y, hex('#5a4326'));
    for (let x = 9; x < 13; x++) img.set(x, 5, hex('#8a8a8a'));
    for (let y = 5; y < 12; y++) img.set(11, y, hex('#5a4326'));
  },
  leaves(img, r) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (r() < 0.18) img.set(x, y, [0, 0, 0, 0]);
      else img.set(x, y, shade(hex('#3f7f2a'), 0.75 + r() * 0.4));
    }
  },
  glass(img) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) img.set(x, y, [0, 0, 0, 0]);
    frame(img, hex('#dbeef2'));
    for (let i = 0; i < 4; i++) { img.set(4 + i, 3 + i, [255, 255, 255, 255]); img.set(9 + i, 8 + i, [230, 245, 250, 255]); }
  },
  water(img, r) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const wave = ((x + y * 2) % 7 === 0) ? 1.15 : 1;
      img.set(x, y, shade(hex('#3b6fd8'), wave * (0.9 + r() * 0.12)));
    }
  },
  ice(img, r) {
    noisy(img, hex('#9cc4f5'), 0.05, r);
    for (let i = 0; i < 6; i++) { img.set(3 + i, 10 - i, hex('#d8ecff')); img.set(9 + i, 14 - i, hex('#d8ecff')); }
  },
  snow(img, r) { noisy(img, hex('#f2f8fb'), 0.03, r); speckle(img, hex('#dbe8f0'), 0.1, r); },
  coal_ore(img, r) { PAINTERS.stone(img, r); oreSpots(img, hex('#262626'), r); },
  iron_ore(img, r) { PAINTERS.stone(img, r); oreSpots(img, hex('#d8a782'), r); },
  gold_ore(img, r) { PAINTERS.stone(img, r); oreSpots(img, hex('#f5d742'), r); },
  diamond_ore(img, r) { PAINTERS.stone(img, r); oreSpots(img, hex('#5ee8e0'), r); },
  bedrock(img, r) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = r();
      img.set(x, y, v < 0.3 ? hex('#262626') : v < 0.7 ? hex('#555555') : hex('#7a7a7a'));
    }
  },
  bricks(img, r) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const row = Math.floor(y / 4);
      const offset = row % 2 === 0 ? 0 : 4;
      const mortar = y % 4 === 3 || (x + offset) % 8 === 7;
      img.set(x, y, mortar ? shade(hex('#b5aea2'), 0.9 + r() * 0.1) : shade(hex('#96513e'), 0.85 + r() * 0.25));
    }
  },
  cactus_side(img, r) {
    noisy(img, hex('#4f8a2c'), 0.1, r);
    for (let y = 0; y < S; y++) { img.set(0, y, hex('#2f5c1a')); img.set(15, y, hex('#2f5c1a')); img.set(5, y, shade(hex('#3c7020'), 1)); img.set(10, y, shade(hex('#3c7020'), 1)); }
    for (let n = 0; n < 6; n++) img.set(1 + Math.floor(r() * 14), Math.floor(r() * S), hex('#e8e0b0'));
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
    for (let n = 0; n < 7; n++) {
      const x = 1 + Math.floor(r() * 14), h = 5 + Math.floor(r() * 9);
      for (let y = 0; y < h; y++) img.set(x + (y > h * 0.6 && n % 2 ? 1 : 0), 15 - y, shade(hex('#5f9e3a'), 0.8 + r() * 0.35));
    }
  },
  red_flower(img, r) { flower(img, r, hex('#d8322b')); },
  yellow_flower(img, r) { flower(img, r, hex('#f2d32b')); },
  wool(img, r, color) {
    const base = hex(color);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const knit = ((x + (y % 2)) % 2 === 0) ? 1.04 : 0.94;
      img.set(x, y, shade(base, knit * (0.94 + r() * 0.1)));
    }
  },
};

function clear(img) { for (let i = 0; i < img.d.length; i++) img.d[i] = 0; }
function frame(img, c) { for (let i = 0; i < S; i++) { img.set(i, 0, c); img.set(i, 15, c); img.set(0, i, c); img.set(15, i, c); } }
function flower(img, r, petal) {
  clear(img);
  for (let y = 8; y < 16; y++) img.set(7, y, hex('#3f7f2a'));
  img.set(6, 12, hex('#3f7f2a')); img.set(8, 11, hex('#3f7f2a'));
  for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) img.set(7 + dx, 6 + dy, shade(petal, 0.85 + r() * 0.3));
  img.set(7, 6, hex('#f7e26b'));
}
/** Rounded "stones with mortar" pattern used by cobblestone and furnaces (a cheap Voronoi). */
function cells(img, r, colors, mortar, count) {
  const pts = [];
  for (let i = 0; i < count; i++) pts.push([r() * S, r() * S, colors[i % colors.length]]);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let d1 = 1e9, d2 = 1e9, c = null;
    for (const [px, py, pc] of pts) {
      // wrap distance so the texture tiles seamlessly
      let dx = Math.abs(x - px); dx = Math.min(dx, S - dx);
      let dy = Math.abs(y - py); dy = Math.min(dy, S - dy);
      const d = dx * dx + dy * dy;
      if (d < d1) { d2 = d1; d1 = d; c = pc; } else if (d < d2) d2 = d;
    }
    const edge = Math.sqrt(d2) - Math.sqrt(d1) < 1.1;
    img.set(x, y, edge ? shade(mortar, 0.9 + r() * 0.2) : shade(c, 0.88 + r() * 0.2));
  }
}

/** Paint a texture by name. Names like "wool:#ff0000" pass a parameter. */
function paint(name) {
  const img = new Img();
  const [base, param] = name.split(':');
  const painter = PAINTERS[base];
  const rand = mulberry32(hashSeed(name));
  if (painter) painter(img, rand, param);
  else { // missing texture: magenta checkerboard, easy to spot
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) img.set(x, y, ((x >> 2) + (y >> 2)) % 2 ? [255, 0, 255] : [0, 0, 0]);
  }
  return img;
}

// ---- Item icons drawn from ASCII pixel art ------------------------------------
// h = material colour, H = dark material, l = light material,
// s = stick, S = dark stick, k = black outline
const ART = {
  pickaxe: [
    '................', '................', '....HHHHHH......', '...HhllhhhHH....',
    '....HHHH.ShhH...', '........Ss.HhH..', '.......Ss...HhH.', '......Ss.....Hh.',
    '.....Ss......Hh.', '....Ss........H.', '...Ss...........', '..Ss............',
    '.Ss.............', 'Ss..............', '................', '................'],
  axe: [
    '................', '........HH......', '.......HhlH.....', '......HhhhhH....',
    '......HhhhSs....', '.......HHSs.....', '........Ss......', '.......Ss.......',
    '......Ss........', '.....Ss.........', '....Ss..........', '...Ss...........',
    '..Ss............', '.Ss.............', '................', '................'],
  shovel: [
    '................', '...........HHH..', '..........HhlhH.', '..........HhhhH.',
    '...........HhH..', '..........SH....', '.........Ss.....', '........Ss......',
    '.......Ss.......', '......Ss........', '.....Ss.........', '....Ss..........',
    '...Ss...........', '..SS............', '..S.............', '................'],
  sword: [
    '..............HH', '.............HlH', '............HlH.', '...........HlH..',
    '..........HlH...', '.........HhH....', '........HhH.....', '.......HhH......',
    '..HH..HhH.......', '...HHhhH........', '....HhH.........', '...sSHHH........',
    '..sSs..HH.......', '.sSs............', 'SSs.............', '.s..............'],
  stick: [
    '................', '................', '............sS..', '...........sS...',
    '..........sS....', '.........sS.....', '........sS......', '.......sS.......',
    '......sS........', '.....sS.........', '....sS..........', '...sS...........',
    '..sS............', '................', '................', '................'],
  coal: [
    '................', '................', '.....kkkk.......', '....khhllk......',
    '...khhhhhhkk....', '..khhlhhhhhhk...', '..khhhhhhlhhk...', '..kHhhhhhhhhk...',
    '...kHhhhhhhHk...', '...kHHhhhhHk....', '....kkHHHHk.....', '......kkkk......',
    '................', '................', '................', '................'],
  ingot: [
    '................', '................', '................', '................',
    '.....kkkkkkk....', '....klllllllk...', '...khlllllllhk..', '..khhhhhhhhhhhk.',
    '..kHhhhhhhhhhHk.', '..kHHHHHHHHHHHk.', '..kkkkkkkkkkkkk.', '................',
    '................', '................', '................', '................'],
  gem: [
    '................', '................', '.....kkkkkk.....', '....klllhhhk....',
    '...kllhhhhhhk...', '..kkkkkkkkkkkk..', '..khlhhhhhhHHk..', '...khlhhhhHHk...',
    '....khhhhhHk....', '.....khhhHk.....', '......khHk......', '.......kk.......',
    '................', '................', '................', '................'],
  meat: [
    '................', '................', '......kkkk......', '....kkhhllkk....',
    '...khhhhhhllk...', '..khhHhhhhhhlk..', '..khhhhhhhhhhk..', '..khhhhHhhhhhk..',
    '...khhhhhhhhkk..', '....kkhhhhhkwwk.', '......kkkkk.kwwk', '.............kk.',
    '................', '................', '................', '................'],
  apple: [
    '................', '.......S..gg....', '.......Sggg.....', '....kkkSkkk.....',
    '...krrrrrrllk...', '..krrrrrrrrllk..', '..krrrrrrrrrlk..', '..krrrrrrrrrrk..',
    '..kRrrrrrrrrrk..', '..kRRrrrrrrrRk..', '...kRRrrrrRRk...', '....kkRRRRkk....',
    '......kkkk......', '................', '................', '................'],
};

function paintIcon(spec) {
  const [shape, colorHex] = spec.split(':');
  const art = ART[shape];
  const img = new Img();
  const mat = hex(colorHex || '#888888');
  const pal = {
    h: mat, H: shade(mat, 0.6), l: mix(mat, [255, 255, 255], 0.45),
    s: hex('#8b6a3c'), S: hex('#5e4626'), k: [30, 30, 30], w: hex('#efe8d8'),
    r: hex('#d8322b'), R: hex('#9a1f1a'), g: hex('#3f9f2a'),
  };
  if (shape === 'coal') { pal.h = hex('#333333'); pal.H = hex('#1a1a1a'); pal.l = hex('#5a5a5a'); }
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
  // Pre-plan crack paths, then reveal more of them at each stage.
  const pts = [];
  for (let n = 0; n < 6; n++) {
    let x = 4 + rand() * 8, y = 4 + rand() * 8;
    for (let k = 0; k < 9; k++) {
      x += (rand() - 0.5) * 3; y += (rand() - 0.5) * 3;
      pts.push([Math.max(0, Math.min(15, Math.round(x))), Math.max(0, Math.min(15, Math.round(y))), n * 9 + k]);
    }
  }
  pts.sort((a, b) => (a[2] % 9) - (b[2] % 9)); // grow all cracks outward together
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
    const front = t.front || side;
    const lay = [
      addTex(front),           // +X
      addTex(front),           // -X
      addTex(t.top || t.all),  // +Y
      addTex(t.bottom || t.all), // -Y
      addTex(front),           // +Z
      addTex(front),           // -Z
    ];
    // Only furnaces have a distinct front; show it on +Z/-Z, plain sides on X.
    if (t.front) { lay[0] = addTex(side); lay[1] = addTex(side); }
    for (let f = 0; f < 6; f++) faceLayers[b.id * 6 + f] = lay[f];
  }

  // Pack all layers into one buffer for the GPU. Rows are flipped so that
  // texture coordinate v=1 is the top of the picture.
  const imgs = names.map(paint);
  const data = new Uint8Array(S * S * 4 * names.length);
  imgs.forEach((img, layer) => {
    for (let y = 0; y < S; y++) {
      const src = (S - 1 - y) * S * 4;
      data.set(img.d.subarray(src, src + S * 4), layer * S * S * 4 + y * S * 4);
    }
  });

  const textureImgs = new Map(names.map((n, i) => [n, imgs[i]]));
  const cracks = paintCracks();

  return {
    size: S,
    layerCount: names.length,
    data,
    faceLayers,
    cracks: cracks.map(img => img.d),
    icons: createIconCache(textureImgs),
  };
}

// UI icons: blocks are drawn as small isometric cubes, items as flat sprites.
function createIconCache(textureImgs) {
  const cache = new Map();
  const toCanvas = (img) => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.d), S, S), 0, 0);
    return c;
  };
  return function iconURL(itemId) {
    if (cache.has(itemId)) return cache.get(itemId);
    const item = ITEMS[itemId];
    let url = '';
    const out = document.createElement('canvas');
    out.width = out.height = 32;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (item && item.isBlock) {
      const b = BLOCKS[itemId];
      const t = b.tex;
      if (b.shape !== 'cube') {
        ctx.drawImage(toCanvas(textureImgs.get(t.all)), 0, 0, 32, 32);
      } else {
        const top = toCanvas(textureImgs.get(t.top || t.all));
        const side = toCanvas(textureImgs.get(t.front || t.side || t.all));
        const side2 = toCanvas(textureImgs.get(t.side || t.all));
        // Isometric cube: three affine-transformed copies of the face textures.
        ctx.setTransform(1, 0.5, -1, 0.5, 16, 0); ctx.drawImage(top, 0, 0, 16, 16);
        ctx.setTransform(1, 0.5, 0, 1, 0, 8); ctx.drawImage(side, 0, 0, 16, 16);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, 16, 16);
        ctx.setTransform(1, -0.5, 0, 1, 16, 16); ctx.drawImage(side2, 0, 0, 16, 16);
        ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, 16, 16);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    } else if (item) {
      ctx.drawImage(toCanvas(paintIcon(item.icon)), 0, 0, 32, 32);
    }
    url = out.toDataURL();
    cache.set(itemId, url);
    return url;
  };
}
