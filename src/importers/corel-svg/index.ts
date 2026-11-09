/**
 * Corel SVG -> Voicing converter (CLAUDE.md §6.1, §6.4).
 *
 * All geometry is derived from the grid itself (never from fixed numbers), so
 * the four very different viewBox scales in the samples behave the same.
 * Everything uncertain is snapped and recorded in `voicing.review`.
 */
import { textWidth } from "../../text/metrics.js";
import { FRET_ROWS, STRING_COUNT, type Barre, type ChordName, type Finger, type StringState, type Voicing } from "../../model/voicing.js";
import { decodeSvgBytes } from "./decode.js";
import { extractShapes, hasFill, hasStroke, isVisible, type Shape } from "./shapes.js";

const DARK = "#373435";
const GRAY = "#96989A";
const WHITE = new Set(["#FEFEFE", "#FFFFFF", "WHITE"]);

/** Dot offsets beyond this (in R) are flagged for review after snapping. */
const SNAP_FLAG_R = 0.15;

type Circle = Extract<Shape, { tag: "circle" }>;
type Rect = Extract<Shape, { tag: "rect" }>;
type Line = Extract<Shape, { tag: "line" }>;
type Text = Extract<Shape, { tag: "text" }>;

interface Grid {
  /** One fret row height, in source units. */
  R: number;
  stringX: number[];
  /** Row centers, top to bottom. */
  rowY: number[];
  top: number;
  left: number;
  right: number;
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const fmt = (n: number) => n.toFixed(2);

function nearestIndex(values: number[], v: number): { index: number; offset: number } {
  let index = 0;
  values.forEach((x, i) => {
    if (Math.abs(x - v) < Math.abs((values[index] ?? Infinity) - v)) index = i;
  });
  return { index, offset: v - (values[index] ?? 0) };
}

function findGrid(shapes: Shape[]): Grid {
  const frames = shapes.filter(
    (s): s is Rect => s.tag === "rect" && hasStroke(s) && s.style.stroke === DARK && !hasFill(s),
  );
  const frame = frames.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!frame) throw new Error("no grid frame (dark, unfilled rectangle) found");

  const inFrame = (l: Line) => l.x1 >= frame.x - 1e-6 * frame.width && l.x2 <= frame.x + frame.width * 1.001;
  const darkLines = shapes.filter((s): s is Line => s.tag === "line" && hasStroke(s) && s.style.stroke === DARK);
  const tol = frame.width * 0.01;
  const verticals = darkLines.filter((l) => near(l.x1, l.x2, tol)).map((l) => l.x1);
  const horizontals = darkLines.filter((l) => near(l.y1, l.y2, tol) && inFrame(l)).map((l) => l.y1);

  const stringX = [frame.x, ...verticals.sort((a, b) => a - b), frame.x + frame.width];
  if (stringX.length !== STRING_COUNT) throw new Error(`expected ${STRING_COUNT} strings, found ${stringX.length}`);

  const bottom = frame.y + frame.height;
  const ys = horizontals.sort((a, b) => a - b);
  const bandBottom = ys[0];
  if (bandBottom === undefined || ys.length !== FRET_ROWS) {
    throw new Error(`expected ${FRET_ROWS} horizontal grid lines (band + 3 frets), found ${ys.length}`);
  }
  const R = (bottom - bandBottom) / FRET_ROWS;
  const rowY = Array.from({ length: FRET_ROWS }, (_, r) => bandBottom + (r + 0.5) * R);
  return { R, stringX, rowY, top: frame.y, left: frame.x, right: frame.x + frame.width };
}

/** Assigns each mark (in order) to a distinct string, minimising total offset. */
function assignOrdered(positions: number[], stringX: number[]): number[] {
  const n = positions.length, m = stringX.length;
  // cost[i][j] = best total cost placing marks 0..i with mark i on string j
  const cost: number[][] = positions.map(() => new Array<number>(m).fill(Infinity));
  const prev: number[][] = positions.map(() => new Array<number>(m).fill(-1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const own = Math.abs((positions[i] ?? 0) - (stringX[j] ?? 0));
      if (i === 0) { cost[0]![j] = own; continue; }
      for (let k = 0; k < j; k++) {
        const c = cost[i - 1]![k]! + own;
        if (c < cost[i]![j]!) { cost[i]![j] = c; prev[i]![j] = k; }
      }
    }
  }
  const last = cost[n - 1]!;
  let j = last.indexOf(Math.min(...last));
  const out = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) { out[i] = j; j = prev[i]![j]!; }
  return out;
}

