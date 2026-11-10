/**
 * Writes the starter voicing library, src/voicings/library.json (owner,
 * 2026-11-09: a shared library of common shapes, reviewed by the owner, with
 * per-chart picks and custom shapes on top).
 *
 * The owner's four Corel diagrams (Fm, Eb, Bb, Ab) first, then open chords,
 * plus movable E-shape (root on the 6th string) and A-shape
 * (root on the 5th string) chords for every root. Every voicing is marked
 * for review until the owner approves it; after that, library.json is edited
 * by hand and this script is not run again (it would overwrite the edits).
 *
 * Run: npx tsx scripts/gen-voicings.ts [--force]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Barre, ChordName, Finger, StringState, Voicing } from "../src/model/voicing.js";
import { validateVoicing } from "../src/model/validate.js";

const OUT = "src/voicings/library.json";
if (existsSync(OUT) && !process.argv.includes("--force")) {
  console.error(`${OUT} exists (it may have hand edits). Pass --force to overwrite.`);
  process.exit(1);
}

/** Fret per string, low E first: a number, 0 = open, "x" = not played. Fingers: 0 = none. */
type Shape = { frets: (number | "x")[]; fingers: (Finger | 0)[]; barre?: { finger: Finger; from: number; to: number } };

/** Highest fret number the diagram can print beside the grid (one digit). */
const MAX_LABEL_FRET = 9;

const REVIEW = ["starter library shape: not yet approved by the owner"];

// Open chords (natural names only).
const OPEN: Record<string, Shape> = {
  "C": { frets: ["x", 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] },
  "A": { frets: ["x", 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0] },
  "G": { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3] },
  "E": { frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] },
  "D": { frets: ["x", "x", 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2] },
  "Am": { frets: ["x", 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0] },
  "Em": { frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0] },
  "Dm": { frets: ["x", "x", 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1] },
  "A7": { frets: ["x", 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0] },
  "E7": { frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0] },
  "D7": { frets: ["x", "x", 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3] },
  "C7": { frets: ["x", 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0] },
  "G7": { frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1] },
  "B7": { frets: ["x", 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4] },
  "Am7": { frets: ["x", 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0] },
  "Em7": { frets: [0, 2, 0, 0, 0, 0], fingers: [0, 2, 0, 0, 0, 0] },
  "Dm7": { frets: ["x", "x", 0, 2, 1, 1], fingers: [0, 0, 0, 2, 1, 1], barre: { finger: 1, from: 4, to: 5 } },
  "CMaj7": { frets: ["x", 3, 2, 0, 0, 0], fingers: [0, 3, 2, 0, 0, 0] },
  "AMaj7": { frets: ["x", 0, 2, 1, 2, 0], fingers: [0, 0, 2, 1, 3, 0] },
  "DMaj7": { frets: ["x", "x", 0, 2, 2, 2], fingers: [0, 0, 0, 1, 1, 1], barre: { finger: 1, from: 3, to: 5 } },
  "FMaj7": { frets: ["x", "x", 3, 2, 1, 0], fingers: [0, 0, 3, 2, 1, 0] },
  "GMaj7": { frets: [3, 2, 0, 0, 0, 2], fingers: [3, 2, 0, 0, 0, 1] },
  "Asus": { frets: ["x", 0, 2, 2, 3, 0], fingers: [0, 0, 1, 2, 3, 0] },
  "Dsus": { frets: ["x", "x", 0, 2, 3, 3], fingers: [0, 0, 0, 1, 3, 4] },
  "Esus": { frets: [0, 2, 2, 2, 0, 0], fingers: [0, 2, 3, 4, 0, 0] },
  "Asus2": { frets: ["x", 0, 2, 2, 0, 0], fingers: [0, 0, 1, 2, 0, 0] },
  "Dsus2": { frets: ["x", "x", 0, 2, 3, 0], fingers: [0, 0, 0, 1, 3, 0] },
  "A7sus": { frets: ["x", 0, 2, 0, 3, 0], fingers: [0, 0, 2, 0, 3, 0] },
  "D7sus": { frets: ["x", "x", 0, 2, 1, 3], fingers: [0, 0, 0, 2, 1, 3] },
  "E7sus": { frets: [0, 2, 0, 2, 0, 0], fingers: [0, 2, 0, 3, 0, 0] },
  "Cadd9": { frets: ["x", 3, 2, 0, 3, 0], fingers: [0, 2, 1, 0, 3, 0] },
  "E5": { frets: [0, 2, 2, "x", "x", "x"], fingers: [0, 1, 2, 0, 0, 0] },
  "A5": { frets: ["x", 0, 2, 2, "x", "x"], fingers: [0, 0, 1, 2, 0, 0] },
  "D5": { frets: ["x", "x", 0, 2, 3, "x"], fingers: [0, 0, 0, 1, 3, 0] },
  "A6": { frets: ["x", 0, 2, 2, 2, 2], fingers: [0, 0, 1, 1, 1, 1], barre: { finger: 1, from: 2, to: 5 } },
  "A7sus2": { frets: ["x", 0, 2, 0, 0, 0], fingers: [0, 0, 2, 0, 0, 0] },
  "G6": { frets: [3, 2, 0, 0, 0, 0], fingers: [2, 1, 0, 0, 0, 0] },
};

