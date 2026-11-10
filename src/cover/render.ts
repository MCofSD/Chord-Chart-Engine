/**
 * renderCover(chart) -> the cover pages as US Letter SVG strings (CLAUDE.md
 * §4.3, §9): title block, the CHORDS panel with one diagram per chord, and
 * the Music Legend. The cover comes before the chart in the same PDF.
 *
 * Pure and deterministic like renderChart: the layout comes from the solver
 * (layout.ts), every measurement from rules/chart-rules.json ("cover"), the
 * Legend's entries from the registry (src/legend/registry.ts).
 */
import { readFileSync } from "node:fs";
import { chartChords, type Chart, type CoverDiagram } from "../model/chart.js";
import { chordLabel, type ChordName, type Voicing } from "../model/voicing.js";
import { renderDiagram } from "../diagram/render.js";
import { LEGEND } from "../legend/registry.js";
import { RULES } from "../rules/index.js";
import { esc, fmt, runsToSvg, runsWidth, type Run } from "../chart/runs.js";
import { CIRCLED_PLUS, CIRCLED_TIMES } from "../text/glyphs.js";
import { textWidth, type Face } from "../text/metrics.js";
import { parseChordName, pickVoicing } from "../voicings/index.js";
import { solveCover, type CoverLayout, type CoverPageLayout, type Panel } from "./layout.js";

const C = RULES.cover;
const PAGE = RULES.render.page;
const NARROW = RULES.render.narrowScale;

export interface RenderedCover {
  pages: string[];
  warnings: string[];
  layout: CoverLayout;
}

let logoData: string | undefined;
/** The club logo as a data URI, so cover pages are standalone files. */
function logoHref(): string {
  logoData ??= `data:image/png;base64,${readFileSync(new URL(`../../${C.logo.src}`, import.meta.url)).toString("base64")}`;
  return logoData;
}

const logoSvg = (y: number) =>
  `<image href="${logoHref()}" x="${fmt(C.logo.x)}" y="${fmt(y)}" width="${fmt(C.logo.width)}" height="${fmt(C.logo.height)}" filter="url(#logoShadow)"/>`;

const text = (s: string, size: number, face: Face, fill: string, dy?: number): Run =>
  ({ kind: "text", text: s, size, face, fill, ...(dy ? { dy } : {}) });

/** One diagram on the cover: the chord, its voicing and its note. */
interface CoverEntry { chord: ChordName; voicing: Voicing; note?: string; alternate: boolean }

/** The cover's diagrams: chart.cover.diagrams, else every chord of the chart in order of first use. */
function coverEntries(chart: Chart, warnings: string[]): CoverEntry[] {
  // Chords from the chart keep their structure ("F" + quality "b5" is not "Fb" + "5").
  const specs: (Omit<CoverDiagram, "chord"> & { chord: string | ChordName })[] = chart.cover?.diagrams ?? chartChords(chart).map((c) => ({ chord: c }));
  const unapproved: string[] = [];
  const entries: CoverEntry[] = [];
  for (const d of specs) {
    const chord = typeof d.chord === "string" ? parseChordName(d.chord) : d.chord;
    if (!chord) { warnings.push(`cover: "${String(d.chord)}" is not a chord name; left out`); continue; }
    const picked = pickVoicing(chord, d.voicing);
    for (const w of picked.warnings) {
      if (/not yet approved/.test(w)) unapproved.push(chordLabel(chord));
      else warnings.push(`cover: ${w}`);
    }
    const note = d.note ?? picked.voicing.note;
    entries.push({ chord, voicing: picked.voicing, ...(note ? { note } : {}), alternate: d.group === "alternate" });
  }
  if (unapproved.length) warnings.push(`cover: ${unapproved.length} diagram(s) use starter library shapes not yet approved: ${unapproved.join(", ")}`);
  // The solver keeps groups in order: main diagrams first, then the alternates.
  return [...entries.filter((e) => !e.alternate), ...entries.filter((e) => e.alternate)];
}

