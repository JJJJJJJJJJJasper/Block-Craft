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
import { hashSeed, mulberry32 } from '../../shared/noise.js';

const MOB_KINDS = ['pig', 'zombie'];
const MOB_SIZE = { pig: [0.9, 0.9], zombie: [0.6, 1.95] };

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
  return { group: g, head, armL, armR, legL, legR, materials: [skinM, shirtM, pantsM, faceM] };
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
  constructor(scene, iconURL, sfx) {
    this.scene = scene;
    this.iconURL = iconURL;
    this.sfx = sfx;
    this.players = new Map();
    this.mobs = new Map();
    this.items = new Map();
    this.iconTextures = new Map();
    this.myId = null;
    this.listener = { x: 0, y: 0, z: 0 };
  }

  // ---- Snapshots ---------------------------------------------------------
  applySnapshot(msg, names) {
    const now = performance.now();
    const seenP = new Set();
    for (const [id, x, y, z, yaw, pitch, flags] of msg.p) {
      if (id === this.myId) continue;
      seenP.add(id);
      let e = this.players.get(id);
      if (!e) e = this._addPlayer(id, names.get(id) || 'Player');
      e.buffer.push({ t: now, x, y, z, yaw, pitch, flags });
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
  }

  _distTo(x, y, z) { return Math.hypot(x - this.listener.x, y - this.listener.y, z - this.listener.z); }

  _addPlayer(id, name) {
    // Colours derived from the name, so each player looks consistent everywhere.
    const r = mulberry32(hashSeed(name));
    const skins = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
    const shirt = new THREE.Color().setHSL(r(), 0.55, 0.45);
    const pants = new THREE.Color().setHSL(r(), 0.4, 0.25);
    const m = humanoid(skins[Math.floor(r() * skins.length)], shirt, pants);
    const tag = nameTag(name);
    tag.position.y = 2.25;
    m.group.add(tag);
    this.scene.add(m.group);
    const e = { ...m, tag, name, buffer: [], walk: 0 };
    this.players.set(id, e);
    return e;
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
    const m = kind === 'zombie' ? humanoid('#5f9b4c', '#2f8c8c', '#3b3f8f', '#111111') : pigModel();
    if (kind === 'zombie') { m.armL.rotation.x = -Math.PI / 2; m.armR.rotation.x = -Math.PI / 2; }
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
        if (e.kind === 'pig') this.sfx.oink(d); else this.sfx.groan(d);
      }
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
    // Walking animation: swing limbs with a sine wave scaled by speed.
    const moving = speed > 0.3 && speed < 30;
    e.walk += dt * (moving ? Math.min(speed, 6) * 2.2 : 0);
    const swing = moving ? Math.sin(e.walk) * 0.7 : 0;
    if (e.legL) {
      e.legL.rotation.x = swing; e.legR.rotation.x = -swing;
      if (isPlayer) { e.armL.rotation.x = -swing; e.armR.rotation.x = swing; }
    }
    if (e.legs) { e.legs[0].rotation.x = swing; e.legs[3].rotation.x = swing; e.legs[1].rotation.x = -swing; e.legs[2].rotation.x = -swing; }
  }

  /** Ray test against mobs; returns {id, dist} of the nearest hit or null. */
  raycastMobs(origin, dir, maxDist) {
    let best = null;
    for (const [id, e] of this.mobs) {
      const [w, h] = MOB_SIZE[e.kind];
      const p = e.group.position;
      const d = rayBox(origin, dir, [p.x - w / 2, p.y, p.z - w / 2], [p.x + w / 2, p.y + h, p.z + w / 2]);
      if (d >= 0 && d <= maxDist && (!best || d < best.dist)) best = { id, dist: d };
    }
    return best;
  }

  /** Positions of other players (to avoid placing blocks inside them). */
  playerBoxes() {
    return [...this.players.values()].filter(e => e.group.visible).map(e => e.group.position);
  }
}
