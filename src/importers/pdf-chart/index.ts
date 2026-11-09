/**
 * PDF chart importer: a legacy Word-made chart PDF -> chart JSON (src/model/chart.ts).
 *
 * Everything it recognizes comes from rules/chart-rules.json: the Legend
 * vocabulary and colors ("symbols", "legend"), section names ("sections"),
 * the alignment rules used to anchor chords ("render.chord" weights), and the
 * legacy files' conventions ("import"). Changing a rule there needs no change
 * here. Uncertain readings are kept and listed in `review` (CLAUDE.md §9:
 * imports get a human review step).
 */
import type { Anchor, Block, Chart, ChartMeta, LineBlock, NoteBlock, RhythmMark, Section, SectionRef, SnippetBlock } from "../../model/chart.js";
import { lineTiming } from "../../chart/timing.js";
import { RULES, sectionTypeOf } from "../../rules/index.js";
import { parseChordRow, type ParsedGroup } from "./chordline.js";
import { extractPdf, type Glyph, type PdfImage, type PdfPage } from "./extract.js";
import { parseLyricRow, type ParsedLyric } from "./lyricline.js";
import { circledOp, measureBars, splitAround } from "./snippet.js";
import { beatTag, colorName, median, textOf } from "./style.js";

const I = RULES.import, C = RULES.render.content;

export interface ReviewItem { where: string; message: string }
export interface ImportResult {
  chart: Chart;
  review: ReviewItem[];
  /** Notation images, referenced by name from snippet blocks. */
  assets: { name: string; png: PdfImage["png"] }[];
}
export interface ImportOptions {
  /** File name, e.g. "Title - Artist (2004).pdf": the most reliable source of title, artist and year. */
  fileName?: string;
}

interface Row { page: number; y: number; glyphs: Glyph[]; mainSize: number; kind: "chord" | "lyric" | "note" }

export function importChartPdf(bytes: Uint8Array, opts: ImportOptions = {}): ImportResult {
  const pages = extractPdf(bytes);
  const review: ReviewItem[] = [];
  const assets: ImportResult["assets"] = [];
  const meta = readHeader(pages, opts.fileName, review);
  const sections: Section[] = [];

  for (const [pi, page] of pages.entries()) {
    const top = pi === 0 ? (page.rules[0] ?? I.headerMaxY) : 0;
    const edges = [...page.rules.filter((y) => y >= top), I.footerMinY];
    for (let k = 0; k + 1 < edges.length; k++) {
      const y0 = edges[k]!, y1 = edges[k + 1]!;
      const band = readBand(page, pi, y0, y1, review, assets, sections);
      if (!band) continue;
      if (band.label || band.isRepeat || !sections.length) sections.push(band.section);
      else sections[sections.length - 1]!.blocks.push(...band.section.blocks); // section continued across a rule or page
    }
  }
  return { chart: { meta, sections }, review, assets };
}

function readHeader(pages: PdfPage[], fileName: string | undefined, review: ReviewItem[]): ChartMeta {
  const p0 = pages[0];
  const limit = p0?.rules[0] ?? I.headerMaxY;
  const head = (p0?.glyphs ?? []).filter((g) => g.y < limit).sort((a, b) => a.x0 - b.x0);
  const text = textOf(head);
  const meta: ChartMeta = { title: "", artist: "", key: "" };
  const date = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (date) meta.date = `${date[3]}-${date[1]!.padStart(2, "0")}-${date[2]!.padStart(2, "0")}`;
  const key = /\(Key of ([^,)]+)(?:,\s*BPM\s*=\s*(\d+))?\)/i.exec(text);
  if (key) { meta.key = key[1]!.trim(); if (key[2]) meta.bpm = Number(key[2]); }
  else review.push({ where: "header", message: "key not found" });
  const byline = /\(([^()]+?),\s*(\d{4})\)/.exec(text);
  const fromName = fileName && /^(.*?) - (.*?) \((\d{4})\)/.exec(fileName.replace(/\.pdf$/i, ""));
  if (fromName) { meta.title = fromName[1]!; meta.artist = fromName[2]!; meta.year = Number(fromName[3]); }
  else {
    const title = head.filter((g) => g.bold).map((g) => g.ch).join("");
    meta.title = title.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    if (byline) { meta.artist = byline[1]!.trim(); meta.year = Number(byline[2]); }
    review.push({ where: "header", message: `title capitalization guessed ("${meta.title}"); pass the file name to read it exactly` });
  }
  return meta;
}