/** Runs centered on `cx`, narrowed (never shrunk) to `maxWidth` if needed. */
function centered(runs: Run[], cx: number, baseline: number, maxWidth: number, what: string, warnings: string[]): string {
  const w = runsWidth(runs);
  const f = w > maxWidth ? maxWidth / w : 1;
  if (f < NARROW) warnings.push(`cover: the ${what} is ${Math.round((w / maxWidth) * 100)}% of the space; narrowed below Arial Narrow width`);
  const svg = runsToSvg(runs, cx - w / 2, baseline).svg;
  return f === 1 ? svg : `<g transform="translate(${fmt(cx)} 0) scale(${f.toFixed(4)} 1) translate(${fmt(-cx)} 0)">${svg}</g>`;
}

function headerSvg(chart: Chart, which: "beside" | "full", warnings: string[]): string {
  const H = C.header;
  const g = H[which];
  const m = chart.meta;
  let svg = logoSvg(g.logoY);
  for (const y of g.ruleY) {
    svg += `<rect x="${fmt(H.ruleX[0]!)}" y="${fmt(y)}" width="${fmt(H.ruleX[1]! - H.ruleX[0]!)}" height="${fmt(H.ruleThickness)}" fill="${H.ruleColor}"/>`;
  }
  svg += centered([text(m.title.toUpperCase(), H.titleSize, "courier", "#000000")], H.center, g.titleBaseline, H.maxWidth, "title", warnings);
  // "Original" means the chart is in the original key (CLAUDE.md §4.3).
  const original = m.originalKey === undefined || m.originalKey === m.key;
  const sub: Run[] = [
    text(`${m.artist}${m.year ? `, ${m.year}` : ""} `, H.subtitleSize, "courier", "#000000"),
    text(`(Key of ${m.key}${original ? ", Original" : ""})`, H.keySize, "courier", "#000000"),
  ];
  svg += centered(sub, H.center, g.subtitleBaseline, H.maxWidth, "artist line", warnings);
  return svg;
}

function panelSvg(p: Panel, title: string): string {
  const P = C.panel;
  const hb = `<rect x="${fmt(p.x0)}" y="${fmt(p.headerTop)}" width="${fmt(p.x1 - p.x0)}" height="${fmt(P.headerHeight)}" fill="${P.headerFill}" stroke="${P.headerStroke}" stroke-width="${P.headerStrokeWidth}"/>`;
  const body = `<rect x="${fmt(p.x0)}" y="${fmt(p.bodyTop)}" width="${fmt(p.x1 - p.x0)}" height="${fmt(p.bottom - p.bodyTop)}" fill="none" stroke="${P.bodyStroke}" stroke-width="${P.bodyStrokeWidth}"/>`;
  const label = runsToSvg([text(title, P.headerTextSize, "courierBold", P.headerTextColor)], p.x0 + P.padX, p.headerTop + P.headerBaseline).svg;
  return hb + body + label;
}

