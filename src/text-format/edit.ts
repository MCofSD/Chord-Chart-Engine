/**
 * Edits the chart text from the page (owner, 2026-11-10): click a syllable,
 * then add, change or remove the chord on it, placed on, just before or just
 * after the syllable. The text stays the master copy: these functions return
 * new text, with only that line's chord, lyric and rhythm lines rewritten.
 * Pure: no DOM.
 */
import { beatOffset, resolveRepeats, type Anchor, type Block, type Chart, type ChartMeta, type LineBlock, type NoteBlock, type Section, type SectionRef, type SectionType } from "../model/chart.js";
import { sectionTypeOf } from "../rules/index.js";
import { syllableAt, syllables, type SyllableSpan } from "../text/syllables.js";
import { canonicalBlock, lyricText, stableJson } from "./canonical.js";
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
 * The chord group that belongs to a syllable: one placed "on" or "before"
 * any of its characters, or "after" it (pinned anywhere in the gap after its
 * letters, up to the next syllable's start). Groups without a chord, such as
 * a bar line, are left alone.
 */
export function anchorIndex(block: LineBlock, syl: SyllableSpan): number {
  return block.above.findIndex((a) => !a.alignRight && hasChord(a)
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
  const block = parseChartText(src).chart.sections[target.section]?.blocks[target.block];
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
  }
  return replaceBlock(src, target.section, target.block, next);
}

/**
 * The group on beat 1 at the start of a line. With a lyric entry it is pinned
 * to character 0 and stands alone at the left edge; without one it is the
 * first group over the first syllable (its letter usually sits over the
 * syllable's second character), which is also on beat 1.
 */
function lineStartIndex(block: LineBlock, meta: ChartMeta): number {
  const first = syllableAt(lyricText(block.lyrics), 0, meta.language, meta.syllables);
  const end = block.lyricEntry !== undefined ? 1 : Math.max(1, first?.end ?? 1);
  const i = block.above.findIndex((a) => !a.alignRight && a.place !== "after");
  return i >= 0 && block.above[i]!.at < end ? i : -1;
}

/** The chord on beat 1 at the start of a line (as typed), and the beat its lyric comes in on. */
export function lineStartAt(src: string, section: number, blockIndex: number): { group?: string; entry?: string } | undefined {
  const { chart } = parseChartText(src);
  const block = chart.sections[section]?.blocks[blockIndex];
  if (block?.kind !== "line") return undefined;
  const a = block.above[lineStartIndex(block, chart.meta)];
  return {
    ...(a ? { group: groupText({ items: a.items }).text } : {}),
    ...(block.lyricEntry !== undefined ? { entry: block.lyricEntry } : {}),
  };
}

/**
 * Sets the start of a line (owner, 2026-11-13: a chord in the empty space
 * before the lyric): `group` is the chord on beat 1 as typed (undefined or
 * empty removes it), `entry` the beat the lyric comes in on ("2", "1&";
 * undefined or empty: with the bar).
 */
export function setLineStart(src: string, section: number, blockIndex: number, change: { group?: string; entry?: string }): EditResult {
  const { chart } = parseChartText(src);
  const block = chart.sections[section]?.blocks[blockIndex];
  if (block?.kind !== "line") return { error: "that line was not found in the text" };
  const next: LineBlock = structuredClone(block);
  const idx = lineStartIndex(next, chart.meta);
  const entry = (change.entry ?? "").trim().replace(/^@/, "");
  if (entry && beatOffset(entry) === undefined) return { error: `“${entry}” is not a beat; type e.g. 2, 3 or 1&` };
  const typed = (change.group ?? "").trim().replace(/^[<>]+/, "");
  if (typed) {
    const p = parseGroup(typed);
    if ("error" in p) return { error: p.error };
    if (!p.items.length) return { error: "type a chord, e.g. G or |Am7" };
    // With a lyric entry the beat-1 group is pinned to character 0; without one it
    // stays where it was over the first syllable.
    const anchor: Anchor = { at: !entry && idx >= 0 ? next.above[idx]!.at : 0, items: p.items };
    if (idx >= 0) next.above[idx] = anchor;
    else next.above.splice(0, 0, anchor);
  } else if (idx >= 0) next.above.splice(idx, 1);
  if (entry) next.lyricEntry = entry;
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

// ---- Insert a section or a Repeat line at a divider (owner, 2026-11-14) ----------------

const sectionJson = (s: Section) => stableJson({ type: s.type, label: s.label, blocks: s.blocks.map(canonicalBlock) });

/**
 * Inserts lines so they become section `at` (0 = before the first section),
 * trying each candidate in turn, and keeps the first that reads back with
 * every other section unchanged and the new one passing `check`.
 * `from`/`to` in the result are the inserted lines (1-based).
 */
function insertLines(srcIn: string, at: number, candidates: string[][], check: (s: Section, chart: Chart) => boolean): EditResult {
  const src = srcIn.replace(/\r\n?/g, "\n");
  const parsed = parseChartText(src);
  const { sections } = parsed.chart;
  if (at < 0 || at > sections.length) return { error: "that place was not found in the chart" };
  const lines = src.split("\n");
  // Before section `at`'s first line, or after the last non-blank line.
  let cut = at < sections.length ? parsed.sectionLines[at]! - 1 : lines.length;
  while (cut > 0 && lines[cut - 1]!.trim() === "") cut--;
  const before = lines.slice(0, cut), after = lines.slice(cut);
  while (after.length && after[0]!.trim() === "") after.shift();
  const want = sections.map(sectionJson);
  for (const body of candidates) {
    const lead = before.length ? [""] : [];
    const next = [...before, ...lead, ...body, ...(after.length ? ["", ...after] : [""])];
    const text = next.join("\n");
    const back = parseChartText(text).chart;
    if (back.sections.length !== sections.length + 1 || !check(back.sections[at]!, back)) continue;
    const others = back.sections.filter((_, k) => k !== at).map(sectionJson);
    if (others.every((j, k) => j === want[k])) {
      const from = before.length + lead.length + 1;
      return { text, from, to: from + body.length - 1 };
    }
  }
  return { error: "the change could not be written so it reads back the same; edit the text instead" };
}

/**
 * Adds an empty section headed `label` so it becomes section `at`. `type`
 * is written ("=bridge") only when it differs from the type the label gives.
 */
export function insertSection(src: string, at: number, change: { label: string; type?: SectionType }): EditResult {
  const label = change.label.trim();
  if (!label) return { error: "type a label, e.g. Chorus or 1st Ver" };
  if (/[\r\n]/.test(label)) return { error: "the label must be one line" };
  if (change.type && !SECTION_TYPES.includes(change.type)) return { error: `"${change.type}" is not a section type` };
  const type = change.type ?? sectionTypeOf(label);
  const heading = `# ${label}${type !== sectionTypeOf(label) ? ` =${type}` : ""}`;
  // A section that starts with its own Repeat line (no heading) would join the new,
  // empty section: the second try gives it an unlabeled "#" heading of its own.
  return insertLines(src, at, [[heading], [heading, "", "#"]], (s) => s.label === label && s.type === type && s.blocks.length === 0);
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

/** "Repeat A", "Repeat A and B", "Repeat A, B and C". */
function repeatPieces(refs: SectionRef[]): NoteBlock["pieces"] {
  const out: NoteBlock["pieces"] = [{ text: "Repeat " }];
  refs.forEach((r, k) => {
    if (k > 0) out.push({ text: k === refs.length - 1 ? " and " : ", " });
    out.push(r);
  });
  return out;
}

/**
 * Adds a "Repeat ..." line as its own section at `at`, pointing back to the
 * earlier sections `targets` (indices, in the order given). `extra` is free
 * text after the names, e.g. "(2x)".
 */
export function insertRepeat(src: string, at: number, change: { targets: number[]; extra?: string }): EditResult {
  const { sections } = parseChartText(src).chart;
  if (!change.targets.length) return { error: "pick the section(s) to repeat" };
  if (at < 0 || at > sections.length) return { error: "that place was not found in the chart" };
  const before = sections.slice(0, at);
  const refs: SectionRef[] = [];
  for (const t of change.targets) {
    const s = before[t];
    if (!s) return { error: "a Repeat can only point back to an earlier section" };
    if (!s.label) return { error: "that section has no label to point to" };
    refs.push({ section: s.type, text: s.label });
  }
  const extra = (change.extra ?? "").trim();
  if (/[\r\n{}]/.test(extra)) return { error: "the extra text must be one line, without { }" };
  const pieces = repeatPieces(refs);
  if (extra) pieces.push({ text: ` ${extra}` });
  const block: NoteBlock = { kind: "note", pieces };
  // Name the exact section when its type alone would find a later one of the same type.
  const probe: Chart = { meta: { title: "", artist: "", key: "" }, sections: [...before, { type: "other", label: "", blocks: [block] }] };
  const found = resolveRepeats(probe).refs;
  refs.forEach((r, k) => { if (found.get(r) !== change.targets[k]) r.label = r.text; });
  const line = blockLines(block, before);
  const check = (s: Section, chart: Chart) => {
    if (s.blocks.length !== 1 || stableJson(canonicalBlock(s.blocks[0]!)) !== stableJson(canonicalBlock(block))) return false;
    const got = resolveRepeats(chart).refs;
    const mine = (s.blocks[0] as NoteBlock).pieces.filter((p): p is SectionRef => "section" in p);
    return mine.length === refs.length && mine.every((p, k) => got.get(p) === change.targets[k]);
  };
  // After a section with no lines yet, a Repeat line would join it: the second try gives it a "#".
  return insertLines(src, at, [line, ["#", ...line]], check);
}
