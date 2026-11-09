# CLAUDE.md: Musicians' Club Chord Chart App

Last updated: 2026-11-08. This file is the project brief. Read it fully before writing code. 

## 1. Project goal

Musicians' Club (musiciansclub.com, San Diego) publishes about 400 "gig-ready" chord charts as PDFs. Today each chart is made by hand:

- Chart body: a Word document exported to PDF.
- Notation snippets (riffs, intros): produced in **Cubase**, exported as PNG, placed in Word.
- Cover page chord diagrams: drawn as vectors in **CorelDRAW**, exported to PNG/SVG, pasted into a Word cover template.

We are building one application that replaces this workflow. Requirements:

- **Keep the current look.** The existing PDFs are the visual spec. Do not redesign the look without asking.
- **Usable by outside members and contributors**, not only the internal team.
- Store charts as **structured data** and render PDF/screen output from it. Separate content from layout.
- Later features: transposition, library and search (genre, mood, skill level, year), versions, contributor review workflow, performance view, and a web/tablet view that copies repeated sections in place instead of pointing back to them.
- Chord timing relative to the lyric is shown through spacing: a chord can sit right on a syllable, or just before or after it (owner, 2026-11-08). The data model must keep this distinction.
- Spacing conveys rhythm as accurately as possible, chords conform around the lyrics, charts aim for 2 pages, and they must stay readable at arm's length on Letter paper (owner, 2026-11-09). When a line doesn't fit: rhythm spacing flexes first, then the line narrows to 82%, font sizes never shrink, and finally it wraps at bar lines with an equal number of bars per row (never 3 + 1). A bar's second untagged chord is on beat 3; with more than two chords, only the beat-1 and beat-3 chords may go untagged. Details in NOTES.md.

The website is WordPress/Elementor with a membership plugin. Charts are member-gated. Decision pending: publish from this tool into WordPress, or replace parts of it. Default assumption: publish into WordPress (lower risk).

## 2. Current scope: Diagram generator first

Build order:

1. **Chord diagram generator** (this is the current task, see section 6).
2. Cover layout solver (4 to 8 columns, 1 or 2 pages).
3. Chart renderer (chords over lyrics, bars, beat tags, notation snippets).
4. Text editor with live preview, PDF export with watermark.
5. Importer for existing charts and covers (PDF-based, semi-automated).
6. Library, contributor workflow, native notation (optional).

Do not start items 3 and later until asked.

Status (2026-11-08): item 1 done. Item 3 started at the owner's request, ahead of item 2: phase 1 renders charts from `src/model/chart.ts` to SVG pages (`src/chart/`), with decisions and measurements in NOTES.md. Item 2 (cover layout solver) not started.

Status (2026-11-09): rhythm spacing done (NOTES.md). Item 5 started at the owner's request: a PDF chart importer (`src/importers/pdf-chart/`, `npm run import-chart`). **All formatting rules live in `rules/chart-rules.json`**, read by both the renderer and the importer; a rule change must need no code change in either (owner). Put new rules there, not in code.

## 3. Sample files (ground truth)

Put these under `samples/` (copy from the project owner; do not modify them):

```
samples/
  svg/        Fm.svg Eb.svg Bb.svg Ab.svg          (Corel exports, the visual target)
  covers/     24K Magic cover (image), Cover Page (6 col).docx, Mad World (filled cover).docx,
              Cover Page (8 col) 1st Page (Chords).docx,
              Cover Page (8 col) 2nd Page (Chords and Legends).docx,
              Cover Page (8 col) 2nd Page (Legends only).docx
  charts/     Awitin Mo At Isasayaw Ko, A Dios Le Pido, Since U Been Gone,
              American Boy, So Easy (To Fall in Love)   (.docx and .pdf for each)
  legend/     Music Legend (image from the 24K Magic cover; the PDF version has unreadable fonts)
```

