import { Firestore } from './firestore';
import { getAccessToken } from './google';
import type { Env } from './types';

/** Group-room data and device event logs are found by their `uid` field, so only docs under these parents count. */
function underCollection(docName: string, collection: string): boolean {
  const parts = docName.split('/');
  return parts[parts.length - 4] === collection;
}

async function deleteVoiceNotes(env: Env, uid: string): Promise<void> {
  const auth = { authorization: `Bearer ${await getAccessToken(env)}` };
  const bucket = encodeURIComponent(env.FIREBASE_STORAGE_BUCKET);
  let pageToken: string | undefined;
  do {
    const url = new URL(`https://storage.googleapis.com/storage/v1/b/${bucket}/o`);
    url.searchParams.set('prefix', `users/${uid}/voice_notes/`);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, { headers: auth });
    if (!res.ok) throw new Error(`Storage list failed (${res.status})`);
    const page = (await res.json()) as { items?: { name: string }[]; nextPageToken?: string };
    for (const item of page.items ?? []) {
      const del = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(item.name)}`, {
        method: 'DELETE',
        headers: auth,
      });
      if (!del.ok && del.status !== 404) throw new Error(`Storage delete failed (${del.status})`);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
}

/**
 * Deletes everything stored remotely for `uid` (never a client-supplied value): users/{uid} and all its subcollections,
 * the sensing/logs event docs carrying the uid, the user's group-room messages and memberships, and old voice-note files.
 * community_agg is left alone: it holds per-mood counts with no per-user link.
 */
export async function withdrawAndDeleteRemoteData(env: Env, uid: string): Promise<void> {
  const fs = new Firestore(env);
  await fs.deleteTree(`users/${uid}`);

  const value = { stringValue: uid };
  const [events, messages, members] = await Promise.all([
    fs.queryGroup('events', 'uid', 'EQUAL', value),
    fs.queryGroup('messages', 'uid', 'EQUAL', value),
    fs.queryGroup('members', 'uid', 'EQUAL', value),
  ]);
  await fs.deleteDocs([
    ...events.filter((d) => underCollection(d.name, 'sensing') || underCollection(d.name, 'logs')),
    ...[...messages, ...members].filter((d) => underCollection(d.name, 'group_rooms')),
  ].map((d) => d.name));
  // Each removed membership leaves its room's memberCount (shown on group cards) one lower.
  const rooms = members
    .filter((d) => underCollection(d.name, 'group_rooms'))
    .map((d) => d.name.slice(0, d.name.lastIndexOf('/members/')));
  await fs.incrementFields(rooms, 'memberCount', -1);

  await deleteVoiceNotes(env, uid);
}
