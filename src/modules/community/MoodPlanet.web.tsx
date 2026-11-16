/** The web build has no Skia runtime loaded, so the Community panel falls back to the plain counts. */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, type } from '../../theme';
import type { MoodBucket } from './aggregate';

export default function MoodPlanet({
  buckets,
}: {
  buckets: MoodBucket[];
  onDragChange?: (dragging: boolean) => void;
}) {
  return (
    <View style={styles.panel}>
      {buckets
        .filter((b) => b.count > 0)
        .map((b) => (
          <Text key={b.label} style={styles.line}>
            {b.count} {b.label}
          </Text>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.xs, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
  line: { ...type.sub, color: colors.ink2 },
});
