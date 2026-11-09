import { describe, expect, it } from "vitest";
import { groupRuns } from "../src/chart/items.js";
import { evenBarStarts, fitLine, layoutLine } from "../src/chart/line.js";
import { lineTiming } from "../src/chart/timing.js";
import { renderChart } from "../src/chart/render.js";
import { CHART } from "../src/chart/tokens.js";
import type { Anchor, Chart, ChordLineItem, LineBlock } from "../src/model/chart.js";
import { textWidth } from "../src/text/metrics.js";

// Made-up lyrics only (no copyrighted text).
const bar: ChordLineItem = { t: "bar" };
const same: ChordLineItem = { t: "same" };
const ch = (root: string, beats?: string): ChordLineItem => ({ t: "chord", chord: { root }, ...(beats ? { beats } : {}) });
const line = (above: Anchor[], text = "", extra: Partial<LineBlock> = {}): LineBlock => ({ kind: "line", lyrics: text ? [{ text }] : [], above, ...extra });
/** A chord-only line: each group anchored past the (empty) lyric. */
const groups = (...gs: ChordLineItem[][]): LineBlock => line(gs.map((items) => ({ at: 0, items })));
const times = (b: LineBlock, meter?: { top: number; bottom: number }) => lineTiming(b, meter).times;
const L = CHART.content.left;
const BW = CHART.spacing.beatWidth;
/** Beat 1 of the first bar: just right of a bar line at the content edge. */
const B1 = L + textWidth("|", CHART.marks.size);

describe("lineTiming: Legend defaults (owner, 2026-11-09)", () => {
  it("puts the second chord of a bar on the middle beat", () => {
    expect(times(groups([bar, ch("G")], [ch("C")]))).toEqual([0, 2]);
  });

  it("lets a beat tag move the second chord", () => {
    expect(times(groups([bar, ch("G")], [ch("C", "2")]))).toEqual([0, 1]);
  });

  it("times three chords when only the beat-1 and middle chords are untagged", () => {
    expect(times(groups([bar, ch("G")], [ch("C", "2&")], [ch("D")]))).toEqual([0, 1.5, 2]);
    expect(times(groups([bar, ch("G")], [ch("C")], [ch("D", "4")]))).toEqual([0, 2, 3]);
  });

  it("warns and leaves a third untagged chord untimed", () => {
    const t = lineTiming(groups([bar, ch("G")], [ch("C")], [ch("D")]));
    expect(t.times).toEqual([0, 2, undefined]);
    expect(t.warnings[0]).toMatch(/bar 1: chord D needs a beat tag/);
  });

  it("warns when tags go backwards", () => {
    const t = lineTiming(groups([bar, ch("G")], [ch("C", "4")], [ch("D", "2")]));
    expect(t.times).toEqual([0, 3, undefined]);
    expect(t.warnings[0]).toMatch(/not later/);
  });

  it('counts "-" as beat 1 and starts each bar after the last', () => {
    // |G | - Am E(m)5[4&] | - | - F[2&] E[4&]
    const t = lineTiming(groups([bar, ch("G")], [bar, same], [ch("A")], [ch("E", "4&")], [bar, same], [bar, same], [ch("F", "2&")], [ch("E", "4&")]));
    expect(t.times).toEqual([0, 4, 6, 7.5, 8, 12, 13.5, 15.5]);
    expect(t.bars.map((b) => b.start)).toEqual([0, 4, 8, 12]);
  });

  it("follows inline meter changes; 6/8 has a middle beat (4), 3/4 has none", () => {
    expect(times(groups([bar, { t: "meter", top: 6, bottom: 8 }, ch("G")], [ch("C")], [bar, same]))).toEqual([0, 3, 6]);
    const t = lineTiming(groups([bar, ch("G")], [ch("C")]), { top: 3, bottom: 4 });
    expect(t.times).toEqual([0, undefined]);
    expect(t.warnings[0]).toMatch(/needs a beat tag/);
  });

  it("leaves a pickup before the first bar untimed", () => {
    expect(times(line([{ at: 0, items: [ch("D")] }, { at: 4, items: [bar, ch("G")] }], "come on home"))).toEqual([undefined, 0]);
  });

  it("turns lyricEntry and rhythm marks into times", () => {
    const t = lineTiming(line([{ at: 0, items: [bar, ch("G")] }, { at: 5, items: [bar, same] }], "la la la", { lyricEntry: "2", rhythm: [{ at: 6, beat: "3", bar: 2 }] }));
    expect(t.marks).toEqual([{ at: 0, t: 1 }, { at: 6, t: 6 }]);
  });
});

