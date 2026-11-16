/**
 * The gentle support prompt: a card over Home after a long stretch of low check-ins.
 * Thresholds and copy live in supportPrompt.ts; the crisis details are shared with the
 * Mood Check result screen via phq4/supportResources.ts.
 *
 * The crisis buttons borrow the Mood Check result screen's rose accent so the two support
 * surfaces read as one system, while the sheet itself stays on the calm surface tone —
 * a fully tinted panel would read as an alarm, which this is not.
 */
import React from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, type } from '../../theme';
import { useCrisisResource } from '../phq4/useCrisisResource';
import { SUPPORT_PROMPT_COPY } from './supportPrompt';

export interface SupportPromptModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function SupportPromptModal({ visible, onClose }: SupportPromptModalProps) {
  const crisis = useCrisisResource();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* Tapping the backdrop, the X, or "Not right now" all close it. It is already marked shown
          when it opens, so closing it never brings it straight back. */}
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet} accessibilityViewIsModal>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            hitSlop={10}
            style={styles.close}
          >
            <Ionicons name="close" size={22} color={colors.ink3} />
          </Pressable>
          <Text style={styles.title} accessibilityRole="header">
            {SUPPORT_PROMPT_COPY.title}
          </Text>

          {SUPPORT_PROMPT_COPY.body(crisis.inlineLine).map((paragraph) => (
            <Text key={paragraph} style={styles.body}>
              {paragraph}
            </Text>
          ))}

          <Text style={styles.disclaimer}>{SUPPORT_PROMPT_COPY.disclaimer}</Text>

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
                  <Text style={[styles.actionText, styles.actionGhostText]}>
                    Text {crisis.phone}
                  </Text>
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

          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            hitSlop={8}
            style={styles.dismiss}
          >
            <Text style={styles.dismissText}>{SUPPORT_PROMPT_COPY.dismiss}</Text>
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
  close: { alignSelf: 'flex-end' },
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
