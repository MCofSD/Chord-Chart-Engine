/**
 * Edits the chart text from the page (owner, 2026-11-10): click a syllable,
 * then add, change or remove the chord on it, placed on, just before or just
 * after the syllable. The text stays the master copy: these functions return
 * new text, with only that line's chord, lyric and rhythm lines rewritten.
 * Pure: no DOM.
 */
import { DEFAULT_METER, lineTiming, type LineTiming } from "../chart/timing.js";
import { beatOffset, resolveRepeats, type Anchor, type Block, type Chart, type ChordLineItem, type LineBlock, type Meter, type NoteBlock, type RhythmMark, type Section, type SectionRef, type SectionType } from "../model/chart.js";
import { sectionTypeOf } from "../rules/index.js";
import { syllables, type SyllableSpan } from "../text/syllables.js";
import { canonicalBlock, stableJson } from "./canonical.js";
import { HEADER_KEYS, parseChartText, SECTION_TYPES } from "./parse.js";
import { groupText, parseGroup } from "./tokens.js";
import { blockLines } from "./write.js";

export type Place = "on" | "before" | "after";

export interface ChordTarget {
  /** Section and block index in the parsed chart. */
  section: number;
  block: number;
  syllable: SyllableSpan;
}

/** A group with a chord (or a new bass note) in it; a bar line or "|-" alone is not a syllable's chord. */
const hasChord = (a: Anchor) => a.items.some((i) => i.t === "chord" || i.t === "bass");

/**
 * With a lyric entry (`@2`), the beat-1 group in the space before the lyric:
 * the first group at character 0. A later group at character 0 belongs to
 * the first syllable. -1 without a lyric entry.
 */
function edgeIndex(block: LineBlock): number {
  if (block.lyricEntry === undefined) return -1;
  const i = block.above.findIndex((a) => !a.alignRight && a.place !== "after");
  return i >= 0 && block.above[i]!.at === 0 ? i : -1;
}

/**
 * The chord group that belongs to a syllable: one placed "on" or "before"
 * any of its characters, or "after" it (pinned anywhere in the gap after its
 * letters, up to the next syllable's start). Groups without a chord, such as
 * a bar line, are left alone, and so is the beat-1 group before a late lyric.
 */
export function anchorIndex(block: LineBlock, syl: SyllableSpan): number {
  const edge = edgeIndex(block);
  return block.above.findIndex((a, i) => i !== edge && !a.alignRight && hasChord(a)
    && (a.place === "after" ? a.at >= syl.end && a.at <= syl.next : a.at >= syl.start && a.at < syl.end));
}

/** The chord already on a syllable, as typed in a chord line (without its <, >), and its placement. */
export function chordAt(src: string, target: ChordTarget): { group: string; place: Place } | undefined {
  const block = parseChartText(src).chart.sections[target.section]?.blocks[target.block];
  if (block?.kind !== "line") return undefined;
  const a = block.above[anchorIndex(block, target.syllable)];
  return a ? { group: groupText({ items: a.items }).text, place: a.place ?? "on" } : undefined;
}

/** Where a new anchor goes: in time order, an "after" chord before others on the same character. */
function insertAt(above: Anchor[], anchor: Anchor): void {
  const after = anchor.place === "after";
  const pos = above.findIndex((a) => a.alignRight || a.at > anchor.at || (a.at === anchor.at && after && a.place !== "after"));
  above.splice(pos < 0 ? above.length : pos, 0, anchor);
}

export type EditResult = { text: string; from: number; to: number } | { error: string };

