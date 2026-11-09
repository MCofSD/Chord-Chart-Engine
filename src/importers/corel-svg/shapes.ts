import { XMLParser } from "fast-xml-parser";

/** Resolved presentation style of one shape (class rules + inline attributes). */
export interface Style {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fontSize?: number;
  fontWeight?: string;
  fontStyle?: string;
  baselineShift?: string;
}

export type Shape =
  | { tag: "line"; x1: number; y1: number; x2: number; y2: number; style: Style }
  | { tag: "rect"; x: number; y: number; width: number; height: number; style: Style }
  | { tag: "circle"; cx: number; cy: number; r: number; style: Style }
  | { tag: "text"; x: number; y: number; text: string; style: Style };

type Node = Record<string, unknown>;

const STYLE_KEYS: Record<string, keyof Style> = {
  fill: "fill",
  stroke: "stroke",
  "stroke-width": "strokeWidth",
  "font-size": "fontSize",
  "font-weight": "fontWeight",
  "font-style": "fontStyle",
  "baseline-shift": "baselineShift",
};

function applyDecl(style: Style, prop: string, raw: string): void {
  const key = STYLE_KEYS[prop.trim()];
  if (!key) return;
  const value = raw.trim();
  if (key === "strokeWidth" || key === "fontSize") style[key] = parseFloat(value);
  else style[key] = value.toUpperCase().startsWith("#") ? value.toUpperCase() : value;
}

function parseDecls(style: Style, decls: string): void {
  for (const decl of decls.split(";")) {
    const i = decl.indexOf(":");
    if (i > 0) applyDecl(style, decl.slice(0, i), decl.slice(i + 1));
  }
}

/** Parses `.cls {a:b; c:d}` rules from Corel's embedded stylesheet. */
function parseClassRules(css: string): Map<string, Style> {
  const rules = new Map<string, Style>();
  for (const m of css.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
    const style: Style = {};
    parseDecls(style, m[2] ?? "");
    rules.set(m[1] ?? "", style);
  }
  return rules;
}

const num = (v: unknown): number => parseFloat(String(v ?? "0"));

/** Flattens all line/rect/circle/text shapes in document order with resolved styles. */
export function extractShapes(svgText: string): { shapes: Shape[]; viewBox: number[] } {
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "",
    trimValues: false,
    cdataPropName: "#cdata",
    processEntities: true,
  });
  const doc = parser.parse(svgText) as Node[];

  // First pass: collect stylesheet text.
  let css = "";
  const collectCss = (nodes: Node[]) => {
    for (const n of nodes) {
      const tag = Object.keys(n).find((k) => k !== ":@");
      if (!tag) continue;
      const kids = n[tag];
      if (tag === "style" && Array.isArray(kids)) {
        for (const k of kids as Node[]) css += String(k["#cdata"] ? (k["#cdata"] as Node[]).map((c) => c["#text"]).join("") : k["#text"] ?? "");
      } else if (Array.isArray(kids)) collectCss(kids as Node[]);
    }
  };
  collectCss(doc);
  const classes = parseClassRules(css);

  const shapes: Shape[] = [];
  let viewBox: number[] = [];

  const walk = (nodes: Node[], inherited: Style) => {
    for (const n of nodes) {
      const tag = Object.keys(n).find((k) => k !== ":@");
      if (!tag || tag === "defs" || tag === "style" || tag === "metadata") continue;
      const attrs = (n[":@"] ?? {}) as Record<string, string>;
      const style: Style = { ...inherited };
      for (const cls of (attrs.class ?? "").split(/\s+/)) Object.assign(style, classes.get(cls) ?? {});
      for (const [k, v] of Object.entries(attrs)) if (k in STYLE_KEYS) applyDecl(style, k, v);
      if (attrs.style) parseDecls(style, attrs.style);
      const kids = (Array.isArray(n[tag]) ? n[tag] : []) as Node[];

      switch (tag) {
        case "svg":
          viewBox = (attrs.viewBox ?? "").trim().split(/[\s,]+/).map(Number);
          walk(kids, style);
          break;
        case "g":
          walk(kids, style);
          break;
        case "line":
          shapes.push({ tag, x1: num(attrs.x1), y1: num(attrs.y1), x2: num(attrs.x2), y2: num(attrs.y2), style });
          break;
        case "rect":
          shapes.push({ tag, x: num(attrs.x), y: num(attrs.y), width: num(attrs.width), height: num(attrs.height), style });
          break;
        case "circle":
          shapes.push({ tag, cx: num(attrs.cx), cy: num(attrs.cy), r: num(attrs.r), style });
          break;
        case "text": {
          const text = kids.map((k) => String(k["#text"] ?? "")).join("");
          shapes.push({ tag, x: num(attrs.x), y: num(attrs.y), text, style });
          break;
        }
        default:
          walk(kids, style);
      }
    }
  };
  walk(doc, {});
  return { shapes, viewBox };
}

const isPaint = (p: string | undefined) => p !== undefined && p !== "none" && p !== "transparent";

/** SVG default fill is black when unspecified. */
export function hasFill(s: Shape): boolean {
  return s.tag !== "line" && (s.style.fill === undefined || isPaint(s.style.fill));
}

export function hasStroke(s: Shape): boolean {
  return isPaint(s.style.stroke) && (s.style.strokeWidth ?? 1) > 0;
}

export function isVisible(s: Shape): boolean {
  return hasFill(s) || hasStroke(s);
}
