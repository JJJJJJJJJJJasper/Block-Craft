// ============================================================================
// Blocky models for every mob, built from boxes with small canvas textures
// (all original designs). Front faces +Z, feet at y = 0. Each model returns
// the parts the animation code moves: head, legs or arms/legs, and extras
// like a saddle, collar or wool coat that can be shown or hidden.
// ============================================================================
import * as THREE from 'three';
import { PROFESSION_COLORS } from '../../shared/trades.js';

/** A box whose pivot is at its top centre (so limbs swing from the shoulder/hip). */
function limb(w, h, d, mat) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, -h / 2, 0);
  return new THREE.Mesh(g, mat);
}

function faceTexture(skin, eye) {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const x = c.getContext('2d');
  x.fillStyle = skin; x.fillRect(0, 0, 8, 8);
  x.fillStyle = '#ffffff'; x.fillRect(1, 3, 2, 1); x.fillRect(5, 3, 2, 1);
  x.fillStyle = eye; x.fillRect(2, 3, 1, 1); x.fillRect(5, 3, 1, 1);
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(3, 5, 2, 1);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  return t;
}

/** A blocky humanoid: head, body, two arms, two legs. Front faces +Z. */
function humanoid(skin, shirt, pants, eye = '#3355aa') {
  const skinM = new THREE.MeshLambertMaterial({ color: skin });
  const shirtM = new THREE.MeshLambertMaterial({ color: shirt });
  const pantsM = new THREE.MeshLambertMaterial({ color: pants });
  const faceM = new THREE.MeshLambertMaterial({ map: faceTexture(skin, eye) });
  const g = new THREE.Group();
  // BoxGeometry material order: +x, -x, +y, -y, +z (front), -z
  // The head turns around a pivot at the neck (its bottom centre), so looking up
  // or down tilts it on the shoulders instead of spinning it around its middle.
  const head = new THREE.Group();
  head.position.y = 1.5;
  const headBox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), [skinM, skinM, skinM, skinM, faceM, skinM]);
  headBox.position.y = 0.25;
  head.add(headBox);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.25), shirtM);
  body.position.y = 1.125;
  const armL = limb(0.25, 0.75, 0.25, skinM); armL.position.set(0.375, 1.5, 0);
  const armR = limb(0.25, 0.75, 0.25, skinM); armR.position.set(-0.375, 1.5, 0);
  const legL = limb(0.25, 0.75, 0.25, pantsM); legL.position.set(0.125, 0.75, 0);
  const legR = limb(0.25, 0.75, 0.25, pantsM); legR.position.set(-0.125, 0.75, 0);
  // Sleeves: colour the top of the arms like the shirt.
  for (const arm of [armL, armR]) {
    const sleeve = limb(0.26, 0.3, 0.26, shirtM);
    arm.add(sleeve);
  }
  g.add(head, body, armL, armR, legL, legR);
  return { group: g, head, body, armL, armR, legL, legR, materials: [skinM, shirtM, pantsM, faceM] };
}

/** Villager: a robed humanoid with a big nose and folded arms. */
function villagerModel(job = 'farmer', zombie = false) {
  const [robeC, pantsC] = PROFESSION_COLORS[job] || PROFESSION_COLORS.farmer;
  const m = humanoid(zombie ? '#5f9b4c' : '#c69472', robeC, pantsC, zombie ? '#111111' : '#2a6a2a');
  const robe = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.6, 0.3), m.materials[1]);
  robe.position.y = 0.55;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.1), m.materials[0]);
  nose.position.set(0, 0.17, 0.3);
  m.head.add(nose);
  m.group.add(robe);
  if (zombie) { m.armL.rotation.x = m.armR.rotation.x = -Math.PI / 2; m.zombie = true; return m; }
  m.armL.rotation.x = m.armR.rotation.x = -0.9;
  m.armL.position.x = 0.2; m.armR.position.x = -0.2;
  m.foldedArms = true;
  return m;
}

/**
 * Generic four-legged animal. Front faces +Z.
 * body = [width, height, length], head = [w, h, d], colours as hex numbers.
 */
function quadruped({ body: [bw, bh, bl], legH, head: [hw, hh, hd], color, dark, faceColor, eye = '#222222', bodyMap = null }) {
  const main = new THREE.MeshLambertMaterial({ color, map: bodyMap });
  const plain = bodyMap ? new THREE.MeshLambertMaterial({ color }) : main;
  const darkM = new THREE.MeshLambertMaterial({ color: dark });
  const faceM = new THREE.MeshLambertMaterial({ map: faceTexture(faceColor, eye) });
  const g = new THREE.Group();
  const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bl), main);
  bodyMesh.position.y = legH + bh / 2;
  const head = new THREE.Mesh(new THREE.BoxGeometry(hw, hh, hd), [plain, plain, plain, plain, faceM, plain]);
  head.position.set(0, legH + bh * 0.85, bl / 2 + hd / 2 - 0.05);
  const legs = [];
  const lw = Math.min(0.22, bw / 3);
  for (const [x, z] of [[bw / 2 - lw / 2, bl / 2 - lw], [-bw / 2 + lw / 2, bl / 2 - lw], [bw / 2 - lw / 2, -bl / 2 + lw], [-bw / 2 + lw / 2, -bl / 2 + lw]]) {
    const l = limb(lw, legH, lw, darkM);
    l.position.set(x, legH, z);
    legs.push(l);
    g.add(l);
  }
  g.add(bodyMesh, head);
  return { group: g, head, legs, materials: [main, darkM, faceM, plain] };
}

function spottedTexture(base = '#ffffff', spot = '#2a1e16') {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, 16, 16);
  x.fillStyle = spot;
  for (const [a, b, w, h] of [[1, 1, 5, 4], [9, 3, 5, 5], [3, 9, 4, 5], [11, 11, 4, 3]]) x.fillRect(a, b, w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  return t;
}

