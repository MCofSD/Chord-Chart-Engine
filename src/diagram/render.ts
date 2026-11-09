/**
 * renderDiagram(voicing, options) -> SVG string (CLAUDE.md §6.1).
 *
 * Pure and deterministic: no DOM, no globals, no randomness. Superscripts are
 * placed with explicit y coordinates (no baseline-shift), so every renderer
 * draws them in the same place.
 */
import { chordLabel, rowOfFret, type ChordName, type Voicing } from "../model/voicing.js";
import { FLAT, SHARP, type GlyphOutline as AccidentalGlyph } from "../text/glyphs.js";
import { textWidth } from "../text/metrics.js";
import { TOKENS as T } from "./tokens.js";

export interface RenderOptions {
  /** Cover scale: 1 = 100% (1.39" wide), 0.65, 0.6 ... Default 1. */
  scale?: number;
  /** Units of the width/height attributes. Default "in". */
  unit?: "in" | "px";
  /** Pixels per inch when unit is "px". Default 96. */
  dpi?: number;
  /** Optional id prefix / title override. */
  title?: string;
  /**
   * How flats and sharps are printed. "symbol" (default) draws ♭/♯ outlines;
   * "letter" prints "b"/"#" like the Corel originals (used by the visual test).
   */
  accidentals?: "symbol" | "letter";
}

/** Output coordinates: 1 R = 100 user units. */
const U = 100;
const n = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface DiagramGeometry {
  width: number;
  height: number;
  gridLeft: number;
  gridTop: number;
  stringX: (i: number) => number;
  rowCenterY: (row: number) => number;
}

/** Geometry in output user units (exported for tests and the cover layout later). */
export function diagramGeometry(): DiagramGeometry {
  const top = (T.box.headroom + T.grid.top) * U;
  const left = T.grid.left * U;
  return {
    width: T.box.width * U,
    height: (T.box.height + T.box.headroom) * U,
    gridLeft: left,
    gridTop: top,
    stringX: (i) => left + i * T.grid.stringSpacing * U,
    rowCenterY: (row) => top + (T.grid.band + row + 0.5) * U,
  };
}

