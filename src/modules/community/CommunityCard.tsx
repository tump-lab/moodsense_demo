/**
 * One card layout for every group on the Community tab, peer or official: an icon tile, then name,
 * a short description and detail lines, pill actions stacked on the right. Every pill is the same width so
 * the buttons line up from card to card.
 */
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../../components';
import { colors, radius, spacing, type } from '../../theme';

export interface CommunityCardAction {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** `solid` is the green call to action; `soft` marks a done state such as Joined. */
  variant: 'solid' | 'soft';
  /** Leave out for a label that is not a button. */
  onPress?: () => void;
  accessibilityLabel: string;
  /** A small tappable reminder pinned to the button's corner, e.g. "call to confirm". */
  badge?: {
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    accessibilityLabel: string;
  };
}

export interface CommunityCardProps {
  /** The organizer's own logo; takes the place of the emoji when given. */
  logo?: ImageSourcePropType;
  /** One emoji, shown in a soft tile at the front of the card. */
  emoji?: string;
  name: string;
  about?: string;
  meta: readonly string[];
  /** Usually one; a joined official group shows Joined above Chat. */
  actions: readonly CommunityCardAction[];
}

const ACTION_WIDTH = 104;

function ActionPill({ action }: { action: CommunityCardAction }) {
  const soft = action.variant === 'soft';
  const tint = soft ? colors.primaryDeep : colors.onPrimary;
  const content = (
    <>
      {action.icon && <Ionicons name={action.icon} size={14} color={tint} />}
      <Text style={[styles.actionText, { color: tint }]}>{action.label}</Text>
    </>
  );
  return (
    <View>
      {action.onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel}
          onPress={action.onPress}
          style={({ pressed }) => [styles.action, soft && styles.actionSoft, pressed && styles.pressed]}
        >
          {content}
        </Pressable>
      ) : (
        <View style={[styles.action, soft && styles.actionSoft]} accessibilityLabel={action.accessibilityLabel}>
          {content}
        </View>
      )}
      {action.badge && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.badge.accessibilityLabel}
          onPress={action.badge.onPress}
          hitSlop={8}
          style={({ pressed }) => [styles.badge, pressed && styles.pressed]}
        >
          <Ionicons name={action.badge.icon} size={11} color={colors.onPrimary} />
        </Pressable>
      )}
    </View>
  );
}

export default function CommunityCard({ logo, emoji, name, about, meta, actions }: CommunityCardProps) {
  return (
    <Card style={styles.card}>
      {logo ? (
        <View style={[styles.iconTile, styles.logoTile]} importantForAccessibility="no-hide-descendants">
          <Image source={logo} style={styles.logo} resizeMode="contain" />
        </View>
      ) : emoji ? (
        <View style={styles.iconTile} importantForAccessibility="no-hide-descendants">
          <Text style={styles.emoji}>{emoji}</Text>
        </View>
      ) : null}
      <View style={styles.text}>
        <Text style={styles.name}>{name}</Text>
        {about ? <Text style={styles.about}>{about}</Text> : null}
        {meta.map((m) => (
          <Text key={m} style={styles.meta}>
            {m}
          </Text>
        ))}
      </View>
      <View style={styles.actions}>
        {actions.map((a) => (
          <ActionPill key={a.label} action={a} />
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  logoTile: { backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, overflow: 'hidden' },
  logo: { width: 34, height: 34 },
  emoji: { fontSize: 22 },
  text: { flex: 1, gap: 2 },
  name: { ...type.body, fontWeight: '700', color: colors.ink },
  about: { ...type.sub, color: colors.ink2 },
  meta: { ...type.caption, color: colors.ink3 },
  actions: { gap: spacing.sm },
  action: {
    width: ACTION_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  actionSoft: { backgroundColor: colors.primarySoft },
  actionText: { ...type.sub, fontWeight: '700' },
  badge: {
    position: 'absolute',
    top: -7,
    right: -7,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.amber,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  pressed: { opacity: 0.7 },
});
