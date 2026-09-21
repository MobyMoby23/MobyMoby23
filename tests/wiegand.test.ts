import {test} from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeWiegandBits,
  decodeWiegandHex,
  encodeWiegand26,
  encodeWiegand34,
} from '../src/lib/wiegand.ts';

test('26-bit encode/decode round-trips with valid parity', () => {
  const encoded = encodeWiegand26(123, 45678);
  assert.equal(encoded.bitLength, 26);
  assert.equal(encoded.facilityCode, 123);
  assert.equal(encoded.cardNumber, 45678);
  assert.equal(encoded.parityValid, true);

  const decoded = decodeWiegandBits(encoded.bits);
  assert.equal(decoded.facilityCode, 123);
  assert.equal(decoded.cardNumber, 45678);
  assert.equal(decoded.parityValid, true);
});

test('26-bit parity matches the published H10301 example', () => {
  // FC 1 / card 1 is the canonical worked example: parity bits are 1 and 0.
  const encoded = encodeWiegand26(1, 1);
  assert.equal(encoded.bits, '10000000100000000000000010');
  assert.equal(encoded.leadingParity, 1);
  assert.equal(encoded.trailingParity, 0);
});

test('a flipped bit is caught by parity', () => {
  const good = encodeWiegand26(200, 31337).bits;
  const flipped = good.slice(0, 5) + (good[5] === '1' ? '0' : '1') + good.slice(6);
  assert.equal(decodeWiegandBits(flipped).parityValid, false);
});

test('34-bit format carries a 16-bit facility code', () => {
  const encoded = encodeWiegand34(4321, 65535);
  assert.equal(encoded.bitLength, 34);
  assert.equal(encoded.facilityCode, 4321);
  assert.equal(encoded.cardNumber, 65535);
  assert.equal(encoded.parityValid, true);
});

test('hex from a reader decodes back to the printed numbers', () => {
  const encoded = encodeWiegand26(123, 45678);
  const fromHex = decodeWiegandHex(encoded.hex, 26);
  assert.equal(fromHex.facilityCode, 123);
  assert.equal(fromHex.cardNumber, 45678);
  assert.equal(fromHex.parityValid, true);
});

test('out-of-range and wrong-length inputs are rejected', () => {
  assert.throws(() => encodeWiegand26(256, 1), /does not fit/);
  assert.throws(() => encodeWiegand26(1, 65536), /does not fit/);
  assert.throws(() => decodeWiegandBits('1010'), /Unsupported Wiegand length/);
  assert.throws(() => decodeWiegandBits('hello'), /0s and 1s/);
});