/** Replaces line block (section, block) in `src` with `block`, rewriting only its lines; checks it reads back. */
export function replaceBlock(srcIn: string, section: number, blockIndex: number, block: LineBlock): EditResult {
  const src = srcIn.replace(/\r\n?/g, "\n");
  const parsed = parseChartText(src);
  const source = parsed.sources.find((s) => s.section === section && s.block === blockIndex);
  if (!source) return { error: "that line was not found in the text" };
  const lines = src.split("\n");
  const nums = [source.chord, source.lyric, source.rhythm].filter((n): n is number => n !== undefined);
  const from = Math.min(...nums), to = Math.max(...nums);
  const fresh = blockLines(block, parsed.chart.sections.slice(0, section));
  const want = stableJson(canonicalBlock(block));
  // A lyric-only line right after a chord-only line needs a blank line between them, or they'd read as one.
  for (const pad of [[], [""]]) {
    const next = [...lines.slice(0, from - 1), ...pad, ...fresh, ...lines.slice(to)];
    const text = next.join("\n");
    const back = parseChartText(text).chart.sections[section];
    const got: Block | undefined = back?.blocks[blockIndex];
    if (got && back && back.blocks.length === parsed.chart.sections[section]!.blocks.length && stableJson(canonicalBlock(got)) === want) {
      return { text, from: from + pad.length, to: from + pad.length + fresh.length - 1 };
    }
  }
  return { error: "the change could not be written so it reads back the same; edit the text instead" };
}

/**
 * Sets the chord on a syllable. `group` is a chord-line group as typed
 * (`G`, `|Bbm7/C[2&]`); undefined removes the syllable's chord.
 */
export function setChordAt(src: string, target: ChordTarget, change: { group?: string; place: Place }): EditResult {
  const parsed = parseChartText(src);
  const block = parsed.chart.sections[target.section]?.blocks[target.block];
  if (block?.kind !== "line") return { error: "that line was not found in the text" };
  const next: LineBlock = structuredClone(block);
  const idx = anchorIndex(next, target.syllable);
  if (idx >= 0) next.above.splice(idx, 1);
  if (change.group === undefined) {
    if (idx < 0) return { error: "there is no chord on that syllable" };
  } else {
    const typed = change.group.trim().replace(/^[<>]+/, "");
    if (!typed) return { error: "type a chord, e.g. G or |Am7[2&]" };
    const p = parseGroup(typed);
    if ("error" in p) return { error: p.error };
    if (!p.items.length) return { error: "type a chord, e.g. G or |Am7[2&]" };
    // "After" pins right after the syllable's letters, so the chord comes before anything
    // else in the gap (a bar line there starts the next measure).
    const anchor: Anchor = { at: change.place === "after" ? target.syllable.end : target.syllable.start, items: p.items };
    if (change.place !== "on") anchor.place = change.place;
    insertAt(next.above, anchor);
    if (change.place === "on") {
      const synced = syncRhythmMark(next, anchor, target.syllable, meterBefore(parsed.chart, target.section, target.block));
      if (synced) return synced;
    }
  }
  return replaceBlock(src, target.section, target.block, next);
}

/** The meter in force at the start of line (section, block): the chart's, changed by inline meter marks on earlier lines. */
function meterBefore(chart: Chart, section: number, block: number): Meter {
  let meter = chart.meta.meter ?? DEFAULT_METER;
  chart.sections.forEach((s, si) => s.blocks.forEach((b, bi) => {
    if (b.kind === "line" && (si < section || (si === section && bi < block))) meter = lineTiming(b, meter).endMeter;
  }));
  return meter;
}

const SUBDIVISION_NAMES: [number, string][] = [[0, ""], [1 / 4, "e"], [1 / 3, "te"], [1 / 2, "&"], [2 / 3, "ta"], [3 / 4, "a"]];

/** Beat-tag name of a position within a bar, in beats after beat 1 (0 -> "1", 1.5 -> "2&"); undefined off the grid. */
function beatName(offset: number): string | undefined {
  const whole = Math.floor(offset + 1e-6);
  const sub = SUBDIVISION_NAMES.find(([f]) => Math.abs(offset - whole - f) < 1e-6);
  return sub && whole >= 0 ? `${whole + 1}${sub[1]}` : undefined;
}

/** Bar (1-based) holding time t, and t's beat name in that bar. */
function barBeat(timing: LineTiming, t: number): { bar: number; beat: string } | undefined {
  const k = timing.bars.findIndex((b) => t >= b.start - 1e-6 && t < b.start + b.beats - 1e-6);
  const beat = k >= 0 ? beatName(t - timing.bars[k]!.start) : undefined;
  return beat ? { bar: k + 1, beat } : undefined;
}