/** Movable shapes: frets relative to the root fret f. */
type Movable = { rel: (number | "x")[]; fingers: (Finger | 0)[]; barre?: { finger: Finger; rel: number; from: number; to: number } };
const E_SHAPE: Record<string, Movable> = {
  "": { rel: [0, 2, 2, 1, 0, 0], fingers: [1, 3, 4, 2, 1, 1], barre: { finger: 1, rel: 0, from: 0, to: 5 } },
  "m": { rel: [0, 2, 2, 0, 0, 0], fingers: [1, 3, 4, 1, 1, 1], barre: { finger: 1, rel: 0, from: 0, to: 5 } },
  "7": { rel: [0, 2, 0, 1, 0, 0], fingers: [1, 3, 1, 2, 1, 1], barre: { finger: 1, rel: 0, from: 0, to: 5 } },
  "m7": { rel: [0, 2, 0, 0, 0, 0], fingers: [1, 3, 1, 1, 1, 1], barre: { finger: 1, rel: 0, from: 0, to: 5 } },
  "Maj7": { rel: [0, "x", 1, 1, 0, "x"], fingers: [1, 0, 3, 4, 2, 0] },
  "sus": { rel: [0, 2, 2, 2, 0, 0], fingers: [1, 2, 3, 4, 1, 1], barre: { finger: 1, rel: 0, from: 0, to: 5 } },
  "7sus": { rel: [0, 2, 0, 2, 0, 0], fingers: [1, 3, 1, 4, 1, 1], barre: { finger: 1, rel: 0, from: 0, to: 5 } },
  "5": { rel: [0, 2, 2, "x", "x", "x"], fingers: [1, 3, 4, 0, 0, 0] },
  "m7b5": { rel: [0, "x", 0, 0, -1, "x"], fingers: [2, 0, 3, 4, 1, 0] },
  "dim": { rel: [0, 1, 2, 0, "x", "x"], fingers: [1, 2, 4, 1, 0, 0] },
  "dim7": { rel: [0, "x", -1, 0, -1, "x"], fingers: [2, 0, 1, 3, 1, 0] },
};
const A_SHAPE: Record<string, Movable> = {
  "": { rel: ["x", 0, 2, 2, 2, 0], fingers: [0, 1, 2, 3, 4, 1], barre: { finger: 1, rel: 0, from: 1, to: 5 } },
  "m": { rel: ["x", 0, 2, 2, 1, 0], fingers: [0, 1, 3, 4, 2, 1], barre: { finger: 1, rel: 0, from: 1, to: 5 } },
  "7": { rel: ["x", 0, 2, 0, 2, 0], fingers: [0, 1, 3, 1, 4, 1], barre: { finger: 1, rel: 0, from: 1, to: 5 } },
  "m7": { rel: ["x", 0, 2, 0, 1, 0], fingers: [0, 1, 3, 1, 2, 1], barre: { finger: 1, rel: 0, from: 1, to: 5 } },
  "Maj7": { rel: ["x", 0, 2, 1, 2, 0], fingers: [0, 1, 3, 2, 4, 1], barre: { finger: 1, rel: 0, from: 1, to: 5 } },
  "sus": { rel: ["x", 0, 2, 2, 3, 0], fingers: [0, 1, 2, 3, 4, 1], barre: { finger: 1, rel: 0, from: 1, to: 5 } },
  "sus2": { rel: ["x", 0, 2, 2, 0, 0], fingers: [0, 1, 3, 4, 1, 1], barre: { finger: 1, rel: 0, from: 1, to: 5 } },
  "7sus": { rel: ["x", 0, 2, 0, 3, 0], fingers: [0, 1, 3, 1, 4, 1], barre: { finger: 1, rel: 0, from: 1, to: 5 } },
  "7sus2": { rel: ["x", 0, 2, 0, 0, 0], fingers: [0, 1, 3, 1, 1, 1], barre: { finger: 1, rel: 0, from: 1, to: 5 } },
  "9": { rel: ["x", 0, -1, 0, 0, 0], fingers: [0, 2, 1, 3, 3, 3], barre: { finger: 3, rel: 0, from: 3, to: 5 } },
  "6": { rel: ["x", 0, 2, 2, 2, 2], fingers: [0, 1, 3, 3, 3, 3], barre: { finger: 3, rel: 2, from: 2, to: 5 } },
  "5": { rel: ["x", 0, 2, 2, "x", "x"], fingers: [0, 1, 3, 4, 0, 0] },
  "m7b5": { rel: ["x", 0, 1, 0, 1, "x"], fingers: [0, 1, 3, 2, 4, 0] },
  "dim": { rel: ["x", 0, 1, 2, 1, "x"], fingers: [0, 1, 2, 4, 3, 0] },
  "dim7": { rel: ["x", 0, 1, -1, 1, "x"], fingers: [0, 2, 3, 1, 4, 0] },
};

