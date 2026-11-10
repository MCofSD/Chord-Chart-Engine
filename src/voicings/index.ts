/**
 * Shared voicing library (owner, 2026-11-09): diagrams are editorial, so a
 * chart picks a voicing by id or gives its own shape; otherwise the first
 * library voicing for the chord is used. Chords the library doesn't have get
 * an empty diagram with the chord name and a review flag.
 */
import library from "./library.json" with { type: "json" };
import { chordLabel, type ChordName, type StringState, type Voicing } from "../model/voicing.js";

export interface LibraryEntry { id: string; voicing: Voicing }

export const LIBRARY: readonly LibraryEntry[] = library.voicings as LibraryEntry[];
const ALIASES: Record<string, string> = library.aliases;

/** Lookup key that keeps the parts apart: "F" + "b5" and "Fb" + "5" print alike but are different chords. */
const keyOf = (c: ChordName) => [c.root, c.accidental ?? "", c.quality ?? "", c.bass ?? ""].join("|");

const byId = new Map(LIBRARY.map((e) => [e.id, e]));
const byLabel = new Map<string, LibraryEntry[]>();
for (const e of LIBRARY) {
  const k = keyOf(e.voicing.chord);
  byLabel.set(k, [...(byLabel.get(k) ?? []), e]);
}

/** "Bbm7/C" -> { root: "B", accidental: "b", quality: "m7", bass: "C" }. Undefined if it isn't a chord name. */
export function parseChordName(text: string): ChordName | undefined {
  const m = /^([A-G])([b#♭♯]?)(.*?)(?:\/([A-G][b#♭♯]?))?$/.exec(text.trim());
  if (!m) return undefined;
  const acc = m[2] === "♭" ? "b" : m[2] === "♯" ? "#" : m[2];
  const bass = m[4]?.replace("♭", "b").replace("♯", "#");
  return { root: m[1]!, ...(acc ? { accidental: acc as "b" | "#" } : {}), ...(m[3] ? { quality: m[3] } : {}), ...(bass ? { bass } : {}) };
}

/** Library voicings for a chord, default first: its own spelling, then the quality's aliases. */
export function voicingsFor(chord: ChordName): LibraryEntry[] {
  const own = byLabel.get(keyOf(chord));
  if (own) return own;
  const alias = ALIASES[chord.quality ?? ""];
  if (alias !== undefined) return byLabel.get(keyOf({ ...chord, quality: alias })) ?? [];
  return [];
}

export interface PickedVoicing { voicing: Voicing; id?: string; warnings: string[] }

/**
 * The voicing a cover shows for `chord`: the chart's own shape, a library id,
 * or the library default. The chord name printed is always the chart's.
 */
export function pickVoicing(chord: ChordName, pick?: string | Voicing): PickedVoicing {
  const label = chordLabel(chord);
  const warnings: string[] = [];
  if (pick !== undefined && typeof pick !== "string") return { voicing: { ...pick, chord }, warnings };
  let entry: LibraryEntry | undefined;
  if (typeof pick === "string") {
    entry = byId.get(pick);
    if (!entry) warnings.push(`${label}: voicing "${pick}" is not in the library; using the default`);
  }
  entry ??= voicingsFor(chord)[0];
  if (!entry) {
    warnings.push(`${label}: no voicing in the library; an empty diagram is shown (add one to the chart or the library)`);
    return { voicing: placeholder(chord), warnings };
  }
  if (entry.voicing.review?.length) warnings.push(`${label}: starter library voicing ${entry.id}, not yet approved`);
  return { voicing: { ...entry.voicing, chord }, id: entry.id, warnings };
}

/** An empty grid with the chord's name, for chords without a voicing. */
export function placeholder(chord: ChordName): Voicing {
  const open: StringState = { kind: "open" };
  return { chord, strings: [open, open, open, open, open, open], windowStartFret: 1, review: ["no voicing: placeholder"] };
}
