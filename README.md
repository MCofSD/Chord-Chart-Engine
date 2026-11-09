# Chord Chart Engine

The chart-building tool for [Musicians' Club](https://musiciansclub.com) of San Diego.

Musicians' Club publishes about 400 "gig-ready" chord charts as PDFs. Today each one is put together by hand in Word, Cubase, and CorelDRAW. This project replaces that workflow with one application. Charts are stored as **structured data** and rendered to SVG/PDF. The look of the existing charts is kept exactly; they are the visual spec.

## Status

| Part | State |
|---|---|
| Chord diagram generator (importer, data model, renderer) | Done |
| Chart renderer (chords over lyrics, bars, beat tags, notation snippets) | Renders chart data to SVG pages, with rhythm spacing and 2-page fitting |
| Cover layout solver (4 to 8 columns, 1 or 2 pages) | Not started |
| Text editor with live preview, PDF export | Not started |
| Importer for existing charts and covers | Chart PDFs: working, with a review step ([how to use it](#importing-a-chart-pdf)). Covers: not started |
| Library, search, contributor review workflow | Not started |

Measurements, decisions, and known differences from the originals are recorded in [NOTES.md](NOTES.md). The full project brief is [CLAUDE.md](CLAUDE.md).

## Quick look, no install needed

Open [diagram-generator.html](diagram-generator.html) in a browser. It draws the four sample chord diagrams from data and lets you edit a voicing and watch the diagram update. It loads the Arimo font from Google Fonts, so it needs an internet connection.

## Getting started

Requires [Node.js](https://nodejs.org) 22 or newer.

```sh
npm install
```

| Command | What it does |
|---|---|
| `npm run preview` | Builds `preview/index.html`: the sample diagrams at cover scales (100%, 65%, 60%) next to the Corel originals, plus a demo chart. Open the file in a browser. |
| `npm test` | Runs all tests: importer golden files, renderer unit tests, and pixel comparisons against the originals. |
| `npm run typecheck` | Type-checks the code without building. |
| `npx tsx scripts/render-chart.ts <chart.json> [outDir]` | Renders a chart file to a printable PDF, one PNG per page, and one SVG per page (default output: `preview/charts/`). |
| `npx tsx scripts/import-samples.ts` | Converts the Corel sample SVGs to voicing JSON and prints it. Add `--write` to update the test fixtures. |
| `npm run import-chart -- "<chart.pdf>" [outDir]` | Converts a legacy chart PDF to chart JSON, plus a PDF, page PNGs, and comparison PNGs of the result. See [Importing a chart PDF](#importing-a-chart-pdf). |

## Importing a chart PDF

The importer reads one of the existing Word-made chart PDFs and converts it into the chart format this project uses (JSON). It also renders the result as a PDF and as PNG images, so you can print it and check it against the original.

### 1. Run it

```sh
npm run import-chart -- "path/to/Since U Been Gone - Kelly Clarkson (2004).pdf"
```

- Put the path in quotes if it contains spaces.
- Name the PDF `Title - Artist (Year).pdf`, as the website files are. The importer takes the title, artist, and year from the file name, which is more reliable than reading the title from the page (the page prints it in capitals).
- By default the output goes to `local/imports/<title>/`, for example `local/imports/since-u-been-gone/`. To choose another folder, add it after the PDF: `npm run import-chart -- "chart.pdf" my/folder`.

The command prints a short summary, for example:

```
11 sections, 2 page(s), 6 notation image(s), 40 review item(s), 1 renderer warning(s)
files: since-u-been-gone.json, since-u-been-gone.pdf, since-u-been-gone-p*.png, compare-p*.png, review.txt
```

### 2. What you get

| File | What it is |
|---|---|
| `<title>.json` | The chart as structured data: header, sections, chords pinned to syllables, lyrics, marks, and rhythm. This is the file you keep and edit. |
| `<title>.pdf` | The imported chart as a printable US Letter PDF. |
| `<title>-p1.png`, `<title>-p2.png`, ... | The imported chart as one image per page. |
| `compare-p1.png`, `compare-p2.png`, ... | One image per page: the original PDF on the left, the imported chart on the right. |
| `snippet-1.png`, `snippet-2.png`, ... | The notation images (riffs, intros) cut out of the PDF. The JSON refers to them by name, so keep them in the same folder. |
| `<title>-p1.svg`, ... | The imported chart as SVG, one file per page. |
| `review.txt` | Everything the importer was unsure about, each with the section, page, and position, plus any warnings from the renderer. |

The PDF is made from 300 dpi page images: sharp in print, but the text can't be selected or searched. It's an interim export until the project chooses its final PDF tool.

### 3. Review it

The importer never silently guesses. Anything uncertain is kept and listed in `review.txt`. Work through it with the comparison images open:

1. **Open `compare-p*.png`** and look for differences between the left and right halves.
2. **Go through `review.txt`.** The common items are:
   - **"lyric entry guessed: beat 2"**: the lyric starts after the line's first chord. The beat was read from the spacing in the original, so confirm it.
   - **"rhythm guessed from the notation image"**: syllable beats for a lyric line under a notation image, written as `bar:beat`. Confirm them against the song.
   - **"bar positions measured automatically"**: where each bar sits in a notation image. Usually right; check that the lyrics line up under the notes.
   - **"chord between syllables: placed just after ..."**: the chord sits between two syllables in the original. Check it falls where the song changes.
   - **"read ... as a free-text instruction"**: unrecognized text in parentheses, kept as written. Check it isn't a Legend mark the rules don't know yet.
   - **"chart is 3 pages"** or **"vertical spacing tightened"**: page fitting. Rows are 20 pt when there's room and tighten toward 17 pt only to keep a chart on 2 pages.
3. **Fix anything wrong in `<title>.json`**, then re-render it to check your changes:

   ```sh
   npx tsx scripts/render-chart.ts local/imports/since-u-been-gone/since-u-been-gone.json local/imports/since-u-been-gone
   ```

   This rewrites the PDF, page PNGs, and page SVGs next to the JSON.

### Running it again

Running the importer again on the same PDF **replaces** that chart's folder contents: the JSON and every image, PDF, and review file. If you have hand-edited an imported chart, copy it out of `local/imports/` first, or give the new import a different folder:

```sh
npm run import-chart -- "chart.pdf" local/imports/second-try
```

### Notes

- **Copyrighted lyrics.** Imported charts contain song lyrics, so they belong in `local/`, which is gitignored. Never commit them.
- **Rules, not code.** Everything the importer recognizes (colors, Legend symbols, instrument names, section names, the old files' conventions) comes from [rules/chart-rules.json](rules/chart-rules.json). If it misreads something consistently, the fix is usually a rule there, such as adding an instrument name. The `import` section describes the old Word PDFs.
- **Known limits.** Text drawn *inside* a notation image is part of the image and isn't read. Notation images that sat off the left edge in the original are drawn at the content edge.

## How it works

All formatting rules (colors, fonts, sizes, spacing, rhythm and alignment, the Legend vocabulary, section names, and how the old Word-made PDFs encode things) live in one file, [rules/chart-rules.json](rules/chart-rules.json). The renderer and the PDF importer both read it, so changing a rule there needs no code change.

```
Corel SVG ──► importer ──► Voicing JSON ──► renderDiagram() ──► SVG
                                 Chart JSON ──► renderChart()  ──► SVG pages
```

- **Data first.** A chord diagram is a `Voicing`: per-string state (fretted, muted, open), barres, fret window, and chord name. A chart is a `Chart`: metadata plus sections of lyric lines with chords pinned to characters. Both are plain JSON.
- **Pure rendering.** `renderDiagram(voicing, options)` and `renderChart(chart)` are pure functions that return SVG strings. They need no browser or DOM, so they can run on a server to make PDFs.
- **Measured, not guessed.** All diagram sizes are proportions of one fret row (R), measured from the original CorelDRAW files ([src/diagram/tokens.ts](src/diagram/tokens.ts)).
- **Renderer-independent text.** Font metrics are bundled, and ♭/♯ symbols are drawn as vector outlines, so output looks the same in Chrome, resvg, and print.

### Example

```ts
import { renderDiagram } from "./src/diagram/render.js";

const svg = renderDiagram({
  chord: { root: "F", quality: "m" },
  windowStartFret: 1,
  strings: [
    { kind: "fretted", fret: 1, finger: 1 },
    { kind: "fretted", fret: 3, finger: 3 },
    { kind: "fretted", fret: 3, finger: 4 },
    { kind: "fretted", fret: 1, finger: 1 },
    { kind: "fretted", fret: 1, finger: 1 },
    { kind: "fretted", fret: 1, finger: 1 },
  ],
  barres: [{ fret: 1, from: 0, to: 5, sounding: [[0, 5]] }],
});
```

See [src/model/voicing.ts](src/model/voicing.ts) and its JSON schema [voicing.schema.json](src/model/voicing.schema.json) for the full format, and [test/fixtures/](test/fixtures/) for real examples.

## Project layout

```
src/
  model/       Data types and JSON schemas (voicing, chart)
  diagram/     Chord diagram SVG renderer and style tokens
  chart/       Chart page renderer
  importers/   corel-svg: CorelDRAW SVG to voicing JSON; pdf-chart: legacy chart PDF to chart JSON
  rules/       Loader for rules/chart-rules.json
  legend/      Music Legend symbol registry
  text/        Font metrics and glyph outlines
scripts/       Preview builder, chart renderer, PDF chart importer, font and glyph generators
test/          Unit tests, visual tests, fixtures
assets/fonts/  Arimo, Carlito, Noto Music, Noto Sans Math (open licenses)
samples/       Original files used as ground truth (read-only)
rules/         chart-rules.json: the formatting rules
```

The song charts used as references (PDF and Word) contain copyrighted lyrics, so they are **not in this repository**. The chord diagram SVGs and cover templates are. The chart-vs-original visual test and the matching preview section run only on a machine that has local copies of the charts; everywhere else they are skipped.

## Contributing

- Read [CLAUDE.md](CLAUDE.md) first. It describes the existing charts, the Music Legend, and the decisions already made.
- **Keep the current look.** Ask the project owner before changing anything visual.
- Prefer values measured from the samples over guesses. Mark anything uncertain with `(verify)`.
- Don't modify files in `samples/`.
- Never commit song charts or test fixtures that contain lyrics. They are listed in [.gitignore](.gitignore).
- Run `npm test` and `npm run typecheck` before opening a pull request.

## Fonts and licenses

The bundled fonts are under open licenses; see the `LICENSE-*.txt` files in [assets/fonts/](assets/fonts/). The original charts use Arial; Arimo is metric-compatible with it.
