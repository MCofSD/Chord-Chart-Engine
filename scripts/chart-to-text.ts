/**
 * Writes a chart JSON as chart text (the editor's format), or the reverse.
 *
 * Run: npm run chart-to-text -- <chart.json> [out.chart.txt]
 *      npm run chart-to-text -- <chart.chart.txt> [out.json]   (text -> JSON)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseChartText, writeChartText } from "../src/text-format/index.js";
import type { Chart } from "../src/model/chart.js";

const [input, output] = process.argv.slice(2);
if (!input) throw new Error("usage: npm run chart-to-text -- <chart.json | chart.txt> [output]");
const src = readFileSync(input, "utf8");
if (input.endsWith(".json")) {
  const text = writeChartText(JSON.parse(src) as Chart);
  const out = output ?? input.replace(/\.json$/, ".chart.txt");
  writeFileSync(out, text);
  console.log(`wrote ${out}`);
} else {
  const { chart, problems } = parseChartText(src);
  for (const p of problems) console.log(`line ${p.line}: ${p.message}`);
  const out = output ?? input.replace(/(\.chart)?\.txt$/, ".json");
  writeFileSync(out, JSON.stringify(chart, null, 2) + "\n");
  console.log(`wrote ${out}`);
}
