// Magica Terminal's window: settings and theme from the Rust side, then the saved session or a fresh tab.
import "@xterm/xterm/css/xterm.css";
import "./style.css";
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import { loadFonts } from "./font";
import { getSettings, loadSession, readText, startup } from "./ipc";
import { DEFAULTS } from "./settings";
import type { ThemeName } from "./theme";
import { MagicaWindow } from "./window";

async function main() {
  const appWindow = getCurrentWindow();
  const [settings, start, saved, themeText] = await Promise.all([
    getSettings().catch(() => DEFAULTS),
    startup(),
    loadSession().catch(() => null),
    readText("theme").catch(() => ""),
  ]);
  const chosen = themeText.trim();
  const system: ThemeName = ((await appWindow.theme().catch(() => null)) ??
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) as ThemeName;
  const theme: ThemeName = chosen === "light" || chosen === "dark" ? chosen : system;
  // xterm measures the font once: have it loaded first
  await loadFonts();

  const win = new MagicaWindow(document.getElementById("app")!, {
    settings: { ...DEFAULTS, ...settings },
    os: start.os,
    home: start.home,
    theme,
    themeSetting: chosen === "light" || chosen === "dark" ? chosen : "system",
  });
  const size = (saved as { size?: unknown } | null)?.size;
  if (!start.command && saved && win.restore(saved)) {
    if (Array.isArray(size) && size.length === 2 && size.every((n) => typeof n === "number" && n > 100)) {
      await appWindow.setSize(new LogicalSize(size[0], size[1])).catch(() => {});
    }
  } else {
    win.newTab({ command: start.command ?? undefined });
  }
  const first = win.firstPane();
  if (start.overlay === "crush") first?.openCrush();
  else if (start.overlay === "note") first?.openNotes();
  await appWindow.show();
  await appWindow.setFocus().catch(() => {});
}

main().catch(async (e) => {
  document.body.textContent = `Magica Terminal couldn't start: ${e}`;
  await getCurrentWindow().show().catch(() => {});
});