function cowModel(mooshroom = false) {
  const m = mooshroom
    ? quadruped({ body: [0.75, 0.6, 1.1], legH: 0.6, head: [0.5, 0.5, 0.35], color: 0xffffff, dark: 0x8a2a20, faceColor: '#a8281e', bodyMap: spottedTexture('#a8281e', '#e8e0d8') })
    : quadruped({ body: [0.75, 0.6, 1.1], legH: 0.6, head: [0.5, 0.5, 0.35], color: 0x5a4030, dark: 0x3a2a1e, faceColor: '#5a4030', bodyMap: spottedTexture() });
  if (mooshroom) {
    // little red mushrooms growing on its back
    const cap = new THREE.MeshLambertMaterial({ color: 0xd02a20 }), stem = new THREE.MeshLambertMaterial({ color: 0xe8e0d0 });
    for (const [x, z] of [[0.15, 0.25], [-0.2, -0.05], [0.1, -0.35]]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.06), stem); st.position.set(x, 1.27, z);
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.2), cap); c.position.set(x, 1.36, z);
      m.group.add(st, c);
    }
  }
  const hornM = new THREE.MeshLambertMaterial({ color: 0xe8e0c8 });
  for (const x of [0.22, -0.22]) { const h = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.08), hornM); h.position.set(x, 0.3, 0); m.head.add(h); }
  return m;
}

const WOOL_COLORS = [0xeeeeee, 0xa0a0a0, 0x505050, 0x1e1e1e, 0x6a4a30, 0xf0a0b8];
function sheepModel(variant = 0) {
  // a bare body, with a fluffy coat of wool over it (shearing hides the coat)
  const m = quadruped({ body: [0.6, 0.55, 0.9], legH: 0.55, head: [0.4, 0.45, 0.4], color: 0xd8c8b8, dark: 0xd8c8b8, faceColor: '#d8c8b8' });
  const woolM = new THREE.MeshLambertMaterial({ color: WOOL_COLORS[variant] || WOOL_COLORS[0] });
  const wool = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 1.05), woolM);
  wool.position.y = 0.55 + 0.3;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.16, 0.36), woolM);
  cap.position.set(0, 0.2, -0.04); m.head.add(cap);
  m.group.add(wool);
  m.wool = [wool, cap];
  m.materials.push(woolM);
  return m;
}

function chickenModel() {
  const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const yellow = new THREE.MeshLambertMaterial({ color: 0xf0b020 });
  const red = new THREE.MeshLambertMaterial({ color: 0xd02020 });
  const faceM = new THREE.MeshLambertMaterial({ map: faceTexture('#ffffff', '#111111') });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.35, 0.45), white);
  body.position.y = 0.42;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.3, 0.2), [white, white, white, white, faceM, white]);
  head.position.set(0, 0.7, 0.22);
  const beak = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.1), yellow); beak.position.set(0, 0, 0.14); head.add(beak);
  const wattle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.06), red); wattle.position.set(0, -0.1, 0.13); head.add(wattle);
  const legs = [];
  for (const x of [0.08, -0.08]) { const l = limb(0.06, 0.25, 0.06, yellow); l.position.set(x, 0.25, 0); legs.push(l); g.add(l); }
  g.add(body, head);
  return { group: g, head, legs, materials: [white, yellow, red, faceM] };
}

function pigModel() {
  const pink = new THREE.MeshLambertMaterial({ color: 0xf0a5a2 });
  const dark = new THREE.MeshLambertMaterial({ color: 0xd9827f });
  const faceM = new THREE.MeshLambertMaterial({ map: faceTexture('#f0a5a2', '#222222') });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.9), pink);
  body.position.y = 0.6;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.45), [pink, pink, pink, pink, faceM, pink]);
  head.position.set(0, 0.75, 0.6);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.15, 0.08), dark);
  snout.position.set(0, -0.08, 0.25);
  head.add(snout);
  const legs = [];
  for (const [x, z] of [[0.18, 0.3], [-0.18, 0.3], [0.18, -0.3], [-0.18, -0.3]]) {
    const l = limb(0.2, 0.35, 0.2, pink);
    l.position.set(x, 0.35, z);
    legs.push(l);
    g.add(l);
  }
  g.add(body, head);
  return { group: g, head, legs, materials: [pink, dark, faceM] };
}

/** Skeleton: a thin, bony humanoid with dark eye sockets. */
function skeletonModel(stray = false) {
  const bone = new THREE.MeshLambertMaterial({ color: stray ? 0xb4c4c8 : 0xd9d4c4 });
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const x = c.getContext('2d');
  x.fillStyle = '#d9d4c4'; x.fillRect(0, 0, 8, 8);
  x.fillStyle = '#2a2622'; x.fillRect(1, 2, 2, 2); x.fillRect(5, 2, 2, 2); x.fillRect(3, 5, 2, 1);
  x.fillStyle = '#8a8478'; x.fillRect(1, 6, 6, 1);
  const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter;
  const faceM = new THREE.MeshLambertMaterial({ map: t });
  const g = new THREE.Group();
  const head = new THREE.Group(); head.position.y = 1.5;
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.46), [bone, bone, bone, bone, faceM, bone]);
  skull.position.y = 0.24; head.add(skull);
  // ribcage: a spine with three ribs
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.75, 0.1), bone); spine.position.y = 1.125;
  const ribs = [1.4, 1.25, 1.1].map(y => { const r = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.07, 0.2), bone); r.position.y = y; return r; });
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.18), bone); pelvis.position.y = 0.8;
  const armL = limb(0.1, 0.75, 0.1, bone); armL.position.set(0.3, 1.45, 0);
  const armR = limb(0.1, 0.75, 0.1, bone); armR.position.set(-0.3, 1.45, 0);
  const legL = limb(0.1, 0.75, 0.1, bone); legL.position.set(0.12, 0.75, 0);
  const legR = limb(0.1, 0.75, 0.1, bone); legR.position.set(-0.12, 0.75, 0);
  // a little bow in the right hand
  const bowM = new THREE.MeshLambertMaterial({ color: 0x7a5530 });
  const bow = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.05), bowM); bow.position.set(0, -0.7, 0.12); armR.add(bow);
  g.add(head, spine, ...ribs, pelvis, armL, armR, legL, legR);
  if (stray) {
    // a tattered frosty cloak
    const cloak = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.28), new THREE.MeshLambertMaterial({ color: 0x5a7078 }));
    cloak.position.y = 1.05; g.add(cloak);
  }
  armL.rotation.x = armR.rotation.x = -Math.PI / 2;
  return { group: g, head, armL, armR, legL, legR, materials: [bone, faceM, bowM], zombie: true };
}

