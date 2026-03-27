// Prisma 6 Bytes fields expect Uint8Array<ArrayBuffer>.
// Buffer extends Uint8Array<ArrayBufferLike> which is wider — the cast is safe
// because Buffer.from() always allocates a regular ArrayBuffer.
export function hexToBuffer(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Buffer.from(clean, "hex") as Uint8Array<ArrayBuffer>;
}

export function bufferToHex(buf: Uint8Array): string {
  return "0x" + Buffer.from(buf).toString("hex");
}

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ETH_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export function isValidAddress(value: string): boolean {
  return ETH_ADDRESS_RE.test(value);
}

export function isValidHash(value: string): boolean {
  return ETH_HASH_RE.test(value);
}
