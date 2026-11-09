/**
 * Lays out one LineBlock: chord groups over their syllables, lyric below.
 *
 * Each chord group is pinned to a lyric character (owner decision 2026-11-08:
 * over the syllable, not on a tab grid). When a group would collide with the
 * one before it, it moves right and the lyric opens the same gap before the
 * anchored character, so the chord still sits over its syllable. A gap that
 * splits a word gets a centered hyphen, like the hand-made "pre - tend".
 */
import type { LineBlock, LyricStyle } from "../model/chart.js";
import { groupRuns, itemRuns } from "./items.js";
import { runsWidth, type Run } from "./runs.js";
import { CHART } from "./tokens.js";

export interface Placed { x: number; runs: Run[] }

export interface LaidLine {
  chords: Placed[];
  lyrics: Placed[];
  /** Rightmost x used, before any compression. */
  end: number;
  /** Horizontal compression applied to fit the content width (1 = none). */
  scaleX: number;
  warnings: string[];
}

function lyricRun(text: string, style: LyricStyle | undefined): Run {
  const L = CHART.lyric;
  const fill = CHART.colors.lyric;
  switch (style) {
    case "backup": return { kind: "text", text, size: L.size, face: "arialItalic", fill };
    case "aside": return { kind: "text", text, size: L.asideSize, face: "arialItalic", fill };
    case "asideUpright": return { kind: "text", text, size: L.asideSize, face: "arial", fill };
    default: return { kind: "text", text, size: L.size, face: "arial", fill };
  }
}

const isLetter = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}'’]/u.test(ch);

export function layoutLine(block: LineBlock, left: number = CHART.content.left, right: number = CHART.content.right): LaidLine {
  const text = block.lyrics.map((p) => ("text" in p ? p.text : "")).join("");
  const lyrics: Placed[] = [];
  const chords: Placed[] = [];
  const warnings: string[] = [];
  let lyricX = left;
  let chordEnd: number | undefined;

  // Cursor over lyric pieces: piece index and character offset inside it.
  let pi = 0, off = 0, charIdx = 0;
  const emitUntil = (target: number) => {
    while (pi < block.lyrics.length) {
      const piece = block.lyrics[pi]!;
      if ("item" in piece) {
        const runs = itemRuns(piece.item);
        lyrics.push({ x: lyricX, runs });
        lyricX += runsWidth(runs);
        pi++; off = 0;
        continue;
      }
      const remaining = piece.text.length - off;
      const take = Math.min(remaining, target - charIdx);
      if (take > 0) {
        const run = lyricRun(piece.text.slice(off, off + take), piece.style);
        lyrics.push({ x: lyricX, runs: [run] });
        lyricX += runsWidth([run]);
        off += take; charIdx += take;
      }
      if (off < piece.text.length) return; // stopped inside this piece at target
      pi++; off = 0;
      if (charIdx >= target) {
        // Stop before an inline item only if the next text starts exactly at target.
        const next = block.lyrics[pi];
        if (!next || "text" in next) return;
      }
    }
  };

  /** Width of the lyric text between two character indices, or undefined if an inline item sits between them. */
  const measure = (from: number, to: number): number | undefined => {
    let idx = 0, w = 0;
    for (const piece of block.lyrics) {
      if ("item" in piece) {
        if (idx > from && idx < to) return undefined;
        continue;
      }
      const a = Math.max(from, idx), b = Math.min(to, idx + piece.text.length);
      if (b > a) w += runsWidth([lyricRun(piece.text.slice(a - idx, b - idx), piece.style)]);
      idx += piece.text.length;
    }
    return w;
  };

  const S = CHART.spacing;
  /** Opens a gap of `shift` in the lyric at the current point; hyphenates if it splits a word. */
  const openGap = (shift: number, splitAt: number, gapStart = lyricX) => {
    if (shift <= 0) return;
    if (isLetter(text[splitAt - 1]) && isLetter(text[splitAt])) {
      const hyphen = lyricRun("-", undefined);
      const hw = runsWidth([hyphen]);
      const gap = lyricX + shift - gapStart;
      if (gap >= hw + 2) lyrics.push({ x: gapStart + (gap - hw) / 2, runs: [hyphen] });
    }
    lyricX += shift;
  };
  /** Next 0.5" tab stop at or after x. */
  const tabStop = (x: number) => S.tabOrigin + Math.ceil((x - S.tabOrigin - 1e-6) / S.tabStop) * S.tabStop;

  // "On" groups at the same character keep their written order; sort is stable.
  const anchors = block.above.filter((a) => !a.alignRight).sort((a, b) => a.at - b.at);
  let lastAt = -1;
  for (const anchor of anchors) {
    const at = Math.min(Math.max(anchor.at, 0), text.length);
    const place = anchor.place ?? "on";
    const { runs, hang } = groupRuns(anchor.items);
    const w = runsWidth(runs);
    const minX = chordEnd === undefined ? left : chordEnd + S.groupGap;
    let x: number;

    if (place === "on" && at >= text.length) {
      // Past the end of the lyric: on the tab grid, like today's charts.
      emitUntil(at);
      x = tabStop(Math.max(lyricX, minX));
    } else if (place === "on") {
      // If a gap must open, open it at the start of the anchored word (so the
      // word moves as a whole), but never before an earlier anchor in that word.
      let ins = at;
      while (ins > 0 && ins > lastAt + 1 && isLetter(text[ins - 1]) && isLetter(text[ins])) ins--;
      emitUntil(ins);
      const lead = measure(ins, at);
      if (lead === undefined) { emitUntil(at); ins = at; }
      const desired = lyricX + (ins === at ? 0 : lead!) - hang;
      x = Math.max(desired, minX);
      openGap(x - desired, ins);
      emitUntil(at);
    } else {
      // "before"/"after": the chord sits over white space between two syllables,
      // near the one it belongs to. `textEnd` is where the previous syllable's ink ends.
      emitUntil(at);
      let spaces = 0;
      while (at - spaces > 0 && /\s/.test(text[at - spaces - 1]!)) spaces++;
      const textEnd = lyricX - (measure(at - spaces, at) ?? 0);
      const hasPrev = at - spaces > 0;
      if (place === "before") {
        x = Math.max(lyricX - S.timingNear - w, hasPrev ? textEnd + S.timingFar : left, minX);
        openGap(x + w + S.timingNear - lyricX, at, textEnd);
      } else {
        x = Math.max(hasPrev ? textEnd + S.timingNear : left, minX);
        if (at < text.length) openGap(x + w + S.timingFar - lyricX, at, textEnd);
      }
    }
    chords.push({ x, runs });
    chordEnd = x + w;
    lastAt = at;
  }
  emitUntil(Infinity);

  for (const anchor of block.above.filter((a) => a.alignRight)) {
    const { runs } = groupRuns(anchor.items);
    const w = runsWidth(runs);
    const x = Math.max(right - w, (chordEnd ?? left - CHART.spacing.groupGap) + CHART.spacing.groupGap);
    chords.push({ x, runs });
    chordEnd = x + w;
  }

  const end = Math.max(lyricX, chordEnd ?? left);
  let scaleX = 1;
  if (end > right) {
    scaleX = (right - left) / (end - left);
    if (scaleX < CHART.narrowScale) {
      warnings.push(`line is ${Math.round((end - left) / (right - left) * 100)}% of the content width; compressed below Arial Narrow width`);
    }
  }
  return { chords, lyrics, end, scaleX, warnings };
}
