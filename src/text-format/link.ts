/**
 * Keeps chords with their syllables while the chart text is typed (owner,
 * 2026-11-10: "if I bind a chord to a lyric, even if additional chords or
 * lyrics are added, those two will move together").
 *
 * In the text a chord is matched to the lyric by column, so typing a word
 * earlier in the lyric line, or making a chord name longer, would slide the
 * chords after it onto other syllables. `relink` compares the text before and
 * after one edit, works out which syllable every chord was bound to, and
 * re-spaces that line's chord and rhythm lines so each stays on its syllable.
 * Pure: no DOM.
 */
import type { Anchor, LineBlock, RhythmMark } from "../model/chart.js";
import { canonicalBlock, lyricText, stableJson } from "./canonical.js";
import { parseChartText, readLyric, type LineSource } from "./parse.js";
import { groupText, parseGroup, splitGroups } from "./tokens.js";
import { replaceBlock } from "./edit.js";

export type RelinkResult =
  /** The text was re-spaced; put the caret at `caret` (offset in `text`). */
  | { kind: "applied"; text: string; caret: number }
  /** Nothing to fix: the edit kept every binding. Use the new text as the reference. */
  | { kind: "none" }
  /** The edited line doesn't read cleanly yet (a half-typed chord): keep the old reference and try again later. */
  | { kind: "wait" }
  /** Not a single-line edit inside a chords-and-lyric line (paste, Enter, header...): leave it. */
  | { kind: "skip" };

type Role = "chord" | "lyric" | "rhythm";

function locate(sources: LineSource[], lineNo: number): { src: LineSource; role: Role } | undefined {
  for (const src of sources) {
    if (src.chord === lineNo) return { src, role: "chord" };
    if (src.lyric === lineNo) return { src, role: "lyric" };
    if (src.rhythm === lineNo) return { src, role: "rhythm" };
  }
  return undefined;
}

const sameShape = (a: LineSource, b: LineSource) =>
  a.section === b.section && a.block === b.block && a.chord === b.chord && a.lyric === b.lyric && a.rhythm === b.rhythm;

const commonPrefix = (a: string, b: string) => {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  return p;
};
const commonSuffix = (a: string, b: string, p: number) => {
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return s;
};

/**
 * Where one edit happened: the common start `p` and common end `s` of the old
 * and new strings. The caret (where typing happened) decides when the text
 * alone is ambiguous: typing "We " before "Walking" also reads as "e We"
 * after its first W.
 */
function diffAt(a: string, b: string, caret: number | undefined): { p: number; s: number } {
  const delta = b.length - a.length;
  if (caret !== undefined) {
    if (delta > 0 && caret - delta >= 0 && a === b.slice(0, caret - delta) + b.slice(caret)) return { p: caret - delta, s: a.length - (caret - delta) };
    if (delta < 0 && caret <= b.length && a.slice(0, caret) === b.slice(0, caret) && a.slice(caret - delta) === b.slice(caret)) return { p: caret, s: b.length - caret };
  }
  const p = commonPrefix(a, b);
  return { p, s: commonSuffix(a, b, p) };
}

const FORCED = "! ";

interface Group { start: number; end: number; anchor: Anchor }

/** Each chord-line group with the anchor it makes, as the parser reads it; undefined if any group doesn't read. */
function chordGroups(line: string, lyricLine: string | undefined): Group[] | undefined {
  const lyr = lyricLine === undefined ? undefined : readLyric(lyricLine);
  const body = line.startsWith(FORCED) ? "  " + line.slice(2) : line;
  const out: Group[] = [];
  let past = 0;
  for (const g of splitGroups(body)) {
    const p = parseGroup(g.text);
    if ("error" in p) return undefined;
    const anchor: Anchor = { at: 0, items: p.items };
    if (p.place) anchor.place = p.place;
    if (p.alignRight) anchor.alignRight = true;
    else {
      const idx = lyr?.index(g.start + (p.rootOffset ?? 0));
      anchor.at = idx ?? (lyr?.length ?? 0) + past++;
    }
    out.push({ start: g.start, end: g.start + g.text.length, anchor });
  }
  return out;
}

