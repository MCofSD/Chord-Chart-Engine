// Files embedded by esbuild's binary loader in the editor bundle (scripts/build-editor.ts).
declare module "*.png" {
  const bytes: Uint8Array;
  export default bytes;
}
declare module "*.otf" {
  const bytes: Uint8Array;
  export default bytes;
}
// Hyphenation pattern modules, bundled by scripts/lib/browser/module.ts.
declare module "hyphen/*" {
  const hyphenator: unknown;
  export default hyphenator;
}
