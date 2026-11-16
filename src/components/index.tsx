import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing, type } from '../theme';

export interface ScreenProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Defaults to top only; the tab bar handles the bottom. */
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}

export function Screen({ children, style, edges = ['top'] }: ScreenProps) {
  return (
    <SafeAreaView edges={edges} style={styles.screenSafe}>
      <View style={[styles.screenBody, style]}>{children}</View>
    </SafeAreaView>
  );
}

export interface CardProps {
  children?: React.ReactNode;
  variant?: 'plain' | 'white';
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}

export function Card({ children, variant = 'white', style, onPress }: CardProps) {
  const base = [styles.card, variant === 'white' ? styles.cardWhite : styles.cardPlain, style];
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [...base, pressed && styles.pressed]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={base}>{children}</View>;
}

export interface AppButtonProps {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function AppButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
}: AppButtonProps) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        isPrimary ? styles.buttonPrimary : styles.buttonGhost,
        (disabled || loading) && styles.buttonDisabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.onPrimary : colors.primaryDeep} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            { color: isPrimary ? colors.onPrimary : colors.primaryDeep },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export interface RowProps {
  icon?: React.ReactNode;
  iconBg?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Overrides what a screen reader announces for the whole row, for when the visible text is terse or carries its meaning in an emoji. */
  accessibilityLabel?: string;
}

export function Row({
  icon,
  iconBg,
  title,
  subtitle,
  right,
  onPress,
  style,
  accessibilityLabel,
}: RowProps) {
  const content = (
    <>
      {icon != null && (
        <View style={[styles.rowIconTile, { backgroundColor: iconBg ?? colors.surface2 }]}>
          {icon}
        </View>
      )}
      <View style={styles.rowTextWrap}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle != null && (
          <Text style={styles.rowSubtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        )}
      </View>
      {right != null && <View style={styles.rowRight}>{right}</View>}
    </>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [styles.row, pressed && styles.pressed, style]}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View style={[styles.row, style]} accessibilityLabel={accessibilityLabel}>
      {content}
    </View>
  );
}

export interface SectionTitleProps {
  children: React.ReactNode;
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function SectionTitle({ children, action, style }: SectionTitleProps) {
  return (
    <View style={[styles.sectionTitleWrap, style]}>
      <Text style={styles.sectionTitleText}>{children}</Text>
      {action != null && <View>{action}</View>}
    </View>
  );
}

export interface PillProps {
  label: string;
  color?: string;
  bg?: string;
  icon?: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function Pill({ label, color, bg, icon, onPress, style }: PillProps) {
  const body = (
    <>
      {icon}
      <Text style={[styles.pillText, { color: color ?? colors.ink2 }]}>{label}</Text>
    </>
  );
  const pillStyle = [styles.pill, { backgroundColor: bg ?? colors.surface2 }, style];
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [...pillStyle, pressed && styles.pressed]}>
        {body}
      </Pressable>
    );
  }
  return <View style={pillStyle}>{body}</View>;
}

// Shared "nothing here yet" block, factored out of InsightsScreen's Mood trend / Mood balance cards so empty states cannot drift apart visually.

export interface EmptyStateProps {
  illustration?: React.ReactNode;
  title?: string;
  message: string;
  /** Rendered as a soft ghost button on purpose, matching the app's no-guilt stance for empty states. */
  actionLabel?: string;
  onPressAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  illustration,
  title,
  message,
  actionLabel,
  onPressAction,
  style,
}: EmptyStateProps) {
  return (
    <View style={[styles.emptyState, style]}>
      {illustration != null && (
        <View style={styles.emptyStateIllustration}>{illustration}</View>
      )}
      {title != null && <Text style={styles.emptyStateTitle}>{title}</Text>}
      <Text style={styles.emptyStateMessage}>{message}</Text>
      {actionLabel != null && onPressAction != null && (
        <AppButton
          title={actionLabel}
          variant="ghost"
          onPress={onPressAction}
          style={styles.emptyStateAction}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screenSafe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  screenBody: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  card: {
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  cardWhite: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    shadowColor: colors.ink,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardPlain: {
    backgroundColor: colors.surface2,
  },
  button: {
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  buttonPrimary: {
    backgroundColor: colors.primary,
  },
  buttonGhost: {
    backgroundColor: colors.primarySoft,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    ...type.h2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  rowIconTile: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTextWrap: {
    flex: 1,
  },
  rowTitle: {
    ...type.body,
    fontWeight: '600',
    color: colors.ink,
  },
  rowSubtitle: {
    ...type.sub,
    color: colors.ink2,
    marginTop: 2,
  },
  rowRight: {
    marginLeft: spacing.sm,
    alignItems: 'flex-end',
  },
  sectionTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionTitleText: {
    ...type.caption,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    borderRadius: radius.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  pillText: {
    ...type.caption,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.7,
  },
  emptyState: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
  emptyStateIllustration: {
    width: '100%',
    marginBottom: spacing.sm,
  },
  emptyStateTitle: {
    ...type.h2,
    color: colors.ink2,
    textAlign: 'center',
  },
  emptyStateMessage: {
    ...type.sub,
    color: colors.ink3,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  emptyStateAction: {
    marginTop: spacing.md,
    alignSelf: 'center',
    minWidth: 140,
  },
});