/** Groups glyphs into rows: main-size text by baseline, smaller text joined to the row just below it. */
function toRows(all: Glyph[]): Row[] {
  // Spaces only separate words: they never make or classify a row, and join only a row on their own baseline.
  const glyphs = all.filter((g) => g.ch !== " ");
  const spaces = all.filter((g) => g.ch === " ");
  const main = glyphs.filter((g) => g.size >= I.mainSizeMin).sort((a, b) => a.y - b.y);
  const rows: { y: number; glyphs: Glyph[] }[] = [];
  for (const g of main) {
    const r = rows[rows.length - 1];
    if (r && g.y - r.y < 2.5) r.glyphs.push(g); else rows.push({ y: g.y, glyphs: [g] });
  }
  for (const r of rows) r.y = median(r.glyphs.map((g) => g.y));
  const small = glyphs.filter((g) => g.size < I.mainSizeMin).sort((a, b) => a.y - b.y);
  const smallRows: { y: number; glyphs: Glyph[] }[] = [];
  for (const g of small) {
    const host = rows.filter((r) => g.y <= r.y + 2 && g.y >= r.y - I.rowJoin).sort((a, b) => a.y - b.y)[0];
    if (host) { host.glyphs.push(g); continue; }
    const r = smallRows.find((s) => Math.abs(s.y - g.y) < 7);
    if (r) { r.glyphs.push(g); r.y = Math.max(r.y, g.y); } else smallRows.push({ y: g.y, glyphs: [g] });
  }
  const allRows = [...rows, ...smallRows];
  return allRows.sort((a, b) => a.y - b.y).map((r) => {
    const own = spaces.filter((sp) => sp.y <= r.y + 1.5 && sp.y >= r.y - I.rowJoin && sp.x0 >= Math.min(...r.glyphs.map((g) => g.x0)) - 1);
    const mainSize = median(r.glyphs.filter((g) => g.size >= I.mainSizeMin).map((g) => g.size)) || Math.max(...r.glyphs.map((g) => g.size));
    const text = textOf([...r.glyphs].sort((a, b) => a.x0 - b.x0));
    const letters = r.glyphs.filter((g) => /\p{L}/u.test(g.ch));
    const grayLetters = letters.filter((g) => colorName(g.color) === "gray").length;
    const raised = r.glyphs.some((g) => r.y - g.y >= I.superscriptRaise);
    const bars = r.glyphs.some((g) => g.ch === RULES.symbols.bar);
    const kind: Row["kind"] = text.trimStart().startsWith(RULES.sections.repeatWord) ? "note"
      : letters.length && grayLetters >= letters.length * 0.6 && !raised && !bars ? "lyric" : "chord";
    return { page: r.glyphs[0]!.page, y: r.y, glyphs: [...r.glyphs, ...own], mainSize, kind };
  });
}

