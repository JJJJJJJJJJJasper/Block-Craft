// ============================================================================
// Automated multiplayer test:  npm test
//
// 1. Starts the real server on a spare port with a temporary data folder.
// 2. Connects two headless WebSocket clients (Alice creates a world, Bob joins).
// 3. Alice places and breaks blocks -> Bob must receive the same changes.
// 4. A third client joining later must get the edits in its chunk data.
// 5. Checks anti-cheat: out-of-reach edits are rejected.
// 6. Restarts the server and checks the edit survived (persistence).
// ============================================================================
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { toChunk, toLocal, blockIndex } from '../shared/chunk.js';
import { B } from '../shared/blocks.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'blockcraft-test-'));
let failures = 0;

function check(cond, label) {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${label}`);
  if (!cond) failures++;
}

function startServer() {
  return new Promise((resolve, reject) => {
    // Production mode serves dist/ (not needed here) - the WebSocket server is what we test.
    const proc = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
      env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const onData = (d) => { out += d; if (out.includes('server running')) resolve(proc); };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', (d) => process.stderr.write(d));
    proc.on('exit', (code) => reject(new Error(`server exited early (${code}): ${out}`)));
    setTimeout(() => reject(new Error('server start timeout')), 10000);
  });
}

function stopServer(proc) {
  return new Promise((resolve) => { proc.removeAllListeners('exit'); proc.on('exit', resolve); proc.kill('SIGTERM'); });
}

/** A minimal headless client: collects messages and lets the test wait for one. */
class Client {
  constructor(name) { this.name = name; this.msgs = []; this.waiters = []; }
  connect(join) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
      this.ws.on('open', () => this.send({ t: 'join', name: this.name, token: this.name + '-token', ...join }));
      this.ws.on('message', (data) => {
        const m = JSON.parse(data);
        this.msgs.push(m);
        if (m.t === 'welcome') resolve(m);
        if (m.t === 'error') reject(new Error(m.msg));
        this.waiters = this.waiters.filter(w => { if (w.pred(m)) { w.resolve(m); return false; } return true; });
      });
      this.ws.on('error', reject);
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  waitFor(pred, ms = 3000) {
    const found = this.msgs.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve) => {
      const w = { pred, resolve };
      this.waiters.push(w);
      setTimeout(() => { this.waiters = this.waiters.filter(x => x !== w); resolve(null); }, ms);
    });
  }
  close() { this.ws.close(); }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log(`Starting server on port ${PORT} (data in ${DATA})`);
  let server = await startServer();

  const alice = new Client('Alice');
  const welcomeA = await alice.connect({ create: true, seed: 'test-seed', mode: 'creative' });
  check(/^[A-Z]{4}$/.test(welcomeA.room), `Alice created world ${welcomeA.room}`);
  check(welcomeA.host === welcomeA.id, 'Alice (first player) is the host');

  const bob = new Client('Bob');
  const welcomeB = await bob.connect({ room: welcomeA.room });
  check(welcomeB.seed === 'test-seed', 'Bob joined the same world and got the seed');

  // Place a block right above Alice's head (well within reach).
  const s = welcomeA.you.pos;
  const x = Math.floor(s.x) + 1, y = Math.floor(s.y) + 2, z = Math.floor(s.z);
  alice.send({ t: 'place', x, y, z, id: B.BRICKS });
  const seen = await bob.waitFor(m => m.t === 'block' && m.x === x && m.y === y && m.z === z && m.id === B.BRICKS);
  check(!!seen, 'Bob received Alice\'s placed block');

  // A late joiner asks for the chunk and must see the edit in the delta list.
  const carol = new Client('Carol');
  await carol.connect({ room: welcomeA.room });
  carol.send({ t: 'reqChunks', list: [[toChunk(x), toChunk(z)]] });
  const chunkMsg = await carol.waitFor(m => m.t === 'chunks');
  const edits = chunkMsg?.list?.[0]?.[2] || [];
  const idx = blockIndex(toLocal(x), y, toLocal(z));
  let found = false;
  for (let i = 0; i < edits.length; i += 2) if (edits[i] === idx && edits[i + 1] === B.BRICKS) found = true;
  check(found, 'Late joiner gets the edit in its chunk data');

  // Breaking syncs too.
  alice.send({ t: 'break', x, y, z, held: 0 });
  const broke = await bob.waitFor(m => m.t === 'block' && m.x === x && m.y === y && m.z === z && m.id === 0);
  check(!!broke, 'Bob received Alice\'s broken block');

  // Anti-cheat: a block 50 blocks away must be rejected (Alice gets the real block back).
  alice.msgs.length = 0;
  alice.send({ t: 'place', x: x + 50, y, z, id: B.BRICKS });
  const reverted = await alice.waitFor(m => m.t === 'block' && m.x === x + 50 && m.id !== B.BRICKS);
  check(!!reverted, 'Out-of-reach edit was rejected');
  const leaked = await bob.waitFor(m => m.t === 'block' && m.x === x + 50, 500);
  check(!leaked, 'Rejected edit was not broadcast');

  // Chat.
  bob.send({ t: 'chat', text: 'hello alice' });
  const chat = await alice.waitFor(m => m.t === 'chat' && m.text === 'hello alice');
  check(chat && chat.from === 'Bob', 'Chat message delivered');

  // Movement snapshots reach the other player.
  bob.send({ t: 'pos', p: [s.x + 1, s.y, s.z], r: [0, 0], f: 0, m: 1 });
  const snap = await alice.waitFor(m => m.t === 'snap' && m.p.some(e => e[0] === welcomeB.id && Math.abs(e[1] - (s.x + 1)) < 0.01));
  check(!!snap, 'Bob\'s movement appears in Alice\'s snapshots');

  // Persistence: place a block, restart the server, rejoin.
  alice.send({ t: 'place', x, y, z, id: B.GLASS });
  await bob.waitFor(m => m.t === 'block' && m.x === x && m.y === y && m.z === z && m.id === B.GLASS);
  alice.close(); bob.close(); carol.close();
  await sleep(200);
  await stopServer(server);
  check(fs.existsSync(path.join(DATA, `${welcomeA.room}.json`)), 'World file written on shutdown');
  server = await startServer();
  const dave = new Client('Dave');
  await dave.connect({ room: welcomeA.room });
  dave.send({ t: 'reqChunks', list: [[toChunk(x), toChunk(z)]] });
  const after = await dave.waitFor(m => m.t === 'chunks');
  const e2 = after?.list?.[0]?.[2] || [];
  let kept = false;
  for (let i = 0; i < e2.length; i += 2) if (e2[i] === idx && e2[i + 1] === B.GLASS) kept = true;
  check(kept, 'Edit survived a server restart');
  dave.close();
  await stopServer(server);

  fs.rmSync(DATA, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
