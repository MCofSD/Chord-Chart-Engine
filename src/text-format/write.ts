/**
 * Chart -> chart text format (NOTES.md, "Chart text format"), so charts made
 * by the PDF importer or by hand in JSON open in the editor.
 *
 * Each block is checked by reading it back: if the text would not give the
 * same block (canonical form), it is written as a fenced JSON block instead,
 * so nothing is ever lost.
 */
import type { Block, Chart, ChordLineItem, LineBlock, LyricPiece, NoteBlock, Section } from "../model/chart.js";
import { sectionTypeOf } from "../rules/index.js";
import { canonicalBlock, lyricText, stableJson } from "./canonical.js";
import { HEADER_KEYS, inferRefType, isRhythmLine, parseChartText } from "./parse.js";
import { groupText, itemText, parseGroup } from "./tokens.js";

const ESCAPE = /[\\{}_^~]/g;
const STYLE_MARK = { backup: "_", aside: "^", asideUpright: "^^" } as const;

function metaLines(chart: Chart): string[] {
  const out: string[] = [];
  const m = chart.meta as unknown as Record<string, unknown>;
  for (const [typed, key] of Object.entries(HEADER_KEYS)) {
    const v = m[key];
    if (v === undefined) continue;
    const name = typed.replace(/\b\w/, (c) => c.toUpperCase()).replace("Bpm", "BPM");
    const value = key === "meter" ? `${(v as { top: number }).top}/${(v as { bottom: number }).bottom}` : String(v);
    out.push(`${name}: ${value}`);
  }
  const known = new Set<string>(Object.values(HEADER_KEYS));
  const extra = Object.fromEntries(Object.entries(m).filter(([k]) => !known.has(k) && !k.startsWith("_")));
  if (Object.keys(extra).length) out.push("```json", JSON.stringify({ meta: extra }), "```");
  return out;
}

/** Lyric text pieces as "cells": one per real character, carrying what is written before it. */
interface Cell { before: string; ch: string }

function lyricCells(pieces: LyricPiece[]): { cells: Cell[]; tail: string } {
  const cells: Cell[] = [];
  let pending = "";
  for (const p of pieces) {
    if ("item" in p) {
      const it: ChordLineItem = p.item;
      pending += it.t === "endingOpen" || it.t === "endingClose" ? itemText(it).text : `{${itemText(it).text}}`;
      continue;
    }
    const mark = p.style ? STYLE_MARK[p.style] : "";
    pending += mark;
    [...p.text].forEach((ch, k) => {
      cells.push({ before: pending, ch: ch.replace(ESCAPE, "\\$&") });
      pending = "";
      void k;
    });
    pending += mark;
  }
  return { cells, tail: pending };
}

interface Layout { chord?: string; lyric?: string; rhythm?: string }

/**
 * Lays out one line block: places each chord group so its first chord's root
 * sits over its character, padding the lyric (`~` inside words, extra spaces
 * between them) where groups would collide.
 */
