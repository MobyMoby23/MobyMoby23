/**
 * EM4100 / EM4102 (125 kHz) tag identifiers.
 *
 * These tags carry 40 bits: an 8-bit customer/version code followed by a 32-bit
 * card number. Vendors print that same number in half a dozen different ways,
 * which is what this module untangles.
 *
 * Note: an iPhone cannot read 125 kHz tags — Core NFC is 13.56 MHz only. This
 * is here so numbers copied off a badge or a desktop reader can be converted.
 */

import {bytesToHex, hexToBytes} from './codec.ts';

export interface Em4100Formats {
  /** All 40 bits as 10 hex digits. */
  hex: string;
  /** 8-bit customer/version code. */
  customerCode: number;
  /** The 32-bit card number, the "10-digit" number printed on many tags. */
  decimal10: string;
  /** 3-digit + 5-digit split of the low 24 bits, e.g. "045,12345". */
  split35: string;
  /** Low 16 bits — the short number printed on fobs. */
  decimal5: string;
  /** The full 40-bit value as decimal. */
  decimal40: string;
  /** Same 40 bits with the byte order flipped, for readers that report LSB. */
  reversedHex: string;
}

const MASK_40 = (1n << 40n) - 1n;

function toFormats(value40: bigint): Em4100Formats {
  const value = value40 & MASK_40;
  const bytes = new Uint8Array(5);
  for (let i = 4; i >= 0; i--) {
    bytes[i] = Number((value >> BigInt((4 - i) * 8)) & 0xffn);
  }

  const customerCode = bytes[0];
  const card32 = value & 0xffffffffn;
  const card16 = value & 0xffffn;
  const mid8 = (value >> 16n) & 0xffn;

  const reversed = new Uint8Array(5);
  for (let i = 0; i < 5; i++) reversed[i] = bytes[4 - i];

  return {
    hex: bytesToHex(bytes),
    customerCode,
    decimal10: card32.toString(10).padStart(10, '0'),
    split35: `${mid8.toString(10).padStart(3, '0')},${card16
      .toString(10)
      .padStart(5, '0')}`,
    decimal5: card16.toString(10).padStart(5, '0'),
    decimal40: value.toString(10),
    reversedHex: bytesToHex(reversed),
  };
}

/** Parse the 10 hex digits stamped on a tag (shorter input is left-padded). */
export function em4100FromHex(hex: string): Em4100Formats {
  const bytes = hexToBytes(hex);
  if (bytes.length > 5) {
    throw new Error('An EM4100 ID is 40 bits — at most 10 hex digits.');
  }
  let value = 0n;
  for (let i = 0; i < bytes.length; i++) value = (value << 8n) | BigInt(bytes[i]);
  return toFormats(value);
}

/** Rebuild a tag ID from the customer code and the 32-bit card number. */
export function em4100FromParts(customerCode: number, cardNumber: number): Em4100Formats {
  if (customerCode < 0 || customerCode > 0xff) {
    throw new Error('Customer code must be 0-255.');
  }
  if (cardNumber < 0 || cardNumber > 0xffffffff) {
    throw new Error('Card number must be 0-4294967295.');
  }
  return toFormats((BigInt(customerCode) << 32n) | BigInt(cardNumber));
}
