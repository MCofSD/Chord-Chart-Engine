/**
 * Builds preview/index.html: the four samples rendered from data at cover
 * scales (100%, 65%, 60%), next to the Corel originals and resvg rasters.
 *
 * Run: npm run preview, then open preview/index.html in a browser.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { importCorelSvg } from "../src/importers/corel-svg/index.js";
import { renderDiagram } from "../src/diagram/render.js";
import type { Voicing } from "../src/model/voicing.js";
import { compareSample, toPng } from "../test/visual.js";
import * as mupdf from "mupdf";
import { PNG } from "pngjs";
import { renderChart } from "../src/chart/render.js";
import { notationFrom, rasterize } from "./lib/output.js";
import type { Chart } from "../src/model/chart.js";
import { renderCover } from "../src/cover/render.js";
import { LIBRARY } from "../src/voicings/index.js";
import { chordLabel } from "../src/model/voicing.js";

/** Placeholder notation image for the demo chart: a 5-line staff. */
function placeholderStaff(): Buffer {
  const w = 1000, h = 116, png = new PNG({ width: w, height: h });
  png.data.fill(255);
  for (let line = 0; line < 5; line++) {
    const y = 40 + line * 14;
    for (let x = 0; x < w; x++) for (let t = 0; t < 2; t++) png.data.fill(90, ((y + t) * w + x) * 4, ((y + t) * w + x) * 4 + 3);
  }
  for (const x of [0, 498, 998]) for (let y = 40; y < 98; y++) png.data.fill(90, (y * w + x) * 4, (y * w + x) * 4 + 3), png.data.fill(90, (y * w + x + 1) * 4, (y * w + x + 1) * 4 + 3);
  return PNG.sync.write(png);
}

/** One page of the original PDF, cropped to [y0, y1] pt, as PNG. */
function pdfCrop(file: string, pageNo: number, y0: number, y1: number, scale = 2): Buffer {
  const doc = mupdf.Document.openDocument(readFileSync(file), "application/pdf");
  const pix = doc.loadPage(pageNo - 1).toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
  const full = PNG.sync.read(Buffer.from(pix.asPNG()));
  const top = Math.round(y0 * scale), h = Math.round((y1 - y0) * scale);
  const out = new PNG({ width: full.width, height: h });
  full.data.copy(out.data, 0, top * full.width * 4, (top + h) * full.width * 4);
  return PNG.sync.write(out);
}

// Copyrighted chart and lyric excerpt: gitignored (public repo), present only on the owner's machine.
const SUBG_PDF = "samples/Since U Been Gone - Kelly Clarkson (2004).pdf";
const SUBG_FIXTURE = "test/fixtures/charts/subg-chorus.json";

function chartSection(): string {
  writeFileSync("preview/demo-snippet.png", placeholderStaff());
  const demo: Chart = JSON.parse(readFileSync("test/fixtures/charts/demo.json", "utf8"));
  const demoPages = renderChart(demo);
  const page = (svg: string) => `<div class="page">${svg.replace('width="8.5in" height="11in"', 'width="100%"')}</div>`;
  const warn = demoPages.warnings.length ? `<p>Warnings: ${demoPages.warnings.join("; ")}</p>` : "";
  // Native notation (MusicXML drawn by alphaTab), with a made-up riff.
  const nDemo: Chart = JSON.parse(readFileSync("test/fixtures/charts/notation-demo.json", "utf8"));
  const nPages = renderChart(nDemo, { notation: notationFrom("test/fixtures/charts") });
  const demoHtml = `<h2>Chart renderer</h2>
<p>Demo chart with made-up lyrics, using every mark the renderer supports (the notation image is a placeholder staff).</p>${warn}
<div class="pages">${demoPages.pages.map(page).join("")}</div>
<h2>Native notation</h2>
<p>A made-up riff stored as MusicXML and drawn by the program: tab in the intro, standard notation and tab in the verse. Chord names and the lyric line below sit on the notation's real beats.</p>${nPages.warnings.length ? `<p>Warnings: ${nPages.warnings.join("; ")}</p>` : ""}
<div class="pages">${nPages.pages.map(page).join("")}</div>`;
  if (!existsSync(SUBG_PDF) || !existsSync(SUBG_FIXTURE)) return demoHtml;
  writeFileSync("preview/png/subg-chorus-original.png", pdfCrop(SUBG_PDF, 1, 0, 668));
  const excerpt: Chart = JSON.parse(readFileSync(SUBG_FIXTURE, "utf8"));
  const excerptPage = renderChart(excerpt).pages[0]!;
  return `${demoHtml}
<h2>Chart vs. original (Since U Been Gone, chorus excerpt)</h2>
<p>Chords are pinned to syllables, so horizontal positions differ from the tab-stop layout of the original by design. Fonts, sizes, colors and vertical spacing should match.</p>
<div class="pages"><div class="page"><img src="png/subg-chorus-original.png" alt="Original PDF, page 1 top to chorus" style="width:100%"><p class="cap">Original PDF (page 1; chorus at the bottom)</p></div>
${page(excerptPage).replace("</div>", '<p class="cap">Rendered from data (chorus only)</p></div>')}</div>`;
}

