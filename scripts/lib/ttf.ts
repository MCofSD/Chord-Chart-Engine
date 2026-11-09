/**
 * Minimal TrueType reader for build scripts: cmap (formats 4 and 12),
 * advance widths, and simple-glyph outlines as SVG path data.
 * Not used at runtime; scripts generate static tables from it.
 */
import { readFileSync } from "node:fs";

export interface Pt { x: number; y: number; on: boolean }

export interface GlyphOutline {
  /** SVG path in 1/1000 em, y pointing down, baseline at y = 0. */
  path: string;
  advance: number;
  /** Ink box in 1/1000 em, y up from baseline. */
  xMin: number; xMax: number; yMin: number; yMax: number;
}

export function loadFont(path: string) {
  const buf = readFileSync(path);
  const u16 = (o: number) => buf.readUInt16BE(o);
  const i16 = (o: number) => buf.readInt16BE(o);
  const u32 = (o: number) => buf.readUInt32BE(o);

  const tables = new Map<string, number>();
  for (let i = 0, n = u16(4); i < n; i++) {
    const rec = 12 + i * 16;
    tables.set(buf.toString("ascii", rec, rec + 4), u32(rec + 8));
  }
  const table = (tag: string) => {
    const o = tables.get(tag);
    if (o === undefined) throw new Error(`${path}: missing ${tag} table`);
    return o;
  };

  const head = table("head");
  const unitsPerEm = u16(head + 18);
  const longLoca = i16(head + 50) === 1;
  const numHMetrics = u16(table("hhea") + 34);
  const hmtx = table("hmtx");
  const scale = 1000 / unitsPerEm;

  const advanceUnits = (gid: number) => u16(hmtx + 4 * Math.min(gid, numHMetrics - 1));

  function glyphId(cp: number): number {
    const cmap = table("cmap");
    let best = 0;
    for (let i = 0, n = u16(cmap + 2); i < n; i++) {
      const sub = cmap + u32(cmap + 4 + i * 8 + 4);
      const format = u16(sub);
      if (format === 12) {
        for (let g = 0, groups = u32(sub + 12); g < groups; g++) {
          const r = sub + 16 + g * 12;
          if (cp >= u32(r) && cp <= u32(r + 4)) return u32(r + 8) + (cp - u32(r));
        }
      } else if (format === 4 && cp <= 0xffff) {
        const segX2 = u16(sub + 6);
        const ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, offs = deltas + segX2;
        for (let s = 0; s < segX2 / 2; s++) {
          if (cp > u16(ends + 2 * s)) continue;
          const start = u16(starts + 2 * s);
          if (cp < start) break;
          const ro = u16(offs + 2 * s);
          if (ro === 0) best = (cp + i16(deltas + 2 * s)) & 0xffff;
          else {
            const gl = u16(offs + 2 * s + ro + 2 * (cp - start));
            best = gl === 0 ? 0 : (gl + i16(deltas + 2 * s)) & 0xffff;
          }
          if (best) return best;
          break;
        }
      }
    }
    return best;
  }

  function contours(gid: number): Pt[][] {
    const loca = table("loca"), glyf = table("glyf");
    const off = longLoca ? u32(loca + gid * 4) : u16(loca + gid * 2) * 2;
    const next = longLoca ? u32(loca + gid * 4 + 4) : u16(loca + gid * 2 + 2) * 2;
    if (next === off) return [];
    const g = glyf + off;
    const nContours = i16(g);
    if (nContours < 0) return compositeContours(g);
    const endPts = Array.from({ length: nContours }, (_, i) => u16(g + 10 + i * 2));
    const nPts = (endPts[nContours - 1] ?? -1) + 1;
    let p = g + 10 + nContours * 2;
    p += 2 + u16(p); // skip instructions
    const flags: number[] = [];
    while (flags.length < nPts) {
      const f = buf[p++]!;
      flags.push(f);
      if (f & 8) for (let r = buf[p++]!; r > 0; r--) flags.push(f);
    }
    const coords = (short: number, same: number) => {
      const out: number[] = [];
      let v = 0;
      for (const f of flags) {
        if (f & short) { const d = buf[p++]!; v += f & same ? d : -d; }
        else if (!(f & same)) { v += i16(p); p += 2; }
        out.push(v);
      }
      return out;
    };
    const xs = coords(2, 16), ys = coords(4, 32);
    const result: Pt[][] = [];
    let start = 0;
    for (const end of endPts) {
      result.push(Array.from({ length: end - start + 1 }, (_, k) => ({ x: xs[start + k]!, y: ys[start + k]!, on: (flags[start + k]! & 1) === 1 })));
      start = end + 1;
    }
    return result;
  }

  /** Composite glyphs with simple x/y offsets (no scaling), which covers the symbols we use. */
  function compositeContours(g: number): Pt[][] {
    const out: Pt[][] = [];
    let p = g + 10;
    for (;;) {
      const flags = u16(p), gid = u16(p + 2);
      p += 4;
      let dx: number, dy: number;
      if (flags & 1) { dx = i16(p); dy = i16(p + 2); p += 4; }
      else { dx = buf.readInt8(p); dy = buf.readInt8(p + 1); p += 2; }
      if (flags & 8) p += 2; else if (flags & 0x40) p += 4; else if (flags & 0x80) p += 8;
      for (const c of contours(gid)) out.push(c.map((q) => ({ x: q.x + dx, y: q.y + dy, on: q.on })));
      if (!(flags & 0x20)) break;
    }
    return out;
  }

  function toPath(cs: Pt[][]): string {
    const f = (v: number) => String(Math.round(v * scale * 10) / 10);
    const P = (pt: { x: number; y: number }) => `${f(pt.x)} ${f(-pt.y)}`;
    let d = "";
    for (const c of cs) {
      if (!c.length) continue;
      let startIdx = c.findIndex((q) => q.on);
      let first: { x: number; y: number };
      if (startIdx < 0) { first = { x: (c[0]!.x + c[1]!.x) / 2, y: (c[0]!.y + c[1]!.y) / 2 }; startIdx = 0; }
      else first = c[startIdx]!;
      d += `M${P(first)}`;
      let ctrl: Pt | undefined;
      for (let k = 1; k <= c.length; k++) {
        const pt = c[(startIdx + k) % c.length]!;
        if (pt.on) {
          d += ctrl ? `Q${P(ctrl)} ${P(pt)}` : `L${P(pt)}`;
          ctrl = undefined;
        } else {
          if (ctrl) { const mid = { x: (ctrl.x + pt.x) / 2, y: (ctrl.y + pt.y) / 2 }; d += `Q${P(ctrl)} ${P(mid)}`; }
          ctrl = pt;
        }
      }
      if (ctrl) d += `Q${P(ctrl)} ${P(first)}`;
      d += "Z";
    }
    return d;
  }

  return {
    unitsPerEm,
    has: (cp: number) => glyphId(cp) !== 0,
    /** Advance in 1/1000 em, or undefined if the font lacks the character. */
    advance(cp: number): number | undefined {
      const gid = glyphId(cp);
      return gid ? Math.round(advanceUnits(gid) * scale) : undefined;
    },
    outline(cp: number): GlyphOutline {
      const gid = glyphId(cp);
      if (!gid) throw new Error(`U+${cp.toString(16).toUpperCase()} not in ${path}`);
      const cs = contours(gid);
      const all = cs.flat();
      const xs = all.map((q) => q.x), ys = all.map((q) => q.y);
      return {
        path: toPath(cs),
        advance: Math.round(advanceUnits(gid) * scale),
        xMin: Math.round(Math.min(...xs) * scale), xMax: Math.round(Math.max(...xs) * scale),
        yMin: Math.round(Math.min(...ys) * scale), yMax: Math.round(Math.max(...ys) * scale),
      };
    },
  };
}
