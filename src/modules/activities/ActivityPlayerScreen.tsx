/**
 * Runs one activity (breathing / stretch / grounding) start to finish, with a spoken guide and background music under it.
 * `activity_complete` is only logged once computePhaseState reports `done`, so pausing or exiting early can never produce a false completion.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppButton, Screen } from '../../components';
import { colors, radius, spacing, type } from '../../theme';
import type { RootStackScreenProps } from '../../navigation';
import { logEvent } from '../../services/logging';
import { computePhaseState, formatClock, getActivity, goalHeadline } from './config';
import { BreathingCircle, PoseCrossfade, StretchFollowAlong, stretchMoveForLabel } from './Animations';
import { useAmbientAudio } from './ambientAudio';
import { useVoiceGuide } from './voiceGuide';
import { useActivityAudioStore } from './soundSettings';
import { useSoundPlayerStore } from '../sounds/player';

type Props = RootStackScreenProps<'ActivityPlayer'>;

const TICK_MS = 200;

function AudioChip({
  icon,
  label,
  active,
  onPress,
  accessibilityLabel,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  active: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.chipPressed]}
    >
      <Ionicons name={icon} size={16} color={active ? colors.primaryDeep : colors.ink3} />
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function ActivityPlayerScreen({ route, navigation }: Props) {
  const activity = getActivity(route.params.activityId);
  const goal = route.params.goal;

  const [paused, setPaused] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  const startedLoggedRef = useRef(false);
  const completedLoggedRef = useRef(false);
  const startTimeRef = useRef(Date.now());
  const accumSecRef = useRef(0);

  const voiceMuted = useActivityAudioStore((s) => s.voiceMuted);
  const setVoiceMuted = useActivityAudioStore((s) => s.setVoiceMuted);
  const prefsLoaded = useActivityAudioStore((s) => s.loaded);

  const phaseStateForVoice = activity ? computePhaseState(activity, elapsedSec) : null;

  const { speaking, introDone } = useVoiceGuide({
    activity: activity ?? null,
    phaseState: phaseStateForVoice,
    running: Boolean(activity) && !paused && !completed,
    completed,
    ready: prefsLoaded,
    enabled: prefsLoaded && !voiceMuted,
  });

  const {
    muted: musicMuted,
    toggleMute: toggleMusic,
    trackTitle,
    cycleTrack,
  } = useAmbientAudio(Boolean(activity) && !completed, speaking);

  // A guided exercise brings its own music, so stop any Companion "Take a moment" soundscape here rather than at the launching row; that way it holds however the player was reached.
  useEffect(() => {
    useSoundPlayerStore.getState().stop();
  }, []);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close activity"
        >
          <Ionicons name="close" size={24} color={colors.ink2} />
        </Pressable>
      ),
    });
  }, [navigation]);

  useEffect(() => {
    if (!activity || startedLoggedRef.current) return;
    startedLoggedRef.current = true;
    void logEvent('activity_start', { activityId: activity.id, kind: activity.kind, goal });
  }, [activity, goal]);

  // Wall-clock ticker, not a per-tick accumulator, so it does not drift.
  // The start time is shifted on every resume so the running total survives pauses.
  // It waits for the spoken intro, so the exercise begins with its first cue rather than under the intro.
  useEffect(() => {
    if (!activity || paused || completed || !introDone) return undefined;
    startTimeRef.current = Date.now() - accumSecRef.current * 1000;
    let id: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const secs = (Date.now() - startTimeRef.current) / 1000;
      accumSecRef.current = secs;
      setElapsedSec(Math.min(secs, activity.durationSec));
      if (secs >= activity.durationSec) return;
      // Wakes on the phase change itself rather than up to a tick after it, so the circle and the cue start together.
      const toPhaseChangeMs = computePhaseState(activity, secs).phaseRemainingSec * 1000;
      id = setTimeout(tick, Math.max(1, Math.min(TICK_MS, Math.ceil(toPhaseChangeMs))));
    };
    tick();
    return () => clearTimeout(id);
  }, [activity, paused, completed, introDone]);

  const phaseState = phaseStateForVoice;

  useEffect(() => {
    if (!activity || !phaseState?.done || completedLoggedRef.current) return;
    completedLoggedRef.current = true;
    setCompleted(true);
    void logEvent('activity_complete', {
      activityId: activity.id,
      kind: activity.kind,
      durationSec: activity.durationSec,
      goal,
    });
  }, [activity, phaseState?.done, goal]);

  if (!activity || !phaseState) {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={styles.body}>
          <Text style={styles.title}>Activity not found</Text>
          <AppButton title="Close" onPress={() => navigation.goBack()} style={styles.doneButton} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.body}>
        {goal != null && <Text style={styles.goal}>{goalHeadline(goal)}</Text>}
        <Text style={styles.subtitle}>{activity.description}</Text>

        <Pressable
          style={styles.stage}
          onPress={() => !completed && setPaused((p) => !p)}
          accessibilityRole="button"
          accessibilityLabel={paused ? 'Resume activity' : 'Pause activity'}
          disabled={completed}
        >
          {activity.kind === 'breathing' ? (
            <BreathingCircle
              phase={phaseState.phase}
              phaseElapsedSec={phaseState.phaseElapsedSec}
              paused={paused || completed || !introDone}
            />
          ) : activity.id === 'quick-stretch' ? (
            <StretchFollowAlong moveId={stretchMoveForLabel(phaseState.phase.label)} />
          ) : (
            <PoseCrossfade icon={phaseState.phase.icon ?? 'body-outline'} />
          )}
        </Pressable>

        {completed ? (
          <View style={styles.completeWrap}>
            <Ionicons name="checkmark-circle" size={40} color={colors.teal} />
            <Text style={styles.completeText}>Nice work — activity complete.</Text>
            <AppButton title="Done" onPress={() => navigation.goBack()} style={styles.doneButton} />
          </View>
        ) : (
          <View style={styles.phaseWrap}>
            <Text style={styles.phaseLabel}>{introDone ? phaseState.phase.label : 'Get ready'}</Text>
            <Text style={styles.timer}>{formatClock(phaseState.totalRemainingSec)} left</Text>
            <Text style={[styles.pausedNote, !paused && styles.pausedNoteHidden]}>
              Paused · tap to resume
            </Text>
          </View>
        )}

        {!completed && (
          <View style={styles.chipRows}>
            <View style={styles.chipRow}>
              <AudioChip
                icon={voiceMuted ? 'mic-off-outline' : 'mic-outline'}
                label={voiceMuted ? 'Voice off' : 'Voice on'}
                active={!voiceMuted}
                onPress={() => setVoiceMuted(!voiceMuted)}
                accessibilityLabel={
                  voiceMuted ? 'Turn the spoken guide on' : 'Turn the spoken guide off'
                }
              />
            </View>
            <View style={styles.chipRow}>
              <AudioChip
                icon={musicMuted ? 'volume-mute-outline' : 'musical-notes-outline'}
                label={musicMuted ? 'Music off' : 'Music on'}
                active={!musicMuted}
                onPress={toggleMusic}
                accessibilityLabel={
                  musicMuted ? 'Turn background music on' : 'Turn background music off'
                }
              />
              {!musicMuted && (
                <AudioChip
                  icon="musical-note-outline"
                  label={trackTitle}
                  active
                  onPress={cycleTrack}
                  accessibilityLabel={`Music: ${trackTitle}. Tap for a different piece.`}
                />
              )}
            </View>
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  title: {
    ...type.title,
    color: colors.ink,
  },
  goal: {
    ...type.caption,
    color: colors.primaryDeep,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...type.sub,
    color: colors.ink3,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  stage: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  phaseWrap: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  phaseLabel: {
    ...type.title,
    color: colors.ink,
  },
  timer: {
    ...type.sub,
    color: colors.ink3,
    marginTop: spacing.xs,
  },
  pausedNote: {
    ...type.caption,
    color: colors.amber,
    marginTop: spacing.sm,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  // Kept in the layout while running so resuming does not shift the timer up by a line.
  pausedNoteHidden: {
    opacity: 0,
  },
  completeWrap: {
    alignItems: 'center',
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  completeText: {
    ...type.h2,
    color: colors.ink,
  },
  doneButton: {
    minWidth: 160,
    marginTop: spacing.sm,
  },
  chipRows: {
    alignSelf: 'stretch',
    gap: spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
  },
  chipActive: {
    backgroundColor: colors.primarySoft,
  },
  chipPressed: {
    opacity: 0.65,
  },
  chipText: {
    ...type.caption,
    color: colors.ink3,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.primaryDeep,
  },
});
