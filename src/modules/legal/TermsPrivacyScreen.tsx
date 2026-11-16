/**
 * One place for the three documents: Terms, Privacy and the consent text. Settings links here
 * with a single row instead of one row per document.
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, type } from '../../theme';
import { FULL_CONSENT_TEXT } from '../consent/consentText';
import { PRIVACY_POLICY_TEXT, TERMS_OF_SERVICE_TEXT } from './legalText';

const TABS = [
  { key: 'privacy', label: 'Privacy', text: PRIVACY_POLICY_TEXT },
  { key: 'terms', label: 'Terms', text: TERMS_OF_SERVICE_TEXT },
  { key: 'consent', label: 'Consent', text: FULL_CONSENT_TEXT },
] as const;

export default function TermsPrivacyScreen() {
  const [active, setActive] = useState<(typeof TABS)[number]['key']>('privacy');
  const tab = TABS.find((t) => t.key === active) ?? TABS[0];

  return (
    <View style={styles.root}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((t) => {
          const selected = t.key === active;
          return (
            <Pressable
              key={t.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setActive(t.key)}
              style={[styles.tab, selected && styles.tabSelected]}
            >
              <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.text} selectable>
          {tab.text}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  tabs: {
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.md,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
  },
  tabSelected: { backgroundColor: colors.primarySoft },
  tabText: { ...type.sub, color: colors.ink3, fontWeight: '600' },
  tabTextSelected: { color: colors.primaryDeep },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  text: { ...type.body, color: colors.ink, lineHeight: 22 },
});