/** Covers for made-up charts with different numbers of chords, to show the layout solver's choices. */
function coverSection(): string {
  const names = [...new Set(LIBRARY.map((e) => chordLabel(e.voicing.chord)))];
  const pick = (n: number) => Array.from({ length: n }, (_, i) => names[(i * 37) % names.length]!);
  const demos: [number, string, Chart["cover"]][] = [
    [4, "4 chords", { diagrams: [{ chord: "Ab", note: "for Bridge only" }, { chord: "Bb" }, { chord: "Eb" }, { chord: "Fm" }] }],
    [9, "9 chords with an alternate group", { diagrams: [...pick(7).map((chord) => ({ chord })), { chord: "Cadd9", group: "alternate" as const }, { chord: "G", group: "alternate" as const }] }],
    [30, "30 chords", { diagrams: pick(30).map((chord) => ({ chord })) }],
    [42, "42 chords", { diagrams: pick(42).map((chord) => ({ chord })) }],
    [60, "60 chords (overflow to page 2)", { diagrams: pick(60).map((chord) => ({ chord })) }],
  ];
  const parts = demos.map(([n, label, cover]) => {
    const chart: Chart = { meta: { title: "Song Title", artist: "Artist", year: 2026, key: "G", date: "2026-11-09", tuning: "Eb Standard Tuning" }, sections: [], ...(cover ? { cover } : {}) };
    const r = renderCover(chart);
    const imgs = r.pages.map((svg, i) => {
      const file = `png/cover-${n}-p${i + 1}.png`;
      writeFileSync(`preview/${file}`, PNG.sync.write(rasterize(svg, ".", 918)));
      return `<div class="page"><img src="${file}" alt="Cover page ${i + 1}, ${label}" style="width:100%"><p class="cap">Page ${i + 1}</p></div>`;
    });
    return `<h3>${label}: ${r.layout.columns} columns at ${Math.round(r.layout.scale * 100)}%</h3><div class="pages">${imgs.join("")}</div>`;
  });
  return `<h2>Cover pages</h2>
<p>Made-up charts. The solver picks the fewest columns that fit (default 5, 4 when the last row is fuller), the largest scale, and moves the Legend to page 2 from 7 columns. Diagrams come from the starter voicing library (to be reviewed).</p>
${parts.join("")}`;
}

const NAMES = ["Fm", "Eb", "Bb", "Ab"];
const SCALES = [1, 0.65, 0.6];
mkdirSync("preview/png", { recursive: true });

const voicings = NAMES.map((name) => ({ name, ...importCorelSvg(readFileSync(`samples/${name}.svg`)) }));

const scaleRows = SCALES.map((s) => {
  const cells = voicings.map(({ name, voicing }) => `<figure>${renderDiagram(voicing, { scale: s })}<figcaption>${name}</figcaption></figure>`);
  return `<section><h2>${Math.round(s * 100)}% cover scale</h2><div class="panel">${cells.join("")}</div></section>`;
}).join("\n");

