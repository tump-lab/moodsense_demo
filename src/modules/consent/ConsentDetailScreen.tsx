/**
 * Full research-consent text, shown as plain scrollable text so it reads like a document rather than app UI.
 * It is read-only; agreeing happens back on ConsentOnboardingScreen.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { colors, spacing, type } from '../../theme';
import { FULL_CONSENT_TEXT } from './consentText';

export default function ConsentDetailScreen() {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.text} selectable>
        {FULL_CONSENT_TEXT}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  text: {
    ...type.body,
    color: colors.ink,
    lineHeight: 22,
  },
});
