/**
 * Peer groups this account joined. Local only: joining books the phone's calendar but the
 * organizer is not told until a partner connects sign-up, so a joined group carries a small phone
 * badge until the person has called the organizer from it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { getActiveUid } from '../../services/firebase';

const key = () => `joined_peer_groups:${getActiveUid()}`;
const calledKey = () => `called_peer_group_organizers:${getActiveUid()}`;

async function readIds(k: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(k);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

interface JoinedGroupsState {
  ids: string[];
  /** Joined groups whose organizer this person has tapped to call, to confirm their place. */
  called: string[];
  load: () => Promise<void>;
  toggle: (id: string) => Promise<void>;
  markCalled: (id: string) => Promise<void>;
}

export const useJoinedGroups = create<JoinedGroupsState>((set, get) => ({
  ids: [],
  called: [],
  load: async () => {
    const [ids, called] = await Promise.all([readIds(key()), readIds(calledKey())]);
    set({ ids, called });
  },
  toggle: async (id) => {
    const cur = get().ids;
    const ids = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    set({ ids });
    await AsyncStorage.setItem(key(), JSON.stringify(ids)).catch(() => {});
  },
  markCalled: async (id) => {
    if (get().called.includes(id)) return;
    const called = [...get().called, id];
    set({ called });
    await AsyncStorage.setItem(calledKey(), JSON.stringify(called)).catch(() => {});
  },
}));
