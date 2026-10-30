// ============================================================================
// Mobs: animals, villagers and monsters, all simulated on the server.
//
// Behaviour is built from a few simple "goals", re-chosen every so often:
//   wander     walk to a random reachable spot nearby, then idle a while
//   follow     go to someone (a player holding food you like, your owner, a
//              mate, whoever holds your lead)
//   chase      hunt a target (monsters at night, a wolf defending its owner)
//   panic      run off in a random direction after being hurt
// Walking uses A* pathfinding (server/pathfind.js), so mobs go around walls
// and holes instead of into them. Bats, parrots and squid fly/swim freely.
//
// Animals can be bred with their favourite food (babies grow up after a few
// minutes), wolves, cats and parrots tamed, horses tamed by riding them and
// then saddled and ridden. Leads tie animals to you or to a fence post, and
// name tags give them a name (named, tamed, bred and leashed mobs are saved).
// ============================================================================
import { moveEntity, liquidLevel } from '../shared/physics.js';
import { MOBS, PHYSICS, REACH, SERVER_REACH_SLACK, CHUNK_HEIGHT, SEA_LEVEL } from '../shared/config.js';
import { B, BLOCKS, BLOCK_BY_NAME, IS_SOLID, IS_LIQUID, CONNECT, SHAPE } from '../shared/blocks.js';
import { itemId, ITEMS } from '../shared/items.js';
import { PROFESSIONS, TRADES } from '../shared/trades.js';
import { BIOME } from '../shared/biomes.js';
import { findPath, randomSpot, standable } from './pathfind.js';

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const SEEDS = ['wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds'];
// natural sheep colours (the snapshot's variant field)
const WOOL = ['white_wool', 'light_gray_wool', 'gray_wool', 'black_wool', 'brown_wool', 'pink_wool'];
const MEAT = ['raw_porkchop', 'cooked_porkchop', 'raw_beef', 'steak', 'raw_chicken', 'cooked_chicken', 'raw_mutton', 'cooked_mutton', 'raw_rabbit', 'cooked_rabbit', 'rotten_flesh'];

// `index` must match MOB_KINDS order in client/rendering/entities.js (only ever append).
// food = what it follows and breeds with; tame = item that tames it (with a 1 in 3 chance).
export const MOB_TYPES = {
  pig: { index: 0, width: 0.9, height: 0.9, health: 10, speed: 1.6, passive: true, food: ['carrot', 'potato', 'beetroot'], drops: () => [['raw_porkchop', rnd(1, 3)]] },
  zombie: { index: 1, width: 0.6, height: 1.95, health: 20, speed: 2.4, damage: 3, hostile: true, burns: true, cause: 'was slain by a zombie',
    drops: () => [['rotten_flesh', rnd(0, 2)], ...(Math.random() < 0.03 ? [[['iron_ingot', 'carrot', 'potato'][rnd(0, 2)], 1]] : [])] },
  cow: { index: 2, width: 0.9, height: 1.4, health: 10, speed: 1.4, passive: true, food: ['wheat'], drops: () => [['leather', rnd(0, 2)], ['raw_beef', rnd(1, 3)]] },
  sheep: { index: 3, width: 0.9, height: 1.3, health: 8, speed: 1.4, passive: true, food: ['wheat'], drops: (m) => [...(m.sheared > 0 ? [] : [[WOOL[m.variant] || 'white_wool', 1]]), ['raw_mutton', rnd(1, 2)]] },
  chicken: { index: 4, width: 0.4, height: 0.7, health: 4, speed: 1.3, passive: true, food: SEEDS, drops: () => [['feather', rnd(0, 2)], ['raw_chicken', 1]] },
  villager: { index: 5, width: 0.6, height: 1.95, health: 20, speed: 1.1, villager: true, drops: () => [] },
  skeleton: { index: 6, width: 0.6, height: 1.95, health: 20, speed: 2.3, damage: 2, burns: true, hostile: true, cause: 'was shot by a skeleton',
    drops: () => [['bone', rnd(0, 2)], ['arrow', rnd(0, 2)]] },
  spider: { index: 7, width: 1.3, height: 0.9, health: 16, speed: 3.2, damage: 2, climbs: true, hostile: true, dayCalm: true, cause: 'was slain by a spider',
    drops: () => [['string', rnd(0, 2)], ['spider_eye', Math.random() < 0.33 ? 1 : 0]] },
  // BlockCraft's own exploding stone beast: creeps up close, hisses, and blows up. Afraid of cats.
  rumbler: { index: 8, width: 0.7, height: 1.4, health: 20, speed: 2.1, hostile: true, cause: 'was blown up by a Rumbler', drops: () => [['gunpowder', rnd(0, 2)]] },
  wolf: { index: 9, width: 0.6, height: 0.85, health: 8, tamedHealth: 20, speed: 2.8, damage: 4, neutral: true, tame: ['bone'], food: MEAT, cause: 'was mauled by a wolf', drops: () => [] },
  cat: { index: 10, width: 0.6, height: 0.7, health: 10, speed: 3, passive: true, skittish: true, tame: ['raw_cod', 'raw_salmon'], food: ['raw_cod', 'raw_salmon'], drops: () => [] },
  horse: { index: 11, width: 1.3, height: 1.6, health: 22, speed: 1.8, passive: true, rideable: true, food: ['golden_apple', 'golden_carrot'], treats: ['apple', 'sugar', 'wheat', 'hay_bale', 'carrot'],
    drops: () => [['leather', rnd(0, 2)]] },
  slime: { index: 12, width: 0.51, height: 0.51, health: 1, speed: 2.2, damage: 1, hostile: true, hops: true, cause: 'was squished by a slime', drops: (m) => (m.size === 1 ? [['slimeball', rnd(0, 2)]] : []) },
  witch: { index: 13, width: 0.6, height: 1.95, health: 26, speed: 2.1, damage: 4, hostile: true, ranged: 'potion', cause: 'was cursed by a witch',
    drops: () => [[['glass_bottle', 'redstone', 'sugar', 'spider_eye', 'gunpowder', 'stick'][rnd(0, 5)], rnd(1, 3)]] },
  iron_golem: { index: 14, width: 1.4, height: 2.7, health: 100, speed: 1.5, damage: 10, golem: true, neutral: true, cause: 'was flung by an iron golem',
    drops: () => [['iron_ingot', rnd(3, 5)], ['red_flower', rnd(0, 2)]] },
  squid: { index: 15, width: 0.8, height: 0.8, health: 10, speed: 2, passive: true, swims: true, drops: () => [['ink_sac', rnd(1, 3)]] },
  bat: { index: 16, width: 0.5, height: 0.9, health: 6, speed: 3, passive: true, flies: true, drops: () => [] },
  rabbit: { index: 17, width: 0.4, height: 0.5, health: 3, speed: 3, passive: true, hops: true, food: ['carrot', 'golden_carrot', 'yellow_flower'],
    drops: () => [['raw_rabbit', rnd(0, 1)], ['rabbit_hide', rnd(0, 1)], ...(Math.random() < 0.1 ? [['rabbit_foot', 1]] : [])] },
  polar_bear: { index: 18, width: 1.3, height: 1.4, health: 30, speed: 2.4, damage: 6, neutral: true, cause: 'was mauled by a polar bear', drops: () => [[Math.random() < 0.75 ? 'raw_cod' : 'raw_salmon', rnd(0, 2)]] },
  parrot: { index: 19, width: 0.5, height: 0.9, health: 6, speed: 2.5, passive: true, flies: true, tame: SEEDS, drops: () => [['feather', rnd(1, 2)]] },
  cave_spider: { index: 20, width: 0.7, height: 0.5, health: 12, speed: 3.4, damage: 2, climbs: true, hostile: true, poison: 4, cause: 'was poisoned by a cave spider',
    drops: () => [['string', rnd(0, 2)], ['spider_eye', Math.random() < 0.33 ? 1 : 0]] },
  // The Shade: BlockCraft's own tall, silent wanderer of the night. Leave it alone and it
  // leaves you alone; stare at it or hit it and it hunts you, blinking from place to place.
  shade: { index: 21, width: 0.6, height: 2.9, health: 40, speed: 3.1, damage: 7, neutral: true, teleports: true, cause: 'was taken by a Shade',
    drops: () => [['ender_pearl', rnd(0, 1)]] },
  // desert zombies don't burn in the sun; snowy skeletons
  husk: { index: 22, width: 0.6, height: 1.95, health: 20, speed: 2.4, damage: 3, hostile: true, zombie: true, cause: 'was slain by a husk', drops: () => [['rotten_flesh', rnd(0, 2)]] },
  stray: { index: 23, width: 0.6, height: 1.95, health: 20, speed: 2.3, damage: 2, burns: true, hostile: true, archer: true, cause: 'was shot by a stray',
    drops: () => [['bone', rnd(0, 2)], ['arrow', rnd(0, 2)]] },
  mooshroom: { index: 24, width: 0.9, height: 1.4, health: 10, speed: 1.4, passive: true, food: ['wheat'], drops: () => [['leather', rnd(0, 2)], ['raw_beef', rnd(1, 3)]] },
  donkey: { index: 25, width: 1.4, height: 1.5, health: 20, speed: 1.7, passive: true, horse: true, rideable: true, food: ['golden_apple', 'golden_carrot'],
    treats: ['apple', 'sugar', 'wheat', 'hay_bale', 'carrot'], drops: () => [['leather', rnd(0, 2)]] },
  llama: { index: 26, width: 0.9, height: 1.87, health: 22, speed: 1.6, passive: true, horse: true, noSaddle: true, food: ['hay_bale'], treats: ['wheat'],
    drops: () => [['leather', rnd(0, 2)]] },
  // built by players: two snow blocks with a pumpkin on top; throws snowballs at monsters
  snow_golem: { index: 27, width: 0.7, height: 1.9, health: 4, speed: 1.6, golem: true, ranged: 'snowball', drops: () => [['snowball', rnd(0, 15)]] },
  guardian: { index: 28, width: 0.85, height: 0.85, health: 30, speed: 2.4, damage: 6, hostile: true, swims: true, beam: true, cause: 'was zapped by a guardian',
    drops: () => [['prismarine_shard', rnd(0, 2)], ['raw_cod', rnd(0, 1)]] },
  elder_guardian: { index: 29, width: 2, height: 2, health: 80, speed: 1.4, damage: 8, hostile: true, swims: true, beam: true, cause: 'was zapped by an elder guardian',
    drops: () => [['prismarine_shard', rnd(0, 2)], ['sponge', 1], ['raw_cod', rnd(0, 1)]] },
  vindicator: { index: 30, width: 0.6, height: 1.95, health: 24, speed: 2.6, damage: 8, hostile: true, illager: true, cause: 'was chopped by a vindicator',
    drops: () => [['emerald', rnd(0, 1)]] },
  evoker: { index: 31, width: 0.6, height: 1.95, health: 24, speed: 2.2, hostile: true, illager: true, caster: true, cause: 'was bitten by evoker fangs',
    drops: () => [['totem_of_undying', 1], ['emerald', rnd(0, 1)]] },
  vex: { index: 32, width: 0.4, height: 0.8, health: 14, speed: 4.5, damage: 5, hostile: true, flies: true, ghost: true, cause: 'was stabbed by a vex', drops: () => [] },
  zombie_villager: { index: 33, width: 0.6, height: 1.95, health: 20, speed: 2.4, damage: 3, hostile: true, zombie: true, burns: true, cause: 'was slain by a zombie villager',
    drops: () => [['rotten_flesh', rnd(0, 2)]] },
  silverfish: { index: 34, width: 0.4, height: 0.3, health: 8, speed: 2.8, damage: 1, hostile: true, cause: 'was nibbled by silverfish', drops: () => [] },
  mule: { index: 35, width: 1.4, height: 1.6, health: 20, speed: 1.75, passive: true, horse: true, rideable: true, treats: ['apple', 'sugar', 'wheat', 'hay_bale', 'carrot'],
    drops: () => [['leather', rnd(0, 2)]] },
};
MOB_TYPES.zombie.zombie = true;
MOB_TYPES.skeleton.archer = true;
Object.assign(MOB_TYPES.horse, { horse: true });
// biomes where the sun is too hot (or wet) for a snow golem
const HOT = new Set([BIOME.DESERT, BIOME.SAVANNA, BIOME.SAVANNA_PLATEAU, BIOME.JUNGLE, BIOME.JUNGLE_EDGE, BIOME.BADLANDS, BIOME.BADLANDS_PLATEAU]);
const BY_INDEX = Object.entries(MOB_TYPES).sort((a, b) => a[1].index - b[1].index).map(([k]) => k);