function layoutLine(b: LineBlock, forceChord: boolean, forceLyric: boolean): Layout {
  const text = lyricText(b.lyrics);
  const hasLyric = b.lyrics.length > 0 || b.lyricEntry !== undefined;
  const { cells, tail } = lyricCells(b.lyrics);
  const prefix = (forceLyric ? ". " : "") + (b.lyricEntry !== undefined ? `@${b.lyricEntry} ` : "");
  const pad = new Array<number>(cells.length + 1).fill(0);
  let lead = 0;
  if (cells[0]?.ch === "@" && !cells[0].before) cells[0].ch = "\\@";

  const cellText = (k: number) => {
    const c = cells[k]!;
    const p = pad[k]!;
    if (!p) return c.before + c.ch;
    // Extra spaces after a space read as padding for the next word; elsewhere (inside a word, before a space) use "~".
    const spaces = c.ch !== " " && c.before === "" && k > 0 && cells[k - 1]!.ch === " ";
    return c.before + (spaces ? " " : "~").repeat(p) + c.ch;
  };
  const colOf = (idx: number) => {
    let col = prefix.length + lead;
    for (let k = 0; k < idx; k++) col += cellText(k).length;
    const c = cells[idx]!;
    return col + c.before.length + pad[idx]! + (c.ch.length - 1);
  };
  const lyricLine = () => prefix + " ".repeat(lead) + cells.map((_, k) => cellText(k)).join("") + tail;

  const groups = b.above.filter((a) => !a.alignRight).map((a) => ({ a, g: groupText(a) }));
  const fallback = groups.map((x) => ({ ...x, g: groupText(x.a, true) }));
  const pick = groups.map((x, k) => {
    const back = parseGroupSafe(x.g.text);
    return back && stableJson(back) === stableJson(canonicalItems(x.a.items)) ? x : fallback[k]!;
  });
  const inText = pick.filter((x) => x.a.at < text.length).sort((p, q) => p.a.at - q.a.at);
  const past = pick.filter((x) => x.a.at >= text.length).sort((p, q) => p.a.at - q.a.at);
  const marks = [...(b.rhythm ?? [])].sort((p, q) => p.at - q.at);

  type Placement = { at: number; hang: number; width: number; line: "c" | "r"; text: string };
  const places: Placement[] = [
    ...inText.map((x) => ({ at: x.a.at, hang: x.g.rootOffset ?? 0, width: x.g.text.length, line: "c" as const, text: x.g.text })),
    ...marks.map((m) => {
      const t = (m.bar !== undefined && m.bar !== 1 ? `${m.bar}:` : "") + m.beat;
      return { at: m.at, hang: 0, width: t.length, line: "r" as const, text: t };
    }),
  ].sort((p, q) => p.at - q.at);
  const cursor = { c: forceChord ? 2 : 0, r: 0 };
  const placed: { col: number; text: string; line: "c" | "r" }[] = [];
  for (let k = 0; k < places.length; ) {
    let z = k;
    while (z < places.length && places[z]!.at === places[k]!.at) z++;
    const at = places[k]!.at;
    if (at >= cells.length) return {}; // a rhythm mark past the end: not expressible
    // Several groups on one character: the earlier ones go over the padding
    // before it (padding columns belong to the next character), the last one
    // right over it. They must not reach back over the previous character.
    const group = places.slice(k, z);
    const region = at === 0 ? 0 : colOf(at - 1) + 1;
    const next = { ...cursor };
    const anchors = group.map((p) => {
      const a = Math.max(next[p.line] + p.hang, region);
      next[p.line] = a - p.hang + p.width + 1;
      return a;
    });
    const need = Math.max(...anchors);
    const col = colOf(at);
    if (col < need) {
      if (at === 0) lead += need - col;
      else pad[at] = pad[at]! + need - col;
    }
    const c2 = colOf(at);
    group.forEach((p, n) => {
      const last = !group.slice(n + 1).some((q) => q.line === p.line);
      const a = last ? c2 : anchors[n]!;
      placed.push({ col: a - p.hang, text: p.text, line: p.line });
      cursor[p.line] = a - p.hang + p.width + 1;
    });
    k = z;
  }
  const lyric = lyricLine();
  let pastCol = Math.max(cursor.c, hasLyric ? lyric.length + 1 : 0);
  for (const x of past) {
    placed.push({ col: pastCol, text: x.g.text, line: "c" });
    pastCol += x.g.text.length + 1;
  }
  for (const a of b.above.filter((a) => a.alignRight)) {
    const g = groupText(a);
    placed.push({ col: pastCol, text: g.text, line: "c" });
    pastCol += g.text.length + 1;
  }
  const build = (line: "c" | "r", start: string) => {
    let s = start;
    for (const p of placed.filter((p) => p.line === line)) s = s.padEnd(p.col) + p.text;
    return s;
  };
  const out: Layout = {};
  if (b.above.length || forceChord) out.chord = build("c", forceChord ? "! " : "");
  if (hasLyric) out.lyric = lyric;
  if (marks.length) out.rhythm = build("r", "");
  return out;
}