/** A diagram as a nested SVG at (x, y), sized in points. */
function diagramSvg(v: Voicing, x: number, y: number, scale: number): string {
  return renderDiagram(v, { scale, unit: "px", dpi: 72 }).replace(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" /, `<svg x="${fmt(x)}" y="${fmt(y)}" `);
}

function chordsSvg(chart: Chart, page: CoverPageLayout, pageIndex: number, layout: CoverLayout, entries: CoverEntry[]): string {
  const p = page.chords!;
  const K = C.chords;
  let svg = panelSvg(p, p.title);
  if (p.tuningBaseline !== undefined && chart.meta.tuning) {
    svg += runsToSvg([text(chart.meta.tuning, K.tuningSize, "calibriBoldItalic", K.tuningColor)], p.x0 + C.panel.padX, p.tuningBaseline).svg;
  }
  for (const d of layout.diagrams.filter((d) => d.page === pageIndex)) {
    const e = entries[d.index]!;
    svg += diagramSvg(e.voicing, d.x, d.y, layout.scale);
    if (e.note) {
      const w = textWidth(e.note, K.noteSize, "calibriItalic");
      svg += runsToSvg([text(e.note, K.noteSize, "calibriItalic", K.noteColor)], d.x + layout.width / 2 - w / 2, d.y + layout.height + K.noteBaseline).svg;
    }
  }
  if (page.alternateY !== undefined) {
    const y = page.alternateY + K.alternateRuleWidth;
    const x0 = p.x0 + C.chords.padX, x1 = p.x1 - C.chords.padX;
    for (const dy of [0, K.alternateRuleWidth + K.alternateRuleGap]) {
      svg += `<rect x="${fmt(x0)}" y="${fmt(y + dy)}" width="${fmt(x1 - x0)}" height="${fmt(K.alternateRuleWidth)}" fill="#000000"/>`;
    }
    const label = chart.cover?.alternateLabel ?? "for Acoustic";
    svg += runsToSvg([
      text("Alternate (", K.alternateSize, "calibriItalic", "#000000"),
      text(label, K.alternateSize, "calibriItalic", K.noteColor),
      text("):", K.alternateSize, "calibriItalic", "#000000"),
    ], p.x0 + C.panel.padX, page.alternateY + K.alternateBaseline).svg;
  }
  if (page.continuedBaseline !== undefined) {
    const t = K.continuedText;
    svg += runsToSvg([text(t, K.tuningSize, "calibriBoldItalic", K.tuningColor)], (p.x0 + p.x1) / 2 - textWidth(t, K.tuningSize, "calibriBoldItalic") / 2, page.continuedBaseline).svg;
  }
  return svg;
}

// ---- Legend ----------------------------------------------------------------

const LG = C.legend;
interface Style { red?: boolean; green?: boolean; blue?: boolean; bold?: boolean; italic?: boolean; sup?: boolean; big?: boolean }

/** Legend markup ("<r>#</r>", "1<sup>st</sup>", "\n") as styled pieces. */
function parseMarkup(src: string, base: Style): { text: string; style: Style }[] {
  const out: { text: string; style: Style }[] = [];
  const stack: Style[] = [base];
  const tags: Record<string, keyof Style> = { r: "red", g: "green", blue: "blue", b: "bold", i: "italic", sup: "sup", big: "big" };
  for (const part of src.split(/(<\/?(?:r|g|blue|b|i|sup|big)>)/)) {
    const m = /^<(\/?)(\w+)>$/.exec(part);
    if (m) {
      if (m[1]) stack.pop();
      else stack.push({ ...stack[stack.length - 1]!, [tags[m[2]!]!]: true });
    } else if (part) out.push({ text: part, style: stack[stack.length - 1]! });
  }
  return out;
}

function styledRun(s: string, st: Style, size: number): Run {
  const fill = st.red ? LG.colors.red : st.green ? LG.colors.green : st.blue ? LG.colors.blue : LG.colors.text;
  const face: Face = st.bold ? "arialBold" : st.italic ? "arialItalic" : "arial";
  const sz = st.big ? LG.bigSize : size;
  return st.sup ? text(s, sz * LG.supScale, face, fill, -sz * LG.supRaise) : text(s, sz, face, fill);
}

type Token = { space: boolean; runs: Run[] };

/** Words and spaces, keeping pieces of one word together ("1" + superscript "st"); "\n" splits paragraphs. */
function tokenize(src: string, base: Style, size: number): Token[][] {
  const paras: Token[][] = [[]];
  let word: Run[] = [];
  const flush = () => { if (word.length) paras[paras.length - 1]!.push({ space: false, runs: word }); word = []; };
  for (const { text: t, style } of parseMarkup(src, base)) {
    for (const piece of t.split(/(\n| +)/)) {
      if (!piece) continue;
      if (piece === "\n") { flush(); paras.push([]); }
      else if (/^ +$/.test(piece)) { flush(); paras[paras.length - 1]!.push({ space: true, runs: [styledRun(piece, style, size)] }); }
      else word.push(styledRun(piece, style, size));
    }
  }
  flush();
  return paras;
}

const tokWidth = (t: Token) => runsWidth(t.runs);

/**
 * Lays out a paragraph from `x`, wrapping at `right`; lines after the first
 * start at `x + indent`. Justified lines stretch their spaces. Returns the SVG
 * and the last baseline.
 */
function paragraph(tokens: Token[], x: number, right: number, baseline: number, lineHeight: number, indent: number, justify: boolean): { svg: string; last: number } {
  const lines: Token[][] = [[]];
  let w = 0;
  for (const t of tokens) {
    const line = lines[lines.length - 1]!;
    const limit = right - x - (lines.length > 1 ? indent : 0);
    if (!t.space && line.length && w + tokWidth(t) > limit + 1e-6) {
      while (line.length && line[line.length - 1]!.space) line.pop();
      lines.push([t]);
      w = tokWidth(t);
      continue;
    }
    if (t.space && !line.length) continue;
    line.push(t);
    w += tokWidth(t);
  }
  let svg = "";
  let y = baseline;
  lines.forEach((line, i) => {
    while (line.length && line[line.length - 1]!.space) line.pop();
    const x0 = x + (i > 0 ? indent : 0);
    const natural = line.reduce((a, t) => a + tokWidth(t), 0);
    const spaces = line.filter((t) => t.space).length;
    const extra = justify && i < lines.length - 1 && spaces ? (right - x0 - natural) / spaces : 0;
    let cx = x0;
    for (const t of line) {
      if (!t.space) svg += runsToSvg(t.runs, cx, y).svg;
      cx += tokWidth(t) + (t.space ? extra : 0);
    }
    if (i < lines.length - 1) y += lineHeight;
  });
  return { svg, last: y };
}

function symbolSvg(symbol: string, size: number, x: number, baseline: number): string {
  if (symbol === "@ref") {
    const d = LG.refDiameter;
    const cx = x + d / 2, cy = baseline - d * 0.36;
    return `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(d / 2)}" fill="${LG.colors.blue}"/>` +
      `<text x="${fmt(cx)}" y="${fmt(cy + d * 0.3)}" font-size="${fmt(d * 0.8)}" font-family="Arimo, Arial, 'Liberation Sans', sans-serif" font-weight="700" fill="#FFFFFF" text-anchor="middle">#</text>`;
  }
  if (symbol === "@circledPlus" || symbol === "@circledTimes") {
    return runsToSvg([{ kind: "glyph", glyph: symbol === "@circledPlus" ? CIRCLED_PLUS : CIRCLED_TIMES, size, fill: LG.colors.red }], x, baseline).svg;
  }
  const runs = parseMarkup(symbol, {}).map((p) => styledRun(p.text, p.style, size));
  return runsToSvg(runs, x, baseline).svg;
}

/** The registry decides what the Legend must say; the rules file says how it reads. */
function checkLegend(warnings: string[]) {
  const confirmed = new Set(LEGEND.filter((e) => e.confirmed).map((e) => e.id));
  const printed = new Set([...LG.footnotes, ...LG.entries].map((e) => e.id));
  for (const id of printed) if (!confirmed.has(id)) warnings.push(`cover: Legend entry "${id}" is not a confirmed registry entry`);
  for (const id of confirmed) if (!printed.has(id)) warnings.push(`cover: registry entry "${id}" is missing from the printed Legend`);
}

function legendSvg(p: Panel, warnings: string[]): string {
  let svg = panelSvg(p, "LEGEND:");
  const x = p.x0 + C.panel.padX;
  const right = p.x1 - LG.rightPad;
  let y = p.bodyTop + LG.footnoteFirstBaseline;
  LG.footnotes.forEach((f, i) => {
    if (i > 0) y += LG.footnoteLineHeight + LG.footnoteGap;
    const r = paragraph(tokenize(f.text, { bold: true }, LG.footnoteSize)[0]!, x, right, y, LG.footnoteLineHeight, LG.footnoteIndent, LG.footnoteJustify);
    svg += r.svg;
    y = r.last;
  });
  const ruleY = y + LG.ruleGap;
  svg += `<rect x="${fmt(x)}" y="${fmt(ruleY)}" width="${fmt(right - x)}" height="${fmt(LG.ruleWidth)}" fill="${LG.colors.rule}"/>`;
  y = ruleY + LG.firstEntryGap;
  LG.entries.forEach((e, i) => {
    const entry = e as { symbol: string; symbolSize?: number; symbolDy?: number; before?: number; text: string };
    y += (i > 0 ? LG.lineHeight + LG.entryGap : 0) + (entry.before ?? 0);
    svg += symbolSvg(entry.symbol, entry.symbolSize ?? LG.textSize, x, y + (entry.symbolDy ?? 0));
    tokenize(entry.text, {}, LG.textSize).forEach((para, k) => {
      if (k > 0) y += LG.lineHeight;
      const r = paragraph(para, x + LG.textIndent, right, y, LG.lineHeight, 0, false);
      svg += r.svg;
      y = r.last;
    });
  });
  if (y > p.bottom) warnings.push(`cover: the Legend runs ${Math.round(y - p.bottom)} pt past its panel`);
  return svg;
}

// ---- Pages -----------------------------------------------------------------

function footerSvg(chart: Chart, page: CoverPageLayout): string {
  const F = C.footer;
  const w = textWidth(F.linkText, F.size, "calibriItalic");
  const x = F.linkCenter - w / 2;
  let svg = `<a href="${esc(F.linkUrl)}">${runsToSvg([text(F.linkText, F.size, "calibriItalic", F.linkColor)], x, F.baseline).svg}` +
    `<rect x="${fmt(x)}" y="${fmt(F.underlineY)}" width="${fmt(w)}" height="${fmt(F.underlineWidth)}" fill="${F.linkColor}"/></a>`;
  if (chart.meta.date && page.kind !== "legendOnly") {
    const [y, mo, d] = chart.meta.date.split("-").map(Number);
    svg += runsToSvg([text(`${mo}/${d}/${y}`, F.size, "calibri", "#000000")], F.dateX, F.baseline).svg;
  }
  return svg;
}

const pageSvg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE.width} ${PAGE.height}" width="8.5in" height="11in">` +
  `<defs><filter id="logoShadow" x="-10%" y="-10%" width="125%" height="130%"><feDropShadow dx="${C.logo.shadow.dx}" dy="${C.logo.shadow.dy}" stdDeviation="${C.logo.shadow.blur}" flood-color="#000000" flood-opacity="${C.logo.shadow.opacity}"/></filter></defs>` +
  `<rect width="${PAGE.width}" height="${PAGE.height}" fill="${C.background}"/>${body}</svg>`;

export function renderCover(chart: Chart): RenderedCover {
  const warnings: string[] = [];
  checkLegend(warnings);
  const entries = coverEntries(chart, warnings);
  const layout = solveCover(entries.map((e) => ({ ...(e.note ? { note: true } : {}), ...(e.alternate ? { alternate: true } : {}) })), { tuning: !!chart.meta.tuning });
  warnings.push(...layout.warnings.map((w) => `cover: ${w}`));
  const pages = layout.pages.map((page, i) => {
    let body = "";
    if (page.header) body += headerSvg(chart, page.header, warnings);
    if (page.logoY !== undefined) body += logoSvg(page.logoY);
    if (page.chords) body += chordsSvg(chart, page, i, layout, entries);
    if (page.legend) body += legendSvg(page.legend, warnings);
    body += footerSvg(chart, page);
    return pageSvg(body);
  });
  return { pages, warnings, layout };
}
