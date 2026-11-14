# Chord Chart Engine

The chart-building tool for [Musicians' Club](https://musiciansclub.com) of San Diego.

Musicians' Club publishes about 400 "gig-ready" chord charts as PDFs. Today each one is put together by hand in Word, Cubase, and CorelDRAW. This project replaces that workflow with one application. Charts are stored as **structured data** and rendered to SVG/PDF. The look of the existing charts is kept exactly; they are the visual spec.

## Status

| Part | State |
|---|---|
| Chord diagram generator (importer, data model, renderer) | Done |
| Chart renderer (chords over lyrics, bars, beat tags, notation snippets) | Renders chart data to SVG pages, with rhythm spacing and 2-page fitting |
| Native notation (MusicXML in, tab/standard out; MIDI and picture input) | Drawing done; MIDI and picture input next |
| Cover pages (layout solver, 4 to 8 columns, 1 or 2 pages; Legend; voicing library) | Working; starter voicing library awaiting review ([details](#cover-pages)) |
| Text editor with live preview, PDF export | Phase 1 working: chart text format, local editor page, Print to PDF ([how to use it](#chart-editor)). Watermark not specified yet |
| Importer for existing charts and covers | Chart PDFs: working, with a review step ([how to use it](#importing-a-chart-pdf)). Covers: not started |
| Library, search, contributor review workflow | Not started |

Measurements, decisions, and known differences from the originals are recorded in [NOTES.md](NOTES.md). Everything still waiting on an answer, a file, or a check is in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md). The full project brief is [CLAUDE.md](CLAUDE.md).

## Quick look, no install needed

Open [diagram-generator.html](diagram-generator.html) in a browser. It draws the four sample chord diagrams from data and lets you edit a voicing and watch the diagram update. It uses the same renderer as the cover pages (`src/diagram/render.ts`, bundled into the page); after changing the renderer, rebuild it with `npm run diagram-generator`. It loads the Arimo font from Google Fonts, so it needs an internet connection.

## Getting started

These steps take you from a new computer to the chart editor running. Commands are typed in a terminal: on Windows, **PowerShell** or **Git Bash** (both work); on macOS, **Terminal**.

### 1. Install the tools

- **Node.js 22 or newer.** Download the **LTS** installer from [nodejs.org](gtps://nodejs.org) and run it with the default options. It includes npm, the tool that installs the project's packages.
- **Git.** Download it from [git-scm.com](https://git-scm.com) and install it with the default options. (On macOS, running `git --version` offers to install it.)

Close and reopen the terminal, then check that both are found:

```sh
node -v
npm -v
git --version
```

`node -v` should print `v22` or higher.

### 2. Get the code

```sh
git clone https://github.com/MCofSD/Chord-Chart-Engine.git
cd Chord-Chart-Engine
```

The project is now in a folder named `Chord-Chart-Engine`. Run all the commands below from inside that folder. (Without Git, you can use **Code > Download ZIP** on GitHub and unzip it, but then `git pull` won't work for updates.)

### 3. Install the packages

```sh
npm ci
```

This installs the exact package versions the project was tested with (listed in `package-lock.json`) into a `node_modules` folder. It takes a minute or two. You may see a warning like `install-scripts … esbuild … not yet covered by allowScripts`: it is expected and harmless.

### 4. Check that everything works

```sh
npm test
npm run typecheck
```

`npm test` should end with a line like `Tests  181 passed | 8 skipped`. The skipped tests need the owner's local song files (step 6), so skips are normal. `npm run typecheck` prints nothing after its first lines when all is well.

### 5. Open the chart editor

```sh
npm run editor
```

This builds `chart-editor.html` in the project folder. Double-click it, or drag it into Chrome or Edge. It opens with an example chart; see [Chart editor](#chart-editor) for how to use it.

### 6. Optional: the owner's local song files

The real song charts (PDF and Word) and anything imported from them contain copyrighted lyrics, so they are **not in this repository**, which is public. To run the comparison tests, preview sections, and the importer on real charts, ask the owner for copies:

- Put the chart PDFs and Word files in `samples/`.
- Imported charts go to `local/` (the importer does this for you).

Both locations are listed in `.gitignore`. **Never commit song files or lyrics.** Before committing, run `git status` and check that no song files appear.

### Staying up to date

```sh
git pull
npm ci
npm run editor
```

`npm ci` is only needed when `package-lock.json` changed, but running it again is harmless. Rebuild the editor after every pull, since `chart-editor.html` isn't in the repository. If the diagram code changed, also run `npm run diagram-generator`.

### Troubleshooting

- **PowerShell says "running scripts is disabled on this system" (`npm.ps1 cannot be loaded`).** Run this once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, answer `Y`, and try again. Or use Git Bash or Command Prompt instead.
- **"node" or "npm" is not recognized.** Close and reopen the terminal after installing Node.js. If it still fails, run the installer again and keep "Add to PATH" selected.
- **`npm ci` or `npm test` fails with syntax or engine errors.** Node.js is older than 22: install the current LTS from [nodejs.org](https://nodejs.org).
- **The editor says "images not added yet".** The chart uses notation images or MusicXML files. Click **Add files…** and pick them (for imported charts they are in the chart's folder under `local/imports/`).
- **The editor is missing or out of date.** Run `npm run editor` again.

### Commands

| Command | What it does |
|---|---|
| `npm run preview` | Builds `preview/index.html`: the sample diagrams at cover scales (100%, 65%, 60%) next to the Corel originals, plus a demo chart. Open the file in a browser. |
| `npm run editor` | Builds `chart-editor.html`, the chart text editor with live preview (see [Chart editor](#chart-editor)). |
| `npm run chart-to-text -- <chart.json>` | Writes a chart JSON (e.g. from the PDF importer) as chart text for the editor; given a `.txt`, does the reverse. |
| `npm run diagram-generator` | Rebuilds `diagram-generator.html` from the current renderer. Run it after changing anything in `src/diagram/`. |
| `npm test` | Runs all tests: importer golden files, renderer unit tests, and pixel comparisons against the originals. |
| `npm run typecheck` | Type-checks the code without building. |
| `npx tsx scripts/render-chart.ts <chart.json> [outDir] [--no-cover]` | Renders a chart file to a printable PDF (cover pages first), one PNG per page, and one SVG per page (default output: `preview/charts/`). |
| `npx tsx scripts/import-samples.ts` | Converts the Corel sample SVGs to voicing JSON and prints it. Add `--write` to update the test fixtures. |
| `npm run import-chart -- "<chart.pdf>" [outDir]` | Converts a legacy chart PDF to chart JSON, plus a PDF, page PNGs, and comparison PNGs of the result. See [Importing a chart PDF](#importing-a-chart-pdf). |

## Chart editor

After [setting up](#getting-started), run `npm run editor`, then open `chart-editor.html` in Chrome or Edge. It is self-contained (about 7 MB with the fonts) and works offline. It is not committed, so rebuild it after pulling changes. Type the chart on the left; the cover and chart pages update on the right as they will print.

- **Open…** reads a chart text file, or a chart JSON (for example one made by the PDF importer), which is turned into text. For imported charts, see [Fix it in the chart editor](#4-fix-it-in-the-chart-editor-optional).
- **Add files…** adds the notation images and MusicXML files a chart refers to.
- **Save as JSON** writes the chart as JSON, the file the importer and renderer use and the one to keep. It won't save while the Problems list shows lines the editor can't read, since those lines would be left out.
- **Save** writes the chart text (Ctrl+S), a working copy. The draft is also kept in the browser between visits.
- **Print / Save as PDF** prints the cover and chart pages on US Letter; choose "Save as PDF" in the print dialog, margins "None".
- The **Problems** list shows lines the editor can't read (click one to jump to the line) and layout warnings.
- **Click a syllable on the page** to add, change or remove its chord. Hovering shades the syllable a click will pick (one sung syllable, e.g. "cat" in "dedicated"). A small menu opens with the chord already there (if any): type the chord as you would in a chord line (`G`, `|Am7[2&]`), choose **Before**, **On** or **After** the syllable, then **Apply** (or Enter). **Remove** takes the chord off. The edit is made in the text on the left, so Ctrl+Z undoes it.
- **Click the space left of a line's lyric** (beside the section label, or the gap before a lyric that comes in late) for a chord that comes before the lyric, as at the start of Since U Been Gone. The menu has **Chord on beat 1** (already filled in with the line's first chord) and **Lyric comes in on beat**: type `2` (or `3`, `1&`…) and the chord stays on beat 1 at the left edge while the lyric moves right to its beat. Leave the beat empty to start the lyric with the bar again. This writes `@2` at the start of the lyric line.
- **Change how a word splits into syllables** in the same menu: the **Syllables** box shows the clicked word split by hyphens (`ded-i-cat-ed`). Type another split (`de-di-cat-ed`, or `fire` for one syllable) and Apply. It is saved in the chart's `Syllables:` header line, for this song only, and the hover, clicks and chord spacing follow it at once. Chords on that word move to the middle of their new syllable.
- **Chords follow their syllables** (the checkbox in the header, on by default): when you type more words into a lyric line, delete some, or make a chord name longer, every chord stays on the syllable it was on. The chord line is re-spaced for you, and the lyric opens a little room (`~` or a space) where a longer name would run into the next chord. Turn it off to line chords up by hand.
- **How to write a chart** (under the problems) lists every symbol. The format is described in [NOTES.md](NOTES.md#chart-text-format).

## Importing a chart PDF

The importer reads one of the existing Word-made chart PDFs and converts it into the chart format this project uses (JSON). It also renders the result as a PDF and as PNG images, so you can print it and check it against the original.

### 1. Run it

```sh
npm run import-chart -- "path/to/Since U Been Gone - Kelly Clarkson (2004).pdf"
```

- Put the path in quotes if it contains spaces.
- Name the PDF `Title - Artist (Year).pdf`, as the website files are. The importer takes the title, artist, and year from the file name, which is more reliable than reading the title from the page (the page prints it in capitals).
- By default the output goes to `local/imports/<title>/`, for example `local/imports/since-u-been-gone/`. To choose another folder, add it after the PDF: `npm run import-chart -- "chart.pdf" my/folder`.
- For lyrics that aren't in English, add the language, e.g. `--language es` (Spanish) or `--language tl` (Tagalog). It is used to split words into sung syllables and is saved in the chart.

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

   Or make the fixes in the chart editor, as described next.

### 4. Fix it in the chart editor (optional)

The editor is easier than editing the JSON by hand: you click a syllable to move a chord and see the pages update as you type. It opens the JSON and saves it back, so the **JSON stays the final file**. (The editor shows the chart as text while you work; turning JSON into text and back loses nothing, and the chart prints the same.)

1. **Build and open the editor** (once per pull): `npm run editor`, then open `chart-editor.html` in Chrome or Edge.
2. **Open the imported JSON**: click **Open…** and pick `local/imports/<title>/<title>.json`.
3. **Add the notation images**: click **Add files…** and pick every `snippet-*.png` in the same folder. Without them the editor shows "images not added yet" where the notation goes.
4. **Work through `review.txt`** with `compare-p*.png` open, fixing each item in the editor. The **Problems** list must be free of line problems before you can save JSON (layout warnings are fine).
5. **Click Save as JSON** and save over `<title>.json` in the chart's folder. In Chrome and Edge a save dialog opens; later saves go to the same file without asking. If your browser downloads the file instead, move it from your Downloads folder into the chart's folder, replacing the old JSON.
6. **Re-render** with `scripts/render-chart.ts` as in step 3 to update the PDF and images.

To continue editing later, open the JSON again. You don't need **Save** (chart text) for imported charts; the editor also keeps your draft in the browser between visits.

### Running it again

Running the importer again on the same PDF **replaces** that chart's folder contents: the JSON and every image, PDF, and review file. If you have edited an imported chart, by hand or in the editor, copy its JSON out of `local/imports/` first, or give the new import a different folder:

```sh
npm run import-chart -- "chart.pdf" local/imports/second-try
```

### Notes

- **Copyrighted lyrics.** Imported charts contain song lyrics, so they belong in `local/`, which is gitignored. Never commit them.
- **Rules, not code.** Everything the importer recognizes (colors, Legend symbols, instrument names, section names, the old files' conventions) comes from [rules/chart-rules.json](rules/chart-rules.json). If it misreads something consistently, the fix is usually a rule there, such as adding an instrument name. The `import` section describes the old Word PDFs.
- **Known limits.** Text drawn *inside* a notation image is part of the image and isn't read. Notation images that sat off the left edge in the original are drawn at the content edge.

## Cover pages

Every chart PDF starts with a cover, drawn from the chart itself: the title block, a CHORDS panel with a diagram for every chord, and the Music Legend. `render-chart` puts the cover pages first (`--no-cover` leaves them out). The look is measured from the Word cover templates in `samples/`.

**Which diagrams.** By default, one diagram per chord in the chart, in order of first use (a bass change like `/E` counts as the chord over the new bass). To choose the order, the shapes, or add notes, give the chart a `cover` section:

```json
"cover": {
  "diagrams": [
    { "chord": "Ab", "note": "for Bridge only" },
    { "chord": "Am", "voicing": "Am/E-shape@5" },
    { "chord": "G", "group": "alternate" }
  ],
  "alternateLabel": "for Acoustic"
}
```

`voicing` is either an id from the shared library or a whole custom shape (the same format as the diagram generator). Diagrams in the `alternate` group print after the others, under "Alternate (for Acoustic):". The chart's `meta.tuning` (e.g. "Eb Standard Tuning") prints at the top of the panel. "Original" prints after the key unless `meta.originalKey` says the chart is transposed.

**Voicing library.** [src/voicings/library.json](src/voicings/library.json) holds shared shapes: the four Corel diagrams, open chords, and movable barre shapes for every key. The first shape listed for a chord is its default. The starter shapes are generated and **marked for review**; `render-chart` lists the ones a cover uses until they're approved. Once the owner edits the file by hand, it's the source of truth (don't rerun `scripts/gen-voicings.ts`). A chord with no shape gets an empty diagram and a warning.

**Layout.** The solver ([src/cover/layout.ts](src/cover/layout.ts)) picks the column count from the number of diagrams: the fewest that fit, starting at 5, or 4 when that fills the last row more evenly. Each column count uses the largest scale that fits (6 columns = 42 diagrams at 60%, 8 columns = 56 at 65%, as in the templates). From 7 columns the chords take the full width and the Legend moves to page 2. More than 56 diagrams continue on page 2 ("CHORDS (con't.)", 20 more) beside the Legend. All sizes and positions are in the `cover` section of the rules file.

**Legend.** The printed Legend's wording lives in the rules file. Each entry is checked against the symbol registry ([src/legend/registry.ts](src/legend/registry.ts)), so a confirmed symbol can't be left off.

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
- **Sung syllables.** A beat sits on the middle of its syllable, so words are split into sung syllables (Walk|ing, to|night) per language: hyphenation patterns from the [hyphen](https://github.com/ytiurin/hyphen) package plus a simple sung-syllable rule, which also covers Tagalog. Set a chart's language in `meta.language`. To split a word differently in one song, use the editor's Syllables box or the chart's `Syllables:` header line (`meta.syllables`); to change it for every chart, add it to `lyrics.exceptions` in `rules/chart-rules.json`.
- **Native notation.** Riffs and intros are stored as MusicXML and drawn by [alphaTab](https://alphatab.net) as tab, standard notation, or both. Chord names above them and the lyric line below are placed on the notation's real beats. See `test/fixtures/charts/notation-demo.json`.

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
  notation/    Native notation: MusicXML drawn by alphaTab, beat positions
  cover/       Cover pages: layout solver and renderer
  voicings/    Shared voicing library (library.json) and lookup
  legend/      Music Legend symbol registry
  text/        Font metrics and glyph outlines
scripts/       Preview builder, chart renderer, PDF chart importer, font and glyph generators
test/          Unit tests, visual tests, fixtures
assets/fonts/  Arimo, Carlito, TeX Gyre Cursor, Noto Music, Noto Sans Math, Bravura (open licenses)
assets/cover/  Musicians' Club logo for the cover
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

The bundled fonts are under open licenses; see the `LICENSE-*.txt` files in [assets/fonts/](assets/fonts/). The original charts use Arial; Arimo is metric-compatible with it. Carlito stands in for Calibri, and [TeX Gyre Cursor](https://www.gust.org.pl/projects/e-foundry/tex-gyre/cursor) (GUST Font License) for the covers' Courier New. The Musicians' Club logo in `assets/cover/` belongs to Musicians' Club and is not under an open license.

Notation is drawn with [alphaTab](https://alphatab.net) (MPL-2.0) using the [Bravura](https://github.com/steinbergmedia/bravura) music font (SIL OFL), whose symbols are turned into outlines with [opentype.js](https://opentype.js.org) (MIT).
