/**
 * Private safety sheet for the group chat: shown only to the member whose message the safety screen
 * flagged (guideRules.ts). A message the keyword rules flag is held back from the room (GroupRoomScreen),
 * and nothing about the sheet is posted either, so no one is singled out in front of the group.
 * The copy steps up with the level; the crisis buttons and styling match SupportPromptModal so the
 * app's support surfaces read as one system.
 */
import React from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, type } from '../../theme';
import { useCrisisResource } from '../phq4/useCrisisResource';
import type { RiskLevel } from './guideRules';

const COPY: Record<1 | 2 | 3, { title: string; body: string }> = {
  1: {
    title: 'Checking in on you',
    body: 'It sounds like things feel really heavy right now. You do not have to carry that alone. If it would help to talk with someone, support is free, confidential, and open day or night.',
  },
  2: {
    title: 'You deserve support right now',
    body: 'What you shared matters, and thoughts like these are worth talking through with someone trained to help. You can reach a crisis counselor right now, any time of day.',
  },
  3: {
    title: 'Please reach out now',
    body: 'Your safety comes first. Please contact a crisis line now. If you are in immediate danger or might act on these thoughts, call your local emergency number.',
  },
};

export interface GroupSafetySheetProps {
  level: RiskLevel;
  onClose: () => void;
}

export default function GroupSafetySheet({ level, onClose }: GroupSafetySheetProps) {
  const crisis = useCrisisResource();
  if (level === 0) return null;
  const copy = COPY[level];
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">
            {copy.title}
          </Text>
          <Text style={styles.body}>{copy.body}</Text>
          <Text style={styles.body}>{crisis.inlineLine}</Text>
          <Text style={styles.disclaimer}>Only you can see this.</Text>

          <View style={styles.actions}>
            {crisis.phone && crisis.telHref && crisis.smsHref ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Call ${crisis.label}`}
                  onPress={() => void Linking.openURL(crisis.telHref!)}
                  style={styles.action}
                >
                  <Text style={styles.actionText}>Call {crisis.phone}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Text ${crisis.label}`}
                  onPress={() => void Linking.openURL(crisis.smsHref!)}
                  style={[styles.action, styles.actionGhost]}
                >
                  <Text style={[styles.actionText, styles.actionGhostText]}>Text {crisis.phone}</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                accessibilityRole="link"
                onPress={() => void Linking.openURL(crisis.directoryUrl!)}
                style={styles.action}
              >
                <Text style={styles.actionText}>Find A Local Helpline</Text>
              </Pressable>
            )}
          </View>

          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8} style={styles.dismiss}>
            <Text style={styles.dismissText}>Back to the group</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(58, 50, 43, 0.45)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: {
    ...type.title,
    color: colors.ink,
  },
  body: {
    ...type.body,
    color: colors.ink,
    lineHeight: 22,
  },
  disclaimer: {
    ...type.sub,
    color: colors.ink3,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  action: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.rose,
  },
  actionGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.rose,
  },
  actionText: {
    ...type.body,
    fontWeight: '600',
    color: colors.surface,
  },
  actionGhostText: {
    color: colors.rose,
  },
  dismiss: {
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  dismissText: {
    ...type.body,
    color: colors.ink2,
  },
});
