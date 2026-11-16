import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { Card, EmptyState } from '../../components';
import { colors, radius, spacing, type } from '../../theme';
import { MASCOT_NAMES } from './mascotRoster';
import { MoodMascot, useMascotOnDuty } from './MoodMascot';
import {
  basisDigest,
  companionLine,
  dayFeelWord,
  sliceSeries,
  trendSummary,
  type TrendPoint,
  type TrendSeries,
} from './wellbeingTrend';

/**
 * Chart colors, not theme tokens: the sage brand color reads gray at line weight and is too close to the theme's
 * blue-violet, so this pair was picked to stay apart for color-blind readers (checked with the dataviz validator).
 * The lines also differ by dash, so color is never the only cue.
 */
const FELT = '#2f8a5e';
const RHYTHM = '#6a5fb8';

const RANGES = [
  { days: 7, label: 'Week' },
  { days: 14, label: '2 Weeks' },
  { days: 30, label: 'Month' },
] as const;

const PLOT_H = 120;
const PAD_Y = 10;
const DOT_R = 4.5;

/** Widest an x-axis label box gets, and the floor it will not shrink below; `labelBoxWidth` picks
 *  between them. Capping the box at one step is what keeps two labels from printing over each
 *  other on a crowded range. */
const LABEL_W = 48;
const MIN_LABEL_W = 26;

/**
 * Width of one x-axis label box, and with it the inset the first and last points sit at.
 *
 * The two have to be decided together. A label is centred on its point, so a point flush against
 * the plot's edge wants half a box of room outside the plot; it used to be given none, and the end
 * label was shoved back inside instead — which on a week (eight points across roughly one step of
 * label each) slid "Next" left far enough to print over "Now" and read as "NowNext".
 *
 * Insetting the points by half a box costs a few pixels of chart and makes the overlap arithmetically
 * impossible: boxes are a step wide at most, centred a step apart, and the end ones have exactly the
 * half-box they need. `width / count` rather than `width / (count - 1)` is what makes the two agree —
 * at that inset the step works out to the same value, so no clamp is needed anywhere.
 */
function labelBoxWidth(width: number, count: number): number {
  return Math.max(MIN_LABEL_W, Math.min(LABEL_W, count > 0 ? width / count : LABEL_W));
}

/** Width of the y-axis gutter. Wide enough for "OKAY" at caption size with letter spacing. */
const AXIS_W = 44;
/** A tick's own height, so it can be centred on the value it marks. */
const Y_TICK_H = 20;

/** Pixel row for a 0-1 value. Module scope because the y-axis ticks need it before any layout pass. */
function plotY(value: number): number {
  return PAD_Y + (1 - value) * (PLOT_H - 2 * PAD_Y);
}

/**
 * The vertical axis, as three words. Both lines share one 0-1 scale that is not a score and has no
 * units, so the axis has to say which end is which. Faces were tried here and read as a judgement
 * of the day rather than a label for a position; LOW / OKAY / HIGH names the position and nothing
 * else. Set in title case and uppercased in the style, matching the other axis-style labels.
 */
const Y_TICKS: { value: number; label: string }[] = [
  { value: 1, label: 'High' },
  { value: 0.5, label: 'Okay' },
  { value: 0, label: 'Low' },
];

/** Screen-reader only: the axis words carry this on sight, so the card does not print it. */
const AXIS_CAPTION = 'Up the chart is a lighter day, down is a heavier one.';

/**
 * The long form names the day in a sentence; the short form goes under the chart, where the two end
 * labels sit about a step apart and "Today"/"Tmrw" were wide enough at caption size to run into each
 * other. "Now"/"Next" fit inside one step, and the x-label box is capped at a step as well, so the
 * labels cannot overlap at any width.
 */
function dayLabel(date: string, ahead: boolean, isToday: boolean, long: boolean): string {
  if (ahead) return long ? 'Tomorrow' : 'Next';
  if (isToday) return long ? 'Today' : 'Now';
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d);
  return long
    ? dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : dt.toLocaleDateString('en-US', { weekday: 'long' });
}

function describe(p: TrendPoint, isToday: boolean): string {
  const when = dayLabel(p.date, p.ahead, isToday, true);
  if (p.ahead) return `${when} · may feel ${dayFeelWord(p.rhythm)}`;
  const felt = p.felt == null ? 'not shared' : `felt ${dayFeelWord(p.felt)}`;
  const rhythm = p.partial
    ? `rhythm so far ${dayFeelWord(p.rhythm)}`
    : `rhythm ${dayFeelWord(p.rhythm)}`;
  return `${when} · ${felt} · ${rhythm}`;
}

