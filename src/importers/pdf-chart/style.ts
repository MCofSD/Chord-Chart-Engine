/** Reading the legacy charts' styling through the rules file: color names, sizes, beat tags. */
import { RULES } from "../../rules/index.js";
import type { Glyph } from "./extract.js";

export type ColorName = "black" | "gray" | "red" | "green" | "blue" | "lightBlue" | "other";

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const near = (a: string, b: string) => {
  const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b);
  return Math.max(Math.abs(r1! - r2!), Math.abs(g1! - g2!), Math.abs(b1! - b2!)) <= RULES.import.colorTolerance;
};

const L = RULES.legend.colors;
const NAMED: [ColorName, string[]][] = [
  ["black", [L.black]],
  ["gray", RULES.import.lyricColors],
  ["red", [L.red, L.beatRed]],
  ["green", [L.green]],
  ["blue", [L.blue]],
  ["lightBlue", RULES.render.riffColors.slice(1)],
];

export function colorName(hex: string): ColorName {
  for (const [name, values] of NAMED) if (values.some((v) => near(hex, v))) return name;
  return "other";
}

/** Beats after beat 1 -> beat tag ("2", "1&", "3e", "4a"); null if not on a 16th. */
export function beatTag(beats: number): string | null {
  const q = Math.round(beats * 4);
  if (Math.abs(q - beats * 4) > 1e-6 || q < 0) return null;
  const n = Math.floor(q / 4) + 1, sub = q % 4;
  return `${n}${["", "e", "&", "a"][sub]}`;
}

/** Characters of a run of glyphs, with spaces where the gap is wider than rules.import.wordGap. */
export function textOf(glyphs: Glyph[]): string {
  let s = "";
  let prev: Glyph | undefined;
  for (const g of glyphs) {
    if (g.ch === " ") { if (s && !s.endsWith(" ")) s += " "; continue; }
    if (prev && !s.endsWith(" ") && g.x0 - prev.x1 > RULES.import.wordGap * Math.max(g.size, prev.size)) s += " ";
    s += g.ch;
    prev = g;
  }
  return s;
}

/** Median of numbers (0 for none). */
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