/** Column of lyric character `k` in a lyric line (the column it is drawn at). */
function columnOf(lyricLine: string, k: number): number | undefined {
  const lyr = readLyric(lyricLine);
  let col: number | undefined;
  for (let c = 0; c < lyricLine.length; c++) if (lyr.index(c) === k) col = c;
  return col;
}

/**
 * Chord and rhythm lines that put each anchor and mark over its character of
 * `lyricLine`, keeping the lyric as typed. Undefined if two would collide (the
 * lyric then needs padding, which the writer adds).
 */
function respace(block: LineBlock, lyricLine: string, forced: boolean): { chord?: string; rhythm?: string } | undefined {
  const length = lyricText(block.lyrics).length;
  const out: { chord?: string; rhythm?: string } = {};
  const inText = block.above.filter((a) => !a.alignRight && a.at < length);
  const past = block.above.filter((a) => !a.alignRight && a.at >= length);
  const right = block.above.filter((a) => a.alignRight);
  let line = forced ? FORCED : "";
  for (const a of inText) {
    const g = groupText(a);
    const col = columnOf(lyricLine, a.at);
    if (col === undefined) return undefined;
    const start = col - (g.rootOffset ?? 0);
    if (start < (line.length ? line.length + 1 : 0)) return undefined;
    line = line.padEnd(start) + g.text;
  }
  let col = Math.max(line.length ? line.length + 1 : 0, lyricLine.length + 1);
  for (const a of [...past, ...right]) {
    const g = groupText(a);
    line = line.padEnd(col) + g.text;
    col = line.length + 1;
  }
  if (block.above.length || forced) out.chord = line;
  if (block.rhythm?.length) {
    let r = "";
    for (const m of [...block.rhythm].sort((p, q) => p.at - q.at)) {
      const t = (m.bar !== undefined && m.bar !== 1 ? `${m.bar}:` : "") + m.beat;
      const c = columnOf(lyricLine, m.at);
      if (c === undefined || c < (r.length ? r.length + 1 : 0)) return undefined;
      r = r.padEnd(c) + t;
    }
    out.rhythm = r;
  }
  return out;
}

