/**
 * A peer group's chat room: your messages and the AI guide's, plus a labelled sample conversation in
 * place of the other members when developer mode is on. See groupRoom.ts for why it is on this phone only and when the guide speaks.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, type } from '../../theme';
import type { RootStackParamList } from '../../navigation';
import { useHelpCatalog } from './useHelpCatalog';
import { useJoinedGroups } from './joinedGroups';
import { SEED_PEER_COMMUNITIES, usePeerCommunities } from './peerCommunities';
import {
  clearRoom,
  combineRisk,
  GUIDE_NAME,
  guideReply,
  guideWelcome,
  loadRoom,
  matchesCrisisRules,
  MAX_MESSAGE_LENGTH,
  mentionsGuide,
  myUid,
  newMessage,
  pseudonymFor,
  SAMPLE_MEMBERS,
  saveRoom,
  screenMessageRisk,
  type RiskLevel,
  type RoomMessage,
  type RoomSubject,
  withSamples,
} from './groupRoom';
import { useDevModeStore } from '../settings/devMode';
import GroupSafetySheet from './GroupSafetySheet';
import { useCrisisResource } from '../phq4/useCrisisResource';
import { logEvent } from '../../services/logging';

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function Participant({ icon, label, sub, tint }: { icon: keyof typeof Ionicons.glyphMap; label: string; sub: string; tint: string }) {
  return (
    <View style={styles.participant}>
      <View style={[styles.avatar, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={16} color={colors.ink} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.participantName} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.participantSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
    </View>
  );
}

function Bubble({ message, mine }: { message: RoomMessage; mine: boolean }) {
  const guide = message.kind === 'guide';
  return (
    <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
      {!mine && (
        <View style={styles.nameRow}>
          {guide && <Ionicons name="sparkles" size={12} color={colors.indigo} />}
          <Text style={[styles.name, guide && { color: colors.indigo }]}>
            {guide ? `${GUIDE_NAME} · Artificial Intelligence` : message.kind === 'sample' ? `${message.name} · sample` : message.name}
          </Text>
        </View>
      )}
      <View style={[styles.bubble, mine ? styles.mine : guide ? styles.guide : styles.theirs]}>
        <Text style={[styles.text, mine && { color: colors.onPrimary }]}>{message.text}</Text>
      </View>
      <Text style={styles.time}>{timeOf(message.ts)}</Text>
    </View>
  );
}

export default function GroupRoomScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'GroupRoom'>) {
  const { groupId } = route.params;
  const catalog = useHelpCatalog();
  const helpGroup = catalog.groups.find((g) => g.id === groupId);
  const { created: createdCommunities, load: loadPeerCommunities } = usePeerCommunities();
  useEffect(() => {
    void loadPeerCommunities();
  }, [loadPeerCommunities]);
  const peerCommunity = [...createdCommunities, ...SEED_PEER_COMMUNITIES].find((c) => c.id === groupId);
  const isPeerCommunity = !helpGroup && !!peerCommunity;
  const group: RoomSubject | undefined = helpGroup ?? (peerCommunity
    ? { name: peerCommunity.name, about: peerCommunity.description || `A peer community for ${peerCommunity.name}.` }
    : undefined);
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const uid = myUid();
  const devMode = useDevModeStore((s) => s.enabled);
  const crisis = useCrisisResource();
  const screenshot = useDevModeStore((s) => s.screenshot);

  const [messages, setMessages] = useState<RoomMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [guideTyping, setGuideTyping] = useState(false);
  const [safetyLevel, setSafetyLevel] = useState<RiskLevel>(0);
  const list = useRef<FlatList<RoomMessage>>(null);

  useEffect(() => {
    if (group) navigation.setOptions({ title: group.name });
  }, [group, navigation]);

  useEffect(() => {
    void useDevModeStore.getState().load();
  }, []);

  useEffect(() => {
    let live = true;
    void loadRoom(groupId).then((m) => {
      if (live) setMessages(m);
    });
    return () => {
      live = false;
    };
  }, [groupId]);

  const append = (current: RoomMessage[], message: RoomMessage) => {
    const next = [...current, message];
    setMessages(next);
    void saveRoom(groupId, next);
    // onContentSizeChange alone misses a reply that lands while the list is still laying out.
    setTimeout(() => list.current?.scrollToEnd({ animated: true }), 100);
    return next;
  };

  const send = async () => {
    if (!group || !messages || !draft.trim()) return;
    const mine = newMessage(draft);

    // Safety screen on every message (guideRules.ts). Keyword rules act at once; the LLM screen can
    // raise the level when it answers. Only the sender sees the sheet.
    const ruleHit = matchesCrisisRules(mine.text);
    // A held-back message stays in the sender's own text box, so they can see what opened the sheet
    // and decide what to do with it; the room never receives it.
    if (!ruleHit) setDraft('');
    const raise = (level: RiskLevel, source: 'rule' | 'llm') => {
      if (level === 0) return;
      setSafetyLevel((prev) => (level > prev ? level : prev));
      void logEvent('group_safety_shown', { groupId, level, source }).catch(() => {});
    };
    if (ruleHit) {
      // A message that trips the crisis rules is too heavy for a peer room, so it stays with the
      // sender: the private sheet points them to a crisis line and the room never sees it.
      raise(combineRisk(true, null), 'rule');
      return;
    }

    const withMine = append(messages, mine);
    // The guide reads the room as it is shown, samples included when they are on screen.
    const context = withSamples(withMine, devMode, screenshot);
    void screenMessageRisk(mine.text).then((llmLevel) => {
      if (llmLevel != null && llmLevel > combineRisk(ruleHit, null)) raise(llmLevel, 'llm');
    });

    if (mentionsGuide(mine.text)) {
      setGuideTyping(true);
      const reply = await guideReply(group, context, mine);
      setGuideTyping(false);
      append(withMine, reply);
    }
  };

  const askGuide = () => {
    if (!mentionsGuide(draft)) setDraft((d) => `@${GUIDE_NAME} ${d}`);
  };

  // Kept low-key on purpose: leaving is rare, so it is a small link here rather than a button on every group card.
  const leave = () => {
    if (isPeerCommunity) {
      void usePeerCommunities.getState().leave(groupId);
    } else {
      const { ids, toggle } = useJoinedGroups.getState();
      if (ids.includes(groupId)) void toggle(groupId);
    }
    void clearRoom(groupId);
    // No calendar permission means no way to reach back in and remove the event, so say so.
    Alert.alert('Left this group', 'If you added it to your calendar, delete it there too.');
    navigation.goBack();
  };

  const shown = messages === null ? null : withSamples(messages, devMode, screenshot);
  const empty = shown !== null && shown.length === 0;

  if (!group) {
    return (
      <View style={styles.center}>
        <Text style={styles.note}>This group is no longer listed.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <View style={styles.members}>
        <View style={styles.participants}>
          <Participant icon="person" label={pseudonymFor(uid)} sub="You" tint={colors.primarySoft} />
          <Participant icon="sparkles" label={GUIDE_NAME} sub="Artificial Intelligence" tint={colors.indigoSoft} />
          <Participant icon="people" label="Members" sub={group.name} tint={colors.surface} />
        </View>
        {/* Screenshot mode drops the notice so a figure shows only the room; the Guide row above
            still labels the assistant as an artificial intelligence. */}
        {!screenshot && (
          <Text style={styles.notice}>
            {devMode ? `Developer mode: ${SAMPLE_MEMBERS.join(', ')} are sample members. ` : ''}
            Other members are not connected yet, so only {GUIDE_NAME} will reply. {GUIDE_NAME} is an artificial intelligence,
            not a counselor, and answers when you write @{GUIDE_NAME}. {crisis.inlineLine}{' '}
            <Text style={styles.leave} accessibilityRole="button" onPress={leave}>
              Leave group
            </Text>
          </Text>
        )}
      </View>

      {shown === null ? (
        <ActivityIndicator style={styles.flex} color={colors.primary} />
      ) : (
        <FlatList
          ref={list}
          style={styles.flex}
          contentContainerStyle={styles.list}
          data={empty ? [guideWelcome(pseudonymFor(uid))] : shown}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <Bubble message={item} mine={item.kind === 'member' && item.uid === uid} />}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
          ListFooterComponent={guideTyping ? <Text style={styles.typing}>{GUIDE_NAME} is writing…</Text> : null}
        />
      )}

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Ask ${GUIDE_NAME}, the artificial intelligence`} onPress={askGuide} hitSlop={6} style={styles.guideChip}>
          <Ionicons name="sparkles" size={14} color={colors.indigo} />
          <Text style={styles.guideChipText}>@{GUIDE_NAME}</Text>
        </Pressable>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message the group"
          placeholderTextColor={colors.ink3}
          maxLength={MAX_MESSAGE_LENGTH}
          multiline
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          onPress={() => void send()}
          disabled={!draft.trim() || messages === null}
          hitSlop={8}
        >
          <Ionicons name="send" size={22} color={draft.trim() ? colors.primaryDeep : colors.ink3} />
        </Pressable>
      </View>
      <GroupSafetySheet level={safetyLevel} onClose={() => setSafetyLevel(0)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.bg },
  note: { ...type.sub, color: colors.ink2, textAlign: 'center' },
  members: {
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  participants: { flexDirection: 'row', gap: spacing.sm },
  participant: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  participantName: { ...type.caption, color: colors.ink, fontWeight: '700' },
  participantSub: { ...type.caption, color: colors.ink3 },
  notice: { ...type.caption, color: colors.ink3 },
  leave: { textDecorationLine: 'underline' },
  list: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  typing: { ...type.caption, color: colors.indigo, marginTop: spacing.sm },
  bubbleRow: { alignItems: 'flex-start', maxWidth: '85%', gap: 2 },
  bubbleRowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { ...type.caption, color: colors.ink2, fontWeight: '700' },
  bubble: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md },
  mine: { backgroundColor: colors.primary },
  theirs: { backgroundColor: colors.surface },
  guide: { backgroundColor: colors.indigoSoft },
  text: { ...type.body, color: colors.ink },
  time: { ...type.caption, color: colors.ink3 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
  },
  guideChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.indigoSoft,
    marginBottom: 4,
  },
  guideChipText: { ...type.caption, color: colors.indigo, fontWeight: '700' },
  input: {
    ...type.body,
    flex: 1,
    maxHeight: 120,
    color: colors.ink,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    backgroundColor: colors.bg,
  },
});
