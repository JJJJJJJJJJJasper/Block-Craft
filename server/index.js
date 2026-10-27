// ============================================================================
// BlockCraft server entry point. One Node process does everything:
//   - serves the game's web page and JavaScript (from Vite in dev mode, or
//     from the built `dist/` folder in production)
//   - runs the WebSocket game server at /ws
//   - ticks every active room 20 times per second
//   - autosaves worlds to the data folder every 30 seconds
//
//   npm run dev   -> node server/index.js --dev
//   npm start     -> node server/index.js         (run `npm run build` first)
// ============================================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room, TICK_SECONDS } from './room.js';
import { worldExists, loadWorld, DATA_DIR } from './persistence.js';
import { AUTOSAVE_SECONDS, ROOM_IDLE_UNLOAD_SECONDS, GAME_NAME } from '../shared/config.js';
import { isValidRoomCode, randomRoomCode, GAME_MODES } from '../shared/protocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// ---- Rooms ----------------------------------------------------------------
const rooms = new Map(); // code -> Room

function getOrLoadRoom(code) {
  if (rooms.has(code)) return rooms.get(code);
  if (!worldExists(code)) return null;
  const saved = loadWorld(code);
  if (!saved) return null;
  const room = new Room(code, saved);
  rooms.set(code, room);
  console.log(`[room] loaded ${code} (seed ${room.seed})`);
  return room;
}

function createRoom(code, opts) {
  if (!code) {
    do { code = randomRoomCode(); } while (rooms.has(code) || worldExists(code));
  }
  const room = new Room(code, null, opts);
  room.dirty = true;
  rooms.set(code, room);
  console.log(`[room] created ${code} (seed ${room.seed})`);
  return room;
}

// ---- HTTP: static files ---------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain',
};
const DIST = path.join(ROOT, 'dist');
const gzCache = new Map(); // compressed text files, built on first request

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  let file = path.normalize(path.join(DIST, urlPath));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(DIST, 'index.html'); // SPA fallback
  if (!fs.existsSync(file)) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    return res.end('Client not built. Run "npm run build" first (or use "npm run dev").');
  }
  const ext = path.extname(file);
  const type = MIME[ext] || 'application/octet-stream';
  // Vite puts a content hash in asset names, so they can be cached forever.
  const cache = file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (acceptsGzip && /text|javascript|json|svg/.test(type)) {
    // Key by modification time so a rebuild is picked up without a restart.
    const key = `${file}:${fs.statSync(file).mtimeMs}`;
    let gz = gzCache.get(key);
    if (!gz) { gz = zlib.gzipSync(fs.readFileSync(file)); gzCache.set(key, gz); }
    res.writeHead(200, { 'content-type': type, 'content-encoding': 'gzip', 'cache-control': cache, vary: 'accept-encoding' });
    return res.end(gz);
  }
  res.writeHead(200, { 'content-type': type, 'cache-control': cache });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer();

if (DEV) {
  // Vite runs inside this same process and serves the client with hot reload.
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: path.join(ROOT, 'vite.config.js'),
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  });
  server.on('request', (req, res) => {
    if (req.url === '/health') { res.writeHead(200); return res.end('ok'); }
    vite.middlewares(req, res);
  });
} else {
  server.on('request', serveStatic);
}

// ---- WebSocket game server ----------------------------------------------------------
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 256 * 1024,
  // Compress larger messages (chunk edit lists, snapshots) - small ones aren't worth it.
  perMessageDeflate: { threshold: 512, zlibDeflateOptions: { level: 3 } },
});

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname !== '/ws') return; // other upgrades (Vite's hot reload) are handled elsewhere
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  let room = null, player = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const fail = (msg) => { ws.send(JSON.stringify({ t: 'error', msg })); ws.close(4002, 'error'); };

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (!player) {
      if (msg.t !== 'join') return;
      const code = typeof msg.room === 'string' ? msg.room.toUpperCase() : '';
      const token = typeof msg.token === 'string' ? msg.token.slice(0, 64) : null;
      if (msg.create) {
        if (code && !isValidRoomCode(code)) return fail('Room codes are 4 letters.');
        room = (code && getOrLoadRoom(code)) || createRoom(code || null, {
          seed: typeof msg.seed === 'string' && msg.seed.trim() ? msg.seed.trim().slice(0, 64) : undefined,
          mode: GAME_MODES.includes(msg.mode) ? msg.mode : 'survival',
          hostToken: token,
        });
      } else {
        if (!isValidRoomCode(code)) return fail('Room codes are 4 letters.');
        room = getOrLoadRoom(code);
        if (!room) return fail(`NOTFOUND:World ${code} doesn't exist on this server.`);
      }
      const res = room.addPlayer(ws, msg.name, token);
      if (res.error) return fail(res.error);
      player = res.player;
      console.log(`[room ${room.code}] ${player.name} joined (${room.players.size} online)`);
      return;
    }
    try {
      room.handle(player, msg);
    } catch (e) {
      console.error('[room] error handling', msg.t, e);
    }
  });

  ws.on('close', () => {
    if (room && player && !player.replaced && !player.kicked) {
      room.removePlayer(player);
      console.log(`[room ${room.code}] ${player.name} left (${room.players.size} online)`);
    }
  });
  ws.on('error', () => {});
});

// Detect dead connections (e.g. a Chromebook that went to sleep) every 15 s.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

// ---- Game loop -----------------------------------------------------------------------------
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  for (const room of rooms.values()) {
    try { room.tick(dt); } catch (e) { console.error(`[room ${room.code}] tick error`, e); }
  }
}, TICK_SECONDS * 1000);

// ---- Autosave + unloading idle rooms --------------------------------------------------------
setInterval(async () => {
  for (const [code, room] of rooms) {
    if (await room.save()) console.log(`[save] ${code}`);
    if (room.emptySince && Date.now() - room.emptySince > ROOM_IDLE_UNLOAD_SECONDS * 1000) {
      await room.save();
      rooms.delete(code);
      console.log(`[room] unloaded idle ${code}`);
    }
  }
}, AUTOSAVE_SECONDS * 1000);

function shutdown(signal) {
  console.log(`\n[server] ${signal}: saving ${rooms.size} world(s)...`);
  for (const room of rooms.values()) { room.dirty = true; room.saveSync(); }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.listen(PORT, HOST, () => {
  console.log(`\n  ${GAME_NAME} server running ${DEV ? '(dev mode, hot reload)' : '(production)'}`);
  console.log(`  Local:   http://localhost:${PORT}/`);
  // Show LAN addresses so friends on the same Wi-Fi can join.
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) console.log(`  Network: http://${i.address}:${PORT}/`);
    }
  }
  console.log(`  Worlds are saved in ${DATA_DIR}\n`);
});
