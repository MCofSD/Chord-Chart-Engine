/**
 * Edits the chart text from the page (owner, 2026-11-10): click a syllable,
 * then add, change or remove the chord on it, placed on, just before or just
 * after the syllable. The text stays the master copy: these functions return
 * new text, with only that line's chord, lyric and rhythm lines rewritten.
 * Pure: no DOM.
 */
import type { Anchor, Block, LineBlock } from "../model/chart.js";
import { syllables, type SyllableSpan } from "../text/syllables.js";
import { canonicalBlock, stableJson } from "./canonical.js";
import { HEADER_KEYS, parseChartText } from "./parse.js";
import { groupText, parseGroup } from "./tokens.js";
import { blockLines } from "./write.js";

export type Place = "on" | "before" | "after";

export interface ChordTarget {
  /** Section and block index in the parsed chart. */
  section: number;
  block: number;
  syllable: SyllableSpan;
}

/**
 * The anchor that belongs to a syllable: one placed "on" or "before" any of
 * its characters, or "after" it (pinned to the next syllable's start).
 */
export function anchorIndex(block: LineBlock, syl: SyllableSpan): number {
  return block.above.findIndex((a) => !a.alignRight && (a.place === "after" ? a.at === syl.next : a.at >= syl.start && a.at < syl.end));
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
    const anchor: Anchor = { at: change.place === "after" ? target.syllable.next : target.syllable.start, items: p.items };
    if (change.place !== "on") anchor.place = change.place;
    insertAt(next.above, anchor);
  }
  return replaceBlock(src, target.section, target.block, next);
}

const WORD_SPLIT = /^[\p{L}\p{N}'’]+(-[\p{L}\p{N}'’]+)*$/u;

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
