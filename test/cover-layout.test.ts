import { describe, expect, it } from "vitest";
import { DIAGRAM_HEIGHT, DIAGRAM_WIDTH, solveCover, type CoverItem, type CoverLayout } from "../src/cover/layout.js";
import { RULES } from "../src/rules/index.js";

const C = RULES.cover;
const n = (count: number, extra: (i: number) => CoverItem = () => ({})) => Array.from({ length: count }, (_, i) => extra(i));
const solve = (count: number, tuning = true) => solveCover(n(count), { tuning });

/** Every diagram inside its page's chords panel, none overlapping. */
function checkPlacement(l: CoverLayout) {
  for (const d of l.diagrams) {
    const p = l.pages[d.page]!.chords!;
    expect(d.x).toBeGreaterThanOrEqual(p.x0);
    expect(d.x + l.width).toBeLessThanOrEqual(p.x1 + 1e-6);
    expect(d.y).toBeGreaterThanOrEqual(p.bodyTop);
    expect(d.y + l.height).toBeLessThanOrEqual(p.bottom + 1e-6);
  }
  for (const a of l.diagrams) for (const b of l.diagrams) {
    if (a === b || a.page !== b.page) continue;
    const apart = a.x + l.width <= b.x + 1e-6 || b.x + l.width <= a.x + 1e-6 || a.y + l.height <= b.y + 1e-6 || b.y + l.height <= a.y + 1e-6;
    expect(apart).toBe(true);
  }
}

describe("cover layout solver", () => {
  it("matches the templates' capacities: 6x7 = 42 at 60%, 8x7 = 56 at 65%, page 2 4x5 = 20", () => {
    expect([solve(42).columns, solve(42).scale, solve(42).pages.length]).toEqual([6, 0.6, 1]);
    expect([solve(56).columns, solve(56).scale]).toEqual([8, 0.65]);
    const over = solve(76);
    expect(over.diagrams.filter((d) => d.page === 0)).toHaveLength(56);
    expect(over.diagrams.filter((d) => d.page === 1)).toHaveLength(20);
    expect(over.dropped).toEqual([]);
    expect(over.pages[1]!.chords!.title).toMatch(/con.t/);
  });

  it("uses 5 columns by default and never fewer than 4", () => {
    expect(solve(10).columns).toBe(5);
    expect(solve(20).columns).toBe(5);
    for (let i = 1; i <= 80; i++) expect(solve(i).columns).toBeGreaterThanOrEqual(C.columns.min);
  });

  it("uses 4 columns when that fills the last row more evenly, at full size", () => {
    for (const count of [4, 8, 12, 16]) expect(solve(count).columns).toBe(4);
    expect(solve(9).columns).toBe(5); // 5 + 4 beats 4 + 4 + 1
    expect(solve(24).columns).toBe(5); // 4 columns would have to shrink
  });

  it("takes the fewest columns that fit, then the largest scale", () => {
    expect(solve(30).columns).toBe(5);
    expect(solve(35)).toMatchObject({ columns: 5, scale: 0.6 });
    expect(solve(36).columns).toBe(6);
    expect(solve(43).columns).toBe(7);
    expect(solve(50).columns).toBe(8);
    expect(solve(20).scale).toBeGreaterThan(solve(35).scale);
  });

  it("keeps the Legend beside up to 6 columns, and moves it to page 2 from 7", () => {
    expect(solve(42).pages.map((p) => [p.kind, !!p.legend])).toEqual([["first", true]]);
    expect(solve(43).pages.map((p) => [p.kind, !!p.legend])).toEqual([["first", false], ["legendOnly", true]]);
    const over = solve(60);
    expect(over.pages.map((p) => p.kind)).toEqual(["first", "continued"]);
    expect(over.pages[0]!.continuedBaseline).toBeDefined();
    expect(over.pages[1]!.legend).toBeDefined();
  });

  it("reports diagrams beyond both pages", () => {
    const l = solve(80);
    expect(l.dropped).toHaveLength(4);
    expect(l.warnings.join()).toMatch(/open question/);
  });

  it("places every diagram inside its panel without overlaps", () => {
    for (const count of [1, 5, 9, 17, 31, 42, 49, 56, 70]) checkPlacement(solve(count));
  });

  it("spreads columns evenly across the panel", () => {
    const l = solve(10);
    const xs = [...new Set(l.diagrams.map((d) => d.x))].sort((a, b) => a - b);
    const steps = xs.slice(1).map((x, i) => x - xs[i]!);
    for (const s of steps) expect(s).toBeCloseTo(steps[0]!, 6);
    const p = l.pages[0]!.chords!;
    expect(xs[0]! - p.x0).toBeCloseTo(p.x1 - (xs[xs.length - 1]! + l.width), 6);
  });

  it("sizes diagrams from the 100% box", () => {
    const l = solve(10);
    expect(l.width).toBeCloseTo(DIAGRAM_WIDTH * l.scale, 6);
    expect(l.height).toBeCloseTo(DIAGRAM_HEIGHT * l.scale, 6);
    expect(DIAGRAM_WIDTH / 72).toBeCloseTo(1.39, 2); // CLAUDE.md §4.3
  });

  it("makes a row with a note taller", () => {
    const plain = solveCover(n(10), { tuning: true });
    const noted = solveCover(n(10, (i) => (i === 0 ? { note: true } : {})), { tuning: true });
    expect(noted.scale).toBe(plain.scale);
    const row2 = (l: CoverLayout) => l.diagrams[5]!.y - l.diagrams[0]!.y;
    expect(row2(noted)).toBeGreaterThan(row2(plain));
  });

  it("starts the alternate group on a new row under its label", () => {
    const l = solveCover(n(7, (i) => (i >= 5 ? { alternate: true } : {})), { tuning: true });
    const first = l.diagrams.find((d) => d.index === 5)!;
    const before = l.diagrams.find((d) => d.index === 4)!;
    expect(first.y).toBeGreaterThan(before.y);
    expect(first.x).toBeCloseTo(l.diagrams[0]!.x, 6);
    expect(l.pages[0]!.alternateY).toBeGreaterThan(before.y);
    expect(l.pages[0]!.alternateY).toBeLessThan(first.y);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(solve(33))).toBe(JSON.stringify(solve(33)));
  });
});
