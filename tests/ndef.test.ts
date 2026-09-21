import {test} from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeMessage,
  encodeMessage,
  externalRecord,
  mimeRecord,
  parseMessage,
  textRecord,
  uriRecord,
} from '../src/lib/ndef.ts';
import {bytesToHex, utf8Encode} from '../src/lib/codec.ts';

test('a text record matches the NFC Forum byte layout', () => {
  const bytes = encodeMessage([textRecord('hello', 'en')]);
  // D1 = MB|ME|SR|TNF1, type len 1, payload len 8, 'T', status 02, 'en', 'hello'
  // D1 = MB|ME|SR|TNF1 | 01 type len | 08 payload len | 54 'T'
  //      | 02 status (UTF-8, 2-byte lang) | 656E 'en' | 68656C6C6F 'hello'
  assert.equal(bytesToHex(bytes), 'D101085402656E68656C6C6F');
  assert.equal(bytes[0], 0xd1);
  const [decoded] = decodeMessage(bytes);
  assert.equal(decoded.kind, 'text');
  assert.equal(decoded.value, 'hello');
  assert.equal(decoded.language, 'en');
});

test('uri records use the shortest matching prefix', () => {
  const withWww = encodeMessage([uriRecord('https://www.example.com/x')]);
  assert.equal(withWww[withWww.length - 'example.com/x'.length - 1], 0x02);
  assert.equal(decodeMessage(withWww)[0].value, 'https://www.example.com/x');

  const noWww = encodeMessage([uriRecord('https://example.com')]);
  assert.equal(noWww[noWww.length - 'example.com'.length - 1], 0x04);
  assert.equal(decodeMessage(noWww)[0].value, 'https://example.com');

  const tel = decodeMessage(encodeMessage([uriRecord('tel:+15551234567')]))[0];
  assert.equal(tel.value, 'tel:+15551234567');
});

test('multi-record messages set MB and ME on the right records', () => {
  const bytes = encodeMessage([textRecord('one'), uriRecord('https://a.co'), textRecord('three')]);
  const records = parseMessage(bytes);
  assert.equal(records.length, 3);
  const decoded = decodeMessage(bytes);
  assert.deepEqual(
    decoded.map((r) => r.value),
    ['one', 'https://a.co', 'three'],
  );
});

test('payloads over 255 bytes fall back to the long record form', () => {
  const long = 'x'.repeat(400);
  const bytes = encodeMessage([textRecord(long)]);
  assert.equal(bytes[0] & 0x10, 0, 'SR flag must be clear for a long record');
  assert.equal(decodeMessage(bytes)[0].value, long);
});

test('mime and external records keep their type strings', () => {
  const bytes = encodeMessage([
    mimeRecord('text/plain', utf8Encode('raw')),
    externalRecord('com.example:tag', utf8Encode('AB')),
  ]);
  const decoded = decodeMessage(bytes);
  assert.equal(decoded[0].kind, 'mime');
  assert.equal(decoded[0].typeLabel, 'text/plain');
  assert.equal(decoded[0].value, 'raw');
  assert.equal(decoded[1].kind, 'external');
  assert.equal(decoded[1].typeLabel, 'com.example:tag');
});

test('truncated messages are reported, not silently accepted', () => {
  const bytes = encodeMessage([textRecord('hello')]);
  assert.throws(() => parseMessage(bytes.slice(0, bytes.length - 3)), /Truncated/);
});

test('unicode text survives the round trip', () => {
  const decoded = decodeMessage(encodeMessage([textRecord('café 🔑', 'fr')]))[0];
  assert.equal(decoded.value, 'café 🔑');
  assert.equal(decoded.language, 'fr');
});