/**
 * A chord placed on a syllable that has a rhythm mark must say the same beat
 * (owner, 2026-11-15). A beat tag typed on the chord wins: the mark is
 * rewritten to it. Without a tag, the chord takes the mark's beat as its tag
 * when the default (beat 1 or the middle beat) would put it elsewhere.
 * Changes `block` in place; returns an error when they can't be made to match.
 */
function syncRhythmMark(block: LineBlock, anchor: Anchor, syl: SyllableSpan, meter: Meter): { error: string } | undefined {
  const mi = (block.rhythm ?? []).findIndex((m) => m.at >= syl.start && m.at < syl.end);
  // The lyric entry (`@2`) is the first syllable's mark; a bare `@` gives no beat to match.
  const entry = mi < 0 && syl.start === 0 && !!block.lyricEntry;
  if (mi < 0 && !entry) return undefined;
  const mark: RhythmMark = entry ? { at: 0, beat: block.lyricEntry! } : block.rhythm![mi]!;
  const timing = lineTiming(block, meter);
  const ai = timing.anchors.indexOf(anchor);
  const chordT = timing.times[ai];
  const bar = [...timing.bars].reverse().find((b) => b.anchor <= ai);
  const timed = anchor.items.find((i): i is Extract<ChordLineItem, { t: "chord" | "bass" }> => i.t === "chord" || i.t === "bass");
  if (!timed) return undefined;
  if (chordT === undefined && !bar) {
    // Before the first bar line the chord has no time of its own (owner, 2026-11-20):
    // it still shows the syllable's beat. A mark in a later bar can't be said by a tag here.
    if ((mark.bar ?? 1) !== 1) return undefined;
    if (timed.beats === undefined) {
      if (beatOffset(mark.beat)) timed.beats = mark.beat; // beat 1 needs no tag
    } else {
      const first = timed.beats.split(",")[0]!;
      if (beatOffset(first) === undefined) return undefined;
      if (entry) block.lyricEntry = first;
      else block.rhythm![mi] = { at: mark.at, beat: first };
    }
    return undefined;
  }
  if (timed.beats !== undefined) {
    // The chord's beat tag wins: rewrite the syllable's mark.
    if (chordT === undefined) return undefined; // the timing warning shows on the page
    const at = barBeat(timing, chordT);
    if (!at) return undefined;
    if (!entry) block.rhythm![mi] = { at: mark.at, beat: at.beat, ...(at.bar !== 1 ? { bar: at.bar } : {}) };
    else if (at.bar === 1) block.lyricEntry = at.beat;
    else return { error: `the lyric comes in on beat ${mark.beat} of the first bar; the chord's beat must be in that bar too` };
    return undefined;
  }
  const probe: LineBlock = entry ? { kind: "line", lyrics: block.lyrics, above: block.above, lyricEntry: mark.beat } : { kind: "line", lyrics: block.lyrics, above: block.above, rhythm: [mark] };
  const markT = lineTiming(probe, meter).marks[0]?.t;
  if (markT === undefined || (chordT !== undefined && Math.abs(chordT - markT) < 1e-6)) return undefined;
  // No tag: the chord takes the syllable's beat.
  const where = `the rhythm line puts this syllable on ${mark.bar && mark.bar !== 1 ? `bar ${mark.bar}, ` : ""}beat ${mark.beat}`;
  if (!bar || markT < bar.start - 1e-6 || markT >= bar.start + bar.beats - 1e-6) return { error: `${where}, outside this chord's bar; type the chord's beat, e.g. G[3], or fix the rhythm line` };
  timed.beats = beatName(markT - bar.start)!;
  const check = lineTiming(block, meter);
  if (Math.abs((check.times[ai] ?? NaN) - markT) > 1e-6) return { error: `${where}, but the chord can't go there (it must come after the chord before it); type the chord's beat` };
  return undefined;
}

/**
 * The chord in the space before a line's lyric (owner, 2026-11-20): only a
 * line with a lyric entry (`@2`, or a bare `@`) has one, pinned to character
 * 0 ahead of the first syllable's own chord. Without an entry the lyric is on
 * the bar, and a chord over the first syllable belongs to that syllable.
 */