/** Spider: a low, round-backed body, eight jointed legs and a cluster of red eyes. */
function spiderModel(cave = false) {
  const dark = new THREE.MeshLambertMaterial({ color: cave ? 0x15303a : 0x2e2622 });
  const fur = new THREE.MeshLambertMaterial({ color: cave ? 0x1e4250 : 0x45382f });
  const eyeM = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  const g = new THREE.Group();
  const abdomen = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.85), fur); abdomen.position.set(0, 0.6, -0.45);
  const thorax = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.45), dark); thorax.position.set(0, 0.5, 0.1);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.4), dark); head.position.set(0, 0.52, 0.5);
  for (const [ex, ey] of [[-0.15, 0.08], [0.15, 0.08], [-0.07, 0.15], [0.07, 0.15], [-0.2, -0.02], [0.2, -0.02]]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.02), eyeM); e.position.set(ex, ey, 0.21); head.add(e);
  }
  const legs = [];
  for (let i = 0; i < 4; i++) for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.22 * side, 0.55, 0.3 - i * 0.18);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.08), dark);
    upper.position.set(0.3 * side, 0.12, 0); upper.rotation.z = 0.4 * side;
    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), dark);
    lower.position.set(0.58 * side, -0.12, 0);
    pivot.add(upper, lower);
    pivot.rotation.y = (i - 1.5) * 0.25 * side;
    legs.push(pivot); g.add(pivot);
  }
  g.add(abdomen, thorax, head);
  return { group: g, head, legs, materials: [dark, fur] };
}

/** Rumbler: BlockCraft's own exploding monster. A squat stone beast with glowing
 *  cracks, two ember eyes and a fuse on its back that fizzes when it gets close. */
function rumblerModel() {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const x = c.getContext('2d');
  x.fillStyle = '#6b6258'; x.fillRect(0, 0, 16, 16);
  for (let i = 0; i < 40; i++) { x.fillStyle = Math.random() < 0.5 ? '#5a524a' : '#7a7066'; x.fillRect(Math.random() * 16 | 0, Math.random() * 16 | 0, 2, 1); }
  x.fillStyle = '#ff8a1a';   // glowing cracks
  for (const [cx, cy, len, dx] of [[3, 2, 6, 1], [11, 4, 7, -1], [6, 10, 5, 1]]) for (let k = 0; k < len; k++) x.fillRect(cx + (k * dx) / 2, cy + k, 1, 1);
  const tex = new THREE.CanvasTexture(c); tex.magFilter = tex.minFilter = THREE.NearestFilter;
  const stone = new THREE.MeshLambertMaterial({ map: tex });
  const fc = document.createElement('canvas');
  fc.width = fc.height = 8;
  const f = fc.getContext('2d');
  f.drawImage(c, 0, 0, 16, 16, 0, 0, 8, 8);
  f.fillStyle = '#1e1a16'; f.fillRect(1, 2, 2, 2); f.fillRect(5, 2, 2, 2); f.fillRect(2, 5, 4, 2);
  f.fillStyle = '#ffb030'; f.fillRect(2, 3, 1, 1); f.fillRect(5, 3, 1, 1); f.fillRect(3, 6, 2, 1);
  const ft = new THREE.CanvasTexture(fc); ft.magFilter = ft.minFilter = THREE.NearestFilter;
  const faceM = new THREE.MeshLambertMaterial({ map: ft });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.8, 0.6), [stone, stone, stone, stone, faceM, stone]);
  body.position.y = 0.75;
  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.15, 0.7), stone); brow.position.y = 1.2;
  const fuse = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.06), new THREE.MeshLambertMaterial({ color: 0x3a2a1a }));
  fuse.position.set(0.15, 1.42, -0.15); fuse.rotation.z = -0.3;
  const spark = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0xffd040 }));
  spark.position.set(0.2, 1.58, -0.15);
  const legs = [];
  for (const [lx, lz] of [[0.22, 0.18], [-0.22, 0.18], [0.22, -0.18], [-0.22, -0.18]]) {
    const l = limb(0.22, 0.35, 0.22, stone); l.position.set(lx, 0.35, lz); legs.push(l); g.add(l);
  }
  g.add(body, brow, fuse, spark);
  return { group: g, head: body, legs, spark, materials: [stone, faceM] };
}

export function nameTag(text) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = 'bold 28px monospace';
  const w = Math.ceil(ctx.measureText(text).width) + 16;
  c.width = w; c.height = 40;
  ctx.font = 'bold 28px monospace';
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, w, 40);
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(text, 8, 21);
  const t = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(w / 40 * 0.3, 0.3, 1);
  s.renderOrder = 10;
  return s;
}


// ---- More animals and monsters (BlockCraft's own blocky designs) -----------------------------
const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
function bx(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}
/** A head (group pivoting at its back) with a face texture on the front. */
function headBox(w, h, d, color, eye, faceColor = null) {
  const c = typeof color === 'number' ? '#' + color.toString(16).padStart(6, '0') : color;
  const plain = lam(color);
  const face = lam(0xffffff, { map: faceTexture(faceColor || c, eye) });
  return { mesh: new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [plain, plain, plain, plain, face, plain]), plain, face };
}

