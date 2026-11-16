/**
 * Recharge tab (formerly Help): one section with sub-tabs. "For You" holds up to three picks from
 * the latest Home check-in and its reasons; each category tab holds up to three more. The existing
 * support resources follow. Mood check-in -> reason -> a fitting intervention.
 */
import React, { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Card, Pill, Row, Screen, SectionTitle } from '../../components';
import { colors, spacing, type } from '../../theme';
import type { RootStackParamList } from '../../navigation';
import { logEvent } from '../../services/logging';
import { useCheckinStore } from '../checkin/store';
import { MOOD_LABELS } from '../checkin/moods';
import { parseReasons, reasonLabel } from '../checkin/moodReasons';
import HelpPanel from '../community/HelpPanel';
import RechargeSheet from './RechargeSheet';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  itemsInCategory,
  recommendRecharge,
  type RechargeCategory,
  type RechargeItem,
} from './recommendations';

const FOR_YOU = 'for-you';
type RechargeTab = typeof FOR_YOU | RechargeCategory;
const TABS: readonly { id: RechargeTab; label: string }[] = [
  { id: FOR_YOU, label: 'For You' },
  ...CATEGORY_ORDER.map((c) => ({ id: c, label: CATEGORY_LABELS[c] })),
];

const ACTION_ICON: Record<RechargeItem['action']['kind'], keyof typeof Ionicons.glyphMap> = {
  activity: 'play-circle-outline',
  sound: 'musical-notes-outline',
  game: 'game-controller-outline',
  reflect: 'create-outline',
  tip: 'chevron-forward',
  video: 'open-outline',
};

function ItemRow({ item, onPress }: { item: RechargeItem; onPress: () => void }) {
  return (
    <Row
      icon={<Text style={styles.emoji}>{item.emoji}</Text>}
      iconBg={colors.primarySoft}
      title={item.title}
      subtitle={item.subtitle}
      right={<Ionicons name={ACTION_ICON[item.action.kind]} size={20} color={colors.primaryDeep} />}
      onPress={onPress}
      accessibilityLabel={`${item.title}. ${item.subtitle}`}
      style={styles.row}
    />
  );
}

function ItemList({ items, onOpen }: { items: RechargeItem[]; onOpen: (i: RechargeItem) => void }) {
  return (
    <Card style={styles.listCard}>
      {items.map((item, i) => (
        <View key={item.id}>
          <ItemRow item={item} onPress={() => onOpen(item)} />
          {i < items.length - 1 && <View style={styles.divider} />}
        </View>
      ))}
    </Card>
  );
}

export default function RechargeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const latest = useCheckinStore((s) => s.todayEntries[0] ?? null);
  const mood = latest?.mood ?? null;
  const reasons = useMemo(() => parseReasons(latest?.reasons), [latest?.reasons]);
  const picks = useMemo(() => recommendRecharge(mood, reasons), [mood, reasons]);
  const [tab, setTab] = useState<RechargeTab>(FOR_YOU);
  const [sheetItem, setSheetItem] = useState<RechargeItem | null>(null);

  const open = (item: RechargeItem, from: 'recommended' | 'browse') => {
    void logEvent('recharge_opened', { itemId: item.id, from, mood }).catch(() => {});
    const a = item.action;
    switch (a.kind) {
      case 'activity':
        navigation.navigate('ActivityPlayer', { activityId: a.activityId, goal: a.goal });
        return;
      case 'sound':
        navigation.navigate('SoundPlayer', { soundId: a.soundId });
        return;
      case 'game':
        navigation.navigate('Game', { gameId: a.gameId });
        return;
      case 'video':
        Linking.openURL(a.url).catch((err: unknown) => console.warn('Could not open video:', err));
        return;
      case 'tip':
      case 'reflect':
        setSheetItem(item);
    }
  };

  const tint = mood ? colors.mood[mood] : null;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Recharge</Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          accessibilityRole="tablist"
        >
          {TABS.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => setTab(t.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: t.id === tab }}
            >
              <Pill
                label={t.label}
                color={t.id === tab ? colors.onPrimary : colors.ink2}
                bg={t.id === tab ? colors.primary : colors.surface2}
              />
            </Pressable>
          ))}
        </ScrollView>
        {tab === FOR_YOU &&
          (mood && tint ? (
            <View style={styles.context}>
              <Text style={styles.contextText}>Because you are feeling</Text>
              <Pill label={MOOD_LABELS[mood]} color={tint.deep} bg={tint.soft} />
              {reasons.slice(0, 2).map((r) => (
                <Pill key={r} label={reasonLabel(r)} />
              ))}
            </View>
          ) : (
            <Text style={styles.contextText}>
              Check in on Home and these will match how you feel.
            </Text>
          ))}
        <ItemList
          items={tab === FOR_YOU ? picks : itemsInCategory(tab)}
          onOpen={(i) => open(i, tab === FOR_YOU ? 'recommended' : 'browse')}
        />

        <SectionTitle style={styles.sectionTitle}>Get Support</SectionTitle>
        <HelpPanel />
      </ScrollView>

      <RechargeSheet item={sheetItem} onClose={() => setSheetItem(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingTop: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.md },
  title: { ...type.title, color: colors.ink },
  sectionTitle: { marginTop: spacing.sm, marginBottom: 0 },
  context: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  contextText: { ...type.sub, color: colors.ink2 },
  chips: { gap: spacing.sm, paddingRight: spacing.lg },
  listCard: { paddingVertical: spacing.xs },
  row: { paddingVertical: spacing.sm },
  emoji: { fontSize: 20 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
});
