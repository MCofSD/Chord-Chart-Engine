/**
 * Browser stand-in for node:fs, used only by the editor bundle
 * (scripts/build-editor.ts). The renderer reads two assets from disk: the
 * cover logo and the Bravura music font. Here they are embedded at build time
 * and served by file name, so the renderer's code is the same in Node and in
 * the browser.
 */
import logo from "../../../assets/cover/mc-logo.png";
import bravura from "../../../assets/fonts/Bravura.otf";

/** A Uint8Array that also does Buffer's toString("base64"), the one Buffer feature the renderer uses. */
class Bytes extends Uint8Array {
  override toString(encoding?: string): string {
    if (encoding !== "base64") return new TextDecoder().decode(this);
    let s = "";
    for (let i = 0; i < this.length; i += 0x8000) s += String.fromCharCode(...this.subarray(i, i + 0x8000));
    return btoa(s);
  }
}

const FILES: Record<string, Uint8Array> = { "mc-logo.png": logo, "Bravura.otf": bravura };

export function readFileSync(path: string | URL): Bytes {
  const name = String(path).split("/").pop()!;
  const data = FILES[name];
  if (!data) throw new Error(`${name} is not available in the browser`);
  const out = new Bytes(data.length);
  out.set(data);
  return out;
}

export default { readFileSync };
