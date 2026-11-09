/**
 * renderChart(chart) -> one SVG string per US Letter page.
 *
 * Pure and deterministic: font metrics are static tables, so the same chart
 * always produces the same SVG, with no DOM or browser (CLAUDE.md §6.5, §7).
 * Headless Chromium can print the pages to PDF later.
 */
import { resolveRepeats, type Block, type Chart, type NoteBlock, type SectionRef } from "../model/chart.js";
import { itemRuns } from "./items.js";
import { layoutLine, type LaidLine } from "./line.js";
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

interface LaidBlock { block: Block; height: number; line?: LaidLine }

function layoutBlock(block: Block): LaidBlock {
  if (block.kind === "snippet") return { block, height: block.height };
  if (block.kind === "note") return { block, height: P.row.height };
  const line = layoutLine(block);
  const rows = (line.chords.length ? 1 : 0) + (line.lyrics.length ? 1 : 0);
  return { block, height: Math.max(rows, 1) * P.row.height, line };
}

function sectionHeight(blocks: LaidBlock[]): number {
  return P.section.padTop + blocks.reduce((h, b) => h + b.height, 0) + P.section.padBottom;
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
function blockSvg(b: LaidBlock, top: number, colors: RepeatColors): string {
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
  if (block.kind === "note") return runsToSvg(noteRuns(block, colors), P.section.labelX, top + P.row.baseline).svg;

  const line = b.line!;
  let y = top;
  let svg = "";
  if (line.chords.length) { svg += placedSvg(line.chords, y + P.row.baseline); y += P.row.height; }
  if (line.lyrics.length) svg += placedSvg(line.lyrics, y + P.row.baseline);
  if (line.scaleX < 1) {
    const l = P.content.left;
    svg = `<g transform="translate(${fmt(l)} 0) scale(${line.scaleX.toFixed(4)} 1) translate(${fmt(-l)} 0)">${svg}</g>`;
  }
  return svg;
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
  const pages: string[][] = [[headerSvg(chart), rule(P.rule.firstY)]];
  let y = P.rule.firstY;

  const newPage = () => {
    pages.push([rule(P.rule.firstY)]);
    y = P.rule.firstY;
  };

  for (const [index, section] of chart.sections.entries()) {
    let blocks = section.blocks.map(layoutBlock);
    for (const b of blocks) for (const w of b.line?.warnings ?? []) warnings.push(`${section.label || section.type}: ${w}`);

    // Move the whole section to a new page if it doesn't fit; split it only if it is taller than a page.
    if (y + sectionHeight(blocks) > bottom && y > P.rule.firstY) newPage();

    let first = true;
    while (blocks.length) {
      let take = blocks.length;
      while (take > 1 && y + sectionHeight(blocks.slice(0, take)) > bottom) take--;
      const part = blocks.slice(0, take);
      blocks = blocks.slice(take);

      const page = pages[pages.length - 1]!;
      const top = y + P.section.padTop;
      if (first && section.label) {
        const { fill, bold } = sectionStyle(index, colors);
        const firstBlock = part[0]!.block;
        const labelBaseline = firstBlock.kind === "snippet" ? y + P.section.labelBaselineOverSnippet : top + P.row.baseline;
        page.push(runsToSvg(labelRuns(section.label, fill, bold), P.section.labelX, labelBaseline).svg);
      }
      let rowTop = top;
      for (const b of part) {
        page.push(blockSvg(b, rowTop, colors));
        rowTop += b.height;
      }
      y = rowTop + P.section.padBottom;
      page.push(rule(y));
      first = false;
      if (blocks.length) newPage();
    }
  }

  const total = pages.length;
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
