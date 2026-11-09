/**
 * renderChart(chart) -> one SVG string per US Letter page.
 *
 * Pure and deterministic: font metrics are static tables, so the same chart
 * always produces the same SVG, with no DOM or browser (CLAUDE.md §6.5, §7).
 * Headless Chromium can print the pages to PDF later.
 */
import { resolveRepeats, type Block, type Chart, type Meter, type NoteBlock, type SectionRef, type SnippetBlock } from "../model/chart.js";
import { itemRuns } from "./items.js";
import { fitLine, type LaidLine } from "./line.js";
import { DEFAULT_METER, lineTiming } from "./timing.js";
import { esc, fmt, runsToSvg, runsWidth, type Run } from "./runs.js";
import { CHART } from "./tokens.js";
import { textWidth } from "../text/metrics.js";

export interface RenderChartOptions {
  /** Lowest y a section rule may sit at before the section moves to the next page. */
  bottomLimit?: number;
}

export interface RenderedChart {
  pages: string[];
  warnings: string[];
}

const P = CHART;

/** "1st Ver" -> "1" + superscript "st" + " Ver". */
function labelRuns(label: string, fill: string, bold: boolean): Run[] {
  const face = bold ? "arialBold" : "arial";
  const m = label.match(/^(\d+)(st|nd|rd|th)\b(.*)$/);
  if (!m) return [{ kind: "text", text: label, size: P.section.labelSize, face, fill }];
  return [
    { kind: "text", text: m[1]!, size: P.section.labelSize, face, fill },
    { kind: "text", text: m[2]!, size: P.section.ordinalSize, face, fill, dy: -P.section.ordinalRaise },
    { kind: "text", text: m[3]!, size: P.section.labelSize, face, fill },
  ];
}

/** Color of each repeated section, and which section each Repeat piece points to. */
interface RepeatColors { bySection: Map<number, string>; refs: Map<SectionRef, number> }

/**
 * Repeated sections are colored in priority order from the top of the chart:
 * blue, green, purple (owner, 2026-11-08). A fourth reuses the last color.
 */
function repeatColors(chart: Chart, warnings: string[]): RepeatColors {
  const { targets, refs, unresolved } = resolveRepeats(chart);
  warnings.push(...unresolved);
  const palette = P.repeatColors;
  const bySection = new Map<number, string>();
  [...targets].sort((a, b) => a - b).forEach((index, rank) => {
    if (rank === palette.length) warnings.push(`more than ${palette.length} repeated sections; "${chart.sections[index]!.label}" and later reuse the last color`);
    bySection.set(index, palette[Math.min(rank, palette.length - 1)]!);
  });
  return { bySection, refs };
}

/** Colored (bold) only when a later "Repeat ..." points back here, so the reader can find it. */
function sectionStyle(index: number, colors: RepeatColors): { fill: string; bold: boolean } {
  const fill = colors.bySection.get(index);
  return fill ? { fill, bold: true } : { fill: P.colors.ink, bold: false };
}

/** A laid block; a line that wrapped has several rows, each a chord row and a lyric row. */
interface LaidBlock { block: Block; rows?: LaidLine[] }

/**
 * Vertical spacing. Normally the measured values; tightened toward
 * render.squish when that keeps a chart within render.page.targetPages.
 */
interface Vertical { rowHeight: number; baseline: number; padTop: number; padBottom: number }

/** Vertical spacing squished by `s` (0 = the rules' max, used whenever there is room; 1 = the minimums). */
function vertical(s: number): Vertical {
  const Q = P.squish, lerp = (a: number, b: number) => a + (b - a) * s;
  const rowHeight = lerp(P.row.height, Q.minRowHeight);
  // The baseline keeps its distance from the row's bottom (room for descenders).
  return { rowHeight, baseline: rowHeight - (P.row.height - P.row.baseline), padTop: lerp(P.section.padTop, Q.minPadTop), padBottom: lerp(P.section.padBottom, Q.minPadBottom) };
}

function blockHeight(b: LaidBlock, V: Vertical): number {
  if (b.block.kind === "snippet") return b.block.height;
  if (b.block.kind === "note") return V.rowHeight;
  return b.rows!.reduce((h, r) => h + rowCount(r), 0) * V.rowHeight;
}

const rowCount = (line: LaidLine) => Math.max((line.chords.length ? 1 : 0) + (line.lyrics.length ? 1 : 0), 1);

