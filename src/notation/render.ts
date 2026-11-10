/**
 * Native notation (owner, 2026-11-09): MusicXML drawn by alphaTab as SVG,
 * with the music symbols turned into outlines (Bravura via opentype.js) so the
 * result looks the same in every viewer, rasterizer and PDF, like the rest of
 * the chart. Also returns where each beat sits, so chord names and the lyric
 * line below can be placed on the real beat positions.
 *
 * Deterministic and synchronous; reads only the bundled font.
 */
import { readFileSync } from "node:fs";
import * as alphaTab from "@coderline/alphatab";
import opentype from "opentype.js";
import { RULES } from "../rules/index.js";
import type { NotationRender } from "./axis.js";

export type { NotationRender } from "./axis.js";
export { notationAxis } from "./axis.js";

export type Staves = "tab" | "standard" | "both";

export interface NotationOptions {
  staves: Staves;
  /** Width to lay the notation out in, pt. */
  width: number;
  /** First and last measure to show (1-based, inclusive). Default: all. */
  bars?: [number, number];
}

const N = RULES.notation;
let bravura: opentype.Font | undefined;
const font = () => (bravura ??= opentype.parse(readFileSync(new URL("../../assets/fonts/Bravura.otf", import.meta.url)).buffer as ArrayBuffer));

const fmt = (v: number) => String(Math.round(v * 100) / 100);
const TICKS_PER_QUARTER = 960;

/** Replaces alphaTab's music-font text (class "at") with outlines. */
function outlineMusicSymbols(svg: string, baseSize: number, warnings: string[]): string {
  const f = font();
  const out = svg.replace(
    /<g transform="translate\(([-\d.e]+) ([-\d.e]+)\)" class="at" ><text([^>]*)>([^<]*)<\/text><\/g>/g,
    (_m, xs: string, ys: string, attrs: string, entities: string) => {
      const text = entities.replace(/&#(\d+);/g, (_e, cp: string) => String.fromCodePoint(Number(cp)));
      const pct = /font-size: ([\d.e]+)%/.exec(attrs)?.[1];
      const fill = /fill="([^"]*)"/.exec(attrs)?.[1];
      const size = baseSize * (pct ? Number(pct) / 100 : 1);
      let x = Number(xs);
      if (/text-anchor="middle"/.test(attrs)) x -= f.getAdvanceWidth(text, size) / 2;
      const d = f.getPath(text, x, Number(ys), size).toPathData(2);
      return d ? `<path d="${d}"${fill ? ` fill="${fill}"` : ""}/>` : "";
    },
  );
  if (/class="at"/.test(out)) warnings.push("some music symbols could not be outlined; they need the Bravura font to display");
  return out;
}

export function renderNotation(musicXml: Uint8Array, opts: NotationOptions): NotationRender {
  const warnings: string[] = [];
  const settings = new alphaTab.Settings();
  settings.core.engine = "svg";
  settings.core.useWorkers = false;
  settings.core.enableLazyLoading = false;
  settings.display.scale = N.scale;
  settings.display.padding = [0, 0, 0, 0];
  settings.display.firstSystemPaddingTop = 0;
  settings.display.lastSystemPaddingBottom = 0;
  settings.display.layoutMode = alphaTab.LayoutMode.Page;
  settings.display.justifyLastSystem = true; // fill the content width, like the chord and lyric rows
  // Titles, tuning, track names, chord names and bar numbers come from the chart, not the score.
  const E = alphaTab.NotationElement;
  for (const el of [E.ScoreTitle, E.ScoreSubTitle, E.ScoreArtist, E.ScoreAlbum, E.ScoreWords, E.ScoreMusic, E.ScoreWordsAndMusic,
    E.ScoreCopyright, E.GuitarTuning, E.TrackNames, E.ChordDiagrams, E.EffectChordNames, E.BarNumber]) settings.notation.elements.set(el, false);

  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(musicXml, settings);
  const total = score.masterBars.length;
  const [from, to] = opts.bars ?? [1, total];
  if (from < 1 || to > total || from > to) throw new Error(`bars ${from}-${to} outside the score's 1-${total}`);
  settings.display.startBar = from;
  settings.display.barCount = to - from + 1;
  settings.display.barsPerRow = to - from + 1; // one row, like today's snippets

  for (const track of score.tracks) for (const staff of track.staves) {
    const stringed = staff.tuning.length > 0;
    if (opts.staves !== "standard" && !stringed) warnings.push(`staff in "${track.name}" has no string tuning, so it cannot show tab`);
    staff.showTablature = opts.staves !== "standard" && stringed;
    staff.showStandardNotation = opts.staves !== "tab" || !stringed;
  }

  const renderer = new alphaTab.rendering.ScoreRenderer(settings);
  renderer.width = opts.width;
  const parts: string[] = [];
  let height = 0;
  renderer.partialLayoutFinished.on((r) => renderer.renderResult(r.id));
  renderer.partialRenderFinished.on((r) => {
    const s = String(r.renderResult);
    if (/rendered by alphaTab/.test(s)) return; // credited in the README instead
    const inner = s.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    parts.push(`<g transform="translate(${fmt(r.x)} ${fmt(r.y)})">${inner}</g>`);
    height = Math.max(height, r.y + r.height);
  });
  let error: unknown;
  renderer.error.on((e) => { error = e; });
  renderer.renderScore(score, [0]);
  if (error) throw error instanceof Error ? error : new Error(String(error));

  const baseSize = settings.display.resources.engravingSettings.musicFontSize;
  const svg = outlineMusicSymbols(parts.join(""), baseSize, warnings);

  // Beat positions from the first staff of each shown bar.
  const bars: NotationRender["bars"] = [];
  const beats: NotationRender["beats"] = [];
  for (const system of renderer.boundsLookup?.staffSystems ?? []) {
    for (const mb of system.bars) {
      const bar = mb.index - (from - 1);
      if (bar < 0 || bar > to - from) continue;
      const master = score.masterBars[mb.index]!;
      bars[bar] = { x0: mb.realBounds.x, x1: mb.realBounds.x + mb.realBounds.w, beats: (master.timeSignatureNumerator * 4) / master.timeSignatureDenominator };
      for (const bt of mb.bars[0]?.beats ?? []) beats.push({ bar, t: bt.beat.displayStart / TICKS_PER_QUARTER, x: bt.onNotesX });
    }
  }
  beats.sort((a, b) => a.bar - b.bar || a.t - b.t);
  return { svg, width: opts.width, height, bars, beats, warnings };
}
