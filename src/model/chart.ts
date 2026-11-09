/**
 * Chart model: a song as structured data (CLAUDE.md §1, §9). Layout and
 * styling live in src/chart; nothing here knows about positions or fonts,
 * except that chord-line items are pinned to characters of the lyric.
 */
import type { ChordName } from "./voicing.js";

export type SectionType =
  | "intro" | "verse" | "prechorus" | "refrain" | "chorus" | "bridge"
  | "break" | "solo" | "interlude" | "outro" | "ending" | "other";

export interface Chart {
  meta: ChartMeta;
  sections: Section[];
}

export interface ChartMeta {
  title: string;
  artist: string;
  year?: number;
  /** Key as printed, e.g. "G", "Em", "F#", "Eb". */
  key: string;
  bpm?: number;
  /** ISO date printed top left (last-saved vs revision date is open question §10.5). */
  date?: string;
}

export interface Section {
  type: SectionType;
  /** Label as printed in the left column, e.g. "Intro", "1st Ver", "Ref 1". Ordinals are superscripted. */
  label: string;
  blocks: Block[];
}

export type Block = LineBlock | SnippetBlock | NoteBlock;

/** One chord line over one lyric line. Either part may be empty. */
export interface LineBlock {
  kind: "line";
  lyrics: LyricPiece[];
  /** Chord-line groups, each pinned to a character of the concatenated lyric text. */
  above: Anchor[];
}

export type LyricPiece =
  | { text: string; style?: LyricStyle }
  /** A mark printed inline in the lyric line, e.g. the "{2." of a repeat ending. */
  | { item: ChordLineItem };

export type LyricStyle =
  /** Italic: sung by backup vocalists (Legend ***). */
  | "backup"
  /** Smaller aside such as "(thanks to you)", italic. (verify) */
  | "aside"
  /** Smaller aside, upright. (verify) */
  | "asideUpright";

export interface Anchor {
  /**
   * Index into the lyric text (all text pieces joined). The first chord in
   * the group is drawn over this character; bar lines before it hang to the
   * left. An index at or past the end of the lyric places the group after it.
   */
  at: number;
  items: ChordLineItem[];
  /**
   * Timing relative to the lyric (owner, 2026-11-08), shown through spacing:
   * - "on" (default): the chord's root is drawn right over character `at`.
   * - "before": played just before the syllable starting at `at`. The lyric
   *   opens a gap before `at` and the chord sits close to that syllable.
   * - "after": played just after the syllable that ends before `at`. Same gap,
   *   but the chord sits close to the previous syllable.
   * "on" groups at or past the end of the lyric go on the 0.5" tab grid.
   */
  place?: "on" | "before" | "after";
  /** Push the group to the right margin instead (e.g. "(simile)" at line end). */
  alignRight?: boolean;
}

export type ChordLineItem =
  | { t: "bar" }
  /** The "-" of "| -" (display-only; meaning not in the Legend). */
  | { t: "same" }
  | { t: "chord"; chord: ChordName; beats?: string; noBass?: boolean; paren?: boolean }
  | { t: "instrument"; op: "add" | "remove" | "only" | "except"; text: string }
  | { t: "stop"; kind: "abrupt" | "hold"; beats?: string; beatsFirst?: boolean }
  | { t: "direction"; text: "simile" | "ritard" | "NC" | "dstrn" | "Vamp" | "1/2T" }
  | { t: "times"; text: string }
  /**
   * Circled riff reference, printed number `n`. `riff` says which repeated
   * riff it points to: 1 (default) prints dark blue, 2 light blue (owner,
   * 2026-11-08). Light is only needed when a chart repeats more than one riff.
   */
  | { t: "ref"; n: number; riff?: number }
  | { t: "meter"; top: number; bottom: number }
  | { t: "arrowDown" }
  /** "{" plus the repeat number, e.g. "{2." */
  | { t: "endingOpen"; n: string }
  | { t: "endingClose" };

/** A notation PNG placed as a flow block (CLAUDE.md §8). Chord symbols are baked into the image. */
export interface SnippetBlock {
  kind: "snippet";
  /** Path or URL of the PNG. */
  src: string;
  /** Size on the page, in points. */
  width: number;
  height: number;
  /** Text printed over the top band of the image, e.g. "(⊕RGtr)" or "(simile)". */
  overlay?: { x: number; items: ChordLineItem[]; alignRight?: boolean }[];
}

/**
 * A full-width text line such as "Repeat Chorus". A `section` piece refers
 * back to an earlier section: on paper the reader's eye goes back to it (its
 * label is colored so it is easy to find); a future web/tablet view can copy
 * that section in instead.
 */
export interface NoteBlock {
  kind: "note";
  pieces: ({ text: string } | SectionRef)[];
}

export interface SectionRef {
  section: SectionType;
  text: string;
  /** Label of the exact section meant (e.g. "1st Ver"). Default: the latest earlier section of that type. */
  label?: string;
}

/**
 * Resolves every "Repeat ..." reference to the index of the section it means:
 * the latest earlier section with that label, or else of that type.
 * Returns the referenced section indices and any references that match nothing.
 */
export function resolveRepeats(chart: Chart): { targets: Set<number>; refs: Map<SectionRef, number>; unresolved: string[] } {
  const targets = new Set<number>();
  const refs = new Map<SectionRef, number>();
  const unresolved: string[] = [];
  chart.sections.forEach((section, i) => {
    for (const block of section.blocks) {
      if (block.kind !== "note") continue;
      for (const piece of block.pieces) {
        if (!("section" in piece)) continue;
        let found = -1;
        for (let j = i - 1; j >= 0; j--) {
          const s = chart.sections[j]!;
          if (piece.label !== undefined ? s.label === piece.label : s.type === piece.section) { found = j; break; }
        }
        if (found >= 0) { targets.add(found); refs.set(piece, found); }
        else unresolved.push(`"${piece.text}" (${piece.label ?? piece.section}) does not match an earlier section`);
      }
    }
  });
  return { targets, refs, unresolved };
}