function readBand(page: PdfPage, pi: number, y0: number, y1: number, review: ReviewItem[], assets: ImportResult["assets"], earlier: Section[]) {
  const inBand = (y: number) => y > y0 + 0.5 && y < y1 - 0.5;
  const glyphs = page.glyphs.filter((g) => inBand(g.y));
  const images = page.images.filter((im) => inBand(im.y + im.h / 2));
  if (!glyphs.length && !images.length) return undefined;

  // Label column.
  const labelGlyphs = glyphs.filter((g) => g.x0 < I.labelMaxX && g.size <= I.labelMaxSize).sort((a, b) => a.x0 - b.x0);
  const label = textOf(labelGlyphs).trim();
  const where = (y: number) => `${label || "page " + (pi + 1)} (page ${pi + 1}, y ${Math.round(y)})`;
  const flagAt = (y: number) => (message: string) => review.push({ where: where(y), message });

  // Tiny images are the circled plus/times of instrument marks: turn them into glyphs.
  const marks: Glyph[] = images.filter((im) => im.w <= I.circledOps.maxSize && im.h <= I.circledOps.maxSize).map((im) => ({
    ch: circledOp(im) === "only" ? "⊕" : "⊗", x0: im.x, x1: im.x + im.w, y: im.y + im.h * 0.85, size: 12,
    font: "image", bold: true, italic: false, color: RULES.legend.colors.red, page: pi,
  }));
  const snippets = images.filter((im) => im.w >= I.snippetMinWidth);
  const rows = toRows([...glyphs.filter((g) => !labelGlyphs.includes(g)), ...marks]);

  // Split snippets around lyric rows inside them; text over a piece's top band is its overlay.
  type Entry = { y: number; row?: Row; piece?: PdfImage; overlay?: Row[] };
  const entries: Entry[] = [];
  const used = new Set<Row>();
  for (const img of snippets) {
    const inside = rows.filter((r) => r.kind === "lyric" && r.y > img.y + 4 && r.y < img.y + img.h - 2);
    const { pieces, unsplit } = splitAround(img, inside.map((r) => [r.y - 0.8 * r.mainSize, r.y + 0.25 * r.mainSize]));
    for (const u of unsplit) flagAt(u[0])("a lyric line overlaps a notation image with no blank band to split at");
    for (const piece of pieces) {
      const overlay = rows.filter((r) => r.kind !== "lyric" && !used.has(r) && r.y >= piece.y - 2 && r.y <= piece.y + Math.min(16, piece.h));
      overlay.forEach((r) => used.add(r));
      entries.push({ y: piece.y, piece, overlay });
      if (Math.abs(piece.x - C.left) > 2) flagAt(piece.y)(`notation image starts at x ${piece.x.toFixed(1)}, not at the content edge (${C.left}); it will be drawn at the edge`);
    }
    for (const r of rows) if (!used.has(r) && r.kind === "chord" && r.y > img.y + 16 && r.y < img.y + img.h - 2) { used.add(r); flagAt(r.y)("text over the middle of a notation image was dropped"); }
  }
  for (const r of rows) if (!used.has(r)) entries.push({ y: r.y, row: r });
  entries.sort((a, b) => a.y - b.y);

  const blocks: Block[] = [];
  let prevSnippet: SnippetBlock | undefined;
  let prevSnippetX = C.left;
  let isRepeat = false;
  for (let k = 0; k < entries.length; k++) {
    const e = entries[k]!;
    if (e.piece) {
      const name = `snippet-${assets.length + 1}.png`;
      assets.push({ name, png: e.piece.png });
      const block: SnippetBlock = { kind: "snippet", src: name, width: round(e.piece.w), height: round(e.piece.h) };
      // Snippets are drawn at the content edge, so their timeline and overlay are measured from the image's own left edge.
      const bars = measureBars(e.piece);
      if (bars) {
        block.timeline = { bars: bars.map((b) => ({ x: round(b.x), width: round(b.width) })) };
        flagAt(e.y)(`notation image ${name}: bar positions measured automatically (${bars.length} bars); check the timeline`);
      } else flagAt(e.y)(`notation image ${name}: no staff found, so no timeline`);
      const overlay = (e.overlay ?? []).flatMap((r) => parseChordRow(r.glyphs, r.y, r.mainSize, C.right, flagAt(r.y)));
      if (overlay.length) block.overlay = overlay.map((g) => ({ x: round(g.x0 - e.piece!.x), items: g.items, ...(g.alignRight ? { alignRight: true } : {}) }));
      blocks.push(block);
      prevSnippet = block;
      prevSnippetX = e.piece.x;
      continue;
    }
    const row = e.row!;
    if (row.kind === "note") { blocks.push(readNote(row, earlier)); isRepeat = true; prevSnippet = undefined; continue; }
    if (row.kind === "chord") {
      const groups = parseChordRow(row.glyphs, row.y, row.mainSize, C.right, flagAt(row.y));
      const next = entries[k + 1]?.row;
      const lyric = next && next.kind === "lyric" && next.y - row.y <= I.rowPair ? next : undefined;
      if (lyric) k++;
      const parsed = lyric ? parseLyricRow(lyric.glyphs, lyric.mainSize, flagAt(lyric.y)) : undefined;
      blocks.push(buildLine(groups, parsed, flagAt(row.y)));
      prevSnippet = undefined;
      continue;
    }
    // A lyric line without chords: under a notation image, guess its rhythm from the image.
    const parsed = parseLyricRow(row.glyphs, row.mainSize, flagAt(row.y));
    const line: LineBlock = { kind: "line", lyrics: parsed.lyrics, above: [] };
    if (prevSnippet?.timeline) {
      const marks = rhythmFromTimeline(parsed, prevSnippet.timeline.bars, prevSnippetX);
      if (marks.length) {
        line.rhythm = marks;
        flagAt(row.y)(`rhythm guessed from the notation image: ${marks.map((m) => `${m.bar}:${m.beat}`).join(" ")} (bar:beat per syllable)`);
      }
    }
    blocks.push(line);
    prevSnippet = undefined;
  }

  const section: Section = { type: label ? sectionTypeOf(label) : "other", label, blocks };
  return { section, label, isRepeat: !label && isRepeat && blocks.every((b) => b.kind === "note") };
}