The sample charts contain copyrighted lyrics. **The repo is public** (owner, 2026-11-09): song charts (.pdf, chart .docx) and any fixture with lyrics are **local-only**, listed in `.gitignore`, and must never be committed. Code and tests that need them must skip cleanly when they are missing. Do not copy lyrics into tests, docs, or commit messages. The Corel SVGs and the cover templates contain no lyrics and stay in the repo.

## 4. Source-file facts (what the existing files really are)

### 4.1 Chart Word files (verified on 5 files)

- No styles, no tables. One paragraph per section (Intro, Verse, Chorus...), lines separated by soft line breaks; section dividers are paragraph borders (color A6A6A6).
- Chords are aligned over lyrics using **tab characters** (default tab stops). Chord-to-syllable position is implicit, recoverable only from rendered geometry.
- Chord quality is hand-formatted (superscript runs). Chords are text, not data.
- Notation snippets are PNGs (about 220 dpi) in **floating anchors at absolute page positions**, over blank lines the author leaves. Chord symbols above the staves are baked into the PNGs, separate from chord text over lyrics (double entry).
- Header is hand-typed: `Title (Artist, Year)` and `(Key of X, BPM=n)`. The date is a `SAVEDATE` field. Footer is `Page X of Y`. Title, artist, and year are also in the file name and the website index (typed in 3 to 4 places).
- Page: US Letter, 0.1" side margins, 0" top and bottom. Fonts: Arial (Arial Narrow used by hand when lines are long). Lyrics 16pt (18pt in one file), gray `#808080`; chords black.
- Seen drift: `E(m)5` vs `E5(m)`, manual page breaks, variable font sizes, mixed snippet widths.
- Languages include English, Spanish, Tagalog. Use Unicode throughout.

### 4.2 Section label colors (observed)

Verse purple `#7030A0`, Refrain blue `#0070C0`/`#0000FF`, Chorus green `#00B050`. Colors repeat in "Repeat Verse, Refrain and Chorus" lines.

**Rule (owner, 2026-11-08), replacing color-by-type:** a section label is colored **only when that section is repeated later** ("Repeat Chorus"). Colors go by priority from the top of the chart: the first repeated section is blue `#0070C0`, the second green `#00B050`, the third purple `#7030A0` (the font colors in "Awitin Mo At Isasayaw Ko"), whatever the section type. The color helps the reader find the part to go back to; sections that are not repeated print black. Paper charts point back to save space (aim: every chart fits two pages); a future web/tablet view may copy the repeated section in place instead.

### 4.3 Cover Word files (verified on 6 files)

- Letter, light-blue background panels (anchored images), about 16 text boxes, fill-in fields for title/artist/key. Legend text is identical in every cover (copied by hand).
- Templates contain no diagrams; authors paste PNGs by hand.
- Footer: `Musiciansclub.com` link and a `SAVEDATE` date.
- Title block: `TITLE`, then `Artist, Year (Key of X, Original)`. "Original" meangs original key, removed when not original key.
- Chords panel carries: tuning label (e.g. "Eb Standard Tuning"), per-diagram notes (e.g. "for Bridge only"), an "Alternate (for Acoustic):" group with divider line, and a scale/capacity note.
- Column templates exist for 4 to 8 columns (4 was the old default, 5 is the current default). **Column count is chosen purely by diagram count.**

| Template | Page 1 capacity | Scale | Notes |
|---|---|---|---|
| 6 col | 6 x 7 = 42 diagrams | 60% | Legend beside chords on page 1 |
| 8 col | 8 x 7 = 56 diagrams | 65% | Legend moves to page 2; "Continued at back of page" |
| 8 col, page 2, chords + legend | 4 x 5 = 20 more diagrams | 65% | "CHORDS (con't.)" panel plus Legend side by side |
| 8 col, page 2, legend only | none | n/a | Used when nothing overflows |

