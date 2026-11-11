/**
 * Chart text format -> Chart (NOTES.md, "Chart text format"). Pure: no DOM,
 * no file system. Never throws on bad input: anything it can't read becomes a
 * problem with a line number, and the rest of the chart still comes through.
 */
import { beatOffset, type Anchor, type Block, type Chart, type ChartMeta, type LineBlock, type LyricPiece, type LyricStyle, type NoteBlock, type RhythmMark, type Section, type SectionType } from "../model/chart.js";
import { sectionTypeOf } from "../rules/index.js";
import { isStrong, parseGroup, splitGroups, type ParsedGroup } from "./tokens.js";

export interface Problem {
  /** 1-based line number. */
  line: number;
  message: string;
}

export interface ParseResult {
  chart: Chart;
  problems: Problem[];
  /** Where each chords-and-lyric block came from, for editing the text from the page. */
  sources: LineSource[];
}

/** The text lines (1-based) a line block was read from. */
export interface LineSource {
  section: number;
  block: number;
  chord?: number;
  lyric?: number;
  rhythm?: number;
}

export const SECTION_TYPES: readonly SectionType[] = ["intro", "verse", "prechorus", "refrain", "chorus", "bridge", "break", "solo", "interlude", "outro", "ending", "other"];

/** Header keys as typed (lowercase) -> meta field. */
export const HEADER_KEYS: Record<string, keyof ChartMeta> = {
  title: "title", artist: "artist", year: "year", key: "key", "original key": "originalKey",
  bpm: "bpm", meter: "meter", tuning: "tuning", language: "language", syllables: "syllables", date: "date",
};

const TAB = 8;
const RHYTHM_TOKEN = /^(?:(\d+):)?([1-9]\d?(?:e|&|a|te|ta)?)$/;

