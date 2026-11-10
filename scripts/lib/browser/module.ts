/**
 * Browser stand-in for node:module, used only by the editor bundle. The
 * syllable splitter loads hyphenation patterns with require("hyphen/<lang>");
 * here the patterns are bundled. German (de-1996, 730 KB) is left out to keep
 * the page small: for it, require returns null and the sung-syllable rule in
 * src/text/syllables.ts does the splitting alone, as for Tagalog.
 */
import enUs from "hyphen/en-us";
import es from "hyphen/es";
import fr from "hyphen/fr";
import it from "hyphen/it";
import pt from "hyphen/pt";

const MODULES: Record<string, unknown> = { "hyphen/en-us": enUs, "hyphen/es": es, "hyphen/fr": fr, "hyphen/it": it, "hyphen/pt": pt };

export function createRequire(_url: string | URL): (id: string) => unknown {
  return (id) => MODULES[id] ?? null;
}

export default { createRequire };
