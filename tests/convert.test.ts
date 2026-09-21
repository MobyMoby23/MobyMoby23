import {test} from 'node:test';
import assert from 'node:assert/strict';

import {convertFrom, detectFormat, parseInput} from '../src/lib/convert.ts';
import {bytesToHex} from '../src/lib/codec.ts';

test('format detection picks sensible defaults', () => {
  assert.equal(detectFormat('04A2241B'), 'hex');
  assert.equal(detectFormat('04:A2:24:1B'), 'hex');
  assert.equal(detectFormat('0x1234'), 'hex');
  assert.equal(detectFormat('00000100 10100010'), 'binary');
  assert.equal(detectFormat('1234'), 'decimal');
  assert.equal(detectFormat('hello tag'), 'text');
  assert.equal(detectFormat(''), 'hex');
});

test('parseInput honours the chosen format over the guess', () => {
  assert.equal(bytesToHex(parseInput('1234', 'hex')), '1234');
  assert.equal(bytesToHex(parseInput('1234', 'decimal')), '04D2');
});

test('convert renders one value every way at once', () => {
  const result = convertFrom('04A2241B', 'hex');
  assert.equal(result.byteLength, 4);
  assert.equal(result.bitLength, 32);
  assert.equal(result.hex, '04A2241B');
  assert.equal(result.hexSpaced, '04 A2 24 1B');
  assert.equal(result.decimal, '77734939');
  assert.equal(result.base64, 'BKIkGw==');
  assert.equal(result.reversedHex, '1B24A204');
  assert.equal(result.reversedDecimal, '455385604');
  assert.equal(result.binary, '00000100 10100010 00100100 00011011');
});

test('text input converts to the bytes a tag would hold', () => {
  const result = convertFrom('NFC', 'text');
  assert.equal(result.hex, '4E4643');
  assert.equal(result.text, 'NFC');
  assert.equal(result.ascii, 'NFC');
});
