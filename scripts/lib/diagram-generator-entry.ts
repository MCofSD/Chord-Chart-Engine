/**
 * Browser entry for diagram-generator.html. Bundled by
 * scripts/build-diagram-generator.ts; uses the same renderer as the cover
 * and the preview, so the page always follows the current drawing rules.
 */
import { renderDiagram } from "../../src/diagram/render.js";
import { chordLabel, STRING_COUNT, type Voicing } from "../../src/model/voicing.js";
import Fm from "../../test/fixtures/Fm.json" with { type: "json" };
import Eb from "../../test/fixtures/Eb.json" with { type: "json" };
import Bb from "../../test/fixtures/Bb.json" with { type: "json" };
import Ab from "../../test/fixtures/Ab.json" with { type: "json" };

/** The four Corel samples as imported (golden fixtures), minus importer review notes. */
const SAMPLES: Record<string, Voicing> = Object.fromEntries(
  Object.entries({ Fm, Eb, Bb, Ab }).map(([k, v]) => {
    const { review: _review, ...rest } = v as Voicing & { review?: string[] };
    return [k, rest as Voicing];
  }),
);

/** Caption text with flat/sharp symbols, matching the diagram. */
const caption = (label: string) => label.replace(/(^[A-G]|\/[A-G])b/g, "$1♭").replace(/#/g, "♯");

const $ = (id: string) => document.getElementById(id)!;
const json = $("json") as HTMLTextAreaElement;
let scale = 1;

$("gallery").innerHTML = Object.entries(SAMPLES)
  .map(([k, v]) => `<figure>${renderDiagram(v, { scale: 1 })}<figcaption>${caption(k)}</figcaption></figure>`)
  .join("");
$("pick").innerHTML = Object.keys(SAMPLES).map((k) => `<option>${k}</option>`).join("");

function draw(): void {
  try {
    const v = JSON.parse(json.value) as Voicing;
    if (!v.chord?.root) throw new Error("“chord” needs a “root”, e.g. {\"root\": \"F\"}.");
    if (!Array.isArray(v.strings) || v.strings.length !== STRING_COUNT)
      throw new Error(`“strings” needs exactly ${STRING_COUNT} entries, left to right.`);
    if (typeof v.windowStartFret !== "number") throw new Error("“windowStartFret” needs a number (1 = top row is fret 1).");
    $("prev").innerHTML = `<figure>${renderDiagram(v, { scale })}<figcaption>${caption(chordLabel(v.chord))}</figcaption></figure>`;
    $("err").textContent = "";
  } catch (e) {
    $("err").textContent = "Can’t draw this yet: " + (e as Error).message;
  }
}

/** Pretty-print with short arrays and objects kept on one line. */
function format(v: Voicing): string {
  return JSON.stringify(v, null, 1)
    .replace(/\n\s+(?=[^\s[\]{}])/g, " ")
    .replace(/\n\s*([}\]])/g, " $1");
}

function load(k: string): void {
  json.value = format(SAMPLES[k]!);
  draw();
}

$("pick").addEventListener("change", (e) => load((e.target as HTMLSelectElement).value));
json.addEventListener("input", draw);
document.querySelectorAll<HTMLButtonElement>("button[data-s]").forEach((b) =>
  b.addEventListener("click", () => {
    scale = Number(b.dataset.s);
    document.querySelectorAll("button[data-s]").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
    draw();
  }),
);
load("Fm");
