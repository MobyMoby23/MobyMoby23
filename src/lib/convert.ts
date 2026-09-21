/**
 * The conversion workbench: take one value in whatever notation the user has,
 * turn it into bytes, then render those bytes every other way.
 */

import {
  base64ToBytes,
  binaryToBytes,
  bytesToBase64,
  bytesToBinary,
  bytesToDecimal,
  bytesToHex,
  bytesToPrintableAscii,
  decimalToBytes,
  hexToBytes,
  isHex,
  normalizeHex,
  reverseBitsInBytes,
  reverseBytes,
  utf8Decode,
  utf8Encode,
} from './codec.ts';

export type InputFormat = 'hex' | 'decimal' | 'binary' | 'text' | 'base64';

export const INPUT_FORMATS: {value: InputFormat; label: string}[] = [
  {value: 'hex', label: 'Hex'},
  {value: 'decimal', label: 'Dec'},
  {value: 'binary', label: 'Bin'},
  {value: 'text', label: 'Text'},
  {value: 'base64', label: 'B64'},
];

export function parseInput(value: string, format: InputFormat): Uint8Array {
  switch (format) {
    case 'hex':
      return hexToBytes(value);
    case 'decimal':
      return decimalToBytes(value);
    case 'binary':
      return binaryToBytes(value);
    case 'text':
      return utf8Encode(value);
    case 'base64':
      return base64ToBytes(value);
  }
}

/**
 * Best guess at what the user pasted, used to pre-select the input format.
 * Hex wins ties because that is what tag dumps look like.
 */
export function detectFormat(value: string): InputFormat {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'hex';

  const compact = trimmed.replace(/[\s:\-_]/g, '');
  if (/^[01]+$/.test(compact) && compact.length >= 8 && compact.length % 8 === 0) {
    return 'binary';
  }
  if (/^0x[0-9a-f]+$/i.test(trimmed)) return 'hex';
  if (/^\d+$/.test(compact)) {
    // A run of digits is ambiguous. Treat even-length digit strings that read
    // like a tag dump (>= 8 chars) as hex, anything else as a decimal number.
    return compact.length >= 8 && compact.length % 2 === 0 ? 'hex' : 'decimal';
  }
  if (isHex(trimmed) && normalizeHex(trimmed).length % 2 === 0) return 'hex';
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length % 4 === 0) {
    return 'base64';
  }
  return 'text';
}

export interface ConversionResult {
  bytes: Uint8Array;
  byteLength: number;
  bitLength: number;
  hex: string;
  hexSpaced: string;
  hexColons: string;
  hexLower: string;
  decimal: string;
  binary: string;
  text: string;
  ascii: string;
  base64: string;
  reversedHex: string;
  reversedDecimal: string;
  bitReversedHex: string;
}

export function convert(bytes: Uint8Array): ConversionResult {
  const reversed = reverseBytes(bytes);
  return {
    bytes,
    byteLength: bytes.length,
    bitLength: bytes.length * 8,
    hex: bytesToHex(bytes),
    hexSpaced: bytesToHex(bytes, {separator: 'space'}),
    hexColons: bytesToHex(bytes, {separator: 'colon'}),
    hexLower: bytesToHex(bytes, {uppercase: false}),
    decimal: bytesToDecimal(bytes),
    binary: bytesToBinary(bytes),
    text: utf8Decode(bytes),
    ascii: bytesToPrintableAscii(bytes),
    base64: bytesToBase64(bytes),
    reversedHex: bytesToHex(reversed),
    reversedDecimal: bytesToDecimal(reversed),
    bitReversedHex: bytesToHex(reverseBitsInBytes(bytes)),
  };
}

export function convertFrom(value: string, format: InputFormat): ConversionResult {
  return convert(parseInput(value, format));
}
