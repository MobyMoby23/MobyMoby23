/**
 * Wiegand access-control formats.
 *
 * A badge's printed number and the hex its reader reports are the same bits in
 * different clothing; these helpers move between the two.
 */

import {bytesToHex, hexToBytes} from './codec.ts';

export interface WiegandDecode {
  format: 'H10301 (26-bit)' | 'H10302/34-bit';
  bitLength: number;
  facilityCode: number;
  cardNumber: number;
  bits: string;
  hex: string;
  leadingParity: number;
  trailingParity: number;
  leadingParityValid: boolean;
  trailingParityValid: boolean;
  parityValid: boolean;
}

function evenParity(bits: string): number {
  let ones = 0;
  for (const bit of bits) if (bit === '1') ones++;
  return ones % 2;
}

function oddParity(bits: string): number {
  return evenParity(bits) ^ 1;
}

function toBitString(value: number, width: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('Value must be a non-negative whole number.');
  }
  if (value >= 2 ** width) {
    throw new Error(`Value ${value} does not fit in ${width} bits.`);
  }
  return value.toString(2).padStart(width, '0');
}

/** Pack a facility code + card number into the 26 bits a reader emits. */
export function encodeWiegand26(facilityCode: number, cardNumber: number): WiegandDecode {
  const fc = toBitString(facilityCode, 8);
  const cn = toBitString(cardNumber, 16);
  const payload = fc + cn;
  // Leading bit is even parity over the first 12 payload bits, trailing bit is
  // odd parity over the last 12.
  const leading = evenParity(payload.slice(0, 12));
  const trailing = oddParity(payload.slice(12, 24));
  return decodeWiegandBits(`${leading}${payload}${trailing}`);
}

/** 34-bit variant: 16-bit facility code, 16-bit card number. */
export function encodeWiegand34(facilityCode: number, cardNumber: number): WiegandDecode {
  const fc = toBitString(facilityCode, 16);
  const cn = toBitString(cardNumber, 16);
  const payload = fc + cn;
  const leading = evenParity(payload.slice(0, 16));
  const trailing = oddParity(payload.slice(16, 32));
  return decodeWiegandBits(`${leading}${payload}${trailing}`);
}

export function decodeWiegandBits(bits: string): WiegandDecode {
  const cleaned = bits.replace(/[\s_]/g, '');
  if (!/^[01]+$/.test(cleaned)) {
    throw new Error('Wiegand input must be a string of 0s and 1s.');
  }
  if (cleaned.length !== 26 && cleaned.length !== 34) {
    throw new Error(
      `Unsupported Wiegand length: ${cleaned.length} bits (expected 26 or 34).`,
    );
  }

  const is26 = cleaned.length === 26;
  const fcWidth = is26 ? 8 : 16;
  const half = is26 ? 12 : 16;

  const leadingParity = Number(cleaned[0]);
  const trailingParity = Number(cleaned[cleaned.length - 1]);
  const payload = cleaned.slice(1, -1);

  const facilityCode = parseInt(payload.slice(0, fcWidth), 2);
  const cardNumber = parseInt(payload.slice(fcWidth), 2);

  const leadingParityValid = leadingParity === evenParity(payload.slice(0, half));
  const trailingParityValid = trailingParity === oddParity(payload.slice(-half));

  return {
    format: is26 ? 'H10301 (26-bit)' : 'H10302/34-bit',
    bitLength: cleaned.length,
    facilityCode,
    cardNumber,
    bits: cleaned,
    hex: bitsToHex(cleaned),
    leadingParity,
    trailingParity,
    leadingParityValid,
    trailingParityValid,
    parityValid: leadingParityValid && trailingParityValid,
  };
}

/**
 * Decode the hex a reader reports. 26-bit values arrive left-padded into 4
 * bytes and 34-bit values into 5, so the padding is trimmed back off first.
 */
export function decodeWiegandHex(hex: string, bitLength: 26 | 34): WiegandDecode {
  const bytes = hexToBytes(hex);
  let bits = '';
  for (let i = 0; i < bytes.length; i++) bits += bytes[i].toString(2).padStart(8, '0');
  if (bits.length < bitLength) {
    bits = bits.padStart(bitLength, '0');
  } else {
    bits = bits.slice(bits.length - bitLength);
  }
  return decodeWiegandBits(bits);
}

/** Left-pad the bit string to whole bytes and render it as hex. */
export function bitsToHex(bits: string): string {
  const padded = bits.padStart(Math.ceil(bits.length / 8) * 8, '0');
  const bytes = new Uint8Array(padded.length / 8);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(padded.substr(i * 8, 8), 2);
  }
  return bytesToHex(bytes);
}
