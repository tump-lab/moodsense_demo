/**
 * Each peer group's chat room, shared by everyone who joined the group in MoodSense.
 * Lives in Firestore under group_rooms/{groupId}, with `members/{uid}` and `messages/{id}`
 * (see firestore.rules). Members appear under a pseudonym made from their account id, never their name.
 *
 * Guide, the AI member, answers when someone writes @Guide. Its replies are written server-side by the
 * Worker's /group-guide route (worker/src/groupGuide.ts); clients cannot post as Guide. Each member doc
 * carries `ai`, mirroring that member's "Use AI" setting: Guide only answers members with it on, and
 * only messages from members with it on are sent to the model as context.
 */
import {
  addDoc,
  collection,
  doc,
  getDoc,
  increment,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore';
import { chatComplete } from '../../services/llm';
import { isAiLive } from '../../services/aiGateway';
import { apiPost } from '../../services/api';
import { ensureSignedIn, getActiveUid, getDb } from '../../services/firebase';
import { buildRiskScreenMessages, GUIDE_NAME, parseRiskLevel, type RiskLevel } from './guideRules';

/** What the guide needs to know about the room it is in — an official PeerGroup or a user-created PeerCommunity, either one. */
export interface RoomSubject {
  name: string;
  about: string;
}

export { GUIDE_NAME, guideActionFor, mentionsGuide, matchesCrisisRules, combineRisk, type RiskLevel } from './guideRules';

const RISK_SCREEN_TIMEOUT_MS = 10000;

/**
 * LLM layer of the group-chat safety screen (see guideRules.ts). Null when hosted AI is off, the call
 * fails or times out, or the reply has no usable level; the keyword rules still apply in every case.
 */
export async function screenMessageRisk(text: string): Promise<RiskLevel | null> {
  if (!isAiLive('chat')) return null;
  try {
    const raw = await Promise.race([
      chatComplete(buildRiskScreenMessages(text)),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('risk screen timed out')), RISK_SCREEN_TIMEOUT_MS)),
    ]);
    return parseRiskLevel(raw);
  } catch (err) {
    console.warn('Risk screen unavailable:', err);
    return null;
  }
}

export const MAX_MESSAGE_LENGTH = 1000;

/** How many recent messages the room shows. */
const SHOWN_MESSAGES = 200;

const GUIDE_TIMEOUT_MS = 35_000;

export interface RoomMessage {
  id: string;
  uid: string;
  name: string;
  text: string;
  kind: 'member' | 'guide' | 'sample';
  ts: number;
}

export interface RoomMember {
  uid: string;
  name: string;
  /** This member's "Use AI" setting. */
  ai: boolean;
}

const ADJECTIVES = ['Quiet', 'Gentle', 'Bright', 'Steady', 'Kind', 'Calm', 'Brave', 'Warm', 'Hopeful', 'Patient', 'Curious', 'Sunny'];
const NOUNS = ['Maple', 'River', 'Sparrow', 'Willow', 'Harbor', 'Meadow', 'Cedar', 'Lantern', 'Otter', 'Pebble', 'Fern', 'Comet'];

/** The same account gets the same name in every room. */
export function pseudonymFor(uid: string): string {
  let h = 2166136261;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `${ADJECTIVES[h % ADJECTIVES.length]} ${NOUNS[Math.floor(h / ADJECTIVES.length) % NOUNS.length]}`;
}

export function myUid(): string {
  return getActiveUid();
}

/** Screenshot mode only: a fuller conversation, shown as ordinary members, for paper figures and demos. Never stored. */
const ME = '\u0000me';

