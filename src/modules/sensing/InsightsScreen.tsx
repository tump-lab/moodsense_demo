import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, type CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { AppButton, Card, EmptyState, Pill, Row, Screen } from '../../components';
import { colors, radius, spacing, type } from '../../theme';
import { CONFIG } from '../../config';
import { queryAll, type Mood } from '../../services/db';
import { getActiveUid, hasRealSession, signOut } from '../../services/firebase';
import { logEvent } from '../../services/logging';
import type { MainTabsParamList, RootStackParamList } from '../../navigation';
import { seedDemoData } from './mockData';
import { useConsentStore } from '../consent/store';
import { useLlmSettingsStore } from '../settings/llmSettings';
import { usePhq4CadenceStore } from '../phq4/cadence';
import { useDevModeStore } from '../settings/devMode';
import { isPositiveMood, MOOD_LABELS, MOOD_ORDER } from '../checkin/moods';
import { useCheckinStore } from '../checkin/store';
import { capPoints } from '../checkin/energyChart';
import { GrowthCard } from '../rewards/GrowthCard';
import {
  APP_STEPS_STREAM,
  hasAnyStreamRow,
  latestSample,
  latestSleepNight,
  latestSleepNightEstimate,
  latestTodayAppSteps,
  latestTodaySteps,
  getUploadStatus,
  startOfToday,
  todayCountByStream,
  todayScreenTimeMs,
  screenSourceSeesGlances,
  todayAppOpenCount,
  todayUsageDigest,
  yesterdayUsageDigest,
  type UsageDigest,
  type LatestSample,
  type UploadStatus,
  type SleepNightEstimateSummary,
  type SleepNightSummary,
} from './queue';
import * as iosUsage from '../../../modules/moodsense-ios-usage';
import { yesterdayStats } from './accountDay';
import { LlmError } from '../../services/llm';
import { generateReport, type ReportPeriod } from './report';
import { getTrendRange, setTrendRange, type TrendRange } from './trendRange';

interface CheckinPoint {
  ts: number;
  mood: Mood;
}

interface TrendDay {
  label: string;
  date: string;
  entries: CheckinPoint[];
}

interface AggregatePoint {
  label: string;
  date: string;
  mood: Mood | null;
  count: number;
}

type TrendChart =
  | { range: 'week'; days: TrendDay[] }
  | { range: 'month'; days: AggregatePoint[] }
  | { range: 'year'; days: AggregatePoint[] };

const TREND_COLORS: Record<Mood, string> = {
  calm: colors.mood.calm.mid,
  good: colors.mood.good.mid,
  stressed: colors.mood.stressed.mid,
  low: colors.mood.low.mid,
  tired: colors.mood.tired.mid,
};

interface Stats {
  steps: number | null;
  screenEvents: number | null;
  appOpens: number | null;
}

interface Phq4Latest {
  total: number;
  severity: string;
}

interface MoodCounts {
  positive: number;
  negative: number;
  total: number;
}

interface StreamEverCollected {
  steps: boolean;
  screen: boolean;
}

const EMPTY_EVER_COLLECTED: StreamEverCollected = { steps: false, screen: false };

const EMPTY_STATS: Stats = { steps: null, screenEvents: null, appOpens: null };

interface DevStats {
  appSteps: number | null;
  restingHr: LatestSample | null;
  heartRate: LatestSample | null;
  spo2: LatestSample | null;
  screenTimeMs: number | null;
  upload: UploadStatus | null;
}

interface YesterdayStats {
  steps: number | null;
  appSteps: number | null;
  screenEvents: number | null;
  unlocks: number | null;
  appOpens: number | null;
  screenTimeMs: number | null;
}

const EMPTY_YESTERDAY_STATS: YesterdayStats = {
  steps: null,
  appSteps: null,
  screenEvents: null,
  unlocks: null,
  appOpens: null,
  screenTimeMs: null,
};

const EMPTY_DEV_STATS: DevStats = {
  appSteps: null,
  restingHr: null,
  heartRate: null,
  spo2: null,
  screenTimeMs: null,
  upload: null,
};
const EMPTY_MOOD_COUNTS: MoodCounts = { positive: 0, negative: 0, total: 0 };
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const RANGE_SUBTITLE: Record<TrendRange, string> = {
  week: 'Your last 7 days',
  month: 'Your last 30 days',
  year: 'Your last 12 months',
};
const RANGE_EMPTY_MESSAGE: Record<TrendRange, string> = {
  week: 'Check in and your week will start taking shape here.',
  month: 'Check in and your month will start taking shape here.',
  year: 'Check in and your year will start taking shape here.',
};
const RANGE_PLACEHOLDER_COUNT: Record<TrendRange, number> = {
  week: 7,
  month: 30,
  year: 12,
};

function rangeWord(range: TrendRange): string {
  if (range === 'month') return "this month's";
  if (range === 'year') return "this year's";
  return "this week's";
}

function isChartEmpty(chart: TrendChart): boolean {
  if (chart.range === 'week') return chart.days.every((day) => day.entries.length === 0);
  return chart.days.every((point) => point.count === 0);
}

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatClockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function severityWord(total: number): string {
  if (total <= 2) return 'None';
  if (total <= 5) return 'Mild';
  if (total <= 8) return 'Moderate';
  return 'Severe';
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_LABEL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

async function loadWeekTrend(): Promise<TrendDay[]> {
  const now = Date.now();
  const dates: { date: string; label: string }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * DAY_MS);
    dates.push({ date: localDateStr(d), label: WEEKDAY[d.getDay()] ?? '' });
  }
  const first = dates[0];
  const rows = await queryAll<{ date: string; mood: Mood; ts: number }>(
    'SELECT date, mood, ts FROM checkins WHERE date >= ? AND uid = ? ORDER BY ts ASC',
    [first ? first.date : '', getActiveUid()]
  );
  const byDate = new Map<string, CheckinPoint[]>();
  for (const r of rows) {
    const point: CheckinPoint = { ts: r.ts, mood: r.mood };
    const existing = byDate.get(r.date);
    if (existing) existing.push(point);
    else byDate.set(r.date, [point]);
  }
  return dates.map((d) => ({
    label: d.label,
    date: d.date,
    entries: byDate.get(d.date) ?? [],
  }));
}

