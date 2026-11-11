import { describe, expect, it } from "vitest";
import { fitLine } from "../src/chart/line.js";
import { renderChart } from "../src/chart/render.js";
import type { LineBlock } from "../src/model/chart.js";
import { lyricText } from "../src/text-format/canonical.js";
import { chordAt, setChordAt, type ChordTarget } from "../src/text-format/edit.js";
import { parseChartText } from "../src/text-format/index.js";
import { relink } from "../src/text-format/link.js";
import { syllableAt } from "../src/text/syllables.js";

// Made-up lyrics only.
const HEAD = "Title: T\nKey: G\n\n# Verse\n";
const line = (src: string, block = 0) => parseChartText(src).chart.sections[0]!.blocks[block] as LineBlock;
/** "word@char" -> chord groups and where they sit, e.g. "|G@0 C@8>". */
const anchors = (b: LineBlock) => b.above.map((a) => `${a.items.map((i) => (i.t === "chord" ? i.chord.root + (i.chord.quality ?? "") : i.t === "bar" ? "|" : i.t)).join("")}@${a.at}${a.place ? ":" + a.place : ""}`);

describe("syllableAt", () => {
  const text = "Walking down, the river";
  it("finds the sung syllable under a character", () => {
    expect(syllableAt(text, 1)).toEqual({ start: 0, end: 4, next: 4 }); // Walk|ing
    expect(syllableAt(text, 5)).toEqual({ start: 4, end: 7, next: 8 }); // ing -> down
    expect(syllableAt(text, 19)).toEqual({ start: 18, end: 21, next: 21 }); // riv|er
    expect(syllableAt(text, 22)).toEqual({ start: 21, end: 23, next: 23 }); // last syllable: next = end of text
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
    // After "ing" = pinned to the next syllable ("down") as "just after the one before".
    expect(anchors(line(edit(5, "Am7", "after").text))).toEqual(["|G@1", "Am7@8:after", "C@12"]);
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
});
