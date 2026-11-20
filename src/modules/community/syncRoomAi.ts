/** Keeps the `ai` flag on this account's group-room memberships in step with the "Use AI" setting (see groupRoom.ts). */
import { syncRoomAiFlag } from './groupRoom';
import { useJoinedGroups } from './joinedGroups';
import { usePeerCommunities } from './peerCommunities';

export async function syncJoinedRoomsAiFlag(ai: boolean): Promise<void> {
  await Promise.all([useJoinedGroups.getState().load(), usePeerCommunities.getState().load()]);
  const ids = [...new Set([...useJoinedGroups.getState().ids, ...usePeerCommunities.getState().joined])];
  await syncRoomAiFlag(ids, ai);
}