const ROOTS: [string, "b" | "#" | undefined, number][] = [
  ["C", undefined, 0], ["C", "#", 1], ["D", "b", 1], ["D", undefined, 2], ["D", "#", 3], ["E", "b", 3],
  ["E", undefined, 4], ["F", undefined, 5], ["F", "#", 6], ["G", "b", 6], ["G", undefined, 7], ["G", "#", 8],
  ["A", "b", 8], ["A", undefined, 9], ["A", "#", 10], ["B", "b", 10], ["B", undefined, 11],
];

function toVoicing(chord: ChordName, s: Shape): Voicing {
  const played = s.frets.filter((f): f is number => typeof f === "number" && f > 0);
  const min = played.length ? Math.min(...played) : 1;
  const max = played.length ? Math.max(...played) : 1;
  // As in the Corel samples: an empty row above the lowest fret when the shape leaves room, with the fret number beside that fret.
  const windowStartFret = min <= 1 ? 1 : max - min <= 2 ? min - 1 : min;
  const strings: StringState[] = s.frets.map((f, i) => {
    if (f === "x") return { kind: "mutedOpen" };
    if (f === 0) return { kind: "open" };
    const finger = s.fingers[i];
    return finger ? { kind: "fretted", fret: f, finger } : { kind: "fretted", fret: f };
  });
  const v: Voicing = { chord, strings, windowStartFret };
  if (windowStartFret !== 1) v.fretLabelRow = min - windowStartFret;
  if (s.barre) {
    const fret = s.frets[s.barre.from] as number;
    const b: Barre = { fret, from: s.barre.from, to: s.barre.to, sounding: [[s.barre.from, s.barre.to]] };
    v.barres = [b];
  }
  v.review = [...REVIEW];
  return v;
}

const nameOf = (root: string, acc: string | undefined, q: string) => root + (acc ?? "") + q;
const chordOf = (root: string, acc: "b" | "#" | undefined, q: string): ChordName => ({ root, ...(acc ? { accidental: acc } : {}), ...(q ? { quality: q } : {}) });

