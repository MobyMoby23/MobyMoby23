/**
 * A self-contained NDEF encoder/decoder.
 *
 * react-native-nfc-manager ships one too, but that module only loads where the
 * native code exists. Keeping our own means the Write and Convert screens can
 * build and inspect messages in Expo Go, with no tag anywhere near the phone.
 */

import {
  bytesToHex,
  bytesToPrintableAscii,
  concatBytes,
  utf8Decode,
  utf8Encode,
} from './codec.ts';

export const TNF_EMPTY = 0x00;
export const TNF_WELL_KNOWN = 0x01;
export const TNF_MIME = 0x02;
export const TNF_ABSOLUTE_URI = 0x03;
export const TNF_EXTERNAL = 0x04;
export const TNF_UNKNOWN = 0x05;

export interface NdefRecord {
  tnf: number;
  type: Uint8Array;
  id: Uint8Array;
  payload: Uint8Array;
}

export type DecodedRecordKind = 'text' | 'uri' | 'mime' | 'external' | 'unknown';

export interface DecodedRecord {
  kind: DecodedRecordKind;
  /** Short label for the record type, e.g. `Text`, `URI`, `text/plain`. */
  typeLabel: string;
  /** The payload rendered for humans. */
  value: string;
  /** Language code, for text records only. */
  language?: string;
  payloadHex: string;
  byteLength: number;
  record: NdefRecord;
}

/** Index in this table is the value of the URI record's first payload byte. */
export const URI_PREFIXES = [
  '',
  'http://www.',
  'https://www.',
  'http://',
  'https://',
  'tel:',
  'mailto:',
  'ftp://anonymous:anonymous@',
  'ftp://ftp.',
  'ftps://',
  'sftp://',
  'smb://',
  'nfs://',
  'ftp://',
  'dav://',
  'news:',
  'telnet://',
  'imap:',
  'rtsp://',
  'urn:',
  'pop:',
  'sip:',
  'sips:',
  'tftp:',
  'btspp://',
  'btl2cap://',
  'btgoep://',
  'tcpobex://',
  'irdaobex://',
  'file://',
  'urn:epc:id:',
  'urn:epc:tag:',
  'urn:epc:pat:',
  'urn:epc:raw:',
  'urn:epc:',
  'urn:nfc:',
];

/* -------------------------------------------------------------------------- */
/* Encoding                                                                    */
/* -------------------------------------------------------------------------- */

export function textRecord(text: string, language = 'en'): NdefRecord {
  const lang = utf8Encode(language);
  if (lang.length > 63) throw new Error('Language code is too long.');
  const body = utf8Encode(text);
  // Status byte: bit 7 clear means UTF-8, low 6 bits hold the language length.
  const status = Uint8Array.from([lang.length & 0x3f]);
  return {
    tnf: TNF_WELL_KNOWN,
    type: utf8Encode('T'),
    id: new Uint8Array(0),
    payload: concatBytes(status, lang, body),
  };
}

export function uriRecord(uri: string): NdefRecord {
  let prefixCode = 0;
  let rest = uri;
  // Longest matching prefix wins, so `https://www.` beats `https://`.
  for (let i = 1; i < URI_PREFIXES.length; i++) {
    const prefix = URI_PREFIXES[i];
    if (
      uri.toLowerCase().startsWith(prefix.toLowerCase()) &&
      prefix.length > URI_PREFIXES[prefixCode].length
    ) {
      prefixCode = i;
      rest = uri.slice(prefix.length);
    }
  }
  return {
    tnf: TNF_WELL_KNOWN,
    type: utf8Encode('U'),
    id: new Uint8Array(0),
    payload: concatBytes(Uint8Array.from([prefixCode]), utf8Encode(rest)),
  };
}

export function mimeRecord(mimeType: string, payload: Uint8Array): NdefRecord {
  return {
    tnf: TNF_MIME,
    type: utf8Encode(mimeType),
    id: new Uint8Array(0),
    payload,
  };
}

export function externalRecord(type: string, payload: Uint8Array): NdefRecord {
  return {
    tnf: TNF_EXTERNAL,
    type: utf8Encode(type),
    id: new Uint8Array(0),
    payload,
  };
}