export function renderDiagram(voicing: Voicing, options: RenderOptions = {}): string {
  const scale = options.scale ?? 1;
  const g = diagramGeometry();
  const { dark, gray, light } = T.colors;
  const gridW = (T.grid.strings - 1) * T.grid.stringSpacing * U;
  const gridH = (T.grid.band + T.grid.rows) * U;
  const parts: string[] = [];

  // Grid: frame, inner strings, band line and fret lines.
  const grid: string[] = [`<rect x="${n(g.gridLeft)}" y="${n(g.gridTop)}" width="${n(gridW)}" height="${n(gridH)}"/>`];
  for (let i = 1; i < T.grid.strings - 1; i++) {
    const x = n(g.stringX(i));
    grid.push(`<line x1="${x}" y1="${n(g.gridTop)}" x2="${x}" y2="${n(g.gridTop + gridH)}"/>`);
  }
  for (let r = 0; r < T.grid.rows; r++) {
    const y = n(g.gridTop + (T.grid.band + r) * U);
    grid.push(`<line x1="${n(g.gridLeft)}" y1="${y}" x2="${n(g.gridLeft + gridW)}" y2="${y}"/>`);
  }
  parts.push(`<g fill="none" stroke="${dark}" stroke-width="${n(T.grid.stroke * U)}">${grid.join("")}</g>`);

  // Barres: gray across the whole span, dark over sounding ranges.
  const barH = T.barre.height * U;
  const barSw = n(T.barre.stroke * U);
  const bar = (from: number, to: number, cy: number, color: string) =>
    `<rect x="${n(g.stringX(from))}" y="${n(cy - barH / 2)}" width="${n(g.stringX(to) - g.stringX(from))}" height="${n(barH)}" fill="${color}" stroke="${color}" stroke-width="${barSw}"/>`;
  for (const b of voicing.barres ?? []) {
    const row = rowOfFret(voicing, b.fret);
    if (row === undefined) continue;
    const cy = g.rowCenterY(row);
    parts.push(bar(b.from, b.to, cy, gray));
    for (const [a, z] of b.sounding) parts.push(bar(a, z, cy, dark));
  }

  // Dots.
  const r = T.dot.radius * U;
  const fingerFs = T.dot.fingerFontSize * U;
  voicing.strings.forEach((s, i) => {
    if (s.kind !== "fretted" && s.kind !== "muted") return;
    const row = rowOfFret(voicing, s.fret);
    if (row === undefined) return;
    const cx = g.stringX(i), cy = g.rowCenterY(row);
    const color = s.kind === "fretted" ? dark : gray;
    const label = s.kind === "fretted" ? (s.finger !== undefined ? String(s.finger) : "") : "X";
    parts.push(
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${color}" stroke="${color}" stroke-width="${n(T.dot.stroke * U)}"/>`,
    );
    if (label) {
      parts.push(
        `<text x="${n(cx)}" y="${n(cy + T.dot.fingerBaseline * U)}" font-size="${n(fingerFs)}" font-weight="700" text-anchor="middle" fill="${light}">${esc(label)}</text>`,
      );
    }
  });

  // Text in dark: chord name, open-string x marks, fret number.
  const text: string[] = [];
  text.push(...renderName(voicing.chord, g, gridW, options.accidentals ?? "symbol"));
  const muteY = n(g.gridTop - T.openMute.baselineAboveGrid * U);
  voicing.strings.forEach((s, i) => {
    if (s.kind === "mutedOpen") {
      text.push(`<text x="${n(g.stringX(i))}" y="${muteY}" font-size="${n(T.openMute.fontSize * U)}" text-anchor="middle">x</text>`);
    }
  });
  if (voicing.fretLabelRow !== undefined) {
    const fret = voicing.windowStartFret + voicing.fretLabelRow;
    text.push(
      `<text x="${n(g.gridLeft - T.fretLabel.gapToGrid * U)}" y="${n(g.rowCenterY(voicing.fretLabelRow) + T.fretLabel.baselineBelowRowCenter * U)}" font-size="${n(T.fretLabel.fontSize * U)}" font-style="italic" text-anchor="end">${fret}</text>`,
    );
  }
  parts.push(`<g fill="${dark}">${text.join("")}</g>`);

  const unit = options.unit ?? "in";
  const physW = T.box.width * T.inchesPerR * scale;
  const physH = (T.box.height + T.box.headroom) * T.inchesPerR * scale;
  const size =
    unit === "in"
      ? `width="${physW.toFixed(4)}in" height="${physH.toFixed(4)}in"`
      : `width="${n(physW * (options.dpi ?? 96))}" height="${n(physH * (options.dpi ?? 96))}"`;
  const title = esc(options.title ?? chordLabel(voicing.chord));

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(g.width)} ${n(g.height)}" ${size} role="img" aria-label="${title} chord diagram" font-family="${esc(T.fontFamily)}">` +
    `<title>${title}</title>` +
    parts.join("") +
    `</svg>`
  );
}

interface Run { s: string; fs: number; y: number }

/** A text run, or a flat/sharp drawn as an outline at the run's size and baseline. */
type Piece =
  | { kind: "text"; run: Run }
  | { kind: "glyph"; glyph: AccidentalGlyph; run: Run }
  /** Horizontal adjustment only (negative = pull the next piece left). */
  | { kind: "kern"; width: number };

const glyphEm = (fs: number) => fs * T.name.accidentalGlyphScale;
const pieceWidth = (p: Piece) =>
  p.kind === "kern" ? p.width : p.kind === "text" ? textWidth(p.run.s, p.run.fs) : (p.glyph.advance * glyphEm(p.run.fs)) / 1000;