function wolfModel() {
  const m = quadruped({ body: [0.42, 0.42, 0.85], legH: 0.42, head: [0.42, 0.4, 0.34], color: 0xa8a6a0, dark: 0x8a8882, faceColor: '#a8a6a0', eye: '#1a1a1a' });
  const grey = m.materials[3], dark = m.materials[1];
  const ruff = bx(0.52, 0.5, 0.36, grey, 0, 0.42 + 0.24, 0.24); m.group.add(ruff);
  m.head.add(bx(0.2, 0.16, 0.2, grey, 0, -0.08, 0.24));                      // snout
  m.head.add(bx(0.06, 0.06, 0.04, lam(0x111111), 0, -0.02, 0.34));           // nose
  for (const x of [0.13, -0.13]) m.head.add(bx(0.1, 0.14, 0.06, dark, x, 0.25, -0.04)); // ears
  const tail = limb(0.1, 0.5, 0.1, grey); tail.position.set(0, 0.8, -0.44); tail.rotation.x = 0.9; m.group.add(tail);
  // a red collar, shown once tamed
  const collar = bx(0.46, 0.08, 0.38, lam(0xc02a20), 0, -0.2, -0.04); collar.visible = false; m.head.add(collar);
  m.collar = collar; m.tail = tail;
  return m;
}

const CAT_COATS = [[0xe0b050, '#3a2a14'], [0x9a7048, '#4a3018'], [0x2a2a2e, '#1a1a1a'], [0xe8dcc8, '#5a4a3a'], [0xd8843a, '#8a4a1a']];
function catModel(variant = 0) {
  const [coat, spot] = CAT_COATS[variant] || CAT_COATS[0];
  const c = '#' + coat.toString(16).padStart(6, '0');
  const m = quadruped({ body: [0.36, 0.34, 0.8], legH: 0.32, head: [0.34, 0.3, 0.3], color: coat, dark: coat, faceColor: c, eye: '#2ac040',
    bodyMap: spottedTexture(c, spot) });
  for (const x of [0.11, -0.11]) m.head.add(bx(0.08, 0.1, 0.06, m.materials[3], x, 0.19, -0.04));
  m.head.add(bx(0.16, 0.08, 0.06, m.materials[3], 0, -0.08, 0.17));
  const tail = limb(0.08, 0.6, 0.08, m.materials[3]); tail.position.set(0, 0.6, -0.4); tail.rotation.x = 0.5; m.group.add(tail);
  m.tail = tail;
  return m;
}

const HORSE_COATS = [0xe8e4dc, 0xc8a070, 0x8a5530, 0x5a3a20, 0x262220];
/** Horses, donkeys and mules: a long body, tall legs and a head on a sloping neck. */
function horseModel(kind = 'horse', variant = 0) {
  const coat = kind === 'donkey' ? 0x8a7c6c : kind === 'mule' ? 0x4a3426 : HORSE_COATS[variant] || HORSE_COATS[2];
  const mane = kind === 'horse' ? (variant === 0 ? 0xc8c0b0 : 0x1e1a16) : 0x2a2420;
  const s = kind === 'horse' ? 1 : 0.88;
  const coatM = lam(coat), maneM = lam(mane), hoofM = lam(0x2a2420);
  const g = new THREE.Group();
  const legH = 0.85 * s;
  g.add(bx(0.62 * s, 0.6 * s, 1.3 * s, coatM, 0, legH + 0.3 * s, 0));
  const legs = [];
  for (const [x, z] of [[0.22, 0.5], [-0.22, 0.5], [0.22, -0.5], [-0.22, -0.5]]) {
    const l = limb(0.2 * s, legH, 0.2 * s, coatM); l.position.set(x * s, legH, z * s);
    l.add(bx(0.22 * s, 0.12, 0.22 * s, hoofM, 0, -legH + 0.06, 0));
    legs.push(l); g.add(l);
  }
  // the neck leans forward; the head hangs off its top
  const neck = new THREE.Group(); neck.position.set(0, legH + 0.45 * s, 0.55 * s); neck.rotation.x = 0.55;
  neck.add(bx(0.3 * s, 0.75 * s, 0.38 * s, coatM, 0, 0.35 * s, 0));
  neck.add(bx(0.08, 0.7 * s, 0.14, maneM, 0, 0.38 * s, -0.24 * s));
  const hb = headBox(0.32 * s, 0.32 * s, 0.6 * s, coat, '#1a1410');
  const head = new THREE.Group(); head.position.set(0, 0.72 * s, 0.1 * s); head.rotation.x = 0.9;
  hb.mesh.position.set(0, 0, 0.18 * s); head.add(hb.mesh);
  const earL = kind === 'horse' ? 0.12 : 0.3;  // donkeys and mules have long ears
  for (const x of [0.09, -0.09]) head.add(bx(0.07, earL, 0.06, coatM, x * s, 0.16 * s + earL / 2, -0.04));
  neck.add(head);
  g.add(neck);
  const tail = limb(0.12, 0.65 * s, 0.12, maneM); tail.position.set(0, legH + 0.5 * s, -0.66 * s); tail.rotation.x = 0.35; g.add(tail);
  // saddle, shown once saddled
  const leather = lam(0x6a3a1e);
  const saddle = new THREE.Group();
  saddle.add(bx(0.66 * s, 0.1, 0.5, leather, 0, legH + 0.65 * s, 0.05), bx(0.5 * s, 0.14, 0.12, leather, 0, legH + 0.74 * s, -0.16));
  for (const x of [0.36, -0.36]) saddle.add(bx(0.04, 0.35, 0.06, lam(0x3a3a3a), x * s, legH + 0.42 * s, 0.1));
  saddle.visible = false; g.add(saddle);
  return { group: g, head: neck, legs, saddle, tail, materials: [coatM, maneM, hb.plain, hb.face] };
}

