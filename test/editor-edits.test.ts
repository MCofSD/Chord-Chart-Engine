import { describe, expect, it } from "vitest";
import { fitLine } from "../src/chart/line.js";
import { renderChart } from "../src/chart/render.js";
import type { LineBlock } from "../src/model/chart.js";
import { lyricText } from "../src/text-format/canonical.js";
import { chordAt, lineStartAt, setChordAt, setLineStart, setSyllables, splitOf, type ChordTarget } from "../src/text-format/edit.js";
import { parseChartText, writeChartText } from "../src/text-format/index.js";
import { relink } from "../src/text-format/link.js";
import { lineTiming } from "../src/chart/timing.js";
import { syllableAt } from "../src/text/syllables.js";

// Made-up lyrics only.
const HEAD = "Title: T\nKey: G\n\n# Verse\n";
const line = (src: string, block = 0) => parseChartText(src).chart.sections[0]!.blocks[block] as LineBlock;
/** "word@char" -> chord groups and where they sit, e.g. "|G@0 C@8>". */
const anchors = (b: LineBlock) => b.above.map((a) => `${a.items.map((i) => (i.t === "chord" ? i.chord.root + (i.chord.quality ?? "") : i.t === "bar" ? "|" : i.t)).join("")}@${a.at}${a.place ? ":" + a.place : ""}`);

describe("syllableAt", () => {
  const text = "Walking down, the river";
  it("finds the sung syllable under a character", () => {
    expect(syllableAt(text, 1)).toMatchObject({ start: 0, end: 4, next: 4 }); // Walk|ing
    expect(syllableAt(text, 5)).toMatchObject({ start: 4, end: 7, next: 8 }); // ing -> down
    expect(syllableAt(text, 19)).toMatchObject({ start: 18, end: 21, next: 21 }); // riv|er
    expect(syllableAt(text, 22)).toMatchObject({ start: 21, end: 23, next: 23 }); // last syllable: next = end of text
  });
  it("goes to the nearest word from a space or punctuation", () => {
    expect(syllableAt(text, 11)!.start).toBe(8); // "," after "down"
    expect(syllableAt(text, 7)!.start).toBe(4); // space after "Walking": the word before
  });
  it("uses the chart's language", () => {
    expect(syllableAt("corazón", 5, "es")).toMatchObject({ start: 4, end: 7 }); // co|ra|zón
    expect(syllableAt("pangarap", 3, "tl")).toMatchObject({ start: 2, end: 5 }); // pa|nga|rap
  });
  it("returns nothing for a line without words", () => {
    expect(syllableAt("  ", 0)).toBeUndefined();
  });
});

