import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { compareSample, PIXEL_THRESHOLD, PX_PER_R, toPng, type Comparison } from "./visual.js";

/**
 * Tolerance: at most 4% of pixels inked in either image may differ.
 * Measured: Fm 3.24%, Eb 2.62%, Ab 2.58%, Bb 0.47%; the residue is the
 * hand-placed dots and padded "x" text that the importer snaps to the grid.
 * One missing dot adds ~5.5%, so a real regression fails. See NOTES.md.
 */
const MAX_INK_RATIO = 0.04;

const results: Comparison[] = [];

describe(`visual comparison (resvg, ${PX_PER_R} px per R, pixelmatch threshold ${PIXEL_THRESHOLD})`, () => {
  it.each(["Fm", "Eb", "Bb", "Ab"])("%s matches its Corel original", (name) => {
    const c = compareSample(name);
    results.push(c);
    mkdirSync("test/output", { recursive: true });
    writeFileSync(`test/output/${name}-original.png`, toPng(c.original));
    writeFileSync(`test/output/${name}-rendered.png`, toPng(c.rendered));
    writeFileSync(`test/output/${name}-diff.png`, toPng(c.diff));
    expect(c.inkRatio).toBeLessThanOrEqual(MAX_INK_RATIO);
  });

  afterAll(() => {
    const rows = results.map(
      (c) => `${c.name}: ${c.mismatched} px differ = ${(c.inkRatio * 100).toFixed(2)}% of ink, ${(c.windowRatio * 100).toFixed(2)}% of window`,
    );
    console.log(rows.join("\n"));
  });
});
