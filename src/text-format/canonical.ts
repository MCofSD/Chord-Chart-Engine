/**
 * Canonical form of a chart: removes differences the renderer can't see, so
 * "text -> chart -> text" round trips can be checked with a deep equal.
 * - Keys starting with "_" (notes in fixture files) are dropped.
 * - Adjacent lyric text pieces with the same style are merged; runs of spaces
 *   become one space; the lyric's trailing spaces are dropped.
 * - Anchors: `place: "on"` (the default) is dropped; `alignRight` anchors get
 *   `at: 0` (the renderer ignores it) and go last; anchors past the end of the
 *   lyric only keep their order (the renderer clamps them), so they get
 *   `at = length + rank`.
 * - Rhythm marks drop `bar: 1` (the default) and are sorted by character.
 * - Riff references drop `riff: 1` (the default).
 */
import type { Anchor, Block, Chart, ChordLineItem, LineBlock, LyricPiece, NoteBlock } from "../model/chart.js";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function dropUnderscore<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_"))) as T;
}

function canonicalItem(item: ChordLineItem): ChordLineItem {
  if (item.t === "ref" && item.riff === 1) { const { riff: _r, ...rest } = item; return rest; }
  return item;
}

export function lyricText(pieces: LyricPiece[]): string {
  return pieces.map((p) => ("text" in p ? p.text : "")).join("");
}

function canonicalLyrics(pieces: LyricPiece[]): LyricPiece[] {
  const out: LyricPiece[] = [];
  for (const p of pieces) {
    if ("item" in p) { out.push({ item: canonicalItem(p.item) }); continue; }
    const last = out[out.length - 1];
    if (last && "text" in last && last.style === p.style) last.text += p.text;
    else out.push(p.style ? { text: p.text, style: p.style } : { text: p.text });
  }
  for (const p of out) if ("text" in p) p.text = p.text.replace(/ {2,}/g, " ");
  // Trailing spaces of the whole lyric.
  for (let k = out.length - 1; k >= 0; k--) {
    const p = out[k]!;
    if (!("text" in p)) continue;
    p.text = p.text.replace(/ +$/, "");
    if (p.text) break;
  }
  return out.filter((p) => !("text" in p) || p.text !== "");
}

/**
 * Character indices change when spaces are collapsed; maps an index in the
 * original lyric text to the collapsed one.
 */
function collapseMap(text: string): (i: number) => number {
  const map: number[] = [];
  let j = 0;
  for (let i = 0; i < text.length; i++) {
    map.push(j);
    if (!(text[i] === " " && text[i + 1] === " ")) j++;
  }
  map.push(j);
  return (i) => map[Math.min(Math.max(i, 0), text.length)]!;
}

function canonicalLine(b: LineBlock): LineBlock {
  const original = lyricText(b.lyrics);
  const lyrics = canonicalLyrics(b.lyrics);
  const len = lyricText(lyrics).length;
  const at = collapseMap(original);
  const pos = (i: number) => (i >= original.length ? Number.POSITIVE_INFINITY : at(i));
  const anchor = (a: Anchor): Anchor => {
    const out: Anchor = { at: a.at, items: a.items.map(canonicalItem) };
    if (a.place && a.place !== "on") out.place = a.place;
    if (a.alignRight) out.alignRight = true;
    return out;
  };
  const inText = b.above.filter((a) => !a.alignRight).map((a) => ({ a: anchor(a), p: pos(a.at) }));
  inText.sort((x, y) => x.p - y.p);
  let rank = 0;
  const above = inText.map(({ a, p }) => ({ ...a, at: p < len ? p : len + rank++ }));
  for (const a of b.above.filter((a) => a.alignRight)) above.push({ ...anchor(a), at: 0 });
  const out: LineBlock = { kind: "line", lyrics, above };
  if (b.lyricEntry !== undefined) out.lyricEntry = b.lyricEntry;
  if (b.rhythm?.length) {
    out.rhythm = b.rhythm
      .map((m) => (m.bar === undefined || m.bar === 1 ? { at: at(m.at), beat: m.beat } : { at: at(m.at), beat: m.beat, bar: m.bar }))
      .sort((x, y) => x.at - y.at);
  }
  return out;
}

function canonicalNote(b: NoteBlock): NoteBlock {
  const pieces: NoteBlock["pieces"] = [];
  for (const p of b.pieces) {
    const last = pieces[pieces.length - 1];
    if (!("section" in p) && last && !("section" in last)) last.text += p.text;
    else pieces.push({ ...p });
  }
  return { kind: "note", pieces: pieces.filter((p) => "section" in p || p.text !== "") };
}

export function canonicalBlock(block: Block): Block {
  const b = dropUnderscore(clone(block));
  if (b.kind === "line") return canonicalLine(b);
  if (b.kind === "note") return canonicalNote(b);
  return b;
}

export function canonicalChart(chart: Chart): Chart {
  const c = dropUnderscore(clone(chart));
  return {
    ...c,
    meta: dropUnderscore(c.meta),
    sections: c.sections.map((s) => ({ ...dropUnderscore(s), blocks: s.blocks.map(canonicalBlock) })),
  };
}

/** JSON with object keys sorted, for order-insensitive comparison. */
export function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : val,
  );
}
