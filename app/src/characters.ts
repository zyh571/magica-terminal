// The characters: name, icon, colour on dark, colour on light. Kyubey takes over a pane running a root shell.
export type CharName = "madoka" | "homura" | "sayaka" | "mami" | "kyoko" | "kyubey";

export interface Character {
  name: CharName;
  icon: string;
  dark: string;
  light: string;
}

export const CHARACTERS: Character[] = [
  { name: "madoka", icon: "🎀", dark: "#ff9cc6", light: "#c2386f" },
  { name: "homura", icon: "⏳", dark: "#b9a0ff", light: "#6a4bb8" },
  { name: "sayaka", icon: "🎵", dark: "#8cbcff", light: "#2f6fc0" },
  { name: "mami", icon: "🫖", dark: "#f2cf6b", light: "#9a6f0e" },
  { name: "kyoko", icon: "🍎", dark: "#ff7a86", light: "#c22f3c" },
];
export const KYUBEY: Character = { name: "kyubey", icon: "", dark: "#f4f4f4", light: "#1f1f24" };
export const ALL_CHARACTERS: Character[] = [...CHARACTERS, KYUBEY];

/** Kyubey is only white, grey and black: name / text / path / accent ('@magica' and '#'). */
export const KYUBEY_GREYS = {
  dark: ["#f4f4f4", "#c9c9cc", "#9b9ba0", "#8a8a8f"],
  light: ["#1f1f24", "#46464c", "#6b6b72", "#7a7a80"],
} as const;

/** Palette slots 100…117: three per character (name, text, path), in this order; 118: Kyubey's accent. */
export const CHAR_SLOTS = 100;
export const RED_SLOT = 118;

export function slotOf(name: CharName): number {
  return CHAR_SLOTS + 3 * ALL_CHARACTERS.findIndex((c) => c.name === name);
}

export function characterNamed(name: string): Character | undefined {
  return ALL_CHARACTERS.find((c) => c.name === name);
}

/** The character after `name`, for new panes (Kyubey isn't one). */
export function nextCharacter(name: string | undefined): Character {
  const i = CHARACTERS.findIndex((c) => c.name === name);
  return CHARACTERS[(i + 1) % CHARACTERS.length];
}
