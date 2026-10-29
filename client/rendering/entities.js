// ============================================================================
// Rendering of moving things: other players, mobs, and dropped items.
//
// Network snapshots arrive ~20 times per second, but we draw at ~60 fps. To
// avoid jerky motion we render remote entities slightly in the past
// (INTERP_DELAY_MS) and smoothly interpolate between the two snapshots that
// surround that moment. This is the standard "entity interpolation" used
// by most multiplayer games.
// ============================================================================
import * as THREE from 'three';
import { INTERP_DELAY_MS } from '../../shared/config.js';
import { moveEntity } from '../../shared/physics.js';
import { rayBox } from '../../shared/raycast.js';
import { playerColors } from './skin.js';

// Must match the order of MOB_TYPES indexes in server/mobs.js.
const MOB_KINDS = ['pig', 'zombie', 'cow', 'sheep', 'chicken', 'villager'];
const MOB_SIZE = { pig: [0.9, 0.9], zombie: [0.6, 1.95], cow: [0.9, 1.4], sheep: [0.9, 1.3], chicken: [0.4, 0.7], villager: [0.6, 1.95] };
const MOB_SOUND = { pig: 'oink', zombie: 'groan', cow: 'moo', sheep: 'baa', chicken: 'cluck', villager: 'hmm' };
// Must match PROJECTILES indexes in server/projectiles.js; the item whose icon is shown in flight.
const PROJECTILE_KINDS = ['arrow', 'snowball', 'egg', 'ender_pearl'];

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

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
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), [skinM, skinM, skinM, skinM, faceM, skinM]);
  head.position.y = 1.5 + 0.25;
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
function villagerModel() {
  const m = humanoid('#c69472', '#6b4a2b', '#5a3d22', '#2a6a2a');
  const robe = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.6, 0.3), m.materials[1]);
  robe.position.y = 0.55;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.1), m.materials[0]);
  nose.position.set(0, -0.08, 0.3);
  m.head.add(nose);
  m.group.add(robe);
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

function spottedTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 16, 16);
  x.fillStyle = '#2a1e16';
  for (const [a, b, w, h] of [[1, 1, 5, 4], [9, 3, 5, 5], [3, 9, 4, 5], [11, 11, 4, 3]]) x.fillRect(a, b, w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  return t;
}

function cowModel() {
  const m = quadruped({ body: [0.75, 0.6, 1.1], legH: 0.6, head: [0.5, 0.5, 0.35], color: 0x5a4030, dark: 0x3a2a1e, faceColor: '#5a4030', bodyMap: spottedTexture() });
  const hornM = new THREE.MeshLambertMaterial({ color: 0xe8e0c8 });
  for (const x of [0.22, -0.22]) { const h = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.08), hornM); h.position.set(x, 0.3, 0); m.head.add(h); }
  return m;
}