async function loadMonthTrend(): Promise<AggregatePoint[]> {
  const DAYS = 30;
  const now = Date.now();
  const dates: { date: string; label: string }[] = [];
  for (let j = 0; j < DAYS; j++) {
    const daysAgo = DAYS - 1 - j;
    const d = new Date(now - daysAgo * DAY_MS);
    // No label on any of them. Thirty columns across a phone gives each one about ten points of
    // width, which is narrower than a two-digit date: every sixth day used to carry its date and
    // each one wrapped a digit per line, so "28" printed as a 2 above an 8 and the axis read as a
    // column of loose numerals. The dots run oldest to newest over the window the card's subtitle
    // names ("Your last 30 days"), so five unreadable dates were not carrying their own cost.
    dates.push({ date: localDateStr(d), label: '' });
  }
  const first = dates[0];
  const uid = getActiveUid();
  const rows = await queryAll<{ date: string; mood: Mood; ts: number; cnt: number }>(
    `SELECT c.date AS date, c.mood AS mood, c.ts AS ts, day.cnt AS cnt
     FROM checkins c
     JOIN (
       SELECT date, COUNT(*) AS cnt, MAX(ts) AS maxTs
       FROM checkins WHERE date >= ? AND uid = ?
       GROUP BY date
     ) day ON day.maxTs = c.ts
     WHERE c.uid = ?`,
    [first ? first.date : '', uid, uid]
  );
  const byDate = new Map<string, { mood: Mood; cnt: number }>();
  for (const r of rows) byDate.set(r.date, { mood: r.mood, cnt: r.cnt });
  return dates.map((d) => {
    const hit = byDate.get(d.date);
    return { label: d.label, date: d.date, mood: hit ? hit.mood : null, count: hit ? hit.cnt : 0 };
  });
}

async function loadYearTrend(): Promise<AggregatePoint[]> {
  const MONTHS = 12;
  const now = new Date();
  const months: { month: string; label: string }[] = [];
  for (let i = MONTHS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ month: monthKey(d), label: MONTH_LABEL[d.getMonth()] ?? '' });
  }
  const firstMonth = months[0];
  const sinceDate = firstMonth ? `${firstMonth.month}-01` : '';
  const uid = getActiveUid();
  const rows = await queryAll<{ month: string; mood: Mood; cnt: number }>(
    `SELECT substr(date, 1, 7) AS month, mood, COUNT(*) AS cnt
     FROM checkins WHERE date >= ? AND uid = ?
     GROUP BY month, mood`,
    [sinceDate, uid]
  );
  const byMonth = new Map<string, { mood: Mood; cnt: number; total: number }>();
  for (const r of rows) {
    const existing = byMonth.get(r.month);
    const total = (existing?.total ?? 0) + r.cnt;
    const isNewWinner =
      !existing ||
      r.cnt > existing.cnt ||
      (r.cnt === existing.cnt && MOOD_ORDER.indexOf(r.mood) < MOOD_ORDER.indexOf(existing.mood));
    byMonth.set(r.month, isNewWinner ? { mood: r.mood, cnt: r.cnt, total } : { ...existing, total });
  }
  return months.map((m) => {
    const hit = byMonth.get(m.month);
    return { label: m.label, date: m.month, mood: hit ? hit.mood : null, count: hit ? hit.total : 0 };
  });
}

async function loadTrend(range: TrendRange): Promise<TrendChart> {
  if (range === 'month') return { range, days: await loadMonthTrend() };
  if (range === 'year') return { range, days: await loadYearTrend() };
  return { range: 'week', days: await loadWeekTrend() };
}

function rangeStartDate(range: TrendRange): string {
  if (range === 'year') {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    return `${monthKey(start)}-01`;
  }
  const days = range === 'month' ? 30 : 7;
  return localDateStr(new Date(Date.now() - (days - 1) * DAY_MS));
}

async function loadMoodCounts(range: TrendRange): Promise<MoodCounts> {
  const rows = await queryAll<{ mood: Mood; cnt: number }>(
    'SELECT mood, COUNT(*) AS cnt FROM checkins WHERE date >= ? AND uid = ? GROUP BY mood',
    [rangeStartDate(range), getActiveUid()]
  );
  let positive = 0;
  let negative = 0;
  for (const r of rows) {
    if (isPositiveMood(r.mood)) positive += r.cnt;
    else negative += r.cnt;
  }
  return { positive, negative, total: positive + negative };
}

async function loadPhq4(sinceTs: number): Promise<Phq4Latest | null> {
  const rows = await queryAll<{ total: number }>(
    'SELECT total FROM phq4_results WHERE uid = ? AND ts >= ? ORDER BY ts DESC LIMIT 1',
    [getActiveUid(), sinceTs]
  );
  const latest = rows[0];
  if (!latest) return null;
  return { total: latest.total, severity: severityWord(latest.total) };
}

type InsightsNavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabsParamList, 'You'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export default function InsightsScreen() {
  const navigation = useNavigation<InsightsNavigationProp>();
  const cadence = usePhq4CadenceStore((s) => s.cadence);
  const loadCadence = usePhq4CadenceStore((s) => s.load);

  // Steps depends on `motion` consent, not `health`: the 'steps' stream shown here comes from the pedometer.
  // Health step data goes into separate streams this screen never reads.
  const motionConsent = useConsentStore((s) => s.motion);
  const screenConsent = useConsentStore((s) => s.screen);

  const devMode = useDevModeStore((s) => s.enabled);
  // Screenshot mode keeps the participant-facing cards (and mood balance) but drops the instrumentation.
  const screenshot = useDevModeStore((s) => s.screenshot);

  // The growth level is read off the same check-in rows the rest of the app uses; nothing about it
  // is stored, so there is no second copy of the score to keep in sync.
  const checkinHistory = useCheckinStore((s) => s.history);
  const checkinStreak = useCheckinStore((s) => s.streak);
  const loadCheckins = useCheckinStore((s) => s.load);

  const [range, setRange] = useState<TrendRange>('week');
  const [trend, setTrend] = useState<TrendChart>({ range: 'week', days: [] });
  const [moodCounts, setMoodCounts] = useState<MoodCounts>(EMPTY_MOOD_COUNTS);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [devStats, setDevStats] = useState<DevStats>(EMPTY_DEV_STATS);
  const [yesterday, setYesterday] = useState<YesterdayStats>(EMPTY_YESTERDAY_STATS);
  const [yesterdayScope, setYesterdayScope] = useState<'account' | 'device' | null>(null);
  const [everCollected, setEverCollected] = useState<StreamEverCollected>(EMPTY_EVER_COLLECTED);
  const [phq4, setPhq4] = useState<Phq4Latest | null>(null);
  const [sleepNight, setSleepNight] = useState<SleepNightSummary | null>(null);
  const [sleepEstimate, setSleepEstimate] = useState<SleepNightEstimateSummary | null>(null);
  const [usage, setUsage] = useState<UsageDigest | null>(null);
  const [usageYesterday, setUsageYesterday] = useState<UsageDigest | null>(null);
  // Null until the first read; on Android it stays 'unavailable', which the caption ignores there.
  const [callKeepAlive, setCallKeepAlive] = useState<iosUsage.CallKeepAliveStatus | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const llmEnabled = useLlmSettingsStore((s) => s.enabled);
  const [reportLoading, setReportLoading] = useState<ReportPeriod | null>(null);
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod | null>(null);
  const [reportText, setReportText] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  const handleGenerateReport = useCallback((period: ReportPeriod) => {
    void (async () => {
      setReportLoading(period);
      setReportError(null);
      try {
        const text = await generateReport(period);
        setReportPeriod(period);
        setReportText(text);
      } catch (err) {
        setReportError(reportErrorMessage(err));
      } finally {
        setReportLoading(null);
      }
    })();
  }, []);

  const handleOpenSettings = useCallback(() => {
    navigation.navigate('Settings');
  }, [navigation]);

  const debugOpener = useCallback(
    (title: string, streams: string[]) =>
      devMode ? () => navigation.navigate('StreamDebug', { title, streams }) : undefined,
    [devMode, navigation]
  );

  const handleGoToCheckIn = useCallback(() => {
    navigation.navigate('Home');
  }, [navigation]);

  const handleSignOut = useCallback(() => {
    void (async () => {
      setSigningOut(true);
      try {
        void logEvent('auth_signout');
        await signOut();
        useConsentStore.getState().reset();
        useLlmSettingsStore.getState().reset();
        useCheckinStore.getState().reset();
        navigation
          .getParent<NativeStackNavigationProp<RootStackParamList>>()
          ?.reset({ index: 0, routes: [{ name: 'Auth' }] });
      } catch {
        setSigningOut(false);
      }
    })();
  }, [navigation]);

  const loadInsights = useCallback(async (isCancelled: () => boolean = () => false) => {
    try {
      // Fake rows are only for the explicit dev-mode toggle; a dev build must not fill a real account with them.
      if (devMode) await seedDemoData();
      await loadCadence();
      const phq4SinceTs = cadence === 'daily' ? startOfToday() : Date.now() - 7 * DAY_MS;
      const [
        trendChart,
        counts,
        steps,
        byStream,
        appOpens,
        phq,
        sleep,
        sleepEst,
        stepsEverCollected,
        screenEverCollected,
        usageDigest,
      ] = await Promise.all([
        loadTrend(range),
        loadMoodCounts(range),
        latestTodaySteps(),
        todayCountByStream(),
        todayAppOpenCount(),
        loadPhq4(phq4SinceTs),
        latestSleepNight(),
        latestSleepNightEstimate(),
        hasAnyStreamRow('steps'),
        hasAnyStreamRow('screen'),
        todayUsageDigest(),
      ]);
      if (isCancelled()) return;
      setTrend(trendChart);
      setMoodCounts(counts);
      setStats({
        steps,
        screenEvents: byStream['screen'] ?? 0,
        appOpens,
      });
      setEverCollected({ steps: stepsEverCollected, screen: screenEverCollected });
      if (devMode) {
        const [
          restingHr,
          heartRate,
          spo2,
          screenTimeMs,
          upload,
          appSteps,
          yesterdayLoaded,
          yUsage,
        ] = await Promise.all([
          latestSample('health_resting_hr', 'bpm'),
          latestSample('health_heart_rate', 'bpm'),
          latestSample('health_spo2', 'fraction').then(
            (f) => f ?? latestSample('health_spo2', 'percentage')
          ),
          todayScreenTimeMs(),
          getUploadStatus(),
          latestTodayAppSteps(),
          yesterdayStats(),
          yesterdayUsageDigest(),
        ]);
        if (isCancelled()) return;
        setDevStats({ appSteps, restingHr, heartRate, spo2, screenTimeMs, upload });
        setYesterday(yesterdayLoaded.stats);
        setYesterdayScope(yesterdayLoaded.scope);
        setUsageYesterday(yUsage);
      } else {
        setDevStats((prev) => (prev === EMPTY_DEV_STATS ? prev : EMPTY_DEV_STATS));
        setYesterday((prev) => (prev === EMPTY_YESTERDAY_STATS ? prev : EMPTY_YESTERDAY_STATS));
        setYesterdayScope(null);
        setUsageYesterday(null);
      }
      setPhq4(phq);
      setSleepNight(sleep);
      setSleepEstimate(sleepEst);
      setUsage(usageDigest);
    } catch {
      // Leave the placeholder dashes if the database isn't ready yet.
    }
  }, [range, cadence, loadCadence, devMode]);

  useEffect(() => {
    void (async () => {
      const saved = await getTrendRange();
      setRange(saved);
    })();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    void iosUsage.callKeepAliveStatus().then(setCallKeepAlive).catch(() => {});
  }, []);

  const handleRangeChange = useCallback((next: TrendRange) => {
    setRange(next);
    void setTrendRange(next);
  }, []);

  const isFocusedRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      let cancelled = false;
      void loadInsights(() => cancelled);
      // The growth card reads the check-in store, which only the Home tab loads — and someone can
      // open You first.
      void loadCheckins();
      return () => {
        cancelled = true;
        isFocusedRef.current = false;
      };
    }, [loadInsights, loadCheckins])
  );

  // Tab focus does not fire when the whole app comes back from the background, for example after a phone lock.
  // The 400ms wait gives the screen-unlock event time to be saved before we read it back.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state !== 'active' || !isFocusedRef.current) return;
      setTimeout(() => {
        if (isFocusedRef.current) void loadInsights();
      }, 400);
    });
    return () => sub.remove();
  }, [loadInsights]);

  const trendEmpty = trend.days.length === 0 || isChartEmpty(trend);
  const trendGhostLabels =
    trend.days.length > 0
      ? trend.days.map((day) => day.label)
      : Array.from({ length: RANGE_PLACEHOLDER_COUNT[range] }, () => '');

  const showSteps = motionConsent && everCollected.steps;
  const showScreenEvents = screenConsent && everCollected.screen;
  const showAppOpens = screenConsent && everCollected.screen;
  const statRows: RowSpec[] = [
    ...(showSteps
      ? [{
          key: 'steps',
          value: fmt(stats.steps),
          label: 'Steps Today',
          muted: stats.steps == null,
          debugStreams: ['steps', 'health_steps_daily', 'health_steps_interval'],
        }]
      : []),
    ...(showScreenEvents
      ? [{
          key: 'screenEvents',
          value: fmt(stats.screenEvents),
          label: 'Screen Events Today',
          debugStreams: ['screen'],
        }]
      : []),
    ...(showAppOpens
      ? [{
          key: 'appOpens',
          value: fmt(stats.appOpens),
          label: 'MoodSense Opens Today',
          debugStreams: ['screen'],
        }]
      : []),
  ];
  const anyStatConsent = motionConsent || screenConsent;

  const moodCheckRow: RowSpec = {
    key: 'moodCheck',
    value: phq4 ? `${phq4.total} / 12` : '\u2014',
    label: cadence === 'daily' ? 'Mood Check · Today' : 'Mood Check · This Week',
    caption: phq4 ? `Severity: ${phq4.severity}` : 'Not taken recently',
    muted: phq4 == null,
    accent: phq4 != null,
  };

  const appStepsRow = (value: number | null, when: DayScope): RowSpec[] =>
    Platform.OS === 'android'
      ? [
          {
            key: `appSteps-${when}`,
            value: fmt(value),
            label: `Steps ${when === 'today' ? 'Today' : 'Yesterday'} (App-Counted)`,
            caption: 'only while the app was running',
            muted: value == null,
            debugStreams: [APP_STEPS_STREAM],
          },
        ]
      : [];

  const screenTimeRow = (
    key: string,
    label: string,
    totalMs: number | null,
    thresholdMin: number | null
  ): RowSpec =>
    Platform.OS === 'ios'
      ? {
          key,
          label,
          value: fmtThreshold(thresholdMin),
          caption: usageCategoryCaption(thresholdMin),
          debugStreams: ['app_usage_threshold', 'app_usage_probe'],
          muted: thresholdMin == null,
        }
      : {
          key,
          label,
          value: fmtDuration(totalMs),
          caption: Platform.OS === 'android' ? undefined : 'mobile only',
          debugStreams: ['app_usage', 'background_usage'],
          muted: totalMs == null,
        };

  const yesterdayRows: RowSpec[] = devMode
    ? [
        {
          key: 'yesterdaySteps',
          value: fmt(yesterday.steps),
          label: 'Steps Yesterday',
          debugStreams: ['steps', 'health_steps_daily', 'health_steps_interval'],
          muted: yesterday.steps == null,
        },
        ...appStepsRow(yesterday.appSteps, 'yesterday'),
        {
          key: 'yesterdayScreenEvents',
          value: fmt(yesterday.screenEvents),
          label: 'Screen Events Yesterday',
          debugStreams: ['screen'],
        },
        {
          key: 'yesterdayAppOpens',
          value: fmt(yesterday.appOpens),
          label: 'MoodSense Opens Yesterday',
          debugStreams: ['screen'],
        },
        screenTimeRow(
          'yesterdayScreenTime',
          'Screen Time Yesterday',
          yesterday.screenTimeMs,
          usageYesterday?.totalThresholdMin ?? null
        ),
      ]
    : [];

  /**
   * Two separate rows on purpose. Phone pick-ups come from the OS and are the real thing; MoodSense
   * opens come from the AppState proxy and are only this app. Before they were split, an iPhone with
   * no OS source showed its handful of app opens under the label "Pick-ups", which read as a day of
   * barely touching the phone.
   */
  const phoneUseRows = (d: UsageDigest | null, when: DayScope): RowSpec[] => [
    {
      key: `${when}Pickups`,
      label: 'Phone Pick-Ups',
      value: d?.unlocks != null ? `${d.unlocks}` : '—',
      caption:
        d?.unlocks != null
          ? d.screenSource === 'ios_protected_data'
            ? 'unlocks — glances at the lock screen are not counted'
            : 'times you unlocked your phone'
          : 'this phone cannot report unlocks',
      muted: d?.unlocks == null,
      debugStreams: ['screen'],
    },
    {
      key: `${when}AppOpens`,
      label: 'MoodSense Opens',
      value: d?.appOpens != null ? `${d.appOpens}` : '—',
      caption: 'times you opened this app',
      debugStreams: ['screen'],
    },
    // Hidden rather than wrong where the source cannot resolve a 15-second session: see screenSourceSeesGlances.
    ...(d?.screen && screenSourceSeesGlances(d.screenSource)
      ? [{
          key: `${when}Glances`,
          label: 'Quick Glances',
          value: `${d.screen.glanceCount}`,
          caption: 'under 15 seconds — checking the time',
          debugStreams: ['screen'],
        }]
      : []),
    {
      key: `${when}Longest`,
      label: 'Longest Stretch',
      value: fmtShortDuration(d?.screen?.longestMs ?? null),
      caption: 'in one sitting',
      debugStreams: ['screen'],
    },
    {
      key: `${when}Social`,
      label: 'Social Apps',
      value:
        Platform.OS === 'ios'
          ? fmtThreshold(d?.socialThresholdMin ?? null)
          : fmtDuration(d?.socialMs ?? null),
      caption: usageCategoryCaption(d?.socialThresholdMin ?? null),
      debugStreams:
        Platform.OS === 'ios'
          ? ['app_usage_threshold', 'app_usage_probe']
          : ['app_usage', 'background_usage'],
    },
    {
      key: `${when}AudioVideo`,
      label: 'Audio & Video',
      value:
        Platform.OS === 'ios'
          ? fmtThreshold(d?.audioVideoThresholdMin ?? null)
          : fmtDuration(d?.audioVideoMs ?? null),
      caption: usageCategoryCaption(d?.audioVideoThresholdMin ?? null),
      debugStreams:
        Platform.OS === 'ios'
          ? ['app_usage_threshold', 'app_usage_probe']
          : ['app_usage', 'background_usage'],
    },
    // Per-app rows sit under the two group rows they break down. iOS gives a floor per app, never a
    // total, and the name is the participant's own — an unnamed app shows its anonymous code so the
    // row is still honest about being a distinct app rather than silently disappearing.
    ...(d?.apps ?? []).map((app, i) => ({
      key: `${when}App-${app.appId}`,
      label: app.name ?? `App ${i + 1}`,
      value: fmtThreshold(app.atLeastMinutes),
      caption:
        app.name == null
          ? 'unnamed — name it in Settings to see which app this is'
          : 'at least this much — iOS reports thresholds, not totals',
      muted: app.name == null,
      debugStreams: ['app_usage_threshold', 'app_label'],
    })),
    {
      key: `${when}Calls`,
      label: 'Calls',
      value: fmtDuration(d?.callMs ?? null),
      caption: callCaption(d?.callMs ?? null, when, callKeepAlive),
      debugStreams: Platform.OS === 'ios' ? ['call', 'call_coverage'] : ['call', 'app_usage'],
    },
  ];

  const devRows: RowSpec[] =
    devMode
      ? [
          {
            key: 'restingHr',
            value: fmtSample(devStats.restingHr, ' beats per minute'),
            label: 'Resting Heart Rate',
            caption: fmtSampleAge(devStats.restingHr),
            debugStreams: ['health_resting_hr'],
          },
          {
            key: 'heartRate',
            value: fmtSample(devStats.heartRate, ' beats per minute'),
            label: 'Latest Heart Rate',
            caption: fmtSampleAge(devStats.heartRate),
            debugStreams: ['health_heart_rate'],
          },
          {
            key: 'spo2',
            // iOS stores blood oxygen as 0-1 and Android as 0-100, so scale iOS values up to a percent.
            value: fmtSample(
              devStats.spo2 && devStats.spo2.value <= 1
                ? { ...devStats.spo2, value: devStats.spo2.value * 100 }
                : devStats.spo2,
              '%'
            ),
            label: 'Blood Oxygen',
            caption: fmtSampleAge(devStats.spo2),
            debugStreams: ['health_spo2'],
          },
          screenTimeRow(
            'screenTime',
            'Screen Time Today',
            devStats.screenTimeMs,
            usage?.totalThresholdMin ?? null
          ),
          {
            key: 'pending',
            value: fmt(devStats.upload?.pending ?? null),
            label: 'Pending Upload Rows',
            caption: fmtUploadSync(devStats.upload),
            debugStreams: [],
          },
        ]
      : [];

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <Text style={styles.title}>You</Text>
        <Text style={styles.subtitle}>{RANGE_SUBTITLE[range]}</Text>

        <GrowthCard entries={checkinHistory} streak={checkinStreak} />

        <Card variant="white" style={styles.trendCard}>
          <Text style={styles.cardTitle}>Mood Trend</Text>
          <View style={styles.rangeButtons}>
            <AppButton
              title="Week"
              variant={range === 'week' ? 'primary' : 'ghost'}
              onPress={() => handleRangeChange('week')}
              style={styles.rangeBtn}
            />
            <AppButton
              title="Month"
              variant={range === 'month' ? 'primary' : 'ghost'}
              onPress={() => handleRangeChange('month')}
              style={styles.rangeBtn}
            />
            <AppButton
              title="Year"
              variant={range === 'year' ? 'primary' : 'ghost'}
              onPress={() => handleRangeChange('year')}
              style={styles.rangeBtn}
            />
          </View>
          {trendEmpty ? (
            <EmptyState
              illustration={<GhostTrendChart labels={trendGhostLabels} />}
              title="No Check-Ins Yet"
              message={RANGE_EMPTY_MESSAGE[range]}
              actionLabel="Check In"
              onPressAction={handleGoToCheckIn}
            />
          ) : (
            <>
              <View style={styles.chartRow}>
                {trend.range === 'week'
                  ? trend.days.map((day, i) => <TrendColumn key={i} day={day} />)
                  : trend.days.map((point, i) => (
                      <AggregateColumn
                        key={i}
                        point={point}
                        confidenceMax={AGG_RANGE[trend.range].confidenceMax}
                        maxDot={AGG_RANGE[trend.range].maxDot}
                      />
                    ))}
              </View>
              {trend.days.some((day) => day.label !== '') && (
                <View style={styles.chartLabels}>
                  {trend.days.map((day, i) => (
                    <Text key={i} style={styles.chartLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.4}>
                      {day.label}
                    </Text>
                  ))}
                </View>
              )}
            </>
          )}
        </Card>

        {/* Mood balance and sleep below are behind Developer mode. The tab was a wall of
            instrumentation a participant has no use for; what is left is the tree, the trend, the
            written summary and the Settings row. Everything hidden is still collected.
            Screenshot mode hides them too, so screenshots show what a participant sees. */}
        {devMode && !screenshot && (
        <Card variant="white" style={styles.balanceCard}>
          <Text style={styles.cardTitle}>Mood Balance</Text>
          <Text style={styles.reportSubtitle}>{RANGE_SUBTITLE[range]}</Text>
          {moodCounts.total === 0 ? (
            <EmptyState
              illustration={<GhostBalance />}
              title="No Check-Ins Yet"
              message={`Check in to see ${rangeWord(range)} mood balance.`}
              actionLabel="Check In"
              onPressAction={handleGoToCheckIn}
            />
          ) : (
            <>
              <View style={styles.balanceRow}>
                <View style={styles.balanceStat}>
                  <Text style={styles.balanceValue}>{moodCounts.positive}</Text>
                  <Text style={styles.balanceLabel}>Up</Text>
                </View>
                <Text style={styles.balanceSep}>·</Text>
                <View style={styles.balanceStat}>
                  <Text style={styles.balanceValue}>{moodCounts.negative}</Text>
                  <Text style={styles.balanceLabel}>Down</Text>
                </View>
              </View>
              <View style={styles.balanceBarTrack}>
                <View
                  style={[
                    styles.balanceBarFill,
                    { width: `${(moodCounts.positive / moodCounts.total) * 100}%` },
                  ]}
                />
              </View>
            </>
          )}
        </Card>
        )}

        {devMode && !screenshot && (
          <>
            <Card variant="white" style={styles.statsCard}>
              <Text style={styles.cardTitle}>Daily Stats</Text>
              <Text style={styles.cardNote}>{DEVICE_SCOPED_NOTE}</Text>
              <View style={styles.usageRows}>
                {[...statRows, ...appStepsRow(devStats.appSteps, 'today'), moodCheckRow].map((row) => (
                  <UsageLine
                    key={row.key}
                    label={row.label}
                    value={row.value}
                    caption={row.caption}
                    muted={row.muted}
                    accent={row.accent}
                    onPress={
                      row.debugStreams != null
                        ? debugOpener(row.label, row.debugStreams)
                        : undefined
                    }
                  />
                ))}
              </View>
              <Text style={styles.usageSubheading}>
                {yesterdayScope === 'account'
                  ? 'Yesterday · All Devices'
                  : yesterdayScope === 'device'
                    ? 'Yesterday · This Device'
                    : 'Yesterday'}
              </Text>
              <View style={styles.usageRows}>
                {yesterdayRows.map((row) => (
                  <UsageLine
                    key={row.key}
                    label={row.label}
                    value={row.value}
                    caption={row.caption}
                    muted={row.muted}
                    onPress={
                      row.debugStreams != null
                        ? debugOpener(row.label, row.debugStreams)
                        : undefined
                    }
                  />
                ))}
              </View>
            </Card>
            {statRows.length === 0 && (
              <Card variant="white" style={styles.tilesEmptyCard}>
                <Row
                  icon={<Text style={styles.rowEmoji}>{'\u{1F4CA}'}</Text>}
                  iconBg={colors.primarySoft}
                  title="No Daily Stats Yet"
                  subtitle={
                    anyStatConsent
                      ? 'Steps, screen events, and unlocks appear here once your phone has collected them — usually within a few hours of normal use.'
                      : 'Turn on Motion & activity or Screen & usage in Settings to see steps, screen events, and unlocks here.'
                  }
                />
              </Card>
            )}
          </>
        )}

        {devMode && !screenshot && (
        <Card
          variant="white"
          style={styles.sleepCard}
          onPress={debugOpener('Sleep', ['sleep_night', 'sleep_night_estimated', 'sleep'])}
        >
          <Row
            icon={<Text style={styles.rowEmoji}>{'\u{1F634}'}</Text>}
            iconBg={colors.primarySoft}
            title={sleepNight ? 'Sleep · Last Night' : sleepEstimate ? 'Sleep (Estimated) · Last Night' : 'Sleep · Last Night'}
            subtitle={
              sleepNight
                ? `Slept ${formatClockTime(sleepNight.onsetTs)} – ${formatClockTime(sleepNight.wakeTs)}`
                : sleepEstimate
                  ? `Estimated ${formatClockTime(sleepEstimate.onsetTs)} – ${formatClockTime(sleepEstimate.wakeTs)}, from phone activity`
                  : 'No sleep data yet — this fills in after a night with your phone nearby'
            }
            right={
              devMode ? <Ionicons name="chevron-forward" size={16} color={colors.ink3} /> : undefined
            }
          />
        </Card>
        )}

        {devMode && !screenshot && (
          <Card variant="white" style={styles.statsCard}>
            <Text style={styles.cardTitle}>Phone Use</Text>
            <Text style={styles.cardNote}>{DEVICE_SCOPED_NOTE}</Text>
            <Text style={styles.usageSubheading}>Today</Text>
            <View style={styles.usageRows}>
              {phoneUseRows(usage, 'today').map((row) => (
                <UsageLine
                  key={row.key}
                  label={row.label}
                  value={row.value}
                  caption={row.caption}
                  onPress={
                    row.debugStreams != null
                      ? debugOpener(row.label, row.debugStreams)
                      : undefined
                  }
                />
              ))}
            </View>
            <Text style={styles.usageSubheading}>Yesterday</Text>
            <View style={styles.usageRows}>
              {phoneUseRows(usageYesterday, 'yesterday').map((row) => (
                <UsageLine
                  key={row.key}
                  label={row.label}
                  value={row.value}
                  caption={row.caption}
                  onPress={
                    row.debugStreams != null
                      ? debugOpener(row.label, row.debugStreams)
                      : undefined
                  }
                />
              ))}
            </View>
          </Card>
        )}

        <Card variant="white" style={styles.reportCard}>
          <Text style={styles.cardTitle}>{llmEnabled ? 'Artificial Intelligence Report' : 'Your Summary'}</Text>
          <Text style={styles.reportSubtitle}>
            {llmEnabled
              ? 'A look back at how things have been, in your words and your data.'
              : 'A quick look back at how your day or week has gone.'}
          </Text>
          <View style={styles.reportButtons}>
            <AppButton
              title="Today"
              variant={reportPeriod === 'daily' ? 'primary' : 'ghost'}
              loading={reportLoading === 'daily'}
              disabled={reportLoading != null && reportLoading !== 'daily'}
              onPress={() => handleGenerateReport('daily')}
              style={styles.reportBtn}
            />
            <AppButton
              title="This Week"
              variant={reportPeriod === 'weekly' ? 'primary' : 'ghost'}
              loading={reportLoading === 'weekly'}
              disabled={reportLoading != null && reportLoading !== 'weekly'}
              onPress={() => handleGenerateReport('weekly')}
              style={styles.reportBtn}
            />
          </View>
          {reportError != null && <Text style={styles.reportError}>{reportError}</Text>}
          {reportText != null && <Text style={styles.reportText}>{reportText}</Text>}
        </Card>

        {devRows.length > 0 && !screenshot && (
          <>
            <View style={styles.devHeaderRow}>
              <Pill label="Developer" color={colors.amber} bg={colors.amberSoft} />
              <Text style={styles.devHeaderText}>
                Raw collector output — visible only while Developer mode is on.
              </Text>
            </View>
            <Card variant="white" style={styles.statsCard}>
              <Text style={styles.cardTitle}>Sensors</Text>
              <View style={styles.usageRows}>
                {devRows.map((row) => (
                  <UsageLine
                    key={row.key}
                    label={row.label}
                    value={row.value}
                    caption={row.caption}
                    muted={row.muted}
                    onPress={
                      row.debugStreams != null
                        ? debugOpener(row.label, row.debugStreams)
                        : undefined
                    }
                  />
                ))}
              </View>
            </Card>
            <Card variant="white" style={styles.settingsCard}>
              <Row
                icon={<Text style={styles.rowEmoji}>{'\u{1F5C3}\u{FE0F}'}</Text>}
                iconBg={colors.amberSoft}
                title="All Sensing Events"
                subtitle="Every stream, newest first — raw payloads and upload state"
                right={<Ionicons name="chevron-forward" size={18} color={colors.ink3} />}
                onPress={debugOpener('All sensing events', [])}
              />
            </Card>
          </>
        )}

        {/* Settings is not behind Developer mode: this row is the only entry point every
            participant has. CompanionScreen opens the same screen, but only from the banner shown
            when AI is off — so that one disappears exactly when AI is on. Data & privacy, the
            consent switches and the full consent form all live behind here, and the consent text
            promises participants they can turn any stream off at any time, so it has to stay one
            tap away. Sign out stays visible for the same reason. */}
        <Card variant="white" style={styles.settingsCard}>
          <Row
            icon={<Text style={styles.rowEmoji}>{'⚙️'}</Text>}
            iconBg={colors.surface2}
            title="Settings"
            right={<Ionicons name="chevron-forward" size={18} color={colors.ink3} />}
            onPress={handleOpenSettings}
          />
        </Card>

        {CONFIG.USE_FIREBASE && hasRealSession() && (
          <AppButton
            title="Sign Out"
            variant="ghost"
            onPress={handleSignOut}
            loading={signingOut}
            style={styles.signOutBtn}
          />
        )}
      </ScrollView>
    </Screen>
  );
}

