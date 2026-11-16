import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppButton, Card, Screen } from '../../components';
import { colors, radius, spacing, type } from '../../theme';
import type { RootStackParamList } from '../../navigation';
import { PHQ4_OPTIONS, PHQ4_QUESTIONS, PHQ4_STEM } from './questions';
import type { Phq4Score } from './scoring';
import { savePhq4Result } from './save';
import { useCrisisResource } from './useCrisisResource';

const SEVERITY_LABELS: Record<Phq4Score['severity'], string> = {
  none: 'None to minimal',
  mild: 'Mild',
  moderate: 'Moderate',
  severe: 'Severe',
};

/**
 * What the band means, in the words the result now leads with.
 *
 * The result used to open on "4 / 12" in 44-point type. Two problems with that, both raised by
 * testers. A denominator of 12 over four questions names the instrument outright, and a participant
 * who looks up PHQ-4 is reading a clinical cutoff table about themselves on the strength of four
 * taps. And a number that large and that central reads as a verdict — people compared this week's to
 * last week's and treated a one-point move as news, which is more than four items about two weeks
 * can carry.
 *
 * So the band leads and the arithmetic is gone from the screen. Nothing is hidden: the total and
 * both subscales are still scored, still saved, and still what the study analyses and what the
 * support policy reads (see ./supportResources.ts) — this is the presentation, not the record.
 */
const SEVERITY_BLURBS: Record<Phq4Score['severity'], string> = {
  none: "These past two weeks seem to have been fairly light. Checking in anyway is a good habit \u2014 it is how the quieter changes become visible.",
  mild: 'These past two weeks have had some weight to them. That is common, and it often eases on its own. Noticing it is worth something either way.',
  moderate:
    'These past two weeks sound like a lot to carry. If it has been sitting with you, talking it over with someone you trust, or a professional, can help.',
  severe:
    "These past two weeks sound really hard. You do not have to carry it alone. Talking with someone you trust, or a professional, can help.",
};

const SEVERITY_COLORS: Record<Phq4Score['severity'], string> = {
  none: colors.teal,
  mild: colors.primary,
  moderate: colors.amber,
  severe: colors.rose,
};

/** The subscale cards, which now describe where a subscore sits instead of printing it. */
const SUBSCALES: { label: string; above: (s: Phq4Score) => boolean }[] = [
  { label: 'Anxiety', above: (s) => s.anxietyPositive },
  { label: 'Depression', above: (s) => s.depressionPositive },
];

// Long enough that the tapped option is visibly highlighted before the screen moves on.
const ADVANCE_DELAY_MS = 200;