/** Time axis of a snippet's image (time in beats -> x), if it declares one. */
function snippetAxis(snippet: SnippetBlock, meter: Meter): ((t: number) => number) | undefined {
  const bars = snippet.timeline?.bars;
  if (!bars?.length) return undefined;
  return (t) => {
    const k = Math.min(Math.max(Math.floor(t / meter.top), 0), bars.length - 1);
    const bar = bars[k]!;
    return P.content.left + bar.x + (t - k * meter.top) * (bar.width / meter.top);
  };
}

/** Lays out a section's blocks; `meter` carries inline meter changes from line to line. */
function layoutBlocks(blocks: Block[], meter: { current: Meter }): LaidBlock[] {
  return blocks.map((block, i) => {
    if (block.kind !== "line") return { block };
    const prev = blocks[i - 1];
    const axis = prev?.kind === "snippet" ? snippetAxis(prev, meter.current) : undefined;
    const rows = fitLine(block, axis ? { meter: meter.current, axis } : { meter: meter.current });
    meter.current = lineTiming(block, meter.current).endMeter;
    return { block, rows };
  });
}

function sectionHeight(blocks: LaidBlock[], V: Vertical): number {
  return V.padTop + blocks.reduce((h, b) => h + blockHeight(b, V), 0) + V.padBottom;
}

function noteRuns(note: NoteBlock, colors: RepeatColors): Run[] {
  return note.pieces.map((p): Run => {
    if ("section" in p) {
      const target = colors.refs.get(p);
      const fill = (target !== undefined && colors.bySection.get(target)) || P.colors.ink;
      return { kind: "text", text: p.text, size: P.note.sectionSize, face: "arialBold", fill };
    }
    return { kind: "text", text: p.text, size: P.note.size, face: "arial", fill: P.colors.ink };
  });
}

function placedSvg(line: { x: number; runs: Run[] }[], baseline: number): string {
  return line.map((p) => runsToSvg(p.runs, p.x, baseline).svg).join("");
}

/** SVG for one block whose rows start at `top`. */
function blockSvg(b: LaidBlock, top: number, colors: RepeatColors, V: Vertical): string {
  const { block } = b;
  if (block.kind === "snippet") {
    let svg = `<image href="${esc(block.src)}" x="${fmt(P.content.left)}" y="${fmt(top)}" width="${fmt(block.width)}" height="${fmt(block.height)}" preserveAspectRatio="none"/>`;
    for (const o of block.overlay ?? []) {
      const runs = o.items.flatMap((item, i) => (i ? [{ kind: "space", width: P.spacing.itemGap } as Run, ...itemRuns(item)] : itemRuns(item)));
      const x = o.alignRight ? P.content.right - runsWidth(runs) : P.content.left + o.x;
      svg += runsToSvg(runs, x, top + P.section.labelBaselineOverSnippet).svg;
    }
    return svg;
  }
  if (block.kind === "note") return runsToSvg(noteRuns(block, colors), P.section.labelX, top + V.baseline).svg;

  let y = top;
  let out = "";
  for (const line of b.rows!) {
    let svg = "";
    if (line.chords.length) { svg += placedSvg(line.chords, y + V.baseline); y += V.rowHeight; }
    if (line.lyrics.length) { svg += placedSvg(line.lyrics, y + V.baseline); y += V.rowHeight; }
    if (!line.chords.length && !line.lyrics.length) y += V.rowHeight;
    if (line.scaleX < 1) {
      const l = P.content.left;
      svg = `<g transform="translate(${fmt(l)} 0) scale(${line.scaleX.toFixed(4)} 1) translate(${fmt(-l)} 0)">${svg}</g>`;
    }
    out += svg;
  }
  return out;
}

function headerSvg(chart: Chart): string {
  const H = P.header;
  const m = chart.meta;
  let svg = "";
  if (m.date) {
    const [y, mo, d] = m.date.split("-").map(Number);
    svg += runsToSvg([{ kind: "text", text: `${mo}/${d}/${y}`, size: H.dateSize, face: "calibri", fill: P.colors.ink }], H.left, H.baseline).svg;
  }
  const artist = ` (${m.artist}${m.year ? `, ${m.year}` : ""})`;
  const title: Run[] = [
    { kind: "text", text: m.title.toUpperCase(), size: H.titleSize, face: "calibriBold", fill: P.colors.ink },
    { kind: "text", text: artist, size: H.artistSize, face: "calibri", fill: P.colors.ink },
  ];
  svg += runsToSvg(title, H.titleCenter - runsWidth(title) / 2, H.baseline).svg;
  const keyText = `(Key of ${m.key}${m.bpm ? `, BPM=${m.bpm}` : ""})`;
  svg += runsToSvg([{ kind: "text", text: keyText, size: H.keySize, face: "calibri", fill: P.colors.ink }], H.right - textWidth(keyText, H.keySize, "calibri"), H.baseline).svg;
  return svg;
}

