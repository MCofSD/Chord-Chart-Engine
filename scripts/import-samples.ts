/** Converts the four sample SVGs and prints (or writes, with --write) the voicing JSON. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { importCorelSvg } from "../src/importers/corel-svg/index.js";

const NAMES = ["Fm", "Eb", "Bb", "Ab"];
const write = process.argv.includes("--write");
for (const name of NAMES) {
  const { voicing } = importCorelSvg(readFileSync(`samples/${name}.svg`));
  const json = JSON.stringify(voicing, null, 2) + "\n";
  if (write) {
    mkdirSync("test/fixtures", { recursive: true });
    writeFileSync(`test/fixtures/${name}.json`, json);
  } else console.log(`=== ${name}\n${json}`);
}
