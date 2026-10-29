// ============================================================================
// Player settings, saved in the browser's localStorage so they persist.
// ============================================================================
import { DEFAULT_RENDER_DISTANCE, DEFAULT_FOV, MIN_RENDER_DISTANCE, MAX_RENDER_DISTANCE } from '../../shared/config.js';

const KEY = 'blockcraft-settings';

const DEFAULTS = {
  name: '',
  renderDistance: DEFAULT_RENDER_DISTANCE,
  fov: DEFAULT_FOV,
  sensitivity: 1,
  volume: 0.7,
  showFps: false,
  hidpi: false,
  fancy: true,
};

export function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* private mode etc. */ }
  const out = { ...DEFAULTS, ...s };
  out.renderDistance = Math.max(MIN_RENDER_DISTANCE, Math.min(MAX_RENDER_DISTANCE, Number(out.renderDistance) || DEFAULT_RENDER_DISTANCE));
  return out;
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

/**
 * Wire the settings tab inputs to a settings object.
 * `apply(settings)` is called whenever something changes.
 */
export function bindSettingsUI(settings, apply) {
  const bind = (id, key, fmt, parse = Number) => {
    const input = document.getElementById(id);
    const label = document.getElementById(id.replace('-input', '-val'));
    const show = () => { if (label) label.textContent = fmt(settings[key]); };
    if (input.type === 'checkbox') input.checked = !!settings[key];
    else input.value = settings[key];
    show();
    input.addEventListener('input', () => {
      settings[key] = input.type === 'checkbox' ? input.checked : parse(input.value);
      show();
      saveSettings(settings);
      apply(settings);
    });
  };
  bind('rd-input', 'renderDistance', v => v);
  bind('fov-input', 'fov', v => v + '°');
  bind('sens-input', 'sensitivity', v => Number(v).toFixed(2));
  bind('vol-input', 'volume', v => Math.round(v * 100) + '%');
  bind('fps-input', 'showFps', () => '');
  bind('hidpi-input', 'hidpi', () => '');
  bind('fancy-input', 'fancy', () => '');
}