const LLAMA_COATS = [0xe8dcc0, 0xf4f0e8, 0x8a6040, 0x8a8a8a];
function llamaModel(variant = 0) {
  const coatM = lam(LLAMA_COATS[variant % 4]);
  const g = new THREE.Group();
  g.add(bx(0.7, 0.6, 1.0, coatM, 0, 1.05, 0));
  const legs = [];
  for (const [x, z] of [[0.2, 0.35], [-0.2, 0.35], [0.2, -0.35], [-0.2, -0.35]]) { const l = limb(0.2, 0.75, 0.2, coatM); l.position.set(x, 0.78, z); legs.push(l); g.add(l); }
  const neck = new THREE.Group(); neck.position.set(0, 1.2, 0.4);
  neck.add(bx(0.3, 0.75, 0.3, coatM, 0, 0.35, 0));
  const hb = headBox(0.3, 0.28, 0.42, LLAMA_COATS[variant % 4], '#1a1410');
  hb.mesh.position.set(0, 0.78, 0.12); neck.add(hb.mesh);
  for (const x of [0.1, -0.1]) neck.add(bx(0.06, 0.16, 0.06, coatM, x, 0.98, 0));
  g.add(neck);
  g.add(bx(0.16, 0.16, 0.12, coatM, 0, 1.2, -0.52));
  return { group: g, head: neck, legs, materials: [coatM, hb.plain, hb.face] };
}

/** Slime: a bouncy translucent green cube with a darker core and a face. Scaled by its size. */
function slimeModel() {
  const g = new THREE.Group();
  const outer = new THREE.MeshLambertMaterial({ color: 0x6ccf5a, transparent: true, opacity: 0.6, depthWrite: false });
  const inner = lam(0x4a9a3a);
  const eyeM = lam(0x10200c);
  g.add(bx(0.5, 0.5, 0.5, outer, 0, 0.25, 0));
  const core = bx(0.3, 0.3, 0.3, inner, 0, 0.22, 0);
  for (const x of [0.07, -0.07]) core.add(bx(0.06, 0.06, 0.02, eyeM, x, 0.04, 0.16));
  core.add(bx(0.04, 0.03, 0.02, eyeM, 0, -0.06, 0.16));
  g.add(core);
  return { group: g, head: core, materials: [outer, inner], squish: g };
}

function witchModel() {
  const m = humanoid('#a8b088', '#4a2a5a', '#3a2048', '#2a5a2a');
  const robe = bx(0.52, 0.6, 0.3, m.materials[1], 0, 0.55, 0); m.group.add(robe);
  const hatM = lam(0x2a1a30);
  m.head.add(bx(0.7, 0.06, 0.7, hatM, 0, 0.53, 0), bx(0.46, 0.2, 0.46, hatM, 0, 0.66, 0), bx(0.3, 0.2, 0.3, hatM, 0.02, 0.84, -0.02), bx(0.14, 0.18, 0.14, hatM, 0.05, 1.0, -0.06));
  m.head.add(bx(0.1, 0.22, 0.1, m.materials[0], 0, 0.16, 0.3));
  m.head.add(bx(0.04, 0.04, 0.04, lam(0x4a7a2a), 0.04, 0.1, 0.36));          // a wart
  m.armL.rotation.x = m.armR.rotation.x = -0.9; m.armL.position.x = 0.2; m.armR.position.x = -0.2; m.foldedArms = true;
  return m;
}

/** Iron golem: a huge, broad-shouldered iron guardian with long arms and vines growing on it. */
function ironGolemModel() {
  const iron = lam(0xd8d2c8), vine = lam(0x4a8a30), dark = lam(0xb8b0a6);
  const g = new THREE.Group();
  const head = new THREE.Group(); head.position.y = 2.15;
  const hb = headBox(0.5, 0.55, 0.45, 0xd8d2c8, '#c02020');
  hb.mesh.position.y = 0.27; head.add(hb.mesh);
  head.add(bx(0.12, 0.2, 0.12, iron, 0, 0.16, 0.27));                       // nose
  const chest = bx(1.0, 0.75, 0.6, iron, 0, 1.75, 0);
  const waist = bx(0.6, 0.35, 0.4, dark, 0, 1.2, 0);
  chest.add(bx(0.2, 0.4, 0.02, vine, 0.25, -0.1, 0.31), bx(0.12, 0.3, 0.02, vine, -0.3, 0.1, 0.31));
  const armL = limb(0.3, 1.5, 0.35, iron); armL.position.set(0.66, 2.1, 0);
  const armR = limb(0.3, 1.5, 0.35, iron); armR.position.set(-0.66, 2.1, 0);
  armL.add(bx(0.32, 0.3, 0.37, vine, 0, -0.5, 0));
  const legL = limb(0.32, 1.05, 0.34, iron); legL.position.set(0.22, 1.05, 0);
  const legR = limb(0.32, 1.05, 0.34, iron); legR.position.set(-0.22, 1.05, 0);
  g.add(head, chest, waist, armL, armR, legL, legR);
  return { group: g, head, armL, armR, legL, legR, materials: [iron, vine, dark, hb.plain, hb.face] };
}

function squidModel() {
  const skin = lam(0x2c4060), light = lam(0x4a6488);
  const g = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 0.45;
  body.add(bx(0.6, 0.75, 0.6, skin, 0, 0.3, 0));
  for (const x of [0.15, -0.15]) body.add(bx(0.1, 0.1, 0.02, lam(0xe8e8f0), x, 0.05, 0.31));
  const legs = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const t = limb(0.1, 0.6, 0.1, i % 2 ? light : skin);
    t.position.set(Math.sin(a) * 0.22, -0.06, Math.cos(a) * 0.22);
    legs.push(t); body.add(t);
  }
  g.add(body);
  return { group: g, head: body, tentacles: legs, materials: [skin, light] };
}