function screenshotConversation(now: number): RoomMessage[] {
  const lines: [string, RoomMessage['kind'], string][] = [
    ['Kind Otter', 'member', 'Rough week. Anyone else find Sunday nights the hardest?'],
    ['Steady Cedar', 'member', 'Yes, every week. I started writing a small plan for Monday morning so it feels less open-ended.'],
    ['Bright Sparrow', 'member', 'Same here. Deadlines pile up and I end up scrolling until 1am.'],
    [ME, 'member', "Glad it's not just me. Sunday evenings are when I feel it most."],
    ['Hopeful Fern', 'member', '@Guide any ideas for Sunday-night anxiety?'],
    [GUIDE_NAME, 'guide', "That's a really common one, Hopeful Fern. Steady Cedar's Monday plan is a great example, and a short wind-down routine away from screens can help too. What has helped others here?"],
    ['Kind Otter', 'member', 'A walk before dinner helps me. Leaving my phone in another room helps more.'],
    ['Bright Sparrow', 'member', "Going to try the phone thing tonight. Thanks, everyone."],
    ['Steady Cedar', 'member', 'See you all at Tuesday\'s meeting!'],
  ];
  const gaps = [0, 4, 9, 12, 15, 16, 23, 31, 38];
  const start = now - 45 * 60_000;
  const me = myUid();
  return lines.map(([name, kind, text], i) => ({
    id: `sample-shot-${i}`,
    uid: kind === 'guide' ? 'guide' : name === ME ? me : `sample-${name}`,
    name: name === ME ? pseudonymFor(me) : name,
    text,
    kind,
    ts: start + gaps[i]! * 60_000,
  }));
}

/** What the screen shows: in screenshot mode, the demo conversation ahead of the real messages. */
export function withScreenshotSamples(messages: RoomMessage[], screenshot: boolean): RoomMessage[] {
  if (!screenshot) return messages;
  const firstTs = Math.min(messages[0]?.ts ?? Date.now(), Date.now());
  return [...screenshotConversation(firstTs), ...messages];
}

/** Guide's greeting in an empty room, so it is clear who is here. Shown, never stored. */
export function guideWelcome(name: string, aiOn: boolean): RoomMessage {
  return {
    id: 'welcome',
    uid: 'guide',
    name: GUIDE_NAME,
    text: aiOn
      ? `Hi ${name}, welcome. I am ${GUIDE_NAME}, an artificial intelligence that helps this group's members support each ` +
        `other between meetings. Say hello, or write @${GUIDE_NAME} if you would like me to answer.`
      : `Hi ${name}, welcome. Say hello to the group. I am ${GUIDE_NAME}, an artificial intelligence; I can answer you ` +
        `once "Use AI" is on in Settings.`,
    kind: 'guide',
    ts: Date.now(),
  };
}

export function isRoomAvailable(): boolean {
  return getDb() != null;
}

function roomRef(groupId: string) {
  const db = getDb();
  if (!db) throw new Error('Firestore is not configured');
  return doc(db, 'group_rooms', groupId);
}

/**
 * Adds this account to the room (creating the room on first join) and records its "Use AI" setting.
 * Safe to call again: it refreshes the member doc. Returns the uid it joined as.
 */
export async function joinRoom(groupId: string, subject: RoomSubject, ai: boolean): Promise<string> {
  const user = await ensureSignedIn();
  if (!user) throw new Error('Not signed in');
  const db = getDb()!;
  const room = roomRef(groupId);
  const member = doc(room, 'members', user.uid);
  const data = { uid: user.uid, name: pseudonymFor(user.uid), ai, joinedAt: serverTimestamp() };

  // Rules only let a member read the member list, so a refused read means "not a member yet".
  const already = await getDoc(member).then((s) => s.exists(), () => false);
  if (already) {
    await setDoc(member, data);
    return user.uid;
  }

  // A new member and the room's memberCount move together in one batch (firestore.rules checks both).
  const attempt = async () => {
    const roomSnap = await getDoc(room);
    const batch = writeBatch(db);
    if (roomSnap.exists()) batch.update(room, { memberCount: increment(1) });
    else batch.set(room, { name: subject.name.slice(0, 120), about: subject.about.slice(0, 300), memberCount: 1 });
    batch.set(member, data);
    await batch.commit();
  };
  try {
    await attempt();
  } catch (err) {
    // Someone else may have created the room a moment earlier; try once more as a join.
    console.warn('Retrying group room join:', err);
    await attempt();
  }
  return user.uid;
}

/** Joins without waiting, for join buttons outside the room. */
export function joinRoomInBackground(groupId: string, subject: RoomSubject, ai: boolean): void {
  if (!isRoomAvailable()) return;
  joinRoom(groupId, subject, ai).catch((err) => console.warn('Could not join group room:', err));
}