const rule = (y: number) =>
  `<rect x="${fmt(P.rule.x1)}" y="${fmt(y)}" width="${fmt(P.rule.x2 - P.rule.x1)}" height="${fmt(P.rule.thickness)}" fill="${P.colors.rule}"/>`;

export function renderChart(chart: Chart, options: RenderChartOptions = {}): RenderedChart {
  const bottom = options.bottomLimit ?? P.page.bottomLimit;
  const warnings: string[] = [];
  const colors = repeatColors(chart, warnings);
  const meter = { current: chart.meta.meter ?? DEFAULT_METER };
  const laid = chart.sections.map((section) => {
    const blocks = layoutBlocks(section.blocks, meter);
    for (const b of blocks) for (const r of b.rows ?? []) for (const w of r.warnings) warnings.push(`${section.label || section.type}: ${w}`);
    return blocks;
  });

  // Owner (2026-11-09): keep each section whole on its page; if the chart would
  // run past the target page count, squish vertical spacing just enough to fit.
  const target = P.page.targetPages;
  const paginateAt = (s: number) => paginate(chart, laid, colors, vertical(s), bottom);
  let pages = paginateAt(0);
  // Squish only when that keeps the chart within the target; a longer chart keeps normal spacing.
  if (pages.length > target && paginateAt(1).length <= target) {
    let lo = 0, hi = 1; // smallest squish that fits
    for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (paginateAt(mid).length <= target) hi = mid; else lo = mid; }
    pages = paginateAt(hi);
    warnings.push(`vertical spacing tightened to fit ${target} page(s): rows ${vertical(hi).rowHeight.toFixed(2)} pt (max ${P.row.height}, min ${P.squish.minRowHeight})`);
  }
  return finish(chart, pages, warnings);
}

/** Lays sections onto pages. A section moves whole to the next page if it doesn't fit; it splits only if taller than a page. */
function paginate(chart: Chart, laid: LaidBlock[][], colors: RepeatColors, V: Vertical, bottom: number): string[][] {
  const pages: string[][] = [[headerSvg(chart), rule(P.rule.firstY)]];
  let y = P.rule.firstY;
  const newPage = () => {
    pages.push([rule(P.rule.firstY)]);
    y = P.rule.firstY;
  };
  for (const [index, section] of chart.sections.entries()) {
    let blocks = laid[index]!;
    if (y + sectionHeight(blocks, V) > bottom && y > P.rule.firstY) newPage();

    let first = true;
    while (blocks.length) {
      let take = blocks.length;
      while (take > 1 && y + sectionHeight(blocks.slice(0, take), V) > bottom) take--;
      const part = blocks.slice(0, take);
      blocks = blocks.slice(take);

      const page = pages[pages.length - 1]!;
      const top = y + V.padTop;
      if (first && section.label) {
        const { fill, bold } = sectionStyle(index, colors);
        const firstBlock = part[0]!.block;
        const labelBaseline = firstBlock.kind === "snippet" ? y + P.section.labelBaselineOverSnippet : top + V.baseline;
        page.push(runsToSvg(labelRuns(section.label, fill, bold), P.section.labelX, labelBaseline).svg);
      }
      let rowTop = top;
      for (const b of part) {
        page.push(blockSvg(b, rowTop, colors, V));
        rowTop += blockHeight(b, V);
      }
      y = rowTop + V.padBottom;
      page.push(rule(y));
      first = false;
      if (blocks.length) newPage();
    }
  }
  return pages;
}

function finish(chart: Chart, pages: string[][], warnings: string[]): RenderedChart {
  const total = pages.length;
  if (total > P.page.targetPages) warnings.push(`chart is ${total} pages; the aim is ${P.page.targetPages} or fewer`);
  return {
    warnings,
    pages: pages.map((body, i) => {
      const footer = `Page ${i + 1} of ${total}`;
      const fx = (P.page.width - textWidth(footer, P.footer.size, "calibri")) / 2;
      const foot = runsToSvg([{ kind: "text", text: footer, size: P.footer.size, face: "calibri", fill: P.colors.ink }], fx, P.footer.baseline).svg;
      return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${P.page.width} ${P.page.height}" width="8.5in" height="11in">` +
        `<title>${esc(chart.meta.title)}, page ${i + 1} of ${total}</title>` +
        `<rect width="${P.page.width}" height="${P.page.height}" fill="#FFFFFF"/>` +
        body.join("") +
        foot +
        `</svg>`
      );
    }),
  };
}