function sheepModel() {
  const m = quadruped({ body: [0.75, 0.65, 1.0], legH: 0.55, head: [0.4, 0.45, 0.4], color: 0xeeeeee, dark: 0xd8c8b8, faceColor: '#d8c8b8' });
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

function nameTag(text) {
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

export class Entities {
  constructor(scene, iconURL, sfx, itemModels) {
    this.itemModels = itemModels;
    this.scene = scene;
    this.iconURL = iconURL;
    this.sfx = sfx;
    this.players = new Map();
    this.mobs = new Map();
    this.items = new Map();
    this.projectiles = new Map(); // id -> {obj, pos, vel, kind}
    this.iconTextures = new Map();
    this.myId = null;
    this.listener = { x: 0, y: 0, z: 0 };
  }

  // ---- Snapshots ---------------------------------------------------------
  applySnapshot(msg, names) {
    const now = performance.now();
    const seenP = new Set();
    for (const [id, x, y, z, yaw, pitch, flags, held] of msg.p) {
      if (id === this.myId) continue;
      seenP.add(id);
      let e = this.players.get(id);
      if (!e) e = this._addPlayer(id, names.get(id) || 'Player');
      e.buffer.push({ t: now, x, y, z, yaw, pitch, flags });
      this._setHeld(e, held || 0);
      if (e.buffer.length > 30) e.buffer.shift();
    }
    for (const [id, e] of this.players) if (!seenP.has(id)) e.group.visible = false;

    const seenM = new Set();
    for (const [id, kind, x, y, z, yaw, hurt] of msg.m) {
      seenM.add(id);
      let e = this.mobs.get(id);
      if (!e) e = this._addMob(id, MOB_KINDS[kind] || 'pig', x, y, z);
      e.buffer.push({ t: now, x, y, z, yaw, pitch: 0, flags: 0 });
      if (e.buffer.length > 30) e.buffer.shift();
      if (hurt && !e.hurt) this.sfx.mobHurt(this._distTo(x, y, z));
      e.hurt = !!hurt;
    }
    for (const [id, e] of this.mobs) {
      if (!seenM.has(id)) { this.scene.remove(e.group); this.mobs.delete(id); }
    }
    this._applyProjectiles(msg.pr || []);
  }

  // ---- Arrows and thrown things -----------------------------------------------
  _applyProjectiles(list) {
    const seen = new Set();
    for (const [id, kind, x, y, z, vx, vy, vz] of list) {
      seen.add(id);
      let pr = this.projectiles.get(id);
      if (!pr) {
        const name = PROJECTILE_KINDS[kind] || 'snowball';
        let obj;
        if (name === 'arrow') {
          // a thin shaft with a dark tip and pale feathers
          obj = new THREE.Group();
          const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.6), new THREE.MeshLambertMaterial({ color: 0x8b6a3c }));
          const tip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.1), new THREE.MeshLambertMaterial({ color: 0x4a4a4a }));
          tip.position.z = -0.32;
          const fl = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.14), new THREE.MeshLambertMaterial({ color: 0xeeeeee }));
          fl.position.z = 0.26;
          obj.add(shaft, tip, fl);
        } else {
          obj = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._iconTexture(this._itemIdByName(name)), alphaTest: 0.1 }));
          obj.scale.set(0.3, 0.3, 1);
        }
        this.scene.add(obj);
        pr = { obj, pos: { x, y, z }, vel: { x: vx, y: vy, z: vz }, kind: name };
        this.projectiles.set(id, pr);
      }
      pr.pos = { x, y, z }; pr.vel = { x: vx, y: vy, z: vz };
    }
    for (const [id, pr] of this.projectiles) {
      if (!seen.has(id)) { this.scene.remove(pr.obj); this.projectiles.delete(id); }
    }
  }

  _itemIdByName(name) {
    if (!this._nameIds) this._nameIds = new Map();
    if (!this._nameIds.has(name)) this._nameIds.set(name, this.itemIdOf ? this.itemIdOf(name) : 0);
    return this._nameIds.get(name);
  }

  _distTo(x, y, z) { return Math.hypot(x - this.listener.x, y - this.listener.y, z - this.listener.z); }

  _addPlayer(id, name) {
    // Colours derived from the name, so each player looks consistent everywhere.
    const c = playerColors(name);
    const m = humanoid(c.skin, c.shirt, c.pants);
    const tag = nameTag(name);
    tag.position.y = 2.25;
    m.group.add(tag);
    this.scene.add(m.group);
    const e = { ...m, tag, name, buffer: [], walk: 0 };
    this.players.set(id, e);
    return e;
  }

  /** Put item `id` (0 = nothing) in a player avatar's right hand. */
  _setHeld(e, id) {
    if (e.heldId === id || !this.itemModels) return;
    e.heldId = id;
    if (e.heldMesh) { e.armR.remove(e.heldMesh); e.heldMesh = null; }
    if (!id) return;
    const m = this.itemModels.create(id);
    if (this.itemModels.isCube(id)) {
      m.scale.setScalar(0.25);
      m.position.set(0, -0.72, 0.12);
      m.rotation.set(0, Math.PI / 4, 0);
    } else {
      m.scale.setScalar(0.5);
      m.position.set(0, -0.72, 0.2);
      m.rotation.set(0, -Math.PI / 4, -Math.PI / 4); // angled so it shows from the front and the side
    }
    e.armR.add(m);
    e.heldMesh = m;
  }

  setPlayerName(id, name) {
    const e = this.players.get(id);
    if (!e || e.name === name) return;
    e.group.remove(e.tag);
    e.tag = nameTag(name);
    e.tag.position.y = 2.25;
    e.group.add(e.tag);
    e.name = name;
  }

  removePlayer(id) {
    const e = this.players.get(id);
    if (e) { this.scene.remove(e.group); this.players.delete(id); }
  }

  _addMob(id, kind, x, y, z) {
    const make = { zombie: () => humanoid('#5f9b4c', '#2f8c8c', '#3b3f8f', '#111111'), cow: cowModel, sheep: sheepModel, chicken: chickenModel, villager: villagerModel };
    const m = (make[kind] || pigModel)();
    if (kind === 'zombie') { m.armL.rotation.x = -Math.PI / 2; m.armR.rotation.x = -Math.PI / 2; m.zombie = true; }
    m.group.position.set(x, y, z);
    this.scene.add(m.group);
    const e = { ...m, kind, buffer: [], walk: 0, hurt: false, soundTimer: 3 + Math.random() * 8 };
    this.mobs.set(id, e);
    return e;
  }

  // ---- Items ------------------------------------------------------------------
  _iconTexture(itemId) {
    let t = this.iconTextures.get(itemId);
    if (!t) {
      t = new THREE.TextureLoader().load(this.iconURL(itemId));
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
      this.iconTextures.set(itemId, t);
    }
    return t;
  }

  addItem([id, itemId, count, x, y, z, vx, vy, vz]) {
    if (this.items.has(id)) return;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._iconTexture(itemId), alphaTest: 0.1 }));
    s.scale.set(0.35, 0.35, 1);
    s.position.set(x, y, z);
    this.scene.add(s);
    this.items.set(id, { sprite: s, pos: { x, y, z }, vel: { x: vx, y: vy, z: vz }, settled: false, t: Math.random() * 6 });
  }

  removeItem(id) {
    const it = this.items.get(id);
    if (!it) return;
    this.scene.remove(it.sprite);
    it.sprite.material.dispose();
    this.items.delete(id);
  }

  clear() {
    for (const pr of this.projectiles.values()) this.scene.remove(pr.obj);
    this.projectiles.clear();
    for (const id of [...this.players.keys()]) this.removePlayer(id);
    for (const [id, e] of this.mobs) { this.scene.remove(e.group); this.mobs.delete(id); }
    for (const id of [...this.items.keys()]) this.removeItem(id);
  }

  // ---- Per-frame update ------------------------------------------------------------
  update(dt, getBlock) {
    const renderTime = performance.now() - INTERP_DELAY_MS;
    for (const e of this.players.values()) this._interpolate(e, renderTime, dt, true);
    for (const e of this.mobs.values()) {
      this._interpolate(e, renderTime, dt, false);
      // Hurt flash: tint red.
      for (const m of e.materials) m.emissive.setRGB(e.hurt ? 0.6 : 0, 0, 0);
      e.soundTimer -= dt;
      if (e.soundTimer < 0) {
        e.soundTimer = 6 + Math.random() * 10;
        const p = e.group.position, d = this._distTo(p.x, p.y, p.z);
        const sound = this.sfx[MOB_SOUND[e.kind]];
        if (sound) sound.call(this.sfx, d);
      }
    }
    // Projectiles fly on between snapshots (gravity only; the server decides hits).
    for (const pr of this.projectiles.values()) {
      pr.vel.y -= (pr.kind === 'arrow' ? 20 : 24) * dt;
      pr.pos.x += pr.vel.x * dt; pr.pos.y += pr.vel.y * dt; pr.pos.z += pr.vel.z * dt;
      pr.obj.position.set(pr.pos.x, pr.pos.y, pr.pos.z);
      if (pr.kind === 'arrow') pr.obj.lookAt(pr.pos.x - pr.vel.x, pr.pos.y - pr.vel.y, pr.pos.z - pr.vel.z);
    }
    // Items: same simple physics as the server, then bob and spin.
    for (const it of this.items.values()) {
      if (!it.settled) {
        it.vel.y -= 28 * dt;
        const res = moveEntity(it.pos, it.vel, dt, 0.25, 0.25, getBlock);
        if (res.onGround) { it.vel.x *= 0.5; it.vel.z *= 0.5; if (Math.abs(it.vel.x) + Math.abs(it.vel.z) < 0.05) it.settled = true; }
      }
      it.t += dt;
      it.sprite.position.set(it.pos.x, it.pos.y + 0.2 + Math.sin(it.t * 2.5) * 0.06, it.pos.z);
    }
  }

  _interpolate(e, renderTime, dt, isPlayer) {
    const b = e.buffer;
    if (!b.length) return;
    // Find the two snapshots around renderTime.
    let a = b[0], c = b[b.length - 1], t = 1;
    for (let i = b.length - 1; i > 0; i--) {
      if (b[i - 1].t <= renderTime) {
        a = b[i - 1]; c = b[i];
        t = Math.min(1, Math.max(0, (renderTime - a.t) / Math.max(1, c.t - a.t)));
        break;
      }
    }
    if (renderTime < b[0].t) { a = c = b[0]; t = 0; }
    const x = a.x + (c.x - a.x) * t, y = a.y + (c.y - a.y) * t, z = a.z + (c.z - a.z) * t;
    const prev = e.group.position;
    const speed = Math.hypot(x - prev.x, z - prev.z) / Math.max(dt, 0.001);
    prev.set(x, y, z);
    // Players' yaw convention faces -Z; models face +Z, hence the extra PI.
    const yaw = lerpAngle(a.yaw, c.yaw, t) + (isPlayer ? Math.PI : 0);
    e.group.rotation.y = yaw;
    e.group.visible = true;
    if (e.head && isPlayer) e.head.rotation.x = -lerpAngle(a.pitch, c.pitch, t);
    // Crouching players lean forward and sink a little.
    if (isPlayer && e.body) {
      const crouch = (c.flags & 4) !== 0;
      e.body.rotation.x = crouch ? 0.45 : 0;
      e.body.position.z = crouch ? 0.12 : 0;
      e.head.position.y = crouch ? 1.55 : 1.75;
      e.group.position.y -= crouch ? 0.12 : 0;
    }
    // Walking animation: swing limbs with a sine wave scaled by speed.
    const moving = speed > 0.3 && speed < 30;
    e.walk += dt * (moving ? Math.min(speed, 6) * 2.2 : 0);
    const swing = moving ? Math.sin(e.walk) * 0.7 : 0;
    if (e.legL) {
      e.legL.rotation.x = swing; e.legR.rotation.x = -swing;
      // Holding something: that arm swings less and stays a little forward.
      if (isPlayer) { e.armL.rotation.x = -swing; e.armR.rotation.x = e.heldId ? -0.35 + swing * 0.4 : swing; }
      else if (!e.zombie && !e.foldedArms) { e.armL.rotation.x = -swing * 0.5; e.armR.rotation.x = swing * 0.5; }
    }
    if (e.legs) {
      // Diagonal pairs move together (2-legged chickens just alternate).
      const pattern = e.legs.length === 2 ? [1, -1] : [1, -1, -1, 1];
      e.legs.forEach((leg, i) => { leg.rotation.x = swing * pattern[i]; });
    }
  }

  /** Ray test against mobs; returns {id, dist} of the nearest hit or null. */
  raycastMobs(origin, dir, maxDist) {
    let best = null;
    for (const [id, e] of this.mobs) {
      const [w, h] = MOB_SIZE[e.kind];
      const p = e.group.position;
      const d = rayBox(origin, dir, [p.x - w / 2, p.y, p.z - w / 2], [p.x + w / 2, p.y + h, p.z + w / 2]);
      if (d >= 0 && d <= maxDist && (!best || d < best.dist)) best = { id, dist: d, kind: e.kind };
    }
    return best;
  }

  /** Positions of other players (to avoid placing blocks inside them). */
  playerBoxes() {
    return [...this.players.values()].filter(e => e.group.visible).map(e => e.group.position);
  }
}
