// ============================================================================
// Game: one play session in one world. Owns the frame loop and connects the
// pieces: input -> player physics -> camera -> block interaction -> network,
// and network messages -> world / entities / HUD.
// ============================================================================
import {
  REACH, CLIENT_SEND_RATE, DAY_TICKS, DAY_LENGTH_SECONDS, MAX_HEALTH, MAX_HUNGER,
  PHYSICS, MIN_RENDER_DISTANCE, CHUNK_SIZE,
} from '../../shared/config.js';
import { BLOCKS, B, IS_SOLID, IS_LIQUID, needsSupport } from '../../shared/blocks.js';
import { ITEMS, ITEM_BY_NAME, breakTime } from '../../shared/items.js';
import { raycastBlocks } from '../../shared/raycast.js';
import { boxIntersectsBlock } from '../../shared/physics.js';
import { createGenerator, BIOME_NAMES } from '../../shared/terrain.js';
import { ClientWorld } from '../world/world.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { Entities } from '../rendering/entities.js';
import { Inventory, InventoryUI, isPlaceable, itemName, ARMOR_SLOT } from '../ui/inventory.js';
import { Hud } from '../ui/hud.js';
import { Chat } from '../ui/chat.js';

const TICKS_PER_SECOND = DAY_TICKS / DAY_LENGTH_SECONDS;

const CREATIVE_KIT = ['grass', 'dirt', 'stone', 'cobblestone', 'planks', 'log', 'glass', 'torch', 'bricks'];

