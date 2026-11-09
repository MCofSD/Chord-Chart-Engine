/**
 * Visual comparison helpers: rasterize a Corel original and our render with
 * resvg (bundled Arimo only, no system fonts), align both on the grid frame at
 * the same R in pixels, and diff with pixelmatch.
 */
import { readFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { decodeSvgBytes } from "../src/importers/corel-svg/decode.js";
import { importCorelSvg, measureCorelGrid } from "../src/importers/corel-svg/index.js";
import { diagramGeometry, renderDiagram } from "../src/diagram/render.js";
import { TOKENS } from "../src/diagram/tokens.js";

export const FONT_FILES = [
  "assets/fonts/Arimo_400Regular.ttf",
  "assets/fonts/Arimo_700Bold.ttf",
  "assets/fonts/Arimo_400Regular_Italic.ttf",
];

/** Pixels per R used for comparisons (about 230 dpi at 100% cover scale). */
export const PX_PER_R = 60;
/** pixelmatch per-pixel color threshold (0..1). */
export const PIXEL_THRESHOLD = 0.1;

export interface Raster { width: number; height: number; data: Buffer }

export function rasterize(svg: string, widthPx: number): Raster {
  const r = new Resvg(svg, {
    fitTo: { mode: "width", value: Math.round(widthPx) },
    background: "white",
    font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: "Arimo", sansSerifFamily: "Arimo" },
  }).render();
  return { width: r.width, height: r.height, data: Buffer.from(r.pixels) };
}

/** Corel SVGs name 'Arial'; point them at Arimo so both sides use the same glyphs. */
const withArimo = (svg: string) => svg.replace(/'Arial'|"Arial"/g, "'Arimo'");

/** White canvas of the comparison window with `src` pasted so its grid frame lands at (fx, fy). */
function place(src: Raster, frameX: number, frameY: number, win: { w: number; h: number; fx: number; fy: number }): Raster {
  const out = Buffer.alloc(win.w * win.h * 4, 255);
  const dx = Math.round(win.fx - frameX), dy = Math.round(win.fy - frameY);
  for (let y = 0; y < src.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= win.h) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= win.w) continue;
      src.data.copy(out, (ty * win.w + tx) * 4, (y * src.width + x) * 4, (y * src.width + x) * 4 + 4);
    }
  }
  return { width: win.w, height: win.h, data: out };
}

const isInk = (d: Buffer, i: number) => d[i]! < 245 || d[i + 1]! < 245 || d[i + 2]! < 245;

export interface Comparison {
  name: string;
  original: Raster;
  rendered: Raster;
  diff: Raster;
  mismatched: number;
  inkPixels: number;
  /** mismatched / pixels inked in either image. */
  inkRatio: number;
  /** mismatched / all pixels in the window. */
  windowRatio: number;
}

export function compareSample(name: string): Comparison {
  const bytes = readFileSync(`samples/${name}.svg`);
  const grid = measureCorelGrid(bytes);
  const scale = PX_PER_R / grid.R;
  const original = rasterize(withArimo(decodeSvgBytes(bytes)), (grid.viewBox[2] ?? 0) * scale);

  const { voicing } = importCorelSvg(bytes);
  const g = diagramGeometry();
  // The Corel originals print the letter "b", so compare in letter mode.
  const ours = rasterize(renderDiagram(voicing, { accidentals: "letter" }), (g.width / 100) * PX_PER_R);

  // Window: the whole of our layout box, with our grid frame as the anchor.
  const win = {
    w: Math.round((g.width / 100) * PX_PER_R),
    h: Math.round((g.height / 100) * PX_PER_R),
    fx: (g.gridLeft / 100) * PX_PER_R,
    fy: (g.gridTop / 100) * PX_PER_R,
  };
  const a = place(original, grid.left * scale, grid.top * scale, win);
  const b = place(ours, win.fx, win.fy, win);

  const diff = Buffer.alloc(win.w * win.h * 4);
  const mismatched = pixelmatch(a.data, b.data, diff, win.w, win.h, { threshold: PIXEL_THRESHOLD });
  let inkPixels = 0;
  for (let i = 0; i < a.data.length; i += 4) if (isInk(a.data, i) || isInk(b.data, i)) inkPixels++;
  return {
    name,
    original: a,
    rendered: b,
    diff: { width: win.w, height: win.h, data: diff },
    mismatched,
    inkPixels,
    inkRatio: mismatched / inkPixels,
    windowRatio: mismatched / (win.w * win.h),
  };
}

export function toPng(r: Raster): Buffer {
  const png = new PNG({ width: r.width, height: r.height });
  r.data.copy(png.data);
  return PNG.sync.write(png);
}

export { TOKENS };
