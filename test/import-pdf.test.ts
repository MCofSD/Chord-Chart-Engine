import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseChordRow } from "../src/importers/pdf-chart/chordline.js";
import type { Glyph } from "../src/importers/pdf-chart/extract.js";
import { importChartPdf, placementOf } from "../src/importers/pdf-chart/index.js";
import { parseLyricRow } from "../src/importers/pdf-chart/lyricline.js";
import { beatTag } from "../src/importers/pdf-chart/style.js";
import type { Chart, ChordLineItem } from "../src/model/chart.js";
import { RULES, sectionTypeOf } from "../src/rules/index.js";

// Synthetic glyph rows (made-up text; no copyrighted lyrics).
const BASE = 100;
const C = RULES.legend.colors;
const GRAY = RULES.import.lyricColors[0]!;
type Opts = Partial<Pick<Glyph, "size" | "color" | "bold" | "italic" | "font">> & { raise?: number; w?: number };
/** Lays out text left to right from x, one glyph per character (spaces become gaps). */
function run(text: string, x: number, o: Opts = {}): Glyph[] {
  const size = o.size ?? 16, w = o.w ?? size * 0.55;
  const out: Glyph[] = [];
  for (const ch of text) {
    if (ch !== " ") out.push({ ch, x0: x, x1: x + w, y: BASE - (o.raise ?? 0), size, font: o.font ?? "ArialMT", bold: o.bold ?? false, italic: o.italic ?? false, color: o.color ?? C.black, page: 0 });
    x += ch === " " ? size * 0.3 : w;
  }
  return out;
}
const sup = (text: string, x: number, color: string = C.black) => run(text, x, { size: 10.6, raise: 5.5, color, w: 6 });
const parse = (gs: Glyph[]) => {
  const flags: string[] = [];
  return { groups: parseChordRow(gs, BASE, 16, 604.8, (m) => flags.push(m)), flags };
};
const items = (gs: Glyph[]) => parse(gs).groups.map((g) => g.items);

