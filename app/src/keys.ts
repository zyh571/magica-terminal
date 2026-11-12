// The window's shortcuts. Linux and Windows: Ctrl+Shift (+ Ctrl+Alt arrows, Ctrl+PageUp/Down, Ctrl+1…9).
// macOS: Cmd, the usual Mac way. Anything else goes to the program in the pane.
export type Action =
  | "splitRight" | "splitDown" | "close" | "newTab" | "prevTab" | "nextTab" | "copy" | "paste"
  | "fontUp" | "fontDown" | "fontReset" | "toggleTheme" | "search"
  | { tab: number }
  | { move: [number, number] };

export type KeyLike = Pick<KeyboardEvent, "code" | "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">;
export type Os = "mac" | "other";

export const OS: Os = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "mac" : "other";

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

function digit(code: string): number | null {
  const m = code.match(/^(?:Digit|Numpad)([1-9])$/);
  return m ? Number(m[1]) : null;
}

function fontKey(e: KeyLike): Action | null {
  if (e.code === "Equal" || e.code === "NumpadAdd" || e.key === "+" || e.key === "=") return "fontUp";
  if (e.code === "Minus" || e.code === "NumpadSubtract" || e.key === "-" || e.key === "_") return "fontDown";
  if (e.code === "Digit0" || e.code === "Numpad0") return "fontReset";
  return null;
}

export function actionFor(e: KeyLike, os: Os = OS): Action | null {
  const { ctrlKey: c, shiftKey: s, altKey: a, metaKey: m } = e;
  if (os === "mac") {
    if (!m || c) return null;
    if (a && !s && ARROWS[e.code]) return { move: ARROWS[e.code] };
    if (a) return null;
    const font = fontKey(e);
    if (font) return font;
    if (s) {
      switch (e.code) {
        case "KeyD": return "splitDown";
        case "KeyL": return "toggleTheme";
        case "BracketLeft": return "prevTab";
        case "BracketRight": return "nextTab";
      }
      return null;
    }
    const n = digit(e.code);
    if (n) return { tab: n };
    switch (e.code) {
      case "KeyD": return "splitRight";
      case "KeyW": return "close";
      case "KeyT": return "newTab";
      case "KeyC": return "copy";
      case "KeyV": return "paste";
      case "KeyF": return "search";
    }
    return null;
  }
  if (m) return null;
  if (c && a && !s && ARROWS[e.code]) return { move: ARROWS[e.code] };
  if (c && s && !a) {
    const font = fontKey(e);
    if (font) return font;
    switch (e.code) {
      case "KeyO": return "splitRight";
      case "KeyE": return "splitDown";
      case "KeyW": return "close";
      case "KeyT": return "newTab";
      case "KeyC": return "copy";
      case "KeyV": return "paste";
      case "KeyL": return "toggleTheme";
      case "KeyF": return "search";
    }
    return null;
  }
  if (c && !s && !a) {
    if (e.code === "PageUp") return "prevTab";
    if (e.code === "PageDown") return "nextTab";
    const n = digit(e.code);
    if (n) return { tab: n };
  }
  return null;
}
