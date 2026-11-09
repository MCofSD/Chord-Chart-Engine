/** Chord-line items (chords, bar lines, Legend marks) as styled runs. */
import { CIRCLED_PLUS, CIRCLED_TIMES, FLAT, NEG_CIRCLED, SHARP } from "../text/glyphs.js";
import type { ChordLineItem } from "../model/chart.js";
import type { ChordName } from "../model/voicing.js";
import { runsWidth, type Run } from "./runs.js";
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
    runs.push({ kind: "text", text: "/" + chord.bass.charAt(0), size: K.bassSize, face: "arial", fill });
    const acc = chord.bass.slice(1);
    if (acc) runs.push(accidental(acc, K.bassAccidentalSize, fill));
  }
  // The beat tag comes last, after any bass ("C7/E[2a]" in the files).
  if (opts.beats) runs.push(...beatRuns(opts.beats));
  if (opts.paren) runs.push({ kind: "text", text: ")", size: K.rootSize, face: "arial", fill });
  return runs;
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
      return [small("(", C.ink), op, small(item.text, C.red), small(")", C.ink)];
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
 * without a chord does not hang.
 */
export function groupRuns(items: ChordLineItem[]): { runs: Run[]; hang: number } {
  const runs: Run[] = [];
  let hang: number | undefined;
  items.forEach((item, i) => {
    const prev = items[i - 1];
    const gap = prev ? gapBetween(prev, item) : 0;
    if (gap) runs.push({ kind: "space", width: gap });
    if (item.t === "chord" && hang === undefined) hang = runsWidth(runs);
    runs.push(...itemRuns(item));
  });
  return { runs, hang: hang ?? 0 };
}
