// The Rust side's commands (app/src-tauri/src/lib.rs), typed.
import { Channel, invoke } from "@tauri-apps/api/core";
import type { Settings } from "./settings";

export interface SpawnOpts {
  cwd?: string;
  character: string;
  command?: string[];
  resume?: string;
  cols: number;
  rows: number;
}

export interface Startup {
  overlay: "crush" | "note" | null;
  command: string[] | null;
  os: "linux" | "mac" | "windows";
  home: string;
}

export async function spawnPane(opts: SpawnOpts, onData: (b: Uint8Array) => void, onExit: (code: number) => void): Promise<number> {
  const out = new Channel<ArrayBuffer | number[]>();
  out.onmessage = (b) => onData(b instanceof ArrayBuffer ? new Uint8Array(b) : Uint8Array.from(b));
  const exit = new Channel<number>();
  exit.onmessage = onExit;
  return invoke<number>("pty_spawn", { opts, onOutput: out, onExit: exit });
}

export const writePane = (id: number, data: string) => invoke("pty_write", { id, data }).catch(() => {});
export const resizePane = (id: number, cols: number, rows: number) => invoke("pty_resize", { id, cols, rows }).catch(() => {});
export const killPane = (id: number) => invoke("pty_kill", { id });
export const paneResume = (id: number) => invoke<{ resume: string; cwd: string | null } | null>("pane_resume", { id });
export const getSettings = () => invoke<Settings>("get_settings");
export const startup = () => invoke<Startup>("startup");
export const readText = (name: "note.txt" | "crush.json" | "theme") => invoke<string>("read_text", { name });
export const writeText = (name: "note.txt" | "crush.json" | "theme", text: string) => invoke<boolean>("write_text", { name, text });
export const loadSession = () => invoke<unknown>("load_session");
export const saveSession = (json: string) => invoke<boolean>("save_session", { json });
export const clearSession = () => invoke("clear_session");
export const pathExists = (path: string) => invoke<boolean>("path_exists", { path });

export interface ScanItem { id: number; name: string; size: number; folder: boolean; listed: boolean; error: string | null }
export interface ScanView extends Omit<ScanItem, "name"> { path: string; parent: number | null; children: ScanItem[] }
export const scanNew = (path: string) => invoke<number>("scan_new", { path });
export const scanUp = (id: number) => invoke<number | null>("scan_up", { id });
export const scanView = (id: number, node?: number) => invoke<[ScanView, boolean] | null>("scan_view", { id, node: node ?? null });
export const scanDrop = (id: number) => invoke("scan_drop", { id });