export class Game {
  constructor({ renderer, net, textures, settings, menus, sfx, welcome }) {
    this.renderer = renderer;
    this.net = net;
    this.textures = textures;
    this.settings = settings;
    this.menus = menus;
    this.sfx = sfx;

    this.myId = welcome.id;
    this.playerName = welcome.you.name || settings.name || 'Player';
    this.room = welcome.room;
    this.mode = welcome.mode;
    this.hostId = welcome.host;
    this.setTime(welcome.time);
    this.playerList = welcome.players;
    this.gen = createGenerator(welcome.seed); // only used to show the biome name in F3

    this.world = new ClientWorld(renderer, welcome.seed, textures.faceLayers, (list) => net.send({ t: 'reqChunks', list }));
    this.player = new Player();
    this.player.pos = { ...welcome.you.pos };
    this.player.health = welcome.you.health ?? MAX_HEALTH;
    this.player.hunger = welcome.you.hunger ?? MAX_HUNGER;

    this.inv = new Inventory();
    if (welcome.you.inv) this.inv.load(welcome.you.inv);
    else if (this.mode === 'creative') CREATIVE_KIT.forEach((n, i) => { this.inv.slots[i] = { id: ITEM_BY_NAME[n].id, count: 64, dmg: 0 }; });

    this.input = new Input(renderer.renderer.domElement);
    this.entities = new Entities(renderer.scene, textures.icons, sfx);
    this.entities.myId = this.myId;
    for (const it of welcome.items || []) this.entities.addItem(it);

    this.hud = new Hud(textures.icons);
    this.chat = new Chat((text) => net.send({ t: 'chat', text }), (cmd) => this.command(cmd));
    this.chat.onClose = () => this._endUi();
    this.invUI = new InventoryUI(document.getElementById('inventory-screen'), this.inv, {
      iconURL: textures.icons,
      isCreative: () => this.mode === 'creative',
      dropStack: (s) => this.dropStack(s),
      furnacePut: (slot, item) => net.send({ t: 'furnacePut', ...this.furnacePos, slot, item }),
      furnaceTake: (slot) => net.send({ t: 'furnaceTake', ...this.furnacePos, slot }),
      onClose: () => {
        if (this.furnacePos) { net.send({ t: 'furnaceClose' }); this.furnacePos = null; }
        this._endUi();
      },
      click: () => sfx.click(),
      playerName: () => this.playerName,
    });

    this.state = 'loading';
    this.uiLock = null;        // why we deliberately released the mouse: 'inventory' | 'chat' | 'dead'
    this.dead = false;
    this.breaking = null;      // {x,y,z,progress}
    this.breakCooldown = 0;
    this.placeCooldown = 0;
    this.attackCooldown = 0;
    this.hitSoundTimer = 0;
    this.sendTimer = 0;
    this.invSyncTimer = 0;
    this.lastInvSent = -1;
    this.showDebug = settings.showFps;
    this.fps = 0; this.frames = 0; this.fpsTimer = 0;
    this.furnacePos = null;

    this.applySettings(settings);
    this._wireInput();
    this._wireNetwork();
    menus.setRoom(this.room);
    history.replaceState(null, '', `?world=${this.room}`);
    menus.showLoading('Generating terrain...');
    this.chat.add(`Welcome to world ${this.room}! Share the invite link from the pause menu (Esc).`, null, true);

    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  applySettings(s) {
    this.world.renderDistance = Math.max(MIN_RENDER_DISTANCE, s.renderDistance);
    this.renderer.setRenderDistance(this.world.renderDistance);
    this.renderer.setFov(s.fov);
    this.renderer.renderer.setPixelRatio(s.hidpi ? Math.min(2, window.devicePixelRatio || 1) : 1);
    this.input.sensitivity = s.sensitivity;
    this.sfx.setVolume(s.volume);
    this.showDebug = s.showFps;
  }

  setTime(t) { this.time = t; this.timeSync = performance.now(); }
  get worldTime() { return (this.time + ((performance.now() - this.timeSync) / 1000) * TICKS_PER_SECOND) % DAY_TICKS; }

  get isHost() { return this.hostId === this.myId; }

  // ---- Input wiring ------------------------------------------------------------
  _wireInput() {
    const input = this.input;
    input.onLockChange = (locked) => {
      if (locked) { this.menus.hideAll(); return; }
      if (this.state === 'playing' && !this.uiLock && !this.dead) this.pause();
    };
    input.onKey = (e) => {
      if (this.state !== 'playing' || this.dead) return false;
      const code = e.code;
      if (this.invUI.isOpen) {
        if (code === 'KeyE' || code === 'Escape') { this.invUI.close(); return true; }
        return false;
      }
      if (!input.locked) return false;
      if (code === 'KeyE') { this.openInventory('inventory'); return true; }
      if (code === 'KeyT') { this.openChat(''); return true; }
      if (code === 'Slash') { this.openChat('/'); return true; }
      if (code === 'F3' || code === 'Backquote') {
        this.showDebug = !this.showDebug;
        this.settings.showFps = this.showDebug;
        document.getElementById('fps-input').checked = this.showDebug;
        return true;
      }
      if (code === 'KeyM') { this.hud.toast(this.sfx.toggleMute() ? 'Sound muted (M)' : 'Sound on'); return true; }
      if (code === 'KeyQ') { this.dropHeld(); return true; }
      if (/^Digit[1-9]$/.test(code)) { this.inv.selected = Number(code.slice(5)) - 1; return true; }
      return false;
    };
  }

  pause() {
    this.menus.updateHost(this.isHost, this.playerList, this.myId, this.hostId, this.mode);
    this.menus.showPause('game');
  }

  resume() {
    this.sfx.unlock();
    this.input.requestLock();
  }

  _beginUi(reason) {
    this.uiLock = reason;
    this.input.enabled = false;
    this.input.releaseAll();
    this.input.exitLock();
  }

  _endUi() {
    this.uiLock = null;
    this.input.enabled = true;
    if (!this.dead) this.input.requestLock();
  }

  openInventory(kind, data) {
    this._beginUi('inventory');
    this.invUI.open(kind, data);
  }

  openChat(prefix) {
    this._beginUi('chat');
    this.chat.open(prefix);
  }

  // ---- Network wiring --------------------------------------------------------------
  _wireNetwork() {
    const net = this.net;
    const names = () => new Map(this.playerList.map(p => [p.id, p.name]));
    net.on('snap', (m) => this.entities.applySnapshot(m, this._names || (this._names = names())));
    net.on('players', (m) => {
      this.playerList = m.list;
      this.hostId = m.host;
      this._names = names();
      for (const id of [...this.entities.players.keys()]) if (!this._names.has(id)) this.entities.removePlayer(id);
      for (const p of m.list) this.entities.setPlayerName(p.id, p.name);
      if (this.menus.pauseVisible) this.menus.updateHost(this.isHost, this.playerList, this.myId, this.hostId, this.mode);
    });
    net.on('chunks', (m) => { for (const [cx, cz, edits] of m.list) this.world.applyChunkEdits(cx, cz, edits); });
    net.on('block', (m) => {
      const old = this.world.getBlock(m.x, m.y, m.z);
      if (old === m.id) return;
      this.world.setBlock(m.x, m.y, m.z, m.id, true);
      // Sounds for other players' edits, quieter with distance.
      const d = Math.hypot(m.x - this.player.pos.x, m.y - this.player.pos.y, m.z - this.player.pos.z);
      if (d > 2 && old !== B.FURNACE && old !== B.LIT_FURNACE) {
        if (m.id === 0) this.sfx.break(BLOCKS[old]?.sound, d); else this.sfx.place(BLOCKS[m.id]?.sound, d);
      }
    });
    net.on('chat', (m) => this.chat.add(m.text, m.from, m.sys));
    net.on('mode', (m) => {
      this.mode = m.mode;
      if (m.mode !== 'creative') this.player.flying = false;
      this.hud.toast(`Game mode: ${m.mode}`);
      if (this.menus.pauseVisible) this.menus.updateHost(this.isHost, this.playerList, this.myId, this.hostId, this.mode);
    });
    net.on('time', (m) => this.setTime(m.time));
    net.on('items', (m) => {
      for (const it of m.add || []) this.entities.addItem(it);
      for (const id of m.remove || []) this.entities.removeItem(id);
    });
    net.on('pickup', (m) => {
      const left = this.inv.add(m.item);
      if (left > 0) net.send({ t: 'drop', item: { ...m.item, count: left }, dir: [0, 0, 0], gentle: true });
      this.sfx.pickup();
      if (this.invUI.isOpen) this.invUI.render();
    });
    net.on('hurt', (m) => this.hurt(m.amount, m.from, 'was slain by a zombie'));
    net.on('teleport', (m) => {
      this.player.pos = { x: m.p[0], y: m.p[1], z: m.p[2] };
      this.player.vel = { x: 0, y: 0, z: 0 };
      this.player.fallStartY = null;
      if (m.respawn) {
        this.dead = false;
        this.player.dead = false;
        this.player.health = MAX_HEALTH;
        this.player.hunger = MAX_HUNGER;
        this.player.saturation = 5;
        this.uiLock = null;
        this.input.enabled = true;
        this.menus.hideAll();
      }
    });
    net.on('furnace', (m) => {
      if (this.furnacePos && m.x === this.furnacePos.x && m.y === this.furnacePos.y && m.z === this.furnacePos.z) this.invUI.setFurnaceState(m);
    });
    net.on('kicked', (m) => {
      this.state = 'ended';
      this.input.exitLock();
      this.menus.showError(`You were removed from the world: ${m.reason}`);
    });
    net.on('disconnected', () => this.hud.setNetBanner(true));
    net.on('reconnected', (w) => {
      // Resync everything from the server: other players may have edited
      // blocks while we were away, so reload the chunks around us.
      this.hud.setNetBanner(false);
      this.myId = w.id; this.entities.myId = w.id;
      this.mode = w.mode; this.hostId = w.host; this.playerList = w.players; this._names = null;
      this.setTime(w.time);
      this.entities.clear();
      for (const it of w.items || []) this.entities.addItem(it);
      this.world.clear();
      this.chat.add('Reconnected to the server.', null, true);
      net.send({ t: 'pos', p: [this.player.pos.x, this.player.pos.y, this.player.pos.z], r: [this.player.yaw, this.player.pitch] });
    });
  }

  // ---- Commands typed in chat --------------------------------------------------------
  command(text) {
    const [cmd, ...args] = text.slice(1).trim().split(/\s+/);
    const arg = args.join(' ');
    const host = (action, value) => this.net.send({ t: 'host', action, value });
    if (cmd === 'time') {
      const named = { day: 1000, morning: 1000, noon: 6000, sunset: 11500, night: 14000, midnight: 18000 };
      const v = named[arg] ?? Number(arg);
      if (Number.isFinite(v)) host('time', v); else this.chat.add('Usage: /time day|noon|sunset|night|<0-24000>', null, true);
    } else if (cmd === 'mode' || cmd === 'gamemode') {
      if (['survival', 'creative'].includes(arg)) host('mode', arg); else this.chat.add('Usage: /mode survival|creative', null, true);
    } else if (cmd === 'kick') {
      const p = this.playerList.find(q => q.name.toLowerCase() === arg.toLowerCase());
      if (p) host('kick', p.id); else this.chat.add(`No player named ${arg}`, null, true);
    } else {
      this.chat.add('Commands: /time day|noon|sunset|night, /mode survival|creative, /kick <name> (host only)', null, true);
    }
  }

  // ---- Main loop --------------------------------------------------------------------
  frame(now) {
    if (this.state === 'ended') return;
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.frames++; this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) { this.fps = Math.round(this.frames / this.fpsTimer); this.frames = 0; this.fpsTimer = 0; }

    const p = this.player;
    this.world.update(p.pos.x, p.pos.z);

    if (this.state === 'loading') {
      const radius = Math.min(2, this.world.renderDistance);
      const prog = this.world.loadProgress(radius);
      this.menus.setLoading(prog, `${this.world.stats.chunksLoaded} chunks generated, ${this.world.stats.meshed} meshed`);
      if (prog >= 1 && this.world.isReadyAt(p.pos.x, p.pos.z)) {
        this.state = 'playing';
        this.hud.show(true);
        if (!this.input.locked) this.pause();
        else this.menus.hideAll();
      }
    } else if (this.state === 'playing') {
      this._play(dt);
    }

    this._updateCamera();
    this.entities.listener = p.pos;
    this.entities.update(dt, (x, y, z) => this.world.getBlock(x, y, z));
    const eyeBlock = this.world.getBlock(Math.floor(p.pos.x), Math.floor(p.eye.y), Math.floor(p.pos.z));
    this.renderer.updateEnvironment(this.worldTime / DAY_TICKS, eyeBlock === B.LAVA ? 'lava' : IS_LIQUID[eyeBlock] ? 'water' : null);
    this.hud.update(dt, this.inv, p, this.mode);
    this.hud.showPlayerList(this.input.locked && this.input.down('Tab'), this.playerList, this.hostId, this.net.ping);
    if (this.showDebug) this.hud.setDebug(true, this._debugText());
    else this.hud.setDebug(false);
    this.renderer.render();
    this.input.endFrame();
  }

