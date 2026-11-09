/**
 * Style tokens for chord diagrams, in units of R = height of one fret row.
 * Measured from samples/{Fm,Eb,Bb,Ab}.svg (CLAUDE.md §6.3). Where files
 * disagree, the note says which value was chosen.
 */
export const TOKENS = {
  colors: {
    dark: "#373435",
    gray: "#96989A",
    light: "#FEFEFE",
  },
  fontFamily: "Arimo, Arial, 'Liberation Sans', sans-serif",

  /** Physical size of R at 100% scale: 1.38984 in / 5.3613 R (Eb, Bb). */
  inchesPerR: 0.25924,

  /** Fixed layout box. Width and grid position: Eb and Bb agree to 4 decimals; Ab is 0.037 R right. */
  box: {
    width: 5.3613,
    /** 5.8551 R measured, plus `headroom`. */
    height: 5.8551,
    /**
     * Blank space added above the Corel box so tall superscripts (e.g. "7", "(b9)")
     * are not clipped. Fm.svg grew its own box for the same reason. Confirmed by owner 2026-11-08.
     */
    headroom: 0.2,
  },

  grid: {
    left: 0.8985,
    /** Frame top, measured from the top of the Corel box (before headroom). */
    top: 1.6199,
    strings: 6,
    rows: 4,
    stringSpacing: 0.8184,
    band: 0.2084,
    stroke: 0.0536,
  },

  dot: {
    radius: 0.3572,
    stroke: 0.0268,
    fingerFontSize: 0.643,
    /** Finger number baseline below the dot center (0.227-0.231 measured). */
    fingerBaseline: 0.23,
  },

  barre: {
    height: 0.4661,
    stroke: 0.0268,
  },

  name: {
    rootFontSize: 1.286,
    accidentalFontSize: 1.072,
    /** (verify against cover examples; only Fm has a quality.) */
    qualityFontSize: 0.643,
    /**
     * Slash and bass letter (owner, 2026-11-08): two steps down Word's size list
     * from the 24 pt root, i.e. 20 pt at 100% (1 R = 18.665 pt). Root baseline.
     */
    bassFontSize: 1.0715,
    /** Bass flat/sharp: same 20:24 ratio to the bass letter as the root's has to the root (16.7 pt). */
    bassAccidentalFontSize: 0.8929,
    /**
     * When a superscript quality comes right before the slash, the slash is
     * pulled this far left so it tucks under the superscript (owner reported a
     * gap in "Bbm7/C", 2026-11-08). The slash leans right and its top (0.78 R)
     * is below the superscript, so without this the nearest ink is ~0.40 R
     * apart. 0.2 R leaves ~0.16 R clearance to the "7".
     */
    slashTuckUnderSuperscript: 0.2,
    /**
     * Smaller tuck when the superscript ends with ")": the parenthesis dips
     * below the superscript baseline, so 0.2 R left only 0.07 R (too tight,
     * owner 2026-11-08). 0.1 R gives ~0.17 R, matching the "7" case.
     */
    slashTuckAfterParen: 0.1,
    /** Quality baseline above the root baseline. Fm.svg: 0.643 R before baseline-shift. */
    qualityRaise: 0.643,
    /** Baseline above frame top (0.6992 R in all four). */
    baselineAboveGrid: 0.6992,
    /** Name block center is right of the grid center by this much (0.057-0.058 R in all four). */
    offsetX: 0.058,
    /**
     * Flat/sharp symbols (owner request, 2026-11-08) replace the letters "b"/"#".
     * Drawn as outlines from Noto Music, on the baseline of the run they sit in,
     * at this multiple of that run's font size. 1.0 = the symbol's natural size,
     * smaller than the letter "b" (flat top 0.615 em vs 0.716 em), chosen by the
     * owner to save space. (1.164 would match the letter's height.)
     */
    accidentalGlyphScale: 1.0,
  },

  openMute: {
    fontSize: 0.75,
    /** Baseline above frame top (Eb: 0.153 R). */
    baselineAboveGrid: 0.153,
  },

  fretLabel: {
    fontSize: 0.964,
    /** Right edge (advance box) left of the grid. */
    gapToGrid: 0.442,
    /** Baseline below the row center: Bb and Ab 0.360 R, Eb 0.341 R. */
    baselineBelowRowCenter: 0.36,
  },
} as const;
