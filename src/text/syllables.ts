/**
 * Sung syllables of a word (owner, 2026-11-09: "walking" has two, and a beat
 * sits on the middle of its syllable, so "Walk" is what lands on the beat).
 *
 * 1. Hyphenation patterns for the chart's language (the `hyphen` package,
 *    the patterns word processors use), chosen in rules.lyrics.patterns.
 * 2. Those patterns avoid short splits at word edges (to-night, a-way), which
 *    singing needs, so any piece still holding several vowel groups is split
 *    by a simple sung-syllable rule: before a single consonant (a|way), between
 *    two consonants (lan|terns), keeping digraphs together (sing|er, fa|ther);
 *    a silent final "e" stays in the syllable before it (breathe, you've).
 *    For languages without patterns (e.g. Tagalog) this rule does it all.
 * Words listed in rules.lyrics.exceptions ("fire" or "fi-re") override both.
 */
import { createRequire } from "node:module";
import { RULES } from "../rules/index.js";

const require = createRequire(import.meta.url);
type Hyphenator = { hyphenateSync: (text: string, opts: { hyphenChar?: string; minWordLength?: number; exceptions?: string[] }) => string };
const hyphenators = new Map<string, Hyphenator | null>();
const L = RULES.lyrics;
const SEP = "\u0001";

function hyphenator(lang: string): Hyphenator | null {
  const mod = (L.patterns as Record<string, string>)[lang.toLowerCase()];
  if (!mod) return null;
  if (!hyphenators.has(mod)) hyphenators.set(mod, require(`hyphen/${mod}`) as Hyphenator);
  return hyphenators.get(mod)!;
}

const VOWEL = /[aeiouyáéíóúàèìòùâêîôûäëïöüãõ]/i;
const PLAIN_VOWEL = /[aeiouáéíóúàèìòùâêîôûäëïöüãõ]/i;
type Digraphs = { onset: string[]; coda: string[] };
const digraphsFor = (lang: string): Digraphs => {
  const all = L.digraphs as Record<string, Digraphs>;
  return all[lang.toLowerCase()] ?? all.default!;
};

/** Vowel groups of a piece, as [start, end) ranges; "y" before a vowel is a consonant (yeah, sa|yaw, be|yond). */
function vowelGroups(s: string): [number, number][] {
  const groups: [number, number][] = [];
  for (let i = 0; i < s.length; i++) {
    const v = VOWEL.test(s[i]!) && !(/y/i.test(s[i]!) && (i === 0 || PLAIN_VOWEL.test(s[i + 1] ?? "")));
    if (!v) continue;
    const last = groups[groups.length - 1];
    if (last && last[1] === i) last[1] = i + 1; else groups.push([i, i + 1]);
  }
  // Silent final "e" (breathe, you've, time): part of the syllable before it.
  const last = groups[groups.length - 1];
  if (groups.length > 1 && last && last[1] - last[0] === 1 && /e/i.test(s[last[0]]!) && /^(e|e'?[sd]?|e's)$/i.test(s.slice(last[0]).replace(/[^a-z']/gi, ""))
      && !/[aeiouy]/i.test(s[last[0] - 1] ?? "") && !/le$/i.test(s.slice(last[0] - 1))) {
    groups.pop();
  }
  return groups;
}

/** Where a piece with several vowel groups splits, by the sung-syllable rule (offsets inside the piece). */
function ruleSplits(s: string, lang: string): number[] {
  const { onset, coda } = digraphsFor(lang);
  const g = vowelGroups(s);
  const cuts: number[] = [];
  for (let k = 0; k + 1 < g.length; k++) {
    const a = g[k]![1], b = g[k + 1]![0]; // consonants between the groups: s[a..b)
    const cons = s.slice(a, b).toLowerCase().replace(/'/g, "");
    let cut: number;
    if (cons.length <= 1) cut = a; // V|V or V|CV
    else if (coda.includes(cons.slice(0, 2))) cut = a + 2; // pick|ing, sing|er
    else if (onset.includes(cons.slice(-2))) cut = b - 2; // fa|ther, pa|nga|rap
    else cut = a + 1; // lan|terns, win|dow
    if (cut > 0 && cut < s.length) cuts.push(cut);
  }
  return cuts;
}

/** Offsets (> 0) inside `word` where a new sung syllable starts. */
export function syllableStarts(word: string, lang: string = L.defaultLanguage): number[] {
  const lower = word.toLowerCase();
  const exception = (L.exceptions as string[]).find((e) => e.replace(/-/g, "") === lower);
  if (exception) {
    const starts: number[] = [];
    let n = 0;
    for (const ch of exception) { if (ch === "-") starts.push(n); else n++; }
    return starts;
  }
  const h = hyphenator(lang);
  const pieces = h ? h.hyphenateSync(word, { hyphenChar: SEP, minWordLength: 1 }).split(SEP) : [word];
  const starts: number[] = [];
  let at = 0;
  pieces.forEach((p, i) => {
    if (i > 0) starts.push(at);
    for (const c of ruleSplits(p, lang)) starts.push(at + c);
    at += p.length;
  });
  return [...new Set(starts)].filter((s) => s > 0 && s < word.length).sort((a, b) => a - b);
}

/** Syllables of a word, e.g. "Walking" -> ["Walk", "ing"]. */
export function syllables(word: string, lang?: string): string[] {
  const cuts = [0, ...syllableStarts(word, lang), word.length];
  return cuts.slice(1).map((e, i) => word.slice(cuts[i], e));
}