function lineStartIndex(block: LineBlock): number {
  return edgeIndex(block);
}

/** The chord in the space before a line's lyric (as typed), and the beat its lyric comes in on. */
export function lineStartAt(src: string, section: number, blockIndex: number): { group?: string; entry?: string } | undefined {
  const { chart } = parseChartText(src);
  const block = chart.sections[section]?.blocks[blockIndex];
  if (block?.kind !== "line") return undefined;
  const a = block.above[lineStartIndex(block)];
  return {
    ...(a ? { group: groupText({ items: a.items }).text } : {}),
    ...(block.lyricEntry ? { entry: block.lyricEntry } : {}),
  };
}

/**
 * Sets the start of a line (owner, 2026-11-13: a chord in the empty space
 * before the lyric): `group` is the chord in the space as typed (undefined or
 * empty removes it), `entry` the beat the lyric comes in on ("2", "1&").
 * Neither needs the other (owner, 2026-11-20): a chord with no beat makes the
 * lyric come in after it (a bare `@`); with neither, the lyric is on the bar.
 * The first syllable's own chord is never touched.
 */
export function setLineStart(src: string, section: number, blockIndex: number, change: { group?: string; entry?: string }): EditResult {
  const { chart } = parseChartText(src);
  const block = chart.sections[section]?.blocks[blockIndex];
  if (block?.kind !== "line") return { error: "that line was not found in the text" };
  const next: LineBlock = structuredClone(block);
  const idx = lineStartIndex(next);
  const entry = (change.entry ?? "").trim().replace(/^@/, "");
  if (entry && beatOffset(entry) === undefined) return { error: `“${entry}” is not a beat; type e.g. 2, 3 or 1&` };
  const typed = (change.group ?? "").trim().replace(/^[<>]+/, "");
  if (typed) {
    const p = parseGroup(typed);
    if ("error" in p) return { error: p.error };
    if (!p.items.length) return { error: "type a chord, e.g. G or |Am7" };
    // Pinned to character 0, ahead of the first syllable's chord.
    const anchor: Anchor = { at: 0, items: p.items };
    if (idx >= 0) next.above[idx] = anchor;
    else next.above.splice(0, 0, anchor);
  } else if (idx >= 0) next.above.splice(idx, 1);
  if (typed || entry) next.lyricEntry = entry;
  else delete next.lyricEntry;
  return replaceBlock(src, section, blockIndex, next);
}

const WORD_SPLIT =/^[\p{L}\p{N}'’]+(-[\p{L}\p{N}'’]+)*$/u;

/** How a word is split into sung syllables for this chart, e.g. "ded-i-cat-ed". */
export function splitOf(word: string, language: string | undefined, overrides: readonly string[] | undefined): string {
  return syllables(word, language, overrides).join("-");
}

/**
 * Sets how `word` splits into sung syllables in this chart (owner,
 * 2026-11-10): `split` is the word with hyphens where it breaks
 * ("de-di-cat-ed"; no hyphen = one syllable). Kept in the chart's
 * "Syllables:" header line; a split that matches the automatic one is
 * dropped from the line, and an empty line is removed.
 */
export function setSyllables(srcIn: string, word: string, split: string): { text: string; line?: number } | { error: string } {
  const src = srcIn.replace(/\r\n?/g, "\n");
  const typed = split.trim();
  if (!WORD_SPLIT.test(typed)) return { error: "write the word with hyphens where it splits, e.g. ded-i-cat-ed" };
  if (typed.replace(/-/g, "").toLowerCase() !== word.toLowerCase()) return { error: `the letters must spell “${word}”` };
  const { chart } = parseChartText(src);
  const same = (e: string) => e.replace(/-/g, "").toLowerCase() === word.toLowerCase();
  const list = (chart.meta.syllables ?? []).filter((e) => !same(e));
  const auto = splitOf(word, chart.meta.language, list);
  if (typed.toLowerCase() !== auto.toLowerCase()) list.push(typed.toLowerCase());
  // The header: lines before the first line that isn't a header field (or blank).
  const lines = src.split("\n");
  let last = -1, at = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.trim() === "") continue;
    const m = /^([A-Za-z][A-Za-z ]*?)\s*:/.exec(l);
    if (!m || !HEADER_KEYS[m[1]!.toLowerCase()]) break;
    last = i;
    if (HEADER_KEYS[m[1]!.toLowerCase()] === "syllables") at = i;
  }
  const value = list.length ? `Syllables: ${list.join(", ")}` : undefined;
  if (at >= 0) {
    if (value) lines[at] = value; else lines.splice(at, 1);
  } else if (value) lines.splice(last + 1, 0, value);
  const line = value ? (at >= 0 ? at : last + 1) + 1 : undefined;
  return line === undefined ? { text: lines.join("\n") } : { text: lines.join("\n"), line };
}

