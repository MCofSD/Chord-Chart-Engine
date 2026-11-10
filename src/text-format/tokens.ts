/**
 * Chord-line tokens of the chart text format (NOTES.md, "Chart text format").
 * One group is a run of characters with no spaces outside (), [] or "", e.g.
 * `|Bbm7/C[2&]` or `(+Drm)[4]`; it becomes one `Anchor`. These functions
 * read and write single groups; columns and lyrics live in parse.ts/write.ts.
 *
 * Every symbol here is a proposal until the owner signs off. (verify)
 */
import type { Anchor, ChordLineItem } from "../model/chart.js";
import type { ChordName } from "../model/voicing.js";

export interface ParsedGroup {
  items: ChordLineItem[];
  place?: "before" | "after";
  alignRight?: boolean;
  /** Characters from the group's start to its first chord's root letter; undefined if the group has no chord. */
  rootOffset?: number;
}

// Quality pieces: words, digits, accidentals before a digit, and parenthesized extensions such as (b9), (m), (add9).
const PIECE = String.raw`maj|Maj|MAJ|min|dim|aug|sus|add|omit|alt|no|m|M|Δ|°|ø|\+|-(?=\d)|[b#♭♯](?=\d)|\d+`;
const QUALITY_PIECE = new RegExp(String.raw`(?:${PIECE}|\((?:${PIECE}|,)+\))`, "y");
const BASS = /\/([A-G][b#♭♯]?)/y;
const BEATS = /\[([^\]\s]*)\]/y;
const ENDING_OPEN = /\{([^.\s{}]+)\./y;
const METER = /(\d+)\/(\d+)/y;
const REF = /@(\d+)('*)/y;
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const WORD_DIRECTIONS = ["1/2T", "Vamp", "dstrn"] as const;
const PAREN_DIRECTIONS = ["NC", "simile", "ritard"] as const;
const INSTRUMENT_OPS: Record<string, "add" | "remove" | "only" | "except"> = { "+": "add", "-": "remove", "⊕": "only", "⊗": "except" };
const OP_SYMBOL = { add: "+", remove: "-", only: "⊕", except: "⊗" } as const;

const acc = (s: string) => (s === "♭" ? "b" : s === "♯" ? "#" : s) as "b" | "#";
const normAcc = (s: string) => s.replace(/♭/g, "b").replace(/♯/g, "#");

function match(re: RegExp, s: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(s);
}

/** Index of the bracket closing the one at `i` (nesting allowed), or -1. */
function closing(s: string, i: number, open: string, close: string): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === open) depth++;
    else if (s[j] === close && --depth === 0) return j;
  }
  return -1;
}

interface ChordRead { chord: ChordName; end: number; rootAt: number; noBass: boolean; paren: boolean }

