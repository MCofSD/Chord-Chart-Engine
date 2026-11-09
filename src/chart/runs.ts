/**
 * Styled runs: the unit of horizontal layout for chord and lyric lines.
 * Widths come from the generated font metrics, so layout is deterministic
 * and needs no browser.
 */
import { SHARP, type GlyphOutline } from "../text/glyphs.js";
import { textWidth, type Face } from "../text/metrics.js";

export type Run =
  /** `dy`: baseline offset in points, negative = raised. */
  | { kind: "text"; text: string; size: number; face: Face; fill: string; dy?: number }
  /** A symbol drawn as an outline at `size` (its em size). Sharps sit on the baseline. */
  | { kind: "glyph"; glyph: GlyphOutline; size: number; fill: string; dy?: number }
  /** Two digits stacked (inline meter change). */
  | { kind: "stack"; top: string; bottom: string; size: number; face: Face; fill: string }
  | { kind: "space"; width: number };

export function runWidth(r: Run): number {
  switch (r.kind) {
    case "text": return textWidth(r.text, r.size, r.face);
    case "glyph": return (r.glyph.advance * r.size) / 1000;
    case "stack": return Math.max(textWidth(r.top, r.size, r.face), textWidth(r.bottom, r.size, r.face));
    case "space": return r.width;
  }
}

export const runsWidth = (runs: Run[]) => runs.reduce((w, r) => w + runWidth(r), 0);

const FONT_ATTRS: Record<Face, string> = {
  arial: `font-family="Arimo, Arial, 'Liberation Sans', sans-serif"`,
  arialBold: `font-family="Arimo, Arial, 'Liberation Sans', sans-serif" font-weight="700"`,
  arialItalic: `font-family="Arimo, Arial, 'Liberation Sans', sans-serif" font-style="italic"`,
  calibri: `font-family="Carlito, Calibri, sans-serif"`,
  calibriBold: `font-family="Carlito, Calibri, sans-serif" font-weight="700"`,
};

export const fmt = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** SVG for runs starting at (x, y = baseline). Returns the markup and the end x. */
export function runsToSvg(runs: Run[], x: number, y: number): { svg: string; end: number } {
  let svg = "";
  for (const r of runs) {
    if (r.kind === "text" && r.text) {
      // Keep leading/trailing spaces from collapsing in any renderer.
      const space = /^\s|\s$|\s\s/.test(r.text) ? ` xml:space="preserve"` : "";
      svg += `<text x="${fmt(x)}" y="${fmt(y + (r.dy ?? 0))}" font-size="${fmt(r.size)}" ${FONT_ATTRS[r.face]} fill="${r.fill}"${space}>${esc(r.text)}</text>`;
    } else if (r.kind === "glyph") {
      const s = r.size / 1000;
      const lift = r.glyph === SHARP ? r.glyph.yMin * s : 0;
      svg += `<path transform="translate(${fmt(x)} ${fmt(y + (r.dy ?? 0) + lift)}) scale(${s.toFixed(5)})" fill="${r.fill}" d="${r.glyph.path}"/>`;
    } else if (r.kind === "stack") {
      const w = runWidth(r);
      const cx = fmt(x + w / 2);
      svg += `<text x="${cx}" y="${fmt(y - r.size * 0.75)}" font-size="${fmt(r.size)}" ${FONT_ATTRS[r.face]} fill="${r.fill}" text-anchor="middle">${esc(r.top)}</text>`;
      svg += `<text x="${cx}" y="${fmt(y + r.size * 0.2)}" font-size="${fmt(r.size)}" ${FONT_ATTRS[r.face]} fill="${r.fill}" text-anchor="middle">${esc(r.bottom)}</text>`;
    }
    x += runWidth(r);
  }
  return { svg, end: x };
}
