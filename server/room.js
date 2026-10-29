// ============================================================================
// A Room is one running world plus the players connected to it.
//
// The server is *authoritative*: clients ask to break/place blocks, and the
// room checks each request (reach, rate limit, valid block, not inside a
// player) before applying it and broadcasting the change to everyone.
// The room also owns everything shared: time of day, dropped items, mobs,
// furnace contents, and who the host is.
// ============================================================================
import {
  REACH, SERVER_REACH_SLACK, PHYSICS, DAY_TICKS, DAY_LENGTH_SECONDS, SERVER_TICK_RATE,
  EDIT_RATE_PER_SEC, EDIT_BURST, CHAT_RATE_PER_SEC, CHAT_BURST, SPEED_TOLERANCE,
  MAX_HEALTH, MAX_HUNGER, MAX_PLAYERS_PER_ROOM, CHUNK_HEIGHT,
} from '../shared/config.js';
import { BLOCKS, B, isBlockId, IS_SOLID, needsSupport, supportPos, isSupported } from '../shared/blocks.js';
import { isPlaceableState, canReplace } from '../shared/placement.js';
import { Interactions } from './interact.js';
import { Projectiles } from './projectiles.js';
import { ITEMS, canHarvest, attackDamage, itemId, maxStack } from '../shared/items.js';
import { SMELTING, SMELT_TIME } from '../shared/recipes.js';
import { GAME_MODES, sanitizeName } from '../shared/protocol.js';
import { moveEntity, boxIntersectsBlock } from '../shared/physics.js';
import { ServerWorld } from './serverWorld.js';
import { MobManager } from './mobs.js';
import { saveWorld, saveWorldSync } from './persistence.js';

let nextPlayerId = 1;
let nextItemId = 1;

/** Token bucket rate limiter: refills `rate` tokens/sec up to `burst`. */
class Bucket {
  constructor(rate, burst) { this.rate = rate; this.burst = burst; this.tokens = burst; this.t = Date.now(); }
  take(n = 1) {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.t) / 1000) * this.rate);
    this.t = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const int = (v) => Number.isInteger(v);
const r2 = (v) => Math.round(v * 100) / 100;


export class Room {
  constructor(code, saved, opts = {}) {
    this.code = code;
    saved = saved || {};
    this.seed = saved.seed ?? opts.seed ?? String(Math.floor(Math.random() * 1e9));
    this.mode = saved.mode ?? opts.mode ?? 'survival';
    this.time = saved.time ?? 1000;        // start in the morning
    this.hostToken = saved.hostToken ?? opts.hostToken ?? null;
    this.created = saved.created ?? Date.now();
    this.world = new ServerWorld(this.seed, saved.edits);
    this.savedPlayers = saved.players ?? {};   // name(lowercase) -> {pos, inv, health, hunger}
    this.furnaces = new Map(Object.entries(saved.furnaces ?? {}));
    this.players = new Map();                  // id -> player
    this.items = new Map();                    // dropped item entities
    this.mobs = new MobManager(this);
    this.act = new Interactions(this, saved);   // doors, chests, beds, farming, TNT
    this.projectiles = new Projectiles(this);   // arrows, snowballs, eggs, ender pearls
    this.hostId = null;
    this.dirty = false;
    this.emptySince = Date.now();
    this.timeBroadcastTimer = 0;
  }