Templates use inconsistent margins (top 0.2" / 0.25" / 0.5", sides 0.4" / 0.5"), probably accidental. Use one consistent set unless told otherwise. Physical diagram size at 100% is about 1.39" x 1.52"; scale is set by panel width and column count.

## 5. The Music Legend (symbol registry)

Source: Legend panel on the cover. Keep these as a **machine-readable registry** (`src/legend/registry`) that drives the parser, editor palette, validation, and the printed Legend block.

Footnotes:
- `*` All chord changes occur at either the 1st or middle beat (e.g. beat 3 in 4/4) when not shown.
- `**` Gray chords mean **do not play any bass guitar**.
- `***` Lyrics sung by backup vocalists are **italicized**.

Symbols (confirmed by the Legend):

| Symbol | Meaning |
|---|---|
| `[#]` (red, superscript) | Beat at which a chord changes (optional). `&` = 8th-note intervals; `e`, `&`, `a` = 16th-note intervals; `te`, `ta` = triplet intervals. Lists allowed, e.g. `[1&,2,3,4]`; a bare subdivision inherits the previous beat, e.g. `[2e,&,a,3]` = 2e, 2&, 2a, 3 |
| `{#.}` | On repeats, `#` says which time to play (1st, 2nd...) |
| blue circled number | Reference to a similar riff/pattern. Dark blue `#0000FF` by default; light blue `#00B0F0` for a second repeated riff, so the reader knows which riff to look at (owner, 2026-11-08). More riffs may need more colors later |
| `1/2T` (red) | Half time |
| circled plus (red) | **only** (e.g. `(⊕Gtr)` = guitar only) |
| circled times (red) | **except** (e.g. `(⊗last two bars)`) |
| `//` red | **Abrupt stop**: if placed before a beat, end before that beat; if after, end on that beat; multiple beats shown means more than one hit |
| `//` green | **Stop and hold**; multiple beats shown means more than one hit |
| `: :` (red) | Repeat passage between the two colons |
| `dstrn` (red) | Distortion |
| `Vamp` (red) | Play the passage as many times as needed |

Used in charts but **not defined in the Legend** (confirm with the owner before encoding): `|` bar line and `| -` (repeat of same chord for another bar); `(+Bnd)`, `(-Drm)` add/remove an instrument; `(NC)`; `(simile)`; `(ritard)`; the down-arrow mark; parentheses for ad-libs; inline meter changes (stacked red numbers); instrument abbreviations (Bnd, Drm, Gtr, RGtr, LGtr, Bss, Snr, Pno, Org, Hrn, Prcn, KD, XStk, Synth, E. Piano).

## 6. Task: chord diagram generator

### 6.1 Deliverables

1. **Converter** `src/importers/corel-svg`: reads the four sample SVGs into voicing JSON.
2. **Voicing data model** `src/model/voicing` with a JSON schema.
3. **Renderer** `src/diagram/render`: pure function `renderDiagram(voicing, options) -> SVG string`.
4. **Tests**: converter fixtures (golden JSON), renderer unit tests, and a visual comparison against the originals.
5. **Preview page**: static HTML showing a grid of diagrams at the cover scales.
6. A short notes file listing anything that could not be reproduced.

### 6.2 Voicing model (proposal; refine as needed)

```ts
type StringState =
  | { kind: "fretted"; fret: number; finger?: 1|2|3|4|"T"; sounding: true }
  | { kind: "muted"; fret?: number }     // gray circle with white X (on a fret row)
  | { kind: "open" }
  | { kind: "mutedOpen" };               // 'x' printed above the nut

interface Voicing {
  chord: { root: string; accidental?: "b" | "#"; quality?: string; bass?: string };
  strings: StringState[];                // 6 entries, left to right as drawn
  windowStartFret: number;               // fret shown in the first row
  fretLabelRow?: number;                 // row beside which the fret number is printed
  barres?: { fret: number; from: number; to: number; sounding: [number, number][] }[];
  note?: string;                         // e.g. "for Bridge only"
}
```

Per-string state is needed because barres are drawn as segments: dark where strings sound, gray where muted, with gray X circles at muted ends.

### 6.3 Style tokens (measured from the 4 SVGs; **verify** on more samples)

All sizes are proportional to **R = height of one fret row**. Values were consistent across all four files after normalizing for scale.

| Element | Value |
|---|---|
| Grid | 6 strings x 4 fret rows, plus a thin top band of height 0.208 R |
| String spacing | 0.818 R (grid width = 4.09 R, grid height = 4.208 R) |
| Colors | dark `#373435`, gray `#96989A`, light `#FEFEFE` (finger numbers, X on gray) |
| Frame and inner lines | dark, stroke 0.0536 R |
| Dot (finger) | dark circle, radius 0.357 R, stroke 0.0268 R, centered on string and row center |
| Muted/ghost dot | gray `#96989A` circle, same size, white bold "X" |
| Barre bar | rectangle height 0.466 R, same stroke; dark where sounding, gray where muted |
| Finger number | Arial bold, 0.643 R |
| Chord root | Arial regular, 1.286 R; name block centered over grid; baseline 0.70 R above frame top |
| Flat sign | Corel files: the letter `b`, Arial regular, 1.072 R, same baseline as root. **Changed 2026-11-08 (owner):** print the flat/sharp symbols (♭ ♯) everywhere (root, slash bass, extensions), drawn as Noto Music outlines at the run's font size (natural size, smaller than the letter, to save space) on the run's baseline; sharps are lifted so their bottom aligns with the root letter's baseline (in superscripts, the superscript's baseline). The data keeps `b`/`#` |
| Quality/extension | superscript, about 0.643 R **(verify against cover examples)** |
| Open-string mute marks | lowercase `x`, Arial regular, 0.75 R, baseline about 0.15 R above frame top |
| Fret number | Arial italic, 0.964 R; right edge 0.44 R left of the grid; baseline about 0.35 R below the row center of its row. No fret number printed means the top row is fret 1 (owner, 2026-11-08) |