export default function Phq4Screen() {
  const crisis = useCrisisResource();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>([
    null,
    null,
    null,
    null,
  ]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Phq4Score | null>(null);
  // Decided in savePhq4Result, which is the only place with the history and cooldown to decide it.
  const [showSupport, setShowSupport] = useState(false);
  // Blocks option taps between a tap and the advance/submit it triggers, so a double-tap cannot
  // skip a question or submit twice.
  const [advancing, setAdvancing] = useState(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    },
    []
  );

  const current = answers[index] ?? null;
  const isLastQuestion = index === PHQ4_QUESTIONS.length - 1;

  const saveAndFinish = async (finalAnswers: number[]) => {
    const tuple = finalAnswers as [number, number, number, number];
    setSaving(true);
    try {
      const saved = await savePhq4Result(tuple, 'manual');
      setResult(saved.score);
      setShowSupport(saved.showSupport);
    } finally {
      setSaving(false);
    }
  };

  const select = (value: number) => {
    if (advancing || saving) return;
    const nextAnswers = answers.map((a, i) => (i === index ? value : a));
    setAnswers(nextAnswers);
    setAdvancing(true);

    AccessibilityInfo.announceForAccessibility(
      isLastQuestion
        ? 'Answer selected. Submitting your Mood Check.'
        : `Answer selected. Question ${index + 2} of ${PHQ4_QUESTIONS.length}.`
    );

    advanceTimer.current = setTimeout(() => {
      advanceTimer.current = null;
      if (isLastQuestion) {
        void saveAndFinish(nextAnswers.map((a) => a ?? 0)).finally(() =>
          setAdvancing(false)
        );
      } else {
        setIndex((i) => i + 1);
        setAdvancing(false);
      }
    }, ADVANCE_DELAY_MS);
  };

  const onBack = () => {
    // Ignore Back while an advance is pending, so it cannot land on the wrong question.
    if (advancing) return;
    if (index > 0) setIndex(index - 1);
  };

  if (result) {
    return (
      <Screen edges={['top', 'bottom']}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
        >
          <Text style={styles.title}>Mood Check</Text>
          <Text style={styles.subtitle}>Result</Text>

          <Card style={styles.resultCard}>
            <Text
              style={[
                styles.severity,
                { color: SEVERITY_COLORS[result.severity] },
              ]}
            >
              {SEVERITY_LABELS[result.severity]}
            </Text>
            <Text style={styles.severityBlurb}>
              {SEVERITY_BLURBS[result.severity]}
            </Text>
          </Card>

          <View style={styles.statRow}>
            {SUBSCALES.map((sub) => (
              <Card key={sub.label} style={styles.statCard}>
                <Text style={styles.statLabel}>{sub.label}</Text>
                <Text
                  style={[
                    styles.statValue,
                    sub.above(result) && { color: colors.amber },
                  ]}
                >
                  {sub.above(result) ? 'Elevated' : 'Steady'}
                </Text>
                <Text style={styles.statNote}>these two weeks</Text>
              </Card>
            ))}
          </View>

          {showSupport && (
            <Card style={styles.supportCard}>
              <Text style={styles.supportMessage}>
                {crisis.message}
              </Text>
              <View style={styles.supportActions}>
                {crisis.phone && crisis.telHref && crisis.smsHref ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => Linking.openURL(crisis.telHref!)}
                      style={styles.supportButton}
                    >
                      <Text style={styles.supportButtonText}>Call {crisis.phone}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => Linking.openURL(crisis.smsHref!)}
                      style={[styles.supportButton, styles.supportButtonGhost]}
                    >
                      <Text style={[styles.supportButtonText, styles.supportButtonGhostText]}>
                        Text {crisis.phone}
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => Linking.openURL(crisis.directoryUrl!)}
                    style={styles.supportButton}
                  >
                    <Text style={styles.supportButtonText}>Find a local helpline</Text>
                  </Pressable>
                )}
              </View>
            </Card>
          )}

          {!showSupport && (
            <Text style={styles.quietSupport}>{crisis.quietLine}</Text>
          )}

          <Text style={styles.disclaimer}>
            This is a screening tool, not a diagnosis.
          </Text>

          <AppButton
            title="Done"
            onPress={() => navigation.goBack()}
            style={styles.footerButton}
          />
        </ScrollView>
      </Screen>
    );
  }

  const progress = (index + 1) / PHQ4_QUESTIONS.length;

  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <Text style={styles.title}>Mood Check</Text>
        <Text style={styles.subtitle}>
          Question {index + 1} of {PHQ4_QUESTIONS.length}
        </Text>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { flex: progress }]} />
          <View style={{ flex: 1 - progress }} />
        </View>

        <Text style={styles.stem}>{PHQ4_STEM}</Text>
        <Text style={styles.question}>{PHQ4_QUESTIONS[index]}</Text>

        <View style={styles.options}>
          {PHQ4_OPTIONS.map((opt) => {
            const isSelected = current === opt.value;
            return (
              <Pressable
                key={opt.value}
                accessibilityRole="button"
                accessibilityState={{
                  selected: isSelected,
                  disabled: advancing || saving,
                }}
                disabled={advancing || saving}
                onPress={() => select(opt.value)}
                style={[styles.option, isSelected && styles.optionSelected]}
              >
                <Text
                  style={[
                    styles.optionText,
                    isSelected && styles.optionTextSelected,
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {saving && (
          <Text style={styles.savingNote} accessibilityLiveRegion="polite">
            Saving…
          </Text>
        )}

        {index > 0 && (
          <AppButton
            title="Back"
            variant="ghost"
            disabled={advancing}
            onPress={onBack}
            style={styles.backButton}
          />
        )}
      </ScrollView>
    </Screen>
  );
}

/** Fire-and-forget Firestore mirror; no-op when Firebase is disabled. */
const styles = StyleSheet.create({
  scroll: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: {
    ...type.title,
    color: colors.ink,
  },
  subtitle: {
    ...type.sub,
    color: colors.ink3,
    marginTop: 2,
  },
  progressTrack: {
    flexDirection: 'row',
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
    overflow: 'hidden',
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
  progressFill: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
  },
  stem: {
    ...type.sub,
    color: colors.ink2,
  },
  question: {
    ...type.title,
    color: colors.ink,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.line,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  optionSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  optionText: {
    ...type.body,
    color: colors.ink,
  },
  optionTextSelected: {
    color: colors.primaryDeep,
    fontWeight: '600',
  },
  footerButton: {
    marginTop: spacing.md,
  },
  savingNote: {
    ...type.sub,
    color: colors.ink3,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  backButton: {
    marginTop: spacing.sm,
  },
  resultCard: {
    paddingVertical: spacing.xl,
    marginTop: spacing.lg,
  },
  severity: {
    ...type.title,
  },
  severityBlurb: {
    ...type.body,
    color: colors.ink2,
    lineHeight: 22,
    marginTop: spacing.sm,
  },
  statRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  statCard: {
    flex: 1,
  },
  statLabel: {
    ...type.caption,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: colors.ink3,
  },
  statValue: {
    ...type.h2,
    color: colors.ink,
    marginTop: spacing.xs,
  },
  statNote: {
    ...type.body,
    color: colors.ink,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  disclaimer: {
    ...type.sub,
    color: colors.ink3,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  quietSupport: {
    ...type.sub,
    color: colors.ink2,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  supportCard: {
    backgroundColor: colors.roseSoft,
    borderWidth: 1,
    borderColor: colors.rose,
    marginTop: spacing.md,
  },
  supportMessage: {
    ...type.body,
    color: colors.ink,
  },
  supportActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  supportButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.rose,
  },
  supportButtonGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.rose,
  },
  supportButtonText: {
    ...type.body,
    fontWeight: '600',
    color: colors.surface,
  },
  supportButtonGhostText: {
    color: colors.rose,
  },
});