function batModel() {
  const fur = lam(0x4a3a2c), wingM = lam(0x2a2018, { side: THREE.DoubleSide });
  const g = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 0.45;
  body.add(bx(0.22, 0.3, 0.18, fur, 0, 0, 0));
  const hb = headBox(0.22, 0.2, 0.2, 0x4a3a2c, '#e8c020'); hb.mesh.position.y = 0.24; body.add(hb.mesh);
  for (const x of [0.07, -0.07]) body.add(bx(0.05, 0.1, 0.04, fur, x, 0.38, 0));
  const wings = [];
  for (const sgn of [1, -1]) {
    const w = new THREE.Group(); w.position.set(0.1 * sgn, 0.08, 0);
    w.add(bx(0.4, 0.3, 0.02, wingM, 0.2 * sgn, -0.05, -0.02));
    wings.push(w); body.add(w);
  }
  g.add(body);
  return { group: g, head: body, wings, materials: [fur, wingM, hb.plain, hb.face] };
}

const RABBIT_COATS = [0x8a6a4a, 0xf0ece4, 0x2a2622, 0xc8b490, 0x6a5a4a];
function rabbitModel(variant = 0) {
  const coat = RABBIT_COATS[variant % 5];
  const m = quadruped({ body: [0.28, 0.26, 0.4], legH: 0.12, head: [0.24, 0.24, 0.22], color: coat, dark: coat, faceColor: '#' + coat.toString(16).padStart(6, '0'), eye: '#c02020' });
  for (const x of [0.06, -0.06]) m.head.add(bx(0.06, 0.24, 0.04, m.materials[3], x, 0.22, -0.04));
  m.group.add(bx(0.1, 0.1, 0.08, lam(0xf8f8f8), 0, 0.28, -0.22));
  return m;
}

function polarBearModel() {
  const m = quadruped({ body: [0.85, 0.75, 1.35], legH: 0.55, head: [0.48, 0.42, 0.4], color: 0xf0eee8, dark: 0xe0ddd5, faceColor: '#f0eee8', eye: '#1a1a1a' });
  m.head.add(bx(0.26, 0.18, 0.18, m.materials[3], 0, -0.08, 0.27), bx(0.1, 0.06, 0.04, lam(0x1a1a1a), 0, -0.03, 0.37));
  for (const x of [0.17, -0.17]) m.head.add(bx(0.1, 0.1, 0.06, m.materials[3], x, 0.24, -0.06));
  return m;
}

const PARROT_COLORS = [[0xd02a20, 0x2050c0], [0x2050c0, 0xf0d020], [0x40b030, 0xd02a20], [0x30c0d0, 0xf0d020], [0x9a9a9a, 0xf0d020]];
function parrotModel(variant = 0) {
  const [main, accent] = PARROT_COLORS[variant % 5];
  const mainM = lam(main), accentM = lam(accent), beakM = lam(0x3a3a3a);
  const g = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 0.2;
  body.add(bx(0.22, 0.38, 0.22, mainM, 0, 0.2, 0));
  const hb = headBox(0.2, 0.2, 0.22, main, '#111111'); hb.mesh.position.set(0, 0.48, 0.04); body.add(hb.mesh);
  body.add(bx(0.08, 0.12, 0.08, beakM, 0, 0.44, 0.17), bx(0.04, 0.12, 0.14, accentM, 0, 0.62, -0.02));
  body.add(bx(0.12, 0.26, 0.06, accentM, 0, 0.0, -0.12));
  const wings = [];
  for (const sgn of [1, -1]) { const w = limb(0.04, 0.3, 0.18, accentM); w.position.set(0.13 * sgn, 0.36, 0); wings.push(w); body.add(w); }
  const legs = [];
  for (const x of [0.05, -0.05]) { const l = limb(0.04, 0.2, 0.04, beakM); l.position.set(x, 0.2, 0); legs.push(l); g.add(l); }
  g.add(body);
  return { group: g, head: body, wings, legs, materials: [mainM, accentM, hb.plain, hb.face] };
}

/** The Shade: BlockCraft's own night wanderer. A tall hooded figure in a dark trailing
 *  cloak that never quite touches the ground, a pale mask with one glowing slit, and
 *  little wisps drifting around it. It doesn't like being stared at. */
function shadeModel() {
  const cloak = lam(0x1c1630), cloak2 = lam(0x2a2244), mask = lam(0xd8d0c0);
  const glow = new THREE.MeshBasicMaterial({ color: 0x60f0d0 });
  const g = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 0.25;
  // the cloak flares out toward the bottom in layers
  body.add(bx(0.75, 0.5, 0.6, cloak2, 0, 0.25, 0), bx(0.62, 0.6, 0.5, cloak, 0, 0.8, 0), bx(0.52, 0.7, 0.42, cloak2, 0, 1.45, 0));
  const head = new THREE.Group(); head.position.y = 2.1;
  head.add(bx(0.5, 0.5, 0.5, cloak, 0, 0.24, -0.02));                        // the hood
  head.add(bx(0.36, 0.38, 0.04, mask, 0, 0.2, 0.24));                        // the mask
  head.add(bx(0.26, 0.04, 0.02, glow, 0, 0.24, 0.27));                       // one glowing slit
  body.add(head);
  const armL = limb(0.12, 1.1, 0.12, cloak); armL.position.set(0.34, 1.8, 0);
  const armR = limb(0.12, 1.1, 0.12, cloak); armR.position.set(-0.34, 1.8, 0);
  for (const a of [armL, armR]) a.add(bx(0.1, 0.12, 0.1, mask, 0, -1.1, 0));
  body.add(armL, armR);
  const wisps = [];
  for (let i = 0; i < 3; i++) { const w = bx(0.08, 0.08, 0.08, glow); body.add(w); wisps.push(w); }
  g.add(body);
  return { group: g, head, armL, armR, wisps, float: body, materials: [cloak, cloak2, mask] };
}

