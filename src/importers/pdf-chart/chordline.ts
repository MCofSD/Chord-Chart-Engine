/**
 * Reads one chord row of a legacy chart (glyphs on one baseline, with their
 * superscripts) into chord-line groups, using the vocabulary in the rules
 * file. Each group also gets its beat point in the source: the weighted
 * middle of its chord (rules: chord.extensionWeight, chord.bassWeight), the
 * middle of a "-", or of a timed "//".
 */
import type { ChordLineItem } from "../../model/chart.js";
import type { ChordName } from "../../model/voicing.js";
import { RULES } from "../../rules/index.js";
import type { Glyph } from "./extract.js";
import { colorName, textOf } from "./style.js";

const S = RULES.symbols, I = RULES.import, K = RULES.render.chord;

export interface ParsedGroup {
  items: ChordLineItem[];
  x0: number;
  x1: number;
  /** Where the group's beat sits in the source, if it has one. */
  point: number | undefined;
  /** Left and right edge of the first chord's core letters (root, flat/sharp, minor "m"). */
  core?: [number, number];
  hasChord: boolean;
  alignRight?: boolean;
}

interface Tok { item: ChordLineItem; x0: number; x1: number; point?: number; core?: [number, number] }

const mid = (g: Glyph) => (g.x0 + g.x1) / 2;
const minorRe = new RegExp(S.minorPattern);

/** Circled ref number from a glyph (Unicode ❶-❿ or Wingdings), or 0. */
function refNumber(g: Glyph): number {
  const u = S.refGlyphs.indexOf(g.ch);
  if (u >= 0) return u + 1;
  const cp = g.ch.codePointAt(0)!;
  if (/Wingdings/i.test(g.font) && cp >= I.wingdingsRefStart && cp < I.wingdingsRefStart + 10) return cp - I.wingdingsRefStart + 1;
  return 0;
}

