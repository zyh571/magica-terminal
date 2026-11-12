// Things that open over a pane's terminal (the game, the notepad, `space`) and what they may ask of the pane.
import type { Settings } from "./settings";
import type { ThemeName } from "./theme";

export interface Overlay {
  kind: "crush" | "note" | "space";
  el: HTMLElement;
  focus(): void;
  /** Called when it's closed (by itself, Ctrl/Cmd+W, or the pane going away). */
  dispose(): void;
  /** The theme or her colour changed. */
  restyle?(): void;
}

export interface PaneHost {
  settings: Settings;
  theme(): ThemeName;
  colour(): string;
  /** Close this overlay and go back to the prompt. */
  closeOverlay(): void;
  /** Type into the pane's shell. */
  sendToShell(text: string): void;
  shellKind(): "posix" | "pwsh";
  fontFamily(): string;
}
