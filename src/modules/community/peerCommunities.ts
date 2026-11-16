/**
 * Peer communities on the Community tab: user-oriented groups to join, plus ones this account
 * creates. First version is local only: joining and creating are kept on this phone, member counts
 * are seeded. Each joined community opens the same chat room as an official group (see
 * GroupRoomScreen/groupRoom.ts) — there are no posts outside that room yet.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { getActiveUid } from '../../services/firebase';

export interface PeerCommunity {
  id: string;
  name: string;
  emoji?: string;
  description?: string;
  /** Members other than this account. */
  baseMembers: number;
  /** True for a community this account created. */
  mine?: boolean;
}

export const SEED_PEER_COMMUNITIES: readonly PeerCommunity[] = [
  {
    id: 'late-night-insomnia',
    emoji: '\u{1F319}',
    name: 'Late-Night Insomnia Support',
    description: 'For the nights sleep will not come. Company and gentle wind-down ideas.',
    baseMembers: 1284,
  },
  {
    id: 'workplace-stress',
    emoji: '\u{1F4BC}',
    name: 'Workplace Stress Zone',
    description: 'Deadlines, bosses and burnout, talked through with people who get it.',
    baseMembers: 2107,
  },
  {
    id: 'study-pressure',
    emoji: '\u{1F4DA}',
    name: 'Study Pressure Support',
    description: 'Exams, grades and expectations. Study breaks welcome.',
    baseMembers: 1653,
  },
  {
    id: 'social-anxiety',
    emoji: '\u{1FAC2}',
    name: 'Social Anxiety Support',
    description: 'A low-pressure space to share small wins and hard moments.',
    baseMembers: 942,
  },
  {
    id: 'emotional-wellbeing',
    emoji: '\u{1F331}',
    name: 'Emotional Wellbeing Group',
    description: 'Everyday ups and downs, and what helps.',
    baseMembers: 3015,
  },
];

export const COMMUNITY_NAME_MAX = 50;
export const COMMUNITY_DESCRIPTION_MAX = 140;

const joinedKey = () => `peer_communities_joined:${getActiveUid()}`;
const createdKey = () => `peer_communities_created:${getActiveUid()}`;

async function readJson<T>(k: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function memberCount(c: PeerCommunity, joined: boolean): number {
  return c.baseMembers + (joined ? 1 : 0);
}

export function formatMembers(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'member' : 'members'}`;
}

interface PeerCommunitiesState {
  joined: string[];
  created: PeerCommunity[];
  load: () => Promise<void>;
  join: (id: string) => Promise<void>;
  leave: (id: string) => Promise<void>;
  /** Creates a community owned by this account and joins it. Returns null when the name is empty. */
  createCommunity: (name: string, description: string) => Promise<PeerCommunity | null>;
}

export const usePeerCommunities = create<PeerCommunitiesState>((set, get) => ({
  joined: [],
  created: [],
  load: async () => {
    const [joined, created] = await Promise.all([
      readJson<string[]>(joinedKey(), []),
      readJson<PeerCommunity[]>(createdKey(), []),
    ]);
    set({ joined, created });
  },
  join: async (id) => {
    if (get().joined.includes(id)) return;
    const joined = [...get().joined, id];
    set({ joined });
    await AsyncStorage.setItem(joinedKey(), JSON.stringify(joined)).catch(() => {});
  },
  leave: async (id) => {
    const joined = get().joined.filter((x) => x !== id);
    set({ joined });
    await AsyncStorage.setItem(joinedKey(), JSON.stringify(joined)).catch(() => {});
  },
  createCommunity: async (name, description) => {
    const n = name.trim().slice(0, COMMUNITY_NAME_MAX);
    if (!n) return null;
    const d = description.trim().slice(0, COMMUNITY_DESCRIPTION_MAX);
    const community: PeerCommunity = {
      id: `mine-${Date.now()}`,
      name: n,
      description: d || undefined,
      baseMembers: 0,
      mine: true,
    };
    const created = [community, ...get().created];
    const joined = [...get().joined, community.id];
    set({ created, joined });
    await Promise.all([
      AsyncStorage.setItem(createdKey(), JSON.stringify(created)),
      AsyncStorage.setItem(joinedKey(), JSON.stringify(joined)),
    ]).catch(() => {});
    return community;
  },
}));
