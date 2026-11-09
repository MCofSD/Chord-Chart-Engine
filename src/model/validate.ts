import { Ajv } from "ajv";
import schema from "./voicing.schema.json" with { type: "json" };
import { FRET_ROWS, rowOfFret, type Voicing } from "./voicing.js";

const ajv = new Ajv({ allErrors: true });
const checkSchema = ajv.compile(schema);

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** Schema check plus rules the schema can't express (frets inside the 4-row window, etc.). */
export function validateVoicing(input: unknown): ValidationResult {
  if (!checkSchema(input)) {
    const errors = (checkSchema.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`);
    return { ok: false, errors };
  }
  const v = input as unknown as Voicing;
  const errors: string[] = [];

  // No printed fret number means the top row is fret 1, so a higher window must print one.
  if (v.fretLabelRow === undefined && v.windowStartFret !== 1) {
    errors.push(`/fretLabelRow is required when windowStartFret is ${v.windowStartFret} (no fret number means fret 1)`);
  }

  v.strings.forEach((s, i) => {
    if ((s.kind === "fretted" || s.kind === "muted") && rowOfFret(v, s.fret) === undefined) {
      errors.push(`/strings/${i} fret ${s.fret} is outside frets ${v.windowStartFret}-${v.windowStartFret + FRET_ROWS - 1}`);
    }
  });

  (v.barres ?? []).forEach((b, i) => {
    if (rowOfFret(v, b.fret) === undefined) errors.push(`/barres/${i} fret ${b.fret} is outside the window`);
    if (b.from >= b.to) errors.push(`/barres/${i} from must be less than to`);
    for (const [a, z] of b.sounding) {
      if (a >= z || a < b.from || z > b.to) errors.push(`/barres/${i} sounding range [${a},${z}] must lie inside [${b.from},${b.to}]`);
    }
  });

  return { ok: errors.length === 0, errors };
}
