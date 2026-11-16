/**
 * The level card on the You tab: a tree that grows with how steadily the person has been checking
 * in, and the level it is at. Kept to the tree, its name and one progress line — no stat readout.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from '../../components';
import { colors, radius, spacing, type } from '../../theme';
import type { CheckinRow } from '../../services/db';
import { dayKeysEnding } from '../checkin/wellbeingTrend';
import { GrowthTree } from './GrowthTree';
import {
  LEVEL_WINDOW_DAYS,
  MAX_LEVEL,
  computeLevelStats,
  nextTier,
  pointsToNext,
  progressToNext,
  tierForPoints,
} from './level';

export function GrowthCard({
  entries,
  streak,
}: {
  entries: CheckinRow[];
  streak: number;
}) {
  const stats = useMemo(
    () => computeLevelStats(entries, dayKeysEnding(new Date(), LEVEL_WINDOW_DAYS), streak),
    [entries, streak]
  );
  const tier = tierForPoints(stats.points);
  const next = nextTier(tier);
  const toNext = pointsToNext(stats.points);
  const progress = progressToNext(stats.points);

  const footer = next
    ? `${toNext} more to ${next.name}`
    : 'Fully grown. Keep it watered.';
  const tip = next
    ? 'Your tree grows every day you check in, however the day felt. A few days in a row helps it grow a little faster.'
    : null;

  return (
    <Card variant="white">
      {/* One label for the whole card: read out piecemeal, a tree drawing, a bare level number and
          a progress bar say nothing a screen reader can act on. */}
      <View
        accessible
        accessibilityLabel={`Your tree. Level ${tier.level} of ${MAX_LEVEL}, ${tier.name}. ${tier.blurb} ${footer}.${tip ? ` ${tip}` : ''}`}
      >
        <View style={styles.row}>
          <GrowthTree stage={tier.stage} size={96} />
          <View style={styles.body}>
            <Text style={styles.eyebrow}>
              Level {tier.level} of {MAX_LEVEL}
            </Text>
            <Text style={styles.name}>{tier.name}</Text>
            <Text style={styles.blurb}>{tier.blurb}</Text>
          </View>
        </View>

        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
        <Text style={styles.footer}>{footer}</Text>
        {tip && <Text style={styles.tip}>{tip}</Text>}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  body: {
    flex: 1,
  },
  eyebrow: {
    ...type.caption,
    color: colors.ink3,
    fontWeight: '700',
  },
  name: {
    ...type.title,
    color: colors.ink,
  },
  blurb: {
    ...type.sub,
    color: colors.ink2,
    marginTop: 2,
  },
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
    marginTop: spacing.md,
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  tip: {
    ...type.sub,
    color: colors.ink2,
    marginTop: spacing.sm,
  },
  footer: {
    ...type.caption,
    color: colors.ink3,
    marginTop: spacing.xs,
  },
});
