// ============================================================================
// Screens outside of gameplay: main menu, loading, pause (with settings, host
// controls, controls help, invite link) and the death screen.
// ============================================================================
import { GAME_NAME } from '../../shared/config.js';
import { escapeHtml } from './hud.js';

const $ = (id) => document.getElementById(id);

export class Menus {
  constructor(settings, h) {
    this.h = h; // handlers: onCreate, onJoin, onResume, onLeave, onHost, onRespawn
    document.title = GAME_NAME;
    for (const el of document.querySelectorAll('.game-name')) el.textContent = GAME_NAME;

    // Prefill from saved settings and the URL (?world=ABCD).
    const params = new URLSearchParams(location.search);
    $('name-input').value = settings.name || `Player${Math.floor(Math.random() * 900 + 100)}`;
    const code = (params.get('world') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    if (code) $('code-input').value = code;

    const name = () => $('name-input').value.trim() || 'Player';
    $('create-btn').onclick = () => h.onCreate({ name: name(), seed: $('seed-input').value.trim(), mode: $('mode-select').value });
    $('join-btn').onclick = () => {
      const c = $('code-input').value.trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(c)) return this.showError('World codes are 4 letters, like ABCD.');
      h.onJoin({ name: name(), code: c });
    };
    $('code-input').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
    $('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join-btn').click(); });

    // Pause menu tabs
    for (const b of document.querySelectorAll('#pause-tabs button')) {
      b.onclick = () => this.showTab(b.dataset.tab);
    }
    $('resume-btn').onclick = () => h.onResume();
    $('leave-btn').onclick = () => h.onLeave();
    $('copy-link-btn').onclick = () => {
      const input = $('invite-link');
      input.select();
      (navigator.clipboard ? navigator.clipboard.writeText(input.value) : Promise.reject()).catch(() => document.execCommand('copy'));
      $('copy-link-btn').textContent = 'Copied!';
      setTimeout(() => { $('copy-link-btn').textContent = 'Copy invite link'; }, 1500);
    };
    for (const b of document.querySelectorAll('#tab-host [data-mode]')) b.onclick = () => h.onHost('mode', b.dataset.mode);
    for (const b of document.querySelectorAll('#tab-host [data-time]')) b.onclick = () => h.onHost('time', Number(b.dataset.time));
    $('respawn-btn').onclick = () => h.onRespawn();
  }

  // ---- main menu ----
  showMain() { this._only('menu-screen'); }
  setBusy(busy) { $('create-btn').disabled = busy; $('join-btn').disabled = busy; }

  showError(msg, offerCreateCode = null) {
    this._only('menu-screen');
    const el = $('menu-error');
    el.classList.remove('hidden');
    el.innerHTML = escapeHtml(msg);
    if (offerCreateCode) {
      const b = document.createElement('button');
      b.className = 'primary';
      b.textContent = `Create a new world called ${offerCreateCode}`;
      b.onclick = () => this.h.onCreate({ name: $('name-input').value.trim() || 'Player', seed: $('seed-input').value.trim(), mode: $('mode-select').value, code: offerCreateCode });
      el.appendChild(document.createElement('br'));
      el.appendChild(b);
    }
  }

  // ---- loading ----
  showLoading(title) {
    this._only('loading-screen');
    $('loading-title').textContent = title;
    this.setLoading(0, '');
  }
  setLoading(frac, detail) {
    $('loading-bar').style.width = `${Math.round(frac * 100)}%`;
    $('loading-detail').textContent = detail;
  }

  // ---- pause ----
  showPause(tab) {
    this._only('pause-screen');
    if (tab) this.showTab(tab);
  }
  get pauseVisible() { return !$('pause-screen').classList.contains('hidden'); }
  showTab(tab) {
    for (const b of document.querySelectorAll('#pause-tabs button')) b.classList.toggle('active', b.dataset.tab === tab);
    for (const t of ['game', 'settings', 'host', 'controls']) $(`tab-${t}`).classList.toggle('hidden', t !== tab);
  }
  setRoom(code) {
    $('room-code').textContent = code;
    $('invite-link').value = `${location.origin}/?world=${code}`;
  }
  updateHost(isHost, players, myId, hostId, mode) {
    $('host-note').textContent = isHost
      ? `You are the host. Current mode: ${mode}.`
      : `Only the host (${players.find(p => p.id === hostId)?.name || '?'}) can change these.`;
    for (const b of document.querySelectorAll('#tab-host button')) b.disabled = !isHost;
    for (const b of document.querySelectorAll('#tab-host [data-mode]')) b.classList.toggle('active', b.dataset.mode === mode);
    const list = $('host-players');
    list.innerHTML = '';
    for (const p of players) {
      const row = document.createElement('div');
      row.className = 'prow';
      row.innerHTML = `<span>${p.id === hostId ? '★ ' : ''}${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}</span>`;
      if (isHost && p.id !== myId) {
        const k = document.createElement('button');
        k.textContent = 'Kick';
        k.onclick = () => this.h.onHost('kick', p.id);
        row.appendChild(k);
      }
      list.appendChild(row);
    }
  }

  // ---- death ----
  showDeath(cause) { this._only('death-screen'); $('death-cause').textContent = cause; }

  hideAll() { this._only(null); }

  _only(id) {
    for (const s of ['menu-screen', 'loading-screen', 'pause-screen', 'death-screen']) $(s).classList.toggle('hidden', s !== id);
    if (id !== 'menu-screen') $('menu-error').classList.add('hidden');
  }
}
