import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groupRuns } from "../src/chart/items.js";
import { renderChart } from "../src/chart/render.js";
import { CHART } from "../src/chart/tokens.js";
import type { Chart, NotationBlock } from "../src/model/chart.js";
import { notationAxis, renderNotation } from "../src/notation/render.js";
import { textWidth } from "../src/text/metrics.js";
import { notationFrom } from "../scripts/lib/output.js";

// Made-up riff (test/fixtures/notation/riff.musicxml): two 4/4 bars, 14 notes.
const XML = new Uint8Array(readFileSync("test/fixtures/notation/riff.musicxml"));
const W = CHART.content.right - CHART.content.left;
const L = CHART.content.left;

describe("renderNotation (alphaTab)", () => {
  const tab = renderNotation(XML, { staves: "tab", width: W });
  const std = renderNotation(XML, { staves: "standard", width: W });
  const both = renderNotation(XML, { staves: "both", width: W });

  it("fills the content width in one row", () => {
    expect(tab.bars).toHaveLength(2);
    expect(tab.bars[1]!.x1).toBeCloseTo(W, 0);
    expect(tab.bars[0]!.x1).toBeCloseTo(tab.bars[1]!.x0, 6);
  });

  it("draws every music symbol as an outline (no font needed)", () => {
    for (const r of [tab, std, both]) {
      expect(r.svg).not.toMatch(/class="at"/);
      expect(r.svg).toMatch(/<path d="M/);
      expect(r.warnings).toEqual([]);
    }
    expect(tab.svg).not.toMatch(/rendered by alphaTab/);
  });

  it("shows tab, standard, or both", () => {
    expect(tab.svg).toMatch(/>3<\/text>/); // fret numbers
    expect(std.svg).not.toMatch(/>3<\/text>/);
    expect(both.height).toBeGreaterThan(tab.height + 20);
    expect(both.height).toBeGreaterThan(std.height + 20);
  });

  it("reports every beat with its bar, time and x, left to right", () => {
    expect(tab.beats).toHaveLength(14);
    expect(tab.beats.slice(0, 3).map((b) => [b.bar, b.t])).toEqual([[0, 0], [0, 0.5], [0, 1]]);
    for (let i = 1; i < tab.beats.length; i++) expect(tab.beats[i]!.x).toBeGreaterThan(tab.beats[i - 1]!.x);
    expect(tab.bars.map((b) => b.beats)).toEqual([4, 4]);
  });

  it("shows only the requested bars", () => {
    const one = renderNotation(XML, { staves: "tab", width: W, bars: [2, 2] });
    expect(one.bars).toHaveLength(1);
    expect(one.beats).toHaveLength(6);
    expect(() => renderNotation(XML, { staves: "tab", width: W, bars: [2, 5] })).toThrow(/outside/);
  });

  it("maps time to x through the beats (interpolating between them)", () => {
    const axis = notationAxis(tab);
    expect(axis(0)).toBeCloseTo(tab.beats[0]!.x, 6);
    expect(axis(0.25)).toBeCloseTo((tab.beats[0]!.x + tab.beats[1]!.x) / 2, 6);
    expect(axis(4)).toBeCloseTo(tab.beats.find((b) => b.bar === 1 && b.t === 0)!.x, 6);
    expect(axis(8)).toBeCloseTo(tab.bars[1]!.x1, 6);
  });
});

describe("notation blocks in a chart", () => {
  const block = (extra: Partial<NotationBlock> = {}): NotationBlock => ({ kind: "notation", src: "riff.musicxml", staves: "tab", ...extra });
  const chartOf = (blocks: Chart["sections"][number]["blocks"]): Chart => ({ meta: { title: "T", artist: "A", key: "E" }, sections: [{ type: "intro", label: "Intro", blocks }] });
  const draw = notationFrom("test/fixtures/notation");
  const r = renderNotation(XML, { staves: "tab", width: W });
  const axis = notationAxis(r);
  const textX = (svg: string, text: string) => Number(new RegExp(`<text x="([\\d.]+)"[^>]*>${text}</text>`).exec(svg)?.[1]);

  it("puts each chord name's beat point on its beat", () => {
    const g = { t: "chord" as const, chord: { root: "A" } };
    const svg = renderChart(chartOf([block({ above: [{ bar: 2, beat: "3", items: [g] }] })]), { notation: draw }).pages[0]!;
    const beatX = L + axis(4 + 2);
    expect(textX(svg, "A") + groupRuns([g]).beatPoint!).toBeCloseTo(beatX, 1);
  });

  it("spaces the lyric line under it on the notation's beats", () => {
    const svg = renderChart(chartOf([
      block(),
      { kind: "line", lyrics: [{ text: "hello there" }], above: [], rhythm: [{ at: 6, beat: "2&", bar: 1 }] },
    ]), { notation: draw }).pages[0]!;
    const mid = textX(svg, "there") + textWidth("there", CHART.lyric.size) / 2;
    expect(mid).toBeCloseTo(L + axis(1.5), 1);
  });

  it("shows the fallback image, or a placeholder, when the notation can't be drawn", () => {
    const noDraw = renderChart(chartOf([block({ fallback: { src: "old.png", width: 400, height: 50 } })]));
    expect(noDraw.pages[0]).toMatch(/<image href="old.png"/);
    expect(noDraw.warnings.join()).toMatch(/fallback image/);
    const missing = renderChart(chartOf([block({ src: "missing.musicxml" })]), { notation: draw });
    expect(missing.pages[0]).toMatch(/stroke-dasharray/);
    expect(missing.warnings.join()).toMatch(/could not be drawn/);
  });

  it("leaves charts without notation unchanged", () => {
    const demo: Chart = JSON.parse(readFileSync("test/fixtures/charts/demo.json", "utf8"));
    expect(renderChart(demo, { notation: draw }).pages).toEqual(renderChart(demo).pages);
  });
});
