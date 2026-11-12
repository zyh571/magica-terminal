// `space [folder]`: what takes up the disk there.
export function humanSize(n: number): string {
  for (const unit of ["B", "KB", "MB", "GB", "TB"]) {
    if (n < 1024 || unit === "TB") return unit === "B" ? `${Math.round(n)} B` : `${n.toFixed(1)} ${unit}`;
    n /= 1024;
  }
  return "";
}

import { openPath } from "@tauri-apps/plugin-opener";
import { scanDrop, scanNew, scanUp, scanView, type ScanItem, type ScanView } from "./ipc";
import type { Overlay, PaneHost } from "./overlay";
import { THEMES } from "./theme";

const SPACE_ROWS = 300;   // items shown per folder; the rest are summed up in one row

/** A shell command that changes to `path`, for the pane's kind of shell. */
export function cdCommand(path: string, shell: "posix" | "pwsh"): string {
  return shell === "pwsh"
    ? ` Set-Location -LiteralPath '${path.replace(/'/g, "''")}'\r`
    : ` cd -- '${path.replace(/'/g, `'\\''`)}'\r`;
}

export function openSpace(host: PaneHost, path: string, home: string): Overlay {
  const el = document.createElement("div");
  el.className = "overlay space";
  el.tabIndex = 0;
  el.innerHTML = `<header><button class="up" title="Up (Backspace)">↑</button><span class="path"></span>
    <span class="summary"></span><button class="cd" title="cd here and close (C)">⌁</button>
    <button class="close" title="Close (Esc)">✕</button></header><ol class="rows"></ol>`;
  const $ = <T extends Element>(q: string) => el.querySelector(q) as T;
  const list = $<HTMLOListElement>(".rows");
  let scan = 0, here: number | undefined, current: ScanView | null = null, running = true, timer = 0, selected = 0, alive = true;

  async function refresh() {
    if (!scan || !alive) return;
    const got = await scanView(scan, here).catch(() => null);
    if (!got || !alive) return;
    [current, running] = got;
    render();
    clearTimeout(timer);
    if (running) timer = window.setTimeout(refresh, 250);
  }

  function render() {
    const node = current!;
    const items = node.children;
    const shown = items.slice(0, SPACE_ROWS), rest = items.slice(SPACE_ROWS);
    const total = Math.max(node.size, 1), top = Math.max(1, ...shown.map((c) => c.size));
    const rows: (ScanItem | { name: string; size: number; rest: number })[] = [...shown];
    if (rest.length) rows.push({ name: `${rest.length} smaller items`, size: rest.reduce((a, c) => a + c.size, 0), rest: rest.length });
    list.replaceChildren(...rows.map((c, i) => {
      const li = document.createElement("li");
      const item = "id" in c ? c : null;
      li.className = item?.folder ? "folder" : "file";
      li.classList.toggle("selected", i === selected);
      if (item?.error) li.title = item.error;
      li.innerHTML = `<span class="icon">${item?.folder ? "▸" : " "}</span><span class="name"></span>
        <span class="bar"><i style="width:${(100 * c.size) / top}%"></i></span>
        <span class="amount">${item && !item.listed ? "…" : humanSize(c.size)}</span>
        <span class="share">${Math.round((100 * c.size) / total)}%</span>`;
      (li.querySelector(".name") as HTMLElement).textContent = c.name;
      li.addEventListener("click", () => {
        selected = i;
        if (item?.folder) enter(item);
        else render();
      });
      li.addEventListener("dblclick", () => item && !item.folder && openPath(`${node.path}/${item.name}`).catch(() => {}));
      return li;
    }));
    const shownPath = home && node.path.startsWith(home) ? "~" + node.path.slice(home.length) : node.path;
    $<HTMLElement>(".path").textContent = shownPath;
    $<HTMLElement>(".summary").textContent = `${running ? "scanning… " : ""}${humanSize(node.size)} in ${items.length} items`;
    list.children[selected]?.scrollIntoView({ block: "nearest" });
    const t = THEMES[host.theme()];
    el.style.setProperty("--bg", t.bg);
    el.style.setProperty("--fg", t.fg);
    el.style.setProperty("--dim", t.dim);
    el.style.setProperty("--her", host.colour());
  }

  function enter(item: ScanItem) {
    if (!item.folder || item.error === "other filesystem") return;
    here = item.id;
    selected = 0;
    refresh();
  }

  async function goUp() {
    if (!current) return;
    const name = current.path.split(/[\\/]/).filter(Boolean).pop();
    if (current.parent !== null) here = current.parent;
    else {   // above where the scan started: scan the parent too (this folder is kept)
      const root = await scanUp(scan).catch(() => null);
      if (root === null) return;
      here = root;
    }
    const got = await scanView(scan, here);
    if (got) selected = Math.max(0, got[0].children.findIndex((c) => c.name === name));
    refresh();
  }

  function cdHere() {
    if (!current) return;
    const path = current.path;
    host.closeOverlay();
    host.sendToShell(cdCommand(path, host.shellKind()));
  }

  $(".up").addEventListener("click", goUp);
  $(".cd").addEventListener("click", cdHere);
  $(".close").addEventListener("click", () => host.closeOverlay());
  el.addEventListener("keydown", (e) => {
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    const items = current?.children ?? [];
    if (plain && (e.key === "Escape" || e.key === "q" || e.key === "Q")) host.closeOverlay();
    else if (e.key === "Backspace" || (plain && e.key === "ArrowLeft") || (e.altKey && e.key === "ArrowUp")) goUp();
    else if (plain && (e.key === "ArrowRight" || e.key === "Enter")) {
      const item = items[selected];
      if (item?.folder) enter(item);
      else if (item && e.key === "Enter" && current) openPath(`${current.path}/${item.name}`).catch(() => {});
    } else if (plain && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      selected = Math.max(0, Math.min(Math.min(items.length, SPACE_ROWS) - 1, selected + (e.key === "ArrowDown" ? 1 : -1)));
      render();
    } else if (plain && (e.key === "c" || e.key === "C")) cdHere();
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  scanNew(path).then((id) => {
    scan = id;
    if (!alive) scanDrop(id);
    else refresh();
  });

  return {
    kind: "space",
    el,
    focus: () => el.focus(),
    restyle: () => current && render(),
    dispose() {
      alive = false;
      clearTimeout(timer);
      if (scan) scanDrop(scan);
    },
  };
}
