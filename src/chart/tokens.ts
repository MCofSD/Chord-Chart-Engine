/**
 * Chart style tokens, in points, measured from the sample PDFs (mostly
 * "Since U Been Gone"; drift between files noted). US Letter, 1 pt = 1/72".
 */
import { LEGEND_COLORS } from "../legend/registry.js";

export const CHART = {
  page: {
    width: 612,
    height: 792,
    /**
     * Lowest y for a section's closing rule. SUBG page 2 ends with content at
     * 768.6 and its rule just below; the footer baseline is 789.1. (verify)
     */
    bottomLimit: 779,
  },

  colors: {
    ink: "#000000",
    lyric: "#808080",
    /** "{2. I get}" text inside an ending in the lyric line. */
    lyricUpright: "#7F7F7F",
    /** Gray chord = no bass (Legend **). Not measured separately; lyric gray. (verify) */
    noBass: "#808080",
    rule: "#A6A6A6",
    ...LEGEND_COLORS,
  },

  /**
   * Colors for repeated sections, in priority order (owner, 2026-11-08):
   * the first repeated section from the top of the chart is blue, the second
   * green, the third purple. Values are the font colors in "Awitin Mo At
   * Isasayaw Ko". A label is colored only when a later "Repeat ..." line
   * points back to its section; other labels print black, regular. A fourth
   * repeated section reuses purple, with a warning.
   */
  repeatColors: ["#0070C0", "#00B050", "#7030A0"],

  header: {
    baseline: 17.2,
    /** Date, Calibri 10, at the left margin. */
    dateSize: 10,
    left: 7.2,
    right: 604.8,
    /**
     * "TITLE" Calibri Bold 18 then " (Artist, Year)" Calibri 14, centered as one
     * block on x = 295.3 (all five sample PDFs agree to 0.1 pt; not the page center).
     */
    titleCenter: 295.3,
    titleSize: 18,
    artistSize: 14,
    /** "(Key of G, BPM=131)" Calibri 12, right-aligned. */
    keySize: 12,
  },

  footer: { baseline: 789.1, size: 11 },

  rule: {
    /** Section rules run nearly edge to edge (5.8 to 606.4 pt). */
    x1: 5.8,
    x2: 606.4,
    thickness: 0.5,
    /** First rule, under the header (every page, including pages without a header). */
    firstY: 22.1,
  },

  section: {
    /** Label column: Arial 9 at the left margin. Awitin uses 11 pt; 9 pt chosen (most files). */
    labelX: 7.2,
    labelSize: 9,
    /** Ordinal suffix ("st" in "1st Ver"): 6 pt, raised 3 pt. */
    ordinalSize: 6,
    ordinalRaise: 3,
    /** First baseline = rule + this (SUBG: 16.4-16.6 pt). Rows start at rule + padTop. */
    padTop: 1.9,
    /** Rule = last row bottom + this (SUBG: last baseline + 10.3). */
    padBottom: 6.6,
    /** Snippet top below the rule. */
    snippetPadTop: 1.9,
    /** When a section starts with a snippet, its label (and the overlay text) sit 10 pt below the rule. */
    labelBaselineOverSnippet: 10,
  },

  content: {
    /** Music starts at 0.6". */
    left: 43.2,
    right: 604.8,
  },

  row: {
    /** Chord line and lyric line are each one 16 pt Arial row. */
    height: 18.4,
    baseline: 14.7,
  },

  chord: {
    rootSize: 16,
    /** Flat/sharp after the root: 12 pt in the files ("B" 16 + "b" 12). */
    accidentalSize: 12,
    /** Quality and beat tags: 10.6 pt superscript, raised 5.5 pt. */
    supSize: 10.6,
    supRaise: 5.5,
    /** Slash bass: "/F" 14 pt, its accidental 11 pt. */
    bassSize: 14,
    bassAccidentalSize: 11,
    /** Symbol outlines at this multiple of the run size (same rule as diagrams). */
    glyphScale: 1.0,
    /**
     * Slash tucked under a preceding superscript, as on the cover diagrams
     * (owner, 2026-11-08). Computed from the Arimo outlines at chart sizes:
     * untucked, the slash is 4.45 pt from a superscript "7" and 2.96 pt from
     * a ")"; these leave ~2 pt in both cases, the diagrams' clearance scaled
     * to a 16 pt root.
     */
    slashTuck: 2.45,
    slashTuckAfterParen: 1.0,
  },

  /** Riff-reference colors by riff (owner, 2026-11-08): first repeated riff dark, second light. */
  riffColors: ["#0000FF", "#00B0F0"],

  marks: {
    /** Bar lines, "-", stops and braces: 16 pt like the chords. */
    size: 16,
    /** Instrument tags, (simile), (2x): 12 pt. */
    smallSize: 12,
    /** Repeat-ending number "1." in braces: Arial Bold 9. */
    endingNumberSize: 9,
    /** Circled reference number: 14 pt. */
    refSize: 14,
    /** Stacked meter digits (an image in the files, ~7 x 17 pt). (verify) */
    meterSize: 9,
  },

  lyric: {
    size: 16,
    /** "(thanks to you)" asides: 12 pt. */
    asideSize: 12,
  },

  note: {
    /** "Repeat " Arial 12 then the section name Arial Bold 16 in its color. */
    size: 12,
    sectionSize: 16,
  },

  spacing: {
    /** Minimum gap between two chord-line groups: one 16 pt space. */
    groupGap: 4.45,
    /** Gap between items in a group, except next to bar lines and stops. */
    itemGap: 3.3,
    /**
     * Word's default tab stops: every 0.5" from the 0.1" margin (so 0.6" is a
     * stop). Chords past the end of the lyric go on this grid (owner, 2026-11-08).
     */
    tabOrigin: 7.2,
    tabStop: 36,
    /**
     * "before"/"after" chords: distance to the syllable they belong to (near)
     * and to the other side of the gap (far). The asymmetry shows the timing. (verify)
     */
    timingNear: 2,
    timingFar: 12,
  },

  /** Arial Narrow is about 82% of Arial's width (measured 0.81-0.82). Used to fit long lines. */
  narrowScale: 0.82,
} as const;