describe("chord row", () => {
  it("reads a bar, root, raised quality and a red beat tag", () => {
    const gs = [...run("|G", 50), ...sup("m7", 68), ...sup("[", 80), ...sup("2&", 86, C.beatRed), ...sup("]", 98)];
    expect(items(gs)).toEqual([[{ t: "bar" }, { t: "chord", chord: { root: "G", quality: "m7" }, beats: "2&" }]]);
  });

  it("reads a smaller baseline flat after the root, and a slash bass with a sharp", () => {
    const gs = [...run("B", 50), ...run("b", 59, { size: 12 }), ...run("/F", 68, { size: 14 }), ...run("#", 84, { size: 11 })];
    expect(items(gs)).toEqual([[{ t: "chord", chord: { root: "B", accidental: "b", bass: "F#" } }]]);
  });

  it("reads red and green stops, with beats after or before them", () => {
    const red = [...run("//", 50, { color: C.red, bold: true, w: 5 }), ...sup("[3]", 61)];
    expect(items(red)).toEqual([[{ t: "stop", kind: "abrupt", beats: "3" }]]);
    const green = [...sup("[4]", 50), ...run("//", 69, { color: C.green, bold: true, w: 5 })];
    expect(items(green)).toEqual([[{ t: "stop", kind: "hold", beats: "4", beatsFirst: true }]]);
  });

  it("reads parenthesized instrument marks and directions from the rules' vocabulary", () => {
    for (const inst of RULES.symbols.instruments) {
      const gs = [...run("(", 50, { size: 12 }), ...run("+", 56, { size: 12, bold: true, color: C.red }), ...run(inst, 63, { size: 12, color: C.red }), ...run(")", 63 + inst.length * 6.6, { size: 12 })];
      expect(items(gs)).toEqual([[{ t: "instrument", op: "add", text: inst }]]);
    }
    const sim = [...run("(", 50, { size: 12 }), ...run("simile", 56, { size: 12, italic: true, color: C.red }), ...run(")", 96, { size: 12 })];
    expect(items(sim)).toEqual([[{ t: "direction", text: "simile" }]]);
  });

  it("splits several instruments in one mark", () => {
    const gs = [...run("(", 50, { size: 12 }), ...run("+", 56, { size: 12, bold: true, color: C.red }), ...run("Bss/Drm", 63, { size: 12, color: C.red }), ...run(")", 110, { size: 12 })];
    expect(items(gs)).toEqual([[{ t: "instrument", op: "add", text: "Bss" }, { t: "instrument", op: "add", text: "Drm" }]]);
  });

  it("reads circled-plus marks (images turned into glyphs) as 'only'", () => {
    const gs = [...run("(", 50, { size: 12 }), ...run("⊕", 56, { size: 12, color: C.red }), ...run("Gtr", 64, { size: 12, color: C.red }), ...run(")", 84, { size: 12 })];
    expect(items(gs)).toEqual([[{ t: "instrument", op: "only", text: "Gtr" }]]);
  });

  it("reads Wingdings riff numbers, light blue as the second riff", () => {
    const ref = String.fromCodePoint(RULES.import.wingdingsRefStart + 1);
    const gs = [...run("|G", 50), ...run(ref, 70, { size: 14, font: "Wingdings-Regular", color: RULES.render.riffColors[1]! })];
    expect(items(gs)).toEqual([[{ t: "bar" }, { t: "chord", chord: { root: "G" } }, { t: "ref", n: 2, riff: 2 }]]);
  });

  it("starts groups at bars and chords; keeps marks next to a chord in its group", () => {
    const gs = [
      ...run("| -", 50), ...run("C", 150),
      ...run("|A", 250), ...sup("(m)5", 270), ...run("{", 296), ...run("1.", 305, { size: 9, bold: true, color: C.red, w: 4 }),
      ...run("//", 313, { color: C.green, bold: true, w: 5 }), ...run("}", 323),
    ];
    const g = items(gs);
    expect(g.length).toBe(3);
    expect(g[2]!.map((i) => i.t)).toEqual(["bar", "chord", "endingOpen", "stop", "endingClose"]);
  });

  it("reads a bass change with no chord, with its beat tag", () => {
    const gs = [...run("|C", 50), ...run("/E", 150, { size: 14 }), ...sup("[", 168), ...sup("4&", 174, C.beatRed), ...sup("]", 186)];
    expect(items(gs)).toEqual([[{ t: "bar" }, { t: "chord", chord: { root: "C" } }], [{ t: "bass", bass: "E", beats: "4&" }]]);
  });

  it("attaches a beat tag to an instrument mark", () => {
    const gs = [...run("(", 50, { size: 12 }), ...run("+", 56, { size: 12, bold: true, color: C.red }), ...run("Drm", 63, { size: 12, color: C.red }), ...run(")", 83, { size: 12 }), ...sup("[", 90), ...sup("4", 96, C.beatRed), ...sup("]", 102)];
    expect(items(gs)).toEqual([[{ t: "instrument", op: "add", text: "Drm", beats: "4" }]]);
  });

  it("keeps an unknown parenthesized instruction as free text, symbols included", () => {
    const gs = [...run("(", 50, { size: 12 }), ...run("then Chorus", 56, { size: 12, color: C.red }), ...run("⊗", 130, { size: 12, color: C.red }), ...run("last two bars", 137, { size: 12, color: C.red }), ...run(")", 230, { size: 12 })];
    const { groups, flags } = parse(gs);
    expect(groups.map((g) => g.items)).toEqual([[{ t: "text", text: "then Chorus ⊗last two bars" }]]);
    expect(flags[0]).toMatch(/free-text/);
  });

  it("flags what it cannot read instead of guessing", () => {
    const { flags } = parse([...run("|G", 50), ...run("@", 80, { color: "#123456" })]);
    expect(flags[0]).toMatch(/unrecognized "@"/);
  });

  it("puts the beat point at the chord's weighted middle (rules weights)", () => {
    const { groups } = parse([...run("C", 50, { w: 11.6 }), ...run("#", 61.6, { w: 8.9 })]);
    expect(groups[0]!.point).toBeCloseTo((55.8 + 66.05) / 2, 6); // between C and #
  });
});

describe("lyric row", () => {
  it("joins a hand-spaced syllable hyphen and keeps the split as a syllable boundary", () => {
    const gs = [...run("walk", 50, { color: GRAY }), ...run("-", 90, { color: GRAY }), ...run("ing", 104, { color: GRAY })];
    const lyr = parseLyricRow(gs, 16, () => {});
    expect(lyr.text).toBe("walking");
    expect(lyr.syllables.map((s) => lyr.text.slice(s.start, s.end))).toEqual(["walk", "ing"]);
  });

  it("takes plain parentheses around a red count into the mark", () => {
    const gs = [...run("gone", 50, { color: GRAY }), ...run("(", 90, { size: 12 }), ...run("2x", 94, { size: 12, color: C.red, w: 6 }), ...run(")", 106, { size: 12 })];
    const lyr = parseLyricRow(gs, 16, () => {});
    expect(lyr.lyrics).toEqual([{ text: "gone " }, { item: { t: "times", text: "2x" } }]);
  });

  it("keeps italics as backup vocals, small text as asides, and inline endings", () => {
    const gs = [
      ...run("oh", 50, { color: GRAY, italic: true }),
      ...run("{", 75), ...run("2.", 84, { size: 9, bold: true, color: C.red, w: 4 }),
      ...run("la", 92.5, { color: GRAY }), ...run("}", 110.1), // no gap after "2." or before "}"
      ...run("(yeah)", 125, { color: GRAY, italic: true, size: 12 }),
    ];
    const lyr = parseLyricRow(gs, 16, () => {});
    expect(lyr.lyrics).toEqual([
      { text: "oh ", style: "backup" },
      { item: { t: "endingOpen", n: "2" } },
      { text: "la" },
      { item: { t: "endingClose" } },
      { text: " (yeah)", style: "aside" },
    ]);
  });
});

