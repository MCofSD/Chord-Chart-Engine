import { describe, expect, it } from "vitest";
import { renderChart } from "../src/chart/render.js";
import { CHART } from "../src/chart/tokens.js";
import type { Block, Chart, Section } from "../src/model/chart.js";
import { textWidth } from "../src/text/metrics.js";

// Made-up song (no copyrighted text).
const meta = { title: "River Road", artist: "Test Band", year: 2026, key: "Eb", bpm: 96, date: "2026-11-08" };
const lyricLine = (text: string, root = "G"): Block => ({ kind: "line", lyrics: [{ text }], above: [{ at: 0, items: [{ t: "bar" }, { t: "chord", chord: { root } }] }] });
const section = (type: Section["type"], label: string, n = 2): Section => ({
  type, label, blocks: Array.from({ length: n }, (_, i) => lyricLine(`line ${i + 1} of the ${label}`)),
});
const chart = (sections: Section[]): Chart => ({ meta, sections });
const texts = (svg: string) => [...svg.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)].map((m) => ({ attrs: m[1]!, text: m[2]! }));
const attr = (attrs: string, name: string) => attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1];

describe("renderChart", () => {
  it("is deterministic and has no DOM or baseline-shift dependency", () => {
    const c = chart([section("verse", "1st Ver"), section("chorus", "Chorus")]);
    const a = renderChart(c), b = renderChart(structuredClone(c));
    expect(a.pages).toEqual(b.pages);
    expect(a.pages[0]).not.toMatch(/baseline-shift|<tspan|foreignObject/);
  });

  it("prints the header on page 1: date, uppercase title with artist and year, key and BPM", () => {
    const svg = renderChart(chart([section("verse", "Verse")])).pages[0]!;
    const t = texts(svg).map((x) => x.text);
    expect(t).toEqual(expect.arrayContaining(["11/8/2026", "RIVER ROAD", " (Test Band, 2026)", "(Key of Eb, BPM=96)"]));
    // Title block centered on the header's center tab (295.3 pt), not the page center.
    const title = texts(svg).find((x) => x.text === "RIVER ROAD")!;
    const w = textWidth("RIVER ROAD", 18, "calibriBold") + textWidth(" (Test Band, 2026)", 14, "calibri");
    expect(Number(attr(title.attrs, "x"))).toBeCloseTo(CHART.header.titleCenter - w / 2, 1);
  });

  const repeat = (ref: { section: Section["type"]; text: string; label?: string }): Section => ({
    type: "other", label: "", blocks: [{ kind: "note", pieces: [{ text: "Repeat " }, ref] }],
  });

  const [BLUE, GREEN, PURPLE] = CHART.repeatColors;
  const labelFill = (svg: string, s: string) => attr(texts(svg).find((x) => x.text === s && x.attrs.includes(`font-size="${CHART.section.labelSize}"`))!.attrs, "fill");

  it("colors a section label only when a later Repeat line points back to it", () => {
    const svg = renderChart(chart([section("verse", "1st Ver"), section("chorus", "Chorus"), section("refrain", "Ref 1"), repeat({ section: "chorus", text: "Chorus" })])).pages[0]!;
    const label = (s: string) => texts(svg).find((x) => x.text === s)!.attrs;
    // The only repeated section takes the first priority color, blue.
    expect(attr(label("Chorus"), "fill")).toBe(BLUE);
    expect(label("Chorus")).toContain('font-weight="700"');
    for (const plain of ["1", "Ref 1"]) {
      expect(attr(label(plain), "fill")).toBe("#000000");
      expect(label(plain)).not.toContain("font-weight");
    }
    expect(attr(label("st"), "font-size")).toBe(String(CHART.section.ordinalSize));
  });

  it("resolves a Repeat to the exact labelled section, or the latest of its type", () => {
    const sections = [section("verse", "1st Ver"), section("verse", "2nd Ver"), repeat({ section: "verse", text: "1st Verse", label: "1st Ver" })];
    const svg = renderChart(chart(sections)).pages[0]!;
    const fills = texts(svg).filter((x) => x.text === "1" || x.text === "2").map((x) => attr(x.attrs, "fill"));
    expect(fills).toEqual([BLUE, "#000000"]);
    const latest = renderChart(chart([sections[0]!, sections[1]!, repeat({ section: "verse", text: "Verse" })])).pages[0]!;
    expect(texts(latest).filter((x) => x.text === "1" || x.text === "2").map((x) => attr(x.attrs, "fill"))).toEqual(["#000000", BLUE]);
  });

  it("colors repeated sections blue, green, purple in order from the top of the chart, whatever their type", () => {
    // Repeat line names them out of order; colors still follow chart order.
    const all: Section = {
      type: "other", label: "", blocks: [{ kind: "note", pieces: [
        { text: "Repeat " }, { section: "chorus", text: "Chorus" }, { text: ", " }, { section: "bridge", text: "Bridge" }, { text: " and " }, { section: "verse", text: "Verse" },
      ] }],
    };
    const r = renderChart(chart([section("verse", "Verse"), section("bridge", "Bridge"), section("chorus", "Chorus"), all]));
    const svg = r.pages[0]!;
    expect(["Verse", "Bridge", "Chorus"].map((s) => labelFill(svg, s))).toEqual([BLUE, GREEN, PURPLE]);
    // The Repeat line uses the same color for each name.
    const noteFill = (s: string) => attr(texts(svg).find((x) => x.text === s && x.attrs.includes('font-size="16"') && x.attrs.includes("700"))!.attrs, "fill");
    expect(["Verse", "Bridge", "Chorus"].map(noteFill)).toEqual([BLUE, GREEN, PURPLE]);
    expect(r.warnings).toEqual([]);
  });

  it("gives a section repeated twice one color, and warns when a fourth repeated section reuses purple", () => {
    const twice = renderChart(chart([section("chorus", "Chorus"), repeat({ section: "chorus", text: "Chorus" }), repeat({ section: "chorus", text: "Chorus" })]));
    expect(labelFill(twice.pages[0]!, "Chorus")).toBe(BLUE);
    const four = ["Intro", "Verse", "Bridge", "Outro"].map((l) => section("other", l, 1));
    const refs = four.map((s) => repeat({ section: "other", text: s.label, label: s.label }));
    const r = renderChart(chart([...four, ...refs]));
    expect(["Intro", "Verse", "Bridge", "Outro"].map((s) => labelFill(r.pages[0]!, s))).toEqual([BLUE, GREEN, PURPLE, PURPLE]);
    expect(r.warnings).toEqual([expect.stringContaining('"Outro"')]);
  });

  it("warns when a Repeat points at nothing", () => {
    const r = renderChart(chart([section("bridge", "Bridge"), repeat({ section: "bridge", text: "Bridge" }), repeat({ section: "outro", text: "Outro" })]));
    expect(r.warnings).toEqual([expect.stringContaining('"Outro"')]);
    expect(labelFill(r.pages[0]!, "Bridge")).toBe(BLUE);
  });

  it("puts the label on the first row's baseline and spaces rows 18.4 pt apart", () => {
    const svg = renderChart(chart([section("chorus", "Chorus", 2)])).pages[0]!;
    const ys = (s: string) => texts(svg).filter((x) => x.text === s).map((x) => Number(attr(x.attrs, "y")));
    const label = ys("Chorus")[0]!;
    expect(label).toBeCloseTo(CHART.rule.firstY + 16.6, 1);
    expect(ys("|")).toEqual([label, label + 2 * 18.4].map((v) => Math.round(v * 100) / 100));
  });

  it("draws a rule under the header and after every section", () => {
    const svg = renderChart(chart([section("verse", "Verse"), section("chorus", "Chorus")])).pages[0]!;
    expect((svg.match(new RegExp(`fill="${CHART.colors.rule}"`, "g")) ?? []).length).toBe(3);
  });

  it("moves a section that doesn't fit to the next page, which has no header, and numbers pages", () => {
    const sections = Array.from({ length: 9 }, (_, i) => section("verse", `Verse ${i + 1}`, 5));
    const { pages } = renderChart(chart(sections));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]).toContain("RIVER ROAD");
    expect(pages[1]).not.toContain("RIVER ROAD");
    pages.forEach((p, i) => expect(p).toContain(`>Page ${i + 1} of ${pages.length}<`));
    // No section is split: each label's lines are all on the label's page.
    for (const p of pages) {
      for (const m of p.matchAll(/>Verse (\d+)</g)) expect((p.match(new RegExp(`of the Verse ${m[1]}<`, "g")) ?? []).length).toBe(5);
    }
  });

  it("splits a section only when it is taller than a page", () => {
    const { pages } = renderChart(chart([section("verse", "Long Verse", 30)]));
    expect(pages.length).toBe(2);
    expect(pages[1]).toContain("of the Long Verse");
  });

  it("places notation snippets as images with overlay text, and the label over the snippet", () => {
    const snippet: Block = {
      kind: "snippet", src: "assets/test-riff.png", width: 450, height: 52,
      overlay: [{ x: 50, items: [{ t: "instrument", op: "only", text: "RGtr" }] }, { x: 0, alignRight: true, items: [{ t: "direction", text: "simile" }] }],
    };
    const svg = renderChart(chart([{ type: "intro", label: "Intro", blocks: [snippet] }])).pages[0]!;
    expect(svg).toContain(`<image href="assets/test-riff.png" x="${CHART.content.left}"`);
    const intro = texts(svg).find((x) => x.text === "Intro")!;
    expect(Number(attr(intro.attrs, "y"))).toBeCloseTo(CHART.rule.firstY + CHART.section.labelBaselineOverSnippet, 1);
    expect(texts(svg).find((x) => x.text === "simile")!.attrs).toContain('font-style="italic"');
    expect(svg).toMatch(/<path [^>]*fill="#EE0000"/); // circled plus outline
  });

  it("prints 'Repeat Chorus' notes with the section name in its color, Arial Bold 16", () => {
    const svg = renderChart(chart([section("chorus", "Chorus"), repeat({ section: "chorus", text: "Chorus" })])).pages[0]!;
    const name = texts(svg).find((x) => x.text === "Chorus" && x.attrs.includes('font-size="16"'))!;
    expect(attr(name.attrs, "fill")).toBe(BLUE);
    expect(name.attrs).toContain('font-weight="700"');
  });

  it("colors riff references dark for the first riff and light for the second", () => {
    const refs: Block = { kind: "line", lyrics: [], above: [{ at: 0, items: [{ t: "ref", n: 1 }, { t: "ref", n: 1, riff: 2 }, { t: "ref", n: 2, riff: 3 }] }] };
    const svg = renderChart(chart([{ type: "verse", label: "Verse", blocks: [refs] }])).pages[0]!;
    const fills = [...svg.matchAll(/<path transform="[^"]*" fill="(#[0-9A-F]+)"/g)].map((m) => m[1]);
    expect(fills).toEqual(["#0000FF", "#00B0F0", "#00B0F0"]); // a third riff has no color yet: reuses the last
  });

  it("puts the beat tag after a slash bass and tucks the slash under the superscript", () => {
    const c = (quality: string) => chart([{ type: "verse", label: "V", blocks: [{ kind: "line", lyrics: [], above: [{ at: 0, items: [{ t: "chord", chord: { root: "C", quality, bass: "E" }, beats: "2a" }] }] }] }]);
    const runs = (svg: string) => texts(svg).filter((x) => /^(C|7|7\(9\)|\/E|\[|2a|\])$/.test(x.text)).map((x) => ({ t: x.text, x: Number(attr(x.attrs, "x")) }));
    const r = runs(renderChart(c("7")).pages[0]!);
    expect(r.map((x) => x.t)).toEqual(["C", "7", "/E", "[", "2a", "]"]);
    const seven = r[1]!, slash = r[2]!;
    expect(slash.x).toBeCloseTo(seven.x + textWidth("7", CHART.chord.supSize) - CHART.chord.slashTuck, 1);
    const p = runs(renderChart(c("7(9)")).pages[0]!);
    expect(p[2]!.x).toBeCloseTo(p[1]!.x + textWidth("7(9)", CHART.chord.supSize) - CHART.chord.slashTuckAfterParen, 1);
  });

  it("draws flats as symbols in chords, and keeps lyrics' spaces", () => {
    const c = chart([{ type: "verse", label: "Verse", blocks: [{ kind: "line", lyrics: [{ text: "a  b" }], above: [{ at: 0, items: [{ t: "chord", chord: { root: "B", accidental: "b", quality: "7(b9)" } }] }] }] }]);
    const svg = renderChart(c).pages[0]!;
    expect((svg.match(/<path transform/g) ?? []).length).toBe(2);
    expect(svg).toContain('xml:space="preserve">a  b<');
  });
});