// ---- Sections and Repeat lines from the page (owner, 2026-11-14) -------------------------
// Click a divider to insert a section or a Repeat line; click a section label or a Repeat
// line to edit, move or delete it. The text is cut into one chunk of lines per section,
// the chunks are changed, and the result must read back as the sections we expect.

const sectionJson = (s: Section) => stableJson({ type: s.type, label: s.label, blocks: s.blocks.map(canonicalBlock) });
const READ_BACK = "the change could not be written so it reads back the same; edit the text instead";
const normalize = (src: string) => src.replace(/\r\n?/g, "\n");

/** The lines before the first section, and each section's lines (without the blank lines after it). */
function sectionChunks(src: string): { head: string[]; chunks: string[][]; starts: number[] } {
  const parsed = parseChartText(src);
  const lines = src.split("\n");
  const starts = parsed.sectionLines.map((n) => n - 1);
  const trimEnd = (a: string[]) => { while (a.length && a[a.length - 1]!.trim() === "") a.pop(); return a; };
  return {
    head: trimEnd(lines.slice(0, starts[0] ?? lines.length)),
    chunks: starts.map((st, i) => trimEnd(lines.slice(st, starts[i + 1] ?? lines.length))),
    starts,
  };
}

/**
 * Joins the chunks (one blank line between sections) and checks the text
 * reads back as `expected`. A section without a heading (one that starts
 * with its Repeat line) would join an empty section before it, so the
 * second try gives every such section a "#" heading. `focus` is the chunk
 * whose lines come back as `from`/`to` (past the end: the end of the text).
 */
function writeChunks(head: string[], chunks: string[][], expected: Section[], focus: number): EditResult {
  for (const fix of [false, true]) {
    const out = [...head];
    const ranges: [number, number][] = [];
    for (const c0 of chunks) {
      const c = fix && !c0[0]?.startsWith("#") ? ["#", ...c0] : c0;
      if (out.length) out.push("");
      ranges.push([out.length + 1, out.length + c.length]);
      out.push(...c);
    }
    const text = out.join("\n") + "\n";
    const back = parseChartText(text).chart.sections;
    if (back.length === expected.length && back.every((s, k) => sectionJson(s) === sectionJson(expected[k]!))) {
      const end = out.length + 1;
      const [from, to] = ranges[focus] ?? [end, end];
      return { text, from, to };
    }
  }
  return { error: READ_BACK };
}

/** "# Label", with "=type" only when the label doesn't give the type. */
function headingLine(label: string, type: SectionType): string {
  return `# ${label}${type !== sectionTypeOf(label) ? ` =${type}` : ""}`;
}

function checkLabel(labelIn: string, type: SectionType | undefined): { label: string; type: SectionType } | { error: string } {
  const label = labelIn.trim();
  if (!label) return { error: "type a label, e.g. Chorus or 1st Ver" };
  if (/[\r\n]/.test(label)) return { error: "the label must be one line" };
  if (type && !SECTION_TYPES.includes(type)) return { error: `"${type}" is not a section type` };
  return { label, type: type ?? sectionTypeOf(label) };
}

