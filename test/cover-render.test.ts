import { describe, expect, it } from "vitest";
import { renderCover } from "../src/cover/render.js";
import { chartChords, type Chart } from "../src/model/chart.js";
import { chordLabel } from "../src/model/voicing.js";
import { validateVoicing } from "../src/model/validate.js";
import { LIBRARY, parseChordName, pickVoicing, voicingsFor } from "../src/voicings/index.js";

// Made-up chart: no lyrics.
const chord = (label: string) => ({ t: "chord" as const, chord: parseChordName(label)! });
const chart = (extra: Partial<Chart> = {}, meta: Partial<Chart["meta"]> = {}): Chart => ({
  meta: { title: "Test Song", artist: "Some Band", year: 1999, key: "G", date: "2026-11-09", ...meta },
  sections: [
    { type: "verse", label: "Verse", blocks: [
      { kind: "line", lyrics: [{ text: "la la la la" }], above: [{ at: 0, items: [chord("G")] }, { at: 3, items: [chord("Em7")] }] },
      { kind: "line", lyrics: [{ text: "la la" }], above: [{ at: 0, items: [chord("C")] }, { at: 3, items: [{ t: "bass", bass: "B" }] }] },
    ] },
    { type: "chorus", label: "Chorus", blocks: [
      { kind: "line", lyrics: [{ text: "la la" }], above: [{ at: 0, items: [chord("G")] }, { at: 3, items: [chord("Bbm7/C")] }] },
    ] },
  ],
  ...extra,
});

describe("chartChords", () => {
  it("lists each chord once, in order of first use; a bass change adds a slash chord", () => {
    expect(chartChords(chart()).map(chordLabel)).toEqual(["G", "Em7", "C", "C/B", "Bbm7/C"]);
  });
});

describe("parseChordName", () => {
  it("reads chord names as written", () => {
    expect(parseChordName("Bbm7/C")).toEqual({ root: "B", accidental: "b", quality: "m7", bass: "C" });
    expect(parseChordName("F#")).toEqual({ root: "F", accidental: "#" });
    expect(parseChordName("G7(b9)/F")).toEqual({ root: "G", quality: "7(b9)", bass: "F" });
    expect(parseChordName("E♭")).toEqual({ root: "E", accidental: "b" });
    expect(parseChordName("hello")).toBeUndefined();
  });
});

describe("voicing library", () => {
  it("holds only valid voicings with unique ids", () => {
    for (const e of LIBRARY) expect(validateVoicing(e.voicing).errors, e.id).toEqual([]);
    expect(new Set(LIBRARY.map((e) => e.id)).size).toBe(LIBRARY.length);
  });

  it("only prints one-digit fret numbers (the diagram has no room for two)", () => {
    for (const { id, voicing: v } of LIBRARY) {
      if (v.fretLabelRow !== undefined) expect(v.windowStartFret + v.fretLabelRow, id).toBeLessThanOrEqual(9);
    }
  });

  it("uses the owner's Corel diagrams as the defaults for their chords", () => {
    for (const name of ["Fm", "Eb", "Bb", "Ab"]) {
      const p = pickVoicing(parseChordName(name)!);
      expect(p.id).toBe(`${name}/sample`);
      expect(p.warnings).toEqual([]);
    }
  });

  it("covers every root for the common qualities", () => {
    for (const root of ["C", "C#", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]) {
      for (const q of ["", "m", "7", "m7", "Maj7", "sus", "5"]) {
        expect(voicingsFor(parseChordName(root + q)!).length, root + q).toBeGreaterThan(0);
      }
    }
  });

  it("looks up other spellings through the aliases", () => {
    expect(voicingsFor(parseChordName("Cmaj7")!)[0]!.id).toBe(voicingsFor(parseChordName("CMaj7")!)[0]!.id);
    expect(voicingsFor({ root: "E", quality: "(m)5" })[0]!.id).toBe("E5/open");
  });

  it("keeps a chart's pick, by id or as its own shape, and prints the chart's chord name", () => {
    const am = parseChordName("Am")!;
    expect(pickVoicing(am, "Am/E-shape@5").id).toBe("Am/E-shape@5");
    const custom = { ...LIBRARY.find((e) => e.id === "Am/open")!.voicing, chord: { root: "X" } };
    expect(pickVoicing(am, custom).voicing.chord).toEqual(am);
    expect(pickVoicing(am, "nope").warnings.join()).toMatch(/not in the library/);
  });

  it("gives a placeholder for chords it doesn't have", () => {
    const p = pickVoicing(parseChordName("G7(b9)/F")!);
    expect(p.voicing.strings.every((s) => s.kind === "open")).toBe(true);
    expect(p.warnings.join()).toMatch(/no voicing/);
  });
});

describe("renderCover", () => {
  const r = renderCover(chart({}, { tuning: "Eb Standard Tuning" }));
  const svg = r.pages[0]!;

  it("prints the title block like the template", () => {
    expect(svg).toMatch(/>TEST SONG</);
    expect(svg).toMatch(/>Some Band, 1999 </);
    expect(svg).toMatch(/>\(Key of G, Original\)</);
    expect(svg).toMatch(/>Eb Standard Tuning</);
    expect(svg).toMatch(/>Musiciansclub\.com</);
    expect(svg).toMatch(/>11\/9\/2026</);
  });

  it("drops 'Original' when the chart is transposed", () => {
    expect(renderCover(chart({}, { originalKey: "A" })).pages[0]).toMatch(/>\(Key of G\)</);
  });

  it("draws one diagram per chord of the chart, with the Legend beside them", () => {
    expect(r.layout.diagrams).toHaveLength(5);
    expect(svg.match(/aria-label="[^"]+ chord diagram"/g)).toHaveLength(5);
    expect(svg).toMatch(/>LEGEND:</);
    expect(svg).toMatch(/>riff\/pattern</); // Legend words are placed one by one (justified lines)
    expect(r.warnings.join()).not.toMatch(/registry|Legend entry/);
    expect(r.warnings.join()).toMatch(/Bbm7\/C: no voicing/);
  });

  it("uses the chart's cover choices: order, picks, notes, the alternate group", () => {
    const c = renderCover(chart({ cover: { diagrams: [
      { chord: "Ab", note: "for Bridge only" },
      { chord: "Am", voicing: "Am/E-shape@5" },
      { chord: "G", group: "alternate" },
    ], alternateLabel: "for Acoustic" } }));
    expect(c.layout.diagrams).toHaveLength(3);
    expect(c.pages[0]).toMatch(/>for Bridge only</);
    expect(c.pages[0]).toMatch(/>Alternate \(</);
    expect(c.pages[0]).toMatch(/>for Acoustic</);
    expect(c.layout.pages[0]!.alternateY).toBeDefined();
  });

  it("moves the Legend to page 2 for many chords", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ chord: ["C", "D", "E", "F", "G"][i % 5]! + ["", "m", "7", "m7", "sus", "5", "Maj7", "sus2", "7sus", "6"][Math.floor(i / 5)]! }));
    const c = renderCover(chart({ cover: { diagrams: many } }));
    expect(c.pages).toHaveLength(2);
    expect(c.pages[0]).not.toMatch(/>LEGEND:</);
    expect(c.pages[1]).toMatch(/>LEGEND:</);
  });

  it("is deterministic", () => {
    expect(renderCover(chart()).pages).toEqual(renderCover(chart()).pages);
  });
});
