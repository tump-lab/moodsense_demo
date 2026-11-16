/**
 * Each peer group's chat room, kept on this phone for now: your messages and the AI guide's. With
 * developer mode on, a labelled sample conversation is shown in place of the other members; it is
 * added at display time and never stored, so turning developer mode off removes it. Nothing here leaves the device
 * except the guide's request to the chat model (services/llm.ts).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { chatComplete } from '../../services/llm';
import { isAiLive } from '../../services/aiGateway';
import { getActiveUid } from '../../services/firebase';
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

/** How many earlier messages the guide sees when it answers. */
const GUIDE_CONTEXT_MESSAGES = 20;

export interface RoomMessage {
  id: string;
  uid: string;
  name: string;
  text: string;
  kind: 'member' | 'guide' | 'sample';
  ts: number;
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

/** Sample members (developer mode only), so the room shows what it will feel like. The screen labels them as samples. */
export const SAMPLE_MEMBERS = ['Kind Otter', 'Steady Cedar', 'Hopeful Fern'];

function sampleConversation(now: number): RoomMessage[] {
  const lines: [string, RoomMessage['kind'], string][] = [
    ['Kind Otter', 'sample', 'Rough week. Anyone else find Sunday nights the hardest?'],
    ['Steady Cedar', 'sample', 'Yes, every week. I started making a small plan for Monday morning so it feels less open-ended.'],
    ['Hopeful Fern', 'sample', '@Guide do you have any ideas for Sunday-night anxiety?'],
    [GUIDE_NAME, 'guide', "That is a really common one, Hopeful Fern. Steady Cedar's Monday plan is a great example; a short wind-down routine can help too. What has helped others here?"],
    ['Kind Otter', 'sample', 'Going for a walk before dinner helps me a bit. See everyone at the meeting!'],
  ];
  return lines.map(([name, kind, text], i) => ({
    id: `sample-${i}`,
    uid: kind === 'guide' ? 'guide' : `sample-${name}`,
    name,
    text,
    kind,
    ts: now - (lines.length - i) * 6 * 60_000,
  }));
}

/** Screenshot mode only: a fuller conversation, shown as ordinary members, for paper figures and demos. */
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

const key = (groupId: string) => `group_room:${getActiveUid()}:${groupId}`;

const isSample = (m: RoomMessage) => m.id.startsWith('sample-');

/** The room's real messages. Rooms saved before samples became developer-only had them stored; they are dropped here. */
export async function loadRoom(groupId: string): Promise<RoomMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(key(groupId));
    if (raw) return (JSON.parse(raw) as RoomMessage[]).filter((m) => !isSample(m));
  } catch {
    // A corrupt room starts over rather than blocking the screen.
  }
  return [];
}

/** What the screen shows: the samples (developer mode only) ahead of the real messages. */
export function withSamples(messages: RoomMessage[], showSamples: boolean, screenshot = false): RoomMessage[] {
  if (!showSamples) return messages;
  const firstTs = Math.min(messages[0]?.ts ?? Date.now(), Date.now());
  return [...(screenshot ? screenshotConversation(firstTs) : sampleConversation(firstTs)), ...messages];
}

export async function saveRoom(groupId: string, messages: RoomMessage[]): Promise<void> {
  const real = messages.filter((m) => !isSample(m)).slice(-200);
  await AsyncStorage.setItem(key(groupId), JSON.stringify(real)).catch(() => {});
}

/** Guide's greeting in an empty room, so it is clear who is here. Shown, never stored. */
export function guideWelcome(name: string): RoomMessage {
  return {
    id: 'welcome',
    uid: 'guide',
    name: GUIDE_NAME,
    text:
      `Hi ${name}, welcome. I am ${GUIDE_NAME}, an artificial intelligence that helps this group's members support each ` +
      `other between meetings. Say hello, or write @${GUIDE_NAME} if you would like me to answer.`,
    kind: 'guide',
    ts: Date.now(),
  };
}

export async function clearRoom(groupId: string): Promise<void> {
  await AsyncStorage.removeItem(key(groupId)).catch(() => {});
}

export function newMessage(text: string): RoomMessage {
  const uid = getActiveUid();
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    uid,
    name: pseudonymFor(uid),
    text: text.trim().slice(0, MAX_MESSAGE_LENGTH),
    kind: 'member',
    ts: Date.now(),
  };
}

export function crisisReply(name: string): string {
  return (
    `${name}, thank you for telling us. I am an artificial intelligence and cannot help in an emergency, but people can, right now: ` +
    'call or text 988 (Suicide & Crisis Lifeline), or call 911 if you are in immediate danger. ' +
    'Outside the United States, findahelpline.com lists a line near you. You are not alone in this room.'
  );
}

function guideSystemPrompt(group: RoomSubject): string {
  return `You are ${GUIDE_NAME}, an AI facilitator in the chat room of the "${group.name}" peer support group (${group.about}) in the MoodSense app.
The room is for the members to support each other between meetings. Your job is to help that happen, not to replace it.
- Reply in English, in 1-3 short sentences. Plain text only: no markdown, no lists.
- Answer the member who addressed you by name. Be warm and non-judgmental.
- Where it fits, turn the conversation back to the group (invite others to share what has helped them).
- You are NOT a clinician: never diagnose, never give medical or medication advice.
- If anyone mentions self-harm, suicide, or being unsafe, point them to 988 (call or text) or 911 in an emergency.
- Members appear under pseudonyms; use them.`;
}

/** Used when no model is reachable: the companion's canned replies speak to one person, these to a group. */
const OFFLINE_GUIDE_REPLIES = [
  (name: string) => `Thanks for asking, ${name}. That is something a lot of people here have wrestled with. What has helped others in the group?`,
  (name: string) => `Good question, ${name}. Small steps often help more than big plans. Has anyone here found one that works for them?`,
  (name: string) => `${name}, you are not the only one with that question. It could be a good one to bring to the next meeting too. Anyone want to share what is worked?`,
];

function offlineGuideReply(name: string): string {
  return OFFLINE_GUIDE_REPLIES[Math.floor(Math.random() * OFFLINE_GUIDE_REPLIES.length)]!(name);
}

export async function guideReply(group: RoomSubject, history: RoomMessage[], latest: RoomMessage): Promise<RoomMessage> {
  if (!isAiLive('chat')) {
    await new Promise((r) => setTimeout(r, 600));
    return { id: `guide-${Date.now()}`, uid: 'guide', name: GUIDE_NAME, text: offlineGuideReply(latest.name), kind: 'guide', ts: Date.now() };
  }
  const recent = history.slice(-GUIDE_CONTEXT_MESSAGES);
  const transcript = recent.map((m) => `${m.name}: ${m.text}`).join('\n');
  let text: string;
  try {
    text = await chatComplete([
      { role: 'system', content: guideSystemPrompt(group) },
      {
        role: 'user',
        content: `Recent messages in the room, oldest first:\n${transcript}\n\nReply as ${GUIDE_NAME} to ${latest.name}'s latest message.`,
      },
    ]);
  } catch (err) {
    console.warn('Guide could not answer:', err);
    text = offlineGuideReply(latest.name);
  }
  return { id: `guide-${Date.now()}`, uid: 'guide', name: GUIDE_NAME, text, kind: 'guide', ts: Date.now() };
}

export function guideCrisisMessage(latest: RoomMessage): RoomMessage {
  return { id: `guide-${Date.now()}`, uid: 'guide', name: GUIDE_NAME, text: crisisReply(latest.name), kind: 'guide', ts: Date.now() };
}
