import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  InteractionManager,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, Pill, Row, Screen } from '../../components';
import { colors, radius, spacing, type } from '../../theme';
import type { RootStackParamList } from '../../navigation';
import {
  hasResultInLastDays,
  hasResultToday,
  syncPhq4FromCloud,
  usePhq4CompletionSignal,
} from '../phq4/history';
import { usePhq4CadenceStore } from '../phq4/cadence';
import { useCheckinStore, type Mood } from './store';
import { MOOD_LABELS, MOOD_ORDER } from './moods';
import { MoodMascot, useMascotOnDuty } from './MoodMascot';
import { shouldOfferSupport, summariseLowStretch } from './supportPrompt';
import { useSupportPromptStore } from './supportPromptState';
import SupportPromptModal from './SupportPromptModal';
import MoodReasonModal from './MoodReasonModal';
import CommunityFeed from '../community/CommunityFeed';
import { logEvent } from '../../services/logging';
import { WellbeingTrendCard } from './WellbeingTrendCard';
import { readCachedTrend, refreshTrend } from './wellbeingTrendData';
import { backfillSensingFromCloud } from '../sensing/cloudBackfill';
import type { TrendSeries } from './wellbeingTrend';

const MOODS: { mood: Mood; label: string }[] = MOOD_ORDER.map((mood) => ({
  mood,
  label: MOOD_LABELS[mood],
}));

const FACE_SIZE = 44;

// The highlight must outlast the tap, or an instant reset reads like the tap did not register.
const HIGHLIGHT_MS = 450;

// A second tap this soon is a bounce, not a second check-in.
const DOUBLE_TAP_MS = 300;

const TODAY_DOT = 14;

function checkinTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** One dot per check-in today, oldest first, in that mood's colour. */
function TodayDots({ entries }: { entries: { ts: number; mood: Mood }[] }) {
  const [selectedTs, setSelectedTs] = useState<number | null>(null);
  const selected = entries.find((e) => e.ts === selectedTs) ?? null;

  return (
    <View>
      <View style={styles.todayHeader}>
        <Text style={styles.todayListTitle}>Today</Text>
        <Text style={styles.todayCaption} numberOfLines={1}>
          {selected
            ? `${checkinTime(selected.ts)} \u00b7 ${MOOD_LABELS[selected.mood]}`
            : 'Tap a dot to see it'}
        </Text>
      </View>
      <View style={styles.todayDots}>
        {entries.map((e) => {
          const isSelected = e.ts === selectedTs;
          return (
            <Pressable
              key={e.ts}
              hitSlop={6}
              onPress={() => setSelectedTs(isSelected ? null : e.ts)}
              accessibilityLabel={`${checkinTime(e.ts)}, ${MOOD_LABELS[e.mood]}`}
              style={[
                styles.todayDot,
                { backgroundColor: colors.mood[e.mood].mid },
                isSelected && styles.todayDotSelected,
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 12) return 'Good Morning';
  if (h < 18) return 'Good Afternoon';
  return 'Good Evening';
}

function dateLine(now: Date = new Date()): string {
  return now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export default function HomeScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { todayEntries, history, streak, load, logMood, setReasons } = useCheckinStore();
  const cadence = usePhq4CadenceStore((s) => s.cadence);
  const loadCadence = usePhq4CadenceStore((s) => s.load);
  const supportLoaded = useSupportPromptStore((s) => s.loaded);
  const supportLastShownAt = useSupportPromptStore((s) => s.lastShownAt);
  const loadSupportPrompt = useSupportPromptStore((s) => s.load);
  const markSupportShown = useSupportPromptStore((s) => s.markShown);

  const [selected, setSelected] = useState<Mood | null>(null);
  const mascot = useMascotOnDuty();
  const [phq4Done, setPhq4Done] = useState(false);
  const [supportVisible, setSupportVisible] = useState(false);
  const [trend, setTrend] = useState<TrendSeries | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef(0);
  // The mood the reason sheet is asking about, and the save it should attach its answer to.
  const [reasonMood, setReasonMood] = useState<Mood | null>(null);
  const pendingCheckin = useRef<Promise<number> | null>(null);
  // iOS still starts its own scroll under a JS gesture, so the page holds still while the planet turns.
  const [turningPlanet, setTurningPlanet] = useState(false);
  // Bottom edge of the community panel in scroll coordinates; once scrolled past, the planet stops drawing.
  const [feedBottom, setFeedBottom] = useState(Infinity);
  const [planetVisible, setPlanetVisible] = useState(true);

  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    []
  );

  const refresh = useCallback(() => {
    let active = true;
    void load();
    void loadCadence();
    void loadSupportPrompt();
    void syncPhq4FromCloud()
      .catch(() => {})
      .then(() => (cadence === 'daily' ? hasResultToday() : hasResultInLastDays(7)))
      .then((done) => {
        if (active) setPhq4Done(done);
      })
      .catch(() => {});
    // Paint the last build at once, then rebuild behind it only if something it depends on changed.
    void readCachedTrend().then((cached) => {
      if (active && cached) setTrend(cached);
    });
    InteractionManager.runAfterInteractions(() => {
      const rebuild = () =>
        refreshTrend()
          .then((series) => {
            if (active) setTrend(series);
          })
          .catch((err: unknown) => console.warn('Trend refresh failed:', err));
      // Rebuild from what is here now, then pull back the account's own uploaded rows and rebuild
      // again only if that brought anything new, so a reinstalled phone fills in the days it
      // measured without the card waiting on the network.
      void rebuild();
      backfillSensingFromCloud()
        .catch(() => null)
        .then((res) => {
          if (res && res.inserted > 0) return rebuild();
        });
    });
    return () => {
      active = false;
    };
  }, [load, loadCadence, loadSupportPrompt, cadence]);

  // Offered once a stretch of low check-ins is on record, then held back for the
  // cooldown in supportPrompt.ts so it stays a nudge rather than a nag. Marking it shown
  // straight away is what closes that window, so dismissing and re-opening Home cannot
  // bring it back.
  useEffect(() => {
    // Never stacked on the reason sheet; it gets its turn once that closes.
    if (!supportLoaded || supportVisible || reasonMood) return;
    const today = new Date();
    if (
      !shouldOfferSupport({
        entries: history,
        today,
        lastShownAt: supportLastShownAt,
        now: Date.now(),
      })
    ) {
      return;
    }
    setSupportVisible(true);
    void markSupportShown();
    void logEvent('support_prompt_shown', summariseLowStretch(history, today)).catch(
      () => {}
    );
  }, [supportLoaded, supportLastShownAt, history, supportVisible, markSupportShown, reasonMood]);

  // A new check-in moves today's point; the fingerprint check makes this a no-op when nothing changed.
  const todayCount = todayEntries.length;
  useEffect(() => {
    if (todayCount === 0) return;
    let active = true;
    refreshTrend()
      .then((series) => {
        if (active) setTrend(series);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [todayCount]);

  useFocusEffect(refresh);

  // The focus event does not reliably re-fire on web when returning from the Phq4 modal.
  const phq4CompletedAt = usePhq4CompletionSignal((s) => s.lastCompletedAt);
  useEffect(() => {
    if (phq4CompletedAt) refresh();
  }, [phq4CompletedAt, refresh]);

  // Highlight first, then persist after interactions: logMood's synchronous store write re-renders
  // the whole screen, which delayed the highlight enough to read as lag.
  const selectMood = (mood: Mood) => {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) return;
    lastTapRef.current = now;

    setSelected(mood);
    AccessibilityInfo.announceForAccessibility(`${MOOD_LABELS[mood]} logged.`);

    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => {
      highlightTimer.current = null;
      setSelected(null);
    }, HIGHLIGHT_MS);

    // The save starts behind the highlight; the reason sheet holds on to it so its answer lands on this row.
    pendingCheckin.current = new Promise<number>((resolve, reject) => {
      InteractionManager.runAfterInteractions(() => {
        logMood(mood).then(resolve, reject);
      });
    });
    pendingCheckin.current.catch((err: unknown) => {
      console.warn('Check-in failed to save:', err);
    });
    setReasonMood(mood);
  };

  const closeReasons = () => {
    if (reasonMood) void logEvent('mood_reason_skipped', { mood: reasonMood }).catch(() => {});
    setReasonMood(null);
  };

  const submitReasons = (reasons: string[], otherText: string | null) => {
    const mood = reasonMood;
    setReasonMood(null);
    const pending = pendingCheckin.current;
    if (!pending) return;
    void pending
      .then((ts) => setReasons(ts, reasons, otherText))
      .then(() => logEvent('mood_reason_saved', { mood, reasons, hasOther: otherText != null }))
      .catch((err: unknown) => console.warn('Mood reasons failed to save:', err));
  };

  return (
    <Screen>
      <ScrollView
        scrollEnabled={!turningPlanet}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={100}
        onScroll={(e) => {
          const seen = e.nativeEvent.contentOffset.y < feedBottom;
          if (seen !== planetVisible) setPlanetVisible(seen);
        }}
        contentContainerStyle={styles.scroll}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerTextWrap}>
            <Text style={styles.greeting}>{greeting()}</Text>
            <Text style={styles.dateLine}>{dateLine()}</Text>
          </View>
        </View>

        {todayEntries.length === 0 && streak > 0 && (
          <Card style={styles.streakCard}>
            <View style={styles.streakRow}>
              <Text style={styles.streakEmoji}>{'\u{1F525}'}</Text>
              <View style={styles.streakTextWrap}>
                <Text style={styles.streakTitle}>
                  {streak === 1 ? '1-Day Streak' : `${streak}-Day Streak`}
                </Text>
                <Text style={styles.streakSub}>
                  Daily check-ins keep your insights sharp
                </Text>
              </View>
            </View>
          </Card>
        )}

        <Card>
          <Text style={styles.moodTitle}>How Are You Feeling Right Now?</Text>
          <View style={styles.faceRow}>
            {MOODS.map(({ mood, label }) => {
              const isSelected = selected === mood;
              return (
                <Pressable
                  key={mood}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={label}
                  onPress={() => selectMood(mood)}
                  // Outline on `pressed` too: onPress only fires when the finger lifts, so without
                  // this the face looks inert for the whole press.
                  style={({ pressed }) => [
                    styles.face,
                    (isSelected || pressed) && styles.faceSelected,
                  ]}
                >
                  <MoodMascot mood={mood} mascot={mascot} size={FACE_SIZE} />
                  <Text style={[styles.faceLabel, isSelected && styles.faceLabelSelected]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {todayEntries.length > 0 ? (
            <View style={styles.todayList}>
              <TodayDots entries={[...todayEntries].reverse()} />
            </View>
          ) : (
            <Text style={styles.todayEmpty}>Today's check-ins will show up here.</Text>
          )}
        </Card>

        <Card style={styles.rowCard}>
          {phq4Done ? (
            <Row
              icon={<Text style={styles.rowEmoji}>{'\u{1F4CB}'}</Text>}
              iconBg={colors.tealSoft}
              title={
                cadence === 'daily'
                  ? 'Mood Check Done Today ✓'
                  : 'Mood Check Done This Week ✓'
              }
              subtitle="Take it again any time your day has changed"
              right={
                <Pill label="Retake" color={colors.teal} bg={colors.tealSoft} />
              }
              onPress={() => navigation.navigate('Phq4')}
              accessibilityLabel={
                cadence === 'daily'
                  ? 'Mood Check done today. Take it again.'
                  : 'Mood Check done this week. Take it again.'
              }
              style={styles.innerRow}
            />
          ) : (
            <Row
              icon={<Text style={styles.rowEmoji}>{'\u{1F4CB}'}</Text>}
              title={
                cadence === 'daily'
                  ? 'Mood Check For Today'
                  : 'Mood Check For This Week'
              }
              subtitle={'4 questions · under a minute'}
              right={<Pill label="Start" />}
              onPress={() => navigation.navigate('Phq4')}
              accessibilityLabel={
                cadence === 'daily'
                  ? 'Mood Check for today. Start.'
                  : 'Mood Check for this week. Start.'
              }
              style={styles.innerRow}
            />
          )}
        </Card>

        <View
          onLayout={(e) => setFeedBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}
        >
          <CommunityFeed onPlanetDrag={setTurningPlanet} planetVisible={planetVisible} />
        </View>

        <WellbeingTrendCard series={trend} />
      </ScrollView>

      <MoodReasonModal mood={reasonMood} onClose={closeReasons} onSubmit={submitReasons} />

      <SupportPromptModal
        visible={supportVisible}
        onClose={() => setSupportVisible(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerTextWrap: {
    flex: 1,
  },
  greeting: {
    ...type.title,
    color: colors.ink,
  },
  dateLine: {
    ...type.sub,
    color: colors.ink3,
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  streakCard: {
    backgroundColor: colors.primary,
    borderWidth: 0,
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  streakEmoji: {
    fontSize: 28,
  },
  streakTextWrap: {
    flex: 1,
  },
  streakTitle: {
    ...type.h2,
    color: colors.surface,
  },
  streakSub: {
    ...type.sub,
    color: colors.primarySoft,
    marginTop: 2,
  },
  moodTitle: {
    ...type.h2,
    color: colors.ink,
    marginBottom: spacing.md,
  },
  faceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  face: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  faceSelected: {
    borderColor: colors.primary,
  },
  faceLabel: {
    ...type.caption,
    color: colors.ink3,
    marginTop: spacing.xs,
  },
  faceLabelSelected: {
    color: colors.primaryDeep,
  },
  todayList: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  todayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  todayListTitle: {
    ...type.caption,
    fontWeight: '700',
    color: colors.ink3,
  },
  todayCaption: {
    ...type.caption,
    color: colors.ink3,
    flexShrink: 1,
  },
  todayDots: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  todayDot: {
    width: TODAY_DOT,
    height: TODAY_DOT,
    borderRadius: TODAY_DOT / 2,
  },
  todayDotSelected: {
    borderWidth: 2,
    borderColor: colors.primaryDeep,
  },
  todayEmpty: {
    ...type.sub,
    color: colors.ink3,
    marginTop: spacing.lg,
  },
  rowCard: {
    paddingVertical: spacing.xs,
  },
  innerRow: {
    paddingVertical: spacing.sm,
  },
  rowEmoji: {
    fontSize: 20,
  },
});