/** Re-spaces the text after one edit so every chord stays on its syllable. `caret` is the caret offset in `after`. */
export function relink(before: string, after: string, caret: number): RelinkResult {
  const bl = before.split("\n"), al = after.split("\n");
  if (bl.length !== al.length) return { kind: "skip" };
  const changed = al.map((l, k) => (l !== bl[k] ? k : -1)).filter((k) => k >= 0);
  if (changed.length !== 1) return { kind: changed.length ? "skip" : "none" };
  const L = changed[0]!;
  if (/[\t\r]/.test(al[L]!) || /[\t\r]/.test(bl[L]!)) return { kind: "skip" };
  const pb = parseChartText(before), pa = parseChartText(after);
  const was = locate(pb.sources, L + 1);
  if (!was || was.role === "rhythm") return { kind: "skip" };
  const now = locate(pa.sources, L + 1);
  if (!now || now.role !== was.role || !sameShape(was.src, now.src)) return { kind: "wait" };
  const { section, block } = was.src;
  const oldBlock = pb.chart.sections[section]!.blocks[block] as LineBlock;
  const newBlock = pa.chart.sections[section]!.blocks[block] as LineBlock;
  const lyricNo = was.src.lyric;
  const caretCol = caret - al.slice(0, L).reduce((n, l) => n + l.length + 1, 0);
  const lyricLine = lyricNo === undefined ? undefined : al[lyricNo - 1]!;
  const intended: LineBlock = structuredClone(newBlock);

  if (was.role === "lyric") {
    // Character-level change in the lyric: bindings after it shift, ones inside it go to its start.
    const ot = lyricText(oldBlock.lyrics), nt = lyricText(newBlock.lyrics);
    // Caret as a character of the new lyric: the characters before it.
    const caretChar = lyricNo === L + 1 ? (readLyric(al[L]!).index(caretCol) ?? nt.length) : undefined;
    const { p, s } = diffAt(ot, nt, caretChar), delta = nt.length - ot.length;
    const move = (at: number) => (at < p ? at : at >= ot.length - s ? at + delta : p);
    intended.above = oldBlock.above.map((a) => (a.alignRight ? { ...a } : { ...a, at: move(a.at) }));
    const marks: RhythmMark[] = (oldBlock.rhythm ?? []).map((m) => ({ ...m, at: move(m.at) }));
    if (marks.length) intended.rhythm = marks; else delete intended.rhythm;
  } else {
    // Chord line: the groups being typed bind where they are; the others keep their syllables.
    const oldGroups = chordGroups(bl[L]!, lyricLine);
    const newGroups = chordGroups(al[L]!, lyricLine);
    if (!oldGroups) return { kind: "skip" };
    if (!newGroups) return { kind: "wait" };
    const ol = bl[L]!, nl = al[L]!;
    const { p, s } = diffAt(ol, nl, caretCol);
    const oldRight = oldGroups.filter((g) => g.start >= ol.length - s);
    const newRight = newGroups.filter((g) => g.start >= nl.length - s);
    if (oldRight.length !== newRight.length) return { kind: "none" };
    const keep = new Map(newRight.map((g, k) => [g, oldRight[k]!.anchor.at]));
    intended.above = newGroups.map((g) => (keep.has(g) && !g.anchor.alignRight ? { ...g.anchor, at: keep.get(g)! } : g.anchor));
    const length = lyricText(intended.lyrics).length;
    // Past-the-end groups only keep their order.
    let k = 0;
    for (const a of intended.above) if (!a.alignRight && a.at >= length) a.at = length + k++;
    intended.above.sort((x, y) => (x.alignRight ? 1 : 0) - (y.alignRight ? 1 : 0) || x.at - y.at);
  }

  if (stableJson(canonicalBlock(intended)) === stableJson(canonicalBlock(newBlock))) return { kind: "none" };

  // First try: keep the lyric as typed and move only the chord and rhythm lines.
  const lines = [...al];
  const spaced = lyricLine === undefined ? undefined : respace(intended, lyricLine, (was.src.chord !== undefined && al[was.src.chord - 1]!.startsWith(FORCED)));
  if (spaced && (spaced.chord === undefined) === (was.src.chord === undefined) && (spaced.rhythm === undefined) === (was.src.rhythm === undefined)) {
    if (was.src.chord !== undefined) lines[was.src.chord - 1] = spaced.chord!;
    if (was.src.rhythm !== undefined) lines[was.src.rhythm - 1] = spaced.rhythm!;
    const text = lines.join("\n");
    const back = parseChartText(text).chart.sections[section]?.blocks[block];
    if (back && stableJson(canonicalBlock(back)) === stableJson(canonicalBlock(intended))) {
      return { kind: "applied", text, caret: mapCaret(after, text, L, caret) };
    }
  }
  // Otherwise the writer lays the line out again, padding the lyric where chords would collide.
  const r = replaceBlock(after, section, block, intended);
  if ("error" in r) return { kind: "none" };
  const src = parseChartText(r.text).sources.find((x) => x.section === section && x.block === block);
  const editedNo = src?.[was.role];
  return { kind: "applied", text: r.text, caret: mapCaret(after, r.text, L, caret, editedNo === undefined ? L : editedNo - 1) };
}

/** Keeps the caret on the edited line, at the same place relative to the text around it. */
function mapCaret(after: string, text: string, line: number, caret: number, newLine = line): number {
  const al = after.split("\n"), tl = text.split("\n");
  const start = (ls: string[], n: number) => ls.slice(0, n).reduce((x, l) => x + l.length + 1, 0);
  const col = caret - start(al, line);
  const oldL = al[line] ?? "", newL = tl[newLine] ?? "";
  // Columns before the caret that stayed the same keep their place; the rest shift with the length change.
  const p = commonPrefix(oldL, newL);
  const c = col <= p ? col : Math.max(p, col + newL.length - oldL.length);
  return start(tl, newLine) + Math.min(Math.max(c, 0), newL.length);
}
