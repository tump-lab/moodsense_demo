/** The bottom sheet for Recharge suggestions that are not a player: a tip to try, or a prompt to write to. */
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppButton } from '../../components';
import { colors, radius, spacing, type } from '../../theme';
import { logEvent } from '../../services/logging';
import type { RechargeItem } from './recommendations';
import { saveReflection } from './reflections';

export default function RechargeSheet({
  item,
  onClose,
}: {
  item: RechargeItem | null;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setText('');
    setSaving(false);
  }, [item]);

  if (!item || (item.action.kind !== 'tip' && item.action.kind !== 'reflect')) return null;
  const action = item.action;

  const done = async () => {
    if (action.kind === 'reflect') {
      if (!text.trim()) return;
      setSaving(true);
      await saveReflection(item.id, action.prompt, text).catch((err: unknown) =>
        console.warn('Reflection failed to save:', err)
      );
    } else {
      void logEvent('recharge_tip_done', { itemId: item.id }).catch(() => {});
    }
    onClose();
  };

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.head}>
            <Text style={styles.emoji}>{item.emoji}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.ink3} />
            </Pressable>
          </View>
          <Text style={styles.title} accessibilityRole="header">
            {item.title}
          </Text>
          {action.kind === 'tip' ? (
            <Text style={styles.body}>{action.body}</Text>
          ) : (
            <>
              <Text style={styles.body}>{action.prompt}</Text>
              <TextInput
                style={styles.input}
                value={text}
                onChangeText={setText}
                placeholder="Write here"
                placeholderTextColor={colors.ink3}
                multiline
                maxLength={1000}
                autoFocus
              />
              <Text style={styles.note}>Saved only on this phone.</Text>
            </>
          )}
          <AppButton
            title={action.kind === 'tip' ? "I'll Try It" : 'Save'}
            disabled={action.kind === 'reflect' && !text.trim()}
            loading={saving}
            onPress={() => void done()}
            style={styles.button}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(58, 50, 43, 0.45)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  emoji: { fontSize: 32 },
  title: { ...type.h2, color: colors.ink },
  body: { ...type.body, color: colors.ink2, lineHeight: 22 },
  input: {
    ...type.body,
    color: colors.ink,
    minHeight: 110,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  note: { ...type.caption, color: colors.ink3 },
  button: { marginTop: spacing.md },
});
