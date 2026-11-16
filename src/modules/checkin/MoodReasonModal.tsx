/**
 * The sheet that follows a mood tap: "what is behind this?" as multi-select tags plus Other with
 * free text. The check-in is already saved before this opens, so closing with the X loses nothing.
 */
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
import type { Mood } from './store';
import { MOOD_LABELS } from './moods';
import { OTHER_REASON_ID, reasonPrompt, reasonsForMood } from './moodReasons';

const OTHER_MAX = 120;

export interface MoodReasonModalProps {
  /** The mood just logged; null keeps the sheet closed. */
  mood: Mood | null;
  onClose: () => void;
  onSubmit: (reasons: string[], otherText: string | null) => void;
}

export default function MoodReasonModal({ mood, onClose, onSubmit }: MoodReasonModalProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState('');

  // A fresh sheet for every check-in.
  useEffect(() => {
    if (mood) {
      setPicked([]);
      setOther('');
    }
  }, [mood]);

  if (!mood) return null;

  const options = [...reasonsForMood(mood), { id: OTHER_REASON_ID, label: 'Other' }];
  const otherOn = picked.includes(OTHER_REASON_ID);
  const otherText = other.trim();
  const tint = colors.mood[mood];

  // Reasons are optional: Done with nothing picked just closes the sheet (the check-in is already saved).
  // "Other" with no text is dropped rather than saved as an empty reason.
  const reasons = picked.filter((id) => id !== OTHER_REASON_ID || otherText.length > 0);
  const done = () => {
    if (reasons.length === 0) onClose();
    else onSubmit(reasons, otherOn && otherText ? otherText : null);
  };

  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.head}>
            <View style={[styles.moodChip, { backgroundColor: tint.soft }]}>
              <Text style={[styles.moodChipText, { color: tint.deep }]}>{MOOD_LABELS[mood]}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              hitSlop={10}
            >
              <Ionicons name="close" size={22} color={colors.ink3} />
            </Pressable>
          </View>
          <Text style={styles.title} accessibilityRole="header">
            {reasonPrompt(mood)}
          </Text>
          <Text style={styles.sub}>Optional — pick any that apply.</Text>

          <View style={styles.tags}>
            {options.map((o) => {
              const on = picked.includes(o.id);
              return (
                <Pressable
                  key={o.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => toggle(o.id)}
                  style={[
                    styles.tag,
                    on && { backgroundColor: tint.soft, borderColor: tint.deep },
                  ]}
                >
                  <Text style={[styles.tagText, on && { color: tint.deep, fontWeight: '700' }]}>
                    {o.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {otherOn && (
            <TextInput
              style={styles.input}
              value={other}
              onChangeText={setOther}
              placeholder="Tell us in a few words"
              placeholderTextColor={colors.ink3}
              maxLength={OTHER_MAX}
              autoFocus
              returnKeyType="done"
            />
          )}

          <AppButton title={reasons.length === 0 ? 'Skip' : 'Done'} onPress={done} style={styles.done} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(58, 50, 43, 0.45)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  moodChip: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  moodChipText: { ...type.caption, fontWeight: '700' },
  title: { ...type.h2, color: colors.ink, marginTop: spacing.xs },
  sub: { ...type.sub, color: colors.ink3 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  tag: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
  },
  tagText: { ...type.sub, color: colors.ink2 },
  input: {
    ...type.body,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  done: { marginTop: spacing.md },
});
