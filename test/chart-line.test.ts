import { describe, expect, it } from "vitest";
import { groupRuns } from "../src/chart/items.js";
import { layoutLine, type LaidLine } from "../src/chart/line.js";
import { runsWidth } from "../src/chart/runs.js";
import { CHART } from "../src/chart/tokens.js";
import type { Anchor, ChordLineItem, LineBlock } from "../src/model/chart.js";
import { textWidth } from "../src/text/metrics.js";

// Made-up lyric (no copyrighted text).
const LYRIC = "Walking down the river road tonight";
const L = CHART.content.left;
const chord = (root: string, extra: Partial<Extract<ChordLineItem, { t: "chord" }>> = {}): ChordLineItem => ({ t: "chord", chord: { root }, ...extra });
const line = (above: Anchor[], lyric = LYRIC): LineBlock => ({ kind: "line", lyrics: [{ text: lyric }], above });
/** x at which lyric character `i` starts, for a laid line with no gaps inserted. */
const charX = (i: number, lyric = LYRIC) => L + textWidth(lyric.slice(0, i), CHART.lyric.size);
/** x at which character `i` was actually drawn in a laid line. */
function drawnCharX(laid: LaidLine, i: number): number {
  let idx = 0;
  for (const p of laid.lyrics) {
    const r = p.runs[0]!;
    if (r.kind !== "text" || r.text === "-") continue;
    if (i < idx + r.text.length) return p.x + textWidth(r.text.slice(0, i - idx), r.size, r.face);
    idx += r.text.length;
  }
  throw new Error("index past end");
}
/** Middle of lyric text [from, to) as drawn (owner, 2026-11-09: beats align with syllable middles). */
const midOf = (laid: LaidLine, from: number, to: number, lyric = LYRIC) => drawnCharX(laid, from) + textWidth(lyric.slice(from, to), CHART.lyric.size) / 2;
/** Where group `i`'s beat sits (a chord's weighted middle, or the "-"). */
const beatX = (laid: LaidLine, anchors: Anchor[], i: number) => laid.chords[i]!.x + groupRuns(anchors[i]!.items).beatPoint!;

