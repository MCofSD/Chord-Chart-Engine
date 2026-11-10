import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Chart, LineBlock } from "../src/model/chart.js";
import { canonicalChart, parseChartText, writeChartText } from "../src/text-format/index.js";
import { stableJson } from "../src/text-format/canonical.js";
import { parseGroup } from "../src/text-format/tokens.js";
import { renderChart } from "../src/chart/render.js";
import { renderCover } from "../src/cover/render.js";
import { notationFrom } from "../scripts/lib/output.js";

const HEAD = "Title: Test\nKey: G\n";
const parse = (body: string) => parseChartText(HEAD + body);
const firstLine = (body: string) => parse(body).chart.sections[0]!.blocks[0] as LineBlock;

describe("chord-line groups", () => {
  it("reads chords with accidentals, qualities, bass and beat tags", () => {
    expect(parseGroup("|Bbm7/C[2&]")).toEqual({
      items: [{ t: "bar" }, { t: "chord", chord: { root: "B", accidental: "b", quality: "m7", bass: "C" }, beats: "2&" }],
      rootOffset: 1,
    });
    expect(parseGroup("G7(b9)/F")).toMatchObject({ items: [{ t: "chord", chord: { root: "G", quality: "7(b9)", bass: "F" } }] });
    expect(parseGroup("E(m)5")).toMatchObject({ items: [{ chord: { root: "E", quality: "(m)5" } }] });
    expect(parseGroup("F_b5")).toMatchObject({ items: [{ chord: { root: "F", quality: "b5" } }] });
    expect(parseGroup("F♯m")).toMatchObject({ items: [{ chord: { root: "F", accidental: "#", quality: "m" } }] });
    expect(parseGroup("*(Fm7)")).toMatchObject({ items: [{ t: "chord", noBass: true, paren: true }], rootOffset: 2 });
  });

  it("reads Legend marks", () => {
    expect(parseGroup("(+Drm)[4]")).toEqual({ items: [{ t: "instrument", op: "add", text: "Drm", beats: "4" }] });
    expect(parseGroup("(⊗last two bars)")).toEqual({ items: [{ t: "instrument", op: "except", text: "last two bars" }] });
    expect(parseGroup("[4]//|(NC)")).toEqual({ items: [{ t: "stop", kind: "abrupt", beats: "4", beatsFirst: true }, { t: "bar" }, { t: "direction", text: "NC" }] });
    expect(parseGroup("!![3]")).toEqual({ items: [{ t: "stop", kind: "hold", beats: "3" }] });
    expect(parseGroup("@2'")).toEqual({ items: [{ t: "ref", n: 2, riff: 2 }] });
    expect(parseGroup("3/4|-")).toEqual({ items: [{ t: "meter", top: 3, bottom: 4 }, { t: "bar" }, { t: "same" }] });
    expect(parseGroup("{2.Vamp}")).toEqual({ items: [{ t: "endingOpen", n: "2" }, { t: "direction", text: "Vamp" }, { t: "endingClose" }] });
    expect(parseGroup("(2x)")).toEqual({ items: [{ t: "times", text: "2x" }] });
    expect(parseGroup("(Use chords for Verse)")).toEqual({ items: [{ t: "text", text: "Use chords for Verse" }] });
    expect(parseGroup("/E[2]")).toEqual({ items: [{ t: "bass", bass: "E", beats: "2" }] });
    expect(parseGroup("<A[4]")).toMatchObject({ place: "before" });
    expect(parseGroup(">>(simile)")).toMatchObject({ alignRight: true });
  });

  it("rejects words that only start like chords", () => {
    expect(parseGroup("Gtr")).toHaveProperty("error");
    expect(parseGroup("Am7x")).toHaveProperty("error");
  });
});

describe("lines", () => {
  it("pins each chord's root letter to the lyric character under it", () => {
    const b = firstLine("# Verse\n|G     C\n Hello there friend\n");
    expect(b.lyrics).toEqual([{ text: "Hello there friend" }]);
    expect(b.above.map((a) => a.at)).toEqual([0, 6]);
  });

  it("treats extra spaces and ~ as padding that belongs to the next character", () => {
    const b = firstLine("# Verse\nG       Am     C\nHello     the~~re\n");
    expect(b.lyrics).toEqual([{ text: "Hello there" }]);
    expect(b.above.map((a) => a.at)).toEqual([0, 6, 9]);
  });

  it("puts chords past the lyric in order after it, and chord-only lines too", () => {
    const b = firstLine("# Verse\n|G   |D   |Em\n One\n");
    expect(b.above.map((a) => a.at)).toEqual([0, 3, 4]);
    const c = firstLine("# Verse\n|G   |D\n\n");
    expect(c.lyrics).toEqual([]);
    expect(c.above.map((a) => a.at)).toEqual([0, 1]);
  });

  it("reads styles, inline marks, the lyric entry and rhythm marks", () => {
    const b = firstLine("# Verse\n|G\n@2 Oh _la la_ ^(aside)^ {2.go} {(2x)}\n   1& 2  2:3\n");
    expect(b.lyricEntry).toBe("2");
    expect(b.lyrics).toEqual([
      { text: "Oh " }, { text: "la la", style: "backup" }, { text: " " }, { text: "(aside)", style: "aside" }, { text: " " },
      { item: { t: "endingOpen", n: "2" } }, { text: "go" }, { item: { t: "endingClose" } }, { text: " " }, { item: { t: "times", text: "2x" } },
    ]);
    expect(b.rhythm).toEqual([{ at: 0, beat: "1&" }, { at: 3, beat: "2" }, { at: 5, beat: "3", bar: 2 }]);
  });

  it("keeps lyric lines that start with a chord-like word as lyrics", () => {
    const b = firstLine("# Verse\nAm I wrong to say so\n");
    expect(b.above).toEqual([]);
    expect(b.lyrics).toEqual([{ text: "Am I wrong to say so" }]);
    expect(firstLine("# Verse\n. A\n").lyrics).toEqual([{ text: "A" }]);
  });

  it("reports what it can't read, with the line number", () => {
    const { problems } = parse("# Verse\n|G   |Cxyz\nLa la la la\n");
    expect(problems).toEqual([{ line: 4, message: expect.stringContaining("Cxyz") }]);
  });
});