const out: { id: string; voicing: Voicing }[] = [];
const qualities = [...new Set([...Object.keys(E_SHAPE), ...Object.keys(A_SHAPE)])];
for (const [root, acc, pc] of ROOTS) {
  for (const q of qualities) {
    const name = nameOf(root, acc, q);
    const chord = chordOf(root, acc, q);
    const open = acc ? undefined : OPEN[name];
    const shapes: { id: string; shape: Shape; fret: number }[] = [];
    if (open) shapes.push({ id: `${name}/open`, shape: open, fret: 0 });
    for (const [label, table, base] of [["E", E_SHAPE, 4], ["A", A_SHAPE, 9]] as const) {
      const m = table[q];
      if (!m) continue;
      const f = (pc - base + 12) % 12 || 12; // root fret on the 6th (E) or 5th (A) string; never open
      if (open && f === 12) continue;
      const frets = m.rel.map((r) => (r === "x" ? "x" : f + r)) as (number | "x")[];
      if (frets.some((x) => typeof x === "number" && (x < 1 || x > 15))) continue;
      // The diagram has room for a one-digit fret number only.
      const lowest = Math.min(...frets.filter((x): x is number => typeof x === "number"));
      if (lowest > MAX_LABEL_FRET) continue;
      const shape: Shape = { frets, fingers: m.fingers };
      if (m.barre) shape.barre = { finger: m.barre.finger, from: m.barre.from, to: m.barre.to };
      shapes.push({ id: `${name}/${label}-shape@${f}`, shape, fret: f });
    }
    // Open first, then the lower position.
    shapes.sort((a, b) => a.fret - b.fret);
    for (const s of shapes) out.push({ id: s.id, voicing: toVoicing(chord, s.shape) });
  }
}
// Open chords whose quality has no movable shape (Cadd9).
for (const [name, shape] of Object.entries(OPEN)) {
  if (out.some((e) => e.id === `${name}/open`)) continue;
  const m = /^([A-G])(.*)$/.exec(name)!;
  out.push({ id: `${name}/open`, voicing: toVoicing(chordOf(m[1]!, undefined, m[2]!), shape) });
}

// The owner's own diagrams (the Corel samples) come first: they are the defaults for their chords.
for (const name of ["Ab", "Bb", "Eb", "Fm"]) {
  const v = JSON.parse(readFileSync(`test/fixtures/${name}.json`, "utf8")) as Voicing;
  delete v.review;
  const at = out.findIndex((e) => e.id.startsWith(`${name}/`));
  out.splice(at < 0 ? out.length : at, 0, { id: `${name}/sample`, voicing: v });
}

for (const e of out) {
  const r = validateVoicing(e.voicing);
  if (!r.ok) throw new Error(`${e.id}: ${r.errors.join("; ")}`);
}

const library = {
  _note: "Shared voicing library (owner, 2026-11-09). The first voicing listed for a chord is its default; a chart can pick another by id, or give its own shape (chart.cover.diagrams). Generated by scripts/gen-voicings.ts as a starting point; every shape carries a review flag until the owner approves it. Edit this file by hand from now on.",
  _aliases: "Other spellings of a quality, looked up when a chord isn't listed under its own spelling. '(m)5' and '5(m)' are power chords in a minor context (verify).",
  aliases: { "maj7": "Maj7", "M7": "Maj7", "sus4": "sus", "7sus4": "7sus", "(m)5": "5", "5(m)": "5", "m7(b5)": "m7b5", "ø": "m7b5", "o": "dim", "o7": "dim7", "min": "m", "-": "m" },
  voicings: out,
};
// One voicing per line, so the file is easy to read and review.
const head = JSON.stringify({ ...library, voicings: [] }, null, 2).replace(/\[\]\n\}$/, "");
writeFileSync(OUT, `${head}[\n${out.map((e) => `    ${JSON.stringify(e)}`).join(",\n")}\n  ]\n}\n`);
console.log(`wrote ${OUT}: ${out.length} voicings`);
