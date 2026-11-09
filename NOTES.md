# Diagram generator: notes

Status of CLAUDE.md §6 as of 2026-11-08. Run everything with `npm test`; build the preview with `npm run preview` and open `preview/index.html`.

## What was measured

All four samples agree with the §6.3 tokens after normalizing by R (one fret row). Values are in [src/diagram/tokens.ts](src/diagram/tokens.ts). Where files disagreed:

| Token | Measured | Used |
|---|---|---|
| Fret number baseline below row center | Eb 0.341 R, Bb 0.360 R, Ab 0.360 R | 0.36 R |
| Grid left edge in the box | Eb, Bb 0.8985 R; Ab 0.935 R | 0.8985 R |
| Finger number baseline below dot center | 0.227 to 0.231 R | 0.23 R |

New tokens not in §6.3:
- **Name block is 0.058 R right of grid center** in all four files (advance-box center). Kept as `name.offsetX`.
- **Superscript position**: Fm's `m` is 0.643 R above the root baseline before `baseline-shift`; Corel sized the viewBox for exactly that position. Used as an explicit y.

## Could not be reproduced exactly, or deliberately not copied

- **Hand-placed dots** are snapped to string/row centers (e.g. Fm string 1 is 0.07 R off; Ab's "1" dot 0.07 R). This is most of the remaining pixel difference.
- **Padded `x` text** (Eb): the original marks sit up to 0.42 R off their strings. We snap with an ordered best fit (strings 0, 4, 5) and flag it. Chrome collapses the padding in the original, so Eb.svg already shows all three marks bunched on the left there.
- **Fm.svg's `m`** is missing in Chrome too (pushed out of the viewBox by `baseline-shift`), not only in LibreOffice.
- **Box size**: every diagram uses one box (1.39" x 1.57" at 100%). That is the Eb/Bb box plus **0.2 R (0.05") of headroom** at the top, so tall superscripts such as `7` or `(b9)` are not clipped. Fm.svg (1.25" wide, taller) is not reproduced at its own size. Headroom confirmed by the owner, 2026-11-08.
- **Barre overrun**: Corel barres sometimes run 0.03 R past the last string (hidden under the end X). Ours end exactly on the string.
- **Fonts**: comparisons use bundled Arimo for both sides (Corel files ask for Arial). Glyphs are metric-identical but not pixel-identical to Arial.
- **Kerning** inside a quality string (e.g. `m7`) is not modeled; widths use Arial advances without kerning. Effect is a fraction of a point on centering.

## Visual check

resvg 2.6, 60 px per R, pixelmatch threshold 0.1, both images aligned on the grid frame. Tolerance: **at most 4% of inked pixels differ** (one missing dot adds about 5.5%).

| Sample | Differing pixels | Share of ink | Share of window |
|---|---|---|---|
| Fm | 819 | 3.24% | 0.70% |
| Eb | 491 | 2.62% | 0.42% |
| Bb | 121 | 0.47% | 0.10% |
| Ab | 694 | 2.58% | 0.59% |

Superscripts checked in resvg (test) and headless Chrome 
(preview screenshot). LibreOffice was not tested.

## Flat and sharp symbols (owner request, 2026-11-08)

- Printed as ♭/♯ everywhere: after the root, in the slash bass, and in extensions. In extensions only a `b`/`#` directly before a digit changes (`7(b9b13)` -> `7(♭9♭13)`), so words like `sus` or `add` are untouched.
- Arimo has no ♭ (and no ⊕/⊗), so the symbols are drawn as **vector outlines** taken from Noto Music (SIL OFL, in `assets/fonts/`). They look the same in every renderer and need no font. Regenerate with `npx tsx scripts/gen-accidentals.ts assets/fonts/NotoMusic_400Regular.ttf`.
- Size: the symbol's natural size at the font size of the run it sits in (scale 1.0), on that run's baseline. This is smaller than the old letter "b" (the flat's top is at 0.615 em, the letter's at 0.716 em) and saves space, by owner decision 2026-11-08. A scale of 1.164 would match the letter's height.
- Vertical position: flats sit on the baseline as designed (a slight descent of 0.055 em). **Sharps are lifted so their ink bottom sits on the baseline**, bottom-aligned with the root letter (owner, 2026-11-08). In a superscript the sharp sits on the superscript's baseline the same way, not on the root's.
- The data still stores `b`/`#`. `renderDiagram(v, { accidentals: "letter" })` prints letters like the Corel files; the visual test uses it to compare against the originals.

## Model changes from the §6.2 proposal

- Dropped `sounding: true` on fretted strings (always true, so redundant).
- `muted` requires `fret` (the samples only use gray X on a fret row; above-nut x is `mutedOpen`).
- Added `review: string[]` for importer flags.
- `open` strings: nothing is drawn (owner decision, 2026-11-08). The importer reads a string with no mark as open, without a flag.
- Slash bass (owner, 2026-11-08): `/` and bass letter at 20 pt, two steps down Word's size list from the 24 pt root; a bass flat/sharp at 16.7 pt (same 20:24 ratio as the root's flat). All on the root baseline. When a superscript comes right before the slash (`Bbm7/C`), the slash is pulled 0.2 R (3.7 pt) left so it tucks under the superscript; without it the slanted slash left a visible gap (owner report, 2026-11-08). After a closing parenthesis (`G7(b9)/F`) the shift is 0.1 R instead, because ")" dips below the superscript baseline and 0.2 R was too tight (owner, 2026-11-08); both cases leave about 0.16 R of clearance. `npx tsx scripts/zoom-names.ts out.html` renders enlarged slash chords for checking spacing. All measured sizes are whole points at 100%: root 24, root flat 20, quality 12, fret number 18, `x` marks 14.