describe("rhythm spacing", () => {
  it("spaces chords on beats 1 and 3 two beat widths apart over a short lyric", () => {
    const above = [{ at: 0, items: [bar, ch("G")] }, { at: 3, items: [ch("C")] }];
    const laid = layoutLine(line(above, "oh my"));
    const beat = (i: number) => laid.chords[i]!.x + groupRuns(above[i]!.items).beatPoint!;
    expect(beat(1) - beat(0)).toBeCloseTo(2 * BW, 6); // beat 1 to beat 3, chord middle to chord middle
  });

  it("pushes crowded chords right, and keeps later intervals proportional", () => {
    const long = "everybody wants to rule the world tonight";
    const laid = layoutLine(line([{ at: 0, items: [bar, ch("G")] }, { at: 1, items: [ch("C", "1&")] }, { at: 30, items: [bar, ch("D")] }], long));
    const [g, c, d] = laid.chords;
    expect(c!.x).toBeGreaterThan(L + 0.5 * BW); // pushed past its ideal by G's width
    expect(c!.x).toBeGreaterThan(g!.x);
    // D sits over its syllable, which is past its time position.
    expect(d!.x + textWidth("|", CHART.marks.size)).toBeGreaterThanOrEqual(L + 4 * BW - 1e-6);
  });

  it("after a push, the next bar still gets its full proportional width", () => {
    // C (beat 3) is pushed late by the long first word; the next bar line must
    // still sit two beats after C, not crammed against it.
    const lyric = "supercalifragilistic is long";
    const laid = layoutLine(line([{ at: 0, items: [bar, ch("G")] }, { at: 22, items: [ch("C")] }, { at: 99, items: [bar, same] }], lyric));
    const [, c, next] = laid.chords;
    expect(c!.x).toBeGreaterThan(B1 + 2 * BW + 1); // pushed late
    const dash = next!.x + textWidth("|", CHART.marks.size) + CHART.spacing.itemGap;
    expect(dash - c!.x).toBeGreaterThanOrEqual(2 * BW - 1e-6);
  });

  it("moves a marked syllable to its beat and hyphenates a split word", () => {
    const laid = layoutLine(line([], "started out", { rhythm: [{ at: 5, beat: "3" }] }));
    const ed = laid.lyrics.find((p) => p.runs[0]!.kind === "text" && (p.runs[0] as { text: string }).text.startsWith("ed"));
    // The beat sits in the middle of the syllable "ed".
    expect(ed!.x + textWidth("ed", CHART.lyric.size) / 2).toBeCloseTo(B1 + 2 * BW, 6);
    expect(laid.lyrics.some((p) => (p.runs[0] as { text?: string }).text === "-")).toBe(true);
  });
});

describe("fitLine: fit order and even wrapping (owner, 2026-11-09)", () => {
  const bars = (n: number, perBar: ChordLineItem[][] = [[bar, ch("G")]]) => {
    const gs: ChordLineItem[][] = [];
    for (let i = 0; i < n; i++) gs.push(...perBar.map((g, j) => (j === 0 ? g : g)));
    return groups(...gs);
  };

  it("keeps full rhythm spacing when the line fits", () => {
    const rows = fitLine(bars(4));
    expect(rows).toHaveLength(1);
    // The chord root sits on the beat; the bar line hangs just left of it.
    expect(rows[0]!.chords[1]!.x + textWidth("|", CHART.marks.size)).toBeCloseTo(B1 + 4 * BW, 6);
  });

  it("shrinks rhythm spacing before compressing", () => {
    const rows = fitLine(bars(7)); // 28 beats x 25.2 = 706 pt: too wide at full spacing
    expect(rows).toHaveLength(1);
    expect(rows[0]!.scaleX).toBe(1);
    expect(rows[0]!.chords[1]!.x + textWidth("|", CHART.marks.size) - B1).toBeLessThan(4 * BW);
    expect(rows[0]!.end).toBeLessThanOrEqual(CHART.content.right + 1e-6);
  });

  it("wraps into rows with equal bars and one shared beat width", () => {
    const busy: ChordLineItem[][] = [[bar, ch("G", "1")], [ch("C", "2")], [ch("D", "3")], [ch("E", "4")], [ch("F", "4&")]];
    const gs = [...busy, ...busy, ...busy, ...busy].map((g) => [...g].map((i) => (i.t === "chord" ? { ...i, chord: { root: i.chord.root, quality: "m7" } } : i)));
    const rows = fitLine(groups(...gs));
    expect(rows.length).toBe(2);
    const barsPerRow = rows.map((r) => r.chords.filter((p) => p.runs.some((run) => run.kind === "text" && run.text === "|")).length);
    expect(barsPerRow).toEqual([2, 2]);
    // Both rows start a bar at the left edge and line up: same x for the second bar.
    const secondBar = (r: (typeof rows)[number]) => r.chords.filter((p) => p.runs.some((run) => run.kind === "text" && run.text === "|"))[1]!.x;
    expect(secondBar(rows[0]!)).toBeCloseTo(secondBar(rows[1]!), 6);
  });

  it("gives an odd extra bar to the earlier row", () => {
    expect(evenBarStarts(4, 2)).toEqual([0, 2]);
    expect(evenBarStarts(5, 2)).toEqual([0, 3]);
    expect(evenBarStarts(7, 3)).toEqual([0, 3, 5]);
  });

  it("warns when a long line without bars can't wrap", () => {
    const rows = fitLine(line([], "la ".repeat(80)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.warnings.join()).toMatch(/cannot wrap/);
  });
});

describe("snippet time axis", () => {
  it("places marked syllables of the line under a snippet on the snippet's bars", () => {
    const chart: Chart = {
      meta: { title: "Test", artist: "Nobody", key: "C" },
      sections: [{
        type: "verse", label: "Verse",
        blocks: [
          { kind: "snippet", src: "x.png", width: 400, height: 50, timeline: { bars: [{ x: 20, width: 180 }, { x: 210, width: 180 }] } },
          line([], "hello there friend", { rhythm: [{ at: 6, beat: "1", bar: 2 }] }),
        ],
      }],
    };
    const svg = renderChart(chart).pages[0]!;
    const x = Number(/<text x="([\d.]+)"[^>]*>there/.exec(svg)?.[1]);
    // "there" is centered on bar 2's beat 1.
    expect(x + textWidth("there", CHART.lyric.size) / 2).toBeCloseTo(L + 210, 1);
  });
});
