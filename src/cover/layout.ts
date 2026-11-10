/**
 * Cover layout solver (CLAUDE.md §2 item 2, §9): chooses the column count and
 * scale from the number of diagrams, places them in the CHORDS panel, and
 * decides where the Legend goes. Pure: numbers in, positions out. All sizes
 * come from rules/chart-rules.json ("cover").
 *
 * Owner (2026-11-09): the fewest columns that fit, default 5, minimum 4,
 * aiming for even use of the white space. So:
 * - 5 columns if they fit, else 6, 7, 8; each at the largest scale that fits.
 * - 4 instead of 5 when that leaves fewer empty places in the last row.
 * - 4 to 6 columns sit beside the Legend on page 1; 7 and 8 use the full
 *   width, and the Legend moves to page 2.
 * - Past 8 columns' capacity, the rest continue on page 2 ("CHORDS (con't.)")
 *   beside the Legend, and page 1 says "Continued at back of page".
 */
import { RULES } from "../rules/index.js";
import { TOKENS } from "../diagram/tokens.js";

const C = RULES.cover;

/** Diagram size at 100%, in points. */
export const DIAGRAM_WIDTH = TOKENS.box.width * TOKENS.inchesPerR * 72;
export const DIAGRAM_HEIGHT = (TOKENS.box.height + TOKENS.box.headroom) * TOKENS.inchesPerR * 72;

export interface CoverItem {
  /** Has a note under it ("for Bridge only"): its row is taller. */
  note?: boolean;
  /** In the "Alternate (for ...)" group, after the main diagrams. */
  alternate?: boolean;
}

export interface Panel {
  x0: number;
  x1: number;
  /** Top of the dark blue header bar. */
  headerTop: number;
  /** Top and bottom of the outlined body. */
  bodyTop: number;
  bottom: number;
}

export interface PlacedDiagram {
  /** Index into the items. */
  index: number;
  page: number;
  /** Top left of the diagram box, in points. */
  x: number;
  y: number;
}

export interface CoverPageLayout {
  kind: "first" | "continued" | "legendOnly";
  /** Page 1 header geometry ("beside" or "full" in rules.cover.header). */
  header?: "beside" | "full";
  chords?: Panel & { title: string; tuningBaseline?: number };
  legend?: Panel;
  /** Logo at the bottom of page 2. */
  logoY?: number;
  /** Top of the "Alternate (...)" block on this page. */
  alternateY?: number;
  /** Baseline of "Continued at back of page". */
  continuedBaseline?: number;
}

export interface CoverLayout {
  columns: number;
  scale: number;
  /** Diagram box size at `scale`, in points. */
  width: number;
  height: number;
  pages: CoverPageLayout[];
  diagrams: PlacedDiagram[];
  /** Items that did not fit anywhere (beyond page 2's capacity). */
  dropped: number[];
  warnings: string[];
}

export interface SolveOptions {
  /** A tuning label is printed at the top of the chords panel. */
  tuning?: boolean;
}

const step = C.columns.scaleStep;
const roundDown = (s: number) => Math.floor(s / step + 1e-9) * step;
const roundScale = (s: number) => Math.round(s * 1000) / 1000;

function panelOf(x: number[], headerTop: number, bottom: number, title?: string): Panel & { title: string } {
  return { x0: x[0]!, x1: x[1]!, headerTop, bodyTop: headerTop + C.panel.headerHeight + C.panel.gapBelowHeader, bottom, title: title ?? "" };
}

interface Flow {
  /** Items placed, from `start`. */
  count: number;
  rows: { items: number[]; top: number; height: number }[];
  alternateY?: number;
  used: number;
  limit: number;
  firstTop: number;
}

/**
 * Flows items from `start` into rows of `cols` inside `panel`, with no
 * vertical gaps yet. Stops at the panel bottom or after `maxRows` rows.
 */
