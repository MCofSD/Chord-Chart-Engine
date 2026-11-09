/**
 * Chart style tokens, in points: a typed view of the "render" rules in
 * rules/chart-rules.json (measurements and notes live there). Edit the JSON,
 * not this file.
 */
import { RULES } from "../rules/index.js";

export const CHART = {
  ...RULES.render,
  colors: { ...RULES.render.colors, ...RULES.legend.colors },
};
