import {test} from 'node:test';
import assert from 'node:assert/strict';

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
  reverseBitsInBytes,
  reverseBytes,
  utf8Decode,
  utf8Encode,
} from '../src/lib/codec.ts';

test('hex parsing tolerates the punctuation people paste', () => {
  const expected = Uint8Array.from([0x04, 0xa2, 0x24, 0x1b]);
  for (const input of ['04A2241B', '04 a2 24 1b', '04:A2:24:1B', '0x04a2241b', '04-A2-24-1B']) {
    assert.deepEqual(hexToBytes(input), expected, input);
  }
});

test('odd hex digit counts are left-padded', () => {
  assert.deepEqual(hexToBytes('fff'), Uint8Array.from([0x0f, 0xff]));
});

test('hex rejects non-hex input', () => {
  assert.throws(() => hexToBytes('zz11'), /valid hex/);
  assert.equal(isHex('nope'), false);
  assert.equal(isHex('04:A2'), true);
});

test('hex formatting honours separator and case', () => {
  const bytes = hexToBytes('04a2241b');
  assert.equal(bytesToHex(bytes), '04A2241B');
  assert.equal(bytesToHex(bytes, {separator: 'space'}), '04 A2 24 1B');
  assert.equal(bytesToHex(bytes, {separator: 'colon', uppercase: false}), '04:a2:24:1b');
});

test('decimal round-trips through bytes', () => {
  assert.equal(bytesToDecimal(hexToBytes('04a2241b')), '77734939');
  assert.deepEqual(decimalToBytes('77734939'), hexToBytes('04a2241b'));
  // Values wider than 53 bits stay exact because BigInt does the work.
  const big = '1208925819614629174706175'; // 2^80 - 1
  assert.equal(bytesToDecimal(decimalToBytes(big)), big);
});

test('binary round-trips and groups by byte', () => {
  assert.equal(bytesToBinary(hexToBytes('04a2')), '00000100 10100010');
  assert.deepEqual(binaryToBytes('00000100 10100010'), hexToBytes('04a2'));
  assert.deepEqual(binaryToBytes('100000100'), hexToBytes('0104'));
});

test('utf-8 survives a round trip including emoji', () => {
  for (const text of ['hello', 'héllo wörld', 'tag ✓', '🔑 key', '']) {
    assert.equal(utf8Decode(utf8Encode(text)), text, text);
  }
  assert.deepEqual(utf8Encode('é'), Uint8Array.from([0xc3, 0xa9]));
  assert.equal(utf8Encode('🔑').length, 4);
});

test('printable ascii masks control bytes', () => {
  assert.equal(bytesToPrintableAscii(Uint8Array.from([0x41, 0x00, 0x42, 0xff])), 'A.B.');
});

test('base64 round-trips at every padding length', () => {
  assert.equal(bytesToBase64(utf8Encode('any carnal pleasure')), 'YW55IGNhcm5hbCBwbGVhc3VyZQ==');
  for (const text of ['a', 'ab', 'abc', 'abcd', 'abcde']) {
    assert.equal(utf8Decode(base64ToBytes(bytesToBase64(utf8Encode(text)))), text, text);
  }
  assert.deepEqual(base64ToBytes('BKIkGw=='), hexToBytes('04a2241b'));
});

test('byte and bit reversal', () => {
  assert.equal(bytesToHex(reverseBytes(hexToBytes('04a2241b'))), '1B24A204');
  // 0x01 -> 0b00000001 reversed is 0b10000000 = 0x80.
  assert.equal(bytesToHex(reverseBitsInBytes(hexToBytes('0180'))), '8001');
});

test('empty input is not an error', () => {
  assert.equal(hexToBytes('').length, 0);
  assert.equal(bytesToDecimal(new Uint8Array(0)), '0');
  assert.equal(bytesToBase64(new Uint8Array(0)), '');
});