export function encodeRecord(
  record: NdefRecord,
  flags: {first: boolean; last: boolean},
): Uint8Array {
  const shortRecord = record.payload.length < 256;
  let header = record.tnf & 0x07;
  if (flags.first) header |= 0x80; // MB
  if (flags.last) header |= 0x40; // ME
  if (shortRecord) header |= 0x10; // SR
  if (record.id.length > 0) header |= 0x08; // IL

  const parts: Uint8Array[] = [Uint8Array.from([header, record.type.length])];

  if (shortRecord) {
    parts.push(Uint8Array.from([record.payload.length]));
  } else {
    const len = record.payload.length;
    parts.push(
      Uint8Array.from([(len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff]),
    );
  }
  if (record.id.length > 0) parts.push(Uint8Array.from([record.id.length]));
  parts.push(record.type);
  if (record.id.length > 0) parts.push(record.id);
  parts.push(record.payload);

  return concatBytes(...parts);
}

export function encodeMessage(records: NdefRecord[]): Uint8Array {
  if (records.length === 0) return new Uint8Array(0);
  return concatBytes(
    ...records.map((record, index) =>
      encodeRecord(record, {
        first: index === 0,
        last: index === records.length - 1,
      }),
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Decoding                                                                    */
/* -------------------------------------------------------------------------- */

export function parseMessage(bytes: Uint8Array): NdefRecord[] {
  const records: NdefRecord[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    const header = bytes[offset++];
    const shortRecord = (header & 0x10) !== 0;
    const hasId = (header & 0x08) !== 0;
    const tnf = header & 0x07;

    if (offset >= bytes.length) throw new Error('Truncated NDEF record header.');
    const typeLength = bytes[offset++];

    let payloadLength: number;
    if (shortRecord) {
      payloadLength = bytes[offset++];
    } else {
      payloadLength =
        ((bytes[offset] << 24) >>> 0) +
        (bytes[offset + 1] << 16) +
        (bytes[offset + 2] << 8) +
        bytes[offset + 3];
      offset += 4;
    }

    const idLength = hasId ? bytes[offset++] : 0;

    const end = offset + typeLength + idLength + payloadLength;
    if (end > bytes.length) throw new Error('Truncated NDEF record payload.');

    const type = bytes.slice(offset, offset + typeLength);
    offset += typeLength;
    const id = bytes.slice(offset, offset + idLength);
    offset += idLength;
    const payload = bytes.slice(offset, offset + payloadLength);
    offset += payloadLength;

    records.push({tnf, type, id, payload});

    if ((header & 0x40) !== 0) break; // ME: message ends here.
  }

  return records;
}

export function decodeRecord(record: NdefRecord): DecodedRecord {
  const typeString = utf8Decode(record.type);
  const base = {
    payloadHex: bytesToHex(record.payload, {separator: 'space'}),
    byteLength: record.payload.length,
    record,
  };

  if (record.tnf === TNF_WELL_KNOWN && typeString === 'T') {
    const status = record.payload[0] ?? 0;
    const langLength = status & 0x3f;
    const isUtf16 = (status & 0x80) !== 0;
    const language = utf8Decode(record.payload.slice(1, 1 + langLength));
    const body = record.payload.slice(1 + langLength);
    return {
      ...base,
      kind: 'text',
      typeLabel: 'Text',
      language,
      value: isUtf16 ? decodeUtf16(body) : utf8Decode(body),
    };
  }

  if (record.tnf === TNF_WELL_KNOWN && typeString === 'U') {
    const prefix = URI_PREFIXES[record.payload[0]] ?? '';
    return {
      ...base,
      kind: 'uri',
      typeLabel: 'URI',
      value: prefix + utf8Decode(record.payload.slice(1)),
    };
  }

  if (record.tnf === TNF_MIME) {
    return {
      ...base,
      kind: 'mime',
      typeLabel: typeString || 'MIME',
      value: typeString.startsWith('text/')
        ? utf8Decode(record.payload)
        : bytesToPrintableAscii(record.payload),
    };
  }

  if (record.tnf === TNF_EXTERNAL) {
    return {
      ...base,
      kind: 'external',
      typeLabel: typeString || 'External',
      value: bytesToPrintableAscii(record.payload),
    };
  }

  return {
    ...base,
    kind: 'unknown',
    typeLabel: typeString || `TNF ${record.tnf}`,
    value: bytesToPrintableAscii(record.payload),
  };
}

export function decodeMessage(bytes: Uint8Array): DecodedRecord[] {
  return parseMessage(bytes).map(decodeRecord);
}

/** UTF-16 text records are rare but legal, so handle big- and little-endian. */
function decodeUtf16(bytes: Uint8Array): string {
  let start = 0;
  let littleEndian = false;
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      littleEndian = true;
      start = 2;
    } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      start = 2;
    }
  }
  let out = '';
  for (let i = start; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode(
      littleEndian ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1],
    );
  }
  return out;
}