## Assumptions flagged for review

- No fret number printed means the top row is fret 1 (owner rule, 2026-11-08), as in Fm. The importer applies this without a flag, and the validator rejects a voicing that starts above fret 1 without a fret number.
- White hairlines at row centers (Eb, Ab) and the white circle (Eb) are Corel "snap to middle" helpers (owner, 2026-11-08). They are ignored without a flag; the same shapes in Fm and Bb are invisible. Any other white shape is still flagged. The circle is assumed to be a snap helper like the lines.

## Housekeeping

- `samples/` is flat, not in the subfolders listed in CLAUDE.md §3. Missing: the 24K Magic cover image, the Legend image, `A Dios Le Pido.docx`. Extra: `All I Wanted - Paramore (2009).docx`.
- `diagram-generator.html` (earlier browser prototype) is superseded by `src/diagram/render.ts`; left in place.
- `src/diagram/metrics.ts` is generated: `npx tsx scripts/gen-metrics.ts`. Fixtures are regenerated with `npx tsx scripts/import-samples.ts --write` (check the diff by hand).

# Chart renderer (phase 1): notes

Started 2026-11-08 (CLAUDE.md §2 item 3; the cover layout solver, item 2, is still to do). Code: `src/model/chart.ts` (data), `src/chart/` (layout and SVG), `src/legend/registry.ts` (symbols). Output: one SVG per US Letter page, deterministic, no browser.

## Decisions (owner, 2026-11-08)

- Flats and sharps print as symbols (♭ ♯), same rules as the diagrams.
- **Chord timing is shown through spacing.** Each chord group is pinned to a lyric character and placed one of three ways (`Anchor.place`):
  - `on` (default): the root sits right over the syllable.
  - `before`: played just before the syllable. The lyric opens a gap and the chord sits close to that syllable (2 pt) and well clear of the previous one (12 pt).
  - `after`: played just after the previous syllable. Same gap, mirrored.
  The 2 / 12 pt values are first guesses. (verify)