describe("rules", () => {
  it("maps section labels through rules.sections", () => {
    expect(["Intro", "1st Ver", "Ref 1", "Chorus", "End Cho", "Bridge", "Break 2", "Post-Chorus"].map(sectionTypeOf))
      .toEqual(["intro", "verse", "refrain", "chorus", "chorus", "bridge", "break", "other"]);
  });

  it("writes beat tags on 16ths only", () => {
    expect([0, 0.5, 1, 1.25, 2.75].map(beatTag)).toEqual(["1", "1&", "2", "2e", "3a"]);
    expect(beatTag(1.1)).toBeNull();
  });
});

// The real chart is copyrighted and local-only (gitignored); this runs only where it exists.
const PDF = "samples/Since U Been Gone - Kelly Clarkson (2004).pdf";
const FIXTURE = "test/fixtures/charts/subg-chorus.json";
describe.skipIf(!existsSync(PDF) || !existsSync(FIXTURE))("import of a real chart (local only)", () => {
  const { chart, review } = existsSync(PDF) ? importChartPdf(readFileSync(PDF), { fileName: "Since U Been Gone - Kelly Clarkson (2004).pdf" }) : { chart: undefined as unknown as Chart, review: [] };
  const flat = (its: ChordLineItem[]) => its.map((i) => (i.t === "chord" ? `${i.chord.root}${i.chord.accidental ?? ""}${i.chord.quality ?? ""}${i.chord.bass ? "/" + i.chord.bass : ""}${i.beats ? `[${i.beats}]` : ""}` : i.t)).join(" ");

  it("reads the header and every section label", () => {
    expect(chart.meta).toMatchObject({ title: "Since U Been Gone", artist: "Kelly Clarkson", year: 2004, key: "G", bpm: 131, date: "2026-10-24" });
    expect(chart.sections.map((s) => s.label)).toEqual(["Intro", "1st Ver", "Ref 1", "Chorus", "Break", "2nd Ver", "Ref 2", "", "Bridge", "Break 2", "End Cho"]);
  });

  it("reads the chorus like the hand-made fixture: same chords, marks and lyrics", () => {
    const fixture: Chart = JSON.parse(readFileSync(FIXTURE, "utf8"));
    const want = fixture.sections[0]!.blocks.filter((b) => b.kind === "line");
    const got = chart.sections.find((s) => s.label === "Chorus")!.blocks.filter((b) => b.kind === "line");
    expect(got.length).toBe(want.length);
    got.forEach((g, i) => {
      const w = want[i]!;
      if (g.kind !== "line" || w.kind !== "line") throw new Error("not a line");
      expect(flat(g.above.flatMap((a) => a.items))).toBe(flat(w.above.flatMap((a) => a.items)));
      const text = (l: typeof g) => l.lyrics.map((p) => ("text" in p ? p.text : "·")).join("").replace(/\s+/g, " ").trim();
      expect(text(g)).toBe(text(w));
    });
  });

  it("leaves nothing unrecognized", () => {
    expect(review.filter((r) => /unrecognized/.test(r.message))).toEqual([]);
  });
});

describe("reading before / on / after (owner, 2026-11-10)", () => {
  // Chord core letters and syllables measured in the original PDFs (pt).
  const syl = (x0: number, x1: number) => ({ x0, x1 });
  it("reads the examples from the originals", () => {
    expect(placementOf([47.4, 59.8], 53.6, syl(54.8, 83.2))).toBe("before"); // SUBG |G before "You"
    expect(placementOf([558.9, 569.6], 571.2, syl(563.6, 595.7))).toBe("before"); // So Easy Adim7 before "gree"
    expect(placementOf([404.7, 422.1], 418.0, syl(366.8, 420.1))).toBe("after"); // So Easy EbMaj7 after "dreams"
    expect(placementOf([324.1, 334.7], 333.3, syl(331.3, 366.8))).toBe("before"); // SUBG E(m)5 before "gone"
  });
  it("reads a chord inside a syllable, lined up with its first letter, or covering a short one, as on", () => {
    expect(placementOf([60, 70], 65, syl(54.8, 83.2))).toBe("on");
    expect(placementOf([54.3, 65], 59.6, syl(54.8, 83.2))).toBe("on"); // letter lined up with the word's start
    expect(placementOf([70, 90], 80, syl(83, 87))).toBe("on"); // B♭ over "I"
  });
});

describe("reading before / after needs the chord's middle near the edge too", () => {
  it("keeps a chord centered on a short word as on, even if its core reaches past the end", () => {
    // |Fm over "It's": F and the raised m reach past the end of "It's", but the chord is centered on it.
    expect(placementOf([66, 88], 76, { x0: 65, x1: 87 })).toBe("on");
  });
});
