/** Chord-line items (chords, bar lines, Legend marks) as styled runs. */
import { CIRCLED_PLUS, CIRCLED_TIMES, FLAT, NEG_CIRCLED, SHARP } from "../text/glyphs.js";
import type { ChordLineItem } from "../model/chart.js";
import type { ChordName } from "../model/voicing.js";
import { runsWidth, runWidth, type Run } from "./runs.js";
import { CHART } from "./tokens.js";

const C = CHART.colors;
const K = CHART.chord;
const M = CHART.marks;

const accidental = (a: string, size: number, fill: string, dy = 0): Run => ({
  kind: "glyph", glyph: a === "b" ? FLAT : SHARP, size: size * K.glyphScale, fill, dy,
});

/** Text with flats/sharps before digits drawn as symbols (e.g. "7(b9)"), all at one size and baseline. */
function withAccidentals(text: string, size: number, fill: string, dy: number): Run[] {
  const runs: Run[] = [];
  let last = 0;
  for (const m of text.matchAll(/[b#](?=\d)/g)) {
    if (m.index > last) runs.push({ kind: "text", text: text.slice(last, m.index), size, face: "arial", fill, dy });
    runs.push(accidental(m[0], size, fill, dy));
    last = m.index + 1;
  }
  if (last < text.length) runs.push({ kind: "text", text: text.slice(last), size, face: "arial", fill, dy });
  return runs;
}

/** "[4&]": black brackets, red beat digits, superscript. */
export function beatRuns(beats: string): Run[] {
  const sup = { size: K.supSize, face: "arial" as const, dy: -K.supRaise };
  return [
    { kind: "text", text: "[", fill: C.ink, ...sup },
    { kind: "text", text: beats, fill: C.beatRed, ...sup },
    { kind: "text", text: "]", fill: C.ink, ...sup },
  ];
}

/** "/F#": the slash and bass letter at bass size, its flat/sharp as a symbol. */
function bassRuns(bass: string, fill: string): Run[] {
  const runs: Run[] = [{ kind: "text", text: "/" + bass.charAt(0), size: K.bassSize, face: "arial", fill }];
  const acc = bass.slice(1);
  if (acc) runs.push(accidental(acc, K.bassAccidentalSize, fill));
  return runs;
}

export function chordRuns(chord: ChordName, opts: { beats?: string; noBass?: boolean; paren?: boolean } = {}): Run[] {
  const fill = opts.noBass ? C.noBass : C.ink;
  const runs: Run[] = [];
  if (opts.paren) runs.push({ kind: "text", text: "(", size: K.rootSize, face: "arial", fill });
  runs.push({ kind: "text", text: chord.root, size: K.rootSize, face: "arial", fill });
  if (chord.accidental) runs.push(accidental(chord.accidental, K.accidentalSize, fill));
  if (chord.quality) runs.push(...withAccidentals(chord.quality, K.supSize, fill, -K.supRaise));
  if (chord.bass) {
    // Tuck the slash under a superscript, as on the cover diagrams.
    if (chord.quality) runs.push({ kind: "space", width: -(chord.quality.endsWith(")") ? K.slashTuckAfterParen : K.slashTuck) });
    runs.push(...bassRuns(chord.bass, fill));
  }
  // The beat tag comes last, after any bass ("C7/E[2a]" in the files).
  if (opts.beats) runs.push(...beatRuns(opts.beats));
  if (opts.paren) runs.push({ kind: "text", text: ")", size: K.rootSize, face: "arial", fill });
  return runs;
}

/**
 * Where a chord's beat sits, as an offset from the start of its runs: the
 * weighted middle of the name (owner, 2026-11-09). The root letter, its
 * flat/sharp and a minor "m" are the core and weigh 1 each, so C# centers
 * between C and #. The rest of the quality (the extension) counts as one
 * unit weighing CHART.chord.extensionWeight, at its own middle, so C#m7(#11)
 * centers a little right of C#m however long the extension is. A slash bass
 * is another unit, lighter still (CHART.chord.bassWeight). Parentheses around the chord and beat tags weigh nothing.
 */
export function chordBeatPoint(chord: ChordName, opts: { beats?: string; noBass?: boolean; paren?: boolean } = {}): number {
  return measureChord(chord, opts).point;
}

/** A chord's beat point and where its core letters (root, flat/sharp, minor "m") start and end, from the start of its runs. */
export function measureChord(chord: ChordName, opts: { beats?: string; noBass?: boolean; paren?: boolean } = {}): { point: number; core: [number, number] } {
  const runs = chordRuns(chord, opts);
  const quality = chord.quality ?? "";
  const minor = /^m(?!aj)/.test(quality);
  // Role of each symbol in run order (one per character or glyph).
  type Role = "none" | "core" | "ext" | "bass";
  const roles: Role[] = [];
  if (opts.paren) roles.push("none");
  roles.push("core");
  if (chord.accidental) roles.push("core");
  for (let i = 0; i < quality.length; i++) roles.push(i === 0 && minor ? "core" : "ext");
  if (chord.bass) for (let i = 0; i < 1 + chord.bass.length; i++) roles.push("bass");

  let x = 0, k = 0, sum = 0, total = 0;
  let core: [number, number] | undefined;
  const span: Record<"ext" | "bass", [number, number] | undefined> = { ext: undefined, bass: undefined };
  for (const r of runs) {
    if (r.kind === "space") { x += r.width; continue; }
    const symbols = r.kind === "text" ? [...r.text] : [null];
    for (const ch of symbols) {
      const w = ch === null ? runWidth(r) : runWidth({ ...(r as Extract<Run, { kind: "text" }>), text: ch });
      const role = roles[k] ?? "none";
      if (role === "core") { sum += x + w / 2; total += 1; core = core ? [core[0], x + w] : [x, x + w]; }
      else if (role === "ext" || role === "bass") {
        const sp = span[role];
        span[role] = sp ? [sp[0], x + w] : [x, x + w];
      }
      x += w; k++;
    }
  }
  for (const [sp, weight] of [[span.ext, K.extensionWeight], [span.bass, K.bassWeight]] as const) {
    if (!sp) continue;
    sum += weight * (sp[0] + sp[1]) / 2;
    total += weight;
  }
  return { point: total ? sum / total : 0, core: core ?? [0, 0] };
}

/**
 * Color for riff `riff` (1-based). Only two colors exist so far; a third riff
 * reuses the last one until a color is chosen (open question).
 */
export function riffColor(riff: number): string {
  const colors = CHART.riffColors;
  return colors[Math.min(Math.max(riff, 1), colors.length) - 1]!;
}

const small = (text: string, fill: string, face: "arial" | "arialBold" | "arialItalic" = "arial"): Run => ({
  kind: "text", text, size: M.smallSize, face, fill,
});

export function itemRuns(item: ChordLineItem): Run[] {
  switch (item.t) {
    case "bar":
      return [{ kind: "text", text: "|", size: M.size, face: "arial", fill: C.ink }];
    case "same":
      return [{ kind: "text", text: "-", size: M.size, face: "arial", fill: C.ink }];
    case "chord": {
      const opts: { beats?: string; noBass?: boolean; paren?: boolean } = {};
      if (item.beats !== undefined) opts.beats = item.beats;
      if (item.noBass !== undefined) opts.noBass = item.noBass;
      if (item.paren !== undefined) opts.paren = item.paren;
      return chordRuns(item.chord, opts);
    }
    case "instrument": {
      const op: Run =
        item.op === "only" ? { kind: "glyph", glyph: CIRCLED_PLUS, size: M.smallSize, fill: C.red }
        : item.op === "except" ? { kind: "glyph", glyph: CIRCLED_TIMES, size: M.smallSize, fill: C.red }
        : small(item.op === "add" ? "+" : "-", C.red, "arialBold");
      const runs = [small("(", C.ink), op, small(item.text, C.red), small(")", C.ink)];
      return item.beats ? [...runs, ...beatRuns(item.beats)] : runs;
    }
    case "bass": {
      const runs = bassRuns(item.bass, C.ink);
      return item.beats ? [...runs, ...beatRuns(item.beats)] : runs;
    }
    case "text": {
      // Free text in red, with any circled plus/times drawn as the Legend symbols.
      const body: Run[] = [];
      for (const part of item.text.split(/([⊕⊗])/u)) {
        if (part === "⊕") body.push({ kind: "glyph", glyph: CIRCLED_PLUS, size: M.smallSize, fill: C.red });
        else if (part === "⊗") body.push({ kind: "glyph", glyph: CIRCLED_TIMES, size: M.smallSize, fill: C.red });
        else if (part) body.push(small(part, C.red));
      }
      return item.paren === false ? body : [small("(", C.ink), ...body, small(")", C.ink)];
    }
    case "stop": {
      const slash: Run = { kind: "text", text: "//", size: M.size, face: "arialBold", fill: item.kind === "hold" ? C.green : C.red };
      if (!item.beats) return [slash];
      return item.beatsFirst ? [...beatRuns(item.beats), slash] : [slash, ...beatRuns(item.beats)];
    }
    case "direction":
      if (item.text === "simile" || item.text === "ritard") return [small("(", C.ink), small(item.text, C.red, "arialItalic"), small(")", C.ink)];
      if (item.text === "NC") return [small("(NC)", C.red)];
      return [small(item.text, C.red)];
    case "times":
      return [small("(", C.ink), small(item.text, C.red), small(")", C.ink)];
    case "ref": {
      const fill = riffColor(item.riff ?? 1);
      const glyph = NEG_CIRCLED[item.n - 1];
      if (!glyph) return [small(`(${item.n})`, fill)];
      return [{ kind: "glyph", glyph, size: M.refSize, fill }];
    }
    case "meter":
      return [{ kind: "stack", top: String(item.top), bottom: String(item.bottom), size: M.meterSize, face: "arialBold", fill: C.red }];
    case "arrowDown":
      return [{ kind: "text", text: "↓", size: M.size, face: "arial", fill: C.blue }];
    case "endingOpen":
      return [
        { kind: "text", text: "{", size: M.size, face: "arial", fill: C.ink },
        { kind: "text", text: item.n + ".", size: M.endingNumberSize, face: "arialBold", fill: C.red },
      ];
    case "endingClose":
      return [{ kind: "text", text: "}", size: M.size, face: "arial", fill: C.ink }];
  }
}

/** No gap between these neighbours ("|G", "G//", "//|", "{1.//}"); one small gap otherwise. */
export function gapBetween(a: ChordLineItem, b: ChordLineItem): number {
  if (a.t === "bar" && b.t !== "same") return 0;
  if (b.t === "stop" || b.t === "endingClose" || a.t === "endingOpen") return 0;
  if (a.t === "stop" && b.t === "bar") return 0;
  return CHART.spacing.itemGap;
}

/**
 * Runs for a group of items, plus `hang`: the width of everything before the
 * group's first chord (e.g. a leading "|"), which is drawn left of the
 * anchored character so the chord itself sits over the syllable. A group
 * without a chord does not hang. `beatPoint` is where the group's beat sits:
 * the first chord's weighted middle, else the "-" of "| -" or a timed stop's
 * "//" middle; undefined for groups with none (they align by their left edge).
 */
export function groupRuns(items: ChordLineItem[]): { runs: Run[]; hang: number; beatPoint: number | undefined; core?: [number, number] } {
  const runs: Run[] = [];
  let hang: number | undefined, beatPoint: number | undefined, core: [number, number] | undefined;
  items.forEach((item, i) => {
    const prev = items[i - 1];
    const gap = prev ? gapBetween(prev, item) : 0;
    if (gap) runs.push({ kind: "space", width: gap });
    const before = runsWidth(runs);
    if (item.t === "chord" && hang === undefined) hang = before;
    if (beatPoint === undefined) {
      if (item.t === "chord") {
        const opts: { beats?: string; noBass?: boolean; paren?: boolean } = {};
        if (item.beats !== undefined) opts.beats = item.beats;
        if (item.noBass !== undefined) opts.noBass = item.noBass;
        if (item.paren !== undefined) opts.paren = item.paren;
        const m = measureChord(item.chord, opts);
        beatPoint = before + m.point;
        core = [before + m.core[0], before + m.core[1]];
      } else if (item.t === "same") beatPoint = before + runsWidth(itemRuns(item)) / 2;
      else if (item.t === "bass") beatPoint = before + runsWidth(bassRuns(item.bass, C.ink)) / 2;
      else if (item.t === "instrument" && item.beats !== undefined) beatPoint = before + runsWidth(itemRuns({ t: "instrument", op: item.op, text: item.text })) / 2;
      else if (item.t === "stop" && item.beats !== undefined) {
        const slashAt = item.beatsFirst ? before + runsWidth(beatRuns(item.beats)) : before;
        beatPoint = slashAt + runsWidth(itemRuns({ t: "stop", kind: item.kind })) / 2;
      }
    }
    runs.push(...itemRuns(item));
  });
  return core ? { runs, hang: hang ?? 0, beatPoint, core } : { runs, hang: hang ?? 0, beatPoint };
}