/** Breaks the path wherever a value is missing, so a day nobody shared stays blank instead of being bridged. */
function linePath(xs: number[], ys: Array<number | null>): string {
  let d = '';
  let open = false;
  ys.forEach((y, i) => {
    if (y == null) {
      open = false;
      return;
    }
    d += `${open ? 'L' : 'M'}${xs[i]!.toFixed(1)},${y.toFixed(1)} `;
    open = true;
  });
  return d.trim();
}

export function WellbeingTrendCard({ series }: { series: TrendSeries | null }) {
  const [days, setDays] = useState<number>(7);
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  /** The day whose basis panel is open. Separate from `selected`: a tap reads the point, a hold opens it up. */
  const [held, setHeld] = useState<string | null>(null);
  const mascot = useMascotOnDuty();

  const shown = useMemo(() => (series ? sliceSeries(series, days) : null), [series, days]);
  const points = shown?.points ?? [];
  const past = points.filter((p) => !p.ahead);
  const todayKey = past[past.length - 1]?.date ?? null;

  const geom = useMemo(() => {
    if (width <= 0 || points.length === 0) return null;
    const boxW = labelBoxWidth(width, points.length);
    // Half a label box, and never less than a dot's radius, so neither the end labels nor the end
    // dots are clipped by the plot's edge.
    const edge = Math.max(DOT_R + 1, boxW / 2);
    const step = points.length > 1 ? (width - 2 * edge) / (points.length - 1) : 0;
    const xs = points.map((_, i) => edge + i * step);
    return { xs, y: plotY, step, boxW };
  }, [width, points]);

  /**
   * Whether there is anything to chart yet. `?? hasFelt` covers a series cached by a build from
   * before `everFelt` existed, the same reason `basis` is guarded below.
   */
  const everFelt = series?.everFelt ?? series?.hasFelt ?? false;

  const picked = points.find((p) => p.date === selected) ?? null;
  // `basis` is guarded rather than assumed: points come back through a serialised cache, so a
  // entry written by an older build deserialises into a point without one.
  const opened = points.find((p) => p.date === held && p.basis != null) ?? null;
  const showEveryLabel = days <= 7;

  return (
    <Card>
      <View
        style={styles.header}
        accessible
        accessibilityLabel={
          shown == null
            ? "How you have been. Loading."
            : everFelt
              ? `How you have been. ${companionLine(shown, MASCOT_NAMES[mascot])} ${AXIS_CAPTION} ${trendSummary(shown)}`
              // No chart below yet, so the axis and the tomorrow reading would be describing
              // something that is not on screen.
              : `How you have been. ${companionLine(shown, MASCOT_NAMES[mascot])}`
        }
      >
        <MoodMascot mood="calm" mascot={mascot} size={36} />
        <View style={styles.headerText}>
          <Text style={styles.title}>How You Have Been</Text>
          <Text style={styles.line} numberOfLines={1}>
            {shown ? companionLine(shown, MASCOT_NAMES[mascot]) : 'Gathering your days…'}
          </Text>
        </View>
      </View>

      {series && !everFelt ? (
        /* A new account has no shared days and no passive history, so the only line there is to
           draw is the untrained prior — a dashed guess across a week the app was not here for,
           ending in a hollow dot predicting a person it has never met. Nothing is plotted until
           there is a first day to plot. */
        <EmptyState
          message="Once you have shared a day or two, this is where you will see how the week has been going — and a gentle look at tomorrow."
          style={styles.empty}
        />
      ) : (
      <>
        <View style={styles.ranges} accessibilityRole="tablist">
          {RANGES.map((r) => {
            const on = r.days === days;
            return (
              <Pressable
                key={r.days}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  setDays(r.days);
                  setSelected(null);
                  setHeld(null);
                }}
                style={[styles.range, on && styles.rangeOn]}
              >
                <Text style={[styles.rangeText, on && styles.rangeTextOn]}>{r.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.plotRow}>
          {/* The axis the two lines are plotted against. It carries the meaning of the vertical
              position, which the chart had no way of stating before — a reader could see one day
              sitting above another without being told what "above" was. */}
          <View
            style={styles.yAxis}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {Y_TICKS.filter((t) => t.value !== 0.5).map((tick) => (
              <Text
                key={tick.label}
                numberOfLines={1}
                style={[styles.yTick, { top: plotY(tick.value) - Y_TICK_H / 2 }]}
              >
                {tick.label}
              </Text>
            ))}
          </View>
          <View
            style={styles.plot}
            onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          >
            {geom && shown && (
              <Svg width={width} height={PLOT_H}>
                {/* One rule per tick, so a label on the left has something to line up with. All three
                    are dashed: a solid rule read as part of the data next to the solid felt line. */}
                {Y_TICKS.map((tick) => (
                  <Line
                    key={tick.label}
                    x1={0}
                    x2={width}
                    y1={geom.y(tick.value)}
                    y2={geom.y(tick.value)}
                    stroke={colors.line}
                    strokeWidth={1}
                    strokeDasharray="1 5"
                  />
                ))}
                {/* The forecast zone: a soft band from halfway between "Now" and "Next" to the right edge,
                    so the future reads as a different place from the days already lived. */}
                {geom.xs.length > 1 && (
                  <Rect
                    x={(geom.xs[geom.xs.length - 2]! + geom.xs[geom.xs.length - 1]!) / 2}
                    y={0}
                    width={width - (geom.xs[geom.xs.length - 2]! + geom.xs[geom.xs.length - 1]!) / 2}
                    height={PLOT_H}
                    rx={8}
                    fill={RHYTHM}
                    fillOpacity={0.1}
                  />
                )}
                {picked && (
                  <Line
                    x1={geom.xs[points.indexOf(picked)]!}
                    x2={geom.xs[points.indexOf(picked)]!}
                    y1={0}
                    y2={PLOT_H}
                    stroke={colors.ink3}
                    strokeWidth={1}
                  />
                )}
                <Path
                  d={linePath(geom.xs, points.map((p) => geom.y(p.rhythm)))}
                  stroke={RHYTHM}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  strokeLinecap="round"
                  fill="none"
                />
                <Path
                  d={linePath(geom.xs, points.map((p) => (p.felt == null ? null : geom.y(p.felt))))}
                  stroke={FELT}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill="none"
                />
                {points.map((p, i) =>
                  p.felt == null ? null : (
                    <Circle
                      key={`f-${p.date}`}
                      cx={geom.xs[i]!}
                      cy={geom.y(p.felt)}
                      r={DOT_R}
                      fill={FELT}
                      stroke={colors.surface}
                      strokeWidth={2}
                    />
                  )
                )}
                {/* Tomorrow is hollow and sits on the dashed line, with a halo and a heavier last segment
                    so it reads as the point of the chart rather than a stray end dot. */}
                {geom.xs.length > 1 && (
                  <Path
                    d={linePath(
                      geom.xs.slice(-2),
                      points.slice(-2).map((p) => geom.y(p.rhythm))
                    )}
                    stroke={RHYTHM}
                    strokeWidth={3.5}
                    strokeDasharray="5 4"
                    strokeLinecap="round"
                    fill="none"
                  />
                )}
                <Circle
                  cx={geom.xs[geom.xs.length - 1]!}
                  cy={geom.y(shown.tomorrow)}
                  r={DOT_R + 6}
                  fill={RHYTHM}
                  fillOpacity={0.18}
                />
                <Circle
                  cx={geom.xs[geom.xs.length - 1]!}
                  cy={geom.y(shown.tomorrow)}
                  r={DOT_R + 1.5}
                  fill={colors.surface}
                  stroke={RHYTHM}
                  strokeWidth={3}
                />
              </Svg>
            )}
            {geom && geom.xs.length > 1 && (
              // Sits over the forecast band itself, so the prediction reads as labelled rather
              // than as an unexplained tint a reader has to notice and interpret on their own.
              <View style={styles.forecastBadge} pointerEvents="none">
                <Text style={styles.forecastBadgeText}>Forecast</Text>
              </View>
            )}
            {geom && (
              <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                {points.map((p, i) => (
                  <Pressable
                    key={`hit-${p.date}`}
                    accessibilityLabel={describe(p, p.date === todayKey)}
                    accessibilityHint="Double tap and hold to see the signals this reading came from"
                    onPress={() => {
                      setSelected(selected === p.date ? null : p.date);
                      setHeld(null);
                    }}
                    onLongPress={() => {
                      setSelected(p.date);
                      setHeld(held === p.date ? null : p.date);
                    }}
                    delayLongPress={250}
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: geom.xs[i]! - Math.max(geom.step, 16) / 2,
                      width: Math.max(geom.step, 16),
                    }}
                  />
                ))}
              </View>
            )}
          </View>
        </View>

        {geom && (
          <View style={styles.xLabels}>
            {points.map((p, i) => {
              const isToday = p.date === todayKey;
              // Longer ranges keep only the ends; every day's label would overlap at a month's step.
              const visible = showEveryLabel || i === 0 || p.ahead;
              if (!visible) return null;
              return (
                <Text
                  key={`x-${p.date}`}
                  // The row is one line tall, so a label that did not quite fit its box would wrap
                  // into a second line and be clipped rather than simply running a little wide.
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.4}
                  style={[
                    styles.xLabel,
                    { width: geom.boxW, left: geom.xs[i]! - geom.boxW / 2 },
                    (isToday || p.ahead) && styles.xLabelStrong,
                    p.ahead && { color: RHYTHM },
                  ]}
                >
                  {dayLabel(p.date, p.ahead, isToday, false)}
                </Text>
              );
            })}
          </View>
        )}

        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.swatchSolid, { backgroundColor: FELT }]} />
            <Text style={styles.legendText}>How You Said You Felt</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={styles.swatchDashed}>
              <View style={[styles.dash, { backgroundColor: RHYTHM }]} />
              <View style={[styles.dash, { backgroundColor: RHYTHM }]} />
            </View>
            <Text style={styles.legendText}>Your Daily Rhythm</Text>
          </View>
        </View>

        <Text style={styles.forecastCaption}>What we expect for tomorrow</Text>
        {picked && (
          <Text style={styles.caption} numberOfLines={1}>
            {describe(picked, picked.date === todayKey)}
          </Text>
        )}
      </>
      )}
      {/* A bubble rather than a panel: one sentence about why the line sits where it does, which
          is what holding a point is asking. Tapping it anywhere puts it away. */}
      {opened && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${dayLabel(opened.date, opened.ahead, opened.date === todayKey, true)}. ${basisDigest(opened)}. Tap to hide.`}
          onPress={() => setHeld(null)}
          style={styles.bubble}
        >
          <Text style={styles.bubbleDay}>
            {dayLabel(opened.date, opened.ahead, opened.date === todayKey, true)}
          </Text>
          <Text style={styles.bubbleText}>{basisDigest(opened)}</Text>
        </Pressable>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
  },
  title: {
    ...type.h2,
    color: colors.ink,
  },
  line: {
    ...type.sub,
    color: colors.ink2,
    marginTop: 2,
    lineHeight: 20,
  },
  ranges: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  range: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
  },
  rangeOn: {
    backgroundColor: colors.primarySoft,
  },
  rangeText: {
    ...type.caption,
    color: colors.ink2,
  },
  rangeTextOn: {
    color: colors.primaryDeep,
    fontWeight: '700',
  },
  caption: {
    ...type.caption,
    color: colors.ink3,
    marginTop: spacing.sm,
  },
  plotRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  yAxis: {
    width: AXIS_W,
    height: PLOT_H,
  },
  yTick: {
    ...type.caption,
    color: colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontSize: 11,
    position: 'absolute',
    left: 0,
    right: spacing.xs,
    height: Y_TICK_H,
    lineHeight: Y_TICK_H,
    textAlign: 'right',
  },
  plot: {
    flex: 1,
    height: PLOT_H,
  },
  forecastBadge: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: RHYTHM,
  },
  forecastBadgeText: {
    ...type.caption,
    color: colors.surface,
    fontWeight: '700',
  },
  forecastCaption: {
    ...type.caption,
    color: colors.ink3,
    marginTop: spacing.sm,
  },
  xLabels: {
    height: 16,
    marginTop: spacing.xs,
    marginLeft: AXIS_W,
  },
  xLabel: {
    ...type.caption,
    color: colors.ink3,
    position: 'absolute',
    textAlign: 'center',
  },
  xLabelStrong: {
    color: colors.ink2,
    fontWeight: '700',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.md,
    rowGap: spacing.xs,
    marginTop: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  swatchSolid: {
    width: 16,
    height: 2,
    borderRadius: 1,
  },
  swatchDashed: {
    width: 16,
    flexDirection: 'row',
    gap: 3,
  },
  dash: {
    flex: 1,
    height: 2,
    borderRadius: 1,
  },
  legendText: {
    ...type.caption,
    color: colors.ink2,
  },
  empty: {
    marginTop: spacing.md,
  },
  bubble: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    maxWidth: '92%',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
  },
  bubbleDay: {
    ...type.caption,
    color: colors.ink3,
    fontWeight: '700',
  },
  bubbleText: {
    ...type.caption,
    color: colors.ink,
    marginTop: 1,
  },
});
