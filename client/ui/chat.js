// ============================================================================
// Text chat: T (or /) opens the input, Enter sends, Esc cancels.
// Lines fade out after a few seconds but reappear while the chat is open.
// Host commands typed in chat: /time day|noon|sunset|night|<number>,
// /mode survival|creative, /kick <name>, /help
// ============================================================================
import { escapeHtml } from './hud.js';

export class Chat {
  constructor(onSend, onCommand) {
    this.root = document.getElementById('chat');
    this.log = document.getElementById('chat-log');
    this.input = document.getElementById('chat-input');
    this.onSend = onSend;
    this.onCommand = onCommand;
    this.isOpen = false;
    this.onClose = null;
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        if (text) {
          if (text.startsWith('/')) this.onCommand(text);
          else this.onSend(text);
        }
        this.close();
      } else if (e.key === 'Escape') {
        this.close();
      }
    });
  }

  open(prefix = '') {
    this.isOpen = true;
    this.root.classList.add('open');
    this.input.classList.remove('hidden');
    this.input.value = prefix;
    // Focus on the next frame so the key that opened chat isn't typed into it.
    setTimeout(() => this.input.focus(), 0);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('open');
    this.input.classList.add('hidden');
    this.input.blur();
    if (this.onClose) this.onClose();
  }

  add(text, from = null, sys = false) {
    const line = document.createElement('div');
    line.className = 'line' + (sys ? ' sys' : '');
    line.innerHTML = from ? `<b>&lt;${escapeHtml(from)}&gt;</b> ${escapeHtml(text)}` : escapeHtml(text);
    this.log.appendChild(line);
    while (this.log.children.length > 12) this.log.firstChild.remove();
    setTimeout(() => line.classList.add('faded'), 8000);
  }
}
