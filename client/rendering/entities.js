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
import { PROFESSIONS } from '../../shared/trades.js';
import { makeMob, humanoid, nameTag, MOB_KINDS, MOB_SIZE, MOB_SOUND } from './mobModels.js';
import { Effects } from './effects.js';

// Must match PROJECTILES indexes in server/projectiles.js; the item whose icon is shown in flight.
const PROJECTILE_KINDS = ['arrow', 'snowball', 'egg', 'ender_pearl', 'glass_bottle'];


function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
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
    this.localHand = null;         // where the local player holds a lead
    this.localMount = null;        // {id, pos, yaw} of the horse we're riding
    this.fx = new Effects(scene);  // particles, fireworks, beams, fangs
    this.ropeMat = new THREE.LineBasicMaterial({ color: 0x9a7a4a });
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
    for (const [id, kind, x, y, z, yaw, flags, name, leash, variant] of msg.m) {
      seenM.add(id);
      let e = this.mobs.get(id);
      if (!e) e = this._addMob(id, MOB_KINDS[kind] || 'pig', x, y, z, PROFESSIONS[(flags >> 2) & 7], variant || 0);
      e.buffer.push({ t: now, x, y, z, yaw, pitch: 0, flags: 0 });
      if (e.buffer.length > 30) e.buffer.shift();
      if ((flags & 1) && !e.hurt) this.sfx.mobHurt(this._distTo(x, y, z));
      // flags: 1 hurt, 2 fuse lit, 32 baby, 64 in love, 128 tamed, 256 sitting, 512 saddled, 1024 angry, 2048 sheared
      e.hurt = !!(flags & 1);
      e.fusing = !!(flags & 2);
      e.baby = !!(flags & 32);
      e.love = !!(flags & 64);
      e.tamed = !!(flags & 128);
      e.sitting = !!(flags & 256);
      e.saddled = !!(flags & 512);
      e.angry = !!(flags & 1024);
      e.sheared = !!(flags & 2048);
      e.size = e.kind === 'slime' ? variant || 1 : 1;
      e.leash = leash || null;
      this._setMobName(e, name || null);
    }
    for (const [id, e] of this.mobs) {
      if (!seenM.has(id)) this._removeMob(id, e);
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

  /** Another player got hit: flash their avatar and play a sound. */
  playerHurt(id) {
    const e = this.players.get(id);
    if (!e) return;
    e.hurtUntil = performance.now() + 350;
    const p = e.group.position;
    this.sfx.hurt(this._distTo(p.x, p.y, p.z));
  }

  removePlayer(id) {
    const e = this.players.get(id);
    if (e) { this.scene.remove(e.group); this.players.delete(id); }
  }

  _addMob(id, kind, x, y, z, job, variant) {
    const m = makeMob(kind, job, variant);
    // The model sits inside an outer group: the outer one moves and turns, the inner
    // one is scaled (babies, slimes) and tilted (sitting) without affecting that.
    const outer = new THREE.Group();
    outer.add(m.group);
    outer.position.set(x, y, z);
    this.scene.add(outer);
    const baseScale = m.group.scale.x;
    if (m.float) m.float.userData.baseY = m.float.position.y;
    const e = { ...m, inner: m.group, group: outer, baseScale, kind, buffer: [], walk: 0, hurt: false, soundTimer: 3 + Math.random() * 8, t: Math.random() * 10 };
    this.mobs.set(id, e);
    return e;
  }

  _removeMob(id, e) {
    this.scene.remove(e.group);
    if (e.rope) { this.scene.remove(e.rope); e.rope.geometry.dispose(); }
    this.mobs.delete(id);
  }

  /** Name tags float above named mobs. */
  _setMobName(e, name) {
    if (e.name === name) return;
    e.name = name;
    if (e.tag) { e.group.remove(e.tag); e.tag.material.map.dispose(); e.tag.material.dispose(); e.tag = null; }
    if (name) { e.tag = nameTag(name); e.group.add(e.tag); }
  }

  /** Height and width of a mob as drawn right now (babies are half size, slimes come in sizes). */
  _mobSize(e) {
    const [w, h] = MOB_SIZE[e.kind] || [0.8, 1];
    const k = (e.baby ? 0.5 : 1) * (e.size || 1);
    return [w * k, h * k];
  }

  /** Where a lead attached to this holder is: a player's hand, or a fence post [x, y, z]. */
  _leashHolder(leash) {
    if (Array.isArray(leash)) return { x: leash[0] + 0.5, y: leash[1] + 0.6, z: leash[2] + 0.5 };
    if (leash === this.myId) return this.localHand;
    const p = this.players.get(leash);
    return p && p.group.visible ? { x: p.group.position.x, y: p.group.position.y + 1.1, z: p.group.position.z } : null;
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
    for (const [id, e] of this.mobs) this._removeMob(id, e);
    for (const id of [...this.items.keys()]) this.removeItem(id);
  }

  // ---- Per-frame update ------------------------------------------------------------
  update(dt, getBlock) {
    const renderTime = performance.now() - INTERP_DELAY_MS;
    for (const e of this.players.values()) {
      this._interpolate(e, renderTime, dt, true);
      // flash red for a moment after being hit
      const red = e.hurtUntil && performance.now() < e.hurtUntil ? 0.6 : 0;
      if (e.materials) for (const m of e.materials) if (m.emissive) m.emissive.setRGB(red, 0, 0);
    }
    for (const [id, e] of this.mobs) {
      // the horse we're riding is drawn exactly where our own simulation has it
      const lm = this.localMount;
      if (lm && lm.id === id) e.buffer = [{ t: 0, x: lm.pos.x, y: lm.pos.y, z: lm.pos.z, yaw: lm.yaw, pitch: 0, flags: 0 }];
      this._interpolate(e, renderTime, dt, false);
      this._animateMob(e, dt);
      // Hurt flash: tint red. A Rumbler about to blow flashes white.
      const flash = e.fusing && Math.sin(performance.now() / 70) > 0 ? 0.7 : 0;
      for (const m of e.materials) if (m.emissive) m.emissive.setRGB(e.hurt ? 0.6 : flash, flash, flash);
      if (e.spark) e.spark.visible = !e.fusing || Math.random() < 0.7;
      if (e.love && Math.random() < dt * 3) { const p = e.group.position; this.fx.hearts(p.x, p.y + this._mobSize(e)[1], p.z, 1); }
      e.soundTimer -= dt;
      if (e.soundTimer < 0) {
        e.soundTimer = 6 + Math.random() * 10;
        const p = e.group.position, d = this._distTo(p.x, p.y, p.z);
        const sound = this.sfx[MOB_SOUND[e.kind]];
        if (sound) sound.call(this.sfx, d);
      }
    }
    this.fx.update(dt, this.sfx, this.listener);
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
    // Players riding something sit with their legs forward.
    if (isPlayer && e.legL) e.riding = (c.flags & 8) !== 0;
    // Crouching players lean forward and sink a little.
    if (isPlayer && e.body) {
      const crouch = (c.flags & 4) !== 0;
      e.body.rotation.x = crouch ? 0.45 : 0;
      e.body.position.z = crouch ? 0.12 : 0;
      // keep the neck on top of the leaning body
      e.head.position.y = crouch ? 1.46 : 1.5;
      e.head.position.z = crouch ? 0.28 : 0;
      e.group.position.y -= crouch ? 0.12 : 0;
    }
    // Walking animation: swing limbs with a sine wave scaled by speed.
    const moving = speed > 0.3 && speed < 30;
    e.walk += dt * (moving ? Math.min(speed, 6) * 2.2 : 0);
    const swing = moving ? Math.sin(e.walk) * 0.7 : 0;
    if (e.legL) {
      e.legL.rotation.x = swing; e.legR.rotation.x = -swing;
      // Holding something: that arm swings less and stays a little forward.
      if (isPlayer && e.riding) { e.legL.rotation.x = e.legR.rotation.x = -1.4; e.legL.rotation.z = 0.2; e.legR.rotation.z = -0.2; }
      else if (isPlayer) { e.legL.rotation.z = e.legR.rotation.z = 0; }
      if (isPlayer) { e.armL.rotation.x = -swing; e.armR.rotation.x = e.heldId ? -0.35 + swing * 0.4 : swing; }
      else if (!e.zombie && !e.foldedArms && !e.raisedArm) { e.armL.rotation.x = -swing * 0.5; e.armR.rotation.x = swing * 0.5; }
      else if (e.raisedArm) { e.armL.rotation.x = -swing * 0.5; }
    }
    if (e.legs && !e.sitting) {
      // Diagonal pairs move together (2-legged chickens just alternate).
      const pattern = e.legs.length === 2 ? [1, -1] : e.legs.length === 8 ? [1, -1, -1, 1, 1, -1, -1, 1] : [1, -1, -1, 1];
      e.legs.forEach((leg, i) => { leg.rotation.x = swing * pattern[i]; });
    }
  }

  /** Per-kind animation: babies, sitting, saddles, wings, tentacles, leads, name tags... */
  _animateMob(e, dt) {
    e.t += dt;
    const [w, h] = this._mobSize(e);
    const inner = e.inner;
    inner.scale.setScalar(e.baseScale * (e.baby ? 0.5 : 1) * (e.size || 1));
    // sitting dogs and cats: lean back with the hind legs folded
    inner.rotation.x = e.sitting ? -0.45 : 0;
    inner.position.y = e.sitting ? -0.12 : 0;
    if (e.sitting && e.legs) { e.legs[2].rotation.x = e.legs[3].rotation.x = -1.2; e.legs[0].rotation.x = e.legs[1].rotation.x = 0.4; }
    if (e.saddle) e.saddle.visible = e.saddled;
    if (e.collar) e.collar.visible = e.tamed;
    if (e.tail && e.kind === 'wolf') e.tail.rotation.x = e.tamed ? 0.5 : e.angry ? 1.4 : 0.9;
    if (e.wool) for (const m of e.wool) m.visible = !e.sheared;
    if (e.tag) e.tag.position.y = h + 0.45;
    // angry wolves' eyes glow red
    if (e.kind === 'wolf' && e.materials[2]) e.materials[2].color.setRGB(e.angry ? 1 : 1, e.angry ? 0.45 : 1, e.angry ? 0.45 : 1);
    if (e.float) e.float.position.y = e.float.userData.baseY + Math.sin(e.t * 2) * 0.08;  // bobbing in the air or water
    if (e.wings) { const flap = Math.sin(e.t * (e.kind === 'parrot' ? 18 : 22)) * 0.9; e.wings.forEach((wg, i) => { wg.rotation.y = (i ? -1 : 1) * flap; wg.rotation.z = (i ? -1 : 1) * flap * 0.3; }); }
    if (e.tentacles) e.tentacles.forEach((t, i) => { t.rotation.x = Math.sin(e.t * 3 + i) * 0.35; t.rotation.z = Math.cos(e.t * 3 + i) * 0.35; });
    if (e.tail && (e.kind === 'guardian' || e.kind === 'elder_guardian')) e.tail.rotation.y = Math.sin(e.t * 4) * 0.4;
    if (e.squish) { const s = 1 + Math.max(0, Math.sin(e.t * 6)) * 0.12; e.squish.scale.y = e.baseScale * (e.size || 1) / s; }
    if (e.wisps) e.wisps.forEach((wp, i) => { const a = e.t * 1.5 + i * 2.1; wp.position.set(Math.cos(a) * 0.6, 1.2 + Math.sin(e.t * 2 + i) * 0.6, Math.sin(a) * 0.6); });
    if (e.segments) e.segments.forEach((sg, i) => { sg.position.x = Math.sin(e.t * 10 + i) * 0.03; });
    // a lead: a sagging rope from the mob's neck to whoever (or whatever) holds it
    const holder = e.leash && this._leashHolder(e.leash);
    if (holder) {
      if (!e.rope) {
        e.rope = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(13 * 3), 3)), this.ropeMat);
        e.rope.frustumCulled = false;
        this.scene.add(e.rope);
      }
      const p = e.group.position, a = { x: p.x, y: p.y + h * 0.75, z: p.z };
      const arr = e.rope.geometry.attributes.position.array;
      const span = Math.hypot(holder.x - a.x, holder.z - a.z);
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        arr[i * 3] = a.x + (holder.x - a.x) * t;
        arr[i * 3 + 1] = a.y + (holder.y - a.y) * t - Math.sin(t * Math.PI) * Math.max(0, 0.6 - span * 0.05);
        arr[i * 3 + 2] = a.z + (holder.z - a.z) * t;
      }
      e.rope.geometry.attributes.position.needsUpdate = true;
      e.rope.visible = true;
    } else if (e.rope) e.rope.visible = false;
  }

  /** Where a mob is, for beams and effects. */
  mobCentre(id) {
    const e = this.mobs.get(id);
    if (!e) return null;
    const p = e.group.position, h = this._mobSize(e)[1];
    return { x: p.x, y: p.y + h * 0.5, z: p.z };
  }
  playerCentre(id) {
    if (id === this.myId) return { x: this.listener.x, y: this.listener.y + 1.2, z: this.listener.z };
    const e = this.players.get(id);
    return e ? { x: e.group.position.x, y: e.group.position.y + 1.2, z: e.group.position.z } : null;
  }

  /** Ray test against mobs; returns {id, dist} of the nearest hit or null. */
  raycastMobs(origin, dir, maxDist) {
    let best = null;
    for (const [id, e] of this.mobs) {
      const [w, h] = this._mobSize(e);
      const p = e.group.position;
      const d = rayBox(origin, dir, [p.x - w / 2, p.y, p.z - w / 2], [p.x + w / 2, p.y + h, p.z + w / 2]);
      if (d >= 0 && d <= maxDist && (!best || d < best.dist)) best = { id, dist: d, kind: e.kind };
    }
    return best;
  }

  /** Closest other player hit by a ray, or null (for PvP). */
  raycastPlayers(origin, dir, maxDist) {
    let best = null;
    for (const [id, e] of this.players) {
      if (!e.group.visible) continue;
      const p = e.group.position;
      // a slightly generous box, so fast-moving players are still easy to hit
      const d = rayBox(origin, dir, [p.x - 0.45, p.y - 0.1, p.z - 0.45], [p.x + 0.45, p.y + 2.0, p.z + 0.45]);
      if (d >= 0 && d <= maxDist && (!best || d < best.dist)) best = { id, dist: d, player: true };
    }
    return best;
  }

  /** Positions of other players (to avoid placing blocks inside them). */
  playerBoxes() {
    return [...this.players.values()].filter(e => e.group.visible).map(e => e.group.position);
  }
}
