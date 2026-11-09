/**
 * Notation images: splitting one image around lyric lines that sit inside
 * it, measuring where its bars and notes are (for the snippet's timeline),
 * and telling the tiny circled plus from the circled times.
 */
import { PNG } from "pngjs";
import type { PdfImage } from "./extract.js";

const dark = (png: PNG, x: number, y: number) => png.data[(y * png.width + x) * 4]! < 160;

/** Rows (pixel y) of the image that are entirely white. */
function blankRows(png: PNG): boolean[] {
  const rows: boolean[] = [];
  for (let y = 0; y < png.height; y++) {
    let blank = true;
    for (let x = 0; x < png.width && blank; x++) if (png.data[(y * png.width + x) * 4]! < 235) blank = false;
    rows.push(blank);
  }
  return rows;
}

function crop(src: PNG, y0: number, y1: number): PNG {
  const out = new PNG({ width: src.width, height: y1 - y0 });
  src.data.copy(out.data, 0, y0 * src.width * 4, y1 * src.width * 4);
  return out;
}

/**
 * Splits an image at the blank bands that hold the given text rows (each a
 * [top, bottom] range in pt). Returns the pieces in order, and the rows that
 * had no blank band to sit in.
 */
export function splitAround(img: PdfImage, rows: [number, number][]): { pieces: PdfImage[]; unsplit: [number, number][] } {
  const ptPerPx = img.h / img.png.height;
  const blank = blankRows(img.png);
  const cuts: [number, number][] = [];
  const unsplit: [number, number][] = [];
  for (const [top, bottom] of rows) {
    const a = Math.max(0, Math.floor((top - img.y) / ptPerPx)), b = Math.min(img.png.height - 1, Math.ceil((bottom - img.y) / ptPerPx));
    // Grow a blank band around the row's middle.
    let m = Math.round((a + b) / 2);
    if (!blank[m]) { let d = 1; while (d < b - a && !blank[m - d] && !blank[m + d]) d++; m = blank[m - d] ? m - d : m + d; }
    if (!blank[m]) { unsplit.push([top, bottom]); continue; }
    let s = m, e = m;
    while (s > 0 && blank[s - 1]) s--;
    while (e < img.png.height - 1 && blank[e + 1]) e++;
    cuts.push([s, e + 1]);
  }
  cuts.sort((p, q) => p[0] - q[0]);
  const pieces: PdfImage[] = [];
  let from = 0;
  for (const [s, e] of [...cuts, [img.png.height, img.png.height] as [number, number]]) {
    if (s - from > 4) pieces.push({ ...img, y: img.y + from * ptPerPx, h: (s - from) * ptPerPx, png: crop(img.png, from, s) });
    from = e;
  }
  return { pieces, unsplit };
}

/**
 * Bars of a notation image: for each bar, x of beat 1 and the bar's width,
 * in pt from the image's left edge. Bar lines are columns inked over the
 * whole staff; beat 1 is the bar's first note column. Returns undefined
 * when no staff is found.
 */
export function measureBars(img: PdfImage): { x: number; width: number }[] | undefined {
  const png = img.png, w = png.width, h = png.height;
  const ptPerPx = img.w / w;
  const rowInk: number[] = [];
  for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) if (dark(png, x, y)) n++; rowInk.push(n); }
  const staffRows = rowInk.map((n, y) => (n > w * 0.5 ? y : -1)).filter((y) => y >= 0);
  if (staffRows.length < 3) return undefined;
  const top = staffRows[0]!, bottom = staffRows[staffRows.length - 1]!;
  const lineRows = new Set(rowInk.map((n, y) => (n > w * 0.3 ? y : -1)).filter((y) => y >= 0));

  const barCols: number[] = [];
  for (let x = 0; x < w; x++) {
    let n = 0;
    for (let y = top; y <= bottom; y++) if (dark(png, x, y)) n++;
    if (n >= (bottom - top + 1) * 0.95) barCols.push(x);
  }
  const bars: number[] = [];
  for (const x of barCols) if (!bars.length || x - bars[bars.length - 1]! > 3) bars.push(x);

  // Note columns: ink inside the staff, ignoring staff lines/beams, bar lines, and thin stems.
  const isBar = new Set(barCols);
  const colInk: number[] = [];
  for (let x = 0; x < w; x++) {
    let n = 0;
    if (!isBar.has(x)) for (let y = top; y <= Math.min(h - 1, bottom + 3); y++) if (!lineRows.has(y) && dark(png, x, y)) n++;
    colInk.push(n);
  }
  const notes: number[] = [];
  let s = -1;
  for (let x = 0; x <= w; x++) {
    const on = x < w && colInk[x]! > 0;
    if (on && s < 0) s = x;
    if (!on && s >= 0) { if (x - s >= 4) notes.push((s + x - 1) / 2); s = -1; }
  }
  // Skip the clef / string-number column at the far left.
  const minNote = (bars[0] ?? 0) + w * 0.025;
  const edges = bars.length && bars[0]! < w * 0.05 ? bars : [0, ...bars];
  if (edges[edges.length - 1]! < w - 5) edges.push(w - 1);

  const segs: { beat1: number; L: number; R: number }[] = [];
  for (let k = 0; k + 1 < edges.length; k++) {
    const L = edges[k]!, R = edges[k + 1]!;
    if (R - L < w * 0.05) continue;
    const inBar = notes.filter((c) => c > L + 2 && c < R - 2 && c > minNote);
    segs.push({ beat1: inBar[0] ?? L + (R - L) * 0.08, L, R });
  }
  if (!segs.length) return undefined;
  return segs.map((sg, k) => {
    const nextBeat1 = segs[k + 1]?.beat1;
    const widthPx = nextBeat1 !== undefined ? nextBeat1 - sg.beat1 : sg.R - sg.L;
    return { x: sg.beat1 * ptPerPx, width: widthPx * ptPerPx };
  });
}

/** Circled plus (only) or circled times (except), from a tiny image. */
export function circledOp(img: PdfImage): "only" | "except" {
  const png = img.png, w = png.width, h = png.height;
  const cx = (w - 1) / 2, cy = (h - 1) / 2, r = Math.min(w, h) * 0.3;
  let cross = 0, diag = 0;
  for (let t = -r; t <= r; t += 0.5) {
    const at = (x: number, y: number) => (dark(png, Math.round(x), Math.round(y)) ? 1 : 0);
    cross += at(cx + t, cy) + at(cx, cy + t);
    diag += at(cx + t * 0.707, cy + t * 0.707) + at(cx + t * 0.707, cy - t * 0.707);
  }
  return cross >= diag ? "only" : "except";
}