// Chord-name examples with flats and sharps. The shape is Bb's, as a placeholder.
const bb = voicings.find((v) => v.name === "Bb")!.voicing;
const NAME_EXAMPLES: [string, Voicing["chord"]][] = [
  ["Eb", { root: "E", accidental: "b" }],
  ["F#m", { root: "F", accidental: "#", quality: "m" }],
  ["Bbm7/C", { root: "B", accidental: "b", quality: "m7", bass: "C" }],
  ["C7(b9b13)", { root: "C", quality: "7(b9b13)" }],
  ["Gm7(b5b9)", { root: "G", quality: "m7(b5b9)" }],
  ["Ab/Eb", { root: "A", accidental: "b", bass: "Eb" }],
  ["C#7(#9)", { root: "C", accidental: "#", quality: "7(#9)" }],
  ["G7(b9)/F", { root: "G", quality: "7(b9)", bass: "F" }],
];
const nameRow = (mode: "symbol" | "letter") =>
  NAME_EXAMPLES.map(([label, chord]) => `<figure>${renderDiagram({ ...bb, chord }, { accidentals: mode })}<figcaption>${label}</figcaption></figure>`).join("");
const nameSection = `<section><h2>Flats and sharps (shape is a placeholder)</h2>
<p>Symbols (new default):</p><div class="panel">${nameRow("symbol")}</div>
<p>Letters (as in the Corel files), for comparison:</p><div class="panel">${nameRow("letter")}</div></section>`;

const compareRows = voicings
  .map(({ name, voicing, review }) => {
    const c = compareSample(name);
    writeFileSync(`preview/png/${name}-rendered.png`, toPng(c.rendered));
    writeFileSync(`preview/png/${name}-original.png`, toPng(c.original));
    writeFileSync(`preview/png/${name}-diff.png`, toPng(c.diff));
    const flags = review.length ? `<ul>${review.map((r) => `<li>${r.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</li>`).join("")}</ul>` : "<p>No review flags.</p>";
    return `<tr>
  <th scope="row">${name}</th>
  <td><img src="../samples/${name}.svg" alt="${name} Corel original" style="width:1.39in"></td>
  <td>${renderDiagram(voicing)}</td>
  <td><img src="png/${name}-original.png" alt=""><img src="png/${name}-rendered.png" alt=""></td>
  <td><img src="png/${name}-diff.png" alt="${name} pixel diff"><br>${(c.inkRatio * 100).toFixed(2)}% of ink differs</td>
  <td class="flags">${flags}</td>
</tr>`;
  })
  .join("\n");

const font = (file: string, weight: number, style: string) =>
  `@font-face{font-family:Arimo;src:url("../assets/fonts/${file}") format("truetype");font-weight:${weight};font-style:${style}}`;

writeFileSync(
  "preview/index.html",
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Diagram preview</title>
<style>
${font("Arimo_400Regular.ttf", 400, "normal")}
${font("Arimo_700Bold.ttf", 700, "normal")}
${font("Arimo_400Regular_Italic.ttf", 400, "italic")}
@font-face{font-family:Carlito;src:url("../assets/fonts/Carlito_400Regular.ttf") format("truetype");font-weight:400}
@font-face{font-family:Carlito;src:url("../assets/fonts/Carlito_700Bold.ttf") format("truetype");font-weight:700}
.pages{display:flex;flex-wrap:wrap;gap:16px}.page{width:min(100%,612px);border:1px solid #c9d2de;background:#fff}.page svg{display:block}.cap{font-size:13px;margin:6px 8px}
body{margin:0;padding:24px 16px;background:#fff;color:#1c2430;font:15px/1.5 Arimo,Arial,sans-serif}
h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px}h3{font-size:15px;margin:20px 0 8px}
.panel{display:flex;flex-wrap:wrap;gap:12px 16px;align-items:flex-end;background:#dce9f5;padding:14px}
figure{margin:0;text-align:center}figcaption{font-size:12px}
table{border-collapse:collapse;margin-top:8px}th,td{border:1px solid #c9d2de;padding:8px;vertical-align:top;text-align:left}
td img{max-width:200px;display:inline-block;margin-right:4px;vertical-align:top}
.flags{font-size:13px;max-width:320px}.flags ul{margin:0;padding-left:18px}
.wrap{overflow-x:auto}
</style>
</head>
<body>
<h1>Chord diagram preview</h1>
<p>Generated by <code>npm run preview</code>. Every diagram here is rendered from the JSON the importer produced.</p>
${scaleRows}
${nameSection}
<h2>Side by side with the Corel originals (100%)</h2>
<div class="wrap"><table>
<tr><th></th><th>Corel original (browser)</th><th>Rendered (browser)</th><th>resvg: original, rendered</th><th>Pixel diff</th><th>Review flags</th></tr>
${compareRows}
</table></div>
${chartSection()}
${coverSection()}
</body>
</html>
`,
);
console.log("wrote preview/index.html");