  // ---- Helpers -------------------------------------------------------------
  send(p, msg) {
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  }
  broadcast(msg, except = null) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(data);
  }
  sys(text) { this.broadcast({ t: 'chat', sys: true, text }); }
  timeFrac() { return this.time / DAY_TICKS; }
  isNight() { const f = this.timeFrac(); return f > 0.54 && f < 0.96; }

  playerList() {
    return [...this.players.values()].map(p => ({ id: p.id, name: p.name, host: p.id === this.hostId }));
  }

  // ---- Joining & leaving ----------------------------------------------------
  addPlayer(ws, rawName, token) {
    if (this.players.size >= MAX_PLAYERS_PER_ROOM) return { error: 'This world is full.' };
    // A reconnect from the same browser tab replaces the old (dead) connection.
    for (const other of this.players.values()) {
      if (token && other.token === token) {
        other.replaced = true;
        try { other.ws.close(4000, 'replaced'); } catch { /* ignore */ }
        this.removePlayer(other, true);
      }
    }
    let name = sanitizeName(rawName);
    const taken = (n) => [...this.players.values()].some(p => p.name.toLowerCase() === n.toLowerCase());
    if (taken(name)) { let i = 2; while (taken(name + i)) i++; name = name + i; }

    const saved = this.savedPlayers[name.toLowerCase()];
    const spawn = this.world.spawn;
    const p = {
      id: nextPlayerId++, name, token, ws,
      pos: saved?.pos ? { ...saved.pos } : { ...spawn },
      yaw: 0, pitch: 0, flags: 0,
      inv: saved?.inv ?? null,
      health: saved?.health ?? MAX_HEALTH,
      hunger: saved?.hunger ?? MAX_HUNGER,
      alive: true,
      editBucket: new Bucket(EDIT_RATE_PER_SEC, EDIT_BURST),
      chatBucket: new Bucket(CHAT_RATE_PER_SEC, CHAT_BURST),
      moveCredit: 4, lastMoveTime: Date.now(), violations: 0,
      attackCooldown: 0, furnace: null, container: null, joinedAt: Date.now(),
      spawnPoint: saved?.spawnPoint ?? null,
    };
    if (p.health <= 0) { p.health = MAX_HEALTH; p.hunger = MAX_HUNGER; p.pos = { ...spawn }; }
    // Make sure the chunk is generated so we don't spawn inside a block that was placed.
    this._unstick(p.pos);
    this.players.set(p.id, p);

    // Host: the creator (by token) always reclaims host; otherwise the first player.
    if (!this.hostToken) this.hostToken = token;
    if (this.hostId === null || (token && token === this.hostToken)) this.hostId = p.id;

    this.send(p, {
      t: 'welcome', id: p.id, room: this.code, seed: this.seed, host: this.hostId,
      mode: this.mode, time: this.time, spawn,
      you: { name: p.name, pos: p.pos, inv: p.inv, health: p.health, hunger: p.hunger },
      players: this.playerList(),
      items: [...this.items.values()].map(itemMsg),
    });
    this.broadcast({ t: 'players', list: this.playerList(), host: this.hostId }, p);
    this.sys(`${p.name} joined the world`);
    this.emptySince = null;
    return { player: p };
  }

  removePlayer(p, silent = false) {
    if (!this.players.has(p.id)) return;
    this.players.delete(p.id);
    this._remember(p);
    if (this.hostId === p.id) {
      // Pass host to whoever has been here longest.
      const next = [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      this.hostId = next ? next.id : null;
      if (next) this.sys(`${next.name} is now the host`);
    }
    this.broadcast({ t: 'players', list: this.playerList(), host: this.hostId });
    if (!silent) this.sys(`${p.name} left the world`);
    if (!this.players.size) this.emptySince = Date.now();
    this.dirty = true;
  }

  _remember(p) {
    this.savedPlayers[p.name.toLowerCase()] = {
      pos: { x: r2(p.pos.x), y: r2(p.pos.y), z: r2(p.pos.z) },
      inv: p.inv, health: p.health, hunger: p.hunger, spawnPoint: p.spawnPoint,
    };
  }

  /** Nudge a position upward until the player's body is free of solid blocks. */
  _unstick(pos) {
    for (let i = 0; i < CHUNK_HEIGHT; i++) {
      const x = Math.floor(pos.x), z = Math.floor(pos.z), y = Math.floor(pos.y);
      if (!IS_SOLID[this.world.getBlock(x, y, z)] && !IS_SOLID[this.world.getBlock(x, y + 1, z)]) return;
      pos.y = y + 1;
    }
  }

  // ---- Message handling --------------------------------------------------------
  handle(p, msg) {
    switch (msg.t) {
      case 'pos': return this.onPos(p, msg);
      case 'reqChunks': return this.onReqChunks(p, msg);
      case 'break': return this.onBreak(p, msg);
      case 'place': return this.onPlace(p, msg);
      case 'attack': return this.onAttack(p, msg);
      case 'drop': return this.onDrop(p, msg);
      case 'chat': return this.onChat(p, msg);
      case 'inv': return this.onInv(p, msg);
      case 'respawn': return this.onRespawn(p);
      case 'died': return this.onDied(p, msg);
      case 'furnaceOpen': return this.onFurnaceOpen(p, msg);
      case 'furnaceClose': p.furnace = null; return;
      case 'furnacePut': return this.onFurnacePut(p, msg);
      case 'furnaceTake': return this.onFurnaceTake(p, msg);
      case 'host': return this.onHost(p, msg);
      case 'use':
        if (this._editCheck(p, msg.x, msg.y, msg.z)) return this._reject(p, msg.x, msg.y, msg.z);
        return this.act.use(p, msg);
      case 'containerSet': return this.act.setContainer(p, msg);
      case 'containerClose': p.container = null; return;
      case 'useMob': return this.mobs.use(p, msg);
      case 'throw': return this.projectiles.launch(p, msg);
      case 'ping': return this.send(p, { t: 'pong', c: msg.c });
      default: return;
    }
  }

  /**
   * Movement sanity check. Each player earns "movement credit" over time at
   * their maximum legal speed; each position update spends it. Using a
   * budget (rather than checking each packet alone) tolerates network jitter
   * where several updates arrive bunched together.
   */
  onPos(p, msg) {
    if (!Array.isArray(msg.p) || msg.p.length !== 3 || !msg.p.every(num)) return;
    if (Array.isArray(msg.r) && msg.r.every(num)) { p.yaw = msg.r[0]; p.pitch = msg.r[1]; }
    p.flags = (msg.f ? 1 : 0) | (msg.m ? 2 : 0) | (msg.s ? 4 : 0);
    p.held = int(msg.h) && ITEMS[msg.h] ? msg.h : 0; // shown in other players' hands
    if (!p.alive) return;
    const now = Date.now();
    const elapsed = Math.min(2, (now - p.lastMoveTime) / 1000);
    p.lastMoveTime = now;
    const creative = this.mode === 'creative';
    const maxSpeed = (creative ? PHYSICS.flySprintSpeed : PHYSICS.sprintSpeed * 1.4) * SPEED_TOLERANCE;
    p.moveCredit = Math.min(maxSpeed * 1.5, p.moveCredit + maxSpeed * elapsed);
    const [x, y, z] = msg.p;
    const dx = x - p.pos.x, dz = z - p.pos.z;
    let dy = y - p.pos.y;
    if (dy < 0) dy = 0;                     // falling is always allowed
    else if (!creative) dy *= 0.5;          // jumping/swimming up counts half
    const dist = Math.hypot(dx, dz, dy);
    if (dist > p.moveCredit + 1.0 || y < -64 || y > 400) {
      p.violations++;
      p.moveCredit = Math.max(0, p.moveCredit);
      this.send(p, { t: 'teleport', p: [p.pos.x, p.pos.y, p.pos.z] });
      if (p.violations > 50) this.kick(p, 'Moving too fast');
      return;
    }
    p.moveCredit -= dist;
    p.violations = Math.max(0, p.violations - 0.05);
    p.pos.x = x; p.pos.y = y; p.pos.z = z;
  }

  onReqChunks(p, msg) {
    if (!Array.isArray(msg.list)) return;
    const out = [];
    for (const c of msg.list.slice(0, 1024)) {
      if (!Array.isArray(c) || !int(c[0]) || !int(c[1])) continue;
      out.push([c[0], c[1], this.world.editsFor(c[0], c[1])]);
    }
    this.send(p, { t: 'chunks', list: out });
  }

  /** Common checks for block edits. Returns an error string or null. */
  _editCheck(p, x, y, z) {
    if (![x, y, z].every(int)) return 'bad';
    if (y < 0 || y >= CHUNK_HEIGHT) return 'bad';
    if (!p.alive) return 'dead';
    if (!p.editBucket.take()) return 'rate';
    const ex = p.pos.x, ey = p.pos.y + PHYSICS.eyeHeight, ez = p.pos.z;
    const d = Math.hypot(x + 0.5 - ex, y + 0.5 - ey, z + 0.5 - ez);
    if (d > REACH + SERVER_REACH_SLACK + 0.9) return 'reach';
    return null;
  }

  _reject(p, x, y, z) {
    if ([x, y, z].every(int) && y >= 0 && y < CHUNK_HEIGHT) {
      this.send(p, { t: 'block', x, y, z, id: this.world.getBlock(x, y, z) });
    }
  }

  setBlock(x, y, z, id) {
    this.world.setBlock(x, y, z, id);
    this.broadcast({ t: 'block', x, y, z, id });
    this.dirty = true;
  }

  onBreak(p, msg) {
    const { x, y, z } = msg;
    if (this._editCheck(p, x, y, z)) return this._reject(p, x, y, z);
    const id = this.world.getBlock(x, y, z);
    const def = BLOCKS[id];
    if (!def || id === 0 || def.hardness < 0) return this._reject(p, x, y, z);
    this.setBlock(x, y, z, 0);
    const survival = this.mode === 'survival';
    const held = int(msg.held) ? msg.held : 0;
    // Doors and beds are two blocks: the partner goes too, and the item drops once.
    const partner = this.act.partnerOf(id, x, y, z);
    const dropDef = partner && !def.drops ? BLOCKS[partner[3]] : def;
    if (survival && canHarvest(id, held)) this._dropsFor(dropDef, x + 0.5, y + 0.3, z + 0.5, held);
    this.act.broken(x, y, z, id, survival);
    // A furnace drops what was inside it.
    const fkey = `${x},${y},${z}`;
    const f = this.furnaces.get(fkey);
    if (f) {
      if (survival) for (const s of f.slots) if (s) this.spawnItem(s, x + 0.5, y + 0.5, z + 0.5);
      this.furnaces.delete(fkey);
    }
    // Plants and torches held up by this block pop off: the block above, and
    // wall torches on any of the four sides that hang on this block.
    for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      const nid = this.world.getBlock(nx, ny, nz);
      if (!needsSupport(nid) || nid === B.LILY_PAD) continue;
      const [sx, sy, sz] = supportPos(nid, nx, ny, nz);
      if (sx !== x || sy !== y || sz !== z) continue;
      const np = this.act.partnerOf(nid, nx, ny, nz);
      this.act.broken(nx, ny, nz, nid, survival);
      this.setBlock(nx, ny, nz, 0);
      if (survival) this._dropsFor(np && !BLOCKS[nid].drops ? BLOCKS[np[3]] : BLOCKS[nid], nx + 0.5, ny + 0.3, nz + 0.5);
    }
  }

  /** Spawn what a broken block drops: its `drops` (name or [name, min, max]) plus random `bonus` items. */
  _dropsFor(def, x, y, z, held = 0) {
    // Shears snip leaves, vines, grass and cobwebs off whole.
    if (ITEMS[held]?.name === 'shears' && /leaves|vine|tall_grass|fern|cobweb|dead_bush/.test(def.name)) {
      return this.spawnItem({ id: def.base ? itemId(def.base) : def.id, count: 1 }, x, y, z);
    }
    if (def.drops) {
      const [name, min, max] = Array.isArray(def.drops) ? def.drops : [def.drops, 1, 1];
      const count = min + Math.floor(Math.random() * (max - min + 1));
      if (count > 0) this.spawnItem({ id: itemId(name), count }, x, y, z);
    }
    for (const [name, chance] of def.bonus) {
      if (Math.random() < chance) this.spawnItem({ id: itemId(name), count: 1 }, x, y, z);
    }
  }

  /**
   * Place one block, or several that belong together (a door's two halves,
   * a bed's foot and head): msg.blocks = [[x, y, z, id], ...].
   */
  onPlace(p, msg) {
    const list = Array.isArray(msg.blocks) ? msg.blocks.slice(0, 2) : [[msg.x, msg.y, msg.z, msg.id]];
    if (!list.every(b => Array.isArray(b) && b.length === 4 && b.every(int))) return;
    const reject = () => { for (const [x, y, z] of list) this._reject(p, x, y, z); };
    for (const [x, y, z, id] of list) {
      if (this._editCheck(p, x, y, z)) return reject();
      if (!isBlockId(id) || !isPlaceableState(id) || (id === B.BEDROCK && this.mode !== 'creative')) return reject();
      const cur = this.world.getBlock(x, y, z);
      const def = BLOCKS[id];
      // Slabs may land on their other half to make a double slab.
      const stacking = BLOCKS[cur]?.shape === 'slab' && def.name === BLOCKS[cur].double;
      if (!canReplace(cur) && !stacking) return reject();
      // Never place a solid block inside a player or mob.
      if (def.solid && !stacking) {
        for (const o of this.players.values()) {
          if (o.alive && boxIntersectsBlock(o.pos, PHYSICS.playerWidth, PHYSICS.playerHeight, x, y, z)) return reject();
        }
        for (const m of this.mobs.mobs.values()) {
          if (boxIntersectsBlock(m.pos, m.def.width, m.def.height, x, y, z)) return reject();
        }
      }
    }
    // A two-block set must really be a matching pair.
    if (list.length === 2) {
      const [a, b] = list;
      const da = BLOCKS[a[3]], db = BLOCKS[b[3]];
      if (!da.base || da.base !== db.base || !(da.door || da.bed)) return reject();
      if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) !== 1) return reject();
    }
    const get = (gx, gy, gz) => this.world.getBlock(gx, gy, gz);
    const placed = [];
    for (const [x, y, z, id] of list) {
      if (needsSupport(id) && !isSupported(id, x, y, z, get)) {
        for (const [px, py, pz, old] of placed) this.setBlock(px, py, pz, old); // undo the first half
        return reject();
      }
      placed.push([x, y, z, this.world.getBlock(x, y, z)]);
      this.setBlock(x, y, z, id);
      this.act.placed(x, y, z, id);
    }
  }

  onAttack(p, msg) {
    const m = this.mobs.mobs.get(msg.mob);
    if (!m || !p.alive) return;
    const now = Date.now();
    if (now < p.attackCooldown) return;
    p.attackCooldown = now + 250;
    const d = Math.hypot(m.pos.x - p.pos.x, m.pos.y + m.def.height / 2 - (p.pos.y + PHYSICS.eyeHeight), m.pos.z - p.pos.z);
    if (d > REACH + SERVER_REACH_SLACK + 1) return;
    const held = int(msg.held) ? msg.held : 0;
    this.mobs.damage(m, attackDamage(held), p.pos);
  }

  // ---- Items ------------------------------------------------------------------
  /** Validate an item stack sent by a client. */
  _stack(s) {
    if (!s || !int(s.id) || !ITEMS[s.id] || !int(s.count) || s.count < 1) return null;
    return { id: s.id, count: Math.min(s.count, maxStack(s.id)), dmg: int(s.dmg) ? s.dmg : 0 };
  }

  spawnItem(stack, x, y, z, vel = null, owner = null) {
    const it = {
      id: nextItemId++, stack, pos: { x, y, z },
      vel: vel || { x: (Math.random() - 0.5) * 3, y: 4, z: (Math.random() - 0.5) * 3 },
      age: 0, owner, settled: false,
    };
    this.items.set(it.id, it);
    this.broadcast({ t: 'items', add: [itemMsg(it)] });
    return it;
  }

  onDrop(p, msg) {
    const s = this._stack(msg.item);
    if (!s || !p.alive) return;
    const d = Array.isArray(msg.dir) && msg.dir.every(num) ? msg.dir : [0, 0, 0];
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    const speed = msg.gentle ? 0 : 6;
    this.spawnItem(s, p.pos.x, p.pos.y + 1.3, p.pos.z,
      { x: (d[0] / len) * speed, y: (d[1] / len) * speed + 2, z: (d[2] / len) * speed }, p.id);
  }

  _tickItems(dt) {
    const get = (x, y, z) => this.world.getBlock(x, y, z);
    const removed = [];
    for (const it of this.items.values()) {
      it.age += dt;
      if (it.age > 300) { this.items.delete(it.id); removed.push(it.id); continue; }
      if (!it.settled) {
        it.vel.y -= PHYSICS.gravity * dt;
        const res = moveEntity(it.pos, it.vel, dt, 0.25, 0.25, get);
        if (res.onGround) { it.vel.x *= 0.5; it.vel.z *= 0.5; }
        if (res.onGround && Math.abs(it.vel.x) + Math.abs(it.vel.z) < 0.05) it.settled = true;
        if (it.pos.y < -10) { this.items.delete(it.id); removed.push(it.id); continue; }
      } else if (!IS_SOLID[get(Math.floor(it.pos.x), Math.floor(it.pos.y - 0.05), Math.floor(it.pos.z))]) {
        it.settled = false; // block under it was removed
      }
      // Pick-up: close to a living player (the thrower must wait a moment).
      if (it.age < 0.6) continue;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (p.id === it.owner && it.age < 1.5) continue;
        const dx = p.pos.x - it.pos.x, dy = p.pos.y + 0.8 - it.pos.y, dz = p.pos.z - it.pos.z;
        if (dx * dx + dy * dy + dz * dz < 2.6) {
          this.send(p, { t: 'pickup', item: it.stack });
          this.items.delete(it.id);
          removed.push(it.id);
          break;
        }
      }
    }
    if (removed.length) this.broadcast({ t: 'items', remove: removed });
  }

  // ---- Survival ------------------------------------------------------------------
  hurtPlayer(p, amount, from, cause = 'was slain by a zombie') {
    if (this.mode !== 'survival' || !p.alive || amount <= 0) return;
    this.send(p, { t: 'hurt', amount, from: [from.x, from.y, from.z], cause });
  }

  onDied(p, msg) {
    if (!p.alive) return;
    p.alive = false;
    p.health = 0;
    // Drop the inventory the client reported where the player died.
    if (Array.isArray(msg.items)) {
      for (const raw of msg.items.slice(0, 50)) {
        const s = this._stack(raw);
        if (s) this.spawnItem(s, p.pos.x, p.pos.y + 1, p.pos.z);
      }
    }
    this.sys(`${p.name} ${typeof msg.cause === 'string' ? msg.cause.slice(0, 40) : 'died'}`);
  }

  onRespawn(p) {
    p.alive = true;
    p.health = MAX_HEALTH; p.hunger = MAX_HUNGER;
    // Respawn at your bed if it's still there.
    const sp = p.spawnPoint;
    const bedOk = sp && BLOCKS[this.world.getBlock(Math.floor(sp.x), Math.floor(sp.y), Math.floor(sp.z))]?.bed;
    if (sp && !bedOk) { p.spawnPoint = null; this.send(p, { t: 'chat', sys: true, text: 'Your bed was missing, so you woke up at the world spawn.' }); }
    p.pos = bedOk ? { x: sp.x, y: sp.y + 0.5, z: sp.z } : { ...this.world.spawn };
    this._unstick(p.pos);
    p.moveCredit = 4;
    this.send(p, { t: 'teleport', p: [p.pos.x, p.pos.y, p.pos.z], respawn: true });
  }

  onInv(p, msg) {
    // The inventory itself is client-side; we keep a copy so it's saved with the world.
    if (Array.isArray(msg.slots) && msg.slots.length <= 64) {
      p.inv = msg.slots.map(s => this._stack(s));
    }
    if (num(msg.health)) p.health = Math.max(0, Math.min(MAX_HEALTH, msg.health));
    if (num(msg.hunger)) p.hunger = Math.max(0, Math.min(MAX_HUNGER, msg.hunger));
    this.dirty = true;
  }

  // ---- Chat & host controls --------------------------------------------------
  onChat(p, msg) {
    if (typeof msg.text !== 'string') return;
    const text = msg.text.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200);
    if (!text) return;
    if (!p.chatBucket.take()) return this.send(p, { t: 'chat', sys: true, text: 'You are sending messages too fast.' });
    this.broadcast({ t: 'chat', from: p.name, text });
  }

  onHost(p, msg) {
    if (p.id !== this.hostId) return this.send(p, { t: 'chat', sys: true, text: 'Only the host can do that.' });
    if (msg.action === 'mode' && GAME_MODES.includes(msg.value)) {
      this.mode = msg.value;
      this.broadcast({ t: 'mode', mode: this.mode });
      this.sys(`Game mode is now ${this.mode}`);
      if (this.mode === 'creative') for (const m of [...this.mobs.mobs.values()]) if (m.type === 'zombie') this.mobs.mobs.delete(m.id);
      this.dirty = true;
    } else if (msg.action === 'time' && num(msg.value)) {
      this.time = ((Math.floor(msg.value) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
      this.broadcast({ t: 'time', time: this.time });
      this.dirty = true;
    } else if (msg.action === 'tp' && Array.isArray(msg.value) && msg.value.length === 3 && msg.value.every(num)) {
      const [x, y, z] = msg.value;
      if (Math.abs(x) > 3e7 || Math.abs(z) > 3e7 || y < 0 || y > 400) return;
      p.pos = { x, y, z };
      this._unstick(p.pos);
      p.moveCredit = 4;
      this.send(p, { t: 'teleport', p: [p.pos.x, p.pos.y, p.pos.z] });
    } else if (msg.action === 'kick') {
      const target = this.players.get(msg.value);
      if (target && target !== p) this.kick(target, `Kicked by ${p.name}`);
    }
  }

  kick(p, reason) {
    this.send(p, { t: 'kicked', reason });
    p.kicked = true;
    setTimeout(() => { try { p.ws.close(4001, 'kicked'); } catch { /* ignore */ } }, 100);
    this.removePlayer(p, true);
    this.sys(`${p.name} was removed (${reason})`);
  }

  // ---- Furnaces --------------------------------------------------------------------
  _furnaceAt(msg) {
    const { x, y, z } = msg;
    if (![x, y, z].every(int)) return null;
    const id = this.world.getBlock(x, y, z);
    if (id !== B.FURNACE && id !== B.LIT_FURNACE) return null;
    const key = `${x},${y},${z}`;
    let f = this.furnaces.get(key);
    if (!f) { f = { slots: [null, null, null], burn: 0, burnMax: 0, progress: 0 }; this.furnaces.set(key, f); }
    return { key, f, x, y, z };
  }

  _sendFurnace(key) {
    const f = this.furnaces.get(key);
    if (!f) return;
    const [x, y, z] = key.split(',').map(Number);
    for (const p of this.players.values()) {
      if (p.furnace === key) this.send(p, { t: 'furnace', x, y, z, slots: f.slots, burn: f.burn, burnMax: f.burnMax, progress: f.progress / SMELT_TIME });
    }
  }

  onFurnaceOpen(p, msg) {
    const r = this._furnaceAt(msg);
    if (!r) return;
    p.furnace = r.key;
    this._sendFurnace(r.key);
  }

  onFurnacePut(p, msg) {
    const r = this._furnaceAt(msg);
    const s = this._stack(msg.item);
    if (!r || !s || (msg.slot !== 0 && msg.slot !== 1)) { if (s) this.send(p, { t: 'pickup', item: s }); return; }
    if (msg.slot === 1 && !ITEMS[s.id].fuel) return this.send(p, { t: 'pickup', item: s });
    const cur = r.f.slots[msg.slot];
    if (cur && cur.id === s.id) {
      const room = maxStack(s.id) - cur.count;
      const add = Math.min(room, s.count);
      cur.count += add;
      if (s.count - add > 0) this.send(p, { t: 'pickup', item: { ...s, count: s.count - add } });
    } else {
      if (cur) this.send(p, { t: 'pickup', item: cur });
      r.f.slots[msg.slot] = s;
    }
    this.dirty = true;
    this._sendFurnace(r.key);
  }

  onFurnaceTake(p, msg) {
    const r = this._furnaceAt(msg);
    if (!r || ![0, 1, 2].includes(msg.slot)) return;
    const s = r.f.slots[msg.slot];
    if (!s) return;
    r.f.slots[msg.slot] = null;
    this.send(p, { t: 'pickup', item: s });
    this.dirty = true;
    this._sendFurnace(r.key);
  }

  _tickFurnaces(dt) {
    for (const [key, f] of this.furnaces) {
      const [input, fuel, output] = f.slots;
      const result = input ? SMELTING[input.id] : undefined;
      const canSmelt = result !== undefined && (!output || (output.id === result && output.count < maxStack(result)));
      let changed = false;
      const wasBurning = f.burn > 0;
      if (f.burn > 0) f.burn -= dt;
      if (f.burn <= 0 && canSmelt && fuel) {
        f.burn = f.burnMax = ITEMS[fuel.id].fuel;
        fuel.count--;
        if (fuel.count <= 0) f.slots[1] = null;
        changed = true;
      }
      if (f.burn > 0 && canSmelt) {
        f.progress += dt;
        if (f.progress >= SMELT_TIME) {
          f.progress = 0;
          input.count--;
          if (input.count <= 0) f.slots[0] = null;
          if (output) output.count++; else f.slots[2] = { id: result, count: 1, dmg: 0 };
          changed = true;
          this.dirty = true;
        }
      } else if (f.progress > 0) { f.progress = Math.max(0, f.progress - dt * 2); }
      if (f.burn < 0) f.burn = 0;
      const burning = f.burn > 0;
      if (burning !== wasBurning) {
        // Swap between the lit and unlit furnace block (the lit one glows).
        const [x, y, z] = key.split(',').map(Number);
        const id = this.world.getBlock(x, y, z);
        if (id === B.FURNACE || id === B.LIT_FURNACE) this.setBlock(x, y, z, burning ? B.LIT_FURNACE : B.FURNACE);
        changed = true;
      }
      // Send updates to anyone looking at this furnace (4x per second is plenty).
      f.sendTimer = (f.sendTimer || 0) + dt;
      if (changed || (burning && f.sendTimer > 0.25)) { f.sendTimer = 0; this._sendFurnace(key); }
      if (!burning && !f.slots.some(Boolean)) this.furnaces.delete(key);
    }
  }

  // ---- Main loop ---------------------------------------------------------------------
  tick(dt) {
    if (!this.players.size) return;
    this.time = (this.time + dt * (DAY_TICKS / DAY_LENGTH_SECONDS)) % DAY_TICKS;
    this.timeBroadcastTimer += dt;
    if (this.timeBroadcastTimer > 5) { this.timeBroadcastTimer = 0; this.broadcast({ t: 'time', time: Math.round(this.time) }); }

    this.mobs.tick(dt);
    this._tickItems(dt);
    this._tickFurnaces(dt);
    this.act.tick(dt);
    this.projectiles.tick(dt);

    // Snapshot of every player and mob, ~20 times per second.
    const ps = [];
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      ps.push([p.id, r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), r2(p.yaw), r2(p.pitch), p.flags, p.held || 0]);
    }
    this.broadcast({ t: 'snap', p: ps, m: this.mobs.snapshot(), pr: this.projectiles.snapshot() });
  }

  // ---- Saving --------------------------------------------------------------------------
  serialize() {
    for (const p of this.players.values()) this._remember(p);
    const furnaces = {};
    for (const [k, f] of this.furnaces) furnaces[k] = { slots: f.slots, burn: 0, burnMax: 0, progress: 0 };
    return {
      version: 1, code: this.code, seed: this.seed, mode: this.mode, time: Math.round(this.time),
      hostToken: this.hostToken, created: this.created, savedAt: Date.now(),
      edits: this.world.serializeEdits(), players: this.savedPlayers, furnaces,
      ...this.act.serialize(),
    };
  }

  async save() {
    if (!this.dirty) return false;
    this.dirty = false;
    try {
      await saveWorld(this.code, this.serialize());
      return true;
    } catch (e) {
      this.dirty = true;
      console.error(`[save] ${this.code} failed:`, e.message);
      return false;
    }
  }

  saveSync() {
    try { saveWorldSync(this.code, this.serialize()); this.dirty = false; } catch (e) { console.error(`[save] ${this.code} failed:`, e.message); }
  }
}

function itemMsg(it) {
  return [it.id, it.stack.id, it.stack.count, r2(it.pos.x), r2(it.pos.y), r2(it.pos.z), r2(it.vel.x), r2(it.vel.y), r2(it.vel.z)];
}

export const TICK_SECONDS = 1 / SERVER_TICK_RATE;