/** Adds an empty section headed `label` so it becomes section `at` (0 = before the first section). */
export function insertSection(srcIn: string, at: number, change: { label: string; type?: SectionType }): EditResult {
  const src = normalize(srcIn);
  const { sections } = parseChartText(src).chart;
  if (at < 0 || at > sections.length) return { error: "that place was not found in the chart" };
  const c = checkLabel(change.label, change.type);
  if ("error" in c) return c;
  const { head, chunks } = sectionChunks(src);
  chunks.splice(at, 0, [headingLine(c.label, c.type)]);
  const expected = [...sections];
  expected.splice(at, 0, { type: c.type, label: c.label, blocks: [] });
  return writeChunks(head, chunks, expected, at);
}

/** Earlier sections a Repeat line at `at` can point to: labeled ones, the latest of each label. */
export function repeatChoices(src: string, at: number): { index: number; label: string; type: SectionType }[] {
  const out: { index: number; label: string; type: SectionType }[] = [];
  const seen = new Set<string>();
  const sections = parseChartText(src).chart.sections.slice(0, Math.max(0, at));
  for (let i = sections.length - 1; i >= 0; i--) {
    const s = sections[i]!;
    if (!s.label || seen.has(s.label)) continue;
    seen.add(s.label);
    out.unshift({ index: i, label: s.label, type: s.type });
  }
  return out;
}

/**
 * The Repeat note "Repeat A", "Repeat A and B", "Repeat A, B and C" plus
 * optional text, for a Repeat in section `at` pointing back to `targets`.
 * A name gets "|label" when its type alone would find a later section.
 */
function buildRepeat(before: readonly Section[], targets: number[], extraIn: string | undefined): NoteBlock | { error: string } {
  if (!targets.length) return { error: "pick the section(s) to repeat" };
  const refs: SectionRef[] = [];
  for (const t of targets) {
    const s = before[t];
    if (!s) return { error: "a Repeat can only point back to an earlier section" };
    if (!s.label) return { error: "that section has no label to point to" };
    refs.push({ section: s.type, text: s.label });
  }
  const extra = (extraIn ?? "").trim();
  if (/[\r\n{}]/.test(extra)) return { error: "the extra text must be one line, without { }" };
  const pieces: NoteBlock["pieces"] = [{ text: "Repeat " }];
  refs.forEach((r, k) => {
    if (k > 0) pieces.push({ text: k === refs.length - 1 ? " and " : ", " });
    pieces.push(r);
  });
  if (extra) pieces.push({ text: ` ${extra}` });
  const block: NoteBlock = { kind: "note", pieces };
  const probe: Chart = { meta: { title: "", artist: "", key: "" }, sections: [...before, { type: "other", label: "", blocks: [block] }] };
  const found = resolveRepeats(probe).refs;
  refs.forEach((r, k) => { if (found.get(r) !== targets[k]) r.label = r.text; });
  return block;
}

/** Whether the note at (si, bi) in `text` points back to exactly `targets`. */
function pointsTo(text: string, si: number, bi: number, targets: number[]): boolean {
  const chart = parseChartText(text).chart;
  const note = chart.sections[si]?.blocks[bi];
  if (note?.kind !== "note") return false;
  const got = resolveRepeats(chart).refs;
  const refs = note.pieces.filter((p): p is SectionRef => "section" in p);
  return refs.length === targets.length && refs.every((p, k) => got.get(p) === targets[k]);
}

/**
 * Adds a "Repeat ..." line as its own section at `at`, pointing back to the
 * earlier sections `targets` (indices). `extra` is text after the names, e.g. "(2x)".
 */
export function insertRepeat(srcIn: string, at: number, change: { targets: number[]; extra?: string }): EditResult {
  const src = normalize(srcIn);
  const { sections } = parseChartText(src).chart;
  if (at < 0 || at > sections.length) return { error: "that place was not found in the chart" };
  const before = sections.slice(0, at);
  const block = buildRepeat(before, change.targets, change.extra);
  if ("error" in block) return block;
  const { head, chunks } = sectionChunks(src);
  chunks.splice(at, 0, blockLines(block, before));
  const expected = [...sections];
  expected.splice(at, 0, { type: "other", label: "", blocks: [block] });
  const r = writeChunks(head, chunks, expected, at);
  if ("error" in r) return r;
  return pointsTo(r.text, at, 0, change.targets) ? r : { error: READ_BACK };
}