const RING_INNER = 12;
const RING_STEP = 8;
const MAX_RINGS = 4;
const CHART_H = RING_INNER + (MAX_RINGS - 1) * RING_STEP;

function dayA11yLabel(day: TrendDay): string {
  if (day.entries.length === 0) return `${day.label}: no check-ins`;
  const count =
    day.entries.length === 1 ? '1 check-in' : `${day.entries.length} check-ins`;
  const moods = day.entries.map((entry) => MOOD_LABELS[entry.mood]).join(', ');
  return `${day.label}: ${count}, ${moods}`;
}

function TrendColumn({ day }: { day: TrendDay }) {
  const entries = capPoints(day.entries, MAX_RINGS);

  if (entries.length === 0) {
    return (
      <View style={styles.chartCol} accessible accessibilityLabel={dayA11yLabel(day)}>
        <View style={[styles.ringBase, styles.ringHollow]} />
      </View>
    );
  }

  let stack: React.ReactNode = null;
  entries.forEach((entry, i) => {
    const size = RING_INNER + i * RING_STEP;
    stack = (
      <View
        key={i}
        style={[
          styles.ringBase,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: TREND_COLORS[entry.mood],
          },
        ]}
      >
        {stack}
      </View>
    );
  });

  return (
    <View style={styles.chartCol} accessible accessibilityLabel={dayA11yLabel(day)}>
      {stack}
    </View>
  );
}

