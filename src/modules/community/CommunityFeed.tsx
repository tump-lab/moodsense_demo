/**
 * Anonymous "how's everyone doing" view for the user's chosen community, built from
 * aggregate bucket counts only, drawn as a universe of planets with no coordinates. This renders as a
 * section of the Home tab, not a screen.
 */
import React, { memo, useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { SectionTitle } from '../../components';
import { colors, spacing, type } from '../../theme';
import type { RootStackParamList } from '../../navigation';
import MoodPlanet from './MoodPlanet';
import { communityLabel } from './communities';
import {
  getChosenCommunity,
  peekChosenCommunity,
  syncChosenCommunityFromCloud,
} from './store';
import { getNearbyMoods, type MoodBucket } from './aggregate';
import { isDevModeEnabled } from '../settings/devMode';

function sameBuckets(a: readonly MoodBucket[], b: readonly MoodBucket[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}

export default memo(function CommunityFeed({
  onPlanetDrag,
  planetVisible = true,
}: {
  onPlanetDrag?: (dragging: boolean) => void;
  /** Passed through to MoodPlanet, which stops drawing while it is scrolled out of view. */
  planetVisible?: boolean;
}) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [buckets, setBuckets] = useState<MoodBucket[]>([]);
  // Seeded from the session cache, so re-opening Community draws the right city on the first frame
  // instead of the neutral fallback. `undefined` only on the very first open after a cold start.
  const [myCommunity, setMyCommunity] = useState<string | null | undefined>(peekChosenCommunity);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        try {
          // Local read only — fast enough that the panel paints once, with the right art.
          const communityId = await getChosenCommunity();
          if (cancelled) return;
          setMyCommunity(communityId);

          // A choice made on another device arrives behind the first paint. It almost never
          // differs, so correcting the panel afterwards is cheaper than making every open wait
          // on Firestore.
          void syncChosenCommunityFromCloud().then((synced) => {
            if (!cancelled && synced !== communityId) setMyCommunity(synced);
          });

          if (communityId == null && !(await isDevModeEnabled())) {
            if (cancelled) return;
            setBuckets((cur) => (cur.length === 0 ? cur : []));
            return;
          }
          const nearby = await getNearbyMoods(communityId ?? '');
          if (cancelled) return;
          // Same counts as last time: keep the old array so the planet does not redraw on every tab switch.
          setBuckets((cur) => (sameBuckets(cur, nearby) ? cur : nearby));
        } catch {
          if (!cancelled) setBuckets((cur) => (cur.length === 0 ? cur : []));
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  return (
    <View style={styles.feed}>
      <View style={styles.head}>
        <SectionTitle
          style={styles.headTitle}
          action={
            <Pressable
              onPress={() => navigation.navigate('ChooseCommunity')}
              hitSlop={8}
            >
              <Text style={styles.changeLink}>
                {myCommunity != null ? 'Change' : 'Choose'}
              </Text>
            </Pressable>
          }
        >
          Your Community
        </SectionTitle>
        <Text style={styles.communityLabel}>
          {myCommunity === undefined
            ? ' '
            : myCommunity != null
              ? (communityLabel(myCommunity) ?? myCommunity)
              : 'Pick A Community'}
        </Text>
      </View>

      <MoodPlanet buckets={buckets} onDragChange={onPlanetDrag} visible={planetVisible} />
    </View>
  );
});

const styles = StyleSheet.create({
  feed: {
    gap: spacing.md,
  },
  head: {
    gap: spacing.xs,
  },
  // The shared SectionTitle owns the vertical rhythm between sections; here the
  // community line sits directly under it, so its own margins are dropped.
  headTitle: {
    marginTop: 0,
    marginBottom: 0,
  },
  communityLabel: {
    ...type.sub,
    color: colors.ink2,
  },
  changeLink: {
    ...type.caption,
    color: colors.indigo,
    fontWeight: '700',
    marginLeft: spacing.sm,
  },
});
