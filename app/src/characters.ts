// The characters: name, icon, colour on dark, colour on light, and the witch she becomes. Dark is the witches' side:
// her name there is her witch's, and her colour is her own gone murky (half the saturation, darkened only as far as
// it stays readable; Kyoko's leans to orange so she doesn't turn into Madoka's pink). Kyubey takes over a pane running a root shell.
export type CharName = "madoka" | "homura" | "sayaka" | "mami" | "kyoko" | "kyubey";

export interface Character {
  name: CharName;
  icon: string;
  dark: string;
  light: string;
  witch: string;
}

export const CHARACTERS: Character[] = [
  { name: "madoka", icon: "🎀", dark: "#d88aab", light: "#a02e5c", witch: "kriemhild" },
  { name: "homura", icon: "⏳", dark: "#a896dc", light: "#6447ae", witch: "homulilly" },
  { name: "sayaka", icon: "🎵", dark: "#7fa3d4", light: "#265a9c", witch: "oktavia" },
  { name: "mami", icon: "🫖", dark: "#bca35b", light: "#75540b", witch: "candeloro" },
  { name: "kyoko", icon: "🍎", dark: "#e3897c", light: "#a92934", witch: "ophelia" },
];
export const KYUBEY: Character = { name: "kyubey", icon: "", dark: "#f4f4f4", light: "#1f1f24", witch: "kyubey" };
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

/** Her name as the prompt shows it: in dark, her witch's (Kyubey stays Kyubey). */
export function shownName(name: CharName, theme: "dark" | "light"): string {
  return theme === "dark" ? (characterNamed(name)?.witch ?? name) : name;
}

export function characterNamed(name: string): Character | undefined {
  return ALL_CHARACTERS.find((c) => c.name === name);
}

/** The character after `name`, for new panes (Kyubey isn't one). */
export function nextCharacter(name: string | undefined): Character {
  const i = CHARACTERS.findIndex((c) => c.name === name);
  return CHARACTERS[(i + 1) % CHARACTERS.length];
}
