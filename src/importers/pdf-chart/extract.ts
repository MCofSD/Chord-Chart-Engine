/**
 * Raw content of a chart PDF: every character with its position, size, font
 * and color; every image (composited on white, as RGBA); and every section
 * rule (a long, thin filled bar). No interpretation happens here.
 */
import * as mupdf from "mupdf";
import { PNG } from "pngjs";
import { RULES } from "../../rules/index.js";

export interface Glyph {
  /** One character; " " for the PDF's own spaces (they mark word breaks). */
  ch: string;
  /** Left and right edge of the glyph box, pt. */
  x0: number;
  x1: number;
  /** Baseline, pt from the page top. */
  y: number;
  size: number;
  font: string;
  bold: boolean;
  italic: boolean;
  /** "#RRGGBB" */
  color: string;
  page: number;
}

export interface PdfImage {
  page: number;
  /** Box on the page, pt. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Pixels, RGBA, composited on white. */
  png: PNG;
}

export interface PdfPage {
  width: number;
  height: number;
  glyphs: Glyph[];
  images: PdfImage[];
  /** y of each section rule. */
  rules: number[];
}

const hex = (c: ArrayLike<number>) => {
  const v = c.length === 1 ? [c[0]!, c[0]!, c[0]!] : [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];
  return "#" + v.map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
};

function pathBounds(path: mupdf.Path, m: mupdf.Matrix): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => {
    const X = m[0] * x + m[2] * y + m[4], Y = m[1] * x + m[3] * y + m[5];
    x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
  };
  path.walk({
    moveTo: add, lineTo: add,
    curveTo: (a: number, b: number, c: number, d: number, e: number, f: number) => { add(a, b); add(c, d); add(e, f); },
    closePath: () => {},
  });
  return [x0, y0, x1, y1];
}

/** An image's pixels composited on white (soft masks applied). */
function toRgba(image: mupdf.Image, mirrorX: boolean): PNG {
  const base = PNG.sync.read(Buffer.from(image.toPixmap().asPNG()));
  const maskImg = image.getMask();
  const mask = maskImg ? PNG.sync.read(Buffer.from(maskImg.toPixmap().asPNG())) : undefined;
  const { width: w, height: h } = base;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x, q = y * w + (mirrorX ? w - 1 - x : x);
      const a = mask && mask.width === w && mask.height === h ? mask.data[p * 4]! / 255 : base.data[p * 4 + 3]! / 255;
      for (let c = 0; c < 3; c++) out.data[q * 4 + c] = Math.round(base.data[p * 4 + c]! * a + 255 * (1 - a));
      out.data[q * 4 + 3] = 255;
    }
  }
  return out;
}

export function extractPdf(bytes: Uint8Array): PdfPage[] {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const I = RULES.import;
  const pages: PdfPage[] = [];
  for (let p = 0; p < doc.countPages(); p++) {
    const page = doc.loadPage(p);
    const [bx0, by0, bx1, by1] = page.getBounds();
    const glyphs: Glyph[] = [];
    page.toStructuredText("preserve-whitespace").walk({
      onChar(ch: string, origin: mupdf.Point, font: mupdf.Font, size: number, quad: mupdf.Quad, color: mupdf.Color) {
        if (/^\s$/.test(ch) && ch !== " " && ch !== "\t") return;
        if (ch === "\t") ch = " ";
        const name = font.getName().replace(/^[A-Z]{6}\+/, "");
        glyphs.push({
          ch, x0: Math.min(quad[0], quad[4]), x1: Math.max(quad[2], quad[6]), y: origin[1], size,
          font: name, bold: font.isBold() || /Bold/i.test(name), italic: font.isItalic() || /Italic|Oblique/i.test(name),
          color: hex(color as number[]), page: p,
        });
      },
    });
    const images: PdfImage[] = [];
    const rules: number[] = [];
    const rule = (path: mupdf.Path, ctm: mupdf.Matrix) => {
      const [x0, y0, x1, y1] = pathBounds(path, ctm);
      if (x1 - x0 >= I.ruleMinWidth && y1 - y0 <= I.ruleMaxHeight) rules.push((y0 + y1) / 2);
    };
    const dev = new mupdf.Device({
      fillPath: (path: mupdf.Path, _eo: boolean, ctm: mupdf.Matrix) => rule(path, ctm),
      strokePath: (path: mupdf.Path, _s: mupdf.StrokeState, ctm: mupdf.Matrix) => rule(path, ctm),
      fillImage: (image: mupdf.Image, ctm: mupdf.Matrix) => {
        const [a, , , d, e, f] = ctm;
        images.push({ page: p, x: Math.min(e, e + a), y: Math.min(f, f + d), w: Math.abs(a), h: Math.abs(d), png: toRgba(image, a < 0) });
      },
    });
    page.run(dev, mupdf.Matrix.identity);
    dev.close();
    rules.sort((a, b) => a - b);
    pages.push({ width: bx1 - bx0, height: by1 - by0, glyphs, images, rules: rules.filter((y, i) => i === 0 || y - rules[i - 1]! > 2) });
  }
  return pages;
}