/** Grid measurements of a Corel SVG in its own units (used to align visual comparisons). */
export function measureCorelGrid(bytes: Uint8Array): { R: number; left: number; top: number; viewBox: number[] } {
  const { shapes, viewBox } = extractShapes(decodeSvgBytes(bytes));
  const g = findGrid(shapes);
  return { R: g.R, left: g.left, top: g.top, viewBox };
}

export interface ImportResult {
  voicing: Voicing;
  /** Same as voicing.review, for convenience. */
  review: string[];
}

export function importCorelSvg(bytes: Uint8Array): ImportResult {
  const { shapes } = extractShapes(decodeSvgBytes(bytes));
  const g = findGrid(shapes);
  const { R } = g;
  const review: string[] = [];
  const flag = (msg: string) => review.push(msg);

  const visible = shapes.filter(isVisible);
  const isGridPart = (s: Shape) =>
    (s.tag === "line" || s.tag === "rect") && hasStroke(s) && s.style.stroke === DARK && !hasFill(s);

  // White shapes that are not finger-number text are never drawn. Row-center
  // hairlines and dot-sized circles are Corel snap helpers (owner, 2026-11-08):
  // ignored silently. Any other white shape is flagged.
  for (const s of visible) {
    if (s.tag === "text") continue;
    const white = WHITE.has(s.style.stroke ?? "") || (hasFill(s) && WHITE.has(s.style.fill ?? ""));
    if (!white) continue;
    const snapLine = s.tag === "line" && near(s.y1, s.y2, R * 0.01) && near(nearestIndex(g.rowY, s.y1).offset, 0, R * 0.05);
    const snapCircle = s.tag === "circle" && near(s.r / R, 0.357, 0.06);
    if (!snapLine && !snapCircle) flag(`white ${s.tag} ignored`);
  }

  // Dots: filled dark/gray circles about 0.357 R.
  const dots = visible.filter(
    (s): s is Circle => s.tag === "circle" && (s.style.fill === DARK || s.style.fill === GRAY) && near(s.r / R, 0.357, 0.06),
  );
  const texts = visible.filter((s): s is Text => s.tag === "text");
  const dotLabel = new Map<Circle, string>();
  const usedTexts = new Set<Text>();
  for (const t of texts) {
    if (!WHITE.has(t.style.fill ?? "")) continue;
    const fs = t.style.fontSize ?? 0;
    const cx = t.x + textWidth(t.text, fs) / 2;
    const cy = t.y - 0.36 * fs;
    let best: Circle | undefined, bestD = Infinity;
    for (const d of dots) {
      const dist = Math.hypot(d.cx - cx, d.cy - cy);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    if (best && bestD < best.r) { dotLabel.set(best, t.text.trim()); usedTexts.add(t); }
  }

  // Classify remaining text.
  let fretLabel: { value: number; row: number } | undefined;
  const nameParts: { t: Text; role: "root" | "accidental" | "quality" }[] = [];
  const mutedOpen = new Set<number>();
  for (const t of texts) {
    if (usedTexts.has(t)) continue;
    const fs = (t.style.fontSize ?? 0) / R;
    const raw = t.text;
    if (t.style.fontStyle === "italic" && /^\s*\d+\s*$/.test(raw)) {
      const row = nearestIndex(g.rowY, t.y - 0.36 * R);
      fretLabel = { value: parseInt(raw, 10), row: row.index };
    } else if (/^[x\s]+$/i.test(raw) && raw.includes("x") && near(fs, 0.75, 0.08)) {
      const fsAbs = t.style.fontSize ?? 0;
      const centers: number[] = [];
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] !== "x") continue;
        centers.push(t.x + textWidth(raw.slice(0, i), fsAbs) + textWidth("x", fsAbs) / 2);
      }
      const strings = assignOrdered(centers, g.stringX);
      const offs = centers.map((c, i) => Math.abs(c - (g.stringX[strings[i]!] ?? 0)) / R);
      strings.forEach((s) => mutedOpen.add(s));
      flag(`open-string "x" marks were one padded text; snapped to strings ${strings.join(",")} (largest offset ${fmt(Math.max(...offs))} R)`);
    } else if (near(fs, 1.286, 0.1)) {
      nameParts.push({ t, role: "root" });
    } else if (near(fs, 1.072, 0.1) && /^[b#]$/.test(raw.trim())) {
      nameParts.push({ t, role: "accidental" });
    } else if (near(fs, 0.643, 0.1)) {
      nameParts.push({ t, role: "quality" });
      if (t.style.baselineShift) flag(`chord quality "${raw.trim()}" used baseline-shift:${t.style.baselineShift}; positioned explicitly instead`);
    } else {
      flag(`unrecognised text "${raw}" (font size ${fmt(fs)} R) ignored`);
    }
  }

  const chord = buildChordName(nameParts, flag);

  // No fret number printed means the top row is fret 1 (owner, 2026-11-08).
  let windowStartFret = 1;
  if (fretLabel) windowStartFret = fretLabel.value - fretLabel.row;
  if (windowStartFret < 1) {
    flag(`fret number implies window start ${windowStartFret}; clamped to 1`);
    windowStartFret = 1;
  }
  const fretOfRow = (r: number) => windowStartFret + r;

  // Strings.
  const perString: (StringState | undefined)[] = new Array(STRING_COUNT).fill(undefined);
  for (const d of dots) {
    const st = nearestIndex(g.stringX, d.cx), row = nearestIndex(g.rowY, d.cy);
    const off = Math.hypot(st.offset, row.offset) / R;
    if (off > SNAP_FLAG_R) flag(`dot snapped to string ${st.index}, row ${row.index} from ${fmt(off)} R away`);
    const label = dotLabel.get(d) ?? "";
    let state: StringState;
    if (d.style.fill === GRAY) {
      if (label && label !== "X") flag(`gray dot on string ${st.index} has label "${label}"; treated as muted`);
      state = { kind: "muted", fret: fretOfRow(row.index) };
    } else {
      state = { kind: "fretted", fret: fretOfRow(row.index) };
      const f = parseFinger(label);
      if (f !== undefined) state.finger = f;
      else if (label) flag(`dot on string ${st.index} has unrecognised label "${label}"`);
    }
    const existing = perString[st.index];
    if (existing) flag(`string ${st.index} has more than one mark; kept the ${existing.kind} mark`);
    else perString[st.index] = state;
  }
  for (const s of mutedOpen) {
    if (perString[s]) flag(`string ${s} has both an "x" above the frame and a dot; kept the dot`);
    else perString[s] = { kind: "mutedOpen" };
  }
  // A string with no mark is open; open strings are drawn as nothing (owner, 2026-11-08).
  const strings: StringState[] = perString.map((s) => s ?? { kind: "open" });

  // Barres: filled rectangles about 0.466 R high, grouped by row.
  const bars = visible.filter(
    (s): s is Rect => s.tag === "rect" && !isGridPart(s) && (s.style.fill === DARK || s.style.fill === GRAY) && near(s.height / R, 0.466, 0.08),
  );
  const byRow = new Map<number, { gray: [number, number][]; dark: [number, number][] }>();
  for (const b of bars) {
    const row = nearestIndex(g.rowY, b.y + b.height / 2).index;
    const from = nearestIndex(g.stringX, b.x).index;
    const to = nearestIndex(g.stringX, b.x + b.width).index;
    const entry = byRow.get(row) ?? { gray: [], dark: [] };
    (b.style.fill === DARK ? entry.dark : entry.gray).push([from, to]);
    byRow.set(row, entry);
  }
  const barres: Barre[] = [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([row, { gray, dark }]) => {
      const all = [...gray, ...dark];
      return {
        fret: fretOfRow(row),
        from: Math.min(...all.map((s) => s[0])),
        to: Math.max(...all.map((s) => s[1])),
        sounding: dark.filter(([a, z]) => z > a).sort((a, b) => a[0] - b[0]),
      };
    });

  const voicing: Voicing = { chord, strings, windowStartFret };
  if (fretLabel) voicing.fretLabelRow = fretLabel.row;
  if (barres.length) voicing.barres = barres;
  if (review.length) voicing.review = review;
  return { voicing, review };
}

function parseFinger(label: string): Finger | undefined {
  if (label === "T") return "T";
  const n = Number(label);
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : undefined;
}

function buildChordName(parts: { t: Text; role: "root" | "accidental" | "quality" }[], flag: (m: string) => void): ChordName {
  const sorted = [...parts].sort((a, b) => a.t.x - b.t.x);
  const rootText = sorted.filter((p) => p.role === "root").map((p) => p.t.text.trim()).join("");
  const root = rootText.charAt(0);
  if (!/^[A-G]$/.test(root)) throw new Error(`chord root not found (got "${rootText}")`);
  const chord: ChordName = { root };
  const restOfRoot = rootText.slice(1);
  const acc = sorted.find((p) => p.role === "accidental")?.t.text.trim() ?? (/^[b#]/.test(restOfRoot) ? restOfRoot[0] : undefined);
  if (acc === "b" || acc === "#") chord.accidental = acc;
  const quality = sorted.filter((p) => p.role === "quality").map((p) => p.t.text.trim()).join("");
  if (quality) chord.quality = quality;
  if (restOfRoot.replace(/^[b#]/, "")) flag(`extra text "${restOfRoot}" in chord root ignored`);
  return chord;
}
