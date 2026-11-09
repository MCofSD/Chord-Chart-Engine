/**
 * Line timing: when each chord group and lyric mark happens, in beats from
 * the line's first bar line. The layout spaces timed points in proportion to
 * time so the reader sees the rhythm (owner, 2026-11-09).
 *
 * Rules (Legend footnote *, refined by the owner 2026-11-09):
 * - Every bar item starts a new bar; its length is the meter's top number.
 *   An inline meter item changes it from that bar on.
 * - A chord with a beat tag is at its first beat. Untagged, the bar's first
 *   chord (or "-") is on beat 1 and one other untagged chord is on the middle
 *   beat (beat 3 in 4/4). Any other chord in the bar must show its beat.
 * - Content before the first bar line (a pickup) is untimed.
 */
import { beatOffset, type Anchor, type ChordLineItem, type LineBlock, type Meter } from "../model/chart.js";
import { RULES } from "../rules/index.js";

export const DEFAULT_METER: Meter = RULES.timing.defaultMeter;

export interface BarInfo {
  /** Index (in `anchors`) of the group holding this bar's bar line. */
  anchor: number;
  /** True when the bar line starts its group (after any meter marks), so a row can start here. */
  clean: boolean;
  /** Start time in beats from the line's first bar line. */
  start: number;
  /** Length in beats. */
  beats: number;
}

export interface LineTiming {
  /** Chord-line groups in layout order (by character, stable), excluding right-aligned ones. */
  anchors: Anchor[];
  /** Time of each group in `anchors` (its first timed item), or undefined. */
  times: (number | undefined)[];
  /** Lyric marks (rhythm marks plus lyricEntry) with their times, by character. */
  marks: { at: number; t: number }[];
  bars: BarInfo[];
  /** Meter in force at the end of the line (inline meter changes carry to the next line). */
  endMeter: Meter;
  warnings: string[];
}

/** First beat of a tag or a list ("1&,2,3" -> 1&). */
const firstBeat = (tag: string) => beatOffset(tag.split(",")[0]!);

/** Middle beat of a bar, if it has one (4 -> beat 3, 6 -> beat 4; odd meters have none). */
const middleBeat = (beats: number) => (beats % 2 === 0 ? beats / 2 : undefined);

export function lineTiming(block: LineBlock, meter: Meter = DEFAULT_METER): LineTiming {
  const anchors = block.above.filter((a) => !a.alignRight).sort((a, b) => a.at - b.at);
  const warnings: string[] = [];
  const times: (number | undefined)[] = anchors.map(() => undefined);
  const bars: BarInfo[] = [];

  let beatsPerBar = meter.top;
  let bar: BarInfo | undefined;
  // Per-bar state for the Legend defaults.
  let usedFirst = false, usedMiddle = false, lastT = -Infinity;

  const startBar = (anchor: number, clean: boolean) => {
    const start = bar ? bar.start + bar.beats : 0;
    bar = { anchor, clean, start, beats: beatsPerBar };
    bars.push(bar);
    usedFirst = false; usedMiddle = false; lastT = -Infinity;
  };

  /** Time of one item inside the current bar, or undefined. */
  const itemTime = (item: ChordLineItem, describe: string): number | undefined => {
    if (!bar) return undefined;
    let beat: number | undefined;
    // A bass change ("/E") is timed like a chord change.
    if ((item.t === "chord" || item.t === "bass") && item.beats !== undefined) {
      beat = firstBeat(item.beats);
      if (beat === undefined) warnings.push(`bar ${bars.length}: beat tag "${item.beats}" on ${describe} not understood`);
      usedFirst = true; // a tagged chord still counts as the bar's first chord
    } else if ((item.t === "stop" || item.t === "instrument") && item.beats !== undefined) {
      beat = firstBeat(item.beats);
    } else if (item.t === "chord" || item.t === "same" || item.t === "bass") {
      if (!usedFirst) { beat = 0; usedFirst = true; }
      else {
        const mid = middleBeat(bar.beats);
        if (mid !== undefined && !usedMiddle && mid > lastT - bar.start) { beat = mid; usedMiddle = true; }
        else warnings.push(`bar ${bars.length}: ${describe} needs a beat tag (only beat 1 and the middle beat may go untagged)`);
      }
    } else return undefined;
    if (beat === undefined) return undefined;
    const t = bar.start + beat;
    if (t <= lastT) {
      warnings.push(`bar ${bars.length}: ${describe} is not later than the chord before it`);
      return undefined;
    }
    lastT = t;
    return t;
  };

  anchors.forEach((anchor, ai) => {
    anchor.items.forEach((item, ii) => {
      if (item.t === "bar") { startBar(ai, anchor.items.slice(0, ii).every((i) => i.t === "meter")); return; }
      if (item.t === "meter") {
        beatsPerBar = item.top;
        if (bar) bar.beats = item.top;
        return;
      }
      const describe = item.t === "chord" ? `chord ${item.chord.root}${item.chord.accidental ?? ""}${item.chord.quality ?? ""}` : item.t === "bass" ? `bass change /${item.bass}` : `"${item.t}"`;
      const t = itemTime(item, describe);
      if (t !== undefined && times[ai] === undefined) times[ai] = t;
    });
    // A group that is only a bar line is at the bar's start.
    if (times[ai] === undefined && bar && bar.anchor === ai && anchor.items.every((i) => i.t === "bar" || i.t === "meter")) times[ai] = bar.start;
  });

  /** Start of bar n (1-based); bars past the last drawn one continue in the current meter. */
  const barStart = (n: number) => {
    if (n <= bars.length) return bars[n - 1]!.start;
    const last = bars[bars.length - 1];
    const end = last ? last.start + last.beats : 0;
    return end + (n - bars.length - 1) * beatsPerBar;
  };

  const marks: { at: number; t: number }[] = [];
  const addMark = (at: number, beat: string, barNo: number, what: string) => {
    const b = beatOffset(beat);
    if (b === undefined) { warnings.push(`${what} "${beat}" is not a single beat (e.g. "2", "1&"); ignored`); return; }
    marks.push({ at, t: barStart(barNo) + b });
  };
  if (block.lyricEntry !== undefined) addMark(0, block.lyricEntry, 1, "lyricEntry");
  for (const m of block.rhythm ?? []) addMark(m.at, m.beat, m.bar ?? 1, "rhythm mark");
  marks.sort((a, b) => a.at - b.at);

  return { anchors, times, marks, bars, endMeter: { top: beatsPerBar, bottom: meter.bottom }, warnings };
}
