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

# Formatting rules file and PDF chart importer

## Rules file (owner, 2026-11-09)

All formatting rules live in [rules/chart-rules.json](rules/chart-rules.json), read by both the renderer and the importer, so changing a rule needs no code change in either tool. Keys starting with `_` are notes. Sections:
- `legend`: Legend mark colors. `render`: everything the renderer draws with (was `src/chart/tokens.ts`, now a typed view of this). `timing`: default meter.
- `sections`: label -> section type patterns (also used for "Repeat ..." lines). `symbols`: the chord-line vocabulary (instruments, directions, stops by color, riff glyphs, minor pattern...).
- `import`: how the legacy Word PDFs encode things (lyric grays, label column, superscript raise, the legacy beat width...). These describe the old files, so they stay put when the drawing rules change.

Moving the values into JSON changed no output: the demo, the chorus fixture and the local Since U Been Gone chart render byte-for-byte the same.

## PDF chart importer

`npm run import-chart -- "<chart.pdf>" [outDir]` writes the chart JSON, its notation images, a PDF and page PNGs of our rendering, `review.txt` and a side-by-side `compare-p<N>.png` (original left, our render right) to `local/imports/<name>/` (gitignored). Re-running replaces that folder's outputs (owner, 2026-11-09). Code: [src/importers/pdf-chart/](src/importers/pdf-chart/).

**PDF export (interim):** pages are rasterized at 300 dpi with resvg and wrapped in a US Letter PDF by mupdf ([scripts/lib/output.ts](scripts/lib/output.ts)), since this mupdf build can't read SVG. Sharp in print; text is not selectable. CLAUDE.md §7 still leaves the final PDF stack open (headless Chromium, vector text).

How it reads a page: characters (with font, size, color, baseline), images and section rules come from the PDF; rules split sections; the label column gives the label (type via `sections`); text is grouped into rows by baseline (superscripts join the row below; spaces only separate words); a row is lyric (mostly gray, no superscripts or bar lines), chord, or "Repeat ..." note. A chord row is tokenized with the `symbols` vocabulary; a chord row and the lyric row under it form one line. Each chord group is pinned to the syllable under its weighted middle (same weights as the renderer); a chord in the gap between syllables gets `before`/`after` and a flag. Tiny images inside parentheses are the circled plus/times (told apart by their pixels). Wide images are notation snippets: split at blank bands where a lyric line sits inside them, bars measured from the staff (bar lines and note columns), text over their top band becomes the overlay.

Guesses, all flagged in `review.txt`:
- `lyricEntry`: distance from the opening bar line to the lyric start / `import.legacyBeatWidth` (25.2), rounded to eighths. Matches every entry the owner confirmed on Since U Been Gone.
- Rhythm marks for a lyric line under a notation image: each syllable's middle against the image's bars, rounded to eighths. On SUBG verse line 2 this got 8 of 9 syllables of the owner's rhythm; line 1 differs on 4 syllables because the original's hand spacing does.
- Snippet timelines: measured automatically (matched a hand measurement within 0.2 pt).

Checked on all five sample PDFs: every section, chord, beat tag, stop, ending, aside, riff number and instrument mark of Since U Been Gone is read (its chorus matches the hand-made fixture exactly; local test). Remaining flags on the other charts are things the model can't hold yet or free text: see open questions below.

## Decisions (owner, 2026-11-09)