- Chords past the end of the lyric, and chord-only lines, go on Word's 0.5" tab grid (stops every 36 pt from the 0.1" margin), as today.
- **Riff references:** dark blue `#0000FF` by default; light blue `#00B0F0` marks a second repeated riff, so the reader knows which riff to look at. Set per reference with `riff: 2`. Only two colors are defined so far; a third riff reuses light blue until a color is chosen.
- **Section colors mean "repeated".** A label is colored (bold) only when a later "Repeat ..." line points back to that section, so the eye can find it. Other labels print black. Colors go by **priority from the top of the chart**, not by section type: the first repeated section is blue `#0070C0`, the second green `#00B050`, the third purple `#7030A0` (the font colors in "Awitin Mo At Isasayaw Ko"). A section repeated more than once keeps one color; the Repeat line prints each name in its section's color. A fourth repeated section reuses purple, with a warning. A Repeat names a section by type (the latest earlier one) or by exact label (`"label": "1st Ver"`); references that match nothing produce a warning.
- The slash is tucked under a superscript, as on the cover diagrams (`B♭m7/C`), to save space: 2.45 pt after a superscript, 1.0 pt after one ending in ")". Both leave about 2 pt of clearance, computed from the glyph outlines at chart sizes. The beat tag comes after the bass (`C7/E[2a]`), as in the files.
- Marks not defined in the Legend (`| -`, `(+Bnd)`/`(-Drm)`, `(NC)`, `(simile)`, `(ritard)`, ↓, stacked meter) are **display-only**: drawn as today, no meaning attached. They are listed in the registry with `confirmed: false`.
- A 4-line excerpt of one real chart is kept as a test fixture (`test/fixtures/charts/subg-chorus.json`). It is **local-only** (gitignored, the repo is public), like the sample chart PDFs; the chart visual test and the preview's comparison section skip when it is missing.
- **Lyric entering after the downbeat** (owner, 2026-11-09): a line can say the lyric comes in on a later beat than the bar's first chord (`lyricEntry: "2"`, beat-tag syntax, subdivisions allowed). The chord stays at the left edge on beat 1 and the lyric starts 25.2 pt (0.35") further right per beat, so the gap is a feature, not loose spacing. Measured from the PDFs: beat 2 about 26 pt, beat 3 50.4 pt, beat 4 79 pt, beat 1& 11.6-16 pt (Since U Been Gone); 21.6 / 43.2 pt in American Boy and So Easy, which use tab stops. (verify)
- **Rhythm spacing** (owner, 2026-11-09). Chords and lyrics are spaced in proportion to time so the reader sees the rhythm; chords still sit over their syllables. Rules in [src/chart/timing.ts](src/chart/timing.ts) and [src/chart/line.ts](src/chart/line.ts):
  - Times come from the chord line: each bar line starts a bar (meter top number of beats, default 4/4, `meta.meter`, inline meter marks carry forward). Untagged, the bar's first chord (or "-") is on beat 1 and one other chord on the middle beat (beat 3 in 4/4; odd meters have none). Any other chord must carry a beat tag, else it is untimed and the line warns. Content before the first bar line is untimed.
  - Lyrics: optional, sparse `rhythm` marks (character + bar + beat) where natural spacing would mislead; `lyricEntry` is the shorthand for the first syllable.
  - **What sits on the beat** (owner, 2026-11-09): the *middle* of a syllable, and the *weighted middle* of a chord. A syllable runs from its character to the end of the word or the next anchored/marked character. A chord's core (root letter, flat/sharp, minor "m") weighs 1 per symbol, so C# centers between C and #; the extension (everything else in the quality) counts as one unit of weight `chord.extensionWeight` (0.5, verify) at its own middle, so C#m7(#11) centers a little right of C#m. A slash bass is one more unit, lighter than an extension but not nothing (owner): `chord.bassWeight` 0.25 (verify). A chord "on" a syllable has its weighted middle over the syllable's middle.
  - Beat 1 sits just right of the opening bar line; each beat is `beatWidth` (25.2 pt) further, measured from the first timed point. Text that doesn't fit its time pushes things right, and everything after keeps at least its proportional distance, so bar lengths still read correctly. A gap that splits a word always gets its hyphen ("start - ed").
  - Under a notation snippet with a `timeline` (beat-1 x and width of each bar in the image, measured once), the next line uses the image's axis, absolutely, so syllables line up under the notes.
  - Fit order: full spacing; less rhythm spacing (down to text-only); compression to Arial Narrow width (82%); then wrapping onto more rows at bar lines with the bars spread evenly (an odd extra bar goes to the earlier row) and one shared beat width so the rows' bars line up. Font sizes never shrink. A chart longer than 2 pages warns.
  - Since U Been Gone verse lines 1-2: line 1's rhythm is the owner's (2, 2&, 3, 4& | 1, 1&, 2, 3). Line 2's is the owner's too (2, 2&, 3, 3&, 4, 4& | 1, 2, 2&); read from the original by syllable middles it had landed on clean eighths, which supports the middle-of-syllable rule.

