/**
 * A rendered notation block's geometry and its time axis. Kept apart from
 * render.ts so the chart renderer can place notation without loading alphaTab.
 */

export interface NotationRender {
  /** SVG content (no outer <svg>), origin at the top left, in pt. */
  svg: string;
  width: number;
  height: number;
  /** For each shown bar: its left and right x and its length in beats (quarter notes). */
  bars: { x0: number; x1: number; beats: number }[];
  /** Every beat: shown bar index (0-based), time in beats from that bar's start, and x of its notes. */
  beats: { bar: number; t: number; x: number }[];
  warnings: string[];
}

/**
 * Time axis of a rendered notation (time in beats from its first shown bar
 * -> x): interpolates between beats and bar lines, so a lyric syllable or a
 * chord name on any beat lands where that beat is played.
 */
export function notationAxis(r: NotationRender): (t: number) => number {
  const pts: { t: number; x: number }[] = [];
  let start = 0;
  r.bars.forEach((b, i) => {
    if (!r.beats.some((bt) => bt.bar === i && bt.t === 0)) pts.push({ t: start, x: b.x0 });
    for (const bt of r.beats.filter((x) => x.bar === i)) pts.push({ t: start + bt.t, x: bt.x });
    start += b.beats;
    // A bar's end is the next bar's beat 1; only the last bar adds its end (the closing bar line).
    if (i === r.bars.length - 1) pts.push({ t: start, x: b.x1 });
  });
  pts.sort((a, b) => a.t - b.t);
  return (t) => {
    if (!pts.length) return 0;
    if (t <= pts[0]!.t) return pts[0]!.x;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!;
      if (t <= b.t) return b.t === a.t ? b.x : a.x + ((t - a.t) / (b.t - a.t)) * (b.x - a.x);
    }
    return pts[pts.length - 1]!.x;
  };
}