- **Pagination:** keep each section whole on one page (it moves to the next page if it doesn't fit; it splits only if taller than a page). Row height has a **max of 20 pt and a min of 17 pt** (owner; the originals measure 18.4). Every chart uses the max when it has room. If the chart would run past 2 pages, vertical spacing is squished just enough to stay on 2: row height and section padding shrink toward `render.squish`. Font sizes and notation images never shrink. If even the tightest spacing can't reach 2 pages, the max spacing is kept and the chart warns. With the 20 pt max: Awitin and So Easy fit at 20 pt, A Dios Le Pido needs a hair less, Since U Been Gone 18.5 pt; American Boy needs 3 pages even at 17, so it stays at 20 and warns. Both limits are (verify).
- **Bass change without a chord** (`/E[4&]`): same chord, new bass. New chord-line item `{ t: "bass", bass, beats? }`, drawn like a slash bass and timed like a chord change.
- **Beat tag on an instrument mark** (`(+Drm)[4]`): the instrument comes in (or drops out) on that beat. `instrument.beats`; drawn after the mark; gives the mark a time without using up the bar's beat-1/middle defaults.
- **Free-text instructions** (`(Use chords for Verse, Refrain, then Chorus ⊕last two bars)`): new item `{ t: "text", text, paren? }`, red text in black parentheses; a ⊕ or ⊗ inside is drawn as the Legend symbol. The importer reads any parenthesized or red text it doesn't recognize as free text and flags it for a check.

## Notes (importer)

- Notation images placed off the content edge in the originals (x 21-57 pt) are drawn at the edge; their timelines and overlays are measured from the image itself, so lyrics still line up.
- Still flagged by design: a label letter right of the label column (Awitin "End Ch" + "o" at x 44, past the content edge), and text over the middle of a notation image (dropped; it is part of the drawing).

# Native notation (owner, 2026-11-09)

Notation is data: a `notation` block in the chart points to a **MusicXML** file next to the chart JSON and says which staves to show (`tab`, `standard`, `both`) and which bars. MIDI is an input and an export; MusicXML is what's stored, because it keeps strings and frets, ties and beaming, and every notation tool reads it.

## Phase 1: drawing (done)

- [src/notation/render.ts](src/notation/render.ts): alphaTab 1.8.4 (MPL-2.0) lays the MusicXML out as SVG in Node, synchronously, in one row justified to the content width. Titles, tuning, track names, alphaTab's chord names and bar numbers are hidden (the chart supplies those). alphaTab's "rendered by alphaTab" footer is left out of the page; alphaTab is credited in the README.
- Music symbols come out of alphaTab as Bravura font characters; they are converted to **outlines** with opentype.js (MIT), so pages look the same in any viewer, in resvg and in the PDF, like our other symbols. Bravura (OFL) is bundled in `assets/fonts/`.
- Beat positions come from alphaTab's bounds lookup. [src/notation/axis.ts](src/notation/axis.ts) turns them into a time axis: chord names (`above`, each at a bar and beat) put their weighted middle on the beat, and a lyric line directly under the notation is spaced on the same beats (rhythm marks).
- Rules: `notation` in the rules file. Scale 0.57 puts tab lines about 7.4 pt apart, like today's Cubase snippets (verify on paper).
- If a notation can't be drawn: its `fallback` image (e.g. the original PNG snippet), else a dashed placeholder, with a warning.
- Demo: `test/fixtures/charts/notation-demo.json` with a made-up riff (`test/fixtures/notation/riff.musicxml`); shown in `npm run preview`.

## Next phases (plan)

2. **MIDI in**: @tonejs/midi; timing snapped to the rules' grid (16ths, triplets); meter/tempo; fret assignment for tab (playable positions in the tuning, least hand movement); MusicXML writer; flags for anything uncertain. MIDI out via alphaTab.
3. **Picture in**: tab pictures by our own reader (staff/bar/column detection already in the PDF importer, fret digits by template matching, rhythm from stems/beams/flags/rests); standard notation via the Audiveris CLI (Java). Audiveris skips tab staves, so the tab reader is ours.
4. **Importer**: snippet images become notation blocks (PNG kept as fallback), baked chord names become `above`; prefer Cubase MusicXML exports when supplied.

Open: what Cubase's MusicXML export contains (does tab string/fret survive?). Waiting on one export from the owner.

# Sung syllables (owner, 2026-11-09)

"Walking is a two-syllable word": a beat sits on the middle of its **sung syllable**, so a mark or chord on "Walking" centers "Walk", not the whole word. [src/text/syllables.ts](src/text/syllables.ts):
- Hyphenation patterns for the chart's language (`hyphen` package, ISC; en, es, pt, fr, it, de mapped in `lyrics.patterns`).
- Patterns avoid short edge splits (to-night, a-way, ev-er), which singing needs, so pieces with several vowel groups are split by a sung-syllable rule: before one consonant, between two, digraphs kept together per language (`lyrics.digraphs`: English sing|er and fa|ther; default/Tagalog pa|nga|rap), silent final e kept in the syllable before (breathe, you've), "y" before a vowel is a consonant (sa|yaw, be|yond). Languages without patterns (Tagalog) use the rule alone.
- `lyrics.exceptions` overrides any word ("fi-re" or "fire").
- Charts carry `meta.language` (default `lyrics.defaultLanguage`, "en"); the importer takes `--language`.
- Effect: a chord "on" a long word now centers over that word's first syllable (riv|er, mov|ing), across all charts. Checked: Walk lands on the second note (beat 1&) in the notation demo.

# Cover pages (CLAUDE.md §2 item 2; owner, 2026-11-09)

## How it was measured

The four Word cover templates in `samples/` were exported to PDF with Word (read-only, outside the repo) and their text, shapes and images read with mupdf. Every value is in the `cover` section of the rules file. The filled covers (24K Magic, Mad World), the Legend image and the 4, 5 and 7 column templates are still to come from the owner; values not backed by a template are marked (verify) there.

- Page: light blue background `#BDD6EE`; logo 177.5 x 86.5 pt, centered, with Word's soft shadow; two dark blue rules (`#203580`, 1.4 pt); title in Courier New 36 (upper case); "Artist, Year " in Courier New 24 and "(Key of X, Original)" in 20.
- Panels: dark blue header bar (`#203580`, light blue `#5B9BD5` outline) with "CHORDS:" / "LEGEND:" in Courier New Bold 18, white; body outlined in light blue, 0.5 pt, no fill.
- Chords panel: tuning label Calibri Bold Italic 13, red; notes under diagrams Calibri Italic 11, red, centered; "Alternate (for Acoustic):" Calibri Italic 13 after a double rule; "Continued at back of page" Calibri Bold Italic 13, red.
- Legend: footnotes Arial Bold 10, justified, hanging indent; entries Arial 9 beside their symbols. Wording copied from the template into the rules file.
- Footer: "Musiciansclub.com" (Calibri Italic 11, link blue, underlined) and the date (Calibri 11).

## Decisions

- **Diagram count -> columns** (owner): the fewest columns that fit, default 5, minimum 4, even use of the white space. Implemented as: 5 if it fits, else 6, 7, 8; 4 instead of 5 when the last row is fuller and the diagrams stay at 4 columns' full size. Each count takes the largest scale (5% steps) that fits both the width (5 pt minimum gap) and the rows. This reproduces the templates (6x7 = 42 at 60%, 8x7 = 56 at 65%, page 2 4x5 = 20) and gives 90% at 4 columns, 70% at 5, 75% (or 65% when needed) at 7.
- 4 to 6 columns sit beside the Legend (6-column template); 7 and 8 use the full width (8-column template) and the Legend gets page 2 (Legend-only template). Past 56, page 2 is "CHORDS (con't.)" beside the Legend. Past 56 + 20: a warning (open question §10.3).
- Columns are spread evenly over the panel width; rows are spaced evenly, never wider apart than the columns. The last row is left-aligned, like images pasted inline in Word (verify).
- Page 1 keeps the two templates' own header positions (the 8-column one sits 4.6 pt higher and starts its panel 20.8 pt higher, which it needs for 7 rows at 65%). Page 2 keeps its 0.5 in side margins. One header bar height (28 pt) is used everywhere; the templates vary from 24 to 34 pt.
- "Original" prints unless `meta.originalKey` differs from `meta.key` (§10.8 still open).
- The single divider line after the first diagram row in the templates is not drawn (its meaning is open question §10.2).
- Fonts: Courier New -> TeX Gyre Cursor (same widths; thin strokes like Courier New, unlike Cousine, which was tried first and looked too heavy); Calibri Italic and Bold Italic -> Carlito.
- The "60% scale (6x7=42 chords)" lines in the templates are notes to the author and are not printed.

## Voicing library

- `src/voicings/library.json`, written once by `scripts/gen-voicings.ts`: the four Corel diagrams (defaults for Fm, Eb, Bb, Ab), open chords, and E-shape / A-shape barre chords for every root in the qualities the five sample charts use (Maj7, m7, 5, sus, 7sus2, dim, dim7, m7b5 and others). Aliases map other spellings (maj7, sus4, (m)5).
- Like the Corel diagrams, a shape starts one fret above its lowest fret when it has room, with the fret number beside the lowest fret. Only one-digit fret numbers fit beside the grid, so positions from fret 10 up are left out of the library.
- Every starter shape carries a review flag; covers list the unapproved shapes they use. Missing so far: G and G#/Ab sus2 and 7sus2; G#/Ab 6; G#/Ab, A and A#/Bb 9. Charts with those get an empty diagram and a warning.

## Open questions (cover)

- Courier/Calibri look-alikes, logo shadow, header bar height, last-row alignment, Legend rule color: check against the filled covers when they arrive.
- Do "(m)5" and "5(m)" mean a power chord? (aliased to "5" for now.)
- Does a bass change ("/E" with no chord) need its own diagram? Each one gets one now ("C/E").