/**
 * Splits a run into text and accidental glyphs. In the accidental slot every
 * "b"/"#" is a flat/sharp; inside a quality only a "b"/"#" before a digit is
 * (e.g. "7(b9b13)"), so letters in words like "sus" or "add" are untouched.
 */
function pieces(run: Run, mode: "symbol" | "letter", wholeRunIsAccidental: boolean): Piece[] {
  if (mode === "letter") return [{ kind: "text", run }];
  const re = wholeRunIsAccidental ? /[b#]/g : /[b#](?=\d)/g;
  const out: Piece[] = [];
  let last = 0;
  for (const m of run.s.matchAll(re)) {
    if (m.index > last) out.push({ kind: "text", run: { ...run, s: run.s.slice(last, m.index) } });
    out.push({ kind: "glyph", glyph: m[0] === "b" ? FLAT : SHARP, run: { ...run, s: m[0] } });
    last = m.index + 1;
  }
  if (last < run.s.length) out.push({ kind: "text", run: { ...run, s: run.s.slice(last) } });
  return out;
}

/**
 * Flats sit on the run's baseline as designed. Sharps are lifted so the bottom
 * of their ink sits on the baseline, bottom-aligned with the root letter
 * (owner, 2026-11-08); in a superscript, on the superscript's baseline.
 */
function glyphPath(p: Extract<Piece, { kind: "glyph" }>, x: number): string {
  const scale = glyphEm(p.run.fs) / 1000;
  const isSharp = p.glyph === SHARP;
  const y = isSharp ? p.run.y + p.glyph.yMin * scale : p.run.y;
  return `<path data-accidental="${isSharp ? "sharp" : "flat"}" transform="translate(${n(x)} ${n(y)}) scale(${scale.toFixed(5)})" d="${p.glyph.path}"/>`;
}

/** Chord name as separate runs at explicit positions, centered over the grid. */
function renderName(c: ChordName, g: DiagramGeometry, gridW: number, mode: "symbol" | "letter"): string[] {
  const rootFs = T.name.rootFontSize * U;
  const accFs = T.name.accidentalFontSize * U;
  const qFs = T.name.qualityFontSize * U;
  const base = g.gridTop - T.name.baselineAboveGrid * U;
  const supBase = base - T.name.qualityRaise * U;

  const all: Piece[] = [{ kind: "text", run: { s: c.root, fs: rootFs, y: base } }];
  if (c.accidental) all.push(...pieces({ s: c.accidental, fs: accFs, y: base }, mode, true));
  if (c.quality) all.push(...pieces({ s: c.quality, fs: qFs, y: supBase }, mode, false));
  if (c.bass) {
    // Slash and bass letter 20 pt, bass accidental scaled the same way; root baseline.
    // After a superscript, tuck the slash under it so no gap shows (e.g. "Bbm7/C").
    if (c.quality) {
      const tuck = c.quality.endsWith(")") ? T.name.slashTuckAfterParen : T.name.slashTuckUnderSuperscript;
      all.push({ kind: "kern", width: -tuck * U });
    }
    all.push({ kind: "text", run: { s: "/" + c.bass.charAt(0), fs: T.name.bassFontSize * U, y: base } });
    if (c.bass.length > 1) all.push(...pieces({ s: c.bass.slice(1), fs: T.name.bassAccidentalFontSize * U, y: base }, mode, true));
  }

  const total = all.reduce((w, p) => w + pieceWidth(p), 0);
  let x = g.gridLeft + gridW / 2 + T.name.offsetX * U - total / 2;
  const out: string[] = [];
  for (const p of all) {
    if (p.kind === "text") out.push(`<text x="${n(x)}" y="${n(p.run.y)}" font-size="${n(p.run.fs)}">${esc(p.run.s)}</text>`);
    else if (p.kind === "glyph") out.push(glyphPath(p, x));
    x += pieceWidth(p);
  }
  return out;
}
