/**
 * Browser entry for chart-editor.html (built by scripts/build-editor.ts):
 * type a chart in the text format on the left, see the cover and chart pages
 * on the right, as they will print. Uses the same parser and renderers as the
 * command-line tools.
 */
import { renderChart } from "../../src/chart/render.js";
import { renderCover } from "../../src/cover/render.js";
import { CHART } from "../../src/chart/tokens.js";
import type { Chart, NotationBlock } from "../../src/model/chart.js";
import { renderNotation, type NotationRender } from "../../src/notation/render.js";
import { parseChartText, writeChartText, type Problem } from "../../src/text-format/index.js";
import { lyricText } from "../../src/text-format/canonical.js";
import { chordAt, lineStartAt, setChordAt, setLineStart, setSyllables, splitOf, type ChordTarget, type Place } from "../../src/text-format/edit.js";
import { relink } from "../../src/text-format/link.js";
import { syllableAt, type SyllableSpan } from "../../src/text/syllables.js";
import demo from "../../test/fixtures/charts/demo.json" with { type: "json" };

const DRAFT_KEY = "chart-editor:draft";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const text = $<HTMLTextAreaElement>("text");
const pagesEl = $("pages");
const problemsEl = $("problems");
const statusEl = $("status");

/** Files the author added (notation images, MusicXML), by file name. */
const files = new Map<string, { bytes: Uint8Array; url: string }>();
let fileName = "chart.chart.txt";
/** The chart as last drawn (for clicks on the page). */
let shown: Chart | undefined;
/** The text as it last read cleanly: what "chords follow their syllables" compares each edit with. */
let baseline = "";
const FOLLOW_KEY = "chart-editor:follow";
let saveHandle: FileSystemFileHandle | undefined;
/** Where "Save as JSON" last wrote, so the next save goes to the same file. */
let jsonHandle: FileSystemFileHandle | undefined;

/** The starting chart: the made-up demo, without its intro (a notation image the page doesn't have). */
function starter(): string {
  const chart = structuredClone(demo) as unknown as Chart;
  chart.sections = chart.sections.filter((s) => s.type !== "intro");
  return writeChartText(chart);
}

const baseName = (p: string) => p.split(/[\\/]/).pop()!;

function notation(block: NotationBlock, width: number): NotationRender {
  const f = files.get(baseName(block.src));
  if (!f) throw new Error(`add the file ${baseName(block.src)} with "Add files"`);
  const staves = block.staves ?? (CHART.notation.defaultStaves as NonNullable<NotationBlock["staves"]>);
  return renderNotation(f.bytes, { staves, width, ...(block.bars ? { bars: block.bars } : {}) });
}

/** Points image references at the files the author added; reports the ones still missing. */
function linkImages(svg: string, missing: Set<string>): string {
  return svg.replace(/href="([^"#:]+\.(?:png|jpe?g|gif|svg))"/gi, (m, src: string) => {
    const f = files.get(baseName(src));
    if (!f) { missing.add(baseName(src)); return m; }
    return `href="${f.url}"`;
  });
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function showProblems(problems: Problem[], warnings: string[]): void {
  const items = [
    ...problems.map((p) => `<li><button type="button" data-line="${p.line}">Line ${p.line}</button> ${escapeHtml(p.message)}</li>`),
    ...warnings.map((w) => `<li><span class="tag">Layout</span> ${escapeHtml(w)}</li>`),
  ];
  problemsEl.innerHTML = items.length ? items.join("") : `<li class="ok">No problems found.</li>`;
  $("problem-count").textContent = items.length ? `(${items.length})` : "";
}

function render(): void {
  const t0 = performance.now();
  const { chart, problems } = parseChartText(text.value);
  try {
    const body = renderChart(chart, { notation, annotate: true });
    const cover = renderCover(chart);
    const missing = new Set<string>();
    const pages = [...cover.pages, ...body.pages].map((svg) => linkImages(svg, missing));
    pagesEl.innerHTML = pages
      .map((svg, i) => `<div class="page" aria-label="Page ${i + 1} of ${pages.length}">${svg.replace('width="8.5in" height="11in"', 'width="100%" height="100%"')}</div>`)
      .join("");
    shown = chart;
    closeMenu();
    const warnings = [...cover.warnings, ...body.warnings];
    if (missing.size) warnings.unshift(`images not added yet: ${[...missing].join(", ")} (use "Add files")`);
    showProblems(problems, warnings);
    statusEl.textContent = `${cover.pages.length} cover + ${body.pages.length} chart page(s), drawn in ${Math.round(performance.now() - t0)} ms`;
  } catch (e) {
    // Keep the last good pages; say what went wrong.
    showProblems(problems, [`could not draw the chart: ${e instanceof Error ? e.message : String(e)}`]);
    statusEl.textContent = "Showing the last pages that could be drawn.";
  }
}

