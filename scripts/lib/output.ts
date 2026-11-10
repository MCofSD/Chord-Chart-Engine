/**
 * Turning rendered chart pages (SVG strings) into files people can open:
 * PNG images and a printable PDF.
 *
 * The PDF is an interim export: each page is rasterized at 300 dpi (sharp in
 * print, but the text is not selectable) and wrapped in a US Letter PDF with
 * mupdf, which the project already uses. CLAUDE.md §7 leaves the final PDF
 * stack open (headless Chromium is the candidate), so this is not that choice.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as mupdf from "mupdf";
import { PNG } from "pngjs";
import { Resvg } from "@resvg/resvg-js";
import { CHART } from "../../src/chart/tokens.js";
import type { NotationBlock } from "../../src/model/chart.js";
import { renderNotation, type NotationRender } from "../../src/notation/render.js";

/** Draws a chart's notation blocks from the MusicXML files next to it (for renderChart's `notation` option). */
export function notationFrom(dir: string): (block: NotationBlock, width: number) => NotationRender {
  const cache = new Map<string, NotationRender>();
  return (block, width) => {
    const staves = block.staves ?? (CHART.notation.defaultStaves as NonNullable<NotationBlock["staves"]>);
    const key = JSON.stringify([block.src, staves, block.bars, width]);
    let r = cache.get(key);
    if (!r) {
      r = renderNotation(new Uint8Array(readFileSync(join(dir, block.src))), { staves, width, ...(block.bars ? { bars: block.bars } : {}) });
      cache.set(key, r);
    }
    return r;
  };
}

const FONTS = ["Arimo_400Regular", "Arimo_700Bold", "Arimo_400Regular_Italic", "Carlito_400Regular", "Carlito_700Bold",
  "Carlito_400Regular_Italic", "Carlito_700Bold_Italic"].map((f) => `assets/fonts/${f}.ttf`).concat(["TeXGyreCursor_400Regular", "TeXGyreCursor_700Bold"].map((f) => `assets/fonts/${f}.otf`));

/** Pixel widths: on-screen images at 150 dpi, the PDF at 300 dpi. */
export const SCREEN_WIDTH = Math.round((CHART.page.width / 72) * 150);
const PRINT_WIDTH = Math.round((CHART.page.width / 72) * 300);

/** Inlines the notation images a page refers to (they sit next to the chart JSON) so rasterizers can see them. */
function inlineImages(svg: string, dir: string): string {
  return svg.replace(/href="([^"]+\.png)"/g, (m, f: string) => {
    const file = join(dir, f);
    if (!existsSync(file)) { console.warn(`warning: image ${file} not found; left blank`); return m; }
    return `href="data:image/png;base64,${readFileSync(file).toString("base64")}"`;
  });
}

/** One page as PNG pixels, `width` pixels wide. */
export function rasterize(svg: string, imageDir: string, width: number): PNG {
  const png = new Resvg(inlineImages(svg, imageDir), {
    fitTo: { mode: "width", value: width },
    background: "white",
    font: { loadSystemFonts: false, fontFiles: FONTS, defaultFontFamily: "Arimo" },
  }).render().asPng();
  return PNG.sync.read(png);
}

/** Writes <name>-p<N>.png for each page; returns the pages' pixels. */
export function writePagePngs(pages: string[], imageDir: string, outDir: string, name: string): PNG[] {
  return pages.map((svg, i) => {
    const png = rasterize(svg, imageDir, SCREEN_WIDTH);
    writeFileSync(join(outDir, `${name}-p${i + 1}.png`), PNG.sync.write(png));
    return png;
  });
}

/** Writes all pages as one US Letter PDF (300 dpi images). */
export function writePdf(pages: string[], imageDir: string, file: string): void {
  const buf = new mupdf.Buffer();
  const writer = new mupdf.DocumentWriter(buf, "pdf", "compress");
  const { width: w, height: h } = CHART.page;
  for (const svg of pages) {
    const png = PNG.sync.write(rasterize(svg, imageDir, PRINT_WIDTH));
    const dev = writer.beginPage([0, 0, w, h]);
    dev.fillImage(new mupdf.Image(png), [w, 0, 0, h, 0, 0], 1);
    writer.endPage();
  }
  writer.close();
  writeFileSync(file, buf.asUint8Array());
}
