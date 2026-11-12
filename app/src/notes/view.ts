// The notepad over a pane: one plain sheet (note.txt), saved as you type. <head>Title<head> headers (larger, bold,
// underlined) are listed down the left to jump to; *word* is bold; the tags show only where the cursor is.
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, keymap, placeholder, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { readText, writeText } from "../ipc";
import type { Overlay, PaneHost } from "../overlay";
import { mix, THEMES } from "../theme";
import { noteMarks, type Mark } from "./markup";

const hidden = Decoration.replace({});
const dim = Decoration.mark({ class: "cm-tag" });
const head = Decoration.mark({ class: "cm-head" });
const bold = Decoration.mark({ class: "cm-bold" });

function decorations(view: EditorView): DecorationSet {
  const text = view.state.doc.toString();
  const { from, to } = view.state.selection.main;
  const { heads, bolds } = noteMarks(text);
  const ranges: [number, number, Decoration][] = [];
  const add = (m: Mark, style: Decoration, styleWhole: boolean) => {
    const editing = from <= m.end && to >= m.start;   // (shown, dimmed, while editing it)
    const tag = editing ? dim : hidden;
    if (m.innerStart > m.start) ranges.push([m.start, m.innerStart, tag]);
    ranges.push(styleWhole && editing ? [m.start, m.end, style] : [m.innerStart, m.innerEnd, style]);
    if (m.end > m.innerEnd) ranges.push([m.innerEnd, m.end, tag]);
  };
  heads.forEach((m) => add(m, head, false));
  bolds.forEach((m) => add(m, bold, false));
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const b = new RangeSetBuilder<Decoration>();
  let last = -1;
  for (const [s, e, d] of ranges) {
    if (s < last) continue;   // (overlapping markup: the first wins)
    if (e > s) b.add(s, e, d);
    last = d === hidden ? e : s;
  }
  return b.finish();
}

export function openNotes(host: PaneHost): Overlay {
  const s = host.settings;
  const el = document.createElement("div");
  el.className = "overlay notes";
  const side = document.createElement("nav");
  side.className = "notes-side";
  const body = document.createElement("div");
  body.className = "notes-body";
  const status = document.createElement("div");
  status.className = "notes-status";
  el.append(side, body, status);

  let dirty = false, timer = 0, loaded = false, titles = "";
  const save = async () => {
    clearTimeout(timer);
    timer = 0;
    if (!dirty || !loaded) return;
    dirty = false;
    const ok = await writeText("note.txt", view.state.doc.toString()).catch(() => false);
    if (!ok) dirty = true;
    status.textContent = ok ? "" : "could not save";
  };

  const sideList = (v: EditorView) => {
    const text = v.state.doc.toString();
    const { heads } = noteMarks(text);
    const names = heads.map((m) => text.slice(m.innerStart, m.innerEnd).trim() || "…");
    const key = names.join("\n");
    if (key !== titles) {
      titles = key;
      side.replaceChildren(...names.map((name, n) => {
        const b = document.createElement("button");
        b.textContent = name;
        b.title = name;
        b.tabIndex = -1;
        b.addEventListener("mousedown", (e) => e.preventDefault());
        b.addEventListener("click", () => jump(n));
        return b;
      }));
      side.hidden = !names.length;
    }
    const cur = v.state.selection.main.head;
    const here = heads.filter((m) => m.start <= cur).length - 1;   // the section the cursor is in
    [...side.children].forEach((b, n) => b.classList.toggle("current", n === here));
  };

  const markup = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(v: EditorView) {
      this.decorations = decorations(v);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = decorations(u.view);
      if (u.docChanged || u.selectionSet) sideList(u.view);
    }
  }, { decorations: (p) => p.decorations });

  const view = new EditorView({
    parent: body,
    state: EditorState.create({
      doc: "",
      extensions: [
        history(),
        keymap.of([
          { key: "Escape", run: () => (host.closeOverlay(), true) },
          { key: "Mod-s", run: () => (dirty = true, save(), true), preventDefault: true },
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        EditorView.lineWrapping,
        placeholder("Start typing."),
        markup,
        EditorView.updateListener.of((u) => {
          if (!u.docChanged || !loaded) return;
          dirty = true;
          clearTimeout(timer);
          timer = window.setTimeout(save, s.note_save_after * 1000);
        }),
      ],
    }),
  });

  /** A header from the left: it goes to the top, the cursor to the line under it (so it stays a header). */
  function jump(n: number) {
    const text = view.state.doc.toString();
    const m = noteMarks(text).heads[n];
    if (!m) return;
    const line = view.state.doc.lineAt(m.end);
    const below = line.number < view.state.doc.lines ? view.state.doc.line(line.number + 1).from : line.to;
    view.dispatch({ selection: { anchor: below }, effects: EditorView.scrollIntoView(m.start, { y: "start" }) });
    view.focus();
  }

  readText("note.txt").then((t) => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t.replace(/^\ufeff/, "") } });
    loaded = true;
    sideList(view);
  }).catch(() => (status.textContent = "could not read the note"));

  const restyle = () => {
    const t = THEMES[host.theme()], colour = host.colour();
    el.style.setProperty("--bg", t.bg);
    el.style.setProperty("--fg", t.fg);
    el.style.setProperty("--dim", t.dim);
    el.style.setProperty("--her", colour);
    el.style.setProperty("--rule", mix(t.bg, t.dim, 0.35));
    el.style.setProperty("--font", host.fontFamily());
  };
  restyle();

  return {
    kind: "note",
    el,
    focus: () => view.focus(),
    restyle,
    dispose() {
      save();
      view.destroy();
    },
  };
}