const MIN_AGG_DOT = 6;
const MIN_AGG_OPACITY = 0.35;
const EMPTY_AGG_DOT = 8;

const AGG_RANGE: Record<'month' | 'year', { confidenceMax: number; maxDot: number }> = {
  month: { confidenceMax: 5, maxDot: 9 },
  year: { confidenceMax: 20, maxDot: 16 },
};

function AggregateColumn({
  point,
  confidenceMax,
  maxDot,
}: {
  point: AggregatePoint;
  confidenceMax: number;
  maxDot: number;
}) {
  if (point.mood == null || point.count === 0) {
    return (
      <View style={styles.chartCol}>
        <View
          style={[
            styles.ringBase,
            styles.ringHollow,
            styles.ringHollowThin,
            { width: EMPTY_AGG_DOT, height: EMPTY_AGG_DOT, borderRadius: EMPTY_AGG_DOT / 2 },
          ]}
        />
      </View>
    );
  }

  const confidence = Math.min(point.count, confidenceMax) / confidenceMax;
  const size = MIN_AGG_DOT + (maxDot - MIN_AGG_DOT) * confidence;
  const opacity = MIN_AGG_OPACITY + (1 - MIN_AGG_OPACITY) * confidence;

  return (
    <View style={styles.chartCol}>
      <View
        style={[
          styles.ringBase,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: TREND_COLORS[point.mood],
            opacity,
          },
        ]}
      />
    </View>
  );
}

