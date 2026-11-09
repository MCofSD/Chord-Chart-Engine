/**
 * Visual check of the chart renderer against a real chart PDF (owner-approved
 * 4-line excerpt of "Since U Been Gone", page 1 chorus).
 *
 * Chord x positions differ from the original by design (chords are pinned to
 * syllables, not Word tab stops), so this checks what should match: header
 * geometry, the vertical rhythm of rows and rules, and a pixel diff of the
 * header strip. Side-by-side images of the chorus go to test/output/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as mupdf from "mupdf";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { Resvg } from "@resvg/resvg-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderChart } from "../src/chart/render.js";
import { CHART } from "../src/chart/tokens.js";
import type { Chart } from "../src/model/chart.js";

const PDF = "samples/Since U Been Gone - Kelly Clarkson (2004).pdf";
const SCALE = 3; // px per pt
const FONTS = [
  "assets/fonts/Arimo_400Regular.ttf", "assets/fonts/Arimo_700Bold.ttf", "assets/fonts/Arimo_400Regular_Italic.ttf",
  "assets/fonts/Carlito_400Regular.ttf", "assets/fonts/Carlito_700Bold.ttf",
];
/** Max share of inked header pixels that may differ. Measured 8.35%: Carlito vs Calibri glyph shapes. See NOTES.md. */
const MAX_HEADER_INK_RATIO = 0.1;

const FIXTURE = "test/fixtures/charts/subg-chorus.json";
/**
 * The PDF and the excerpt contain copyrighted lyrics, so they are gitignored
 * (the repo is public). This suite runs only where local copies exist.
 */
const HAVE_FILES = existsSync(PDF) && existsSync(FIXTURE);

interface Glyph { ch: string; x: number; y: number; size: number }
let ours = "";
let page: ReturnType<mupdf.Document["loadPage"]>;
const pdfGlyphs: Glyph[] = [];
let ourTexts: { x: number; y: number; size: number; text: string }[] = [];

function load(): void {
  const chart: Chart = JSON.parse(readFileSync(FIXTURE, "utf8"));
  ours = renderChart(chart).pages[0]!;
  page = mupdf.Document.openDocument(readFileSync(PDF), "application/pdf").loadPage(0);
  page.toStructuredText("preserve-whitespace").walk({
    onChar(ch: string, origin: [number, number], _f: unknown, size: number) { pdfGlyphs.push({ ch, x: origin[0], y: origin[1], size }); },
  });
  ourTexts = [...ours.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ x: +m[1]!, y: +m[2]!, size: +m[3]!, text: m[4]! }));
}
/** x of the first glyph of `word` at baseline y (PDF). */
function pdfWordX(word: string, y: number): number {
  const row = pdfGlyphs.filter((g) => Math.abs(g.y - y) < 0.5).sort((a, b) => a.x - b.x);
  const s = row.map((g) => g.ch).join("");
  const i = s.indexOf(word);
  if (i < 0) throw new Error(`"${word}" not found at y=${y}`);
  return row[i]!.x;
}
const ourX = (text: string) => ourTexts.find((t) => t.text === text)!.x;

function rasterOriginal(): PNG {
  const pix = page.toPixmap(mupdf.Matrix.scale(SCALE, SCALE), mupdf.ColorSpace.DeviceRGB, false, true);
  return PNG.sync.read(Buffer.from(pix.asPNG()));
}
function rasterOurs(): PNG {
  const png = new Resvg(ours, { fitTo: { mode: "width", value: 612 * SCALE }, background: "white", font: { loadSystemFonts: false, fontFiles: FONTS, defaultFontFamily: "Arimo" } }).render().asPng();
  return PNG.sync.read(png);
}
function crop(src: PNG, y0pt: number, y1pt: number): PNG {
  const y0 = Math.round(y0pt * SCALE), h = Math.round((y1pt - y0pt) * SCALE);
  const out = new PNG({ width: src.width, height: h });
  src.data.copy(out.data, 0, y0 * src.width * 4, (y0 + h) * src.width * 4);
  return out;
}

