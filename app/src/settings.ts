// The settings the Rust side loads from settings.json (defaults overridden by valid values). DEFAULTS mirrors
// core/src/settings.rs for tests and for running the UI outside Tauri.
export interface Settings {
  font: string;
  padding: number;
  fig_height: number; fig_right: number; fig_bottom: number;
  base_height: number; base_gap: number;
  figure_opacity: number; hover_opacity: number; text_opacity: number; text_full: number; text_contrast: number;
  fail_flash: number; fail_tint: number; fail_squash: number; fail_red: string;
  ignored_exit: number[];
  long_command: number; hop_height: number; hops: number; jump_height: number; notify: boolean;
  idle_after: number; idle_every: [number, number]; idle_bob: number; idle_breath: number;
  frame_width: number; window_radius: number; unfocused_overlay: string;
  text_saturation: number; path_saturation: number;
  focus_brighten: { dark: number; light: number }; focus_tint: number; unfocused_saturation: number;
  crush_size: number; crush_speed: number; crush_hint_after: number; crush_autoplay: boolean;
  crush_autoplay_delay: number; crush_chain_luck: number; crush_lucky_stripes: number; crush_chain_fade: number;
  note_save_after: number;
}

export const DEFAULTS: Settings = {
  font: "Maple Mono 11",
  padding: 10,
  fig_height: 240, fig_right: 30, fig_bottom: 12,
  base_height: 5, base_gap: 4,
  figure_opacity: 0.35, hover_opacity: 1, text_opacity: 1, text_full: 0.2, text_contrast: 0.12,
  fail_flash: 0.5, fail_tint: 0.5, fail_squash: 0.15, fail_red: "#ff1f1f",
  ignored_exit: [130],
  long_command: 10, hop_height: 22, hops: 3, jump_height: 20, notify: true,
  idle_after: 15, idle_every: [6, 14], idle_bob: 12, idle_breath: 0.04,
  frame_width: 0, window_radius: 12, unfocused_overlay: "transparent",
  text_saturation: 0.55, path_saturation: 0.4,
  focus_brighten: { dark: 0, light: 0 }, focus_tint: 0.08, unfocused_saturation: 1.0,
  crush_size: 8, crush_speed: 1.0, crush_hint_after: 5, crush_autoplay: false,
  crush_autoplay_delay: 0.6, crush_chain_luck: 0.4, crush_lucky_stripes: 0.05, crush_chain_fade: 0.72,
  note_save_after: 0.4,
};

/** The font setting ("Maple Mono 11", "JetBrains Mono, Menlo 13") as a CSS family list and a size in px. */
export function parseFont(font: string): { family: string; size: number } {
  const m = font.trim().match(/^(.*?)\s+(\d+(?:\.\d+)?)$/);
  const names = (m ? m[1] : font).split(",").map((s) => s.trim()).filter(Boolean);
  const pt = m ? parseFloat(m[2]) : 11;
  const stack = [...names, "Maple Mono", "Ubuntu Sans Mono", "Menlo", "Cascadia Mono", "monospace"];
  const unique = [...new Set(stack)];
  return {
    family: unique.map((n) => (n === "monospace" ? n : `"${n}"`)).join(", "),
    size: Math.round(pt * (96 / 72) * 10) / 10,
  };
}