function parseGroupSafe(text: string): ChordLineItem[] | undefined {
  const p = parseGroup(text);
  return "error" in p ? undefined : canonicalItems(p.items);
}
function canonicalItems(items: ChordLineItem[]): ChordLineItem[] {
  return (canonicalBlock({ kind: "line", lyrics: [], above: [{ at: 0, items }] }) as LineBlock).above[0]!.items;
}

function noteLine(b: NoteBlock, before: readonly Section[]): string {
  const body = b.pieces
    .map((p) => {
      if (!("section" in p)) return p.text;
      const inferred = inferRefType(p.text, p.label, before);
      return `{${p.text}${p.label !== undefined ? `|${p.label}` : ""}${inferred !== p.section ? `=${p.section}` : ""}}`;
    })
    .join("");
  return /^repeat\b/i.test(body) ? body : `> ${body}`;
}

/** Reads `lines` back as the first block of a section and compares with `block`. */
function readsBack(lines: string[], block: Block, before: readonly Section[]): boolean {
  const head = before.map((s) => `# ${s.label} =${s.type}`);
  const { chart } = parseChartText(["Title: x", "Key: C", ...head, "# x", ...lines].join("\n"));
  const sec = chart.sections[chart.sections.length - 1];
  if (!sec || sec.blocks.length !== 1) return false;
  return stableJson(canonicalBlock(sec.blocks[0]!)) === stableJson(canonicalBlock(block));
}

function blockLines(block: Block, before: readonly Section[]): string[] {
  if (block.kind === "line") {
    for (const [fc, fl] of [[false, false], [false, true], [true, false], [true, true]] as const) {
      const l = layoutLine(block, fc, fl);
      if (l.chord === undefined && l.lyric === undefined) continue;
      const lines = [l.chord, l.lyric, l.rhythm].filter((x): x is string => x !== undefined);
      if (readsBack(lines, block, before)) return lines;
    }
  } else if (block.kind === "note") {
    const line = noteLine(block, before);
    if (readsBack([line], block, before)) return [line];
  }
  return ["```json", JSON.stringify(block), "```"];
}

export function writeChartText(chart: Chart): string {
  const out: string[] = metaLines(chart);
  if (chart.cover) out.push("```json", JSON.stringify({ cover: chart.cover }), "```");
  chart.sections.forEach((s, si) => {
    const before = chart.sections.slice(0, si);
    out.push("");
    const startsWithNote = s.blocks[0]?.kind === "note";
    if (s.label || !startsWithNote || s.type !== "other") {
      const inferred = s.label ? sectionTypeOf(s.label) : "other";
      out.push(`#${s.label ? " " + s.label : ""}${inferred !== s.type ? ` =${s.type}` : ""}`);
    }
    let prev: Block | undefined;
    for (const b of s.blocks) {
      const lines = blockLines(b, before);
      // A chord-only line followed by a lyric-only line would read as one block: keep them apart.
      const prevChordOnly = prev?.kind === "line" && prev.lyrics.length === 0 && prev.lyricEntry === undefined;
      const lyricOnly = b.kind === "line" && b.above.length === 0;
      // A lyric line without a rhythm line would take a rhythm-looking next line as its rhythm.
      const prevLyricNoRhythm = prev?.kind === "line" && prev.lyrics.length > 0 && !prev.rhythm?.length;
      if ((prevChordOnly && lyricOnly) || (prevLyricNoRhythm && lines[0] !== undefined && isRhythmLine(lines[0]))) out.push("");
      out.push(...lines);
      prev = b;
    }
  });
  return out.join("\n") + "\n";
}
