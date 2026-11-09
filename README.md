# Chord Chart Engine

The chart-building tool for [Musicians' Club](https://musiciansclub.com) of San Diego.

Musicians' Club publishes about 400 "gig-ready" chord charts as PDFs. Today each one is put together by hand in Word, Cubase, and CorelDRAW. This project replaces that workflow with one application. Charts are stored as **structured data** and rendered to SVG/PDF. The look of the existing charts is kept exactly; they are the visual spec.

## Status

| Part | State |
|---|---|
| Chord diagram generator (importer, data model, renderer) | Done |
| Chart renderer (chords over lyrics, bars, beat tags, notation snippets) | Phase 1: renders chart data to SVG pages |
| Cover layout solver (4 to 8 columns, 1 or 2 pages) | Not started |
| Text editor with live preview, PDF export | Not started |
| Importer for existing charts and covers | Not started |
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
| `npx tsx scripts/render-chart.ts <chart.json> [outDir]` | Renders a chart file to one SVG per page (default output: `preview/charts/`). |
| `npx tsx scripts/import-samples.ts` | Converts the Corel sample SVGs to voicing JSON and prints it. Add `--write` to update the test fixtures. |

## How it works

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
  importers/   corel-svg: CorelDRAW SVG to voicing JSON
  legend/      Music Legend symbol registry
  text/        Font metrics and glyph outlines
scripts/       Preview builder, chart renderer, font and glyph generators
test/          Unit tests, visual tests, fixtures
assets/fonts/  Arimo, Carlito, Noto Music, Noto Sans Math (open licenses)
samples/       Original files used as ground truth (read-only)
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
