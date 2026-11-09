/** Rasterizes an SVG with resvg and the bundled fonts only. Run: npx tsx scripts/svg-to-png.ts in.svg out.png [widthPx] */
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

export const FONT_FILES = [
  "assets/fonts/Arimo_400Regular.ttf",
  "assets/fonts/Arimo_700Bold.ttf",
  "assets/fonts/Arimo_400Regular_Italic.ttf",
  "assets/fonts/Carlito_400Regular.ttf",
  "assets/fonts/Carlito_700Bold.ttf",
];

const [input, output, width = "1224"] = process.argv.slice(2);
if (!input || !output) throw new Error("usage: svg-to-png <in.svg> <out.png> [widthPx]");
const png = new Resvg(readFileSync(input, "utf8"), {
  fitTo: { mode: "width", value: Number(width) },
  background: "white",
  font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: "Arimo" },
}).render().asPng();
writeFileSync(output, png);
console.log(`wrote ${output}`);