// Night monsters on the surface (and in dark caves at any time).
const MONSTERS = [['zombie', 8], ['skeleton', 7], ['spider', 6], ['rumbler', 5], ['witch', 1], ['shade', 1]];
// Day animals by biome; everything else gets the farm animals.
const FARM = [['pig', 3], ['cow', 3], ['sheep', 4], ['chicken', 3]];
const BIOME_ANIMALS = {
  [BIOME.PLAINS]: [...FARM, ['horse', 2], ['donkey', 0.5]], [BIOME.SUNFLOWER_PLAINS]: [...FARM, ['horse', 2], ['donkey', 0.5]],
  [BIOME.SAVANNA]: [['horse', 3], ['donkey', 1], ['cow', 2], ['sheep', 2], ['chicken', 1]], [BIOME.SAVANNA_PLATEAU]: [['llama', 3], ['horse', 2], ['cow', 1]],
  [BIOME.MOUNTAINS]: [...FARM, ['llama', 2]], [BIOME.WOODED_MOUNTAINS]: [...FARM, ['llama', 2]], [BIOME.MUSHROOM_FIELDS]: [['mooshroom', 1]],
  [BIOME.FOREST]: [...FARM, ['wolf', 1]], [BIOME.TAIGA]: [...FARM, ['wolf', 3], ['rabbit', 2]], [BIOME.GIANT_TREE_TAIGA]: [...FARM, ['wolf', 3], ['rabbit', 2]],
  [BIOME.SNOWY_TUNDRA]: [['rabbit', 4], ['polar_bear', 2]], [BIOME.ICE_SPIKES]: [['polar_bear', 2], ['rabbit', 2]], [BIOME.SNOWY_TAIGA]: [['wolf', 3], ['rabbit', 3]],
  [BIOME.DESERT]: [['rabbit', 4]], [BIOME.FLOWER_FOREST]: [...FARM, ['rabbit', 3]],
  [BIOME.JUNGLE]: [...FARM, ['cat', 2], ['parrot', 3]], [BIOME.JUNGLE_EDGE]: [...FARM, ['cat', 1], ['parrot', 2]],
};
const HORSEY = new Set(['horse', 'donkey']);
const DISCS = ITEMS.filter(it => it && it.name.startsWith('music_disc_')).map(it => it.name);
const pickWeighted = (list) => {
  let roll = Math.random() * list.reduce((a, [, w]) => a + w, 0);
  for (const [k, w] of list) if ((roll -= w) < 0) return k;
  return list[0][0];
};

let nextMobId = 1;

export class MobManager {
  constructor(room, saved = {}) {
    this.room = room;
    this.mobs = new Map();
    this.spawnTimer = 0;
    this.pathBudget = 0;
    this.poisoned = new Map(); // player id -> seconds of poison left
    this.effects = [];         // delayed attacks: evoker fangs, guardian beams
    this.kills = new Set(saved.mobKills ?? []); // structure residents that were killed (they don't come back)
    // Tamed, named, bred and leashed animals are saved with the world.
    for (const s of saved.mobs ?? []) {
      if (!MOB_TYPES[s.type]) continue;
      const m = this.spawn(s.type, s.pos.x, s.pos.y, s.pos.z);
      Object.assign(m, { name: s.name || null, owner: s.owner || null, tamed: !!s.tamed, saddled: !!s.saddled, sitting: !!s.sitting,
        age: s.age ?? 0, variant: s.variant ?? m.variant, profession: s.profession, persistent: true, health: s.health ?? m.health,
        leash: s.fence ? { fence: s.fence } : null, size: s.size ?? m.size });
      if (m.tamed && m.def.tamedHealth) m.maxHealth = m.def.tamedHealth;
    }
  }

  get get() { return (x, y, z) => this.room.world.getBlock(x, y, z); }

  count(type) { let n = 0; for (const m of this.mobs.values()) if (m.type === type) n++; return n; }
  countHostile() { let n = 0; for (const m of this.mobs.values()) if (m.def.hostile) n++; return n; }
  countPassive() { let n = 0; for (const m of this.mobs.values()) if (m.def.passive && !m.persistent) n++; return n; }

