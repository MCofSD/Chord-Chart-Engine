import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { diagramGeometry, renderDiagram } from "../src/diagram/render.js";
import { TOKENS } from "../src/diagram/tokens.js";
import { SHARP } from "../src/text/glyphs.js";
import { textWidth } from "../src/text/metrics.js";
import type { Voicing } from "../src/model/voicing.js";

const fixture = (name: string): Voicing => JSON.parse(readFileSync(`test/fixtures/${name}.json`, "utf8"));
const count = (svg: string, re: RegExp) => (svg.match(re) ?? []).length;
const attrs = (el: string) => Object.fromEntries([...el.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const elements = (svg: string, tag: string) => [...svg.matchAll(new RegExp(`<${tag} [^>]*>`, "g"))].map((m) => attrs(m[0]));

describe("renderDiagram", () => {
  it("is deterministic", () => {
    const v = fixture("Bb");
    expect(renderDiagram(v)).toBe(renderDiagram(structuredClone(v)));
  });

  it("does not depend on baseline-shift or a DOM", () => {
    const svg = renderDiagram(fixture("Fm"));
    expect(svg).not.toMatch(/baseline-shift|<tspan|dominant-baseline/);
    expect(svg.startsWith("<svg ")).toBe(true);
  });

  it("draws the grid: frame, 4 inner strings, band line and 3 fret lines", () => {
    const svg = renderDiagram(fixture("Eb"));
    expect(count(svg, /<line /g)).toBe(4 + 4);
  });

  it("enforces one physical size and scales it", () => {
    const a = elements(renderDiagram(fixture("Fm")), "svg")[0]!;
    const b = elements(renderDiagram(fixture("Eb"), { scale: 0.65 }), "svg")[0]!;
    expect(a.width).toBe("1.3899in");
    expect(parseFloat(b.width!)).toBeCloseTo(1.3899 * 0.65, 3);
    expect(a.viewBox).toBe(elements(renderDiagram(fixture("Eb")), "svg")[0]!.viewBox);
  });

  it("draws one dot per fretted or muted string, centered on string and row", () => {
    const v = fixture("Bb");
    const g = diagramGeometry();
    const circles = elements(renderDiagram(v), "circle");
    expect(circles).toHaveLength(6);
    // String 2, fret 8 -> row 3.
    expect(circles.some((c) => c.cx === String(g.stringX(2)) && c.cy === String(g.rowCenterY(3)))).toBe(true);
  });

  it("colors muted dots gray with a white X and fretted dots dark with the finger", () => {
    const svg = renderDiagram(fixture("Ab"));
    const circles = elements(svg, "circle");
    expect(circles.filter((c) => c.fill === TOKENS.colors.gray)).toHaveLength(3);
    expect(circles.filter((c) => c.fill === TOKENS.colors.dark)).toHaveLength(3);
    expect(count(svg, />X<\/text>/g)).toBe(3);
    expect(svg).toMatch(/fill="#FEFEFE">3<\/text>/);
  });

  it("draws barres gray with dark segments only over sounding ranges", () => {
    const fm = elements(renderDiagram(fixture("Fm")), "rect").filter((r) => r.fill);
    expect(fm.map((r) => r.fill)).toEqual([TOKENS.colors.gray, TOKENS.colors.dark]);
    const g = diagramGeometry();
    expect(Number(fm[1]!.x)).toBeCloseTo(g.stringX(3), 2);
    expect(Number(fm[1]!.width)).toBeCloseTo(g.stringX(4) - g.stringX(3), 2);
    const bb = elements(renderDiagram(fixture("Bb")), "rect").filter((r) => r.fill);
    expect(bb.map((r) => r.fill)).toEqual([TOKENS.colors.gray]);
  });

  it("prints x above the frame for each mutedOpen string", () => {
    const svg = renderDiagram(fixture("Eb"));
    expect(count(svg, />x<\/text>/g)).toBe(3);
  });

  it("draws nothing for open strings", () => {
    const eb = fixture("Eb");
    const open: Voicing = { ...eb, strings: eb.strings.map((s) => (s.kind === "mutedOpen" ? { kind: "open" } : s)) };
    const svg = renderDiagram(open);
    expect(count(svg, />x<\/text>/g)).toBe(0);
    expect(count(svg, /<circle /g)).toBe(3);
  });

  it("prints the fret number beside its row, right-aligned, italic", () => {
    const g = diagramGeometry();
    const t = elements(renderDiagram(fixture("Eb")), "text").find((e) => e["font-style"] === "italic")!;
    expect(t["text-anchor"]).toBe("end");
    expect(Number(t.y)).toBeCloseTo(g.rowCenterY(3) + 36, 1);
    expect(renderDiagram(fixture("Eb"))).toMatch(/font-style="italic" text-anchor="end">6</);
  });

  it("places the quality as a superscript by explicit y, and the flat at root baseline", () => {
    const fm = elements(renderDiagram(fixture("Fm")), "text");
    const root = fm.find((t) => t["font-size"] === "128.6")!;
    const sup = fm.find((t) => t["font-size"] === "64.3" && !t["font-weight"])!;
    expect(Number(root.y) - Number(sup.y)).toBeCloseTo(64.3, 1);
    const eb = elements(renderDiagram(fixture("Eb"), { accidentals: "letter" }), "text");
    expect(eb.find((t) => t["font-size"] === "107.2")!.y).toBe(eb.find((t) => t["font-size"] === "128.6")!.y);
  });

  it("draws flats as a symbol outline on the root baseline by default", () => {
    const svg = renderDiagram(fixture("Eb"));
    const root = elements(svg, "text").find((t) => t["font-size"] === "128.6")!;
    const flat = elements(svg, "path").find((p) => p["data-accidental"] === "flat")!;
    expect(flat.transform).toMatch(new RegExp(` ${root.y}\\) scale\\(`));
    expect(svg).not.toMatch(/>b<\/text>/);
  });

  it("bottom-aligns the sharp's ink with the root baseline", () => {
    const v: Voicing = { ...fixture("Bb"), chord: { root: "F", accidental: "#", quality: "m" } };
    const svg = renderDiagram(v);
    const rootY = Number(elements(svg, "text").find((t) => t["font-size"] === "128.6")!.y);
    const m = elements(svg, "path")[0]!.transform!.match(/translate\(\S+ (\S+)\) scale\((\S+)\)/)!;
    const inkBottom = Number(m[1]) + -SHARP.yMin * Number(m[2]);
    expect(inkBottom).toBeCloseTo(rootY, 1);
  });

  it("uses symbols in the bass and before digits in extensions, not in words", () => {
    const v: Voicing = { ...fixture("Bb"), chord: { root: "F", accidental: "#", quality: "7sus4(b9#11b13)", bass: "Bb" } };
    const svg = renderDiagram(v);
    const kinds = elements(svg, "path").map((p) => p["data-accidental"]);
    expect(kinds).toEqual(["sharp", "flat", "sharp", "flat", "flat"]);
    expect(svg).toMatch(/>7sus4\(<\/text>/);
    expect(svg).toContain("<title>F#7sus4(b9#11b13)/Bb</title>");
  });

  it("prints letters instead of symbols in letter mode", () => {
    const v: Voicing = { ...fixture("Bb"), chord: { root: "C", quality: "7(b9b13)" } };
    const svg = renderDiagram(v, { accidentals: "letter" });
    expect(svg).not.toContain("<path");
    expect(svg).toMatch(/>7\(b9b13\)<\/text>/);
  });

  it("renders slash chords and extensions", () => {
    const v: Voicing = { ...fixture("Bb"), chord: { root: "B", accidental: "b", quality: "m7", bass: "C" } };
    const svg = renderDiagram(v);
    expect(svg).toMatch(/>m7<\/text>/);
    expect(svg).toMatch(/>\/C<\/text>/);
    expect(svg).toContain("<title>Bbm7/C</title>");
  });

  it("prints the slash and bass at 20 pt and the bass flat at 16.7 pt, on the root baseline", () => {
    const v: Voicing = { ...fixture("Bb"), chord: { root: "A", accidental: "b", bass: "Eb" } };
    const svg = renderDiagram(v);
    const texts = elements(svg, "text");
    const root = texts.find((t) => t["font-size"] === "128.6")!;
    const bass = texts.find((t) => t["font-size"] === "107.15")!;
    expect(svg).toMatch(/font-size="107.15">\/E<\/text>/);
    expect(bass.y).toBe(root.y);
    const bassFlat = elements(svg, "path")[1]!;
    expect(bassFlat.transform).toBe(`translate(${bassFlat.transform!.match(/translate\((\S+)/)![1]} ${root.y}) scale(0.08929)`);
  });

  it("tucks the slash under a preceding superscript, but not after a plain flat", () => {
    /** Slash origin minus the end of the previous run's advance box. */
    const gapBeforeSlash = (chord: Voicing["chord"]) => {
      const texts = elements(renderDiagram({ ...fixture("Bb"), chord }, { accidentals: "letter" }), "text");
      const i = texts.findIndex((t) => t["font-size"] === "107.15");
      const prev = texts[i - 1]!;
      const prevWidth = textWidth(chord.quality ?? chord.accidental ?? "", Number(prev["font-size"]));
      return Number(texts[i]!.x) - (Number(prev.x) + prevWidth);
    };
    expect(gapBeforeSlash({ root: "B", accidental: "b", quality: "m7", bass: "C" })).toBeCloseTo(-TOKENS.name.slashTuckUnderSuperscript * 100, 1);
    expect(gapBeforeSlash({ root: "A", accidental: "b", bass: "E" })).toBeCloseTo(0, 1);
    expect(gapBeforeSlash({ root: "G", quality: "7(9)", bass: "F" })).toBeCloseTo(-TOKENS.name.slashTuckAfterParen * 100, 1);
  });

  it("escapes text", () => {
    const v: Voicing = { ...fixture("Bb"), chord: { root: "B", quality: "<&>" } };
    expect(renderDiagram(v)).toContain("&lt;&amp;&gt;");
  });
});
