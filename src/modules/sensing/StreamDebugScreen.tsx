/**
 * Raw sensing_events inspector, reached only from InsightsScreen while Developer mode is on.
 * Unlike every other sensing view it shows the collector's exact output, not a rollup.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Platform,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AppButton, Card, Pill, Screen } from '../../components';
import { colors, radius, spacing, type } from '../../theme';
import type { RootStackScreenProps } from '../../navigation';
import { rawStreamRows, streamSummaries, type RawStreamRow, type StreamSummary } from './queue';
import { syncIosUsageMonitoring } from './collectors';
import * as iosUsage from '../../../modules/moodsense-ios-usage';

/** The streams whose "no rows yet" is worth explaining with native state rather than a generic hint. */
const IOS_DIAGNOSTIC_STREAMS = ['app_usage_threshold', 'app_usage_probe', 'call', 'call_coverage'];

/** react-native has no cross-platform 'monospace' alias, so the face is named per platform. */
const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const PAGE = 100;

/** Payloads are truncated past this so one huge row cannot push everything below it off the screen; Share still gives the full text. */
const MAX_PAYLOAD_CHARS = 800;

export default function StreamDebugScreen({ route }: RootStackScreenProps<'StreamDebug'>) {
  // `streams: []` means every stream; rawStreamRows and streamSummaries both treat an empty list that way.
  const { streams, title } = route.params;

  const [summaries, setSummaries] = useState<StreamSummary[]>([]);
  const [rows, setRows] = useState<RawStreamRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<iosUsage.UsageDiagnostics | null>(null);
  const [rearming, setRearming] = useState(false);

  // Every failure in the iOS Screen Time and CallKit chain looks like an empty table, so the native
  // state is shown next to the empty table rather than left to be inferred from it.
  const showDiagnostics =
    Platform.OS === 'ios' &&
    iosUsage.isAvailable &&
    (streams.length === 0 || streams.some((s) => IOS_DIAGNOSTIC_STREAMS.includes(s)));

  const loadDiagnostics = useCallback(async () => {
    if (!showDiagnostics) return;
    setDiagnostics(await iosUsage.usageDiagnostics());
  }, [showDiagnostics]);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [sums, page] = await Promise.all([
        streamSummaries(streams),
        rawStreamRows(streams, PAGE, 0),
      ]);
      setSummaries(sums);
      setRows(page);
      setHasMore(page.length === PAGE);
      await loadDiagnostics();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, [streams, loadDiagnostics]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleLoadMore = useCallback(() => {
    void (async () => {
      setLoadingMore(true);
      try {
        const next = await rawStreamRows(streams, PAGE, rows.length);
        setRows((prev) => [...prev, ...next]);
        setHasMore(next.length === PAGE);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingMore(false);
      }
    })();
  }, [streams, rows.length]);

  // iOS only reads the monitoring plan when it is (re)started, so this is the one way to apply a
  // changed selection or a newly granted authorization without backgrounding the app.
  const handleRearm = useCallback(() => {
    void (async () => {
      setRearming(true);
      try {
        await syncIosUsageMonitoring();
        await loadDiagnostics();
      } finally {
        setRearming(false);
      }
    })();
  }, [loadDiagnostics]);

  const handleShare = useCallback(() => {
    void Share.share({
      title,
      message: [
        `${title} — ${rows.length} rows`,
        ...rows.map(
          (r) =>
            `[${formatStamp(r.ts)}] ${r.stream}${r.dedupeKey ? ` (${r.dedupeKey})` : ''} ${
              r.uploaded ? 'uploaded' : 'pending'
            }\n${r.payload}`
        ),
      ].join('\n\n'),
    }).catch(() => {
    });
  }, [rows, title]);

  return (
    <Screen edges={['bottom']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor={colors.primary} />
        }
      >
        <View style={styles.devHeaderRow}>
          <Pill label="Developer" color={colors.amber} bg={colors.amberSoft} />
          <Text style={styles.devHeaderText}>
            Raw sensing_events rows for this account, newest first. Pull to refresh.
          </Text>
        </View>

        {/* A stream with total 0 still gets a card, since "this collector never fired" is the most common thing this screen is opened to confirm. */}
        {summaries.map((s) => (
          <Card key={s.stream} variant="white" style={styles.summaryCard}>
            <View style={styles.summaryHead}>
              <Text style={styles.streamName}>{s.stream}</Text>
              {s.pending > 0 && (
                <Pill label={`${s.pending} pending`} color={colors.amber} bg={colors.amberSoft} />
              )}
            </View>
            <Text style={styles.summaryLine}>
              {s.total} rows total · {s.today} today
            </Text>
            <Text style={styles.summaryLine}>
              {s.lastTs != null
                ? `Last write ${formatStamp(s.lastTs)} (${formatAge(s.lastTs)})`
                : 'Never written on this device/account'}
            </Text>
            {s.firstTs != null && (
              <Text style={styles.summaryLine}>First write {formatStamp(s.firstTs)}</Text>
            )}
          </Card>
        ))}

        {summaries.length === 0 && !refreshing && (
          <Card variant="white" style={styles.summaryCard}>
            <Text style={styles.summaryLine}>No sensing events recorded for this account yet.</Text>
          </Card>
        )}

        {error != null && (
          <Card variant="white" style={styles.summaryCard}>
            <Text style={styles.errorText}>Query failed: {error}</Text>
          </Card>
        )}

        {rows.length > 0 && (
          <View style={styles.logHeaderRow}>
            <Text style={styles.logHeader}>
              Showing {rows.length} row{rows.length === 1 ? '' : 's'}
            </Text>
            <AppButton title="Share" variant="ghost" onPress={handleShare} style={styles.shareBtn} />
          </View>
        )}

        {rows.map((row) => (
          <Card key={row.id} variant="white" style={styles.rowCard}>
            <View style={styles.rowHead}>
              <Text style={styles.rowStamp}>{formatStamp(row.ts)}</Text>
              <Text style={styles.rowAge}>{formatAge(row.ts)}</Text>
            </View>
            <View style={styles.rowMeta}>
              <Text style={styles.rowStream}>{row.stream}</Text>
              <Text style={styles.rowId}>#{row.id}</Text>
              <Text style={row.uploaded ? styles.rowUploaded : styles.rowPending}>
                {row.uploaded ? 'uploaded' : 'pending'}
              </Text>
            </View>
            {row.dedupeKey != null && (
              <Text style={styles.rowDedupe}>dedupe: {row.dedupeKey}</Text>
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text style={styles.payload}>{formatPayload(row.payload)}</Text>
            </ScrollView>
          </Card>
        ))}

        {hasMore && rows.length > 0 && (
          <AppButton
            title="Load more"
            variant="ghost"
            loading={loadingMore}
            onPress={handleLoadMore}
            style={styles.moreBtn}
          />
        )}

        {rows.length === 0 && !refreshing && error == null && (
          <Card variant="white" style={styles.rowCard}>
            <Text style={styles.summaryLine}>
              No rows yet. If a collector should be running, check consent in Settings and the operating system
              permission for that data source.
            </Text>
          </Card>
        )}

        {showDiagnostics && (
          <Card variant="white" style={styles.summaryCard}>
            <Text style={styles.streamName}>iOS native state</Text>
            {diagnostics == null ? (
              <Text style={styles.summaryLine}>Unavailable — the native module did not answer.</Text>
            ) : (
              <>
                <Text style={styles.summaryLine}>
                  Screen Time authorization: {diagnostics.authorization}
                  {diagnostics.appGroupConfigured ? '' : ' · no App Group in this build'}
                </Text>
                <Text style={styles.summaryLine}>
                  Apps picked — social {fmtSelection(diagnostics.selections.social)}, audio/video{' '}
                  {fmtSelection(diagnostics.selections.audioVideo)}, total{' '}
                  {fmtSelection(diagnostics.selections.total)}
                </Text>
                <Text style={styles.summaryLine}>
                  Thresholds registered: {diagnostics.monitoredEventCount} (budget{' '}
                  {diagnostics.eventBudget}) · iOS is{' '}
                  {diagnostics.activityRegistered ? 'monitoring' : 'NOT monitoring'}
                </Text>
                <Text style={styles.summaryLine}>
                  Crossings waiting to be read: {diagnostics.pendingThresholdEvents}
                </Text>
                <Text style={styles.summaryLine}>
                  Calls: {diagnostics.callSensingEnabled ? 'listening' : 'off'} · location{' '}
                  {diagnostics.callKeepAlive}
                </Text>
              </>
            )}
            <AppButton
              title="Re-arm monitoring"
              variant="ghost"
              loading={rearming}
              onPress={handleRearm}
              style={styles.moreBtn}
            />
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

function fmtSelection(count: iosUsage.SelectionCount | undefined): string {
  const apps = count?.applications ?? 0;
  const categories = count?.categories ?? 0;
  if (apps + categories === 0) return 'none';
  return `${apps} app${apps === 1 ? '' : 's'}, ${categories} categor${categories === 1 ? 'y' : 'ies'}`;
}

function formatStamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  );
}

function formatAge(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return 'in the future';
  if (diff < 60_000) return `${Math.round(diff / 1000)} seconds ago`;
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function formatPayload(payload: string): string {
  let text = payload;
  try {
    text = JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    text = `(unparseable) ${payload}`;
  }
  return text.length > MAX_PAYLOAD_CHARS
    ? `${text.slice(0, MAX_PAYLOAD_CHARS)}\n… (${text.length - MAX_PAYLOAD_CHARS} more chars — use Share)`
    : text;
}

const styles = StyleSheet.create({
  scroll: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  devHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  devHeaderText: {
    ...type.caption,
    color: colors.ink2,
    flex: 1,
  },
  summaryCard: {
    marginBottom: spacing.sm,
  },
  summaryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  streamName: {
    ...type.h2,
    color: colors.ink,
    fontFamily: MONO,
  },
  summaryLine: {
    ...type.sub,
    color: colors.ink2,
    marginTop: spacing.xs,
  },
  errorText: {
    ...type.sub,
    color: colors.rose,
  },
  logHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  logHeader: {
    ...type.caption,
    color: colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  shareBtn: {
    paddingHorizontal: spacing.lg,
  },
  rowCard: {
    marginBottom: spacing.sm,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  rowStamp: {
    ...type.sub,
    color: colors.ink,
    fontFamily: MONO,
  },
  rowAge: {
    ...type.caption,
    color: colors.ink3,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  rowStream: {
    ...type.caption,
    color: colors.primary,
    fontFamily: MONO,
  },
  rowId: {
    ...type.caption,
    color: colors.ink3,
  },
  rowUploaded: {
    ...type.caption,
    color: colors.teal,
  },
  rowPending: {
    ...type.caption,
    color: colors.amber,
  },
  rowDedupe: {
    ...type.caption,
    color: colors.ink3,
    fontFamily: MONO,
    marginTop: spacing.xs,
  },
  payload: {
    ...type.caption,
    color: colors.ink2,
    fontFamily: MONO,
    marginTop: spacing.sm,
    backgroundColor: colors.surface2,
    borderRadius: radius.sm,
    padding: spacing.sm,
    lineHeight: 16,
  },
  moreBtn: {
    marginTop: spacing.sm,
  },
});