describe("chart structure", () => {
  it("reads the header, sections, types and Repeat lines", () => {
    const { chart, problems } = parseChartText(
      "Title: Made Up\nArtist: Nobody\nYear: 2020\nKey: Eb\nBPM: 90\nMeter: 6/8\n\n# 1st Ver\nG\nLa la\n\n# Hook =chorus\nC\nOh\n\nRepeat {Hook} and {1st Verse|1st Ver}\n",
    );
    expect(problems).toEqual([]);
    expect(chart.meta).toEqual({ title: "Made Up", artist: "Nobody", year: 2020, key: "Eb", bpm: 90, meter: { top: 6, bottom: 8 } });
    expect(chart.sections.map((s) => [s.type, s.label])).toEqual([["verse", "1st Ver"], ["chorus", "Hook"], ["other", ""]]);
    expect(chart.sections[2]!.blocks[0]).toEqual({
      kind: "note",
      pieces: [{ text: "Repeat " }, { section: "chorus", text: "Hook" }, { text: " and " }, { section: "verse", label: "1st Ver", text: "1st Verse" }],
    });
  });
});

/** Text -> chart -> text -> chart gives the same chart (canonical form). */
function roundTrips(chart: Chart): string {
  const text = writeChartText(chart);
  const back = parseChartText(text);
  expect(back.problems).toEqual([]);
  expect(stableJson(canonicalChart(back.chart))).toBe(stableJson(canonicalChart(chart)));
  return text;
}

describe("round trip", () => {
  for (const f of ["demo.json", "notation-demo.json"]) {
    it(`writes and reads back ${f} without loss`, () => {
      const chart = JSON.parse(readFileSync(join("test/fixtures/charts", f), "utf8")) as Chart;
      const text = roundTrips(chart);
      // Only blocks the syntax doesn't cover yet (snippets, notation) fall back to JSON.
      for (const m of text.matchAll(/^```json\n(.*)\n```$/gm)) expect(JSON.parse(m[1]!).kind ?? "cover").toMatch(/snippet|notation|cover/);
    });
  }

  it("keeps an unnamed section whose first note is written as JSON", () => {
    // As the importer makes for "Repeat ... (⊕last two bars)" (an odd piece the note syntax can't express).
    const line: LineBlock = { kind: "line", lyrics: [{ text: "la la" }], above: [{ at: 0, items: [{ t: "chord", chord: { root: "G" } }] }] };
    roundTrips({
      meta: { title: "T", artist: "A", key: "G" },
      sections: [
        { type: "chorus", label: "Chorus", blocks: [line] },
        { type: "other", label: "", blocks: [{ kind: "note", pieces: [{ text: "Repeat " }, { section: "chorus", text: "Chorus" }, { text: "( " }, { section: "other", text: "⊕" }, { text: "last bar) " }] }] },
        { type: "ending", label: "End", blocks: [line] },
      ],
    });
  });

  it("renders the parsed demo exactly like the JSON", () => {
    const chart = JSON.parse(readFileSync("test/fixtures/charts/demo.json", "utf8")) as Chart;
    const back = parseChartText(writeChartText(chart)).chart;
    expect(renderChart(back).pages).toEqual(renderChart(chart).pages);
  });

});

/**
 * Real charts: JSON -> editor text -> JSON, as when a PDF import is opened
 * and saved in the editor. Local only (copyrighted lyrics, gitignored), so
 * each test is skipped when its file is missing.
 */
describe("round trip of local charts (import -> editor -> JSON)", () => {
  const dir = "local/imports";
  const imports = existsSync(dir) ? readdirSync(dir).map((d) => join(dir, d, `${d}.json`)).filter(existsSync) : [];
  const files = [...imports, "local/since-u-been-gone/since-u-been-gone.json"].filter(existsSync);
  it.skipIf(files.length > 0)("skipped: no local charts on this machine", () => {});

  for (const file of files) {
    it(`keeps ${file} unchanged`, () => {
      const chart = JSON.parse(readFileSync(file, "utf8")) as Chart;
      const text = roundTrips(chart);
      const back = parseChartText(text).chart;
      // Writing the parsed chart again gives the same text.
      expect(writeChartText(back)).toBe(text);
      // Chart and cover pages are identical, notation images included.
      const draw = notationFrom(dirname(file));
      expect(renderChart(back, { notation: draw }).pages).toEqual(renderChart(chart, { notation: draw }).pages);
      expect(renderCover(back).pages).toEqual(renderCover(chart).pages);
    });
  }
});