describe("layoutLine", () => {
  it("centers a chord's weighted middle over its syllable's middle", () => {
    const at = LYRIC.indexOf("river");
    const above = [{ at, items: [chord("G")] }];
    const laid = layoutLine(line(above));
    expect(beatX(laid, above, 0)).toBeCloseTo(midOf(laid, at, at + 3), 6); // sung syllable "riv" of riv|er
  });

  it("hangs a leading bar line to the left so the chord stays centered over the syllable", () => {
    const at = LYRIC.indexOf("river");
    const above: Anchor[] = [{ at, items: [{ t: "bar" }, chord("G")] }];
    const laid = layoutLine(line(above));
    expect(beatX(laid, above, 0)).toBeCloseTo(midOf(laid, at, at + 3), 6);
    expect(laid.chords[0]!.x).toBeLessThan(beatX(laid, above, 0) - textWidth("G", CHART.chord.rootSize) / 2);
  });

  it("centers the '-' of '| -' over its syllable", () => {
    const at = LYRIC.indexOf("road");
    const above: Anchor[] = [{ at, items: [{ t: "bar" }, { t: "same" }] }];
    const laid = layoutLine(line(above));
    expect(beatX(laid, above, 0)).toBeCloseTo(midOf(laid, at, at + 4), 6);
  });

  it("weighs root, flat/sharp and minor m as the core; extensions count for less", () => {
    const point = (quality?: string, accidental?: "#") =>
      groupRuns([{ t: "chord", chord: { root: "C", ...(accidental ? { accidental } : {}), ...(quality ? { quality } : {}) } }]).beatPoint!;
    const cW = textWidth("C", CHART.chord.rootSize);
    const full = runsWidth(groupRuns([{ t: "chord", chord: { root: "C", accidental: "#", quality: "m7(#11)" } }]).runs);
    expect(point(undefined, "#")).toBeGreaterThan(cW / 2); // between C and #, not on C
    expect(point("m", "#")).toBeGreaterThan(point(undefined, "#"));
    expect(point("m7(#11)", "#")).toBeGreaterThan(point("m", "#")); // a little right of C#m...
    expect(point("m7(#11)", "#")).toBeLessThan(full / 2); // ...but well left of the whole name's middle
    expect(point("maj7")).toBeLessThan(cW); // "maj" is not minor: only C is core
  });

  it("gives a slash bass a little weight: less than an extension, more than none", () => {
    const point = (chord: { root: string; quality?: string; bass?: string }) => groupRuns([{ t: "chord", chord }]).beatPoint!;
    const d = point({ root: "D" });
    const slash = point({ root: "D", bass: "F#" });
    expect(slash).toBeGreaterThan(d);
    // Weighted mean of D (1) and the bass unit (bassWeight): closer to D than an extension-weighted unit would pull it.
    const runs = groupRuns([{ t: "chord", chord: { root: "D", bass: "F#" } }]).runs;
    const bassMid = (textWidth("D", CHART.chord.rootSize) + runsWidth(runs)) / 2;
    const atWeight = (w: number) => (d + w * bassMid) / (1 + w);
    expect(slash).toBeLessThan(atWeight(CHART.chord.extensionWeight));
    expect(CHART.chord.bassWeight).toBeGreaterThan(0);
  });

  it("pushes a colliding chord right and opens the lyric at the word start, keeping alignment", () => {
    const a = LYRIC.indexOf("down");
    const c = LYRIC.indexOf("the");
    const wide = chord("C", { beats: "1&,2,3,4" });
    const above = [{ at: a, items: [wide] }, { at: c, items: [chord("D")] }];
    const laid = layoutLine(line(above));
    const first = laid.chords[0]!, second = laid.chords[1]!;
    expect(second.x).toBeCloseTo(first.x + runsWidth(first.runs) + CHART.spacing.groupGap, 6);
    // "the" moved as a word: the chord is still centered over it.
    expect(beatX(laid, above, 1)).toBeCloseTo(midOf(laid, c, c + 3), 6);
    expect(laid.lyrics.some((p) => p.runs[0]!.kind === "text" && p.runs[0]!.text === "-")).toBe(false);
  });

  it("keeps a chord over a mid-word character by moving the whole word", () => {
    const word = LYRIC.indexOf("river");
    const at = word + 2; // "v"
    const above = [{ at: word - 1, items: [chord("A", { beats: "1&,2,3,4" })] }, { at, items: [chord("E")] }];
    const laid = layoutLine(line(above));
    expect(beatX(laid, above, 1)).toBeCloseTo(midOf(laid, at, word + 3), 6); // from "v" to the sung split before "er"
  });

  it("hyphenates when two chords inside one word force a split", () => {
    const word = LYRIC.indexOf("Walking");
    const above = [{ at: word, items: [chord("F", { beats: "1&,2,3,4" })] }, { at: word + 2, items: [chord("G")] }];
    const laid = layoutLine(line(above));
    expect(laid.lyrics.some((p) => p.runs[0]!.kind === "text" && p.runs[0]!.text === "-")).toBe(true);
    expect(beatX(laid, above, 1)).toBeCloseTo(midOf(laid, word + 2, word + 4), 6); // "lk", up to the sung split before "ing"
  });

  it("moves opening punctuation with its word when a gap opens before it", () => {
    const lyric = 'oh "hello there"';
    const at = lyric.indexOf("hello");
    const laid = layoutLine(line([{ at: 0, items: [chord("F", { beats: "1&,2,3,4" })] }, { at, items: [chord("G")] }], lyric));
    const quote = drawnCharX(laid, at - 1);
    expect(drawnCharX(laid, at) - quote).toBeCloseTo(textWidth('"', CHART.lyric.size), 6); // no gap between " and hello
  });

  it("moves opening punctuation with its word for 'before'/'after' chords too", () => {
    const lyric = "yeah (thanks to you)";
    const at = lyric.indexOf("thanks");
    const laid = layoutLine(line([{ at, place: "after", items: [chord("A", { beats: "1&,2,3,4" })] }], lyric));
    expect(drawnCharX(laid, at) - drawnCharX(laid, at - 1)).toBeCloseTo(textWidth("(", CHART.lyric.size), 6);
  });

  it("puts chords past the end of the lyric on the 0.5-inch tab grid, in order", () => {
    const laid = layoutLine(line([{ at: 999, items: [chord("C")] }, { at: 999, items: [chord("D")] }]));
    const stop = (x: number) => ((x - CHART.spacing.tabOrigin) / CHART.spacing.tabStop);
    const [c, d] = laid.chords;
    expect(Number.isInteger(Math.round(stop(c!.x) * 1e6) / 1e6)).toBe(true);
    expect(c!.x).toBeGreaterThanOrEqual(charX(LYRIC.length));
    expect(c!.x - charX(LYRIC.length)).toBeLessThan(CHART.spacing.tabStop);
    expect(d!.x).toBeCloseTo(c!.x + CHART.spacing.tabStop, 6); // next stop: C is narrower than 0.5"
  });

  it("spaces chord-only bars by time (one 4/4 bar = 4 beat widths)", () => {
    const laid = layoutLine({ kind: "line", lyrics: [], above: [{ at: 0, items: [{ t: "bar" }, { t: "same" }] }, { at: 0, items: [{ t: "bar" }, { t: "same" }] }] });
    // "| -": the "-" marks the beat, so each bar line sits just left of its beat.
    const bar = textWidth("|", CHART.marks.size);
    expect(laid.chords.map((p) => p.x)).toEqual([CHART.content.left, CHART.content.left + 4 * CHART.spacing.beatWidth]);
    expect(bar).toBeGreaterThan(0);
  });

  it("keeps untimed chords past the lyric on the tab grid", () => {
    const laid = layoutLine({ kind: "line", lyrics: [], above: [{ at: 0, items: [chord("G")] }, { at: 0, items: [chord("C")] }] });
    expect(laid.chords[1]!.x).toBeCloseTo(CHART.content.left + CHART.spacing.tabStop, 6);
  });

  describe("timing: before / after a syllable", () => {
    const S = CHART.spacing;
    const at = LYRIC.indexOf("river");
    const prevEnd = charX(at - 1); // end of "the" (before the space)
    const widthOf = (laid: LaidLine, i: number) => runsWidth(laid.chords[i]!.runs);

    it("'before' sits over white space, close to the next syllable", () => {
      const laid = layoutLine(line([{ at, place: "before", items: [chord("G")] }]));
      const x = laid.chords[0]!.x, w = widthOf(laid, 0);
      expect(drawnCharX(laid, at) - (x + w)).toBeCloseTo(S.timingNear, 6);
      expect(x - prevEnd).toBeGreaterThanOrEqual(S.timingFar - 1e-6);
    });

    it("'after' sits over white space, close to the previous syllable", () => {
      const laid = layoutLine(line([{ at, place: "after", items: [chord("G")] }]));
      const x = laid.chords[0]!.x, w = widthOf(laid, 0);
      expect(x - prevEnd).toBeCloseTo(S.timingNear, 6);
      expect(drawnCharX(laid, at) - (x + w)).toBeGreaterThanOrEqual(S.timingFar - 1e-6);
    });

    it("the three placements of the same chord are visibly different", () => {
      const xs = (["after", "on", "before"] as const).map((place) => {
        const laid = layoutLine(line([{ at, place, items: [chord("G")] }]));
        return laid.chords[0]!.x - drawnCharX(laid, at);
      });
      // after: well left of the syllable; before: just left of it; on: centered over it.
      expect(xs[0]!).toBeLessThan(xs[2]!);
      expect(xs[2]!).toBeLessThan(xs[1]!);
      const g = groupRuns([chord("G")]).beatPoint!;
      expect(xs[1]!).toBeCloseTo(textWidth("riv", CHART.lyric.size) / 2 - g, 6);
    });

    it("'before' a syllable inside a word splits the word with a hyphen", () => {
      const word = LYRIC.indexOf("Walking");
      const laid = layoutLine(line([{ at: word + 4, place: "before", items: [chord("D")] }])); // "Walk|ing"
      expect(laid.lyrics.some((p) => p.runs[0]!.kind === "text" && p.runs[0]!.text === "-")).toBe(true);
    });

    it("before / on / after work on a syllable inside a word too", () => {
      const ing = LYRIC.indexOf("Walking") + 4; // "Walk|ing"
      const xs = (["after", "on", "before"] as const).map((place) => {
        const laid = layoutLine(line([{ at: ing, place, items: [chord("D")] }]));
        return laid.chords[0]!.x - drawnCharX(laid, ing);
      });
      expect(xs[0]!).toBeLessThan(xs[2]!);
      expect(xs[2]!).toBeLessThan(xs[1]!);
      const g = groupRuns([chord("D")]).beatPoint!;
      expect(xs[1]!).toBeCloseTo(textWidth("ing", CHART.lyric.size) / 2 - g, 6);
    });
  });

  it("puts right-aligned groups flush with the right margin", () => {
    const laid = layoutLine(line([{ at: 0, alignRight: true, items: [{ t: "direction", text: "simile" }] }]));
    const p = laid.chords[0]!;
    expect(p.x + runsWidth(p.runs)).toBeCloseTo(CHART.content.right, 6);
  });

  it("lays inline lyric items (repeat endings) into the lyric flow without counting them as characters", () => {
    const block: LineBlock = {
      kind: "line",
      lyrics: [{ text: "go " }, { item: { t: "endingOpen", n: "2" } }, { text: "home" }, { item: { t: "endingClose" } }],
      above: [{ at: 3, items: [chord("G")] }],
    };
    const laid = layoutLine(block);
    // The chord centers over "home", after the "{2." mark, not over the brace.
    const brace = laid.lyrics.find((p) => p.runs.some((r) => r.kind === "text" && r.text === "{"))!;
    const homeMid = brace.x + runsWidth(brace.runs) + textWidth("home", CHART.lyric.size) / 2;
    expect(beatX(laid, block.above, 0)).toBeCloseTo(homeMid, 6);
  });

  it("compresses a line that is too wide, and warns below Arial Narrow width", () => {
    const long = "la ".repeat(60).trim();
    const laid = layoutLine(line([], long));
    expect(laid.scaleX).toBeLessThan(1);
    expect(laid.end - L).toBeGreaterThan(CHART.content.right - L);
    expect(laid.warnings.length).toBe(laid.scaleX < CHART.narrowScale ? 1 : 0);
    const fits = layoutLine(line([{ at: 0, items: [chord("G")] }]));
    expect(fits.scaleX).toBe(1);
  });

  it("uses the backup-vocal italic and aside sizes", () => {
    const laid = layoutLine({ kind: "line", lyrics: [{ text: "ooh", style: "backup" }, { text: " (yeah)", style: "aside" }], above: [] });
    const [a, b] = laid.lyrics.map((p) => p.runs[0]!);
    expect(a).toMatchObject({ face: "arialItalic", size: 16 });
    expect(b).toMatchObject({ face: "arialItalic", size: 12 });
  });
});

