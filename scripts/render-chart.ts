/**
 * Renders a chart JSON to SVG pages, one PNG per page, and a printable PDF
 * with the cover pages first (CLAUDE.md §9: cover and chart are one PDF).
 * Run: npx tsx scripts/render-chart.ts chart.json [outDir] [--no-cover]   (default outDir: preview/charts)
 * Notation images named in the chart are looked up next to the JSON.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { renderChart } from "../src/chart/render.js";
import { renderCover } from "../src/cover/render.js";
import { notationFrom, writePagePngs, writePdf } from "./lib/output.js";

const args = process.argv.slice(2);
const withCover = !args.includes("--no-cover");
const [file, outDir = "preview/charts"] = args.filter((a) => a !== "--no-cover");
if (!file) throw new Error("usage: render-chart <chart.json> [outDir] [--no-cover]");
const chart = JSON.parse(readFileSync(file, "utf8"));
const imageDir = dirname(file);
const { pages, warnings } = renderChart(chart, { notation: notationFrom(imageDir) });
const cover = withCover ? renderCover(chart) : { pages: [], warnings: [] };
mkdirSync(outDir, { recursive: true });
const name = basename(file, ".json");
pages.forEach((svg, i) => writeFileSync(join(outDir, `${name}-p${i + 1}.svg`), svg));
cover.pages.forEach((svg, i) => writeFileSync(join(outDir, `${name}-cover-p${i + 1}.svg`), svg));
writePagePngs(pages, imageDir, outDir, name);
writePagePngs(cover.pages, imageDir, outDir, `${name}-cover`);
writePdf([...cover.pages, ...pages], imageDir, join(outDir, `${name}.pdf`));
for (const w of [...cover.warnings, ...warnings]) console.warn("warning:", w);
const coverNote = cover.pages.length ? ` (${cover.pages.length} cover page(s) first: ${name}-cover-p*.svg/png)` : "";
console.log(`wrote ${pages.length} Song Chart page(s) to ${outDir}: ${name}-p*.svg, ${name}-p*.png, ${name}.pdf${coverNote}`);