  spawn(type, x, y, z, home = null, opts = {}) {
    const def = MOB_TYPES[type];
    const size = type === 'slime' ? (opts.size || [1, 2, 4][rnd(0, 2)]) : 1;
    const m = {
      id: nextMobId++, type, def, size, life: type === 'vex' ? 30 + Math.random() * 90 : 0,
      pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 },
      yaw: Math.random() * Math.PI * 2, health: def.health * (type === 'slime' ? size * size : 1), maxHealth: def.health * (type === 'slime' ? size * size : 1),
      goal: null, path: null, pathAt: 0, idle: Math.random() * 3,
      attackCooldown: 0, hurtTimer: 0, onGround: false, burnTimer: 0, home,
      age: opts.baby ? -300 : 0, love: 0, breedCooldown: 0, variant: rnd(0, 4),
      tamed: false, owner: null, sitting: false, saddled: false, name: null, leash: null, persistent: false,
    };
    if (type === 'sheep') { const r = Math.random(); m.variant = r < 0.82 ? 0 : r < 0.87 ? 1 : r < 0.92 ? 2 : r < 0.97 ? 3 : r < 0.998 ? 4 : 5; }
    this.mobs.set(m.id, m);
    return m;
  }

  /** Physical size: slimes come in three sizes, babies are half size. */
  _w(m) { return m.def.width * m.size * (m.age < 0 ? 0.5 : 1); }
  _h(m) { return m.def.height * m.size * (m.age < 0 ? 0.5 : 1); }

  tick(dt) {
    const room = this.room;
    const players = [...room.players.values()].filter(p => p.alive);
    if (!players.length) return;
    this.pathBudget = 2500; // A* cells we may look at this tick, shared by all mobs

    this.spawnTimer += dt;
    if (this.spawnTimer > 1) {
      this.spawnTimer = 0;
      this._trySpawn(players);
      this._tryCaveSpawn(players);
      for (const p of players) { this._spawnVillagers(p); this._structureMobs(p); }
      this._spawners(players);
      // poison wears off a little each second
      for (const [pid, t] of this.poisoned) {
        const p = room.players.get(pid);
        if (!p || t <= 0) { this.poisoned.delete(pid); continue; }
        this.poisoned.set(pid, t - 1);
        room.hurtPlayer(p, 1, p.pos, 'was poisoned', true);
      }
    }
    this._tickEffects(dt);

    const night = room.isNight();
    for (const m of [...this.mobs.values()]) {
      let nearest = null, nd = Infinity;
      for (const p of players) { const d = dist(p.pos, m.pos); if (d < nd) { nd = d; nearest = p; } }
      if (nd > MOBS.despawnRadius) {
        if (!m.persistent && !m.tamed && !m.name) { this.mobs.delete(m.id); continue; }
        if (nd > 160) continue; // saved animals far from everyone just wait
      }
      if (m.rider) {
        this._ridden(m, dt);
        if (m.rider && m.tamed && m.saddled) continue;   // the rider is steering it
      }
      if (m.life && (m.life -= dt) <= 0) { this.damage(m, 999, null); continue; } // vexes fade away
      if (m.age < 0) m.age += dt;                          // babies grow up
      if (m.love > 0) m.love -= dt;
      if (m.breedCooldown > 0) m.breedCooldown -= dt;
      if (m.attackCooldown > 0) m.attackCooldown -= dt;
      if (m.angry > 0) m.angry -= dt;
      if (m.sheared > 0) m.sheared -= dt;
      if (m.type === 'chicken' && m.age >= 0 && (m.eggTimer = (m.eggTimer ?? 300 + Math.random() * 300) - dt) <= 0) {
        m.eggTimer = 300 + Math.random() * 300;
        room.spawnItem({ id: itemId('egg'), count: 1 }, m.pos.x, m.pos.y + 0.3, m.pos.z);
      }
      if (m.def.burns && !night && (m.burnTimer += dt) > 1) { m.burnTimer = 0; if (this._skyAbove(m)) this.damage(m, 2, null); }
      if (m.type === 'snow_golem') this._snowGolem(m, dt);
      if (m.def.teleports && (IS_LIQUID[this.get(Math.floor(m.pos.x), Math.floor(m.pos.y + 0.5), Math.floor(m.pos.z))] || (m.angry > 0 && Math.random() < dt * 0.15))) this._teleport(m, m.angry > 0 ? this._targetPlayer(m) : null);

      if (m.def.flies) this._flyer(m, dt, players, night);
      else if (m.def.swims) this._swimmer(m, dt, players);
      else this._think(m, dt, players, night);
      if (!this.mobs.has(m.id)) continue; // blew up
      this._physics(m, dt);
      if (m.hurtTimer > 0) m.hurtTimer -= dt;
      if (m.pos.y < -20) this.mobs.delete(m.id);
    }
  }

  /** Snow golems leave a trail of snow, and melt in hot places. */
  _snowGolem(m, dt) {
    const x = Math.floor(m.pos.x), y = Math.floor(m.pos.y), z = Math.floor(m.pos.z);
    m.meltTimer = (m.meltTimer || 0) + dt;
    if (m.meltTimer < 1) return;
    m.meltTimer = 0;
    if (HOT.has(this.room.world.gen.column(x, z).biome) || IS_LIQUID[this.get(x, y, z)]) { this.damage(m, 1, null); return; }
    const layer = BLOCK_BY_NAME.snow_layer;
    if (layer && this.get(x, y, z) === 0 && IS_SOLID[this.get(x, y - 1, z)] && SHAPE[this.get(x, y - 1, z)] === 0) this.room.setBlock(x, y, z, layer.id);
  }

  /** Delayed attacks: evoker fangs snap shut, guardian beams finish charging. */
  _tickEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      if ((e.t -= dt) > 0) continue;
      this.effects.splice(i, 1);
      if (e.kind === 'fangs') {
        for (const p of this.room.players.values()) {
          if (p.alive && e.points.some(([x, y, z]) => Math.abs(p.pos.x - x) < 1 && Math.abs(p.pos.z - z) < 1 && Math.abs(p.pos.y - y) < 2)) this.room.hurtPlayer(p, 6, { x: p.pos.x, y: p.pos.y - 1, z: p.pos.z }, MOB_TYPES.evoker.cause);
        }
        for (const o of this.mobs.values()) {
          if (!o.def.illager && e.points.some(([x, y, z]) => Math.abs(o.pos.x - x) < 1 && Math.abs(o.pos.z - z) < 1 && Math.abs(o.pos.y - y) < 2)) this.damage(o, 6, null);
        }
      } else if (e.kind === 'beam') {
        const m = this.mobs.get(e.mob), p = this.room.players.get(e.player);
        if (m && p && p.alive && dist(m.pos, p.pos) < 16 && this._canSee(m, p)) this.room.hurtPlayer(p, m.def.damage, m.pos, m.def.cause, true);
      }
    }
  }

  // ---- Choosing what to do ---------------------------------------------------------------
  _think(m, dt, players, night) {
    const def = m.def;
    if (m.sitting) { this._steer(m, 0, dt); return; }
    // 1. On a lead: stay close to whoever (or whatever post) holds it.
    if (m.leash) {
      const holder = m.leash.fence ? { x: m.leash.fence[0] + 0.5, y: m.leash.fence[1], z: m.leash.fence[2] + 0.5 } : this.room.players.get(m.leash.player)?.pos;
      if (!holder || (m.leash.fence && CONNECT[this.get(...m.leash.fence)] !== 1)) { this._unleash(m, true); }
      else {
        const d = flat(holder, m.pos);
        if (d > 12 && !m.leash.fence) { this._unleash(m, true); }
        else if (d > 3) {
          // pulled along like a rope
          const k = Math.min(1, (d - 3) * 0.4);
          m.yaw = Math.atan2(holder.x - m.pos.x, holder.z - m.pos.z);
          this._steer(m, def.speed * (1 + k), dt);
          if (d > 6) { m.vel.x += (holder.x - m.pos.x) / d * 6 * dt * 10; m.vel.z += (holder.z - m.pos.z) / d * 6 * dt * 10; }
          return;
        }
      }
    }
    // Villagers run from zombies and illagers.
    if (def.villager && !(m.panic > 0) && (m.scan = (m.scan || 0) - dt) <= 0) {
      m.scan = 0.5;
      for (const o of this.mobs.values()) if ((o.def.zombie || o.def.illager) && dist(o.pos, m.pos) < 8) { m.panic = 3; m.fleeFrom = { ...o.pos }; m.goal = null; break; }
    }
    // 2. Panic after being hurt (animals and villagers).
    if (m.panic > 0) {
      m.panic -= dt;
      if (!m.goal || m.goal.kind !== 'flee') {
        const away = m.fleeFrom ? Math.atan2(m.pos.x - m.fleeFrom.x, m.pos.z - m.fleeFrom.z) : Math.random() * 6.28;
        const a = away + (Math.random() - 0.5) * 1.2;
        const spot = randomSpot(this.get, m.pos.x + Math.sin(a) * 8, m.pos.y, m.pos.z + Math.cos(a) * 8, 3, this._h(m));
        m.goal = spot ? { kind: 'flee', ...spot } : null; m.path = null;
      }
      return this._walkGoal(m, dt, def.speed * 2.1);
    }
    // 3. Fighting.
    const target = this._chooseTarget(m, players, night);
    if (target) return this._fight(m, dt, target);
    // 4. Following: owner, a mate, or a player holding food we like.
    const follow = this._chooseFollow(m, players);
    if (follow) {
      const d = flat(follow.pos, m.pos);
      if (follow.teleportNear && d > 14) { this._teleportNear(m, follow.pos); return; }
      if (d > (follow.stop ?? 2.2)) { m.goal = { kind: 'follow', x: follow.pos.x, y: follow.pos.y, z: follow.pos.z }; return this._walkGoal(m, dt, def.speed * (follow.fast ? 1.6 : 1.1)); }
      m.yaw = Math.atan2(follow.pos.x - m.pos.x, follow.pos.z - m.pos.z);
      this._steer(m, 0, dt);
      if (follow.mate) this._breed(m, follow.mate);
      return;
    }
    // 5. Skittish animals keep away from players that aren't holding treats.
    if (def.skittish && !m.tamed) {
      const p = players.find(q => flat(q.pos, m.pos) < 6);
      if (p) { m.fleeFrom = { ...p.pos }; m.panic = 2; return; }
    }
    // 6. Wander about.
    this._wander(m, dt);
  }

  _wander(m, dt) {
    if (m.goal && m.goal.kind === 'wander') return this._walkGoal(m, dt, m.def.speed * (m.def.hostile ? 0.6 : 0.8));
    m.idle -= dt;
    this._steer(m, 0, dt);
    if (m.idle > 0) return;
    m.idle = 2 + Math.random() * 6;
    const homeBias = m.home && flat(m.home, m.pos) > 18 ? m.home : null;   // villagers and golems stay near home
    const c = homeBias || m.pos;
    const spot = Math.random() < 0.7 ? randomSpot(this.get, c.x, homeBias ? m.pos.y : c.y, c.z, homeBias ? 8 : 10, this._h(m)) : null;
    if (spot) { m.goal = { kind: 'wander', ...spot }; m.path = null; }
    else m.yaw = Math.random() * Math.PI * 2;
  }

  /** Walk toward m.goal along an A* path (re-planned now and then). */
  _walkGoal(m, dt, speed) {
    const g = m.goal;
    if (!g) return this._steer(m, 0, dt);
    const now = Date.now();
    const d = flat(g, m.pos);
    if (d < 0.7 && Math.abs(g.y - m.pos.y) < 1.5) { if (g.kind !== 'follow' && g.kind !== 'chase') m.goal = null; m.path = null; return this._steer(m, 0, dt); }
    if ((!m.path || now - m.pathAt > (g.kind === 'chase' ? 900 : 2500)) && this.pathBudget > 0) {
      const maxNodes = Math.min(400, this.pathBudget);
      m.path = findPath(this.get, m.pos, g, { height: this._h(m), maxNodes, maxDrop: m.def.climbs ? 6 : 3 });
      this.pathBudget -= maxNodes;
      m.pathAt = now;
      if (!m.path && g.kind === 'wander') { m.goal = null; return this._steer(m, 0, dt); }
    }
    let wp = m.path && m.path[0];
    while (wp && flat(wp, m.pos) < 0.45 && Math.abs(wp.y - m.pos.y) < 1.2) { m.path.shift(); wp = m.path[0]; }
    const aim = wp || g;
    m.yaw = Math.atan2(aim.x - m.pos.x, aim.z - m.pos.z);
    if (wp && wp.y > m.pos.y + 0.4 && m.onGround) m.vel.y = 7.5; // hop up a step
    this._steer(m, speed, dt);
  }

  _chooseTarget(m, players, night) {
    const def = m.def;
    if (m.huntMob) {
      const t = this.mobs.get(m.huntMob);
      if (t && dist(t.pos, m.pos) < 24 && !(t.tamed && t.owner === m.owner && m.tamed)) return { mob: t, pos: t.pos };
      m.huntMob = null;
    }
    // golems defend villages (and their builders) from monsters
    if (def.golem) {
      let best = null, bd = def.ranged ? 10 : 14;
      for (const o of this.mobs.values()) {
        if (!o.def.hostile || (o.type === 'rumbler' && !def.ranged)) continue;
        const d = dist(o.pos, m.pos);
        if (d < bd) { bd = d; best = o; }
      }
      if (best) return { mob: best, pos: best.pos };
    }
    // wolves chase skeletons, and wild ones hunt sheep and rabbits now and then
    if (m.type === 'wolf' && !m.sitting && (m.scan = (m.scan || 0) - 1) <= 0) {
      m.scan = 40;
      for (const o of this.mobs.values()) {
        const prey = o.def.archer || (!m.tamed && (o.type === 'sheep' || o.type === 'rabbit') && Math.random() < 0.08);
        if (prey && dist(o.pos, m.pos) < 12) { m.huntMob = o.id; return { mob: o, pos: o.pos }; }
      }
    }
    const angry = m.angry > 0;
    if (m.tamed || (def.golem && !angry)) return null;
    if (def.neutral && !angry) {
      // polar bears with a cub nearby don't like you coming close
      if (m.type !== 'polar_bear' || m.age < 0) return null;
      const cub = [...this.mobs.values()].some(o => o.type === 'polar_bear' && o.age < 0 && dist(o.pos, m.pos) < 10);
      const p = cub && players.find(q => dist(q.pos, m.pos) < 5);
      if (!p || this.room.mode !== 'survival') return null;
      m.angry = 10; m.angryAt = p.id;
    }
    if (!def.hostile && !def.neutral && !def.golem) return null;
    if (def.dayCalm && !night && !angry) return null;
    let best = null, bd = def.hostile ? (def.illager ? 14 : 20) : 28;
    if (this.room.mode === 'survival') {
      for (const p of players) {
        if (angry && m.angryAt && p.id !== m.angryAt && !(m.type === 'wolf' || m.type === 'polar_bear')) continue;
        const d = dist(p.pos, m.pos);
        if (d < bd) { bd = d; best = p; }
      }
    }
    if (best) return { player: best, pos: best.pos };
    // zombies and illagers go after villagers too
    if (def.zombie || def.illager) {
      let v = null, vd = 16;
      for (const o of this.mobs.values()) if (o.def.villager) { const d = dist(o.pos, m.pos); if (d < vd) { vd = d; v = o; } }
      if (v) return { mob: v, pos: v.pos };
    }
    return null;
  }

  _chooseFollow(m, players) {
    // tamed: stay near the owner
    if (m.tamed && m.owner && m.type !== 'horse') {
      const o = [...this.room.players.values()].find(p => p.name === m.owner && p.alive);
      if (o && flat(o.pos, m.pos) > 4) return { pos: o.pos, teleportNear: true, stop: 2.5, fast: true };
    }
    // in love: go to another of our kind that's also in love
    if (m.love > 0 && m.age >= 0) {
      let mate = null, md = 10;
      for (const o of this.mobs.values()) {
        if (o === m || !(o.love > 0) || o.age < 0) continue;
        if (o.type !== m.type && !(HORSEY.has(o.type) && HORSEY.has(m.type))) continue;
        const d = dist(o.pos, m.pos);
        if (d < md) { md = d; mate = o; }
      }
      if (mate) return { pos: mate.pos, mate, stop: 1.6 };
    }
    // tempted: a player holding our favourite food
    const likes = m.def.food || m.def.tame;
    if (likes && !m.leash) {
      for (const p of players) {
        const held = ITEMS[p.held];
        if (held && likes.includes(held.name) && flat(p.pos, m.pos) < 10 && (!m.def.tame || !m.def.food || m.tamed || m.def.tame.includes(held.name))) {
          return { pos: p.pos, stop: 2.2 };
        }
      }
    }
    return null;
  }

  _fight(m, dt, target) {
    const def = m.def, tpos = target.pos;
    const d = dist(tpos, m.pos);
    m.yaw = Math.atan2(tpos.x - m.pos.x, tpos.z - m.pos.z);
    if (def.caster) return this._cast(m, dt, target, d);
    if (def.archer || def.ranged) {
      // keep 6-12 blocks away and shoot
      const want = d > 12 ? def.speed : d < 6 ? -def.speed * 0.8 : 0;
      if (want > 0) { m.goal = { kind: 'chase', ...tpos }; this._walkGoal(m, dt, want); } else this._steer(m, want, dt);
      if (d < 16 && m.attackCooldown <= 0 && (!target.player || this._canSee(m, target.player))) {
        m.attackCooldown = def.ranged ? 3 : 2 + Math.random();
        const eyeY = m.pos.y + 1.6;
        const dx = tpos.x - m.pos.x, dz = tpos.z - m.pos.z, dy = tpos.y + 1.2 - eyeY;
        const fd = Math.hypot(dx, dz);
        this.room.projectiles.spawn(m, { x: m.pos.x, y: eyeY, z: m.pos.z }, [dx + (Math.random() - 0.5), dy + fd * 0.14, dz + (Math.random() - 0.5)], def.ranged || 'arrow', def.ranged ? 1 : 0.6);
        if (def.ranged === 'snowball') m.attackCooldown = 1;
      }
      return;
    }
    if (m.type === 'rumbler') {
      // keep away from cats!
      for (const o of this.mobs.values()) if (o.type === 'cat' && dist(o.pos, m.pos) < 6) { m.fleeFrom = { ...o.pos }; m.panic = 2; m.fuse = 0; return; }
      if (d > 1.6) { m.goal = { kind: 'chase', ...tpos }; this._walkGoal(m, dt, def.speed); } else this._steer(m, 0, dt);
      if (d < 2.8) {
        if (!m.fuse) this.room.broadcast({ t: 'fuse', x: m.pos.x, y: m.pos.y, z: m.pos.z, time: 1.5 });
        m.fuse = (m.fuse || 0) + dt;
        if (m.fuse > 1.5) { this.mobs.delete(m.id); this.room.act.explode(m.pos.x, m.pos.y + 0.7, m.pos.z, 3); }
      } else if (m.fuse) m.fuse = Math.max(0, m.fuse - dt);
      return;
    }
    if (def.hops) {
      // slimes and rabbits bounce toward the target
      if (m.onGround && m.attackCooldown <= 0.5) { m.vel.y = 6; this._steer(m, def.speed * 2, 0.2); }
    } else if (d > 1.2) { m.goal = { kind: 'chase', ...tpos }; this._walkGoal(m, dt, def.speed * (m.def.neutral ? 1.25 : 1)); } else this._steer(m, 0, dt);
    if (def.climbs && m.hitWall) m.vel.y = 4; // spiders walk straight up walls
    const reach = Math.max(1.4, this._w(m) * 0.5 + 1);
    if (d < reach && Math.abs(tpos.y - m.pos.y) < 2 && m.attackCooldown <= 0) {
      m.attackCooldown = def.golem ? 1.5 : 1;
      const dmg = (def.damage || 1) * (m.type === 'slime' ? m.size : 1);
      if (target.player) {
        this.room.hurtPlayer(target.player, dmg, m.pos, def.cause);
        if (def.poison) this.poisoned.set(target.player.id, def.poison);
        this._ownerHurt(target.player, m);
      } else {
        this.damage(target.mob, dmg, m.pos, m);
        if (def.golem) target.mob.vel.y = 9; // golems fling things into the air
      }
    }
  }

  /** Evokers keep their distance, call up vexes and send rows of snapping fangs. */
  _cast(m, dt, target, d) {
    const tpos = target.pos;
    const want = d > 10 ? m.def.speed : d < 5 ? -m.def.speed : 0;
    if (want > 0) { m.goal = { kind: 'chase', ...tpos }; this._walkGoal(m, dt, want); } else this._steer(m, want, dt);
    if (m.attackCooldown > 0 || d > 14) return;
    m.attackCooldown = 5;
    let vexes = 0;
    for (const o of this.mobs.values()) if (o.type === 'vex' && dist(o.pos, m.pos) < 24) vexes++;
    if (vexes < 3 && Math.random() < 0.4) {
      for (let i = 0; i < 3; i++) this.spawn('vex', m.pos.x + (Math.random() - 0.5) * 2, m.pos.y + 1.5, m.pos.z + (Math.random() - 0.5) * 2);
      this.room.broadcast({ t: 'poof', kind: 'spell', x: m.pos.x, y: m.pos.y + 2, z: m.pos.z });
      return;
    }
    // a line of fangs from the evoker to the target
    const dx = (tpos.x - m.pos.x) / d, dz = (tpos.z - m.pos.z) / d;
    const points = [];
    for (let i = 1; i <= Math.min(16, Math.ceil(d) + 2); i++) {
      const x = m.pos.x + dx * i, z = m.pos.z + dz * i;
      let y = Math.floor(m.pos.y);
      for (let k = 0; k < 4 && !IS_SOLID[this.get(Math.floor(x), y - 1, Math.floor(z))]; k++) y--;
      for (let k = 0; k < 4 && IS_SOLID[this.get(Math.floor(x), y, Math.floor(z))]; k++) y++;
      points.push([r2(x), y, r2(z)]);
    }
    this.effects.push({ kind: 'fangs', t: 0.6, points });
    this.room.broadcast({ t: 'fangs', points });
  }

  // ---- Breeding ----------------------------------------------------------------------------
  _breed(m, mate) {
    if (!(m.love > 0 && mate.love > 0) || dist(m.pos, mate.pos) > 1.8) return;
    m.love = mate.love = 0;
    m.breedCooldown = mate.breedCooldown = 300;
    const kind = m.type === mate.type ? m.type : 'mule';
    const baby = this.spawn(kind, (m.pos.x + mate.pos.x) / 2, m.pos.y + 0.2, (m.pos.z + mate.pos.z) / 2, m.home, { baby: true });
    baby.persistent = true;
    baby.variant = Math.random() < 0.5 ? m.variant : mate.variant;
    if (m.tamed && !m.def.horse) { baby.tamed = true; baby.owner = m.owner; }
    this.room.broadcast({ t: 'hearts', x: baby.pos.x, y: baby.pos.y + 0.5, z: baby.pos.z });
    this.room.dirty = true;
  }

  // ---- Flying and swimming -------------------------------------------------------------------
  _flyer(m, dt, players, night) {
    // vexes dive at their target; tamed parrots follow their owner; everything else flutters about
    let target = null, attack = null;
    if (m.def.hostile) {
      attack = this._chooseTarget(m, players, night);
      if (attack) target = { x: attack.pos.x, y: attack.pos.y + 1, z: attack.pos.z };
    }
    if (m.tamed && m.owner) { const o = players.find(p => p.name === m.owner); if (o && flat(o.pos, m.pos) > 3) target = { x: o.pos.x, y: o.pos.y + 2, z: o.pos.z }; }
    if (!target && (!m.flyTo || dist(m.flyTo, m.pos) < 1 || Math.random() < dt * 0.3)) {
      m.flyTo = { x: m.pos.x + (Math.random() - 0.5) * 12, y: m.pos.y + (Math.random() - 0.45) * 6, z: m.pos.z + (Math.random() - 0.5) * 12 };
    }
    const t = target || m.flyTo;
    const dx = t.x - m.pos.x, dy = t.y - m.pos.y, dz = t.z - m.pos.z, l = Math.hypot(dx, dy, dz) || 1;
    const sp = m.def.speed * (target ? 1.6 : 1) * (m.def.hostile && !attack ? 0.4 : 1);
    m.vel.x += (dx / l * sp - m.vel.x) * Math.min(1, dt * 3);
    m.vel.y += (dy / l * sp - m.vel.y) * Math.min(1, dt * 3);
    m.vel.z += (dz / l * sp - m.vel.z) * Math.min(1, dt * 3);
    m.yaw = Math.atan2(m.vel.x, m.vel.z);
    if (m.hitWall) m.flyTo = null;
    if (attack && l < 1.3 && m.attackCooldown <= 0) {
      m.attackCooldown = 1;
      if (attack.player) this.room.hurtPlayer(attack.player, m.def.damage, m.pos, m.def.cause);
      else this.damage(attack.mob, m.def.damage, m.pos, m);
    }
  }

  _swimmer(m, dt, players) {
    const inWater = IS_LIQUID[this.get(Math.floor(m.pos.x), Math.floor(m.pos.y + 0.4), Math.floor(m.pos.z))];
    if (!inWater) { this._steer(m, 0, dt); if (m.def.beam && m.onGround && Math.random() < dt * 2) m.vel.y = 5; return; } // flops about on land
    // guardians: charge a beam at a player they can see, then zap them
    if (m.def.beam && this.room.mode === 'survival') {
      const p = players.find(q => dist(q.pos, m.pos) < 15 && this._canSee(m, q));
      if (p) {
        m.yaw = Math.atan2(p.pos.x - m.pos.x, p.pos.z - m.pos.z);
        if (m.attackCooldown <= 0) {
          m.attackCooldown = 4;
          this.effects.push({ kind: 'beam', t: 2, mob: m.id, player: p.id });
          this.room.broadcast({ t: 'beam', mob: m.id, player: p.id, time: 2 });
        }
        m.vel.x *= Math.exp(-dt * 3); m.vel.z *= Math.exp(-dt * 3); m.vel.y *= Math.exp(-dt * 3);
        return;
      }
    }
    if (!m.flyTo || dist(m.flyTo, m.pos) < 1 || Math.random() < dt * 0.25 || m.hitWall) {
      const c = m.home && dist(m.home, m.pos) > 24 ? m.home : m.pos;  // guardians stay around their monument
      m.flyTo = { x: c.x + (Math.random() - 0.5) * 10, y: c.y + (Math.random() - 0.5) * 4, z: c.z + (Math.random() - 0.5) * 10 };
      if (!IS_LIQUID[this.get(Math.floor(m.flyTo.x), Math.floor(m.flyTo.y), Math.floor(m.flyTo.z))]) m.flyTo = null;
    }
    if (!m.flyTo) return;
    const dx = m.flyTo.x - m.pos.x, dy = m.flyTo.y - m.pos.y, dz = m.flyTo.z - m.pos.z, l = Math.hypot(dx, dy, dz) || 1;
    m.vel.x += (dx / l * m.def.speed - m.vel.x) * dt * 2; m.vel.y += (dy / l * m.def.speed - m.vel.y) * dt * 2; m.vel.z += (dz / l * m.def.speed - m.vel.z) * dt * 2;
    m.yaw = Math.atan2(m.vel.x, m.vel.z);
  }

  // ---- Spawning --------------------------------------------------------------------------------
  _trySpawn(players) {
    const room = this.room;
    const p = players[Math.floor(Math.random() * players.length)];
    const ang = Math.random() * Math.PI * 2;
    const r = MOBS.spawnRadiusMin + Math.random() * (MOBS.spawnRadiusMax - MOBS.spawnRadiusMin);
    const x = Math.floor(p.pos.x + Math.cos(ang) * r), z = Math.floor(p.pos.z + Math.sin(ang) * r);
    const y = room.world.surfaceY(x, z);
    if (y < 0) return;
    const ground = room.world.getBlock(x, y, z);
    const biome = room.world.gen.column(x, z).biome;
    // squid in open water
    if (ground === B.WATER) {
      if (this.count('squid') < 5 && !room.isNight() && Math.random() < 0.4) this.spawn('squid', x + 0.5, y - 1.5, z + 0.5);
      return;
    }
    if (IS_LIQUID[ground] || !IS_SOLID[ground]) return;
    if (room.world.getBlock(x, y + 1, z) !== 0 && room.world.getBlock(x, y + 1, z) !== B.TALL_GRASS) return;
    const night = room.isNight();
    if (night && room.mode === 'survival' && this.countHostile() < MOBS.maxZombies) {
      if (biome === BIOME.MUSHROOM_FIELDS) return; // no monsters on mushroom islands
      const kind = this._monsterFor(biome);
      this.spawn(kind, x + 0.5, y + 1, z + 0.5);
    } else if (!night && this.countPassive() < MOBS.maxAnimals && (ground === B.GRASS || ground === B.SAND || ground === B.SNOWY_GRASS || ground === B.SNOW || ground === B.MYCELIUM)) {
      const list = BIOME_ANIMALS[biome] || FARM;
      const kind = pickWeighted(list);
      if (ground !== B.GRASS && !['rabbit', 'polar_bear', 'wolf', 'mooshroom'].includes(kind)) return;
      const n = kind === 'polar_bear' ? rnd(1, 2) : kind === 'wolf' ? rnd(2, 4) : rnd(1, 3);
      for (let i = 0; i < n; i++) this.spawn(kind, x + 0.5 + i * 0.7, y + 1, z + 0.5, null, { baby: kind !== 'wolf' && Math.random() < 0.15 });
    }
  }

  /** Which monster appears: some biomes have their own kinds. */
  _monsterFor(biome) {
    let kind = pickWeighted(MONSTERS);
    if (biome === BIOME.SWAMP && Math.random() < 0.4) kind = Math.random() < 0.2 ? 'witch' : 'slime';
    if (kind === 'zombie' && Math.random() < 0.05) kind = 'zombie_villager';
    if (kind === 'zombie' && (biome === BIOME.DESERT || biome === BIOME.BADLANDS) && Math.random() < 0.8) kind = 'husk';
    if (kind === 'skeleton' && [BIOME.SNOWY_TUNDRA, BIOME.ICE_SPIKES, BIOME.SNOWY_TAIGA, BIOME.FROZEN_RIVER, BIOME.SNOWY_PEAKS].includes(biome) && Math.random() < 0.8) kind = 'stray';
    return kind;
  }

  /** Witches in their huts, guardians around ocean monuments, illagers in mansions,
   *  and the two prisoners in an igloo's basement. Ones you've killed stay gone. */
  _structureMobs(p) {
    const gen = this.room.world.gen;
    if (!gen.structuresNear) return;
    for (const st of gen.structuresNear(p.pos.x, p.pos.z, 72)) {
      if (!st.mobs || !st.mobs.length) continue;
      const here = new Map();
      let guardians = 0;
      for (const m of this.mobs.values()) if (m.home && m.home.id === st.id) { if (m.home.slot >= 0) here.set(m.home.slot, m); else guardians++; }
      st.mobs.forEach(([type, x, y, z], slot) => {
        if (here.has(slot) || this.kills.has(`${st.id}:${slot}`)) return;
        if (Math.hypot(x - p.pos.x, z - p.pos.z) > 64) return;
        if (type !== 'witch' && this.room.mode !== 'survival' && MOB_TYPES[type].hostile) return;
        const m = this.spawn(type, x + 0.5, y, z + 0.5, { id: st.id, slot, x: x + 0.5, y, z: z + 0.5 });
        if (type === 'villager') m.profession = rnd(0, PROFESSIONS.length - 1);
      });
      // ordinary guardians keep swimming in from the deep around a monument
      if (st.kind === 'monument' && guardians < 6 && this.room.mode === 'survival' && Math.random() < 0.3) {
        const x = st.x + rnd(-26, 26), z = st.z + rnd(-26, 26), y = rnd(SEA_LEVEL - 18, SEA_LEVEL - 3);
        if (IS_LIQUID[this.get(x, y, z)] && IS_LIQUID[this.get(x, y + 1, z)]) this.spawn('guardian', x + 0.5, y, z + 0.5, { id: st.id, slot: -1, x: st.x, y, z: st.z });
      }
    }
  }

  /** Dark caves get monsters at any time of day, and bats. */
  _tryCaveSpawn(players) {
    if (this.room.mode !== 'survival') return;
    const p = players[Math.floor(Math.random() * players.length)];
    const x = Math.floor(p.pos.x + (Math.random() - 0.5) * 48), z = Math.floor(p.pos.z + (Math.random() - 0.5) * 48);
    const y = Math.floor(p.pos.y + (Math.random() - 0.5) * 24);
    if (y > SEA_LEVEL - 4 || y < 4 || Math.hypot(x - p.pos.x, z - p.pos.z) < 16) return;
    if (!standable(this.get, x, y, z, 2) || IS_LIQUID[this.get(x, y, z)]) return;
    if (this._skyAbove({ pos: { x, y, z } })) return;
    // torches nearby keep monsters away
    for (let dy = -3; dy <= 3; dy++) for (let dz = -6; dz <= 6; dz += 2) for (let dx = -6; dx <= 6; dx += 2) {
      if (BLOCKS[this.get(x + dx, y + dy, z + dz)]?.light >= 12) return;
    }
    if (Math.random() < 0.25) { if (this.count('bat') < 6) this.spawn('bat', x + 0.5, y + 1, z + 0.5); return; }
    if (this.countHostile() >= MOBS.maxZombies) return;
    let kind = this._monsterFor(this.room.world.gen.column(x, z).biome);
    if (kind === 'witch') kind = 'zombie';
    this.spawn(y < 30 && Math.random() < 0.15 ? 'slime' : kind, x + 0.5, y, z + 0.5);
  }

  /** Spawner cages in dungeons and mineshafts keep producing their monster. */
  _spawners(players) {
    if (this.room.mode !== 'survival') return;
    for (const p of players) {
      for (const s of this.room.world.spawnersNear(p.pos.x, p.pos.z, 20)) {
        if (dist(s, p.pos) > 16 || this.get(s.x, s.y, s.z) !== B.SPAWNER || Math.random() > 0.25) continue;
        let near = 0;
        for (const m of this.mobs.values()) if (m.type === s.mob && dist(m.pos, s) < 9) near++;
        if (near >= 4) continue;
        for (let tries = 0; tries < 4; tries++) {
          const x = s.x + rnd(-3, 3), z = s.z + rnd(-3, 3), y = s.y + rnd(-1, 1);
          if (standable(this.get, x, y, z, MOB_TYPES[s.mob].height) && !IS_LIQUID[this.get(x, y, z)]) { this.spawn(s.mob, x + 0.5, y, z + 0.5); break; }
        }
      }
    }
  }

  /** Keep a few villagers (and one iron golem) in any village near this player. */
  _spawnVillagers(p) {
    const v = this.room.world.gen.villageNear(p.pos.x, p.pos.z, 96);
    if (!v) return;
    let n = 0, golems = 0;
    for (const m of this.mobs.values()) if (m.home && m.home.id === v.id) { if (m.type === 'villager') n++; else if (m.type === 'iron_golem') golems++; }
    const type = n < 5 ? 'villager' : golems < 1 ? 'iron_golem' : null;
    if (!type) return;
    const x = Math.floor(v.x + (Math.random() - 0.5) * 14), z = Math.floor(v.z + (Math.random() - 0.5) * 14);
    const y = this.room.world.surfaceY(x, z);
    if (y < 0 || !IS_SOLID[this.room.world.getBlock(x, y, z)] || IS_LIQUID[this.room.world.getBlock(x, y, z)]) return;
    const m = this.spawn(type, x + 0.5, y + 1, z + 0.5, v);
    if (type === 'villager') m.profession = Math.floor(Math.random() * PROFESSIONS.length);
  }

  // ---- Helpers -----------------------------------------------------------------------------------
  _targetPlayer(m) { return m.angryAt ? this.room.players.get(m.angryAt) : null; }

  _teleport(m, toward) {
    for (let tries = 0; tries < 10; tries++) {
      const c = toward ? toward.pos : m.pos;
      const spot = randomSpot(this.get, c.x, c.y, c.z, toward ? 6 : 16, this._h(m));
      if (spot && !IS_LIQUID[this.get(Math.floor(spot.x), Math.floor(spot.y), Math.floor(spot.z))]) {
        this.room.broadcast({ t: 'poof', kind: 'teleport', x: m.pos.x, y: m.pos.y + 1, z: m.pos.z });
        m.pos = { ...spot }; m.vel = { x: 0, y: 0, z: 0 }; m.path = null;
        return;
      }
    }
  }

  _teleportNear(m, pos) {
    const spot = randomSpot(this.get, pos.x, pos.y, pos.z, 2, this._h(m));
    if (spot) { m.pos = { ...spot }; m.vel = { x: 0, y: 0, z: 0 }; m.path = null; m.goal = null; }
  }

  _canSee(m, p) {
    const steps = Math.ceil(dist(p.pos, m.pos) * 2);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = m.pos.x + (p.pos.x - m.pos.x) * t, y = m.pos.y + 1.6 + (p.pos.y + 1.5 - m.pos.y - 1.6) * t, z = m.pos.z + (p.pos.z - m.pos.z) * t;
      if (IS_SOLID[this.get(Math.floor(x), Math.floor(y), Math.floor(z))]) return false;
    }
    return true;
  }

  _skyAbove(m) {
    const x = Math.floor(m.pos.x), z = Math.floor(m.pos.z);
    for (let y = Math.floor(m.pos.y + 2); y < CHUNK_HEIGHT; y++) {
      const id = this.get(x, y, z);
      if (id !== 0 && !BLOCKS[id]?.transparent) return false;
    }
    return true;
  }

  // Set horizontal velocity toward the facing direction.
  _steer(m, speed, dt) {
    if (m.knockTimer > 0) { m.knockTimer -= dt; return; }
    const k = 1 - Math.exp(-dt * 8);
    m.vel.x += (Math.sin(m.yaw) * speed - m.vel.x) * k;
    m.vel.z += (Math.cos(m.yaw) * speed - m.vel.z) * k;
  }

  _physics(m, dt) {
    const get = this.get;
    const w = this._w(m), h = this._h(m);
    if (m.def.flies) {
      m.vel.y -= 1.5 * dt; // barely any gravity
    } else {
      const water = liquidLevel(m.pos, h, get);
      if (m.def.swims && water > 0) m.vel.y *= Math.exp(-dt * 2);
      else if (water > 0) m.vel.y += (2 - m.vel.y) * Math.min(1, dt * 3); // float upward
      else {
        m.vel.y -= PHYSICS.gravity * dt;
        if ((m.type === 'chicken' || m.type === 'cat') && m.vel.y < -4) m.vel.y = -4; // chickens flap, cats land softly
      }
    }
    if (m.def.ghost) {
      m.pos.x += m.vel.x * dt; m.pos.y += m.vel.y * dt; m.pos.z += m.vel.z * dt;
      m.vel.y += 1.5 * dt;
      return;
    }
    const res = moveEntity(m.pos, m.vel, dt, Math.min(w, 0.98), h, get, m.onGround);
    m.onGround = res.onGround;
    m.hitWall = res.hitWall;
    // Hop up one-block steps when walking into a wall (not while being knocked back).
    if (res.hitWall && m.onGround && !m.def.flies && !(m.knockTimer > 0)) m.vel.y = 7.5;
    // rabbits and slimes bounce instead of walking
    if (m.def.hops && m.onGround && Math.hypot(m.vel.x, m.vel.z) > 0.5) m.vel.y = m.type === 'slime' ? 5 + m.size : 5;
  }

  /** Apply damage; returns true if the mob died. `by` is the attacking mob, if any. */
  damage(m, amount, attacker, by = null, playerId = null) {
    m.health -= amount;
    m.hurtTimer = 0.4;
    if (attacker) {
      const dx = m.pos.x - attacker.x, dz = m.pos.z - attacker.z;
      const len = Math.hypot(dx, dz) || 1;
      const kb = m.type === 'iron_golem' || m.type === 'elder_guardian' ? 0.2 : 1;
      m.vel.x = (dx / len) * 9 * kb; m.vel.z = (dz / len) * 9 * kb; m.vel.y = 6 * kb;
      m.knockTimer = 0.45;
      m.sitting = false;
      if (by && by !== m) m.huntMob = m.def.hostile || m.def.neutral || m.def.golem ? by.id : null;
      if (playerId) { m.angry = 30; m.angryAt = playerId; }
      if ((m.def.passive || m.def.villager) && !m.def.neutral) { m.panic = 5; m.fleeFrom = { ...attacker }; m.goal = null; }
      if (m.def.teleports && Math.random() < 0.6) this._teleport(m, playerId ? this.room.players.get(playerId) : null);
      // a hurt wolf calls its pack
      if (m.type === 'wolf' && !m.tamed && playerId) for (const o of this.mobs.values()) if (o.type === 'wolf' && !o.tamed && dist(o.pos, m.pos) < 16) { o.angry = 30; o.angryAt = playerId; }
      // polar bears defend their cubs
      if (m.type === 'polar_bear' && m.age < 0 && playerId) for (const o of this.mobs.values()) if (o.type === 'polar_bear' && o.age >= 0 && dist(o.pos, m.pos) < 16) { o.angry = 30; o.angryAt = playerId; }
      // a hurt silverfish wakes the others hiding in the stone around it
      if (m.type === 'silverfish') this.wakeSilverfish(m.pos.x, m.pos.y, m.pos.z, 4);
      // guardians' spikes hurt whoever hits them up close
      if (m.def.beam && playerId && Math.random() < 0.5) { const p = this.room.players.get(playerId); if (p && dist(p.pos, m.pos) < 4) this.room.hurtPlayer(p, 2, m.pos, 'was spiked by a guardian'); }
    }
    if (m.health <= 0) {
      this.mobs.delete(m.id);
      if (m.home && m.home.slot >= 0) { this.kills.add(`${m.home.id}:${m.home.slot}`); this.room.dirty = true; }
      // a zombie that kills a villager may turn it into a zombie villager
      if (m.def.villager && by && by.def.zombie && Math.random() < 0.5) this.spawn('zombie_villager', m.pos.x, m.pos.y, m.pos.z);
      // a Rumbler shot by a skeleton drops a music disc
      if (m.type === 'rumbler' && by && by.def.archer && this.room.mode === 'survival') {
        this.room.spawnItem({ id: itemId(DISCS[rnd(0, DISCS.length - 1)]), count: 1 }, m.pos.x, m.pos.y + 0.5, m.pos.z);
      }
      if (m.leash) this._unleash(m, true);
      if (m.rider) this._buck(m);
      if (this.room.mode === 'survival' && m.age >= 0) {
        for (const [name, count] of m.def.drops(m)) if (count > 0) this.room.spawnItem({ id: itemId(name), count }, m.pos.x, m.pos.y + 0.5, m.pos.z);
        if (m.saddled) this.room.spawnItem({ id: itemId('saddle'), count: 1 }, m.pos.x, m.pos.y + 0.5, m.pos.z);
      }
      // big slimes split into smaller ones
      if (m.type === 'slime' && m.size > 1) for (let i = 0; i < rnd(2, 4); i++) this.spawn('slime', m.pos.x + (Math.random() - 0.5), m.pos.y + 0.3, m.pos.z + (Math.random() - 0.5), null, { size: m.size / 2 });
      if (m.persistent || m.tamed || m.name) this.room.dirty = true;
      return true;
    }
    return false;
  }

  /** A player hit a mob: their tamed wolves join in. */
  ownerAttacked(p, target) {
    if (target.tamed && target.owner === p.name) return;
    for (const m of this.mobs.values()) if (m.type === 'wolf' && m.tamed && m.owner === p.name && !m.sitting && dist(m.pos, p.pos) < 20) m.huntMob = target.id;
  }
  _ownerHurt(p, attacker) {
    for (const m of this.mobs.values()) if (m.type === 'wolf' && m.tamed && m.owner === p.name && !m.sitting && dist(m.pos, p.pos) < 20) m.huntMob = attacker.id;
  }

  /** The player looked a Shade in the eye. */
  stare(p, msg) {
    const m = this.mobs.get(msg.mob);
    if (m && m.type === 'shade' && dist(m.pos, p.pos) < 64 && this.room.mode === 'survival') { m.angry = 40; m.angryAt = p.id; }
  }

  /** Silverfish burst out of infested stone near (x, y, z). */
  wakeSilverfish(x, y, z, r) {
    if (!B.INFESTED_STONE) return;
    let n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const bx = Math.floor(x) + dx, by = Math.floor(y) + dy, bz = Math.floor(z) + dz;
      if (this.get(bx, by, bz) !== B.INFESTED_STONE || n >= 6 || Math.random() < 0.5) continue;
      this.room.setBlock(bx, by, bz, 0);
      this.spawn('silverfish', bx + 0.5, by, bz + 0.5);
      n++;
    }
  }

  /** A pumpkin was just placed at (x, y, z): did that finish a snow golem or an iron golem? */
  checkGolem(x, y, z) {
    const get = this.get;
    const set = (bx, by, bz) => this.room.setBlock(bx, by, bz, 0);
    if (get(x, y - 1, z) === B.SNOW && get(x, y - 2, z) === B.SNOW) {
      set(x, y, z); set(x, y - 1, z); set(x, y - 2, z);
      const m = this.spawn('snow_golem', x + 0.5, y - 2, z + 0.5); m.persistent = true;
      this.room.broadcast({ t: 'poof', kind: 'snow', x: x + 0.5, y, z: z + 0.5 });
      return true;
    }
    if (get(x, y - 1, z) !== B.IRON_BLOCK || get(x, y - 2, z) !== B.IRON_BLOCK) return false;
    for (const [ax, az] of [[1, 0], [0, 1]]) {
      if (get(x + ax, y - 1, z + az) === B.IRON_BLOCK && get(x - ax, y - 1, z - az) === B.IRON_BLOCK) {
        for (const [bx, by, bz] of [[x, y, z], [x, y - 1, z], [x, y - 2, z], [x + ax, y - 1, z + az], [x - ax, y - 1, z - az]]) set(bx, by, bz);
        const m = this.spawn('iron_golem', x + 0.5, y - 2, z + 0.5); m.persistent = true;
        this.room.broadcast({ t: 'poof', kind: 'smoke', x: x + 0.5, y, z: z + 0.5 });
        return true;
      }
    }
    return false;
  }

  // ---- Leads ----------------------------------------------------------------------------------
  _unleash(m, dropLead) {
    if (dropLead && this.room.mode === 'survival') this.room.spawnItem({ id: itemId('lead'), count: 1 }, m.pos.x, m.pos.y + 0.5, m.pos.z);
    m.leash = null;
    this.room.dirty = true;
  }

  /** Right-click on a fence holding a lead: tie every mob you lead to it. Returns true if any. */
  tieToFence(p, x, y, z) {
    let any = false;
    for (const m of this.mobs.values()) {
      if (m.leash && m.leash.player === p.id && dist(m.pos, p.pos) < 12) { m.leash = { fence: [x, y, z] }; m.persistent = true; any = true; }
    }
    if (!any) {
      // or untie everything tied to this post
      for (const m of this.mobs.values()) if (m.leash && m.leash.fence && m.leash.fence[0] === x && m.leash.fence[1] === y && m.leash.fence[2] === z) { m.leash = { player: p.id }; any = true; }
    }
    if (any) this.room.dirty = true;
    return any;
  }

  /** Someone broke a fence: anything tied to it is let go. */
  fenceBroken(x, y, z) {
    for (const m of this.mobs.values()) if (m.leash && m.leash.fence && m.leash.fence[0] === x && m.leash.fence[1] === y && m.leash.fence[2] === z) this._unleash(m, true);
  }

  // ---- Right-click on a mob ----------------------------------------------------------------------
  use(p, msg) {
    const m = this.mobs.get(msg.mob);
    if (!m || !p.alive) return;
    if (dist(m.pos, p.pos) > REACH + SERVER_REACH_SLACK + 1.5) return;
    const held = ITEMS[msg.held];
    const name = held ? held.name : '';
    const consume = () => this.room.send(p, { t: 'consumeHeld' });
    const hearts = () => this.room.broadcast({ t: 'hearts', x: m.pos.x, y: m.pos.y + this._h(m), z: m.pos.z });
    const smoke = () => this.room.broadcast({ t: 'poof', kind: 'smoke', x: m.pos.x, y: m.pos.y + this._h(m), z: m.pos.z });

    if (m.type === 'villager' && !name.startsWith('name_tag') && name !== 'lead') {
      const job = PROFESSIONS[m.profession ?? 0];
      m.goal = null; m.idle = 6; m.panic = 0;
      m.yaw = Math.atan2(p.pos.x - m.pos.x, p.pos.z - m.pos.z);
      this.room.send(p, { t: 'trades', mob: m.id, job, offers: TRADES[job] });
      return;
    }
    // name tags: the client asked for a name
    if (name === 'name_tag' && typeof msg.name === 'string') {
      const n = msg.name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24);
      if (n) { m.name = n; m.persistent = true; consume(); this.room.dirty = true; }
      return;
    }
    // leads
    if (name === 'lead' && !m.leash && !m.def.hostile && !m.def.villager) { m.leash = { player: p.id }; m.persistent = true; consume(); return; }
    if (m.leash && m.leash.player === p.id) { this._unleash(m, true); return; }
    // shearing
    if (m.type === 'sheep' && name === 'shears' && !(m.sheared > 0) && m.age >= 0) {
      m.sheared = 240;
      this.room.spawnItem({ id: itemId(WOOL[m.variant] || 'white_wool'), count: rnd(1, 3) }, m.pos.x, m.pos.y + 0.8, m.pos.z);
      return;
    }
    // mooshrooms: shears turn them into a cow and five mushrooms, a bowl gets you stew
    if (m.type === 'mooshroom' && m.age >= 0) {
      if (name === 'shears') {
        this.mobs.delete(m.id);
        const cow = this.spawn('cow', m.pos.x, m.pos.y, m.pos.z); cow.yaw = m.yaw;
        this.room.spawnItem({ id: itemId('red_mushroom'), count: 5 }, m.pos.x, m.pos.y + 1, m.pos.z);
        this.room.broadcast({ t: 'poof', kind: 'smoke', x: m.pos.x, y: m.pos.y + 1, z: m.pos.z });
        return;
      }
      if (name === 'bowl') { this.room.send(p, { t: 'consumeHeld', give: 'mushroom_stew' }); return; }
    }
    // taming
    if (m.def.tame && !m.tamed && m.def.tame.includes(name)) {
      consume();
      if (Math.random() < 1 / 3) {
        m.tamed = true; m.owner = p.name; m.persistent = true; m.angry = 0; m.panic = 0;
        if (m.def.tamedHealth) m.maxHealth = m.health = m.def.tamedHealth;
        m.sitting = m.type !== 'parrot';
        hearts();
        this.room.dirty = true;
      } else smoke();
      return;
    }
    // breeding (and helping babies grow)
    const food = m.def.food;
    if (food && food.includes(name) && (!m.def.tame || m.tamed) && (!m.def.horse || m.tamed)) {
      if (m.age < 0) { m.age += 30; consume(); return; }
      if (m.breedCooldown <= 0 && !(m.love > 0)) { m.love = 30; consume(); hearts(); }
      return;
    }
    // horses, donkeys, mules and llamas: treats calm a wild one, saddles go on tamed ones, empty hand to ride
    if (m.def.horse) {
      if (m.def.treats.includes(name)) { m.temper = (m.temper || 0) + 10; consume(); if (m.tamed && m.health < m.maxHealth) m.health = Math.min(m.maxHealth, m.health + 2); return; }
      if (name === 'saddle' && m.tamed && !m.saddled && m.age >= 0 && !m.def.noSaddle) { m.saddled = true; consume(); this.room.dirty = true; return; }
      if (m.age >= 0 && !m.rider) return this._mountHorse(p, m);
      return;
    }
    // sit / stand
    if (m.tamed && m.owner === p.name && (m.type === 'wolf' || m.type === 'cat')) { m.sitting = !m.sitting; m.goal = null; m.path = null; }
  }

  // ---- Riding horses ----------------------------------------------------------------------------
  _mountHorse(p, m) {
    if (p.riding) return;
    m.rider = p.id;
    m.rideTime = 0;
    p.riding = { type: 'mob', id: m.id };
    // `steer`: a tamed, saddled horse goes where you tell it; otherwise you just hang on
    this.room.send(p, { t: 'mounted', type: 'mob', id: m.id, kind: m.type, steer: m.tamed && m.saddled, pos: [m.pos.x, m.pos.y, m.pos.z], yaw: m.yaw, h: this._h(m) });
  }

  /** A wild horse being broken in: it rears and throws you off until it trusts you. */
  _ridden(m, dt) {
    const p = this.room.players.get(m.rider);
    if (!p || !p.alive || !p.riding || p.riding.id !== m.id) { m.rider = null; return; }
    if (m.tamed) return;
    m.rideTime += dt;
    if (m.rideTime > 1.5) {
      m.rideTime = 0;
      if (Math.random() * 100 < 15 + (m.temper || 0)) {
        m.tamed = true; m.owner = p.name; m.persistent = true;
        this.room.broadcast({ t: 'hearts', x: m.pos.x, y: m.pos.y + 1.6, z: m.pos.z });
        const kind = m.type.replace('_', ' ');
        this.room.send(p, { t: 'chat', sys: true, text: m.def.noSaddle ? `The ${kind} trusts you now! Lead it around with a lead.` : `The ${kind} trusts you now! Put a saddle on it to ride it properly.` });
        this.room.dirty = true;
      } else if (Math.random() < 0.5) {
        m.temper = (m.temper || 0) + 5;
        this._buck(m);
      }
    }
  }

  _buck(m, rear = true) {
    const p = this.room.players.get(m.rider);
    m.rider = null;
    if (!p) return;
    p.riding = null;
    p.moveCredit = 6;
    this.room.send(p, { t: 'bucked', rear });
    if (rear) this.room.broadcast({ t: 'poof', kind: 'smoke', x: m.pos.x, y: m.pos.y + 1.6, z: m.pos.z });
  }

  /** The rider steers a tamed, saddled horse: they report where it is. */
  rideMove(p, msg) {
    const m = p.riding && p.riding.type === 'mob' ? this.mobs.get(p.riding.id) : null;
    if (!m || m.rider !== p.id || !m.tamed || !m.saddled || !Array.isArray(msg.p) || !msg.p.every(Number.isFinite)) return;
    const [x, y, z] = msg.p;
    if (Math.hypot(x - m.pos.x, y - m.pos.y, z - m.pos.z) > 6) return;
    m.pos = { x, y, z };
    if (Number.isFinite(msg.yaw)) m.yaw = msg.yaw;
  }

  unride(p) {
    const m = p.riding && p.riding.type === 'mob' ? this.mobs.get(p.riding.id) : null;
    if (m && m.rider === p.id) m.rider = null;
    p.riding = null;
    p.moveCredit = 6;
  }

  // ---- Network and saving ------------------------------------------------------------------------
  snapshot() {
    const out = [];
    for (const m of this.mobs.values()) {
      // flags: 1 hurt, 2 fuse lit, 4-16 villager job, 32 baby, 64 in love, 128 tamed, 256 sitting, 512 saddled, 1024 angry, 2048 sheared
      const flags = (m.hurtTimer > 0 ? 1 : 0) | (m.fuse > 0 ? 2 : 0) | (((m.profession ?? 0) & 7) << 2) | (m.age < 0 ? 32 : 0) | (m.love > 0 ? 64 : 0)
        | (m.tamed ? 128 : 0) | (m.sitting ? 256 : 0) | (m.saddled ? 512 : 0) | (m.angry > 0 || m.huntMob ? 1024 : 0) | (m.sheared > 0 ? 2048 : 0);
      const leash = m.leash ? (m.leash.fence || m.leash.player) : 0;
      out.push([m.id, m.def.index, r2(m.pos.x), r2(m.pos.y), r2(m.pos.z), r2(m.yaw), flags, m.name || 0, leash, m.type === 'slime' ? m.size : m.variant]);
    }
    return out;
  }

  serialize() {
    const out = [];
    for (const m of this.mobs.values()) {
      if (!(m.persistent || m.tamed || m.name)) continue;
      out.push({ type: m.type, pos: { x: r2(m.pos.x), y: r2(m.pos.y), z: r2(m.pos.z) }, name: m.name, owner: m.owner, tamed: m.tamed, saddled: m.saddled,
        sitting: m.sitting, age: Math.round(m.age), variant: m.variant, profession: m.profession, health: m.health,
        fence: m.leash && m.leash.fence ? m.leash.fence : null, size: m.size });
    }
    return out;
  }
}

export { BY_INDEX };
function r2(v) { return Math.round(v * 100) / 100; }