## Future: web/tablet view

On paper the reader's eye goes back to a repeated section, which keeps charts to two pages. A web/tablet view could instead copy the referenced section in place. The model already supports this: `resolveRepeats()` in `src/model/chart.ts` finds the exact section each Repeat line means.

## Measured (from the sample PDFs)

All values are in [src/chart/tokens.ts](src/chart/tokens.ts). Highlights:
- Header in **Calibri** (Carlito used): date 10, title bold 18 uppercase + artist 14, key 12 right-aligned. The title block is centered on **x = 295.3 pt in all five PDFs** (a center tab, not the page center).
- Chord root Arial 16; quality and beat tags 10.6 pt raised 5.5 pt; root flat 12 pt; slash bass 14 pt, its accidental 11 pt. Beat tags: black brackets, red `#FF0000` digits.
- Lyrics Arial 16 `#808080`; backup italic; asides 12 pt.
- Rows every 18.4 pt; first baseline 16.6 pt below a section rule; rule 10.3 pt below the last baseline. Rules 0.5 pt `#A6A6A6`, 5.8–606.4 pt.
- Labels Arial 9 at 0.1"; repeated sections bold in their priority color; ordinals 6 pt raised 3 pt. Music starts at 0.6".
- Arial Narrow ≈ 0.82 × Arial width (measured 0.81–0.82), so "narrow" is Arimo compressed horizontally; there is no separate narrow font. Lines too wide for the page are compressed this way, with a warning below 0.82.

## Visual check against the original

`test/chart-visual.test.ts` compares the excerpt with page 1 of the Since U Been Gone PDF:
- header positions: title within 0.4 pt, key within 0.14 pt
- all 8 row baselines and the closing rule within 0.3 pt of the original's spacing
- header strip pixels: 8.35% of ink differs (Carlito vs Calibri glyph shapes); tolerance 10%

Side-by-side images: `test/output/chart-chorus-*.png`, and in `preview/index.html`.

## Differences from today's charts

- Inconsistencies in the files were unified: label size 9 pt (Awitin uses 11), rules gray `#A6A6A6` (Awitin's are black), superscript raise 5.5 pt (some Arial Narrow runs use 3.9).
- The slash in `C7/E` is tucked under the superscript (matching the covers), so slash chords are a little narrower than in the files.
- Fonts: Carlito for Calibri, Arimo for Arial. ⊕ ⊗ come from Noto Sans Math, ❶–❿ from Carlito, ♭ ♯ from Noto Music, all drawn as outlines.

## Open questions

1. A color for a third repeated riff, if one is ever needed (light blue is reused for now).
2. Gray "no bass" chord color: not isolated in the PDFs; using the lyric gray `#808080`.
3. Meanings of the display-only marks (CLAUDE.md §10.4).
4. Bottom limit for page breaks set to 779 pt (sections that don't fit move to the next page; a section is split only if taller than a page). (verify)
5. A color for a fourth repeated section, if ever needed (purple is reused for now).
6. The `before`/`after` spacing (2 pt near, 12 pt far) is a first guess; check it on a real chart.