/** A section as the page menu shows it: label, type, and how many Repeat names point to it. */
export function sectionInfo(src: string, si: number): { label: string; type: SectionType; autoType: SectionType; count: number; repeatedBy: number } | undefined {
  const chart = parseChartText(src).chart;
  const s = chart.sections[si];
  if (!s) return undefined;
  const repeatedBy = [...resolveRepeats(chart).refs.values()].filter((t) => t === si).length;
  return { label: s.label, type: s.type, autoType: s.label ? sectionTypeOf(s.label) : "other", count: chart.sections.length, repeatedBy };
}

/**
 * Renames section `si` and/or changes its type. Repeat names that point to
 * it follow the new label, so "Repeat Chorus" becomes "Repeat Refrain".
 */
export function editSection(srcIn: string, si: number, change: { label: string; type?: SectionType }): EditResult {
  const src = normalize(srcIn);
  const parsed = parseChartText(src);
  const { sections } = parsed.chart;
  const s = sections[si];
  if (!s) return { error: "that section was not found in the text" };
  const c = checkLabel(change.label, change.type);
  if ("error" in c) return c;
  const { head, chunks, starts } = sectionChunks(src);
  const expected: Section[] = structuredClone(sections);
  expected[si] = { ...expected[si]!, label: c.label, type: c.type };
  const chunk = chunks[si]!;
  // A section without a heading (it starts with its Repeat line) gets one: its lines shift down one.
  const shift = chunk[0]?.startsWith("#") ? 0 : 1;
  if (shift) chunk.unshift(headingLine(c.label, c.type));
  else chunk[0] = headingLine(c.label, c.type);
  // Repeat names that point to this section: rewrite their lines with the new name.
  const refs = resolveRepeats(parsed.chart).refs;
  const moved: { si: number; bi: number; targets: number[] }[] = [];
  for (const { section: j, block: bi, line } of [...parsed.noteLines].reverse()) {
    const note = sections[j]!.blocks[bi] as NoteBlock;
    const mine = note.pieces.filter((p): p is SectionRef => "section" in p);
    if (!mine.some((p) => refs.get(p) === si)) continue;
    const next: NoteBlock = structuredClone(note);
    next.pieces.forEach((p, k) => {
      const old = note.pieces[k]!;
      if (!("section" in p) || !("section" in old) || refs.get(old) !== si) return;
      p.text = c.label;
      p.section = c.type;
      if (p.label !== undefined) p.label = c.label;
    });
    expected[j]!.blocks[bi] = next;
    const k = line - 1 - starts[j]! + (j === si ? shift : 0);
    chunks[j]!.splice(k, 1, ...blockLines(next, expected.slice(0, j)));
    moved.push({ si: j, bi, targets: mine.map((p) => refs.get(p)!) });
  }
  const r = writeChunks(head, chunks, expected, si);
  if ("error" in r) return r;
  return moved.every((m) => pointsTo(r.text, m.si, m.bi, m.targets)) ? { ...r, to: r.from } : { error: READ_BACK };
}

/** Deletes section `si` with all its lines. Repeat lines that pointed to it then point nowhere. */
export function deleteSection(srcIn: string, si: number): EditResult {
  const src = normalize(srcIn);
  const { sections } = parseChartText(src).chart;
  if (!sections[si]) return { error: "that section was not found in the text" };
  const { head, chunks } = sectionChunks(src);
  chunks.splice(si, 1);
  const expected = sections.filter((_, k) => k !== si);
  const r = writeChunks(head, chunks, expected, si);
  return "error" in r ? r : { ...r, to: r.from };
}

/** Moves section `si` one place up (-1) or down (+1). */
export function moveSection(srcIn: string, si: number, dir: -1 | 1): EditResult {
  const src = normalize(srcIn);
  const { sections } = parseChartText(src).chart;
  const sj = si + dir;
  if (!sections[si] || !sections[sj]) return { error: dir < 0 ? "this is already the first section" : "this is already the last section" };
  const { head, chunks } = sectionChunks(src);
  [chunks[si], chunks[sj]] = [chunks[sj]!, chunks[si]!];
  const expected = [...sections];
  [expected[si], expected[sj]] = [expected[sj]!, expected[si]!];
  return writeChunks(head, chunks, expected, sj);
}

