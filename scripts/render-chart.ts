/** Renders a chart JSON to SVG pages next to it (or into an output dir). Run: npx tsx scripts/render-chart.ts chart.json [outDir] */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { renderChart } from "../src/chart/render.js";

const [file, outDir = "preview/charts"] = process.argv.slice(2);
if (!file) throw new Error("usage: render-chart <chart.json> [outDir]");
const chart = JSON.parse(readFileSync(file, "utf8"));
const { pages, warnings } = renderChart(chart);
mkdirSync(outDir, { recursive: true });
const name = basename(file, ".json");
pages.forEach((svg, i) => writeFileSync(join(outDir, `${name}-p${i + 1}.svg`), svg));
for (const w of warnings) console.warn("warning:", w);
console.log(`wrote ${pages.length} page(s) to ${outDir}`);
