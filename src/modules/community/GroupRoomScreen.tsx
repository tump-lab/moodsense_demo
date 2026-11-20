/**
 * A peer group's chat room, shared by everyone who joined the group, plus Guide, the AI member.
 * See groupRoom.ts for where messages live and worker/src/groupGuide.ts for when Guide speaks.
 * With "Use AI" off, Guide does not answer this person and their messages are not sent to the model.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  combineRisk,
  GUIDE_NAME,
  guideWelcome,
  isRoomAvailable,
  joinRoom,
  leaveRoom,
  matchesCrisisRules,
  MAX_MESSAGE_LENGTH,
  mentionsGuide,
  myUid,
  pseudonymFor,
  requestGuideReply,
  screenMessageRisk,
  sendRoomMessage,
  subscribeMembers,
  subscribeMessages,
  type RiskLevel,
  type RoomMember,
  type RoomMessage,
  type RoomSubject,
  withScreenshotSamples,
} from './groupRoom';
import { useDevModeStore } from '../settings/devMode';
import { useLlmSettingsStore } from '../settings/llmSettings';
import GroupSafetySheet from './GroupSafetySheet';
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
            {guide ? `${GUIDE_NAME} · Artificial Intelligence` : message.name}
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
  const [uid, setUid] = useState<string>(myUid());
  const screenshot = useDevModeStore((s) => s.screenshot);
  const aiOn = useLlmSettingsStore((s) => s.enabled);

  const [messages, setMessages] = useState<RoomMessage[] | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  /** The id of this person's message Guide is answering, until Guide's reply arrives. */
  const [guidePending, setGuidePending] = useState<string | null>(null);
  const [safetyLevel, setSafetyLevel] = useState<RiskLevel>(0);
  const list = useRef<FlatList<RoomMessage>>(null);
  const others = useMemo(() => members.filter((m) => m.uid !== uid), [members, uid]);

  useEffect(() => {
    if (group) navigation.setOptions({ title: group.name });
  }, [group, navigation]);

  useEffect(() => {
    void useDevModeStore.getState().load();
  }, []);

  useEffect(() => {
    void useLlmSettingsStore.getState().load();
  }, []);

  // Joining again on every visit is harmless: it covers groups joined before rooms were shared and
  // keeps this member's `ai` flag in step with Settings.
  const subjectName = group?.name;
  const subjectAbout = group?.about;
  useEffect(() => {
    if (!subjectName || !isRoomAvailable()) return;
    let unsubs: (() => void)[] = [];
    let cancelled = false;
    joinRoom(groupId, { name: subjectName, about: subjectAbout ?? '' }, aiOn)
      .then((me) => {
        if (cancelled) return;
        setUid(me);
        const fail = (err: Error) => {
          console.warn('Group room listener failed:', err);
          setError("Couldn't load this room. Check your connection and try again.");
        };
        unsubs = [subscribeMessages(groupId, setMessages, fail), subscribeMembers(groupId, setMembers, fail)];
      })
      .catch((err) => {
        console.warn('Could not join group room:', err);
        setError("Couldn't join this room. Check your connection and try again.");
        setMessages([]);
      });
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [groupId, subjectName, subjectAbout, aiOn]);

  // Guide's reply has arrived once a guide message is newer than the message it is answering.
  useEffect(() => {
    if (!guidePending || !messages) return;
    const idx = messages.findIndex((m) => m.id === guidePending);
    if (idx >= 0 && messages.slice(idx + 1).some((m) => m.kind === 'guide')) setGuidePending(null);
  }, [messages, guidePending]);

  useEffect(() => {
    // onContentSizeChange alone misses a message that lands while the list is still laying out.
    const t = setTimeout(() => list.current?.scrollToEnd({ animated: true }), 100);
    return () => clearTimeout(t);
  }, [messages?.length]);

  const send = async () => {
    if (!group || !messages || !draft.trim() || sending) return;
    const text = draft.trim().slice(0, MAX_MESSAGE_LENGTH);

    // Safety screen on every message (guideRules.ts). Keyword rules act at once; the LLM screen can
    // raise the level when it answers. Only the sender sees the sheet.
    const ruleHit = matchesCrisisRules(text);
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

    setSending(true);
    let id: string;
    try {
      id = await sendRoomMessage(groupId, text);
    } catch (err) {
      console.warn('Could not send group message:', err);
      setDraft(text);
      setError("Your message didn't send. Try again.");
      return;
    } finally {
      setSending(false);
    }
    // screenMessageRisk is a no-op with "Use AI" off, so the keyword rules alone apply then.
    void screenMessageRisk(text).then((llmLevel) => {
      if (llmLevel != null && llmLevel > combineRisk(ruleHit, null)) raise(llmLevel, 'llm');
    });

    if (mentionsGuide(text) && !aiOn) {
      setError(`${GUIDE_NAME} is off for you because "Use AI" is off in Settings, so it won't answer this message.`);
    } else if (mentionsGuide(text)) {
      setGuidePending(id);
      requestGuideReply(groupId, id).catch((err) => {
        console.warn('Guide could not answer:', err);
        setGuidePending(null);
        setError(`${GUIDE_NAME} couldn't answer right now. Try again in a moment.`);
      });
    }
  };

  const askGuide = () => {
    if (!aiOn) {
      Alert.alert(
        `${GUIDE_NAME} is off`,
        `${GUIDE_NAME} is an artificial intelligence, so it only answers when "Use AI" is on in Settings. ` +
          `With it off, your messages are never sent to the AI, even when others ask ${GUIDE_NAME}.`,
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => navigation.navigate('Settings') },
        ]
      );
      return;
    }
    if (!mentionsGuide(draft)) setDraft((d) => `@${GUIDE_NAME} ${d}`);
  };

  // Kept low-key on purpose: leaving is rare, so it is a small header link rather than a button on every group card.
  const leave = () => {
    if (isPeerCommunity) {
      void usePeerCommunities.getState().leave(groupId);
    } else {
      const { ids, toggle } = useJoinedGroups.getState();
      if (ids.includes(groupId)) void toggle(groupId);
    }
    leaveRoom(groupId).catch((err) => console.warn('Could not leave group room:', err));
    // No calendar permission means no way to reach back in and remove the event, so say so.
    Alert.alert('Left this group', 'If you added it to your calendar, delete it there too.');
    navigation.goBack();
  };

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={leave} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.leave}>Leave</Text>
        </Pressable>
      ),
    });
    // `leave` only reads the group id and kind, so rebinding on those is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, groupId, isPeerCommunity]);

  const shown = messages === null ? null : withScreenshotSamples(messages, screenshot);
  const empty = shown !== null && shown.length === 0;
  const memberSub = screenshot
    ? '6 others'
    : others.length === 0
      ? 'Just you so far'
      : `${others.length} ${others.length === 1 ? 'other' : 'others'}`;

  if (!group) {
    return (
      <View style={styles.center}>
        <Text style={styles.note}>This group is no longer listed.</Text>
      </View>
    );
  }

  if (!isRoomAvailable()) {
    return (
      <View style={styles.center}>
        <Text style={styles.note}>Group chat needs a connection to MoodSense, which this build does not have.</Text>
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
          <Participant
            icon="sparkles"
            label={GUIDE_NAME}
            sub={aiOn || screenshot ? 'Artificial Intelligence' : 'Off for you'}
            tint={colors.indigoSoft}
          />
          <Participant icon="people" label="Members" sub={memberSub} tint={colors.surface} />
        </View>
      </View>

      {error && (
        <Pressable style={styles.error} onPress={() => setError(null)} accessibilityRole="alert">
          <Text style={styles.errorText}>{error}</Text>
        </Pressable>
      )}

      {shown === null ? (
        <ActivityIndicator style={styles.flex} color={colors.primary} />
      ) : (
        <FlatList
          ref={list}
          style={styles.flex}
          contentContainerStyle={styles.list}
          data={empty ? [guideWelcome(pseudonymFor(uid), aiOn)] : shown}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <Bubble message={item} mine={item.kind === 'member' && item.uid === uid} />}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
          ListFooterComponent={guidePending ? <Text style={styles.typing}>{GUIDE_NAME} is writing…</Text> : null}
        />
      )}

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={aiOn ? `Ask ${GUIDE_NAME}, the artificial intelligence` : `${GUIDE_NAME} is off. Use AI is off in Settings`}
          onPress={askGuide}
          hitSlop={6}
          style={[styles.guideChip, !aiOn && styles.guideChipOff]}
        >
          <Ionicons name="sparkles" size={14} color={aiOn ? colors.indigo : colors.ink3} />
          <Text style={[styles.guideChipText, !aiOn && { color: colors.ink3 }]}>@{GUIDE_NAME}</Text>
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
          disabled={!draft.trim() || messages === null || sending}
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
  leave: { ...type.caption, color: colors.ink3 },
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
  guideChipOff: { backgroundColor: colors.surface2 },
  error: { marginHorizontal: spacing.md, marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.roseSoft },
  errorText: { ...type.caption, color: colors.ink },
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