const report: string[] = [];

describe.skipIf(!HAVE_FILES)("chart vs. original PDF (Since U Been Gone, chorus excerpt)", () => {
  beforeAll(load);

  it("header positions match within 1 pt", () => {
    const H = CHART.header.baseline;
    expect(ourX("10/24/2026")).toBeCloseTo(pdfWordX("10/24/2026", H), 0);
    const dTitle = ourX("SINCE U BEEN GONE") - pdfWordX("SINCE U BEEN GONE", H);
    const dKey = ourX("(Key of G, BPM=131)") - pdfWordX("(Key of G", H);
    report.push(`header: title x off by ${dTitle.toFixed(2)} pt, key x off by ${dKey.toFixed(2)} pt`);
    expect(Math.abs(dTitle)).toBeLessThan(1);
    expect(Math.abs(dKey)).toBeLessThan(1);
  });

  it("spaces the chorus rows at the rules' row height, with the measured padding to the rules", () => {
    // Original: chorus rule at 510.4, rows at 527.0 + 18.4k, closing rule at 666.1. Rows are now
    // 20 pt when there is room (owner, 2026-11-09: max row height), so the rhythm is checked against the rules.
    const rules = [...ours.matchAll(new RegExp(`<rect x="[\\d.]+" y="([\\d.]+)"[^>]*fill="${CHART.colors.rule}"`, "g"))].map((m) => +m[1]!);
    // Chorus rows only (the fixture's "Repeat Chorus" line follows the closing rule).
    const ourBaselines = [...new Set(ourTexts.filter((t) => t.size === 16 && t.y > 30 && t.y < rules[1]!).map((t) => t.y))].sort((a, b) => a - b);
    expect(ourBaselines).toHaveLength(8);
    expect(ourBaselines[0]! - rules[0]!).toBeCloseTo(CHART.section.padTop + CHART.row.baseline, 1);
    ourBaselines.forEach((y, i) => expect(y - ourBaselines[0]!).toBeCloseTo(i * CHART.row.height, 1));
    expect(rules[1]! - ourBaselines[7]!).toBeCloseTo(CHART.row.height - CHART.row.baseline + CHART.section.padBottom, 1);
  });

  it("colors the Chorus label because a Repeat Chorus follows (blue: the only repeated section)", () => {
    // The original prints it green (colors were by type then); the priority rule makes the first repeated section blue.
    // The 9 pt label in the left column, not the "Chorus" inside the note line.
    expect(ours).toMatch(new RegExp(`<text x="${CHART.section.labelX}" [^>]*font-size="${CHART.section.labelSize}"[^>]*fill="${CHART.repeatColors[0]}">Chorus</text>`));
  });

  it(`header strip pixels differ by at most ${MAX_HEADER_INK_RATIO * 100}% of ink`, () => {
    const a = crop(rasterOriginal(), 0, 24), b = crop(rasterOurs(), 0, 24);
    const diff = new PNG({ width: a.width, height: a.height });
    const mismatched = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
    let ink = 0;
    for (let i = 0; i < a.data.length; i += 4) if (a.data[i]! < 245 || b.data[i]! < 245) ink++;
    const ratio = mismatched / ink;
    report.push(`header strip: ${mismatched} px differ = ${(ratio * 100).toFixed(2)}% of ink`);
    mkdirSync("test/output", { recursive: true });
    writeFileSync("test/output/chart-header-diff.png", PNG.sync.write(diff));
    expect(ratio).toBeLessThanOrEqual(MAX_HEADER_INK_RATIO);
  });

  it("writes side-by-side images of the chorus for review", () => {
    mkdirSync("test/output", { recursive: true });
    writeFileSync("test/output/chart-chorus-original.png", PNG.sync.write(crop(rasterOriginal(), 508, 668)));
    writeFileSync("test/output/chart-chorus-rendered.png", PNG.sync.write(crop(rasterOurs(), 20, 180)));
    expect(true).toBe(true);
  });

  afterAll(() => console.log(report.join("\n")));
});
