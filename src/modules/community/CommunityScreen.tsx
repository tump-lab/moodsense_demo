/**
 * Community tab, in two parts:
 * - Peer Communities: the top four groups to join, plus a Create link in the header (local only for
 *   now). A joined community's Chat action opens the same group chat room used by official groups.
 * - Official Communities: trusted support organizations for where this person is (by IP, then
 *   chosen community, then locale), including group chat where an organizer's groups are listed.
 */
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { AppButton, Screen, SectionTitle } from '../../components';
import { colors, radius, spacing, type } from '../../theme';
import type { RootStackParamList } from '../../navigation';
import { logEvent } from '../../services/logging';
import CommunityCard from './CommunityCard';
import { PeerPage } from './HelpDetailScreen';
import { useHelpCatalog } from './useHelpCatalog';
import {
  COMMUNITY_DESCRIPTION_MAX,
  COMMUNITY_NAME_MAX,
  SEED_PEER_COMMUNITIES,
  formatMembers,
  memberCount,
  usePeerCommunities,
  type PeerCommunity,
} from './peerCommunities';

function PeerCommunityCard({
  community,
  joined,
  onJoin,
  onOpenRoom,
}: {
  community: PeerCommunity;
  joined: boolean;
  onJoin: () => void;
  onOpenRoom: () => void;
}) {
  const meta = formatMembers(memberCount(community, joined)) + (community.mine ? ' · Created by you' : '');
  return (
    <CommunityCard
      emoji={community.emoji ?? '\u{1F4AC}'}
      name={community.name}
      about={community.description}
      meta={[meta]}
      actions={
        joined
          ? [
              { label: 'Joined', icon: 'checkmark', variant: 'soft', accessibilityLabel: `Joined ${community.name}` },
              {
                label: 'Chat',
                icon: 'chatbubbles-outline',
                variant: 'solid',
                onPress: onOpenRoom,
                accessibilityLabel: `Open the ${community.name} group chat`,
              },
            ]
          : [{ label: 'Join', variant: 'solid', onPress: onJoin, accessibilityLabel: `Join ${community.name}` }]
      }
    />
  );
}

function CreateCommunityModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const createCommunity = usePeerCommunities((s) => s.createCommunity);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (visible) {
      setName('');
      setDescription('');
    }
  }, [visible]);

  const submit = async () => {
    const c = await createCommunity(name, description);
    if (c) void logEvent('peer_community_created', { id: c.id }).catch(() => {});
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle} accessibilityRole="header">
              Create A Community
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.ink3} />
            </Pressable>
          </View>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Community name"
            placeholderTextColor={colors.ink3}
            maxLength={COMMUNITY_NAME_MAX}
            autoFocus
          />
          <TextInput
            style={[styles.input, styles.inputMulti]}
            value={description}
            onChangeText={setDescription}
            placeholder="Short description (optional)"
            placeholderTextColor={colors.ink3}
            maxLength={COMMUNITY_DESCRIPTION_MAX}
            multiline
          />
          <Text style={styles.meta}>For now your community is saved on this phone only.</Text>
          <AppButton title="Create" disabled={!name.trim()} onPress={() => void submit()} style={styles.createButton} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const MAX_PEER_SHOWN = 4;

export default function CommunityScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const catalog = useHelpCatalog();
  const { joined, created, load, join } = usePeerCommunities();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  // Your own first, then the largest; Create stays in the section header, not a row of its own.
  const communities = [
    ...created,
    ...[...SEED_PEER_COMMUNITIES].sort((a, b) => b.baseMembers - a.baseMembers),
  ].slice(0, MAX_PEER_SHOWN);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Community</Text>

        <SectionTitle
          style={styles.sectionTitle}
          action={
            <Pressable accessibilityRole="button" onPress={() => setCreating(true)} hitSlop={8} style={styles.createLink}>
              <Ionicons name="add" size={16} color={colors.indigo} />
              <Text style={styles.createLinkText}>Create A Community</Text>
            </Pressable>
          }
        >
          Peer Communities
        </SectionTitle>
        <Text style={styles.sectionSub}>Connect with people going through similar things.</Text>
        {communities.map((c) => (
          <PeerCommunityCard
            key={c.id}
            community={c}
            joined={joined.includes(c.id)}
            onJoin={() => {
              void join(c.id);
              void logEvent('peer_community_joined', { id: c.id }).catch(() => {});
            }}
            onOpenRoom={() => navigation.navigate('GroupRoom', { groupId: c.id })}
          />
        ))}

        <SectionTitle style={styles.sectionTitle}>Official Communities</SectionTitle>
        <Text style={styles.sectionSub}>Trusted organizations and support services near you.</Text>
        <PeerPage catalog={catalog} onOpenRoom={(g) => navigation.navigate('GroupRoom', { groupId: g.id })} />
      </ScrollView>

      <CreateCommunityModal visible={creating} onClose={() => setCreating(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingTop: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.md },
  title: { ...type.title, color: colors.ink },
  sectionTitle: { marginTop: spacing.sm, marginBottom: 0 },
  sectionSub: { ...type.sub, color: colors.ink3, marginTop: -spacing.xs },
  meta: { ...type.caption, color: colors.ink3 },
  createLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  createLinkText: { ...type.caption, fontWeight: '700', color: colors.indigo },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(58, 50, 43, 0.45)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { ...type.h2, color: colors.ink },
  input: {
    ...type.body,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputMulti: { minHeight: 72, textAlignVertical: 'top' },
  createButton: { marginTop: spacing.sm },
});