/** A chord at `i`: optional `*` (gray, no bass), optional parentheses, root, accidental, `_` (quality starts with b/#), quality, /bass. */
function readChord(s: string, i: number): ChordRead | undefined {
  let j = i, noBass = false, paren = false;
  if (s[j] === "*") { noBass = true; j++; }
  if (s[j] === "(") { paren = true; j++; }
  if (!noBass && s[j] === "*") { noBass = true; j++; }
  if (!/[A-G]/.test(s[j] ?? "")) return undefined;
  const rootAt = j;
  const chord: ChordName = { root: s[j++]! };
  // A b/# right after the root is the accidental ("Bb5" = B flat, quality 5); "_" starts a quality that begins with one ("F_b5").
  if (/[b#♭♯]/.test(s[j] ?? "")) chord.accidental = acc(s[j++]!);
  if (s[j] === "_") j++;
  let quality = "";
  for (let m = match(QUALITY_PIECE, s, j); m && m[0]; m = match(QUALITY_PIECE, s, j)) { quality += m[0]; j += m[0].length; }
  if (quality) chord.quality = normAcc(quality);
  const b = match(BASS, s, j);
  if (b) { chord.bass = normAcc(b[1]!); j += b[0].length; }
  if (paren) {
    if (s[j] !== ")") return undefined;
    j++;
  }
  return { chord, end: j, rootAt, noBass, paren };
}

function readBeats(s: string, i: number): { beats?: string; end: number } {
  const m = match(BEATS, s, i);
  return m ? { beats: m[1]!, end: i + m[0].length } : { end: i };
}

const withBeats = <T extends object>(item: T, beats: string | undefined): T => (beats === undefined ? item : { ...item, beats });

/** Reads one item at `i`. Returns the item (or null for a `;` separator) and the end index, or undefined if nothing fits. */
function readItem(s: string, i: number): { item: ChordLineItem | null; end: number; rootAt?: number } | undefined {
  const c = s[i]!;
  if (c === ";") return { item: null, end: i + 1 };
  if (c === "|") return { item: { t: "bar" }, end: i + 1 };
  if (c === "-" && !/\d/.test(s[i + 1] ?? "")) return { item: { t: "same" }, end: i + 1 };
  if (c === "}") return { item: { t: "endingClose" }, end: i + 1 };
  if (c === "↓") return { item: { t: "arrowDown" }, end: i + 1 };
  let m = match(ENDING_OPEN, s, i);
  if (m) return { item: { t: "endingOpen", n: m[1]! }, end: i + m[0].length };
  const stopAt = (j: number) => (s.startsWith("//", j) ? "abrupt" : s.startsWith("!!", j) ? "hold" : undefined);
  const stop = stopAt(i);
  if (stop) {
    const b = readBeats(s, i + 2);
    return { item: withBeats({ t: "stop", kind: stop } as ChordLineItem, b.beats), end: b.end };
  }
  if (c === "[") {
    const b = readBeats(s, i);
    const kind = stopAt(b.end);
    if (b.beats === undefined || !kind) return undefined;
    return { item: { t: "stop", kind, beats: b.beats, beatsFirst: true }, end: b.end + 2 };
  }
  m = match(REF, s, i);
  if (m) return { item: refItem(Number(m[1]), m[2]!.length + 1), end: i + m[0].length };
  const circled = CIRCLED.indexOf(c);
  if (circled >= 0) {
    let j = i + 1;
    while (s[j] === "'") j++;
    return { item: refItem(circled + 1, j - i), end: j };
  }
  for (const w of WORD_DIRECTIONS) if (s.startsWith(w, i)) return { item: { t: "direction", text: w }, end: i + w.length };
  m = match(METER, s, i);
  if (m) return { item: { t: "meter", top: Number(m[1]), bottom: Number(m[2]) }, end: i + m[0].length };
  m = match(BASS, s, i);
  if (m) {
    const b = readBeats(s, i + m[0].length);
    return { item: withBeats({ t: "bass", bass: normAcc(m[1]!) } as ChordLineItem, b.beats), end: b.end };
  }
  if (c === '"') {
    const z = s.indexOf('"', i + 1);
    if (z < 0) return undefined;
    return { item: { t: "text", text: s.slice(i + 1, z), paren: false }, end: z + 1 };
  }
  if (c === "*" || c === "(" || /[A-G]/.test(c)) {
    const ch = readChord(s, i);
    if (ch) {
      const b = readBeats(s, ch.end);
      const item: ChordLineItem = { t: "chord", chord: ch.chord };
      if (b.beats !== undefined) item.beats = b.beats;
      if (ch.noBass) item.noBass = true;
      if (ch.paren) item.paren = true;
      return { item, end: b.end, rootAt: ch.rootAt };
    }
  }
  if (c === "(") {
    const z = closing(s, i, "(", ")");
    if (z < 0) return undefined;
    const inner = s.slice(i + 1, z);
    const op = INSTRUMENT_OPS[inner[0] ?? ""];
    if (op && inner.length > 1 && !/\d/.test(inner[1]!)) {
      const b = readBeats(s, z + 1);
      return { item: withBeats({ t: "instrument", op, text: inner.slice(1) } as ChordLineItem, b.beats), end: b.end };
    }
    if ((PAREN_DIRECTIONS as readonly string[]).includes(inner)) return { item: { t: "direction", text: inner as (typeof PAREN_DIRECTIONS)[number] }, end: z + 1 };
    if (/^\d+x$/.test(inner)) return { item: { t: "times", text: inner }, end: z + 1 };
    return { item: { t: "text", text: inner }, end: z + 1 };
  }
  return undefined;
}

function refItem(n: number, riff: number): ChordLineItem {
  return riff > 1 ? { t: "ref", n, riff } : { t: "ref", n };
}

/** Parses one group. On failure, says where reading stopped. */
export function parseGroup(group: string): ParsedGroup | { error: string } {
  const out: ParsedGroup = { items: [] };
  let i = 0;
  if (group.startsWith(">>")) { out.alignRight = true; i = 2; }
  else if (group[0] === "<") { out.place = "before"; i = 1; }
  else if (group[0] === ">") { out.place = "after"; i = 1; }
  while (i < group.length) {
    const r = readItem(group, i);
    if (!r) return { error: i === 0 ? `"${group}" is not a chord or mark` : `"${group}": can't read "${group.slice(i)}"` };
    if (r.item) {
      if (r.rootAt !== undefined && out.rootOffset === undefined) out.rootOffset = r.rootAt;
      out.items.push(r.item);
    }
    i = r.end;
  }
  if (!out.items.length) return { error: `"${group}" has no chord or mark` };
  return out;
}

/** Splits a line into groups at spaces outside (), [] and "". */
export function splitGroups(line: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  let depth = 0, square = false, quote = false, start = -1;
  for (let i = 0; i <= line.length; i++) {
    const c = line[i];
    const sep = c === undefined || (c === " " && depth === 0 && !square && !quote);
    if (sep) {
      if (start >= 0) out.push({ start, text: line.slice(start, i) });
      start = -1;
      continue;
    }
    if (start < 0) start = i;
    if (quote) { if (c === '"') quote = false; continue; }
    if (c === '"') quote = true;
    else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === "[") square = true;
    else if (c === "]") square = false;
  }
  return out;
}

/** Text of one item. `rootAt` is the root letter's offset for chords. */
export function itemText(item: ChordLineItem): { text: string; rootAt?: number } {
  const beats = (b?: string) => (b === undefined ? "" : `[${b}]`);
  switch (item.t) {
    case "bar": return { text: "|" };
    case "same": return { text: "-" };
    case "chord": {
      const c = item.chord, q = c.quality ?? "";
      const pre = (item.noBass ? "*" : "") + (item.paren ? "(" : "");
      const body = c.root + (c.accidental ?? "") + (/^[b#♭♯]/.test(q) ? "_" : "") + q + (c.bass ? "/" + c.bass : "");
      return { text: pre + body + (item.paren ? ")" : "") + beats(item.beats), rootAt: pre.length };
    }
    case "bass": return { text: `/${item.bass}${beats(item.beats)}` };
    case "instrument": return { text: `(${OP_SYMBOL[item.op]}${item.text})${beats(item.beats)}` };
    case "text": return { text: item.paren === false ? `"${item.text}"` : `(${item.text})` };
    case "stop": {
      const sym = item.kind === "hold" ? "!!" : "//";
      if (item.beats === undefined) return { text: sym };
      return { text: item.beatsFirst ? `[${item.beats}]${sym}` : `${sym}[${item.beats}]` };
    }
    case "direction": return { text: (PAREN_DIRECTIONS as readonly string[]).includes(item.text) ? `(${item.text})` : item.text };
    case "times": return { text: `(${item.text})` };
    case "ref": return { text: `@${item.n}${"'".repeat(Math.max(0, (item.riff ?? 1) - 1))}` };
    case "meter": return { text: `${item.top}/${item.bottom}` };
    case "arrowDown": return { text: "↓" };
    case "endingOpen": return { text: `{${item.n}.` };
    case "endingClose": return { text: "}" };
  }
}

/** Text of a group, and the offset of its first chord's root (undefined without a chord). */
export function groupText(anchor: Pick<Anchor, "items" | "place" | "alignRight">, separate = false): { text: string; rootOffset?: number } {
  let text = anchor.alignRight ? ">>" : anchor.place === "before" ? "<" : anchor.place === "after" ? ">" : "";
  let rootOffset: number | undefined;
  anchor.items.forEach((item, k) => {
    if (separate && k > 0) text += ";";
    const t = itemText(item);
    if (t.rootAt !== undefined && rootOffset === undefined) rootOffset = text.length + t.rootAt;
    text += t.text;
  });
  return rootOffset === undefined ? { text } : { text, rootOffset };
}

/** True if an item is a real chord-line mark, not free text (free text alone doesn't make a chord line). */
export const isStrong = (item: ChordLineItem) => item.t !== "text";
