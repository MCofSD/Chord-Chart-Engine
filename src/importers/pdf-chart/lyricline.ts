/**
 * Reads one lyric row of a legacy chart into lyric pieces (with backup-vocal
 * italics and asides), inline marks ("{2." ... "}", "(2x)"), and the
 * syllables with their positions in the source, for anchoring chords and
 * guessing rhythm. Hand-spaced syllable hyphens ("start - ed") are removed
 * and the word joined; the split is remembered as a syllable boundary.
 */
import type { LyricPiece, LyricStyle } from "../../model/chart.js";
import { RULES } from "../../rules/index.js";
import type { Glyph } from "./extract.js";
import { colorName } from "./style.js";

const I = RULES.import, S = RULES.symbols;

export interface Syllable { start: number; end: number; x0: number; x1: number; mid: number }

export interface ParsedLyric {
  lyrics: LyricPiece[];
  /** All text pieces joined (what anchors index into). */
  text: string;
  syllables: Syllable[];
  x0: number;
  x1: number;
}

const isLetter = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}'’]/u.test(ch);

export function parseLyricRow(glyphsIn: Glyph[], mainSize: number, flag: (msg: string) => void): ParsedLyric {
  const gs = [...glyphsIn].sort((a, b) => a.x0 - b.x0);
  while (gs.length && gs[0]!.ch === " ") gs.shift();
  const lyrics: LyricPiece[] = [];
  let text = "";
  /** Source box of each character of `text` (spaces get the gap). */
  const boxes: [number, number][] = [];
  const splits = new Set<number>();
  let prev: Glyph | undefined;
  let joinNext = false;

  const styleOf = (g: Glyph): LyricStyle | undefined => {
    const small = g.size < mainSize * 0.85;
    if (g.italic) return small ? "aside" : "backup";
    return small ? "asideUpright" : undefined;
  };
  const push = (ch: string, style: LyricStyle | undefined, box: [number, number]) => {
    const last = lyrics[lyrics.length - 1];
    if (last && "text" in last && last.style === style) last.text += ch;
    else lyrics.push(style ? { text: ch, style } : { text: ch });
    text += ch; boxes.push(box);
  };

  let spaceSeen = false;
  /** After an inline mark the gap is measured from small text (e.g. a 9 pt "2."), so any visible gap counts. */
  let afterItem = false;
  const breakBefore = (g: Glyph) => {
    const gap = prev !== undefined ? g.x0 - prev.x1 : 0;
    const wide = prev !== undefined && (afterItem ? gap > 1 : gap > I.wordGap * Math.max(g.size, prev.size));
    const lastIsItem = lyrics.length > 0 && "item" in lyrics[lyrics.length - 1]!;
    if ((spaceSeen || wide) && (text.length || afterItem) && (lastIsItem || !text.endsWith(" "))) {
      // A space before a mark belongs to the text before it; after a mark, to the text after it.
      push(" ", afterItem ? styleOf(g) : prev ? styleOf(prev) : undefined, [prev?.x1 ?? g.x0, g.x0]);
    }
    spaceSeen = false;
    afterItem = false;
  };
  for (let i = 0; i < gs.length; i++) {
    const g = gs[i]!;
    if (g.ch === " ") { if (!joinNext) spaceSeen = true; continue; }
    const color = colorName(g.color);
    const gapBefore = prev ? g.x0 - prev.x1 : 0;

    // Inline repeat endings and counts.
    if (g.ch === S.endingOpen && color === "black") {
      breakBefore(g);
      let j = i + 1, n = "";
      while (j < gs.length && /[0-9.]/.test(gs[j]!.ch) && colorName(gs[j]!.color) === "red") { n += gs[j]!.ch; j++; }
      lyrics.push({ item: { t: "endingOpen", n: n.replace(/\.$/, "") || "1" } });
      prev = gs[j - 1]; i = j - 1; afterItem = true; continue;
    }
    if (g.ch === S.endingClose && color === "black") { lyrics.push({ item: { t: "endingClose" } }); prev = g; afterItem = true; continue; }
    if (color === "red") {
      breakBefore(g);
      let j = i, s = "";
      while (j < gs.length && colorName(gs[j]!.color) === "red") s += gs[j++]!.ch;
      // Plain "(" just before and ")" just after belong to the mark ("(2x)" with black parentheses).
      const lastChar = text[text.length - 1];
      if (lastChar === "(" && prev && g.x0 - prev.x1 < 2) {
        text = text.slice(0, -1); boxes.pop();
        const lp = lyrics[lyrics.length - 1];
        if (lp && "text" in lp) { lp.text = lp.text.slice(0, -1); if (!lp.text) lyrics.pop(); }
      }
      const close = gs[j];
      if (close && close.ch === ")" && colorName(close.color) !== "red" && close.x0 - gs[j - 1]!.x1 < 2) j++;
      const inner = s.replace(/^\(|\)$/g, "");
      if (new RegExp(S.times).test(inner)) lyrics.push({ item: { t: "times", text: inner } });
      else {
        lyrics.push({ item: s.startsWith("(") ? { t: "text", text: inner } : { t: "text", text: s, paren: false } });
        flag(`read red text "${s}" in a lyric line as a free-text instruction; check`);
      }
      prev = gs[j - 1]; i = j - 1; afterItem = true; continue;
    }
    if (color !== "gray" && color !== "black") flag(`lyric character "${g.ch}" in unexpected color ${g.color}`);

    // Hand-spaced syllable hyphen: drop it and join the word.
    const nextG = gs.slice(i + 1).find((x) => x.ch !== " ");
    if ((I.syllableHyphens as string[]).includes(g.ch) && prev && nextG && isLetter(text[text.length - 1])
        && isLetter(nextG.ch) && gapBefore > 1.4 && nextG.x0 - g.x1 > 1.4) {
      joinNext = true; spaceSeen = false; prev = g; continue;
    }
    if (joinNext) { splits.add(text.length); joinNext = false; spaceSeen = false; }
    else breakBefore(g);
    push(g.ch, styleOf(g), [g.x0, g.x1]);
    prev = g;
  }

  // Syllables: words, split again where a syllable hyphen was removed.
  const syllables: Syllable[] = [];
  let k = 0;
  while (k < text.length) {
    if (!isLetter(text[k])) { k++; continue; }
    let e = k + 1;
    while (e < text.length && text[e] !== " " && !splits.has(e)) e++;
    let a = k, b = e;
    while (b > a && !isLetter(text[b - 1])) b--;
    const x0 = boxes[a]![0], x1 = boxes[b - 1]![1];
    syllables.push({ start: k, end: e, x0, x1, mid: (x0 + x1) / 2 });
    k = e;
  }
  // Trailing spaces carry no meaning.
  const lastPiece = lyrics[lyrics.length - 1];
  if (lastPiece && "text" in lastPiece) { lastPiece.text = lastPiece.text.trimEnd(); if (!lastPiece.text) lyrics.pop(); }
  text = lyrics.map((p) => ("text" in p ? p.text : "")).join("");
  return { lyrics, text, syllables, x0: gs[0]?.x0 ?? 0, x1: gs[gs.length - 1]?.x1 ?? 0 };
}