const round = (v: number) => Math.round(v * 100) / 100;

function readNote(row: Row, earlier: Section[]): NoteBlock {
  const gs = [...row.glyphs].sort((a, b) => a.x0 - b.x0);
  const pieces: NoteBlock["pieces"] = [];
  let run: Glyph[] = [];
  const flush = () => {
    if (!run.length) return;
    const text = textOf(run);
    if (run[0]!.bold) {
      const lower = text.trim().toLowerCase();
      const match = [...earlier].reverse().find((s) => s.label.toLowerCase() === lower);
      const ref: SectionRef = { section: match?.type ?? sectionTypeOf(text), text: text.trim() };
      if (match && match.label) ref.label = match.label;
      pieces.push(ref);
    } else pieces.push({ text: text.endsWith(" ") ? text : text + " " });
    run = [];
  };
  for (const g of gs) {
    if (run.length && run[0]!.bold !== g.bold) flush();
    run.push(g);
  }
  flush();
  return { kind: "note", pieces };
}

/**
 * Pins each chord group to the syllable its beat point sits over (the middle
 * of the nearest syllable); groups in a gap between syllables get "before" or
 * "after"; groups past the lyric go past its end. Then guesses a late lyric
 * entry from the gap after the line's first chord.
 */
function buildLine(groups: ParsedGroup[], lyric: ParsedLyric | undefined, flag: (m: string) => void): LineBlock {
  const above: Anchor[] = [];
  const syl = lyric?.syllables ?? [];
  const textLen = lyric?.text.length ?? 0;
  const between = I.betweenSyllables;
  let lastAt = 0;
  for (const g of groups) {
    if (g.alignRight) { above.push({ at: 0, items: g.items, alignRight: true }); continue; }
    const x = g.point ?? g.x0;
    let at: number, place: Anchor["place"];
    const last = syl[syl.length - 1];
    if (!last || x > last.x1 + between) at = textLen;
    else {
      const near = syl.reduce((a, b) => (Math.abs(b.mid - x) < Math.abs(a.mid - x) ? b : a));
      if (x >= near.x0 - between && x <= near.x1 + between) at = near.start;
      else {
        const next = syl.find((s) => s.x0 > x)!;
        const prev = [...syl].reverse().find((s) => s.x1 < x);
        at = next.start;
        if (prev) {
          place = next.x0 - x < x - prev.x1 ? "before" : "after";
          if (g.hasChord) {
            const word = (s: { start: number; end: number }) => `"${lyric!.text.slice(s.start, s.end)}"`;
            flag(`chord between syllables: placed just ${place === "before" ? `before ${word(next)}` : `after ${word(prev)}`}; check`);
          }
        }
      }
    }
    at = Math.max(at, lastAt);
    lastAt = at;
    above.push(place ? { at, items: g.items, place } : { at, items: g.items });
  }
  const line: LineBlock = { kind: "line", lyrics: lyric?.lyrics ?? [], above };
  if (lyric && syl.length) guessEntry(line, groups, syl[0]!.x0, flag);
  return line;
}

