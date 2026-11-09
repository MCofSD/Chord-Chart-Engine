/**
 * Voicing model: one chord diagram as data (CLAUDE.md §6.2).
 *
 * Frets are absolute fret numbers. The diagram shows 4 fret rows starting at
 * `windowStartFret`; row r shows fret `windowStartFret + r`.
 * Strings are listed left to right as drawn (index 0 = leftmost = low E in
 * standard tuning).
 */

export type Finger = 1 | 2 | 3 | 4 | "T";

export type StringState =
  /** Dark dot on a fret row, optional finger number printed in it. */
  | { kind: "fretted"; fret: number; finger?: Finger }
  /** Gray dot with a white "X" on a fret row (e.g. the muted ends of a barre). */
  | { kind: "muted"; fret: number }
  /** Open string. Nothing is drawn for it (owner decision, 2026-11-08). */
  | { kind: "open" }
  /** Lowercase "x" printed above the frame. */
  | { kind: "mutedOpen" };

export type StringKind = StringState["kind"];

export interface ChordName {
  /** Letter A-G. */
  root: string;
  /** Printed as the letter "b" or "#" after the root, not superscripted. */
  accidental?: "b" | "#";
  /** Quality/extension, printed as a superscript (e.g. "m", "m7", "7(b9b13)"). */
  quality?: string;
  /** Slash bass, printed at root size after "/" (e.g. "C", "Bb"). (verify) */
  bass?: string;
}

export interface Barre {
  /** Absolute fret of the bar. */
  fret: number;
  /** First and last string index covered by the bar (inclusive). */
  from: number;
  to: number;
  /**
   * String-index ranges drawn dark (sounding). The rest of the bar is gray.
   * In the samples a range only appears where two or more adjacent strings
   * sound; a single sounding string shows only its dot.
   */
  sounding: [number, number][];
}

export interface Voicing {
  chord: ChordName;
  /** Exactly 6 entries, left to right as drawn. */
  strings: StringState[];
  /** Fret shown in the first (top) row. */
  windowStartFret: number;
  /**
   * Row (0-3) beside which the fret number `windowStartFret + row` is printed.
   * Omitted means no fret number, which means the top row is fret 1, so it is
   * required whenever `windowStartFret` is not 1.
   */
  fretLabelRow?: number;
  barres?: Barre[];
  /** Free-text note shown with the diagram on covers, e.g. "for Bridge only". */
  note?: string;
  /** Importer flags for human review. Not rendered. */
  review?: string[];
}

export const STRING_COUNT = 6;
export const FRET_ROWS = 4;

/** Row index (0-3) of an absolute fret, or undefined if outside the window. */
export function rowOfFret(v: Pick<Voicing, "windowStartFret">, fret: number): number | undefined {
  const r = fret - v.windowStartFret;
  return r >= 0 && r < FRET_ROWS ? r : undefined;
}

/** Display name as plain text, e.g. "Ebm7/G". */
export function chordLabel(c: ChordName): string {
  return c.root + (c.accidental ?? "") + (c.quality ?? "") + (c.bass ? "/" + c.bass : "");
}