  _play(dt) {
    const p = this.player, input = this.input;
    const active = input.locked && !this.dead;

    // ---- Look ----
    if (active) {
      const k = 0.0022 * input.sensitivity;
      p.yaw -= input.mouse.dx * k;
      p.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, p.pitch - input.mouse.dy * k));
      if (input.mouse.wheel) this.inv.selected = (this.inv.selected + input.mouse.wheel + 9) % 9;
      if (input.wasDoubleTapped('Space') && this.mode === 'creative') {
        p.flying = !p.flying;
        p.vel.y = 0;
        this.hud.toast(p.flying ? 'Flying (double-tap Space to stop)' : 'Flying off', 1.2);
      }
    }

    // ---- Move ----
    const ctl = {
      forward: active ? (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) - (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0) : 0,
      right: active ? (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0) : 0,
      jump: active && input.down('Space'),
      // Shift: sneak on the ground, descend while flying.
      down: active && p.flying && (input.down('ShiftLeft') || input.down('ShiftRight')),
      sneak: active && !p.flying && (input.down('ShiftLeft') || input.down('ShiftRight')),
      // Double-tap W to sprint; keep sprinting while W stays held.
      sprint: active && (input.wasDoubleTapped('KeyW') || (p.sprinting && input.down('KeyW'))),
    };
    // Don't simulate until the ground under us has loaded (otherwise we'd fall through).
    if (this.world.isReadyAt(p.pos.x, p.pos.z)) {
      const getBlock = (x, y, z) => this.world.getBlock(x, y, z);
      const events = {
        onFallDamage: (n) => this.damage(n, 'fell from a high place'),
        onDamage: (n, why) => this.damage(n, why === 'drowning' ? 'drowned' : why === 'lava' ? 'tried to swim in lava' : 'starved'),
        onStep: (id) => this.sfx.step(BLOCKS[id]?.sound),
      };
      const wasInWater = p.inWater > 0;
      // Fixed-size sub-steps keep physics stable on slow frames.
      const steps = Math.ceil(dt / (1 / 60));
      for (let i = 0; i < steps; i++) p.update(dt / steps, ctl, getBlock, this.mode, events);
      if (!wasInWater && p.inWater > 0 && p.vel.y < -4) this.sfx.splash();
    }

    // ---- Send position ~20x per second ----
    this.sendTimer += dt;
    if (this.sendTimer >= 1 / CLIENT_SEND_RATE) {
      this.sendTimer = 0;
      this.net.send({ t: 'pos', p: [r3(p.pos.x), r3(p.pos.y), r3(p.pos.z)], r: [r3(p.yaw), r3(p.pitch)], f: p.flying ? 1 : 0, m: p.moving ? 1 : 0, s: p.sneaking ? 1 : 0 });
    }
    // ---- Save inventory/health on the server every few seconds ----
    this.invSyncTimer += dt;
    if (this.invSyncTimer > 3) {
      this.invSyncTimer = 0;
      const sig = this.inv.version * 1000 + p.health * 31 + p.hunger;
      if (sig !== this.lastInvSent) {
        this.lastInvSent = sig;
        this.net.send({ t: 'inv', slots: this.inv.slots, health: p.health, hunger: p.hunger });
      }
    }

    if (active) this._interact(dt);
    else { this.renderer.setHighlight(null); this.renderer.setCrack(null, 0); this.breaking = null; }
  }

  _updateCamera() {
    const cam = this.renderer.camera, p = this.player;
    cam.position.set(p.pos.x, p.pos.y + PHYSICS.eyeHeight + p.eyeOffset, p.pos.z);
    // Sprinting widens the view a little for a sense of speed.
    const fov = this.settings.fov * (p.sprinting ? 1.1 : 1);
    if (Math.abs(cam.fov - fov) > 0.05) this.renderer.setFov(cam.fov + (fov - cam.fov) * 0.2);
    cam.rotation.set(p.pitch, p.yaw, 0);
  }

  // ---- Breaking, placing, attacking, using ----------------------------------------------
  _interact(dt) {
    const p = this.player, input = this.input;
    const eye = p.eye, origin = [eye.x, eye.y, eye.z], dir = p.lookDir();
    const hit = raycastBlocks((x, y, z) => this.world.getBlock(x, y, z), origin, dir, REACH);
    const mob = this.entities.raycastMobs(origin, dir, REACH);
    const targetMob = mob && (!hit || mob.dist < hit.dist) ? mob : null;
    this.renderer.setHighlight(targetMob ? null : hit);

    const breakDown = input.mouse.left || input.down('KeyR');
    const breakPressed = input.mouse.leftPressed || input.wasPressed('KeyR');
    const useDown = input.mouse.right || input.down('KeyF');
    const usePressed = input.mouse.rightPressed || input.wasPressed('KeyF');
    this.breakCooldown -= dt; this.placeCooldown -= dt; this.attackCooldown -= dt;

    // Attack a mob.
    if (targetMob) {
      if (breakPressed && this.attackCooldown <= 0) {
        this.attackCooldown = 0.3;
        this.net.send({ t: 'attack', mob: targetMob.id, held: this.inv.heldId });
        if (this.mode === 'survival' && this.inv.held && ITEMS[this.inv.held.id].tool) this._wearTool();
      }
      this.breaking = null;
    } else if (breakDown && hit) {
      // Mine a block (hold the button).
      const def = BLOCKS[hit.id];
      if (!this.breaking || this.breaking.x !== hit.x || this.breaking.y !== hit.y || this.breaking.z !== hit.z) {
        this.breaking = { x: hit.x, y: hit.y, z: hit.z, progress: 0 };
      }
      if (def.hardness >= 0) {
        if (this.mode === 'creative') {
          if (this.breakCooldown <= 0) { this.breakBlock(hit); this.breakCooldown = 0.2; }
        } else if (this.breakCooldown <= 0) {
          this.breaking.progress += dt / breakTime(hit.id, this.inv.heldId);
          this.hitSoundTimer -= dt;
          if (this.hitSoundTimer <= 0) { this.hitSoundTimer = 0.25; this.sfx.hit(def.sound); }
          if (this.breaking.progress >= 1) { this.breakBlock(hit); this.breakCooldown = 0.15; }
        }
      }
    } else {
      this.breaking = null;
      if (!breakDown) this.breakCooldown = 0;
    }
    this.renderer.setCrack(this.breaking, this.breaking ? this.breaking.progress : 0);

    // Use / place.
    if ((usePressed || (useDown && this.placeCooldown <= 0)) && !targetMob) {
      this.placeCooldown = 0.25;
      this.use(hit, usePressed);
    }
    if (!useDown) this.placeCooldown = 0;
  }

  breakBlock(hit) {
    const def = BLOCKS[hit.id];
    this.world.setBlock(hit.x, hit.y, hit.z, 0, true);
    this.net.send({ t: 'break', x: hit.x, y: hit.y, z: hit.z, held: this.inv.heldId });
    this.sfx.break(def.sound);
    this.breaking = null;
    if (this.mode === 'survival' && def.hardness > 0) this._wearTool();
  }

  _wearTool() {
    if (this.inv.damageHeld(1)) { this.hud.toast('Your tool broke!'); this.sfx.break('wood'); }
  }

  use(hit, firstPress) {
    const held = this.inv.held;
    const heldDef = held && ITEMS[held.id];
    // Open crafting tables and furnaces (hold Shift to place a block against them instead).
    const sneak = this.player.sneaking;
    if (hit && firstPress && !sneak && hit.id === B.CRAFTING_TABLE) return this.openInventory('crafting');
    if (hit && firstPress && !sneak && (hit.id === B.FURNACE || hit.id === B.LIT_FURNACE)) {
      this.furnacePos = { x: hit.x, y: hit.y, z: hit.z };
      this.net.send({ t: 'furnaceOpen', ...this.furnacePos });
      return this.openInventory('furnace', { pos: this.furnacePos });
    }
    // Put on armor.
    if (heldDef && heldDef.armor) {
      if (firstPress && this.inv.equipHeld()) this.sfx.place('cloth');
      return;
    }
    // Eat food.
    if (heldDef && heldDef.food) {
      if (firstPress && this.mode === 'survival' && this.player.hunger < MAX_HUNGER) {
        this.player.eat(heldDef.food);
        this.inv.consumeHeld(1);
        this.sfx.eat();
      }
      return;
    }
    // Lily pads go on top of water, which the normal ray passes through.
    if (held && held.id === B.LILY_PAD) {
      const e = this.player.eye;
      const w = raycastBlocks((x, y, z) => this.world.getBlock(x, y, z), [e.x, e.y, e.z], this.player.lookDir(), REACH, (id) => id !== 0);
      if (w && w.id === B.WATER && this.world.getBlock(w.x, w.y + 1, w.z) === 0) {
        this.world.setBlock(w.x, w.y + 1, w.z, held.id, true);
        this.net.send({ t: 'place', x: w.x, y: w.y + 1, z: w.z, id: held.id });
        this.sfx.place('grass');
        if (this.mode === 'survival') this.inv.consumeHeld(1);
      }
      return;
    }
    if (!hit || !held || !isPlaceable(held.id)) return;
    // Place against the face we're looking at (or replace tall grass directly).
    let x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
    if (BLOCKS[hit.id].replaceable) { x = hit.x; y = hit.y; z = hit.z; }
    const cur = BLOCKS[this.world.getBlock(x, y, z)];
    if (y < 0 || y >= 128 || !(cur.id === 0 || cur.liquid || cur.replaceable)) return;
    const def = BLOCKS[held.id];
    if (def.solid) {
      if (boxIntersectsBlock(this.player.pos, PHYSICS.playerWidth, PHYSICS.playerHeight, x, y, z)) return;
      for (const o of this.entities.playerBoxes()) if (boxIntersectsBlock(o, PHYSICS.playerWidth, PHYSICS.playerHeight, x, y, z)) return;
    }
    if (needsSupport(held.id)) {
      const belowId = this.world.getBlock(x, y - 1, z);
      if (held.id === B.LILY_PAD && belowId !== B.WATER) return;
      const below = IS_SOLID[belowId] || held.id === B.LILY_PAD;
      const beside = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => IS_SOLID[this.world.getBlock(x + dx, y, z + dz)]);
      if (!below && !(held.id === B.TORCH && beside)) return;
    }
    this.world.setBlock(x, y, z, held.id, true);
    this.net.send({ t: 'place', x, y, z, id: held.id });
    this.sfx.place(def.sound);
    if (this.mode === 'survival') this.inv.consumeHeld(1);
  }

  // ---- Items ------------------------------------------------------------------------
  dropHeld() {
    const s = this.inv.held;
    if (!s) return;
    this.dropStack({ ...s, count: 1 });
    this.inv.consumeHeld(1);
  }

  dropStack(stack) {
    this.net.send({ t: 'drop', item: stack, dir: this.player.lookDir() });
  }

  // ---- Health -------------------------------------------------------------------------
  damage(amount, cause) {
    if (this.mode !== 'survival' || this.dead || amount <= 0) return;
    this.player.health = Math.max(0, this.player.health - amount);
    this.player.hurtTime = 0.5;
    this.sfx.hurt();
    if (this.player.health <= 0) this.die(cause);
  }

  /** Damage from a mob: knockback, reduced by armor (which wears down). */
  hurt(amount, from, cause) {
    const p = this.player;
    const dx = p.pos.x - from[0], dz = p.pos.z - from[2];
    const len = Math.hypot(dx, dz) || 1;
    p.vel.x += (dx / len) * 7; p.vel.z += (dz / len) * 7; p.vel.y = 5;
    if (this.mode !== 'survival') return;
    // Each armor point blocks 4% of the damage (20 points = 80%).
    const points = Math.min(20, this.inv.armorPoints());
    const reduced = amount * (1 - points / 25);
    for (let i = 0; i < 4; i++) if (this.inv.slots[ARMOR_SLOT + i] && this.inv.damageSlot(ARMOR_SLOT + i, 1)) this.hud.toast('Your armor broke!');
    this.damage(Math.max(0.5, Math.round(reduced * 2) / 2), cause);
  }

  die(cause) {
    this.dead = true;
    this.player.dead = true;
    this.uiLock = 'dead';
    if (this.invUI.isOpen) this.invUI.close();
    this.input.exitLock();
    const items = this.inv.takeAll();
    this.net.send({ t: 'died', items, cause });
    this.menus.showDeath(`${this.settings.name || 'You'} ${cause}.`);
  }

  respawn() {
    this.net.send({ t: 'respawn' });
    this.input.requestLock();
  }

  // ---- Debug overlay ---------------------------------------------------------------------
  _debugText() {
    const p = this.player, r = this.renderer.renderer.info.render;
    const x = Math.floor(p.pos.x), y = Math.floor(p.pos.y), z = Math.floor(p.pos.z);
    const facing = ['north (-Z)', 'west (-X)', 'south (+Z)', 'east (+X)'][((Math.round(p.yaw / (Math.PI / 2)) % 4) + 4) % 4];
    const t = this.worldTime;
    const hours = Math.floor(((t / DAY_TICKS) * 24 + 6) % 24), mins = Math.floor((((t / DAY_TICKS) * 24 + 6) % 1) * 60);
    return [
      `${this.fps} FPS   ping ${this.net.ping} ms`,
      `XYZ ${p.pos.x.toFixed(1)} / ${p.pos.y.toFixed(1)} / ${p.pos.z.toFixed(1)}`,
      `Chunk ${Math.floor(x / CHUNK_SIZE)}, ${Math.floor(z / CHUNK_SIZE)}   facing ${facing}`,
      `Biome ${BIOME_NAMES[this.gen.column(x, z).biome]}`,
      `Chunks ${this.world.loadedCount} loaded, render distance ${this.world.renderDistance}`,
      `Workers busy ${this.world.pool.busy}, queued ${this.world.pool.queued}`,
      `Draw calls ${r.calls}, triangles ${(r.triangles / 1000).toFixed(0)}k`,
      `Time ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}   mode ${this.mode}`,
      `World ${this.room}   players ${this.playerList.length}   mobs ${this.entities.mobs.size}`,
      `Holding ${this.inv.held ? itemName(this.inv.held.id) : 'nothing'}`,
    ].join('\n');
  }
}

function r3(v) { return Math.round(v * 1000) / 1000; }
