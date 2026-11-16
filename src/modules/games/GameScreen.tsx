/**
 * Modal host screen for one calming game (see ./config.ts), with the instruction on top and the game below.
 * Each game is a self-contained component with no props, so adding one means an entry in config.ts plus a case here.
 */
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppButton, Screen } from '../../components';
import { colors, radius, spacing, type } from '../../theme';
import type { RootStackScreenProps } from '../../navigation';
import { logEvent } from '../../services/logging';
import { getGame } from './config';
import BubblePop from './BubblePop';
import RipplePond from './RipplePond';
import Constellation from './Constellation';

type Props = RootStackScreenProps<'Game'>;

export default function GameScreen({ route, navigation }: Props) {
  const game = getGame(route.params.gameId);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close game"
        >
          <Ionicons name="close" size={24} color={colors.ink2} />
        </Pressable>
      ),
    });
  }, [navigation]);

  useEffect(() => {
    if (!game) return;
    void logEvent('game_open', { gameId: game.id });
  }, [game]);

  if (!game) {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={styles.missing}>
          <Text style={styles.missingText}>Game not found</Text>
          <AppButton title="Close" onPress={() => navigation.goBack()} style={styles.missingButton} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.body}>
        <Text style={styles.instruction}>{game.instruction}</Text>
        <View style={styles.stage}>
          {game.id === 'bubble-pop' && <BubblePop />}
          {game.id === 'ripple-pond' && <RipplePond />}
          {game.id === 'constellation' && <Constellation />}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingBottom: spacing.lg,
  },
  instruction: {
    ...type.sub,
    color: colors.ink3,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  stage: {
    flex: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface,
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
  missingButton: {
    minWidth: 160,
  },
});