const isBlank = (l: string) => l.trim() === "";
const isHeading = (l: string) => l.startsWith("#");
const isFence = (l: string) => /^```/.test(l.trim());
const isNote = (l: string) => /^>( |$)/.test(l) || /^repeat\b/i.test(l);
const isForcedLyric = (l: string) => l.startsWith(". ") || l === ".";
const isForcedChord = (l: string) => l.startsWith("! ");

export function isRhythmLine(l: string): boolean {
  const tokens = l.trim().split(/ +/);
  return l.trim() !== "" && tokens.every((t) => RHYTHM_TOKEN.test(t));
}

interface ChordLineRead {
  groups: { col: number; start: number; parsed: ParsedGroup }[];
  bad: { col: number; error: string }[];
}

function readChordLine(line: string): ChordLineRead {
  const body = isForcedChord(line) ? "  " + line.slice(2) : line;
  const out: ChordLineRead = { groups: [], bad: [] };
  for (const g of splitGroups(body)) {
    const p = parseGroup(g.text);
    if ("error" in p) out.bad.push({ col: g.start, error: p.error });
    else out.groups.push({ col: g.start + (p.rootOffset ?? 0), start: g.start, parsed: p });
  }
  return out;
}

/**
 * A chord line: every group reads as chord-line marks (free text alone isn't
 * enough), or most do and it has a bar line or more good groups than bad ones
 * (then the bad groups are reported). "! " forces it.
 */
export function isChordLine(line: string): boolean {
  if (isForcedChord(line)) return true;
  if (isForcedLyric(line) || isBlank(line)) return false;
  const r = readChordLine(line);
  const strong = r.groups.some((g) => g.parsed.items.some(isStrong));
  if (!strong) return false;
  const bar = r.groups.some((g) => g.parsed.items.some((it) => it.t === "bar"));
  return r.bad.length === 0 || r.groups.length > r.bad.length || bar;
}

interface LyricRead {
  pieces: LyricPiece[];
  length: number;
  lyricEntry?: string;
  /** Character index under column `col`; undefined past the end of the lyric. */
  index: (col: number) => number | undefined;
  problems: string[];
}

const STYLE_MARKS: [string, LyricStyle][] = [["^^", "asideUpright"], ["^", "aside"], ["_", "backup"]];

/** Reads a lyric line: text, styles, inline items, padding (`~`, extra spaces), and the column -> character map. */
export function readLyric(line: string): LyricRead {
  const problems: string[] = [];
  const pieces: LyricPiece[] = [];
  const colIdx: number[] = new Array(line.length).fill(-1);
  let i = isForcedLyric(line) ? 2 : 0;
  while (line[i] === " ") i++;
  let lyricEntry: string | undefined;
  const entry = /^@(\S+)(?: +|$)/.exec(line.slice(i));
  if (entry) {
    lyricEntry = entry[1]!;
    if (beatOffset(lyricEntry) === undefined) problems.push(`"@${lyricEntry}": the lyric entry needs one beat, e.g. @2 or @1&`);
    i += entry[0].length;
  }
  const contentStart = i;
  let style: LyricStyle | undefined, n = 0;
  const pushChar = (ch: string, col: number) => {
    colIdx[col] = n++;
    const last = pieces[pieces.length - 1];
    if (last && "text" in last && last.style === style) last.text += ch;
    else pieces.push(style ? { text: ch, style } : { text: ch });
  };
  while (i < line.length) {
    const c = line[i]!;
    if (c === "\\" && i + 1 < line.length) { pushChar(line[i + 1]!, i + 1); i += 2; continue; }
    if (c === " ") {
      let k = i;
      while (line[k] === " ") k++;
      pushChar(" ", i); // the first space of a run is the real one; the rest is padding, part of the next word
      i = k;
      continue;
    }
    if (c === "~") { i++; continue; }
    const mark = STYLE_MARKS.find(([m]) => line.startsWith(m, i));
    if (mark) { style = style === mark[1] ? undefined : mark[1]; i += mark[0].length; continue; }
    if (c === "}") { pieces.push({ item: { t: "endingClose" } }); i++; continue; }
    if (c === "{") {
      const open = /^\{([^.\s{}]+)\./.exec(line.slice(i));
      if (open) { pieces.push({ item: { t: "endingOpen", n: open[1]! } }); i += open[0].length; continue; }
      const z = line.indexOf("}", i);
      const p = z > 0 ? parseGroup(line.slice(i + 1, z)) : undefined;
      if (p && !("error" in p) && p.items.length === 1 && !p.place && !p.alignRight) { pieces.push({ item: p.items[0]! }); i = z + 1; continue; }
      problems.push(`"${z > 0 ? line.slice(i, z + 1) : line.slice(i)}": an inline mark in a lyric is one mark in { }, e.g. {(2x)}; write \\{ for a brace`);
      i = z > 0 ? z + 1 : line.length;
      continue;
    }
    pushChar(c, i);
    i++;
  }
  if (style) problems.push(`a ${style === "backup" ? "_" : style === "aside" ? "^" : "^^"} style mark is not closed`);
  const index = (col: number): number | undefined => {
    if (col < contentStart) return n > 0 ? 0 : undefined;
    for (let k = col; k < line.length; k++) if (colIdx[k]! >= 0) return colIdx[k];
    return undefined;
  };
  const out: LyricRead = { pieces, length: n, index, problems };
  if (lyricEntry !== undefined) out.lyricEntry = lyricEntry;
  return out;
}

const EMPTY_LYRIC: LyricRead = { pieces: [], length: 0, index: () => undefined, problems: [] };

function buildLine(chord: { line: string; no: number } | undefined, lyric: { line: string; no: number } | undefined, rhythm: { line: string; no: number } | undefined, problem: (line: number, msg: string) => void): LineBlock {
  const lyr = lyric ? readLyric(lyric.line) : EMPTY_LYRIC;
  if (lyric) for (const p of lyr.problems) problem(lyric.no, p);
  const inText: { a: Anchor; col: number }[] = [], past: { a: Anchor; col: number }[] = [], right: Anchor[] = [];
  if (chord) {
    const r = readChordLine(chord.line);
    for (const b of r.bad) problem(chord.no, `column ${b.col + 1}: ${b.error}`);
    for (const g of r.groups) {
      const a: Anchor = { at: 0, items: g.parsed.items };
      if (g.parsed.place) a.place = g.parsed.place;
      if (g.parsed.alignRight) { a.alignRight = true; right.push(a); continue; }
      const idx = lyr.index(g.col);
      if (idx === undefined) past.push({ a, col: g.col });
      else { a.at = idx; inText.push({ a, col: g.col }); }
    }
  }
  past.forEach((p, k) => (p.a.at = lyr.length + k));
  const block: LineBlock = { kind: "line", lyrics: lyr.pieces, above: [...inText.map((x) => x.a), ...past.map((x) => x.a), ...right] };
  if (lyr.lyricEntry !== undefined) block.lyricEntry = lyr.lyricEntry;
  if (rhythm) {
    const marks: RhythmMark[] = [];
    const re = /\S+/g;
    for (let m = re.exec(rhythm.line); m; m = re.exec(rhythm.line)) {
      const t = RHYTHM_TOKEN.exec(m[0])!;
      const at = lyr.index(m.index);
      if (at === undefined) { problem(rhythm.no, `column ${m.index + 1}: "${m[0]}" is past the end of the lyric`); continue; }
      const mark: RhythmMark = { at, beat: t[2]! };
      if (t[1] !== undefined && Number(t[1]) !== 1) mark.bar = Number(t[1]);
      marks.push(mark);
    }
    if (marks.length) block.rhythm = marks;
  }
  return block;
}

/**
 * Section type a "Repeat" reference means (when no `=type` is given): the type
 * of the latest earlier section labelled `label` (or, without a label, labelled
 * like the text), else the type read from the words.
 */
export function inferRefType(text: string, label: string | undefined, before: readonly Section[]): SectionType {
  const name = label ?? text;
  for (let j = before.length - 1; j >= 0; j--) if (before[j]!.label === name) return before[j]!.type;
  return sectionTypeOf(name);
}

function readNote(line: string, before: readonly Section[], problem: (msg: string) => void): NoteBlock {
  const body = line.startsWith(">") ? line.replace(/^> ?/, "") : line;
  const pieces: NoteBlock["pieces"] = [];
  let last = 0;
  const re = /\{([^{}]*)\}/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (m.index > last) pieces.push({ text: body.slice(last, m.index) });
    const ref = /^(.*?)(?:\|(.*?))?(?:=([a-z]+))?$/.exec(m[1]!)!;
    const text = ref[1]!, label = ref[2];
    let type = ref[3] as SectionType | undefined;
    if (type && !SECTION_TYPES.includes(type)) { problem(`"=${type}" is not a section type (${SECTION_TYPES.join(", ")})`); type = undefined; }
    const piece: NoteBlock["pieces"][number] = { section: type ?? inferRefType(text, label, before), text };
    if (label !== undefined) piece.label = label;
    pieces.push(piece);
    last = m.index + m[0].length;
  }
  if (last < body.length) pieces.push({ text: body.slice(last) });
  if (/^repeat\b/i.test(body) && !pieces.some((p) => "section" in p)) problem(`put the section name in { } to link it, e.g. Repeat {Chorus}`);
  return { kind: "note", pieces };
}

function expandTabs(line: string): string {
  let out = "";
  for (const c of line) out += c === "\t" ? " ".repeat(TAB - (out.length % TAB)) : c;
  return out;
}

export function parseChartText(src: string): ParseResult {
  const problems: Problem[] = [];
  const sources: LineSource[] = [];
  const problem = (line: number, message: string) => problems.push({ line, message });
  const raw = src.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const lines = raw.map((l, k) => {
    if (l.includes("\t")) problem(k + 1, "tab characters were turned into spaces (8 columns); line chords up with spaces");
    return expandTabs(l).replace(/ +$/, "");
  });
  const meta: Partial<ChartMeta> & Record<string, unknown> = {};
  const chart: Chart = { meta: meta as ChartMeta, sections: [] };
  let cur: Section | undefined, inHeader = true, afterBlank = false, i = 0;
  const ensureSection = (no: number): Section => {
    if (!cur) {
      problem(no, "this comes before the first section heading; add one, e.g. # Intro");
      cur = { type: "other", label: "", blocks: [] };
      chart.sections.push(cur);
    }
    return cur;
  };
  const lyricCandidate = (l: string | undefined) =>
    l !== undefined && !isBlank(l) && !isHeading(l) && !isFence(l) && !(isNote(l) && !isForcedLyric(l)) && !isChordLine(l);

  while (i < lines.length) {
    const line = lines[i]!, no = i + 1;
    if (isBlank(line)) { afterBlank = true; i++; continue; }
    if (isFence(line)) {
      let z = i + 1;
      while (z < lines.length && !isFence(lines[z]!)) z++;
      const json = lines.slice(i + 1, z).join("\n");
      if (z >= lines.length) problem(no, "the ``` block is not closed");
      try {
        const obj = JSON.parse(json) as Record<string, unknown>;
        if (typeof obj.kind === "string") ensureSection(no).blocks.push(obj as unknown as Block);
        else {
          if (obj.cover) chart.cover = obj.cover as NonNullable<Chart["cover"]>;
          if (obj.meta) Object.assign(meta, obj.meta);
          if (!obj.cover && !obj.meta) problem(no, 'a ``` block holds a block (with "kind") or {"cover": ...} / {"meta": ...}');
        }
      } catch (e) {
        problem(no, `the \`\`\` block is not valid JSON: ${(e as Error).message}`);
      }
      i = z + 1;
      afterBlank = false;
      continue;
    }
    const header = inHeader ? /^([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/.exec(line) : null;
    if (header && HEADER_KEYS[header[1]!.toLowerCase()]) {
      const key = HEADER_KEYS[header[1]!.toLowerCase()]!, value = header[2]!.trim();
      if (key === "year" || key === "bpm") {
        const v = Number(value);
        if (!Number.isFinite(v) || value === "") problem(no, `${header[1]} needs a number`);
        else meta[key] = v;
      } else if (key === "syllables") {
        const words = value.split(/[,\s]+/).filter(Boolean);
        for (const w of words) if (!/^[\p{L}\p{N}'’]+(-[\p{L}\p{N}'’]+)*$/u.test(w)) problem(no, `"${w}": write a word with hyphens where it splits, e.g. ded-i-cat-ed`);
        if (words.length) meta.syllables = words;
      } else if (key === "meter") {
        const m = /^(\d+)\s*\/\s*(\d+)$/.exec(value);
        if (!m) problem(no, "Meter is written like 4/4 or 6/8");
        else meta.meter = { top: Number(m[1]), bottom: Number(m[2]) };
      } else meta[key] = value;
      i++;
      continue;
    }
    if (isHeading(line)) {
      inHeader = false;
      let label = line.slice(1).trim(), type: SectionType | undefined;
      const t = /\s*=([a-z]+)$/.exec(label);
      if (t) {
        if (SECTION_TYPES.includes(t[1] as SectionType)) { type = t[1] as SectionType; label = label.slice(0, t.index).trim(); }
        else problem(no, `"=${t[1]}" is not a section type (${SECTION_TYPES.join(", ")})`);
      }
      cur = { type: type ?? (label ? sectionTypeOf(label) : "other"), label, blocks: [] };
      chart.sections.push(cur);
      afterBlank = false;
      i++;
      continue;
    }
    if (inHeader && header) problem(no, `"${header[1]}" is not a header field (${Object.keys(HEADER_KEYS).join(", ")})`);
    inHeader = false;
    if (isNote(line) && !isForcedLyric(line)) {
      if (!cur || (afterBlank && cur.blocks.length > 0)) {
        cur = { type: "other", label: "", blocks: [] };
        chart.sections.push(cur);
      }
      cur.blocks.push(readNote(line, chart.sections.slice(0, -1), (m) => problem(no, m)));
      afterBlank = false;
      i++;
      continue;
    }
    const section = ensureSection(no);
    let chord: { line: string; no: number } | undefined, lyric: { line: string; no: number } | undefined, rhythm: { line: string; no: number } | undefined;
    if (isChordLine(line)) {
      chord = { line, no };
      i++;
      if (lyricCandidate(lines[i])) { lyric = { line: lines[i]!, no: i + 1 }; i++; }
    } else {
      lyric = { line, no };
      i++;
    }
    if (lyric && lines[i] !== undefined && isRhythmLine(lines[i]!)) { rhythm = { line: lines[i]!, no: i + 1 }; i++; }
    const src: LineSource = { section: chart.sections.indexOf(section), block: section.blocks.length };
    if (chord) src.chord = chord.no;
    if (lyric) src.lyric = lyric.no;
    if (rhythm) src.rhythm = rhythm.no;
    sources.push(src);
    section.blocks.push(buildLine(chord, lyric, rhythm, problem));
    afterBlank = false;
  }
  if (meta.title === undefined) { problem(1, "add a Title: line at the top"); meta.title = ""; }
  if (meta.artist === undefined) meta.artist = "";
  if (meta.key === undefined) { problem(1, "add a Key: line at the top, e.g. Key: G"); meta.key = ""; }
  return { chart, problems, sources };
}