/** Points per beat on this line, from its timed chords' source positions (rules beat width if unknown). */
function lineBeatWidth(line: LineBlock, groups: ParsedGroup[]): number {
  const timing = lineTiming(line);
  const pts = groups.filter((g) => !g.alignRight).map((g, i) => ({ x: g.point, t: timing.times[i] }))
    .filter((p): p is { x: number; t: number } => p.x !== undefined && p.t !== undefined);
  const slopes: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i]!.t - pts[i - 1]!.t;
    if (dt >= 1) slopes.push((pts[i]!.x - pts[i - 1]!.x) / dt);
  }
  const bw = median(slopes);
  return bw >= 15 && bw <= 40 ? bw : RULES.render.spacing.beatWidth;
}

/**
 * The legacy charts start a late lyric about one legacy beat width
 * (rules.import.legacyBeatWidth) per beat after the line's opening bar line.
 */
function guessEntry(line: LineBlock, groups: ParsedGroup[], lyricX0: number, flag: (m: string) => void) {
  const first = line.above.findIndex((a) => !a.alignRight);
  const g = groups.filter((x) => !x.alignRight)[first];
  const a = line.above[first];
  if (!g || !a || a.at !== 0 || a.place || g.x1 > lyricX0 || g.items[0]?.t !== "bar") return;
  const t0 = lineTiming(line).times[0];
  if (t0 === undefined) return;
  const beats = (lyricX0 - g.x0) / I.legacyBeatWidth;
  if (beats < I.entryMinBeats) return;
  const grid = I.rhythmGrid;
  const t = t0 + Math.max(grid, Math.round(beats / grid) * grid);
  if (t >= RULES.timing.defaultMeter.top) { flag(`lyric starts about ${t.toFixed(1)} beats after the bar line, past bar 1; add a rhythm mark by hand`); return; }
  const tag = beatTag(t);
  if (!tag) return;
  line.lyricEntry = tag;
  flag(`lyric entry guessed: beat ${tag}`);
}

/** Syllable beats from a notation image's bars: each syllable's middle against the bar positions, rounded to rules.import.rhythmGrid. */
function rhythmFromTimeline(lyric: ParsedLyric, bars: { x: number; width: number }[], imageX: number): RhythmMark[] {
  const beatsPerBar = RULES.timing.defaultMeter.top;
  const grid = I.rhythmGrid;
  const marks: RhythmMark[] = [];
  let lastT = -Infinity;
  for (const s of lyric.syllables) {
    const rel = s.mid - imageX;
    let k = 0;
    for (let i = 0; i < bars.length; i++) if (rel >= bars[i]!.x - bars[i]!.width / beatsPerBar / 2) k = i;
    const bar = bars[k]!;
    let t = k * beatsPerBar + ((rel - bar.x) / bar.width) * beatsPerBar;
    t = Math.max(0, Math.round(t / grid) * grid);
    if (t <= lastT) t = lastT + grid;
    lastT = t;
    const barNo = Math.floor(t / beatsPerBar);
    const tag = beatTag(t - barNo * beatsPerBar);
    if (tag) marks.push({ at: s.start, beat: tag, bar: barNo + 1 });
  }
  return marks;
}