export function parseChordRow(glyphsIn: Glyph[], baseline: number, mainSize: number, contentRight: number, flag: (msg: string) => void): ParsedGroup[] {
  const gs = glyphsIn.filter((g) => g.ch !== " ").sort((a, b) => a.x0 - b.x0 || b.y - a.y);
  const raised = (g: Glyph) => baseline - g.y >= I.superscriptRaise;
  const big = (g: Glyph) => g.size >= mainSize * 0.8;
  const toks: Tok[] = [];
  let pendingBeats: { text: string; x0: number; x1: number } | undefined;
  let i = 0;

  /** Reads a raised "[...]" beat tag starting at i; returns its text and advances. */
  const readBeatTag = (): { text: string; x0: number; x1: number } | undefined => {
    const g = gs[i];
    if (!g || g.ch !== "[" || !raised(g)) return undefined;
    let j = i + 1, text = "";
    while (j < gs.length && gs[j]!.ch !== "]") { text += gs[j]!.ch; j++; }
    const end = gs[j] ?? gs[j - 1]!;
    const tag = { text: text.replace(/\s+/g, ""), x0: g.x0, x1: end.x1 };
    i = j + 1;
    return tag;
  };

  while (i < gs.length) {
    const g = gs[i]!;
    const color = colorName(g.color);
    const next = gs[i + 1];

    // Beat tag: attach to the chord or stop just before, else hold for a following stop.
    if (g.ch === "[" && raised(g)) {
      const tag = readBeatTag()!;
      const last = toks[toks.length - 1];
      if (last && tag.x0 - last.x1 < 4 && (last.item.t === "chord" || last.item.t === "stop" || last.item.t === "instrument" || last.item.t === "bass") && !last.item.beats) {
        last.item.beats = tag.text; last.x1 = tag.x1;
      } else pendingBeats = tag;
      continue;
    }

    // Stop: "//" in red or green.
    if (g.ch === "/" && next?.ch === "/" && next.x0 - g.x1 < 3 && (color === "red" || color === "green")) {
      const kind = color === "green" ? "hold" : "abrupt";
      const stop: Extract<ChordLineItem, { t: "stop" }> = { t: "stop", kind };
      const tok: Tok = { item: stop, x0: g.x0, x1: next.x1, point: (g.x0 + next.x1) / 2 };
      if (pendingBeats && g.x0 - pendingBeats.x1 < 4) { stop.beats = pendingBeats.text; stop.beatsFirst = true; tok.x0 = pendingBeats.x0; pendingBeats = undefined; }
      i += 2;
      const tag = readBeatTag();
      if (tag && !stop.beats) { stop.beats = tag.text; tok.x1 = tag.x1; }
      toks.push(tok);
      continue;
    }
    if (pendingBeats) { flag(`beat tag [${pendingBeats.text}] is not attached to a chord or stop; dropped`); pendingBeats = undefined; }

    if (g.ch === S.bar && big(g)) { toks.push({ item: { t: "bar" }, x0: g.x0, x1: g.x1 }); i++; continue; }
    if (S.sameBar.includes(g.ch) && big(g) && !raised(g) && (color === "black" || color === "gray")) {
      toks.push({ item: { t: "same" }, x0: g.x0, x1: g.x1, point: mid(g) }); i++; continue;
    }

    // Chord: root letter, optional flat/sharp, raised quality, beat tag, slash bass.
    const parenOpen = g.ch === "(" && big(g) && next && S.chordRoots.includes(next.ch) && next.x0 - g.x1 < 3;
    const rootAt = parenOpen ? i + 1 : i;
    const root = gs[rootAt];
    if (root && S.chordRoots.includes(root.ch) && big(root) && !raised(root) && (colorName(root.color) === "black" || colorName(root.color) === "gray")) {
      const chord: ChordName = { root: root.ch };
      const core: number[] = [mid(root)];
      let coreEnd = root.x1;
      let j = rootAt + 1;
      const acc = gs[j];
      if (acc && !raised(acc) && acc.x0 - root.x1 < 2 && (S.flat.includes(acc.ch) || S.sharp.includes(acc.ch)) && (acc.size < root.size || S.sharp.includes(acc.ch))) {
        chord.accidental = S.flat.includes(acc.ch) ? "b" : "#"; core.push(mid(acc)); coreEnd = acc.x1; j++;
      }
      let quality = "", ext: [number, number] | undefined;
      while (j < gs.length && raised(gs[j]!) && gs[j]!.ch !== "[" && gs[j]!.x0 - (gs[j - 1]!.x1) < 3) {
        const q = gs[j]!;
        if (quality === "" && q.ch === "m" && minorRe.test("m" + (gs[j + 1]?.ch ?? ""))) { core.push(mid(q)); coreEnd = q.x1; }
        else ext = ext ? [ext[0], q.x1] : [q.x0, q.x1];
        quality += q.ch; j++;
      }
      if (quality) chord.quality = quality;
      const item: Extract<ChordLineItem, { t: "chord" }> = { t: "chord", chord };
      let x1 = gs[j - 1]!.x1;
      i = j;
      const tag1 = readBeatTag();
      if (tag1) { item.beats = tag1.text; x1 = tag1.x1; j = i; }
      // Slash bass: a plain "/" (not a colored stop) then a root letter.
      let bass: [number, number] | undefined;
      const sl = gs[j], br = gs[j + 1];
      if (sl && br && sl.ch === "/" && !raised(sl) && colorName(sl.color) !== "red" && colorName(sl.color) !== "green" && sl.x0 - x1 < I.bassSlashGap && br.x0 - sl.x1 < 3 && S.chordRoots.includes(br.ch)) {
        let b = br.ch; let k = j + 2;
        const ba = gs[k];
        if (ba && ba.x0 - br.x1 < 2 && (S.flat.includes(ba.ch) || S.sharp.includes(ba.ch))) { b += S.flat.includes(ba.ch) ? "b" : "#"; k++; }
        chord.bass = b; bass = [sl.x0, gs[k - 1]!.x1]; x1 = bass[1]; i = k;
        const tag2 = readBeatTag();
        if (tag2 && !item.beats) { item.beats = tag2.text; x1 = tag2.x1; }
      }
      if (parenOpen) {
        item.paren = true;
        const close = gs[i];
        if (close?.ch === ")" && big(close)) { x1 = close.x1; i++; }
      }
      if (colorName(root.color) === "gray") item.noBass = true;
      let sum = core.reduce((a, b) => a + b, 0), total = core.length;
      if (ext) { sum += K.extensionWeight * (ext[0] + ext[1]) / 2; total += K.extensionWeight; }
      if (bass) { sum += K.bassWeight * (bass[0] + bass[1]) / 2; total += K.bassWeight; }
      toks.push({ item, x0: parenOpen ? g.x0 : root.x0, x1, point: sum / total, core: [root.x0, coreEnd] });
      continue;
    }

    // A bass change with no chord ("/E[4&]"): same chord, new bass (owner, 2026-11-09).
    if (g.ch === "/" && color === "black" && next && S.chordRoots.includes(next.ch) && next.x0 - g.x1 < 3) {
      let j = i + 2;
      let bass = next.ch;
      const acc = gs[j];
      if (acc && (S.flat.includes(acc.ch) || S.sharp.includes(acc.ch)) && acc.x0 - next.x1 < 2) { bass += S.flat.includes(acc.ch) ? "b" : "#"; j++; }
      const item: Extract<ChordLineItem, { t: "bass" }> = { t: "bass", bass };
      const x1 = gs[j - 1]!.x1;
      const tok: Tok = { item, x0: g.x0, x1, point: (g.x0 + x1) / 2 };
      i = j;
      const tag = readBeatTag();
      if (tag) { item.beats = tag.text; tok.x1 = tag.x1; }
      toks.push(tok);
      continue;
    }

    // Circled riff number.
    const ref = refNumber(g);
    if (ref) { toks.push({ item: { t: "ref", n: ref, riff: color === "lightBlue" ? 2 : 1 }, x0: g.x0, x1: g.x1 }); i++; continue; }

    // Parenthesized mark: (+Bss), (⊕RGtr), (simile), (NC), (2x), (+Bnd, dstrn).
    if (g.ch === "(") {
      let j = i + 1;
      while (j < gs.length && gs[j]!.ch !== ")") j++;
      const inner = gs.slice(i + 1, j);
      const end = gs[j] ?? gs[j - 1] ?? g;
      i = j + 1;
      const whole = textOf(inner).trim();
      if (!whole) { flag("empty parentheses; dropped"); continue; }
      const parts = whole.split(/\s*,\s*/).filter(Boolean);
      const startCount = toks.length;
      let op: "add" | "remove" | "only" | "except" | undefined;
      let unknown = false;
      for (const part of parts) {
        const sign = part.charAt(0) as keyof typeof S.instrumentOps;
        const rest = part.slice(1).trim();
        if (S.instrumentOps[sign] && rest) {
          op = S.instrumentOps[sign] as typeof op;
          const names = rest.split(S.instrumentJoin).map((n) => n.trim()).filter(Boolean);
          for (const n of names) {
            if (!S.instruments.includes(n)) flag(`instrument "${n}" is not in the rules' instrument list`);
            toks.push({ item: { t: "instrument", op: op!, text: n }, x0: g.x0, x1: end.x1 });
          }
        } else if ((S.directions as string[]).includes(part)) {
          toks.push({ item: { t: "direction", text: part as Extract<ChordLineItem, { t: "direction" }>["text"] }, x0: g.x0, x1: end.x1 });
        } else if (new RegExp(S.times).test(part)) {
          toks.push({ item: { t: "times", text: part }, x0: g.x0, x1: end.x1 });
        } else if (op && S.instruments.includes(part)) {
          toks.push({ item: { t: "instrument", op, text: part }, x0: g.x0, x1: end.x1 });
        } else unknown = true;
      }
      // Anything else is a free-text instruction (owner, 2026-11-09), kept whole.
      if (unknown) {
        toks.length = startCount;
        toks.push({ item: { t: "text", text: whole }, x0: g.x0, x1: end.x1 });
        flag(`read "(${whole})" as a free-text instruction; check`);
      }
      continue;
    }

    // Repeat endings: "{" + red "1." ... "}".
    if (g.ch === S.endingOpen) {
      let j = i + 1, n = "";
      while (j < gs.length && /[0-9.]/.test(gs[j]!.ch) && colorName(gs[j]!.color) === "red") { n += gs[j]!.ch; j++; }
      toks.push({ item: { t: "endingOpen", n: n.replace(/\.$/, "") || "1" }, x0: g.x0, x1: gs[j - 1]!.x1 });
      i = j; continue;
    }
    if (g.ch === S.endingClose) { toks.push({ item: { t: "endingClose" }, x0: g.x0, x1: g.x1 }); i++; continue; }
    if (g.ch === S.arrowDown) { toks.push({ item: { t: "arrowDown" }, x0: g.x0, x1: g.x1 }); i++; continue; }

    // Stacked meter: two red digits at the same x.
    if (/\d/.test(g.ch) && color === "red" && next && /\d/.test(next.ch) && Math.abs(next.x0 - g.x0) < 2 && Math.abs(next.y - g.y) > 3) {
      const [top, bottom] = g.y < next.y ? [g, next] : [next, g];
      toks.push({ item: { t: "meter", top: Number(top.ch), bottom: Number(bottom.ch) }, x0: g.x0, x1: Math.max(g.x1, next.x1) });
      i += 2; continue;
    }

    // Red words: dstrn, Vamp, 1/2T.
    if (color === "red") {
      let j = i; const run: Glyph[] = [];
      while (j < gs.length && colorName(gs[j]!.color) === "red" && (run.length === 0 || gs[j]!.x0 - run[run.length - 1]!.x1 < gs[j]!.size * 0.4)) run.push(gs[j++]!);
      const word = run.map((r) => r.ch).join("");
      i = j;
      if ((S.directions as string[]).includes(word)) toks.push({ item: { t: "direction", text: word as Extract<ChordLineItem, { t: "direction" }>["text"] }, x0: run[0]!.x0, x1: run[run.length - 1]!.x1 });
      else {
        toks.push({ item: { t: "text", text: textOf(run), paren: false }, x0: run[0]!.x0, x1: run[run.length - 1]!.x1 });
        flag(`read red text "${textOf(run)}" as a free-text instruction; check`);
      }
      continue;
    }

    flag(`unrecognized "${g.ch}" (${g.font} ${g.size.toFixed(1)} pt ${g.color}) at x ${g.x0.toFixed(0)}; dropped`);
    i++;
  }

  // Groups: a bar or a chord starts one (a chord right after a bar joins it);
  // other marks join the group before unless far from it.
  const groups: ParsedGroup[] = [];
  for (const t of toks) {
    const cur = groups[groups.length - 1];
    const onlyLead = cur && cur.items.every((it) => it.t === "bar" || it.t === "meter");
    const startsNew =
      !cur ||
      (t.item.t === "bar" && !cur.items.every((it) => it.t === "meter")) ||
      (t.item.t === "chord" && !onlyLead) ||
      (t.item.t === "same" && !onlyLead) ||
      t.x0 - cur.x1 > I.groupGap;
    if (startsNew) groups.push({ items: [t.item], x0: t.x0, x1: t.x1, point: t.point, hasChord: t.item.t === "chord", ...(t.core ? { core: t.core } : {}) });
    else {
      cur.items.push(t.item);
      cur.x1 = Math.max(cur.x1, t.x1);
      if (cur.point === undefined && t.point !== undefined) cur.point = t.point;
      if (!cur.core && t.core) cur.core = t.core;
      if (t.item.t === "chord") cur.hasChord = true;
    }
  }
  const last = groups[groups.length - 1];
  if (last && !last.hasChord && last.x1 > contentRight - 15 && last.items.every((it) => it.t === "direction" || it.t === "times")) last.alignRight = true;
  return groups;
}