function snowGolemModel() {
  const snow = lam(0xf4f8fc), stick = lam(0x6a4a2a);
  const g = new THREE.Group();
  g.add(bx(0.62, 0.62, 0.62, snow, 0, 0.31, 0), bx(0.5, 0.5, 0.5, snow, 0, 0.86, 0));
  const head = new THREE.Group(); head.position.y = 1.11;
  // a carved pumpkin head
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const x = c.getContext('2d');
  x.fillStyle = '#e08a1a'; x.fillRect(0, 0, 8, 8);
  x.fillStyle = '#3a2008'; x.fillRect(1, 2, 2, 2); x.fillRect(5, 2, 2, 2); x.fillRect(1, 5, 6, 1); x.fillRect(2, 6, 1, 1); x.fillRect(5, 6, 1, 1);
  const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter;
  const orange = lam(0xe08a1a), face = new THREE.MeshLambertMaterial({ map: t });
  const pumpkin = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.46), [orange, orange, orange, orange, face, orange]);
  pumpkin.position.y = 0.23; head.add(pumpkin);
  const armL = limb(0.06, 0.6, 0.06, stick); armL.position.set(0.28, 1.0, 0); armL.rotation.z = 1.0;
  const armR = limb(0.06, 0.6, 0.06, stick); armR.position.set(-0.28, 1.0, 0); armR.rotation.z = -1.0;
  g.add(head, armL, armR);
  return { group: g, head, materials: [snow, orange, face] };
}

/** Guardians: spiky one-eyed fish that guard the ocean monuments. */
function guardianModel(elder = false) {
  const skin = lam(elder ? 0xc8c6b6 : 0x6a9a8c), fin = lam(elder ? 0xa8a296 : 0xd88a3a), spikeM = lam(elder ? 0xe8e0d0 : 0xe8c8a0);
  const g = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 0.42;
  body.add(bx(0.75, 0.6, 0.75, skin));
  // the big eye
  body.add(bx(0.26, 0.26, 0.04, lam(0xf0f0e8), 0, 0.02, 0.38), bx(0.1, 0.12, 0.02, lam(0x2a1a10), 0, 0.02, 0.41));
  const spikes = [];
  for (const [x, y, z] of [[0.4, 0.3, 0.3], [-0.4, 0.3, 0.3], [0.4, -0.3, 0.3], [-0.4, -0.3, 0.3], [0.4, 0.3, -0.3], [-0.4, 0.3, -0.3], [0.4, -0.3, -0.3], [-0.4, -0.3, -0.3],
    [0, 0.36, 0], [0, -0.36, 0], [0.42, 0, 0], [-0.42, 0, 0]]) { const sp = bx(0.08, 0.08, 0.08, spikeM, x, y, z); spikes.push(sp); body.add(sp); }
  const tail = new THREE.Group(); tail.position.set(0, 0, -0.38);
  tail.add(bx(0.3, 0.3, 0.4, skin, 0, 0, -0.2), bx(0.18, 0.18, 0.35, skin, 0, 0, -0.55), bx(0.04, 0.3, 0.3, fin, 0, 0, -0.85));
  body.add(tail);
  g.add(body);
  return { group: g, head: body, tail, spikes, float: body, materials: [skin, fin, spikeM] };
}

/** Vindicators and evokers: grey-skinned folk in dark coats who live in mansions. */
function illagerModel(evoker = false) {
  const m = humanoid('#9a9c90', evoker ? '#2a2a3a' : '#3a4250', evoker ? '#22222c' : '#2a2a2a', '#2a2a2a');
  m.head.add(bx(0.1, 0.2, 0.1, m.materials[0], 0, 0.16, 0.3));              // nose
  m.head.add(bx(0.36, 0.04, 0.02, lam(0x2a2a2a), 0, 0.33, 0.26));            // a heavy brow
  if (evoker) {
    const robe = bx(0.54, 0.62, 0.32, m.materials[1], 0, 0.55, 0); m.group.add(robe);
    const trim = lam(0xc8a030);
    m.group.add(bx(0.06, 1.0, 0.02, trim, 0, 1.0, 0.17));
    m.armL.rotation.x = m.armR.rotation.x = -0.9; m.armL.position.x = 0.2; m.armR.position.x = -0.2; m.foldedArms = true;
  } else {
    // an axe in the right hand, raised
    const axe = new THREE.Group(); axe.position.set(0, -0.7, 0.1);
    axe.add(bx(0.05, 0.6, 0.05, lam(0x6a4a2a), 0, 0.2, 0), bx(0.04, 0.22, 0.2, lam(0xb8b8b8), 0, 0.42, 0.1));
    m.armR.add(axe);
    m.armR.rotation.x = -1.2; m.raisedArm = true;
  }
  return m;
}

