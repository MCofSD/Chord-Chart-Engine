/**
 * Lays out one LineBlock: chord groups over their syllables, lyric below.
 *
 * Each chord group is pinned to a lyric character (owner decision 2026-11-08:
 * over the syllable, not on a tab grid). When a group would collide with the
 * one before it, it moves right and the lyric opens the same gap before the
 * anchored character, so the chord still sits over its syllable. A gap that
 * splits a word gets a centered hyphen, like the hand-made "pre - tend".
 */
import type { LineBlock, LyricStyle, Meter } from "../model/chart.js";
import { groupRuns, itemRuns } from "./items.js";
import { lineTiming, type LineTiming } from "./timing.js";
import { syllableStarts } from "../text/syllables.js";
import { runsWidth, type Run } from "./runs.js";
import { CHART } from "./tokens.js";

export interface Placed {
  x: number;
  runs: Run[];
  /** Lyric text pieces: the characters [from, to) of the whole line's lyric they show (for clicking on the page). */
  chars?: [number, number];
}

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
/** Punctuation that opens a word ("I, (yeah, ¿qué): it moves with the word when a gap opens before it. */
const isOpening = (ch: string | undefined) => ch !== undefined && /["“‘(\[¿¡]/.test(ch);

export interface LineOptions {
  left?: number;
  right?: number;
  meter?: Meter;
  /** Points per beat for timed chords and syllables (0 = text-only spacing). Default CHART.spacing.beatWidth. */
  beatWidth?: number;
  /** Time axis under a notation snippet: time in beats -> x. Overrides beatWidth. */
  axis?: (t: number) => number;
  /** Precomputed timing (fitLine reuses it across trial layouts). */
  timing?: LineTiming;
  /** Language of the lyrics, for sung syllables. Default: rules lyrics.defaultLanguage. */
  language?: string;
}

export function layoutLine(block: LineBlock, opts: LineOptions = {}): LaidLine {
  const left = opts.left ?? CHART.content.left;
  const right = opts.right ?? CHART.content.right;
  const beatWidth = opts.beatWidth ?? CHART.spacing.beatWidth;
  const timing = opts.timing ?? lineTiming(block, opts.meter);
  // Beat 1 of the first bar is where its chord root sits: just right of a bar
  // line at the content edge.
  const origin = left + runsWidth(itemRuns({ t: "bar" }));
  // Once something is pushed late (text too wide for its time), everything
  // after it keeps at least its proportional distance, so bar lengths still
  // read correctly. Under a snippet the axis is absolute: the lyric must line
  // up with the image's notes.
  let delay = 0;
  const onGrid = (t: number) => origin + t * beatWidth;
  /** Where a point at time t should sit (it may be pushed further right, never left). */
  const ideal = (t: number) => (opts.axis ? opts.axis(t) : onGrid(t) + delay);
  const placedAt = (t: number, x: number) => { if (!opts.axis) delay = Math.max(delay, x - onGrid(t)); };
  const text = block.lyrics.map((p) => ("text" in p ? p.text : "")).join("");
  const lyrics: Placed[] = [];
  const chords: Placed[] = [];
  const warnings: string[] = [...timing.warnings];
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
        lyrics.push({ x: lyricX, runs: [run], chars: [charIdx, charIdx + take] });
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
      // Widen a split just enough that the hyphen always shows ("start - ed").
      shift = Math.max(shift, gapStart + hw + 2 * S.hyphenPad - lyricX);
      const gap = lyricX + shift - gapStart;
      lyrics.push({ x: gapStart + (gap - hw) / 2, runs: [hyphen] });
    }
    lyricX += shift;
  };
  // Syllables (owner, 2026-11-09): a beat lines up with the middle of its
  // syllable. A syllable runs from its character to the end of the word or
  // to the next anchored or marked character inside the word ("start|ed").
  const boundaries = new Set<number>([...timing.anchors.map((a) => a.at), ...timing.marks.map((m) => m.at)]);
  // Sung syllables split words too (Walk|ing), so a beat lands on the middle of its own syllable.
  for (const m of text.matchAll(/[\p{L}\p{N}'’]+/gu)) for (const s of syllableStarts(m[0], opts.language)) boundaries.add(m.index + s);
  /** Half the width of the syllable starting at character `at` (0 if it isn't a letter). */
  const syllableHalf = (at: number): number => {
    if (!isLetter(text[at])) return 0;
    let end = at + 1;
    while (end < text.length && isLetter(text[end]) && !boundaries.has(end)) end++;
    return (measure(at, end) ?? 0) / 2;
  };
  /** Next 0.5" tab stop at or after x. */
  const tabStop = (x: number) => S.tabOrigin + Math.ceil((x - S.tabOrigin - 1e-6) / S.tabStop) * S.tabStop;

  // A lyric mark at character 0 (lyricEntry) means the lyric comes in after
  // the downbeat: groups at character 0 are drawn first, on their own beat
  // at the left edge, and the lyric then starts at its entry time.
  const marks = timing.marks.filter((m) => m.at <= text.length);
  let entry: number | undefined;
  while (marks.length && marks[0]!.at === 0) entry = marks.shift()!.t;
  let entered = entry === undefined;
  const enter = () => {
    if (entered) return;
    const half = syllableHalf(0);
    lyricX = Math.max(lyricX, ideal(entry!) - half);
    placedAt(entry!, lyricX + half);
    entered = true;
  };

  let lastAt = -1;
  /** Opens the lyric so character `m.at` starts no earlier than its time. */
  const placeMark = (m: { at: number; t: number }) => {
    enter();
    let ins = m.at;
    while (ins > charIdx && isOpening(text[ins - 1])) ins--;
    emitUntil(ins);
    const lead = measure(ins, m.at) ?? 0;
    const half = syllableHalf(m.at);
    openGap(ideal(m.t) - half - lead - lyricX, ins);
    placedAt(m.t, lyricX + lead + half);
    lastAt = Math.max(lastAt, m.at - 1);
  };

  // "On" groups at the same character keep their written order; sort is stable.
  const { anchors, times } = timing;
  for (const [ai, anchor] of anchors.entries()) {
    const at = Math.min(Math.max(anchor.at, 0), text.length);
    const place = anchor.place ?? "on";
    while (marks.length && marks[0]!.at <= at) placeMark(marks.shift()!);
    if (!(place === "on" && at === 0)) enter();
    const { runs, beatPoint } = groupRuns(anchor.items);
    // A group with a beat point (a chord's weighted middle, a "-", a timed
    // stop) centers it over its syllable's middle; others align by their left edge.
    const point = beatPoint ?? 0;
    const w = runsWidth(runs);
    const t = times[ai];
    // Lower bound from time: the group's chord root (or "-") sits at its beat or later.
    const timeX = t === undefined ? -Infinity : ideal(t) - point;
    const minX = chordEnd === undefined ? left : chordEnd + S.groupGap;
    let x: number;

    if (place === "on" && at >= text.length) {
      // Past the end of the lyric: at its time if known, else on the tab grid like today's charts.
      emitUntil(at);
      x = t === undefined ? tabStop(Math.max(lyricX, minX)) : Math.max(timeX, lyricX, minX);
    } else if (place === "on") {
      // If a gap must open, open it at the start of the anchored word (so the
      // word moves as a whole), but never before an earlier anchor in that word.
      let ins = at;
      while (ins > 0 && ins > lastAt + 1 && ins > charIdx && isLetter(text[ins - 1]) && isLetter(text[ins])) ins--;
      // Opening punctuation goes with its word, unless it was already drawn.
      while (ins > charIdx && isOpening(text[ins - 1])) ins--;
      emitUntil(ins);
      const lead = measure(ins, at);
      if (lead === undefined) { emitUntil(at); ins = at; }
      // Groups at character 0 before a late lyric entry stay on beat 1 at the edge.
      const sylHalf = beatPoint === undefined || (!entered && at === 0) ? 0 : syllableHalf(at);
      const natural = lyricX + (ins === at ? 0 : lead!) + sylHalf - point;
      x = Math.max(natural, minX, timeX);
      openGap(x - natural, ins);
      emitUntil(at);
    } else {
      // "before"/"after": the chord sits over white space between two syllables,
      // near the one it belongs to. `textEnd` is where the previous syllable's ink ends.
      // The gap opens before any opening punctuation of the word ("(thanks").
      let ins = at;
      // Opening punctuation goes with its word, unless it was already drawn.
      while (ins > charIdx && isOpening(text[ins - 1])) ins--;
      emitUntil(ins);
      let spaces = 0;
      while (ins - spaces > 0 && /\s/.test(text[ins - spaces - 1]!)) spaces++;
      const textEnd = lyricX - (measure(ins - spaces, ins) ?? 0);
      const hasPrev = ins - spaces > 0;
      if (place === "before") {
        x = Math.max(lyricX - S.timingNear - w, hasPrev ? textEnd + S.timingFar : left, minX, timeX);
        openGap(x + w + S.timingNear - lyricX, ins, textEnd);
      } else {
        x = Math.max(hasPrev ? textEnd + S.timingNear : left, minX, timeX);
        if (at < text.length) openGap(x + w + S.timingFar - lyricX, ins, textEnd);
      }
    }
    chords.push({ x, runs });
    chordEnd = x + w;
    lastAt = at;
    if (t !== undefined) placedAt(t, x + point);
  }
  for (const m of marks) placeMark(m);
  enter();
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

export interface FitOptions {
  left?: number;
  right?: number;
  meter?: Meter;
  /** Language of the lyrics, for sung syllables. */
  language?: string;
  /** Time axis under a notation snippet; such lines are not flexed or wrapped. */
  axis?: (t: number) => number;
}

/**
 * Lays out a line to fit the content width, in the owner's order (2026-11-09):
 * 1. full rhythm spacing; 2. less rhythm spacing (down to text-only);
 * 3. horizontal compression down to Arial Narrow width (82%); 4. wrapping
 * onto more rows at bar lines, with the bars spread evenly over the rows
 * (an odd extra bar goes to the earlier row) and one beat width for all rows
 * so their bars line up. Font sizes never shrink.
 */
export function fitLine(block: LineBlock, opts: FitOptions = {}): LaidLine[] {
  const left = opts.left ?? CHART.content.left;
  const right = opts.right ?? CHART.content.right;
  const timing = lineTiming(block, opts.meter);
  const lang = opts.language !== undefined ? { language: opts.language } : {};
  if (opts.axis) return [layoutLine(block, { left, right, axis: opts.axis, timing, ...lang })];

  const full = CHART.spacing.beatWidth;
  const one = (f: number) => [layoutLine(block, { left, right, beatWidth: full * f, timing, ...lang })];
  const f = bestFactor(one, right);
  if (f !== undefined) return one(f);
  const tight = one(0);
  if (tight[0]!.scaleX >= CHART.narrowScale) return tight;

  const n = timing.bars.length;
  if (n < 2) {
    tight[0]!.warnings.push("line is too long and has fewer than two bars, so it cannot wrap");
    return tight;
  }
  let fallback: LaidLine[] = tight;
  for (let k = 2; k <= n; k++) {
    const starts = evenBarStarts(n, k);
    if (starts.some((b) => !timing.bars[b]!.clean)) continue; // a row must start at a group's bar line
    const rows = splitLine(block, timing, starts);
    const layRows = (fr: number) => rows.map((r) => offsetChars(layoutLine(r.block, { left, right, meter: r.meter, beatWidth: full * fr, ...lang }), r.offset));
    const fr = bestFactor(layRows, right);
    if (fr !== undefined) return layRows(fr);
    const tightRows = layRows(0);
    fallback = tightRows;
    if (tightRows.every((r) => r.scaleX >= CHART.narrowScale)) return tightRows;
  }
  return fallback;
}

/** A wrapped row's lyric characters, counted from the start of the whole line. */
function offsetChars(laid: LaidLine, offset: number): LaidLine {
  if (offset) for (const p of laid.lyrics) if (p.chars) p.chars = [p.chars[0] + offset, p.chars[1] + offset];
  return laid;
}

/** Largest factor in [0, 1] at which every laid row fits within `right`, or undefined if even 0 doesn't. */
function bestFactor(lay: (f: number) => LaidLine[], right: number): number | undefined {
  const fits = (f: number) => lay(f).every((r) => r.end <= right + 1e-6);
  if (fits(1)) return 1;
  if (!fits(0)) return undefined;
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

/** First bar index of each of k rows over n bars; earlier rows take any extra bar (5 over 2 -> 3 + 2). */
export function evenBarStarts(n: number, k: number): number[] {
  const base = Math.floor(n / k), extra = n % k;
  const starts: number[] = [];
  let b = 0;
  for (let i = 0; i < k; i++) { starts.push(b); b += base + (i < extra ? 1 : 0); }
  return starts;
}

/**
 * Splits a line into rows starting at the given bars (row 0 also keeps any
 * pickup before the first bar). Lyric text splits at the character the bar's
 * group is pinned to, with a hyphen when that falls inside a word.
 */
export function splitLine(block: LineBlock, timing: LineTiming, barStarts: number[]): { block: LineBlock; meter: Meter; offset: number }[] {
  const text = block.lyrics.map((p) => ("text" in p ? p.text : "")).join("");
  const { anchors, bars } = timing;
  const firstAnchor = barStarts.map((b, i) => (i === 0 ? 0 : bars[b]!.anchor));
  const cut = barStarts.map((b, i) => {
    if (i === 0) return 0;
    let c = Math.min(anchors[bars[b]!.anchor]!.at, text.length);
    while (c < text.length && /\s/.test(text[c]!)) c++;
    return c;
  });
  const meterAt = (b: number): Meter => ({ top: bars[b]!.beats, bottom: timing.endMeter.bottom });

  return barStarts.map((b, i) => {
    const a = cut[i]!, z = i + 1 < cut.length ? cut[i + 1]! : Infinity;
    const isLast = i === barStarts.length - 1;
    const lyrics: LineBlock["lyrics"] = [];
    let idx = 0;
    for (const piece of block.lyrics) {
      if ("item" in piece) {
        if (idx >= a && (idx < z || isLast)) lyrics.push(piece);
        continue;
      }
      const s = Math.max(a, idx), e = Math.min(z, idx + piece.text.length);
      if (e > s) lyrics.push({ ...piece, text: piece.text.slice(s - idx, e - idx) });
      idx += piece.text.length;
    }
    // Hyphenate a word broken at the end of this row.
    if (!isLast && z < text.length && isLetter(text[z - 1]) && isLetter(text[z])) {
      const lastText = [...lyrics].reverse().find((p) => "text" in p) as { text: string; style?: LyricStyle } | undefined;
      lyrics.push(lastText?.style ? { text: "-", style: lastText.style } : { text: "-" });
    }
    const rowAnchors = anchors.slice(firstAnchor[i], i + 1 < firstAnchor.length ? firstAnchor[i + 1] : anchors.length)
      .map((an) => ({ ...an, at: Math.max(0, Math.min(an.at, text.length) - a) }));
    if (i === 0) rowAnchors.push(...block.above.filter((an) => an.alignRight));
    const row: LineBlock = { kind: "line", lyrics, above: rowAnchors };
    const barsBefore = b;
    const rhythm = (block.rhythm ?? [])
      .filter((m) => m.at >= a && m.at < z && (m.bar ?? 1) - barsBefore >= 1)
      .map((m) => ({ ...m, at: m.at - a, bar: (m.bar ?? 1) - barsBefore }));
    if (rhythm.length) row.rhythm = rhythm;
    if (i === 0 && block.lyricEntry !== undefined) row.lyricEntry = block.lyricEntry;
    return { block: row, meter: meterAt(b), offset: a };
  });
}