describe("setChordAt (click a syllable on the page)", () => {
  const src = HEAD + "|G          C\nWalking down the river\n";
  const text = "Walking down the river";
  const at = (i: number): ChordTarget => ({ section: 0, block: 0, syllable: syllableAt(text, i)! });
  const edit = (i: number, group: string | undefined, place: "on" | "before" | "after") => {
    const r = setChordAt(src, at(i), group === undefined ? { place } : { group, place });
    if ("error" in r) throw new Error(r.error);
    return r;
  };

  it("adds a chord on, before, or after the clicked syllable", () => {
    expect(anchors(line(edit(5, "Am7", "on").text))).toEqual(["|G@1", "Am7@4", "C@12"]);
    expect(anchors(line(edit(5, "Am7", "before").text))).toEqual(["|G@1", "Am7@4:before", "C@12"]);
    // After "ing" = pinned right after its letters (the space), ahead of anything else in that gap.
    expect(anchors(line(edit(5, "Am7", "after").text))).toEqual(["|G@1", "Am7@7:after", "C@12"]);
  });

  it("keeps an 'after' chord in the measure of its syllable when a bar line follows it", () => {
    // Like the end of SUBG's first verse: "|G" on the first "la", "|-" after "la,", then "D".
    const barSrc = HEAD + "|G    |-  D\nla la, la la\n"; // "|-" on the space after "la," (character 6)
    const text = "la la, la la";
    const second = syllableAt(text, 3)!;
    const before = line(barSrc);
    expect(before.above.map((a) => a.at)).toEqual([1, 6, 10]);
    for (const place of ["on", "before", "after"] as const) {
      const r = setChordAt(barSrc, { section: 0, block: 0, syllable: second }, { group: "C", place });
      if ("error" in r) throw new Error(r.error);
      const b = line(r.text);
      const k = b.above.findIndex((a) => a.items.some((i) => i.t === "chord" && i.chord.root === "C"));
      const bar = b.above.findIndex((a) => a.items[0]?.t === "bar" && a.items[1]?.t === "same");
      expect(k, place).toBeLessThan(bar); // C comes before the bar line: same measure as "la"
      expect(b.above[bar]!.at, place).toBe(6); // the bar line is kept where it was
      expect(lineTiming(b).times[k], place).toBeLessThan(4); // within bar 1
    }
  });

  it("leaves a bar-line-only group alone: it isn't the syllable's chord", () => {
    const barSrc = HEAD + "|G   >|-\nla la, la\n"; // "|-" just after the second "la"
    const text = "la la, la";
    const second = syllableAt(text, 3)!;
    expect(chordAt(barSrc, { section: 0, block: 0, syllable: second })).toBeUndefined();
    const r = setChordAt(barSrc, { section: 0, block: 0, syllable: second }, { group: "C", place: "after" });
    if ("error" in r) throw new Error(r.error);
    expect(line(r.text).above.some((a) => a.items[0]?.t === "bar" && a.items[1]?.t === "same")).toBe(true);
  });

  it("changes the chord or only its placement, keeping the rest of the group", () => {
    const g = at(1); // "Walk", which has |G
    expect(chordAt(src, g)).toEqual({ group: "|G", place: "on" });
    const changed = setChordAt(src, g, { group: "|Em7[2&]", place: "on" });
    expect("error" in changed ? changed.error : anchors(line(changed.text))).toEqual(["|Em7@0", "C@12"]);
    const moved = setChordAt(src, g, { group: "|G", place: "before" });
    expect("error" in moved ? moved.error : anchors(line(moved.text))).toEqual(["|G@0:before", "C@12"]);
  });

  it("finds a chord placed after a syllable when that syllable is clicked again", () => {
    const after = edit(5, "Am7", "after").text;
    expect(chordAt(after, at(5))).toEqual({ group: "Am7", place: "after" });
  });

  it("removes the syllable's chord", () => {
    expect(anchors(line(edit(1, undefined, "on").text))).toEqual(["C@12"]);
  });

  it("reports a chord it can't read, or a removal where there is no chord", () => {
    expect(setChordAt(src, at(5), { group: "Xyz", place: "on" })).toMatchObject({ error: expect.stringMatching(/not a chord/) });
    expect(setChordAt(src, at(5), { place: "on" })).toMatchObject({ error: expect.stringMatching(/no chord/) });
  });

  it("rewrites only that line and says which lines changed", () => {
    const two = HEAD + "G\nla la la\nC\nlo lo lo\n";
    const r = setChordAt(two, { section: 0, block: 1, syllable: syllableAt("lo lo lo", 3)! }, { group: "D", place: "on" });
    if ("error" in r) throw new Error(r.error);
    expect(r.text.split("\n").slice(4, 6)).toEqual(["G", "la la la"]);
    expect([r.from, r.to]).toEqual([7, 8]);
    expect(anchors(line(r.text, 1))).toEqual(["C@0", "D@3"]);
  });

  it("keeps a blank line when the last chord goes from a lyric under a chord-only line", () => {
    const src2 = HEAD + "|G |C\n\nG\nla la\n";
    const r = setChordAt(src2, { section: 0, block: 1, syllable: syllableAt("la la", 0)! }, { place: "on" });
    if ("error" in r) throw new Error(r.error);
    const blocks = parseChartText(r.text).chart.sections[0]!.blocks as LineBlock[];
    expect(blocks).toHaveLength(2);
    expect(lyricText(blocks[1]!.lyrics)).toBe("la la");
    expect(blocks[1]!.above).toEqual([]);
  });
});

