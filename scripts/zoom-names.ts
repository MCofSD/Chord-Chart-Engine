/** Writes a page of enlarged slash-chord names to the path given, for eyeballing spacing. */
import { readFileSync, writeFileSync } from "node:fs";
import { renderDiagram } from "../src/diagram/render.js";
import type { Voicing } from "../src/model/voicing.js";

const out = process.argv[2];
if (!out) throw new Error("usage: zoom-names <out.html>");
const bb: Voicing = JSON.parse(readFileSync("test/fixtures/Bb.json", "utf8"));
const chords: Voicing["chord"][] = [
  { root: "B", accidental: "b", quality: "m7", bass: "C" },
  { root: "G", quality: "7(b9)", bass: "F" },
  { root: "A", accidental: "b", bass: "Eb" },
];
const svgs = chords.map((chord) => renderDiagram({ ...bb, chord }, { scale: 3 }));
writeFileSync(out, `<!doctype html><meta charset="utf-8"><style>body{margin:10px;background:#fff;display:flex;gap:20px}</style>${svgs.join("")}`);
