import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderChart } from "../src/chart/render.js";
import { CHART } from "../src/chart/tokens.js";
import type { Chart } from "../src/model/chart.js";
import { notationAxis, renderNotation } from "../src/notation/render.js";
import { textWidth } from "../src/text/metrics.js";
import { syllables } from "../src/text/syllables.js";
import { notationFrom } from "../scripts/lib/output.js";

const split = (words: string[], lang?: string) => words.map((w) => syllables(w, lang).join("|"));

describe("sung syllables (owner, 2026-11-09)", () => {
  it("splits English words, including short syllables at the edges", () => {
    expect(split(["Walking", "tonight", "away", "ever", "lanterns", "beautiful", "something"], "en"))
      .toEqual(["Walk|ing", "to|night", "a|way", "e|ver", "lan|terns", "beau|ti|ful", "some|thing"]);
  });

  it("keeps one-syllable words whole, silent e included", () => {
    expect(split(["breathe", "you've", "time", "the", "Yeah", "gone"], "en")).toEqual(["breathe", "you've", "time", "the", "Yeah", "gone"]);
  });

  it("keeps digraphs together the English way", () => {
    expect(split(["father", "singer", "picking", "beyond"], "en")).toEqual(["fa|ther", "sing|er", "pick|ing", "be|yond"]);
  });

  it("splits Spanish with its own patterns", () => {
    expect(split(["corazón", "despierten", "quiero", "calle"], "es")).toEqual(["co|ra|zón", "des|pier|ten", "quie|ro", "ca|lle"]);
  });

  it("splits Tagalog (no patterns) by the sung-syllable rule, with ng starting a syllable", () => {
    expect(split(["awitin", "isasayaw", "pangarap", "ngayon"], "tl")).toEqual(["a|wi|tin", "i|sa|sa|yaw", "pa|nga|rap", "nga|yon"]);
  });
});

describe("a beat lands on the middle of its own syllable", () => {
  it('puts "Walk" (not "Walking") on beat 1& under the notation demo', () => {
    const chart: Chart = JSON.parse(readFileSync("test/fixtures/charts/notation-demo.json", "utf8"));
    const svg = renderChart(chart, { notation: notationFrom("test/fixtures/charts") }).pages[0]!;
    const x = Number(/<text x="([\d.]+)"[^>]*>Walking <\/text>|<text x="([\d.]+)"[^>]*>Walking<\/text>/.exec(svg)?.slice(1).find(Boolean));
    const walkMid = x + textWidth("Walk", CHART.lyric.size) / 2;
    const r = renderNotation(new Uint8Array(readFileSync("test/fixtures/notation/riff.musicxml")), { staves: "both", width: CHART.content.right - CHART.content.left, bars: [1, 1] });
    expect(walkMid).toBeCloseTo(CHART.content.left + notationAxis(r)(0.5), 1); // the second note
  });
});
