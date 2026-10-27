// ============================================================================
// WebSocket connection to the game server, with automatic reconnect.
// Messages are JSON objects with a `t` type field (see shared/protocol.js).
// ============================================================================

export class Network {
  constructor() {
    this.handlers = new Map();
    this.ws = null;
    this.joinMsg = null;
    this.welcomed = false;
    this.stopped = false;       // true after kick / leaving
    this.retryDelay = 1000;
    this.ping = 0;
    this._pingTimer = null;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  _emit(type, msg) {
    for (const fn of this.handlers.get(type) || []) fn(msg);
  }

  get url() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  /** Connect and join. Resolves with the server's welcome message. */
  connect(joinMsg) {
    this.joinMsg = joinMsg;
    this.stopped = false;
    return new Promise((resolve, reject) => {
      this._firstResolve = resolve;
      this._firstReject = reject;
      this._open();
    });
  }

  _open() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'join', ...this.joinMsg }));
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'welcome') {
        this.retryDelay = 1000;
        // Any later reconnect should join this room, not create a new one.
        this.joinMsg = { ...this.joinMsg, create: false, room: msg.room };
        const first = !this.welcomed;
        this.welcomed = true;
        this._startPing();
        if (first && this._firstResolve) { this._firstResolve(msg); this._firstResolve = null; return; }
        this._emit('reconnected', msg);
        return;
      }
      if (msg.t === 'error' && !this.welcomed && this._firstReject) {
        this.stopped = true;
        this._firstReject(new Error(msg.msg));
        this._firstReject = null;
        return;
      }
      if (msg.t === 'pong') { this.ping = Math.round(performance.now() - msg.c); return; }
      if (msg.t === 'kicked') this.stopped = true;
      this._emit(msg.t, msg);
    };
    ws.onclose = () => {
      clearInterval(this._pingTimer);
      if (ws !== this.ws) return;
      if (!this.welcomed) {
        if (this._firstReject) { this._firstReject(new Error('Could not connect to the server.')); this._firstReject = null; }
        return;
      }
      if (this.stopped) return;
      this._emit('disconnected');
      setTimeout(() => { if (!this.stopped) this._open(); }, this.retryDelay);
      this.retryDelay = Math.min(10000, this.retryDelay * 2);
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  _startPing() {
    clearInterval(this._pingTimer);
    this._pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
  }

  get connected() { return this.ws && this.ws.readyState === 1 && this.welcomed; }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.stopped = true;
    clearInterval(this._pingTimer);
    if (this.ws) this.ws.close();
  }
}