describe("relink (chords follow their syllables)", () => {
  /** `after` may mark the caret with ‸ (where the typing happened); default: end of the edited text. */
  const go = (before: string, after: string) => {
    const at = after.indexOf("‸");
    const clean = after.replace("‸", "");
    return relink(HEAD + before, HEAD + clean, HEAD.length + (at >= 0 ? at : clean.length));
  };
  const applied = (before: string, after: string) => {
    const r = go(before, after);
    if (r.kind !== "applied") throw new Error(`expected applied, got ${r.kind}`);
    return r.text;
  };

  it("moves chords with their syllables when words are added before them", () => {
    const t = applied("G     C\nWalking down\n", "G     C\nWe are ‸Walking down\n");
    expect(anchors(line(t))).toEqual(["G@7", "C@13"]);
    expect(t.slice(HEAD.length).split("\n")[0]).toBe("       G     C");
  });

  it("moves chords left when words are deleted; a chord on a deleted word goes to the cut", () => {
    const t = applied("G  C    D\nla la la walk\n", "G  C    D\nla walk\n");
    expect(anchors(line(t))).toEqual(["G@0", "C@3", "D@3"]);
  });

  it("keeps the next chord on its syllable when a chord name gets longer (the lyric opens room)", () => {
    const t = applied("|G C\nla la\n", "|Gmaj7 C\nla la\n");
    expect(anchors(line(t))).toEqual(["|Gmaj7@1", "C@3"]);
    expect(t.slice(HEAD.length).split("\n")[1]).toMatch(/^la +la$/);
  });

  it("pulls the next chord back when a typed name shifted it", () => {
    const t = applied("G     C\nWalking down\n", "Gm7     C\nWalking down\n");
    expect(anchors(line(t))).toEqual(["Gm7@0", "C@6"]);
  });

  it("binds a new chord where it is typed and leaves the text alone", () => {
    expect(go("G\nWalking down the river\n", "G       D\nWalking down the river\n").kind).toBe("none");
  });

  it("moves rhythm marks with their syllables too", () => {
    const t = applied("G   C\nla la\n2   3\n", "G   C\nxx la la\n2   3\n");
    expect(line(t).rhythm).toEqual([{ at: 3, beat: "2" }, { at: 7, beat: "3" }]);
  });

  it("leaves padding edits, half-typed chords, other lines and multi-line edits alone", () => {
    expect(go("G  C\nla la\n", "G  C\nla  la\n").kind).toBe("none");
    expect(go("G     C\nWalking down\n", "G(     C\nWalking down\n").kind).toBe("wait");
    expect(go("G\nla\n", "G\nla\n\nmore\n").kind).toBe("skip");
    expect(relink(HEAD + "G\nla\n", HEAD.replace("T", "Other") + "G\nla\n", 0).kind).toBe("skip");
  });

  it("keeps the caret on the edited line", () => {
    const before = HEAD + "G     C\nWalking down\n";
    const after = HEAD + "G     C\nWe Walking down\n";
    const caret = after.indexOf("We ") + 3;
    const r = relink(before, after, caret);
    if (r.kind !== "applied") throw new Error(r.kind);
    expect(r.text.slice(r.caret - 3, r.caret)).toBe("We ");
  });
});

describe("page tags for clicking (annotate)", () => {
  it("records each lyric piece's characters, counted from the start of the line even when it wraps", () => {
    const b = line(HEAD + "|G     |C     |D     |E\nla la la la la la la la la la la la la la la la la la la la la la\n");
    const rows = fitLine(b);
    const pieces = rows.flatMap((r) => r.lyrics.filter((p) => p.chars));
    const text = lyricText(b.lyrics);
    for (const p of pieces) {
      const run = p.runs[0]!;
      if (run.kind === "text" && run.text !== "-") expect(text.slice(p.chars![0], p.chars![1])).toBe(run.text);
    }
    expect(Math.max(...pieces.map((p) => p.chars![1]))).toBe(text.length);
  });

  it("tags lyric pieces only when asked", () => {
    const chart = parseChartText(HEAD + "G\nla la\n").chart;
    expect(renderChart(chart, { annotate: true }).pages[0]).toMatch(/<g data-lyric="0:0:0">/);
    expect(renderChart(chart).pages[0]).not.toMatch(/data-lyric/);
  });

  it("marks the space left of each line's lyric only when asked", () => {
    const chart = parseChartText(HEAD + "G\nla la\n\nC\nla la la\n").chart;
    const page = renderChart(chart, { annotate: true }).pages[0]!;
    expect(page.match(/<rect data-line-start="0:\d+"/g)).toHaveLength(2);
    expect(renderChart(chart).pages[0]).not.toMatch(/data-line-start/);
  });
});

