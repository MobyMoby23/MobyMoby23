import {test} from 'node:test';
import assert from 'node:assert/strict';

import {em4100FromHex, em4100FromParts} from '../src/lib/em4100.ts';

test('a 10-hex-digit tag ID splits into the printed formats', () => {
  const f = em4100FromHex('0600BC1F2C');
  assert.equal(f.hex, '0600BC1F2C');
  assert.equal(f.customerCode, 6);
  assert.equal(f.decimal10, '0012328748');
  assert.equal(f.decimal5, '07980');
  assert.equal(f.split35, '188,07980');
  assert.equal(f.decimal40, '25782132524');
  assert.equal(f.reversedHex, '2C1FBC0006');
});

test('parts and hex are two views of the same 40 bits', () => {
  const fromParts = em4100FromParts(6, 12328748);
  assert.equal(fromParts.hex, '0600BC1F2C');
  assert.deepEqual(em4100FromHex(fromParts.hex), fromParts);
});

test('short input is left-padded to 40 bits', () => {
  const f = em4100FromHex('1F2C');
  assert.equal(f.hex, '0000001F2C');
  assert.equal(f.decimal5, '07980');
});

test('oversized input is rejected', () => {
  assert.throws(() => em4100FromHex('0600BC1F2CFF'), /40 bits/);
  assert.throws(() => em4100FromParts(256, 0), /0-255/);
  assert.throws(() => em4100FromParts(0, 2 ** 32), /0-4294967295/);
});