function flow(items: CoverItem[], start: number, panel: Panel, cols: number, scale: number, maxRows: number, tuning: boolean, reserve: number): Flow {
  const h = DIAGRAM_HEIGHT * scale;
  const firstTop = panel.bodyTop + (tuning ? C.chords.topWithTuning : C.chords.top);
  const limit = panel.bottom - C.chords.bottomPad - reserve;
  const rows: Flow["rows"] = [];
  let y = firstTop;
  let i = start;
  let alternateY: number | undefined;
  while (i < items.length && rows.length < maxRows) {
    const alt = !!items[i]!.alternate;
    const startsAlt = alt && (i === 0 || !items[i - 1]!.alternate);
    const pre = startsAlt ? C.chords.alternateHeight : 0;
    const row: number[] = [];
    for (let j = i; j < items.length && row.length < cols && !!items[j]!.alternate === alt; j++) row.push(j);
    const height = h + (row.some((j) => items[j]!.note) ? C.chords.noteHeight : 0);
    if (y + pre + height > limit + 1e-6) break;
    if (startsAlt) alternateY = y;
    rows.push({ items: row, top: y + pre, height });
    y += pre + height;
    i += row.length;
  }
  return { count: i - start, rows, ...(alternateY !== undefined ? { alternateY } : {}), used: y - firstTop, limit, firstTop };
}

function innerWidth(p: Panel) {
  return p.x1 - p.x0 - 2 * C.chords.padX;
}

/** Largest scale for `cols` columns in panel `p`, from the width alone. */
function maxScaleFor(p: Panel, cols: number): number {
  const s = (innerWidth(p) / cols - C.columns.hgapMin) / DIAGRAM_WIDTH;
  return roundScale(Math.min(C.columns.maxScale, roundDown(s)));
}

/** Columns that fit one row of `p` at `scale`. */
function colsAt(p: Panel, scale: number): number {
  return Math.max(1, Math.floor((innerWidth(p) + C.columns.hgapMin) / (DIAGRAM_WIDTH * scale + C.columns.hgapMin) + 1e-9));
}

/** Gives a flow's rows their final positions: columns spread evenly, rows spaced evenly up to the column gap. */
function place(f: Flow, items: CoverItem[], p: Panel, cols: number, scale: number, page: number): PlacedDiagram[] {
  const w = DIAGRAM_WIDTH * scale;
  const cell = innerWidth(p) / cols;
  const hgap = cell - w;
  const gaps = f.rows.length - 1;
  const vgap = gaps > 0 ? Math.max(0, Math.min(hgap, (f.limit - f.firstTop - f.used) / gaps)) : 0;
  const out: PlacedDiagram[] = [];
  f.rows.forEach((row, r) => {
    row.top += r * vgap;
    const pad = C.columns.lastRow === "center" ? ((cols - row.items.length) * cell) / 2 : 0;
    row.items.forEach((index, k) => {
      out.push({ index, page, x: p.x0 + C.chords.padX + pad + k * cell + (cell - w) / 2, y: row.top });
    });
  });
  // The alternate label sits just above the first alternate row.
  const firstAlt = f.rows.find((row) => items[row.items[0]!]!.alternate);
  if (firstAlt && f.alternateY !== undefined) f.alternateY = firstAlt.top - C.chords.alternateHeight;
  return out;
}

const emptyPlaces = (n: number, cols: number) => (n === 0 ? 0 : Math.ceil(n / cols) * cols - n);

