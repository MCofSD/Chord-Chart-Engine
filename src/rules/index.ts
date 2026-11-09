/**
 * The formatting rules (rules/chart-rules.json): one file read by both the
 * renderer and the PDF importer, so a rule change needs no code change in
 * either. Keys starting with "_" in the file are notes.
 */
import rules from "../../rules/chart-rules.json" with { type: "json" };
import type { SectionType } from "../model/chart.js";

export const RULES = rules;
export type Rules = typeof rules;

const sectionPatterns = rules.sections.types.map((t) => ({ re: new RegExp(t.match, "i"), type: t.type as SectionType }));

/** Section type for a label such as "1st Ver", "Ref 1" or "End Cho" (rules.sections.types). */
export function sectionTypeOf(label: string): SectionType {
  for (const p of sectionPatterns) if (p.re.test(label.trim())) return p.type;
  return "other";
}
