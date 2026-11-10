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
let saveHandle: FileSystemFileHandle | undefined;

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
    const body = renderChart(chart, { notation });
    const cover = renderCover(chart);
    const missing = new Set<string>();
    const pages = [...cover.pages, ...body.pages].map((svg) => linkImages(svg, missing));
    pagesEl.innerHTML = pages
      .map((svg, i) => `<div class="page" aria-label="Page ${i + 1} of ${pages.length}">${svg.replace('width="8.5in" height="11in"', 'width="100%" height="100%"')}</div>`)
      .join("");
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
  fileName = name;
  $("file-name").textContent = name;
  render();
}

async function openFile(file: File): Promise<void> {
  const src = await file.text();
  saveHandle = undefined;
  if (/\.json$/i.test(file.name)) {
    try {
      setText(writeChartText(JSON.parse(src) as Chart), file.name.replace(/\.json$/i, ".chart.txt"));
    } catch (e) {
      alert(`${file.name} is not a chart JSON file: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else setText(src, file.name);
}

async function save(): Promise<void> {
  const blob = new Blob([text.value], { type: "text/plain;charset=utf-8" });
  const picker = (window as unknown as { showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (picker) {
    try {
      saveHandle ??= await picker({ suggestedName: fileName, types: [{ description: "Chart text", accept: { "text/plain": [".txt"] } }] });
      const w = await saveHandle.createWritable();
      await w.write(blob);
      await w.close();
      fileName = saveHandle.name;
      $("file-name").textContent = fileName;
      statusEl.textContent = `Saved ${fileName}.`;
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
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

// Wiring.
text.addEventListener("input", schedule);
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
$("print").addEventListener("click", () => window.print());
$("new").addEventListener("click", () => {
  if (confirm("Start over from the example chart? Unsaved changes are lost.")) { saveHandle = undefined; setText(starter(), "chart.chart.txt"); }
});

let draft: { name: string; text: string } | undefined;
try {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (raw) draft = JSON.parse(raw) as { name: string; text: string };
} catch { /* storage unavailable */ }
setText(draft?.text ?? starter(), draft?.name ?? "chart.chart.txt");