describe("lyricEntry (lyric comes in after the downbeat)", () => {
  const per = CHART.spacing.beatWidth;
  const LA = "la la la";
  const downbeat: Anchor = { at: 0, items: [{ t: "bar" }, chord("G")] };
  const laLine = (extra: Partial<LineBlock>): LineBlock => ({ ...line([downbeat], LA), ...extra });
  const laMid = (laid: LaidLine) => midOf(laid, 0, 2, LA);

  it("keeps the downbeat chord at the left edge and centers the first syllable one beat after it", () => {
    const laid = layoutLine(laLine({ lyricEntry: "2" }));
    expect(laid.chords[0]!.x).toBeCloseTo(L, 6);
    expect(laMid(laid)).toBeCloseTo(beatX(laid, [downbeat], 0) + per, 6);
  });

  it("scales the gap with the beat, including subdivisions", () => {
    for (const [tag, beats] of [["1&", 0.5], ["2", 1], ["2a", 1.75], ["3", 2], ["4", 3]] as const) {
      const laid = layoutLine(laLine({ lyricEntry: tag }));
      expect(laMid(laid)).toBeCloseTo(beatX(laid, [downbeat], 0) + beats * per, 6);
    }
  });

  it("moves later chords with the lyric so they stay centered over their syllables", () => {
    const at = LYRIC.indexOf("river");
    const above = [downbeat, { at, items: [chord("C")] }];
    const laid = layoutLine({ ...line(above), lyricEntry: "2" });
    expect(beatX(laid, above, 1)).toBeCloseTo(midOf(laid, at, at + 3), 6);
    // "Walk" (of Walk|ing) is centered one beat after G, or later if it can't fit, never earlier.
    expect(midOf(laid, 0, 4)).toBeGreaterThanOrEqual(beatX(laid, above, 0) + per - 1e-6);
  });

  it("without lyricEntry, the downbeat chord centers over the first syllable", () => {
    const laid = layoutLine(line([downbeat]));
    expect(beatX(laid, [downbeat], 0)).toBeCloseTo(midOf(laid, 0, 4), 6); // "Walk"
  });

  it("warns and ignores a tag that is not a single beat", () => {
    const laid = layoutLine({ ...line([downbeat]), lyricEntry: "1&,2" });
    expect(laid.warnings[0]).toMatch(/lyricEntry/);
    expect(drawnCharX(laid, 0)).toBeCloseTo(drawnCharX(layoutLine(line([downbeat])), 0), 6);
  });
});