Cover typography seen on the 24K Magic cover: root large, quality superscript, slash bass at normal size (e.g. `Bbm7/C`), extensions such as `C7(b9b13)` and `Gm7(b5b9)` superscripted.

Point sizes at 100% (1 R = 18.665 pt): root 24 pt, root flat/sharp 20 pt, quality 12 pt, fret number 18 pt, `x` marks 14 pt. **Slash bass (owner, 2026-11-08):** the `/` and bass letter are two steps down Word's size list from the root, 20 pt (1.0715 R), on the root baseline; a bass flat/sharp keeps the 20:24 ratio, 16.7 pt (0.8929 R). After a superscript the slash is pulled 0.2 R left to tuck under it (no gap in `Bbm7/C`), or 0.1 R when the superscript ends with ")" (`G7(b9)/F`).

### 6.4 Quirks in the Corel exports (handle, do not copy)

- **Encoding**: `Fm.svg` is UTF-8; `Eb`, `Bb`, `Ab` are UTF-16 with BOM. Sniff the BOM.
- **Four coordinate scales**: viewBoxes about 377, 299, 500, and 8565 units wide. Derive geometry from the grid lines, never from fixed numbers.
- **Chord names** are built two ways: a CSS `baseline-shift: super` on `<text>` (`Fm`), or a separate smaller "b" text (`Eb`, `Bb`, `Ab`). The `m` in `Fm.svg` disappears in some renderers (LibreOffice), which is why an earlier JPEG showed "F". New output must not depend on `baseline-shift`; position superscripts explicitly.
- **Muted `x` marks above the nut** are one text string padded with spaces (e.g. `x             x x`), so they only roughly align with strings. Snap to the nearest string and flag for review.
- **Dots are hand-placed**: small offsets from true string/row positions. Snap to nearest.
- **Stray helper shapes**: shapes with no visible stroke or fill, white-stroke hairlines at row centers, and a white-filled circle at the right edge of a row. These are Corel "snap to middle" helpers (owner, 2026-11-08): ignore them. Flag any other white shape.
- **Text is live Arial** plus deprecated SVG `<font>` stubs. Render with Arimo or Liberation Sans (metric-compatible), or outline text on export.
- **File sizes differ** (`Fm` is 1.25" wide, others 1.39"). The renderer enforces one size.

