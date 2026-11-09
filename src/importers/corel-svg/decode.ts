/** Decode SVG bytes, sniffing the BOM. Corel exports both UTF-8 and UTF-16 (CLAUDE.md §6.4). */
export function decodeSvgBytes(bytes: Uint8Array): string {
  const b0 = bytes[0], b1 = bytes[1], b2 = bytes[2];
  if (b0 === 0xff && b1 === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (b0 === 0xfe && b1 === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  if (b0 === 0xef && b1 === 0xbb && b2 === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  // No BOM: UTF-16 without BOM would show a NUL in the first bytes.
  if (b0 === 0x3c && b1 === 0x00) return new TextDecoder("utf-16le").decode(bytes);
  if (b0 === 0x00 && b1 === 0x3c) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}