describe("setLineStart (click the space before a line's lyric)", () => {
  const src = HEAD + "|G          C\nWalking down the river\n";
  const edit = (s: string, change: { group?: string; entry?: string }) => {
    const r = setLineStart(s, 0, 0, change);
    if ("error" in r) throw new Error(r.error);
    return r.text;
  };

  it("reads the beat-1 chord over the first syllable, and the lyric entry", () => {
    expect(lineStartAt(src, 0, 0)).toEqual({ group: "|G" });
    expect(lineStartAt(HEAD + "|G       C\n@2 Walking down\n", 0, 0)).toEqual({ group: "|G", entry: "2" });
    expect(lineStartAt(HEAD + "      C\nWalking down\n", 0, 0)).toEqual({}); // C is on "ing", not the start
  });

  it("moves the lyric to a later beat, keeping the chord on beat 1 at the left edge", () => {
    const out = edit(src, { group: "|G", entry: "2" });
    expect(line(out).lyricEntry).toBe("2");
    expect(anchors(line(out))).toEqual(["|G@0", "C@12"]);
  });

  it("adds a beat-1 chord before a lyric that had none there", () => {
    const out = edit(HEAD + "      C\nWalking down\n", { group: "|Em", entry: "2" });
    expect(anchors(line(out))).toEqual(["|Em@0", "C@6"]);
    expect(line(out).lyricEntry).toBe("2");
  });

  it("changes or removes the chord, and an empty beat puts the lyric back on the bar", () => {
    const late = edit(src, { group: "|G", entry: "2" });
    expect(anchors(line(edit(late, { group: "|Am", entry: "2" })))).toEqual(["|Am@0", "C@12"]);
    expect(anchors(line(edit(late, { entry: "2" })))).toEqual(["C@12"]);
    expect(line(edit(late, { group: "|G" })).lyricEntry).toBeUndefined();
  });

  it("rejects a beat it can't read", () => {
    expect(setLineStart(src, 0, 0, { group: "|G", entry: "x" })).toHaveProperty("error");
  });
});

describe("a chart's own syllable splits (Syllables: header)", () => {
  const src = HEAD.replace("Key: G\n", "Key: G\nLanguage: en\n") + "G\nla dedicated la\n";

  it("reads and writes the header line", () => {
    const chart = parseChartText(src.replace("Language: en\n", "Language: en\nSyllables: de-di-cat-ed, fire\n")).chart;
    expect(chart.meta.syllables).toEqual(["de-di-cat-ed", "fire"]);
    expect(writeChartText(chart)).toMatch(/^Syllables: de-di-cat-ed, fire$/m);
    expect(parseChartText(HEAD.replace("Key: G\n", "Key: G\nSyllables: de di\n")).problems).toEqual([]);
    expect(parseChartText(HEAD.replace("Key: G\n", "Key: G\nSyllables: de--di\n")).problems[0]!.message).toMatch(/hyphens/);
  });

  it("overrides the automatic split for this chart only", () => {
    expect(splitOf("dedicated", "en", undefined)).toBe("ded-i-cat-ed");
    expect(splitOf("dedicated", "en", ["de-di-cat-ed"])).toBe("de-di-cat-ed");
    expect(splitOf("Dedicated", "en", ["de-di-cat-ed"])).toBe("De-di-cat-ed");
    expect(syllableAt("la dedicated", 4, "en", ["de-di-cat-ed"])).toMatchObject({ start: 3, end: 5, wordStart: 3, wordEnd: 12 });
  });

  it("adds, replaces and drops entries in the header line", () => {
    const one = setSyllables(src, "dedicated", "de-di-cat-ed");
    if ("error" in one) throw new Error(one.error);
    expect(one.text.split("\n").slice(0, 4)).toEqual(["Title: T", "Key: G", "Language: en", "Syllables: de-di-cat-ed"]);
    expect(one.line).toBe(4);
    const two = setSyllables(one.text, "river", "river"); // one syllable instead of riv-er
    if ("error" in two) throw new Error(two.error);
    expect(two.text).toMatch(/^Syllables: de-di-cat-ed, river$/m);
    // Back to the automatic split: the entry goes, and the line with it when empty.
    const back = setSyllables(one.text, "Dedicated", "ded-i-cat-ed");
    if ("error" in back) throw new Error(back.error);
    expect(back.text).not.toMatch(/Syllables/);
    expect(back.text).toBe(src);
  });

  it("checks what is typed", () => {
    expect(setSyllables(src, "dedicated", "de-di-cat")).toMatchObject({ error: expect.stringMatching(/spell/) });
    expect(setSyllables(src, "dedicated", "de--dicated")).toMatchObject({ error: expect.stringMatching(/hyphens/) });
  });

  it("moves a chord with the new split: it sits on the middle of its (new) syllable", () => {
    const withChord = HEAD + "   G\nla dedicated la\n"; // G on the "d" of "ded"
    const x = (s: string) => Number(/<text x="([\d.]+)"[^>]*>G</.exec(renderChart(parseChartText(s).chart).pages[0]!)![1]);
    const reSplit = setSyllables(withChord, "dedicated", "de-di-cat-ed");
    if ("error" in reSplit) throw new Error(reSplit.error);
    expect(x(reSplit.text)).toBeLessThan(x(withChord)); // "de" is narrower than "ded", so its middle is further left
  });
});
