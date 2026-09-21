/**
 * The bridge to Core NFC, and the honest story about what is available.
 *
 * Expo Go ships a fixed set of native modules and Core NFC is not among them,
 * so `react-native-nfc-manager` has no native counterpart there — importing it
 * eagerly would crash the app on launch. Everything below therefore probes for
 * the native module first and falls back to a clearly-labelled demo mode, so
 * the whole app stays usable in Expo Go while real scanning lights up as soon
 * as you move to a development build.
 */

import {NativeModules, Platform} from 'react-native';

import {bytesToHex, hexToBytes, utf8Encode} from './codec.ts';
import {
  decodeMessage,
  encodeMessage,
  textRecord,
  uriRecord,
  type DecodedRecord,
  type NdefRecord,
} from './ndef.ts';

export type NfcAvailability =
  /** Native module present and the radio is usable. */
  | 'ready'
  /** Native module present but NFC is switched off or restricted. */
  | 'disabled'
  /** Real device, real build, but the hardware/OS cannot do it. */
  | 'unsupported'
  /** Running in Expo Go (or a simulator) — no Core NFC module linked. */
  | 'demo';

export interface NfcStatus {
  availability: NfcAvailability;
  /** True whenever reads and writes are simulated rather than real. */
  demoMode: boolean;
  message: string;
}

export interface TagData {
  uid: string;
  /** e.g. `NfcA`, `Iso15693` — whatever iOS reports for the tag. */
  techTypes: string[];
  /** NDEF capacity in bytes, when the tag reports one. */
  maxSize?: number;
  isWritable?: boolean;
  records: DecodedRecord[];
  /** The raw NDEF message, hex encoded. Empty for a blank tag. */
  ndefHex: string;
  scannedAt: number;
  simulated: boolean;
}

/* -------------------------------------------------------------------------- */
/* Native module probing                                                       */
/* -------------------------------------------------------------------------- */

type NfcModule = typeof import('react-native-nfc-manager');

let cachedModule: NfcModule | null | undefined;