function ghostSizeRange(columns: number): { min: number; max: number } {
  if (columns > 12) return { min: MIN_AGG_DOT, max: AGG_RANGE.month.maxDot };
  if (columns > 7) return { min: MIN_AGG_DOT, max: AGG_RANGE.year.maxDot };
  return { min: RING_INNER, max: CHART_H };
}

function GhostTrendChart({ labels }: { labels: string[] }) {
  const { min, max } = ghostSizeRange(labels.length);
  const dense = labels.length > 7;
  // Same column-count inference ghostSizeRange uses (month is the only
  // range denser than year's 12 columns) rather than a separate `range`
  // prop, so this can't disagree with the real chart mid-range-switch.
  // Month's placeholder labels hit the same too-narrow-for-two-digits wrap
  // the real chart does (see the real chartLabels render above), so they're
  // skipped here too — Week/Year ghost labels are unaffected.
  const hideLabels = labels.length > 12;
  return (
    <View>
      <View style={styles.chartRow}>
        {labels.map((_, i) => {
          // One size for every column: varied sizes read as data, and this is only a placeholder.
          const size = (min + max) / 2;
          return (
            <View key={i} style={styles.chartCol}>
              <View
                style={[
                  styles.ringBase,
                  styles.ringGhost,
                  dense && styles.ringHollowThin,
                  { width: size, height: size, borderRadius: size / 2 },
                ]}
              />
            </View>
          );
        })}
      </View>
      {labels.some((label) => label !== '') && (
        <View style={styles.chartLabels}>
          {labels.map((label, i) => (
            <Text key={i} style={styles.chartLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.4}>
              {label}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

function GhostBalance() {
  return (
    <View>
      <View style={styles.balanceRow}>
        <View style={styles.balanceStat}>
          <Text style={[styles.balanceValue, styles.balanceValueMuted]}>{'—'}</Text>
          <Text style={styles.balanceLabel}>up</Text>
        </View>
        <Text style={styles.balanceSep}>·</Text>
        <View style={styles.balanceStat}>
          <Text style={[styles.balanceValue, styles.balanceValueMuted]}>{'—'}</Text>
          <Text style={styles.balanceLabel}>down</Text>
        </View>
      </View>
      <View style={styles.balanceBarTrack} />
    </View>
  );
}

const DEVICE_SCOPED_NOTE =
  'Measured on this device only — sensing data is uploaded but never synced ' +
  'back down, so another phone, or this one after a reinstall, starts empty.';

function fmt(n: number | null): string {
  return n == null ? '—' : String(n);
}

function approximateWait(ms: number): string {
  const secs = Math.ceil(ms / 1000);
  if (secs <= 45) return `about ${Math.max(5, Math.ceil(secs / 5) * 5)} seconds`;
  const mins = Math.round(secs / 60);
  return mins <= 1 ? 'about a minute' : `about ${mins} minutes`;
}

function reportErrorMessage(err: unknown): string {
  if (err instanceof LlmError) {
    switch (err.kind) {
      case 'rate_limited':
        return err.retryAfterMs != null
          ? `The artificial intelligence service is rate-limited right now — try again in ${approximateWait(err.retryAfterMs)}.`
          : 'The artificial intelligence service is rate-limited right now — try again in about a minute.';
      case 'auth':
        return "The artificial intelligence service rejected this app's credentials. This needs a fix in the app setup, not a retry.";
      case 'network':
        return "Could not reach the artificial intelligence service — check your connection and try again.";
      case 'empty':
        return 'The artificial intelligence service returned an empty report — try again.';
      case 'http':
        return `The artificial intelligence service returned an error${err.status != null ? ` (${err.status})` : ''} — try again in a moment.`;
      case 'refusal':
        return 'The artificial intelligence service declined to summarize this period. Your data is fine — this is the model being cautious, not an error in the app.';
      case 'disabled':
        return 'Artificial intelligence features are switched off in this build, so there is no report to generate.';
    }
  }
  return "Could not build the report from your local data. Reopening the app usually clears this.";
}

function fmtSample(s: LatestSample | null, unit: string, digits = 0): string {
  if (s == null) return '—';
  return `${s.value.toFixed(digits)}${unit}`;
}

function UsageLine({
  label,
  value,
  caption,
  muted = false,
  accent = false,
  onPress,
}: {
  label: string;
  value: string;
  caption?: string;
  muted?: boolean;
  accent?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <>
      <View style={styles.usageLabelWrap}>
        <Text style={styles.usageLabel}>{label}</Text>
        {caption != null && <Text style={styles.usageCaption}>{caption}</Text>}
      </View>
      <View style={styles.usageValueWrap}>
        <Text
          style={[
            styles.usageValue,
            accent && styles.usageValueAccent,
            (muted || value === '—') && styles.usageValueMuted,
          ]}
        >
          {value}
        </Text>
        {onPress != null && (
          <Ionicons name="chevron-forward" size={14} color={colors.ink3} />
        )}
      </View>
    </>
  );
  if (onPress == null) return <View style={styles.usageLine}>{body}</View>;
  return (
    <Pressable style={styles.usageLine} onPress={onPress} hitSlop={{ top: 8, bottom: 8 }}>
      {body}
    </Pressable>
  );
}

/** iOS only reports that usage passed a threshold, never the real total, so the value is a floor like "30m+". Keep the "+" or it reads as an exact number. */
function fmtThreshold(minutes: number | null): string {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${fmtHoursMinutes(h, m)}+`;
}

function usageCategoryCaption(iosThreshold: number | null): string | undefined {
  if (Platform.OS === 'android') return undefined;
  if (Platform.OS !== 'ios') return 'mobile only';
  return iosThreshold != null
    ? 'at least this much — iOS reports thresholds, not totals'
    : 'under the lowest threshold, or not set up in Settings';
}

/**
 * On iPhone an empty Calls row has two very different causes, and the row is useless unless it says
 * which: no calls, or MoodSense was never running to hear them. `keepAlive` is what separates them.
 */
function callCaption(
  callMs: number | null,
  when: DayScope,
  keepAlive: iosUsage.CallKeepAliveStatus | null
): string | undefined {
  if (Platform.OS === 'android') {
    if (callMs != null) return 'estimated from time in the phone app';
    return when === 'today' ? 'no calls recorded yet' : 'no calls recorded';
  }
  if (Platform.OS !== 'ios') return 'mobile only';
  if (keepAlive === 'unavailable') {
    return 'this build cannot listen in the background — only calls made with MoodSense open count';
  }
  if (keepAlive === 'denied' || keepAlive === 'notDetermined' || keepAlive === 'whenInUse') {
    return callMs != null
      ? 'measured — calls made while MoodSense was closed are missed; see Settings'
      : 'MoodSense cannot keep listening — set Location to Always in Settings';
  }
  return callMs != null
    ? 'measured — only calls while the app was running'
    : 'no calls recorded while the app was running';
}

function fmtShortDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 60_000) {
    const s = Math.max(1, Math.round(ms / 1000));
    return `${s} ${s === 1 ? 'second' : 'seconds'}`;
  }
  return fmtDuration(ms);
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—';
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return fmtHoursMinutes(h, m);
}

/** Spelled out ("2 hours 5 minutes"), never "2h 5m". */
function fmtHoursMinutes(h: number, m: number): string {
  const hours = `${h} ${h === 1 ? 'hour' : 'hours'}`;
  const minutes = `${m} ${m === 1 ? 'minute' : 'minutes'}`;
  if (h === 0) return minutes;
  return m > 0 ? `${hours} ${minutes}` : hours;
}

function fmtSampleAge(s: LatestSample | null): string | undefined {
  if (s == null) return undefined;
  return fmtAge(s.ts);
}

function fmtAge(ts: number): string {
  const diffMs = Date.now() - ts;
  if (diffMs < 60_000) return 'just now';
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function fmtUploadSync(u: UploadStatus | null): string | undefined {
  if (u == null) return undefined;
  const lastOk = u.lastSuccessTs == null ? 'never' : fmtAge(u.lastSuccessTs);
  if (u.consecutiveFailures > 0) {
    return `Not syncing: ${u.consecutiveFailures} failed · last ok ${lastOk}`;
  }
  return `Last synced ${lastOk}`;
}

type DayScope = 'today' | 'yesterday';

interface RowSpec {
  key: string;
  value: string;
  label: string;
  caption?: string;
  muted?: boolean;
  accent?: boolean;
  debugStreams?: string[];
}

const styles = StyleSheet.create({
  scroll: {
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  title: {
    ...type.title,
    color: colors.ink,
  },
  subtitle: {
    ...type.sub,
    color: colors.ink2,
    marginTop: spacing.xs,
  },
  cardTitle: {
    ...type.h2,
    color: colors.ink,
  },
  cardNote: {
    ...type.caption,
    color: colors.ink3,
    marginTop: 4,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  trendCard: {
    marginTop: spacing.lg,
  },
  rangeButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  rangeBtn: {
    flex: 1,
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: CHART_H,
    marginTop: spacing.md,
  },
  chartCol: {
    flex: 1,
    height: CHART_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringBase: {
    width: RING_INNER,
    height: RING_INNER,
    borderRadius: RING_INNER / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringHollow: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.ink3,
  },
  ringHollowThin: {
    borderWidth: 1.5,
  },
  ringGhost: {
    borderWidth: 2,
    borderColor: colors.ink3,
    opacity: 0.35,
  },
  chartLabels: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  chartLabel: {
    flex: 1,
    textAlign: 'center',
    ...type.caption,
    color: colors.ink3,
  },
  balanceCard: {
    marginTop: spacing.lg,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  balanceStat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  balanceValue: {
    ...type.title,
    color: colors.ink,
  },
  balanceValueMuted: {
    color: colors.ink3,
  },
  balanceLabel: {
    ...type.sub,
    color: colors.ink3,
  },
  balanceSep: {
    ...type.body,
    color: colors.ink3,
  },
  balanceBarTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  balanceBarFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.teal,
  },
  statsCard: {
    marginTop: spacing.lg,
    paddingVertical: spacing.xs,
  },
  tilesEmptyCard: {
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
  },
  devHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
  },
  devHeaderText: {
    ...type.caption,
    color: colors.ink3,
    marginLeft: spacing.sm,
    flex: 1,
  },
  usageSubheading: {
    ...type.caption,
    color: colors.ink3,
    marginTop: spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  usageRows: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  usageLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  usageLabelWrap: {
    flexShrink: 1,
  },
  usageLabel: {
    ...type.body,
    color: colors.ink,
  },
  usageCaption: {
    ...type.caption,
    color: colors.ink3,
    marginTop: 2,
  },
  usageValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  usageValue: {
    ...type.h2,
    color: colors.ink,
  },
  usageValueMuted: {
    color: colors.ink3,
  },
  usageValueAccent: {
    color: colors.primaryDeep,
  },
  sleepCard: {
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
  },
  rowEmoji: {
    fontSize: 18,
  },
  reportCard: {
    marginTop: spacing.lg,
  },
  reportSubtitle: {
    ...type.sub,
    color: colors.ink2,
    marginTop: spacing.xs,
  },
  reportButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  reportBtn: {
    flex: 1,
  },
  reportError: {
    ...type.sub,
    color: colors.rose,
    marginTop: spacing.md,
  },
  reportText: {
    ...type.body,
    color: colors.ink,
    marginTop: spacing.md,
    lineHeight: 21,
  },
  settingsCard: {
    marginTop: spacing.lg,
    paddingVertical: spacing.xs,
  },
  signOutBtn: {
    marginTop: spacing.lg,
  },
});
