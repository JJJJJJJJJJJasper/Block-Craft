// ============================================================================
// Entry point: shows the main menu, then connects to the server and starts a
// Game once the server has welcomed us into a world.
// ============================================================================
import { buildTextures } from './rendering/textures.js';
import { Renderer } from './rendering/renderer.js';
import { Network } from './net/network.js';
import { Game } from './engine/game.js';
import { Menus } from './ui/menu.js';
import { loadSettings, saveSettings, bindSettingsUI } from './ui/settings.js';
import { sfx } from './audio/sfx.js';
import { BIOME_NAMES } from '../shared/biomes.js';

const settings = loadSettings();
let game = null;
let busy = false;

// A per-tab token lets the server recognise us when we reconnect.
let token = sessionStorage.getItem('blockcraft-token');
if (!token) {
  token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  sessionStorage.setItem('blockcraft-token', token);
}

const menus = new Menus(settings, {
  onCreate: (o) => start({ create: true, name: o.name, seed: o.seed, mode: o.mode, room: o.code }),
  onJoin: (o) => start({ create: false, name: o.name, room: o.code }),
  onResume: () => game && game.resume(),
  onLeave: () => { location.href = location.pathname; },
  onHost: (action, value) => game && game.net.send({ t: 'host', action, value }),
  onRespawn: () => game && game.respawn(),
});
menus.showMain();

bindSettingsUI(settings, (s) => { if (game) game.applySettings(s); });

// Check WebGL2 support early (needed for the texture array).
if (!document.createElement('canvas').getContext('webgl2')) {
  menus.showError('Your browser does not support WebGL 2, which this game needs. Try the latest Chrome, and make sure hardware acceleration is on (chrome://settings/system).');
}

async function start(join) {
  if (busy) return;
  busy = true;
  menus.setBusy(true);
  sfx.unlock(); // we're inside a click handler, so audio is allowed to start
  settings.name = join.name;
  saveSettings(settings);
  menus.showLoading(join.create ? 'Creating world...' : `Joining world ${join.room}...`);

  const net = new Network();
  let welcome;
  try {
    welcome = await net.connect({ ...join, token });
  } catch (e) {
    busy = false;
    menus.setBusy(false);
    const msg = e.message || String(e);
    if (msg.startsWith('NOTFOUND:')) menus.showError(msg.slice(9), join.room);
    else menus.showError(msg);
    return;
  }

  menus.setLoading(0.05, 'Painting textures...');
  await new Promise(r => setTimeout(r, 0)); // let the loading screen draw
  const textures = buildTextures();
  const renderer = new Renderer(document.getElementById('game'), textures);
  game = new Game({ renderer, net, textures, settings, menus, sfx, welcome });
  window.__game = game; // handy for debugging in the browser console
  window.__BIOME_NAMES = BIOME_NAMES;
}
