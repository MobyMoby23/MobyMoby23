/** Scan history, persisted locally so a tag read is still there tomorrow. */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type {TagData} from './nfc.ts';

const STORAGE_KEY = 'rfid-tool/history/v1';
const MAX_ENTRIES = 100;

export interface HistoryEntry extends TagData {
  id: string;
  /** Optional note the user attaches to a scan. */
  label?: string;
}

function makeId(tag: TagData): string {
  return `${tag.scannedAt}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    // A corrupt store should not take the History tab down with it.
    return [];
  }
}

async function save(entries: HistoryEntry[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
}

export async function addToHistory(tag: TagData): Promise<HistoryEntry[]> {
  const entries = await loadHistory();
  const next = [{...tag, id: makeId(tag)}, ...entries];
  await save(next);
  return next.slice(0, MAX_ENTRIES);
}

export async function removeFromHistory(id: string): Promise<HistoryEntry[]> {
  const next = (await loadHistory()).filter((entry) => entry.id !== id);
  await save(next);
  return next;
}

export async function clearHistory(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
