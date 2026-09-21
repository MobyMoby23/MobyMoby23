/**
 * Byte-level primitives shared by every converter in the app.
 *
 * Everything here is pure and dependency-free so it can run inside the Hermes
 * bundle and under `node --experimental-strip-types` in tests.
 */

const HEX_DIGITS = '0123456789abcdef';
const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export type HexSeparator = 'none' | 'space' | 'colon' | 'dash';

const SEPARATORS: Record<HexSeparator, string> = {
  none: '',
  space: ' ',
  colon: ':',
  dash: '-',
};

/** Strip the punctuation people paste along with a UID: `0x`, spaces, `:`, `-`. */
export function normalizeHex(input: string): string {
  return input
    .trim()
    .replace(/^0x/i, '')
    .replace(/[\s:\-_.]/g, '')
    .toLowerCase();
}

export function isHex(input: string): boolean {
  const cleaned = normalizeHex(input);
  return cleaned.length > 0 && /^[0-9a-f]+$/.test(cleaned);
}

export function hexToBytes(input: string): Uint8Array {
  let cleaned = normalizeHex(input);
  if (cleaned.length === 0) return new Uint8Array(0);
  if (!/^[0-9a-f]+$/.test(cleaned)) {
    throw new Error('Not valid hex: expected characters 0-9 and A-F only.');
  }
  // An odd digit count means a leading nibble, e.g. `fff` -> `0fff`.
  if (cleaned.length % 2 === 1) cleaned = '0' + cleaned;

  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(cleaned.substr(i * 2, 2), 16);
  }
  return out;
}

export function bytesToHex(
  bytes: Uint8Array,
  options: {separator?: HexSeparator; uppercase?: boolean} = {},
): string {
  const {separator = 'none', uppercase = true} = options;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    parts.push(HEX_DIGITS[b >> 4] + HEX_DIGITS[b & 0x0f]);
  }
  const joined = parts.join(SEPARATORS[separator]);
  return uppercase ? joined.toUpperCase() : joined;
}

export function bytesToBinary(bytes: Uint8Array, grouped = true): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    parts.push(bytes[i].toString(2).padStart(8, '0'));
  }
  return parts.join(grouped ? ' ' : '');
}

export function binaryToBytes(input: string): Uint8Array {
  const cleaned = input.replace(/[\s_]/g, '');
  if (cleaned.length === 0) return new Uint8Array(0);
  if (!/^[01]+$/.test(cleaned)) {
    throw new Error('Not valid binary: expected only 0 and 1.');
  }
  const padded = cleaned.padStart(Math.ceil(cleaned.length / 8) * 8, '0');
  const out = new Uint8Array(padded.length / 8);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(padded.substr(i * 8, 8), 2);
  }
  return out;
}

/** Big-endian unsigned integer value of the buffer, as a decimal string. */
export function bytesToDecimal(bytes: Uint8Array): string {
  let value = 0n;
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8n) | BigInt(bytes[i]);
  }
  return value.toString(10);
}

export function decimalToBytes(input: string, minBytes = 0): Uint8Array {
  const cleaned = input.trim().replace(/[\s,_]/g, '');
  if (cleaned.length === 0) return new Uint8Array(0);
  if (!/^\d+$/.test(cleaned)) {
    throw new Error('Not a valid decimal number.');
  }
  let value = BigInt(cleaned);
  const digits: number[] = [];
  while (value > 0n) {
    digits.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  while (digits.length < Math.max(minBytes, 1)) digits.unshift(0);
  return Uint8Array.from(digits);
}

/* -------------------------------------------------------------------------- */
/* UTF-8                                                                       */
/* -------------------------------------------------------------------------- */

export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    // Combine surrogate pairs into a single code point.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = (code - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
        i++;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let code: number;
    let size: number;
    if (b < 0x80) {
      code = b;
      size = 1;
    } else if ((b & 0xe0) === 0xc0) {
      code = b & 0x1f;
      size = 2;
    } else if ((b & 0xf0) === 0xe0) {
      code = b & 0x0f;
      size = 3;
    } else if ((b & 0xf8) === 0xf0) {
      code = b & 0x07;
      size = 4;
    } else {
      out += '\uFFFD';
      i++;
      continue;
    }
    if (i + size > bytes.length) {
      out += '\uFFFD';
      break;
    }
    for (let k = 1; k < size; k++) {
      const cont = bytes[i + k];
      if ((cont & 0xc0) !== 0x80) {
        code = 0xfffd;
        break;
      }
      code = (code << 6) | (cont & 0x3f);
    }
    i += size;
    if (code > 0xffff) {
      code -= 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      out += String.fromCharCode(code);
    }
  }
  return out;
}

/** Human-readable view of a buffer: printable ASCII kept, everything else a dot. */
export function bytesToPrintableAscii(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.';
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Base64                                                                      */
/* -------------------------------------------------------------------------- */

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : B64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : B64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

export function base64ToBytes(input: string): Uint8Array {
  const cleaned = input.replace(/[\s]/g, '').replace(/=+$/, '');
  if (cleaned.length === 0) return new Uint8Array(0);
  if (!/^[A-Za-z0-9+/]+$/.test(cleaned)) {
    throw new Error('Not valid base64.');
  }
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < cleaned.length; i++) {
    buffer = (buffer << 6) | B64_ALPHABET.indexOf(cleaned[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/* -------------------------------------------------------------------------- */
/* Byte order                                                                  */
/* -------------------------------------------------------------------------- */

/** MSB <-> LSB. Readers disagree constantly about UID byte order. */
export function reverseBytes(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[bytes.length - 1 - i];
  return out;
}

/** Reverse the bit order inside each byte, leaving byte order alone. */
export function reverseBitsInBytes(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    let b = bytes[i];
    let r = 0;
    for (let k = 0; k < 8; k++) {
      r = (r << 1) | (b & 1);
      b >>= 1;
    }
    out[i] = r;
  }
  return out;
}

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
