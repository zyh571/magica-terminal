// Build the neutral launcher fallback: Kyubey's in-app pixel sprite on the same grey circle as the taskbar lab.
// Run this before `npx tauri icon src-tauri/icons/icon.svg` when the sprite changes.
import { writeFileSync } from "node:fs";

const sprite = [
  "..................", ".WW............WW.", ".WWW..........WWW.", "..WWWWWWWWWWWWWW..",
  "..WWWWWWWWWWWWWW..", ".WWWWWWWWWWWWWWWW.", ".WWWWWWWWWWWWWWWW.", ".WWWRRWWWWWWRRWWW.",
  ".WWWRRWWWWWWRRWWW.", ".WWWWWWWWWWWWWWWW.", ".WWWWWWWPPWWWWWWW.", "..WWWWWWWWWWWWWW..",
  "..PWWWWWWWWWWWWP..", ".PW.WWWWWWWWWW.WP.", ".W...WWWWWWWW...W.", ".W..............W.",
  ".P..............P.", "..................",
];
const colours = { W: "#f6f6f8", R: "#d6213b", P: "#f28cb1" };
const filled = new Map();
sprite.forEach((row, y) => [...row].forEach((cell, x) => {
  if (colours[cell]) filled.set(`${x},${y}`, cell);
}));
const edge = new Set();
for (const key of filled.keys()) {
  const [x, y] = key.split(",").map(Number);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const neighbour = `${x + dx},${y + dy}`;
    if (!filled.has(neighbour)) edge.add(neighbour);
  }
}
const rects = (points, fill) => [...points].map((key) => {
  const [x, y] = key.split(",");
  return `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
}).join("");
const pixels = Object.entries(colours).map(([cell, fill]) =>
  rects([...filled].filter(([, value]) => value === cell).map(([key]) => key), fill)).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <circle cx="256" cy="256" r="246" fill="#7a7a80"/>
  <g transform="translate(87 87) scale(18.8)" shape-rendering="crispEdges">
    ${rects(edge, "#282430")}
    ${pixels}
  </g>
</svg>\n`;
writeFileSync(new URL("../src-tauri/icons/icon.svg", import.meta.url), svg);