let timer: number | undefined;
function schedule(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    render();
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ name: fileName, text: text.value })); } catch { /* storage unavailable */ }
  }, 250);
}

function goToLine(line: number): void {
  const lines = text.value.split("\n");
  const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
  text.focus();
  text.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
  const lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 18;
  text.scrollTop = Math.max(0, (line - 4) * lineHeight);
}

function setText(value: string, name: string): void {
  text.value = value;
  baseline = value;
  fileName = name;
  $("file-name").textContent = name;
  render();
}

async function openFile(file: File): Promise<void> {
  const src = await file.text();
  saveHandle = undefined;
  jsonHandle = undefined;
  if (/\.json$/i.test(file.name)) {
    try {
      setText(writeChartText(JSON.parse(src) as Chart), file.name.replace(/\.json$/i, ".chart.txt"));
    } catch (e) {
      alert(`${file.name} is not a chart JSON file: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else setText(src, file.name);
}

type SaveType = { description: string; accept: Record<string, string[]> };

/**
 * Writes a file: through the browser's save dialog where there is one (Chrome, Edge),
 * reusing `handle` so later saves go to the same file; otherwise as a download.
 * Returns the handle written to, or undefined (download, or the dialog was cancelled).
 */
async function writeFile(blob: Blob, name: string, type: SaveType, handle?: FileSystemFileHandle): Promise<FileSystemFileHandle | undefined> {
  const picker = (window as unknown as { showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (picker) {
    try {
      handle ??= await picker({ suggestedName: name, types: [type] });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      statusEl.textContent = `Saved ${handle.name}.`;
      return handle;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return undefined;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  statusEl.textContent = `Downloaded ${name}.`;
  return undefined;
}

async function save(): Promise<void> {
  const blob = new Blob([text.value], { type: "text/plain;charset=utf-8" });
  const h = await writeFile(blob, fileName, { description: "Chart text", accept: { "text/plain": [".txt"] } }, saveHandle);
  if (!h) return;
  saveHandle = h;
  fileName = h.name;
  $("file-name").textContent = fileName;
}

/** The JSON file name for the current chart: `x.chart.txt` → `x.json`. */
const jsonName = () => fileName.replace(/(\.chart)?\.txt$/i, "") + ".json";

/**
 * Saves the chart as JSON, the file the importer and renderer use, in the same form as
 * `npm run chart-to-text`. Refuses while any line can't be read, since those lines
 * would be left out of the JSON.
 */
async function saveJson(): Promise<void> {
  const { chart, problems } = parseChartText(text.value);
  if (problems.length) {
    alert(`Fix the ${problems.length} problem(s) in the Problems list first: lines the editor can't read would be left out of the JSON.`);
    goToLine(problems[0]!.line);
    return;
  }
  const blob = new Blob([JSON.stringify(chart, null, 2) + "\n"], { type: "application/json" });
  const h = await writeFile(blob, jsonName(), { description: "Chart JSON", accept: { "application/json": [".json"] } }, jsonHandle);
  if (h) jsonHandle = h;
}

async function addFiles(list: FileList): Promise<void> {
  for (const f of Array.from(list)) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const old = files.get(f.name);
    if (old) URL.revokeObjectURL(old.url);
    files.set(f.name, { bytes, url: URL.createObjectURL(new Blob([bytes], { type: f.type || "application/octet-stream" })) });
  }
  $("file-list").textContent = files.size ? `Added: ${[...files.keys()].join(", ")}` : "";
  render();
}

// ---- Chords follow their syllables -------------------------------------------

const follow = $<HTMLInputElement>("follow");
try { follow.checked = localStorage.getItem(FOLLOW_KEY) !== "off"; } catch { /* storage unavailable */ }
follow.addEventListener("change", () => {
  baseline = text.value;
  try { localStorage.setItem(FOLLOW_KEY, follow.checked ? "on" : "off"); } catch { /* storage unavailable */ }
});

let replacing = false;
/** Replaces the whole text as one undoable edit, keeping the scroll position. */
function replaceText(value: string, selStart: number, selEnd = selStart): void {
  const top = text.scrollTop;
  replacing = true;
  text.focus();
  text.select();
  // insertText keeps the browser's undo history (Ctrl+Z); fall back to a plain assignment.
  if (!document.execCommand("insertText", false, value)) text.value = value;
  replacing = false;
  text.setSelectionRange(selStart, selEnd);
  text.scrollTop = top;
}

text.addEventListener("input", (e) => {
  if (replacing) return;
  const kind = (e as InputEvent).inputType ?? "";
  if (!follow.checked || kind.startsWith("history")) baseline = text.value;
  else {
    const r = relink(baseline, text.value, text.selectionStart);
    if (r.kind === "applied") {
      replaceText(r.text, r.caret);
      baseline = r.text;
    } else if (r.kind !== "wait") baseline = text.value;
  }
  schedule();
});

// ---- Click a syllable on the page -------------------------------------------------

const menu = $("chord-menu");
const menuInput = $<HTMLInputElement>("chord-input");
const menuError = $("chord-error");
const sylInput = $<HTMLInputElement>("syl-input");
const entryInput = $<HTMLInputElement>("entry-input");
/** Set when the menu is for the start of a line (the space left of its lyric), not a syllable. */
let lineStart: { section: number; block: number; group: string; entry: string; rect: Element } | undefined;
let target: ChordTarget | undefined;
/** The clicked syllable's chord, word and current split, when the menu opened. */
let menuExisting: { group: string; place: Place } | undefined;
let menuWord = "";
let menuSplit = "";
let place: Place = "on";
let highlight: SVGRectElement | undefined;

function setPlace(p: Place): void {
  place = p;
  for (const b of Array.from(menu.querySelectorAll<HTMLButtonElement>("[data-place]"))) b.setAttribute("aria-pressed", String(b.dataset.place === p));
}

function closeMenu(): void {
  menu.hidden = true;
  target = undefined;
  lineStart?.rect.classList.remove("line-hl");
  lineStart = undefined;
  highlight?.remove();
  highlight = undefined;
}

/** Character of a lyric <text> under the pointer (the nearest one when between letters). */
function charAtPointer(el: SVGTextElement, e: MouseEvent): number {
  const ctm = el.getScreenCTM();
  if (!ctm) return 0;
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
  const n = el.getNumberOfChars();
  for (let k = 0; k < n; k++) {
    const r = el.getExtentOfChar(k);
    if (p.x < r.x + r.width) return k;
  }
  return Math.max(0, n - 1);
}

/** The sung syllable under the pointer, if it is over a lyric on the page. */
interface Hit { g: Element; el: SVGTextElement; si: number; bi: number; from: number; lyric: string; syl: SyllableSpan }
function syllableUnder(e: MouseEvent): Hit | undefined {
  const g = (e.target as Element).closest?.("g[data-lyric]");
  const el = g?.querySelector("text");
  if (!g || !el || !shown) return undefined;
  const [si, bi, from] = g.getAttribute("data-lyric")!.split(":").map(Number) as [number, number, number];
  const block = shown.sections[si]?.blocks[bi];
  if (block?.kind !== "line") return undefined;
  const lyric = lyricText(block.lyrics);
  const syl = syllableAt(lyric, from + charAtPointer(el, e), shown.meta.language, shown.meta.syllables);
  return syl ? { g, el, si, bi, from, lyric, syl } : undefined;
}

/** A box behind the syllable's letters in this piece of the line. */
function markSyllable(h: Hit, cls: string): SVGRectElement | undefined {
  const a = Math.max(0, h.syl.start - h.from), z = Math.min(h.el.getNumberOfChars(), h.syl.end - h.from);
  if (z <= a) return undefined;
  const r0 = h.el.getExtentOfChar(a), r1 = h.el.getExtentOfChar(z - 1);
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("class", cls);
  rect.setAttribute("x", String(r0.x - 1));
  rect.setAttribute("y", String(r0.y));
  rect.setAttribute("width", String(r1.x + r1.width - r0.x + 2));
  rect.setAttribute("height", String(r0.height));
  h.g.insertBefore(rect, h.g.firstChild);
  return rect;
}

// Hover: show the syllable a click would pick.
let hoverRect: SVGRectElement | undefined;
let hoverKey = "";
let hoverFrame = 0;
function clearHover(): void {
  hoverRect?.remove();
  hoverRect = undefined;
  hoverKey = "";
}
pagesEl.addEventListener("mousemove", (e) => {
  cancelAnimationFrame(hoverFrame);
  hoverFrame = requestAnimationFrame(() => {
    const h = syllableUnder(e);
    const key = h ? `${h.si}:${h.bi}:${h.syl.start}:${h.from}` : "";
    if (key === hoverKey && hoverRect?.isConnected) return;
    clearHover();
    if (!h) return;
    hoverKey = key;
    hoverRect = markSyllable(h, "syl-hover");
  });
});
pagesEl.addEventListener("mouseleave", () => { cancelAnimationFrame(hoverFrame); clearHover(); });

/** Shows the menu just below the click, inside the preview. */
function openMenuAt(e: MouseEvent, mode: "syllable" | "line"): void {
  $("syl-part").hidden = mode !== "syllable";
  $("entry-part").hidden = mode !== "line";
  $("chord-label").textContent = mode === "line" ? "Chord on beat 1" : "Chord";
  menu.setAttribute("aria-label", mode === "line" ? "Start of this line" : "Chord on this syllable");
  menuError.textContent = "";
  const preview = $("preview");
  const box = preview.getBoundingClientRect();
  menu.hidden = false;
  const left = Math.min(e.clientX - box.left + preview.scrollLeft - 20, preview.scrollLeft + preview.clientWidth - menu.offsetWidth - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${e.clientY - box.top + preview.scrollTop + 16}px`;
  menuInput.focus();
  menuInput.select();
}

/** Click in the space left of a line's lyric: the chord on beat 1 and the beat the lyric comes in on. */
function openLineStart(e: MouseEvent, rect: Element): void {
  const [section, block] = rect.getAttribute("data-line-start")!.split(":").map(Number) as [number, number];
  const now = lineStartAt(text.value, section, block);
  if (!now) return;
  lineStart = { section, block, group: now.group ?? "", entry: now.entry ?? "", rect };
  rect.classList.add("line-hl");
  $("chord-syllable").textContent = "Start of line";
  $("chord-where").textContent = shown?.sections[section]?.label || `section ${section + 1}`;
  menuInput.value = lineStart.group;
  entryInput.value = lineStart.entry;
  $("chord-remove").hidden = !lineStart.group;
  openMenuAt(e, "line");
}

function applyLineStart(remove: boolean): void {
  if (!lineStart) return;
  const group = remove ? "" : menuInput.value.trim();
  const entry = entryInput.value.trim();
  if (group === lineStart.group && entry === lineStart.entry) { closeMenu(); return; }
  const r = setLineStart(text.value, lineStart.section, lineStart.block, { group, entry });
  if ("error" in r) { menuError.textContent = r.error; return; }
  closeMenu();
  const lines = r.text.split("\n");
  const start = lines.slice(0, r.from - 1).reduce((n, l) => n + l.length + 1, 0);
  const end = lines.slice(0, r.to).reduce((n, l) => n + l.length + 1, 0) - 1;
  replaceText(r.text, start, end);
  baseline = r.text;
  render();
}

pagesEl.addEventListener("click", (e) => {
  const h = syllableUnder(e);
  if (!h) {
    const rect = (e.target as Element).closest?.("rect[data-line-start]");
    closeMenu();
    if (rect) { clearHover(); openLineStart(e, rect); }
    return;
  }
  const { si, bi, lyric, syl } = h;
  closeMenu();
  clearHover();
  target = { section: si, block: bi, syllable: syl };
  highlight = markSyllable(h, "syl-hl");
  const existing = chordAt(text.value, target);
  menuExisting = existing;
  menuWord = lyric.slice(syl.wordStart, syl.wordEnd);
  menuSplit = splitOf(menuWord, shown?.meta.language, shown?.meta.syllables);
  $("chord-syllable").textContent = `“${lyric.slice(syl.start, syl.end)}”`;
  $("chord-where").textContent = shown?.sections[si]?.label || `section ${si + 1}`;
  menuInput.value = existing?.group ?? "";
  sylInput.value = menuSplit;
  $("syl-word").textContent = `“${menuWord}”`;
  setPlace(existing?.place ?? "on");
  $("chord-remove").hidden = !existing;
  openMenuAt(e, "syllable");
});

/**
 * Apply: the chord (if it changed; an emptied box removes it), then the word's
 * syllable split (if it changed), as one edit of the text.
 */
function applyChord(remove: boolean): void {
  if (!target) return;
  let src = text.value;
  let sel: [number, number] | undefined; // 1-based lines to select afterwards
  const typed = menuInput.value.trim();
  const chordChanged = remove || typed !== (menuExisting?.group ?? "") || place !== (menuExisting?.place ?? "on");
  if (chordChanged && (typed || menuExisting)) {
    const r = setChordAt(src, target, remove || !typed ? { place } : { group: typed, place });
    if ("error" in r) { menuError.textContent = r.error; return; }
    src = r.text;
    sel = [r.from, r.to];
  }
  const split = sylInput.value.trim();
  if (!remove && split && split !== menuSplit) {
    const r = setSyllables(src, menuWord, split);
    if ("error" in r) { menuError.textContent = r.error; return; }
    // A header line added or removed moves everything below it.
    const shift = r.text.split("\n").length - src.split("\n").length;
    src = r.text;
    if (sel) sel = [sel[0] + shift, sel[1] + shift];
    else if (r.line !== undefined) sel = [r.line, r.line];
  }
  closeMenu();
  if (src === text.value) return;
  const lines = src.split("\n");
  const [a, z] = sel ?? [1, 1];
  const start = lines.slice(0, a - 1).reduce((n, l) => n + l.length + 1, 0);
  const end = lines.slice(0, z).reduce((n, l) => n + l.length + 1, 0) - 1;
  replaceText(src, start, end);
  baseline = src;
  render();
}

menu.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!b) return;
  const apply = (remove: boolean) => (lineStart ? applyLineStart(remove) : applyChord(remove));
  if (b.dataset.place) setPlace(b.dataset.place as Place);
  else if (b.id === "chord-apply") apply(false);
  else if (b.id === "chord-remove") apply(true);
  else if (b.id === "chord-cancel") closeMenu();
});
menu.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); closeMenu(); }
  else if (e.key === "Enter" && (e.target === menuInput || e.target === sylInput || e.target === entryInput)) {
    e.preventDefault();
    if (lineStart) applyLineStart(false); else applyChord(false);
  }
});

// Wiring.
text.addEventListener("keydown", (e) => {
  // Tab inserts spaces (chords line up by columns).
  if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    text.setRangeText("  ", text.selectionStart, text.selectionEnd, "end");
    schedule();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); }
});
problemsEl.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-line]");
  if (b) goToLine(Number(b.dataset.line));
});
$("open-input").addEventListener("change", (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) void openFile(f);
  (e.target as HTMLInputElement).value = "";
});
$("files-input").addEventListener("change", (e) => {
  const l = (e.target as HTMLInputElement).files;
  if (l?.length) void addFiles(l);
  (e.target as HTMLInputElement).value = "";
});
$("open").addEventListener("click", () => $("open-input").click());
$("add").addEventListener("click", () => $("files-input").click());
$("save").addEventListener("click", () => void save());
$("save-json").addEventListener("click", () => void saveJson());
$("print").addEventListener("click", () => window.print());
$("new").addEventListener("click", () => {
  if (confirm("Start over from the example chart? Unsaved changes are lost.")) { saveHandle = undefined; jsonHandle = undefined; setText(starter(), "chart.chart.txt"); }
});

let draft: { name: string; text: string } | undefined;
try {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (raw) draft = JSON.parse(raw) as { name: string; text: string };
} catch { /* storage unavailable */ }
setText(draft?.text ?? starter(), draft?.name ?? "chart.chart.txt");
