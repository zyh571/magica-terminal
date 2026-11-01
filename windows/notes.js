// `note` in the shell: a notepad over the pane, in the terminal's theme and the pane's character's colour. One note,
// one sheet: a plain-text file, %APPDATA%\magica-terminal\note.txt (main.js). It saves as you type and Esc goes back to
// the prompt. While it's open the window stays on top of the others (MagicaWindow.updateOnTop).
// Uses renderer.js's settings and helpers.
'use strict';

const NOTE_SAVE_AFTER = 0.4;   // s after the last keystroke

class Notes {
  constructor(pane) {
    this.pane = pane;
    this.dirty = false;
    this.saving = Promise.resolve();
    this.timer = null;

    this.el = el('div', 'notes');
    this.text = el('textarea', 'notes-text');
    this.text.spellcheck = false;
    this.text.placeholder = 'Start typing.';
    this.status = el('div', 'notes-status');
    this.el.append(this.text, this.status);

    this.text.addEventListener('input', () => this.onInput());
    this.el.addEventListener('keydown', e => this.onKey(e));
    this.onResize();
    pane.host.style.visibility = 'hidden';   // the backgrounds are see-through over mica: no prompt showing through
    this.ready = this.load();
  }

  focus() {
    this.text.focus();
  }

  onResize() {
    this.text.style.fontFamily = FONT_FAMILY;
    this.text.style.fontSize = `${Math.round(FONT_SIZE * this.pane.win.fontScale)}px`;
  }

  destroy() {
    this.save();
    this.pane.host.style.visibility = '';
    this.el.remove();
  }

  async load() {
    const text = await magica.readNote();
    if (this.dirty) return;   // typed before it loaded: keep that
    this.text.value = text;
    this.text.setSelectionRange(text.length, text.length);
    this.text.scrollTop = this.text.scrollHeight;
  }

  save() {
    clearTimeout(this.timer);
    if (!this.dirty) return;
    const text = this.text.value;
    this.dirty = false;
    this.saving = this.saving
      .then(() => magica.writeNote(text), () => false)
      .then(ok => {
        if (!ok) this.dirty = true;
        if (this.status.isConnected) this.setStatus(ok ? '' : 'could not save');
      });
  }

  setStatus(text) {
    this.status.textContent = text;
    this.status.classList.toggle('problem', !!text);
  }

  onInput() {
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), NOTE_SAVE_AFTER * 1000);
  }

  onKey(e) {
    const ctrl = e.ctrlKey, shift = e.shiftKey, alt = e.altKey;
    const take = fn => { e.preventDefault(); e.stopPropagation(); fn(); };   // ours, not the window's
    if (e.key === 'Escape' && !ctrl && !alt) {
      take(() => this.pane.closeOverlay());
    } else if (ctrl && !alt && !shift && e.code === 'KeyS') {
      take(() => this.save());
    } else if (ctrl && shift && !alt && e.code === 'KeyC') {   // the terminal's copy / paste keys work here too
      take(() => document.execCommand('copy'));
    } else if (ctrl && shift && !alt && e.code === 'KeyV') {
      take(async () => {
        const text = await magica.readClipboard();
        if (text) { this.text.focus(); document.execCommand('insertText', false, text.replace(/\r\n/g, '\n')); }
      });
    } else if (e.key === 'Tab' && !ctrl && !alt && !shift) {
      take(() => document.execCommand('insertText', false, '\t'));   // (execCommand keeps Ctrl+Z working)
    }
  }
}
