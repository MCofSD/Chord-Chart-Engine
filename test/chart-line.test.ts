import { describe, expect, it } from "vitest";
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

describe("layoutLine", () => {
  it("places a chord's root over its anchored character", () => {
    const at = LYRIC.indexOf("river");
    const laid = layoutLine(line([{ at, items: [chord("G")] }]));
    expect(laid.chords[0]!.x).toBeCloseTo(charX(at), 6);
  });

  it("hangs a leading bar line to the left so the chord stays over the syllable", () => {
    const at = LYRIC.indexOf("river");
    const laid = layoutLine(line([{ at, items: [{ t: "bar" }, chord("G")] }]));
    const bar = textWidth("|", CHART.marks.size);
    expect(laid.chords[0]!.x).toBeCloseTo(charX(at) - bar, 6);
  });

  it("does not hang a group without a chord (e.g. '| -')", () => {
    const at = LYRIC.indexOf("road");
    const laid = layoutLine(line([{ at, items: [{ t: "bar" }, { t: "same" }] }]));
    expect(laid.chords[0]!.x).toBeCloseTo(charX(at), 6);
  });

  it("pushes a colliding chord right and opens the lyric at the word start, keeping alignment", () => {
    const a = LYRIC.indexOf("down");
    const c = LYRIC.indexOf("the");
    const wide = chord("C", { beats: "1&,2,3,4" });
    const laid = layoutLine(line([{ at: a, items: [wide] }, { at: c, items: [chord("D")] }]));
    const first = laid.chords[0]!, second = laid.chords[1]!;
    expect(second.x).toBeCloseTo(first.x + runsWidth(first.runs) + CHART.spacing.groupGap, 6);
    // "the" moved as a word: the chord is still exactly over its "t".
    expect(drawnCharX(laid, c)).toBeCloseTo(second.x, 6);
    expect(laid.lyrics.some((p) => p.runs[0]!.kind === "text" && p.runs[0]!.text === "-")).toBe(false);
  });

  it("keeps a chord over a mid-word character by moving the whole word", () => {
    const word = LYRIC.indexOf("river");
    const at = word + 2; // "v"
    const laid = layoutLine(line([{ at: word - 1, items: [chord("A", { beats: "1&,2,3,4" })] }, { at, items: [chord("E")] }]));
    expect(drawnCharX(laid, at)).toBeCloseTo(laid.chords[1]!.x, 6);
  });

  it("hyphenates when two chords inside one word force a split", () => {
    const word = LYRIC.indexOf("Walking");
    const laid = layoutLine(line([{ at: word, items: [chord("F", { beats: "1&,2,3,4" })] }, { at: word + 2, items: [chord("G")] }]));
    expect(laid.lyrics.some((p) => p.runs[0]!.kind === "text" && p.runs[0]!.text === "-")).toBe(true);
    expect(drawnCharX(laid, word + 2)).toBeCloseTo(laid.chords[1]!.x, 6);
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

  it("lays out chord-only lines on the tab grid", () => {
    const laid = layoutLine({ kind: "line", lyrics: [], above: [{ at: 0, items: [{ t: "bar" }, { t: "same" }] }, { at: 0, items: [{ t: "bar" }, { t: "same" }] }] });
    expect(laid.chords.map((p) => p.x)).toEqual([CHART.content.left, CHART.content.left + CHART.spacing.tabStop]);
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
      // after: well left of the syllable; before: just left of it; on: right over it.
      expect(xs[0]!).toBeLessThan(xs[2]!);
      expect(xs[2]!).toBeLessThan(xs[1]!);
      expect(xs[1]!).toBeCloseTo(0, 6);
    });

    it("'before' a syllable inside a word splits the word with a hyphen", () => {
      const word = LYRIC.indexOf("Walking");
      const laid = layoutLine(line([{ at: word + 4, place: "before", items: [chord("D")] }])); // "Walk|ing"
      expect(laid.lyrics.some((p) => p.runs[0]!.kind === "text" && p.runs[0]!.text === "-")).toBe(true);
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
    // The chord sits over "h", after the "{2." mark, not over the brace.
    const brace = laid.lyrics.find((p) => p.runs.some((r) => r.kind === "text" && r.text === "{"))!;
    expect(laid.chords[0]!.x).toBeCloseTo(brace.x + runsWidth(brace.runs), 6);
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