function vexModel() {
  const bodyM = new THREE.MeshLambertMaterial({ color: 0xa8c4d8, transparent: true, opacity: 0.85 });
  const wingM = new THREE.MeshLambertMaterial({ color: 0xe8f0f8, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
  const g = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 0.2;
  const hb = headBox(0.25, 0.25, 0.25, 0xa8c4d8, '#c02020'); hb.mesh.position.y = 0.5; body.add(hb.mesh);
  body.add(bx(0.2, 0.3, 0.12, bodyM, 0, 0.24, 0), bx(0.12, 0.2, 0.08, bodyM, 0, 0.0, -0.02));
  const wings = [];
  for (const s of [1, -1]) { const w = new THREE.Group(); w.position.set(0.05 * s, 0.3, -0.07); w.add(bx(0.3, 0.25, 0.02, wingM, 0.15 * s, 0.05, 0)); wings.push(w); body.add(w); }
  body.add(bx(0.03, 0.03, 0.35, lam(0xc8c8c8), -0.14, 0.2, 0.18));            // a little sword
  g.add(body);
  return { group: g, head: body, wings, float: body, materials: [bodyM, hb.plain, hb.face] };
}

function silverfishModel() {
  const shell = lam(0x8a8a92), dark = lam(0x6a6a72);
  const g = new THREE.Group();
  const segs = [];
  [[0.18, 0.14, 0.12], [0.26, 0.18, 0.14], [0.3, 0.2, 0.14], [0.22, 0.16, 0.14], [0.14, 0.1, 0.12]].forEach(([w, h, d], i) => {
    const m = bx(w, h, d, i % 2 ? dark : shell, 0, h / 2, 0.3 - i * 0.14); segs.push(m); g.add(m);
  });
  return { group: g, head: segs[0], segments: segs, materials: [shell, dark] };
}

function huskModel() {
  const m = humanoid('#b4a072', '#8a7a5a', '#5a4a34', '#111111');
  m.armL.rotation.x = -Math.PI / 2; m.armR.rotation.x = -Math.PI / 2; m.zombie = true;
  return m;
}

// ---- The list of mob kinds the server can send ---------------------------------------------
// Must match the order of MOB_TYPES indexes in server/mobs.js (only ever append).
export const MOB_KINDS = ['pig', 'zombie', 'cow', 'sheep', 'chicken', 'villager', 'skeleton', 'spider', 'rumbler', 'wolf', 'cat', 'horse', 'slime', 'witch',
  'iron_golem', 'squid', 'bat', 'rabbit', 'polar_bear', 'parrot', 'cave_spider', 'shade', 'husk', 'stray', 'mooshroom', 'donkey', 'llama', 'snow_golem',
  'guardian', 'elder_guardian', 'vindicator', 'evoker', 'vex', 'zombie_villager', 'silverfish', 'mule'];
// [width, height] of each, for aiming at them (same as the server's)
export const MOB_SIZE = { pig: [0.9, 0.9], zombie: [0.6, 1.95], cow: [0.9, 1.4], sheep: [0.9, 1.3], chicken: [0.4, 0.7], villager: [0.6, 1.95],
  skeleton: [0.6, 1.95], spider: [1.3, 0.9], rumbler: [0.7, 1.4], wolf: [0.6, 0.85], cat: [0.6, 0.7], horse: [1.3, 1.6], slime: [0.51, 0.51],
  witch: [0.6, 1.95], iron_golem: [1.4, 2.7], squid: [0.8, 0.8], bat: [0.5, 0.9], rabbit: [0.4, 0.5], polar_bear: [1.3, 1.4], parrot: [0.5, 0.9],
  cave_spider: [0.7, 0.5], shade: [0.6, 2.9], husk: [0.6, 1.95], stray: [0.6, 1.95], mooshroom: [0.9, 1.4], donkey: [1.4, 1.5], llama: [0.9, 1.87],
  snow_golem: [0.7, 1.9], guardian: [0.85, 0.85], elder_guardian: [2, 2], vindicator: [0.6, 1.95], evoker: [0.6, 1.95], vex: [0.4, 0.8],
  zombie_villager: [0.6, 1.95], silverfish: [0.4, 0.3], mule: [1.4, 1.6] };
export const MOB_SOUND = { pig: 'oink', zombie: 'groan', cow: 'moo', sheep: 'baa', chicken: 'cluck', villager: 'hmm', skeleton: 'rattle', spider: 'hiss', rumbler: 'rumble',
  wolf: 'bark', cat: 'meow', horse: 'neigh', slime: 'squish', witch: 'cackle', iron_golem: 'clank', squid: 'bubble', bat: 'squeak', rabbit: 'squeak',
  polar_bear: 'growl', parrot: 'chirp', cave_spider: 'hiss', shade: 'whisper', husk: 'groan', stray: 'rattle', mooshroom: 'moo', donkey: 'bray', llama: 'bray',
  snow_golem: null, guardian: 'bubble', elder_guardian: 'bubble', vindicator: 'hrm', evoker: 'hrm', vex: 'squeak', zombie_villager: 'groan', silverfish: 'squeak', mule: 'bray' };

/** Build the model for a mob. `job` is a villager's profession, `variant` picks coat colours. */
export function makeMob(kind, job, variant = 0) {
  switch (kind) {
    case 'zombie': { const m = humanoid('#5f9b4c', '#2f8c8c', '#3b3f8f', '#111111'); m.armL.rotation.x = -Math.PI / 2; m.armR.rotation.x = -Math.PI / 2; m.zombie = true; return m; }
    case 'cow': return cowModel();
    case 'mooshroom': return cowModel(true);
    case 'sheep': return sheepModel(variant);
    case 'chicken': return chickenModel();
    case 'villager': return villagerModel(job);
    case 'zombie_villager': return villagerModel(job, true);
    case 'skeleton': return skeletonModel();
    case 'stray': return skeletonModel(true);
    case 'spider': return spiderModel();
    case 'cave_spider': { const m = spiderModel(true); m.group.scale.setScalar(0.55); return m; }
    case 'rumbler': return rumblerModel();
    case 'wolf': return wolfModel();
    case 'cat': return catModel(variant);
    case 'horse': case 'donkey': case 'mule': return horseModel(kind, variant);
    case 'llama': return llamaModel(variant);
    case 'slime': return slimeModel();
    case 'witch': return witchModel();
    case 'iron_golem': return ironGolemModel();
    case 'squid': return squidModel();
    case 'bat': return batModel();
    case 'rabbit': return rabbitModel(variant);
    case 'polar_bear': return polarBearModel();
    case 'parrot': return parrotModel(variant);
    case 'shade': return shadeModel();
    case 'husk': return huskModel();
    case 'snow_golem': return snowGolemModel();
    case 'guardian': return guardianModel();
    case 'elder_guardian': { const m = guardianModel(true); m.group.scale.setScalar(2.35); return m; }
    case 'vindicator': return illagerModel(false);
    case 'evoker': return illagerModel(true);
    case 'vex': return vexModel();
    case 'silverfish': return silverfishModel();
    default: return pigModel();
  }
}

export { humanoid, limb, faceTexture };
