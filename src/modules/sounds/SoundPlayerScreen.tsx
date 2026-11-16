/**
 * One sound from the library, open as a modal panel with its art, description and controls.
 * The sound plays only while the panel is open: closing it, by the X or by swiping it down, stops the sound.
 */
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppButton, Screen } from '../../components';
import { colors, radius, spacing, type } from '../../theme';
import type { RootStackScreenProps } from '../../navigation';
import { logEvent } from '../../services/logging';
import { getSoundscape } from './config';
import { useSoundPlayerStore } from './player';

type Props = RootStackScreenProps<'SoundPlayer'>;

export default function SoundPlayerScreen({ route, navigation }: Props) {
  const sound = getSoundscape(route.params.soundId);
  const playingId = useSoundPlayerStore((s) => s.playingId);
  const play = useSoundPlayerStore((s) => s.play);
  const stop = useSoundPlayerStore((s) => s.stop);
  const playing = sound != null && playingId === sound.id;

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={24} color={colors.ink2} />
        </Pressable>
      ),
    });
  }, [navigation]);

  // Playback starts here, not at the row that navigated, so "what's playing" is decided in one place whichever route opens this screen.
  useEffect(() => {
    if (!sound) return;
    if (useSoundPlayerStore.getState().playingId !== sound.id) play(sound.id);
    void logEvent('soundscape_play', { soundId: sound.id });
  }, [sound, play]);

  // Unmount covers every way the modal closes, including the swipe-down that never touches the X.
  useEffect(() => stop, [stop]);

  if (!sound) {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={styles.missing}>
          <Text style={styles.missingText}>Sound not found</Text>
          <AppButton title="Close" onPress={() => navigation.goBack()} style={styles.wideButton} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={styles.art}>
          <Text style={styles.artEmoji}>{sound.emoji}</Text>
        </View>
        <Text style={styles.title}>{sound.title}</Text>
        <Text style={styles.hint}>{sound.hint}</Text>

        <Pressable
          onPress={() => (playing ? stop() : play(sound.id))}
          accessibilityRole="button"
          accessibilityLabel={playing ? `Stop ${sound.title}` : `Play ${sound.title}`}
          style={({ pressed }) => [styles.transport, pressed && styles.pressed]}
        >
          <Ionicons
            name={playing ? 'pause' : 'play'}
            size={34}
            color={colors.surface}
            style={playing ? undefined : styles.playGlyph}
          />
        </Pressable>
        <Text style={styles.state}>{playing ? 'Playing' : 'Stopped'}</Text>

        <Text style={styles.footnote}>
          Plays while this panel is open. Closing it stops the sound.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  art: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  artEmoji: {
    fontSize: 60,
  },
  title: {
    ...type.title,
    color: colors.ink,
  },
  hint: {
    ...type.sub,
    color: colors.ink3,
    textAlign: 'center',
  },
  transport: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  // The play triangle's own whitespace makes it look off-centre in a circle.
  playGlyph: {
    marginLeft: 4,
  },
  pressed: {
    opacity: 0.75,
  },
  state: {
    ...type.caption,
    color: colors.ink3,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  footnote: {
    ...type.caption,
    color: colors.ink3,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  missingText: {
    ...type.title,
    color: colors.ink,
  },
  wideButton: {
    minWidth: 160,
  },
});
