import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeSvgBytes } from "../src/importers/corel-svg/decode.js";
import { importCorelSvg, measureCorelGrid } from "../src/importers/corel-svg/index.js";
import { validateVoicing } from "../src/model/validate.js";

const SAMPLES = ["Fm", "Eb", "Bb", "Ab"] as const;
const sample = (name: string) => readFileSync(`samples/${name}.svg`);
const fixture = (name: string) => JSON.parse(readFileSync(`test/fixtures/${name}.json`, "utf8"));

describe("corel-svg importer", () => {
  it.each(SAMPLES)("%s matches its golden JSON", (name) => {
    expect(importCorelSvg(sample(name)).voicing).toEqual(fixture(name));
  });

  it.each(SAMPLES)("%s output passes schema and semantic validation", (name) => {
    expect(validateVoicing(importCorelSvg(sample(name)).voicing)).toEqual({ ok: true, errors: [] });
  });

  it("derives R from the grid, whatever the viewBox scale", () => {
    const ratios = SAMPLES.map((name) => {
      const { R, viewBox } = measureCorelGrid(sample(name));
      return { name, R, height: (viewBox[3] ?? 0) / R };
    });
    // The four files differ ~28x in units; heights in R match for Eb/Bb/Ab.
    for (const r of ratios.filter((r) => r.name !== "Fm")) expect(r.height).toBeCloseTo(5.855, 2);
  });

  it("decodes UTF-16LE with BOM and UTF-8", () => {
    expect(sample("Eb")[0]).toBe(0xff);
    expect(decodeSvgBytes(sample("Eb"))).toMatch(/^<\?xml/);
    expect(decodeSvgBytes(sample("Fm"))).toMatch(/^<\?xml/);
    const be = new Uint8Array([0xfe, 0xff, 0x00, 0x3c, 0x00, 0x61]);
    expect(decodeSvgBytes(be)).toBe("<a");
  });

  it("reads a diagram with no fret number as starting at fret 1, without a flag", () => {
    const { voicing, review } = importCorelSvg(sample("Fm"));
    expect(voicing.windowStartFret).toBe(1);
    expect(voicing.fretLabelRow).toBeUndefined();
    expect(review.some((r) => /fret number|fret 1/.test(r))).toBe(false);
  });

  it("rejects a voicing above fret 1 with no fret number", () => {
    const eb = JSON.parse(readFileSync("test/fixtures/Eb.json", "utf8"));
    delete eb.fretLabelRow;
    const result = validateVoicing(eb);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/fretLabelRow is required/);
  });

  it("flags the padded x-mark text", () => {
    const { review } = importCorelSvg(sample("Eb"));
    expect(review).toEqual([expect.stringContaining("snapped to strings 0,4,5")]);
  });

  it("ignores snap-helper shapes (white or invisible) without flagging them", () => {
    // Eb and Ab have white row-center hairlines (Eb also a white circle); Bb has the same shapes invisible.
    expect(importCorelSvg(sample("Ab")).review).toEqual([]);
    expect(importCorelSvg(sample("Bb")).review).toEqual([]);
    expect(importCorelSvg(sample("Eb")).voicing.strings.every((s) => s.kind !== "open")).toBe(true);
  });

  it("treats a string with no mark as open, without a flag", () => {
    const svg = decodeSvgBytes(sample("Eb")).replace(/x {13}x x/, "x             x  ");
    const { voicing, review } = importCorelSvg(new TextEncoder().encode(svg));
    expect(voicing.strings[5]).toEqual({ kind: "open" });
    expect(review.some((r) => r.includes("string 5"))).toBe(false);
  });
});
