/**
 * Music Legend symbol registry (CLAUDE.md §5).
 *
 * One entry per mark that can appear in a chart. `confirmed` entries come
 * from the printed Legend and carry its meaning. Unconfirmed entries are
 * display-only (owner decision, 2026-11-08): they are drawn exactly as in
 * today's charts, and their meaning stays an open question (§10.4).
 *
 * The chart renderer takes its colors from here; later the parser, editor
 * palette, validation and the printed Legend block will too.
 */

export const LEGEND_COLORS = {
  red: "#EE0000",
  /** Beat-tag digits are a slightly different red in the files. */
  beatRed: "#FF0000",
  green: "#00B050",
  /** Dark blue: the first repeated riff's circled numbers (and the down arrow). The second riff uses light #00B0F0 (src/chart/tokens.ts riffColors). */
  blue: "#0000FF",
  black: "#000000",
} as const;

export interface LegendEntry {
  id: string;
  /** How it looks, for documentation and the editor palette. */
  display: string;
  confirmed: boolean;
  /** Meaning from the Legend. Absent for display-only marks. */
  meaning?: string;
}

export const LEGEND: readonly LegendEntry[] = [
  { id: "beat", display: "[#] red, superscript", confirmed: true,
    meaning: "Beat at which a chord changes (optional). & = 8th-note intervals; e, &, a = 16th-note intervals; te, ta = triplet intervals. Lists allowed, e.g. [1&,2,3,4]; a bare subdivision inherits the previous beat." },
  { id: "repeatTime", display: "{#.}", confirmed: true, meaning: "On repeats, # says which time to play (1st, 2nd...)." },
  { id: "ref", display: "blue circled number", confirmed: true,
    meaning: "Reference to a similar riff/pattern. Dark blue by default; light blue marks a second repeated riff, so the two are easy to tell apart (owner, 2026-11-08)." },
  { id: "halfTime", display: "1/2T red", confirmed: true, meaning: "Half time." },
  { id: "only", display: "circled plus, red", confirmed: true, meaning: "Only, e.g. (⊕Gtr) = guitar only." },
  { id: "except", display: "circled times, red", confirmed: true, meaning: "Except, e.g. (⊗last two bars)." },
  { id: "stopAbrupt", display: "// red", confirmed: true,
    meaning: "Abrupt stop: before a beat, end before that beat; after, end on that beat; multiple beats shown means more than one hit." },
  { id: "stopHold", display: "// green", confirmed: true, meaning: "Stop and hold; multiple beats shown means more than one hit." },
  { id: "repeat", display: ": : red", confirmed: true, meaning: "Repeat passage between the two colons." },
  { id: "dstrn", display: "dstrn red", confirmed: true, meaning: "Distortion." },
  { id: "vamp", display: "Vamp red", confirmed: true, meaning: "Play the passage as many times as needed." },
  { id: "noBass", display: "gray chord", confirmed: true, meaning: "Do not play any bass guitar." },
  { id: "backup", display: "italic lyrics", confirmed: true, meaning: "Lyrics sung by backup vocalists." },

  // Display-only: used in charts, not defined in the Legend.
  { id: "bar", display: "|", confirmed: false },
  { id: "sameBar", display: "| - (dash after a bar line)", confirmed: false },
  { id: "add", display: "(+Bnd) bold red plus", confirmed: false },
  { id: "remove", display: "(-Drm) bold red minus", confirmed: false },
  { id: "nc", display: "(NC)", confirmed: false },
  { id: "simile", display: "(simile) red italic", confirmed: false },
  { id: "ritard", display: "(ritard)", confirmed: false },
  { id: "arrowDown", display: "down arrow", confirmed: false },
  { id: "meter", display: "stacked red numbers", confirmed: false },
  { id: "times", display: "(2x) red count", confirmed: false },
  { id: "adlib", display: "parentheses around lyrics", confirmed: false },
];

export function legendEntry(id: string): LegendEntry | undefined {
  return LEGEND.find((e) => e.id === id);
}