/** Chooses columns and scale, and places every diagram (CLAUDE.md §9). */
export function solveCover(items: CoverItem[], opts: SolveOptions = {}): CoverLayout {
  const tuning = !!opts.tuning;
  const H = C.header;
  const L = C.layouts;
  const warnings: string[] = [];
  const beside = panelOf(L.beside.chords, H.beside.panelTop, L.beside.bottom, "CHORDS:");
  const full = panelOf(L.full.chords, H.full.panelTop, L.full.bottom, "CHORDS:");
  const legendBeside = panelOf(L.beside.legend, H.beside.panelTop, L.beside.bottom);
  const panelFor = (cols: number) => (C.columns.full.includes(cols) ? full : beside);

  /** Largest scale at which all items fit with `cols` columns, or undefined. */
  const fit = (cols: number): number | undefined => {
    const p = panelFor(cols);
    for (let s = maxScaleFor(p, cols); s >= C.columns.minScale - 1e-9; s = roundScale(s - step)) {
      if (flow(items, 0, p, cols, s, C.columns.maxRows, tuning, 0).count === items.length) return s;
    }
    return undefined;
  };

  let cols: number | undefined;
  let scale: number | undefined;
  for (let c = C.columns.default; c <= C.columns.max; c++) {
    const s = fit(c);
    if (s !== undefined) { cols = c; scale = s; break; }
  }
  // Even use of the white space: fewer columns when that leaves fewer empty places in the last row.
  if (cols === C.columns.default) {
    const main = items.filter((i) => !i.alternate).length;
    const alt = items.length - main;
    const empty = (c: number) => emptyPlaces(main, c) + emptyPlaces(alt, c);
    for (let c = C.columns.default - 1; c >= C.columns.min; c--) {
      // Only at full size: shrinking to fit would leave wide gaps across the panel.
      const s = fit(c);
      if (s !== undefined && s === maxScaleFor(panelFor(c), c) && empty(c) < empty(cols)) { cols = c; scale = s; }
    }
  }

  const make = (c: number, s: number, pages: CoverPageLayout[], diagrams: PlacedDiagram[], dropped: number[]): CoverLayout =>
    ({ columns: c, scale: s, width: DIAGRAM_WIDTH * s, height: DIAGRAM_HEIGHT * s, pages, diagrams, dropped, warnings });
  const tuningBaseline = (p: Panel) => (tuning ? { tuningBaseline: p.bodyTop + C.chords.tuningBaseline } : {});

  if (cols !== undefined && scale !== undefined) {
    const p = panelFor(cols);
    const f = flow(items, 0, p, cols, scale, C.columns.maxRows, tuning, 0);
    const diagrams = place(f, items, p, cols, scale, 0);
    const alt = f.alternateY !== undefined ? { alternateY: f.alternateY } : {};
    if (p === beside) {
      return make(cols, scale, [{ kind: "first", header: "beside", chords: { ...beside, ...tuningBaseline(beside) }, legend: legendBeside, ...alt }], diagrams, []);
    }
    const lo = L.legendOnly;
    return make(cols, scale, [
      { kind: "first", header: "full", chords: { ...full, ...tuningBaseline(full) }, ...alt },
      { kind: "legendOnly", legend: panelOf(lo.legend, lo.top, lo.bottom), logoY: lo.logoY },
    ], diagrams, []);
  }

  // Overflow: the widest layout on page 1, the rest on page 2 beside the Legend, at the same scale.
  cols = C.columns.max;
  scale = maxScaleFor(full, cols);
  const f1 = flow(items, 0, full, cols, scale, C.columns.maxRows, tuning, C.chords.continuedHeight);
  const d1 = place(f1, items, full, cols, scale, 0);
  const co = L.continued;
  const p2 = panelOf(co.chords, co.top, co.bottom, "CHORDS (con’t.):");
  const cols2 = colsAt(p2, scale);
  const f2 = flow(items, f1.count, p2, cols2, scale, C.columns.maxRowsContinued, tuning, 0);
  const d2 = place(f2, items, p2, cols2, scale, 1);
  const dropped: number[] = [];
  for (let i = f1.count + f2.count; i < items.length; i++) dropped.push(i);
  if (dropped.length) warnings.push(`${dropped.length} diagram(s) do not fit on the two cover pages (more than ${f1.count} + ${f2.count}); the overflow rule beyond page 2 is an open question (CLAUDE.md §10.3)`);
  const lastRow = f1.rows[f1.rows.length - 1];
  const continuedBaseline = (lastRow ? lastRow.top + lastRow.height : f1.firstTop) + C.chords.continuedBaseline;
  return make(cols, scale, [
    { kind: "first", header: "full", chords: { ...full, ...tuningBaseline(full) }, continuedBaseline, ...(f1.alternateY !== undefined ? { alternateY: f1.alternateY } : {}) },
    { kind: "continued", chords: { ...p2, ...tuningBaseline(p2) }, legend: panelOf(co.legend, co.top, co.bottom), logoY: co.logoY, ...(f2.alternateY !== undefined ? { alternateY: f2.alternateY } : {}) },
  ], [...d1, ...d2], dropped);
}
