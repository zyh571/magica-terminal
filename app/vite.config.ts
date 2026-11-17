import { defineConfig, type Plugin } from "vite";

/** xterm's WebGL renderer paints a background rectangle for every cell whose background word isn't 0, and paints it
 * opaque. Dim, italic, underline styles and overline are flags in that word, so with our see-through background those
 * cells got a solid box in the background colour (black before the theme gave it hers): the "black highlighting"
 * behind dim text in Claude Code. A cell in the default background needs no rectangle (the canvas is cleared to it),
 * so draw one only when the colour mode isn't the default (CM_MASK = 0x3000000). Fails the build if xterm changed. */
function xtermDefaultBackground(): Plugin {
  return {
    name: "magica-xterm-default-background",
    enforce: "pre",
    transform(code, id) {
      if (!/@xterm[\\/]addon-webgl[\\/]lib[\\/]addon-webgl\.m?js$/.test(id)) return null;
      const re = /\((\w+)!==0\|\|(\w+)&&(\w+)!==0\)&&\((\w+)=(\w+)\+\+\*(\w+),this\._updateRectangle\(/g;
      let n = 0;
      const out = code.replace(re, (_m, bg, inv, fg, off, count, per) => {
        n++;
        return `((${bg}&50331648)!==0||${inv}&&${fg}!==0)&&(${off}=${count}++*${per},this._updateRectangle(`;
      });
      if (n !== 2) throw new Error(`magica: @xterm/addon-webgl changed (${n} background-rectangle checks found, expected 2); see vite.config.ts`);
      return { code: out, map: null };
    },
  };
}

// Tauri serves the built files; in dev it points at this server.
export default defineConfig({
  clearScreen: false,
  plugins: [xtermDefaultBackground()],
  optimizeDeps: { exclude: ["@xterm/addon-webgl"] },   // (pre-bundled deps skip plugins in dev)
  server: { port: 1420, strictPort: true },
  build: { target: "es2022", outDir: "dist" },
});
