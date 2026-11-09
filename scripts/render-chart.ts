/**
 * Renders a chart JSON to SVG pages, one PNG per page, and a printable PDF.
 * Run: npx tsx scripts/render-chart.ts chart.json [outDir]   (default outDir: preview/charts)
 * Notation images named in the chart are looked up next to the JSON.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { renderChart } from "../src/chart/render.js";
import { writePagePngs, writePdf } from "./lib/output.js";

const [file, outDir = "preview/charts"] = process.argv.slice(2);
if (!file) throw new Error("usage: render-chart <chart.json> [outDir]");
const chart = JSON.parse(readFileSync(file, "utf8"));
const { pages, warnings } = renderChart(chart);
mkdirSync(outDir, { recursive: true });
const name = basename(file, ".json");
const imageDir = dirname(file);
pages.forEach((svg, i) => writeFileSync(join(outDir, `${name}-p${i + 1}.svg`), svg));
writePagePngs(pages, imageDir, outDir, name);
writePdf(pages, imageDir, join(outDir, `${name}.pdf`));
for (const w of warnings) console.warn("warning:", w);
console.log(`wrote ${pages.length} page(s) to ${outDir}: ${name}-p*.svg, ${name}-p*.png, ${name}.pdf`);
