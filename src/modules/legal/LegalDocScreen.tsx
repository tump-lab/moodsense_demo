/**
 * Shared plain-text renderer for a legal document — no cards, rows, or
 * icons, same treatment as ../consent/ConsentDetailScreen.tsx, so Terms of
 * Service and Privacy Policy read like documents rather than app UI.
 *
 * Used by TermsScreen.tsx and PrivacyPolicyScreen.tsx, which just supply the
 * text; the screen title itself comes from each route's `options.title` in
 * src/navigation/index.tsx, same as ConsentDetailScreen's "Research Consent"
 * title.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { colors, spacing, type } from '../../theme';

export default function LegalDocScreen({ text }: { text: string }) {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.text} selectable>
        {text}
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