/** Removes this account from the room. Its earlier messages stay, as in any group chat. */
export async function leaveRoom(groupId: string): Promise<void> {
  if (!isRoomAvailable()) return;
  const user = await ensureSignedIn();
  if (!user) return;
  const room = roomRef(groupId);
  const member = doc(room, 'members', user.uid);
  const isMember = await getDoc(member).then((s) => s.exists(), () => false);
  if (!isMember) return;
  const batch = writeBatch(getDb()!);
  batch.delete(member);
  batch.update(room, { memberCount: increment(-1) });
  await batch.commit();
}

/** Live member counts for these rooms, keyed by group id. A room nobody has joined yet counts 0. */
export function subscribeMemberCounts(groupIds: string[], onChange: (counts: Record<string, number>) => void): () => void {
  if (!isRoomAvailable() || groupIds.length === 0) return () => {};
  const counts: Record<string, number> = {};
  let unsubs: (() => void)[] = [];
  let cancelled = false;
  void ensureSignedIn().then((user) => {
    if (cancelled || !user) return;
    unsubs = groupIds.map((id) =>
      onSnapshot(
        roomRef(id),
        (snap) => {
          const n = snap.exists() ? Number(snap.data().memberCount ?? 0) : 0;
          counts[id] = Math.max(0, Number.isFinite(n) ? n : 0);
          onChange({ ...counts });
        },
        (err) => console.warn('Member count listener failed:', err)
      )
    );
  });
  return () => {
    cancelled = true;
    unsubs.forEach((u) => u());
  };
}

/** Updates the `ai` flag in each of these rooms this account belongs to (rooms it is not in are skipped). */
export async function syncRoomAiFlag(groupIds: string[], ai: boolean): Promise<void> {
  if (!isRoomAvailable() || groupIds.length === 0) return;
  const user = await ensureSignedIn();
  if (!user) return;
  await Promise.all(
    groupIds.map((id) =>
      updateDoc(doc(roomRef(id), 'members', user.uid), { uid: user.uid, name: pseudonymFor(user.uid), ai, joinedAt: serverTimestamp() }).catch(
        () => undefined
      )
    )
  );
}

function tsOf(v: unknown): number {
  return (v as Timestamp | null)?.toMillis?.() ?? Date.now();
}

export function subscribeMessages(groupId: string, onChange: (m: RoomMessage[]) => void, onError: (e: Error) => void): () => void {
  const q = query(collection(roomRef(groupId), 'messages'), orderBy('ts'), limitToLast(SHOWN_MESSAGES));
  return onSnapshot(
    q,
    (snap) =>
      onChange(
        snap.docs.map((d) => {
          const data = d.data({ serverTimestamps: 'estimate' });
          return {
            id: d.id,
            uid: String(data.uid ?? ''),
            name: String(data.name ?? ''),
            text: String(data.text ?? ''),
            kind: data.kind === 'guide' ? 'guide' : 'member',
            ts: tsOf(data.ts),
          };
        })
      ),
    onError
  );
}

export function subscribeMembers(groupId: string, onChange: (m: RoomMember[]) => void, onError: (e: Error) => void): () => void {
  return onSnapshot(
    collection(roomRef(groupId), 'members'),
    (snap) =>
      onChange(
        snap.docs.map((d) => {
          const data = d.data();
          return { uid: d.id, name: String(data.name ?? pseudonymFor(d.id)), ai: data.ai === true };
        })
      ),
    onError
  );
}

/** Posts a message as this account. Returns its id. */
export async function sendRoomMessage(groupId: string, text: string): Promise<string> {
  const user = await ensureSignedIn();
  if (!user) throw new Error('Not signed in');
  const ref = await addDoc(collection(roomRef(groupId), 'messages'), {
    uid: user.uid,
    name: pseudonymFor(user.uid),
    text: text.trim().slice(0, MAX_MESSAGE_LENGTH),
    kind: 'member',
    ts: serverTimestamp(),
  });
  return ref.id;
}

/** Asks the Worker to have Guide answer this account's message. Guide's reply arrives through subscribeMessages. */
export async function requestGuideReply(groupId: string, messageId: string): Promise<void> {
  await apiPost('/group-guide', { groupId, messageId }, GUIDE_TIMEOUT_MS);
}
