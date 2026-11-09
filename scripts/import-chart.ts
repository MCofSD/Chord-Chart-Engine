/**
 * Imports a legacy chart PDF into chart JSON, for human review.
 *
 * Run: npm run import-chart -- "<chart.pdf>" [outDir] [--force]
 * Default outDir: local/imports/<name> (gitignored: charts contain copyrighted lyrics).
 * It never overwrites an existing chart JSON unless --force is given, so
 * hand-edited charts are safe.
 *
 * Writes:
 *   <name>.json          the chart (src/model/chart.ts), snippet images next to it
 *   review.txt           everything the importer was unsure of, with where it is
 *   <name>-p<N>.svg      our rendering of the imported chart
 *   compare-p<N>.png     original page (left) next to our rendering (right)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import * as mupdf from "mupdf";
import { PNG } from "pngjs";
import { Resvg } from "@resvg/resvg-js";
import { importChartPdf } from "../src/importers/pdf-chart/index.js";
import { renderChart } from "../src/chart/render.js";

const FONTS = ["Arimo_400Regular", "Arimo_700Bold", "Arimo_400Regular_Italic", "Carlito_400Regular", "Carlito_700Bold"].map((f) => `assets/fonts/${f}.ttf`);
const WIDTH = 918; // px per page in the comparison (1.5 x 612 pt)

const args = process.argv.slice(2);
const force = args.includes("--force");
const [pdfPath, outArg] = args.filter((a) => a !== "--force");
if (!pdfPath) throw new Error('usage: npm run import-chart -- "<chart.pdf>" [outDir] [--force]');
const fileName = basename(pdfPath);
const name = fileName.replace(/\.pdf$/i, "").replace(/ - .*/, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
const outDir = outArg ?? join("local", "imports", name);
if (existsSync(join(outDir, `${name}.json`)) && !force) {
  console.error(`${join(outDir, `${name}.json`)} already exists; not overwriting it. Pass another outDir, or --force to replace it.`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
// Clear this tool's own page outputs from an earlier run (a page count may have changed).
// (The name is a slug of letters, digits and dashes, so it needs no escaping.)
const pageFile = new RegExp(`^(compare-p\\d+\\.png|${name}-p\\d+\\.svg)$`);
for (const f of readdirSync(outDir)) if (pageFile.test(f)) rmSync(join(outDir, f));

const bytes = readFileSync(pdfPath);
const { chart, review, assets } = importChartPdf(bytes, { fileName });
for (const a of assets) writeFileSync(join(outDir, a.name), PNG.sync.write(a.png));
writeFileSync(join(outDir, `${name}.json`), JSON.stringify(chart, null, 2) + "\n");

const { pages, warnings } = renderChart(chart);
const lines = [
  `Import review: ${fileName}`,
  `${review.length} item(s) to check. Renderer warnings: ${warnings.length}.`,
  "",
  ...review.map((r) => `- ${r.where}: ${r.message}`),
  ...(warnings.length ? ["", "Renderer warnings:", ...warnings.map((w) => `- ${w}`)] : []),
];
writeFileSync(join(outDir, "review.txt"), lines.join("\n") + "\n");

// Side-by-side comparison, one image per page.
const doc = mupdf.Document.openDocument(bytes, "application/pdf");
const pageCount = Math.max(doc.countPages(), pages.length);
for (let i = 0; i < pageCount; i++) {
  const left = i < doc.countPages()
    ? PNG.sync.read(Buffer.from(doc.loadPage(i).toPixmap(mupdf.Matrix.scale(WIDTH / 612, WIDTH / 612), mupdf.ColorSpace.DeviceRGB, false, true).asPNG()))
    : undefined;
  let right: PNG | undefined;
  if (i < pages.length) {
    const svg = pages[i]!.replace(/href="([^"]+\.png)"/g, (_m, f: string) => `href="data:image/png;base64,${readFileSync(join(outDir, f)).toString("base64")}"`);
    writeFileSync(join(outDir, `${name}-p${i + 1}.svg`), pages[i]!);
    right = PNG.sync.read(new Resvg(svg, { fitTo: { mode: "width", value: WIDTH }, background: "white", font: { loadSystemFonts: false, fontFiles: FONTS, defaultFontFamily: "Arimo" } }).render().asPng());
  }
  const h = Math.max(left?.height ?? 0, right?.height ?? 0), gutter = 24;
  const out = new PNG({ width: WIDTH * 2 + gutter, height: h });
  out.data.fill(255);
  for (let y = 0; y < out.height; y++) for (let x = WIDTH; x < WIDTH + gutter; x++) out.data.fill(200, (y * out.width + x) * 4, (y * out.width + x) * 4 + 3);
  const blit = (src: PNG | undefined, dx: number) => {
    if (!src) return;
    for (let y = 0; y < src.height; y++) src.data.copy(out.data, (y * out.width + dx) * 4, y * src.width * 4, y * src.width * 4 + Math.min(src.width, WIDTH) * 4);
  };
  blit(left, 0);
  blit(right, WIDTH + gutter);
  writeFileSync(join(outDir, `compare-p${i + 1}.png`), PNG.sync.write(out));
}
console.log(`imported ${fileName} -> ${outDir}`);
console.log(`${chart.sections.length} sections, ${assets.length} notation image(s), ${review.length} review item(s), ${warnings.length} renderer warning(s); see review.txt and compare-p*.png`);