/**
 * A note block as the page menu shows it. `targets` (the sections it points
 * back to) and `extra` are set only for a plain Repeat line: "Repeat " and
 * names joined by ", " / " and ", then optional text. `ownSection`: the note
 * is the whole of an unlabeled section, so it moves and deletes as one.
 */
export function repeatInfo(src: string, si: number, bi: number): { targets?: number[]; extra: string; ownSection: boolean; text: string } | undefined {
  const chart = parseChartText(src).chart;
  const section = chart.sections[si];
  const note = section?.blocks[bi];
  if (note?.kind !== "note") return undefined;
  const ownSection = !section!.label && section!.blocks.length === 1;
  const text = note.pieces.map((p) => p.text).join("");
  const p = note.pieces;
  const first = p[0];
  const plain = { extra: "", ownSection, text };
  if (!first || !("text" in first) || "section" in first || !/^repeat\s+$/i.test(first.text)) return plain;
  const found = resolveRepeats(chart).refs;
  const targets: number[] = [];
  let k = 1;
  for (;;) {
    const r = p[k];
    if (!r || !("section" in r)) return plain;
    const t = found.get(r);
    if (t === undefined) return plain;
    targets.push(t);
    k++;
    const sep = p[k], after = p[k + 1];
    if (sep && !("section" in sep) && (sep.text === ", " || sep.text === " and ") && after && "section" in after) { k++; continue; }
    break;
  }
  const rest = p.slice(k);
  if (rest.length > 1 || rest.some((x) => "section" in x)) return plain;
  return { targets, extra: rest.length ? rest[0]!.text.trim() : "", ownSection, text };
}

/** The note's line in the chunk of its section. */
function noteIndex(src: string, si: number, bi: number): number | undefined {
  const parsed = parseChartText(src);
  const n = parsed.noteLines.find((x) => x.section === si && x.block === bi);
  return n ? n.line - parsed.sectionLines[si]! : undefined;
}

/** Points the Repeat line (si, bi) back to other sections and/or changes its extra text. */
export function setRepeat(srcIn: string, si: number, bi: number, change: { targets: number[]; extra?: string }): EditResult {
  const src = normalize(srcIn);
  const { sections } = parseChartText(src).chart;
  const k = noteIndex(src, si, bi);
  if (k === undefined) return { error: "that Repeat line was not found in the text" };
  const before = sections.slice(0, si);
  const block = buildRepeat(before, change.targets, change.extra);
  if ("error" in block) return block;
  const { head, chunks } = sectionChunks(src);
  const lines = blockLines(block, before);
  chunks[si]!.splice(k, 1, ...lines);
  const expected: Section[] = structuredClone(sections);
  expected[si]!.blocks[bi] = block;
  const r = writeChunks(head, chunks, expected, si);
  if ("error" in r) return r;
  if (!pointsTo(r.text, si, bi, change.targets)) return { error: READ_BACK };
  return { text: r.text, from: r.from + k, to: r.from + k + lines.length - 1 };
}

/** Deletes the note (si, bi): its whole section when it is one by itself, else just its line. */
export function deleteNote(srcIn: string, si: number, bi: number): EditResult {
  const src = normalize(srcIn);
  const info = repeatInfo(src, si, bi);
  if (!info) return { error: "that line was not found in the text" };
  if (info.ownSection) return deleteSection(src, si);
  const k = noteIndex(src, si, bi);
  if (k === undefined) return { error: "that line was not found in the text" };
  const { sections } = parseChartText(src).chart;
  const { head, chunks } = sectionChunks(src);
  chunks[si]!.splice(k, 1);
  const expected: Section[] = structuredClone(sections);
  expected[si]!.blocks.splice(bi, 1);
  const r = writeChunks(head, chunks, expected, si);
  return "error" in r ? r : { text: r.text, from: r.from + k, to: r.from + k };
}
