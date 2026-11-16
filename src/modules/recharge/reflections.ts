/**
 * Short written reflections from the Recharge tab. Kept on this phone only (AsyncStorage, per
 * account); the event log records that one was written, never the text.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getActiveUid } from '../../services/firebase';
import { logEvent } from '../../services/logging';

export interface Reflection {
  ts: number;
  itemId: string;
  prompt: string;
  text: string;
}

const MAX_KEPT = 200;
const key = () => `recharge_reflections:${getActiveUid()}`;

export async function readReflections(): Promise<Reflection[]> {
  try {
    const raw = await AsyncStorage.getItem(key());
    return raw ? (JSON.parse(raw) as Reflection[]) : [];
  } catch {
    return [];
  }
}

export async function saveReflection(itemId: string, prompt: string, text: string): Promise<void> {
  const entry: Reflection = { ts: Date.now(), itemId, prompt, text: text.trim() };
  const all = [entry, ...(await readReflections())].slice(0, MAX_KEPT);
  await AsyncStorage.setItem(key(), JSON.stringify(all));
  void logEvent('recharge_reflection_saved', { itemId, length: entry.text.length }).catch(() => {});
}