### 6.5 Acceptance criteria

- All four samples convert to JSON without manual edits, except items flagged for review.
- Each rendered diagram matches its original closely in a side-by-side comparison and a pixel-difference check (state the tolerance used).
- Superscripts render correctly in at least Chrome and a second renderer (e.g. resvg or LibreOffice).
- Output is deterministic and has no DOM or browser dependency (so it can run server-side for PDF).
- Tests run with a single command.

## 7. Technical conventions

- **TypeScript**, strict mode. Node LTS. Use a standard test runner (e.g. Vitest).
- Suggested layout:
  ```
  src/model/      types and JSON schemas
  src/diagram/    SVG renderer
  src/importers/  corel-svg (later: pdf-chart, docx-cover)
  src/legend/     symbol registry (later)
  src/cover/      layout solver (later)
  test/           unit and visual tests
  samples/        ground truth (read-only)
  ```
- Pure functions for rendering. No global state. Output SVG as strings.
- Fonts: Arimo (Arial metrics), Liberation Sans Narrow (Arial Narrow metrics). Map circled plus/times to Unicode symbols (U+2295, U+2297); the originals use Wingdings, which cannot be bundled.
- Page output will eventually use headless Chromium or similar for PDF. Do not choose a PDF stack yet.

## 8. Working agreements

- Ask before changing anything visual. The goal is the same look.
- Show a short plan before large changes. Keep changes small and reviewable.
- Never edit files in `samples/`.
- Prefer measured values from the samples over guesses. State uncertainty and add a `(verify)` note rather than inventing rules.
- When a symbol or rule is not in section 5, do not invent semantics. List it as an open question.
- Notation snippets stay as **PNG assets** in early phases (placed as flow blocks with a cue number and instrument label). Native notation rendering is a later decision (candidate: alphaTab, with Cubase MusicXML export to be checked).

## 9. Decisions already made

- Structured data first, rendering second.
- Diagram voicing choice is **editorial** (chosen by the author), so diagrams are data plus a visual editor, not computed. Provide a shared voicing library with per-song selection and one-off custom shapes.
- Cover is generated from the chart's chord list; the Legend is generated from the registry. Cover and chart become one PDF.
- Importing old charts: parse from PDFs (text position, color, size, italics) rather than from Word tab structure; expect a human review step.
- Cover layout solver rule: choose columns and scale from diagram count; overflow beyond page 1 moves the Legend to page 2.

## 10. Open questions (do not guess; ask the owner)

1. ~~Are the white row-center hairlines and white circle in `Eb/Bb/Ab.svg` intentional?~~ Answered 2026-11-08: snap helpers, not needed. Also decided: diagrams keep 0.2 R headroom above the name; open strings are drawn as nothing.
2. What does the divider between the first row and the rest on covers mean (primary vs alternate chords)?
3. Overflow rule beyond 56 + 20 diagrams?
4. Meaning of undocumented symbols in section 5.
5. Should the printed date be last-saved or an explicit revision date?
6. Publish into WordPress or replace its membership and library features?
7. Do covers need alternate voicing sets per instrument (e.g. "for Acoustic")? How are they chosen?
8. Is the "Original" label in the title block a version field (e.g. transposed versions)?
9. ~~Importer findings~~ Answered 2026-11-09 (details in NOTES.md): `/E` with no chord = same chord, new bass; `(+Drm)[4]` = the instrument comes in on beat 4; free-text instructions are kept as text items; pagination keeps sections whole and squishes vertical spacing (never fonts) to stay on 2 pages when that is possible.