function loadNfcModule(): NfcModule | null {
  if (cachedModule !== undefined) return cachedModule;

  // `react-native-nfc-manager` builds a NativeEventEmitter at import time and
  // throws when the native module is missing, so check before requiring.
  if (Platform.OS !== 'ios' || !NativeModules.NfcManager) {
    cachedModule = null;
    return cachedModule;
  }

  try {
    cachedModule = require('react-native-nfc-manager') as NfcModule;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

let started = false;

async function ensureStarted(): Promise<NfcModule | null> {
  const module = loadNfcModule();
  if (!module) return null;
  if (!started) {
    await module.default.start();
    started = true;
  }
  return module;
}

export async function getNfcStatus(): Promise<NfcStatus> {
  const module = loadNfcModule();

  if (!module) {
    return {
      availability: 'demo',
      demoMode: true,
      message:
        'Expo Go cannot link Core NFC, so scanning is simulated. Converters work for real. Run a development build to talk to actual tags.',
    };
  }

  try {
    const supported = await module.default.isSupported();
    if (!supported) {
      return {
        availability: 'unsupported',
        demoMode: true,
        message: 'This device does not support NFC. Falling back to simulated tags.',
      };
    }
    await ensureStarted();
    const enabled = await module.default.isEnabled();
    if (!enabled) {
      return {
        availability: 'disabled',
        demoMode: false,
        message: 'NFC is currently unavailable. Check Settings, then try again.',
      };
    }
    return {
      availability: 'ready',
      demoMode: false,
      message: 'NFC ready. Hold the top of your iPhone against the tag.',
    };
  } catch (error) {
    return {
      availability: 'unsupported',
      demoMode: true,
      message: `NFC could not be initialised (${describeError(error)}). Using simulated tags.`,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

export async function readTag(): Promise<TagData> {
  const module = await ensureStarted();
  if (!module) return simulateTag();

  const {default: NfcManager, NfcTech} = module;

  try {
    await NfcManager.requestTechnology(NfcTech.Ndef, {
      alertMessage: 'Hold your iPhone near the tag',
    });
    const tag = await NfcManager.getTag();
    if (!tag) throw new Error('The tag went away before it could be read.');

    const ndefBytes = messageToBytes(tag.ndefMessage);
    const ndefStatus = await readNdefStatus(NfcManager);
    await NfcManager.setAlertMessageIOS('Tag read');

    return {
      uid: normalizeUid(tag.id),
      techTypes: tag.techTypes ?? [],
      maxSize: ndefStatus?.capacity ?? tag.maxSize,
      isWritable: ndefStatus?.writable,
      records: ndefBytes.length > 0 ? safeDecode(ndefBytes) : [],
      ndefHex: bytesToHex(ndefBytes),
      scannedAt: Date.now(),
      simulated: false,
    };
  } finally {
    await cancel();
  }
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

export interface WriteResult {
  bytesWritten: number;
  simulated: boolean;
  uid?: string;
}

export async function writeRecords(
  records: NdefRecord[],
  options: {makeReadOnly?: boolean} = {},
): Promise<WriteResult> {
  const bytes = encodeMessage(records);
  if (bytes.length === 0) throw new Error('Nothing to write — add a record first.');

  const module = await ensureStarted();
  if (!module) {
    await simulatedDelay();
    return {bytesWritten: bytes.length, simulated: true, uid: simulatedUid()};
  }

  const {default: NfcManager, NfcTech} = module;

  try {
    await NfcManager.requestTechnology(NfcTech.Ndef, {
      alertMessage: 'Hold your iPhone near the tag to write',
    });

    const tag = await NfcManager.getTag();
    const ndefStatus = await readNdefStatus(NfcManager);
    if (ndefStatus?.writable === false) {
      throw new Error('This tag is locked and cannot be written.');
    }
    const capacity = ndefStatus?.capacity ?? tag?.maxSize;
    if (capacity != null && bytes.length > capacity) {
      throw new Error(`Message is ${bytes.length} bytes but the tag holds ${capacity}.`);
    }

    await NfcManager.ndefHandler.writeNdefMessage(Array.from(bytes));
    if (options.makeReadOnly) {
      await NfcManager.ndefHandler.makeReadOnly();
    }
    await NfcManager.setAlertMessageIOS('Tag written');

    return {
      bytesWritten: bytes.length,
      simulated: false,
      uid: tag ? normalizeUid(tag.id) : undefined,
    };
  } finally {
    await cancel();
  }
}

export async function cancel(): Promise<void> {
  const module = loadNfcModule();
  if (!module) return;
  try {
    await module.default.cancelTechnologyRequest();
  } catch {
    // Already closed — nothing to unwind.
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

export function describeError(error: unknown): string {
  if (error == null) return 'unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  const maybe = error as {message?: string; toString?: () => string};
  return maybe.message ?? maybe.toString?.() ?? 'unknown error';
}

/** True when the user simply pulled the phone away or tapped Cancel. */
export function isCancellation(error: unknown): boolean {
  const message = describeError(error).toLowerCase();
  return (
    message.includes('cancel') ||
    message.includes('user canceled') ||
    message.includes('session invalidated')
  );
}

function normalizeUid(id: unknown): string {
  if (typeof id === 'string') return bytesToHex(hexToBytes(id), {separator: 'space'});
  if (Array.isArray(id)) return bytesToHex(Uint8Array.from(id as number[]), {separator: 'space'});
  return '';
}

/**
 * Ask the tag whether it is writable and how much it holds. Not every tag
 * answers, so a failure here is information we simply do not have.
 */
async function readNdefStatus(
  manager: NfcModule['default'],
): Promise<{writable: boolean; capacity: number} | null> {
  try {
    const status = await manager.ndefHandler.getNdefStatus();
    return {
      // 2 === ReadWrite in the NdefStatus enum; 3 is ReadOnly, 1 NotSupported.
      writable: Number(status.status) === 2,
      capacity: status.capacity,
    };
  } catch {
    return null;
  }
}

/** Re-encode the records nfc-manager hands back into a single NDEF message. */
function messageToBytes(
  message:
    | {type?: number[] | string; id?: number[]; payload?: unknown[]; tnf?: number}[]
    | undefined,
): Uint8Array {
  if (!message || message.length === 0) return new Uint8Array(0);
  return encodeMessage(
    message.map((record) => ({
      tnf: record.tnf ?? 1,
      type: typeof record.type === 'string' ? utf8Encode(record.type) : Uint8Array.from(record.type ?? []),
      id: Uint8Array.from(record.id ?? []),
      payload: Uint8Array.from((record.payload ?? []) as number[]),
    })),
  );
}

function safeDecode(bytes: Uint8Array): DecodedRecord[] {
  try {
    return decodeMessage(bytes);
  } catch {
    return [];
  }
}

function simulatedDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 900));
}

function simulatedUid(): string {
  const bytes = new Uint8Array(7);
  bytes[0] = 0x04; // NXP manufacturer byte, as on a real NTAG.
  for (let i = 1; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytesToHex(bytes, {separator: 'space'});
}

/** A believable NTAG215 so the Read screen can be exercised without hardware. */
async function simulateTag(): Promise<TagData> {
  await simulatedDelay();
  const bytes = encodeMessage([
    textRecord('Simulated tag — Expo Go demo mode', 'en'),
    uriRecord('https://developer.apple.com/documentation/corenfc'),
  ]);
  return {
    uid: simulatedUid(),
    techTypes: ['NfcA', 'Ndef'],
    maxSize: 504,
    isWritable: true,
    records: decodeMessage(bytes),
    ndefHex: bytesToHex(bytes),
    scannedAt: Date.now(),
    simulated: true,
  };
}
