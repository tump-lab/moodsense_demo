/**
 * The pages behind the Help section. Message and video on the Talk page are sample screens, and
 * joining a group books this phone's calendar and opens the group's in-app chat room (GroupRoomScreen, on this phone only for now),
 * but does not tell the organizer, until a partner decides how these connect; each one says so where it
 * is used, because nobody should wait on a reply that is not coming.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Card, Pill, Row } from '../../components';
import { colors, radius, spacing, type } from '../../theme';
import type { RootStackParamList } from '../../navigation';
import { useCheckinStore } from '../checkin/store';
import {
  rankResources,
  type HelpCatalog,
  type HelpResource,
  type PeerGroup,
  type ResourceItem,
  type TalkPartner,
} from './helpResources';
import { addGroupToCalendar, calendarEventFor } from './groupSchedule';
import CommunityCard from './CommunityCard';
import { useJoinedGroups } from './joinedGroups';
import { joinRoomInBackground } from './groupRoom';
import { isLlmEnabled } from '../settings/llmSettings';
import { MHA_LOGO, RESOURCE_LOGOS } from './resourceLogos';
import { openHref, useHelpCatalog } from './useHelpCatalog';

export type HelpSection = 'find' | 'talk' | 'peer' | 'crisis';

export const HELP_SECTION_TITLES: Record<HelpSection, string> = {
  find: 'Find Resources',
  talk: 'Talk',
  peer: 'Peer Support Groups',
  crisis: 'Crisis Support',
};

function hrefOf(r: HelpResource): string | undefined {
  // The most direct way in wins when a resource has several.
  if (r.phone) return `tel:${r.phone}`;
  if (r.sms) return `sms:${r.sms}`;
  return r.url;
}

function iconOf(r: HelpResource): keyof typeof Ionicons.glyphMap {
  if (r.phone) return 'call-outline';
  if (r.sms) return 'chatbubble-outline';
  return 'open-outline';
}

function ResourceList({ resources, accent = colors.primary }: { resources: HelpResource[]; accent?: string }) {
  return (
    <Card style={styles.listCard}>
      {resources.map((r, i) => {
        const href = hrefOf(r);
        return (
          <View key={r.id}>
            <Row
              title={r.title}
              subtitle={r.blurb}
              right={<Ionicons name={iconOf(r)} size={18} color={accent} />}
              onPress={href ? () => openHref(href) : undefined}
              accessibilityLabel={`${r.title}. ${r.blurb}`}
              style={styles.row}
            />
            {r.phone && r.sms && (
              <Text
                style={[styles.textInstead, { color: accent }]}
                accessibilityRole="link"
                onPress={() => openHref(`sms:${r.sms}`)}
              >
                Text {r.sms} instead
              </Text>
            )}
            {i < resources.length - 1 && <View style={styles.divider} />}
          </View>
        );
      })}
    </Card>
  );
}

function ResourceTile({ resource, onOpen }: { resource: HelpResource; onOpen: () => void }) {
  const logo = resource.logo ? RESOURCE_LOGOS[resource.logo] : undefined;
  const hasItems = (resource.items?.length ?? 0) > 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${resource.title}. ${resource.blurb}`}
      onPress={onOpen}
      style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
    >
      <View style={styles.tileTop}>
        <View style={styles.logoWrap}>
          {logo ? (
            <Image source={logo} style={styles.logo} resizeMode="contain" />
          ) : (
            <Ionicons name="medkit-outline" size={24} color={colors.indigo} />
          )}
        </View>
        <Ionicons name={hasItems ? 'chevron-forward' : iconOf(resource)} size={16} color={colors.ink3} />
      </View>
      <Text style={styles.tileName} numberOfLines={2}>
        {resource.tile?.name ?? resource.title}
      </Text>
      <Text style={styles.tileLine} numberOfLines={2}>
        {resource.tile?.line ?? resource.blurb}
      </Text>
    </Pressable>
  );
}

function FindPage({ catalog, onOpen }: { catalog: HelpCatalog; onOpen: (r: HelpResource) => void }) {
  const mood = useCheckinStore((s) => s.todayEntries[0]?.mood ?? null);
  const ranked = useMemo(() => rankResources(catalog.find, mood), [catalog, mood]);

  return (
    <View style={styles.tiles}>
      {ranked.map((r) => (
        <ResourceTile key={r.id} resource={r} onOpen={() => onOpen(r)} />
      ))}
    </View>
  );
}

function ActionLink({ icon, label, href, a11y }: { icon: keyof typeof Ionicons.glyphMap; label: string; href: string; a11y: string }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={a11y} onPress={() => openHref(href)} hitSlop={6} style={styles.resourceAction}>
      <Ionicons name={icon} size={14} color={colors.indigo} />
      <Text style={styles.resourceActionText}>{label}</Text>
    </Pressable>
  );
}

function Fact({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <Text style={styles.resourceFact}>
      <Text style={styles.resourceFactLabel}>{label}: </Text>
      {value}
    </Text>
  );
}

/** One thing an organization offers: what it is, who it is for, and its own link. */
function ItemCard({ item }: { item: ResourceItem }) {
  return (
    <Card style={styles.resourceCard}>
      <Text style={styles.resourceTitle}>{item.title}</Text>
      <Text style={styles.resourceBlurb}>{item.blurb}</Text>
      <Fact label="Location" value={item.location} />
      <Fact label="Service Type" value={item.serviceType} />
      <Fact label="For" value={item.audience} />
      {item.details && <Text style={styles.resourceDetails}>{item.details}</Text>}
      <View style={styles.resourceActions}>
        <ActionLink icon="open-outline" label="Learn More" href={item.url} a11y={`Learn more about ${item.title}`} />
        {item.phone && <ActionLink icon="call-outline" label="Call" href={`tel:${item.phone}`} a11y={`Call ${item.title}`} />}
        {item.sms && <ActionLink icon="chatbubble-outline" label="Text" href={`sms:${item.sms}`} a11y={`Text ${item.title}`} />}
      </View>
    </Card>
  );
}

/** The second level of Find Resources: everything one organization offers, listed in the app. */
function ResourceItemsPage({ resource }: { resource: HelpResource }) {
  const logo = resource.logo ? RESOURCE_LOGOS[resource.logo] : undefined;
  return (
    <View style={styles.findPage}>
      <View style={styles.resourceHead}>
        <View style={styles.logoWrap}>
          {logo ? (
            <Image source={logo} style={styles.logo} resizeMode="contain" />
          ) : (
            <Ionicons name="medkit-outline" size={22} color={colors.indigo} />
          )}
        </View>
        <View style={styles.resourceTitleWrap}>
          <Text style={styles.resourceTitle}>{resource.title}</Text>
          <Text style={styles.resourceMeta}>{resource.blurb}</Text>
        </View>
      </View>
      <View style={styles.resourceActions}>
        {resource.url && <ActionLink icon="open-outline" label="Website" href={resource.url} a11y={`${resource.title} website`} />}
        {resource.phone && <ActionLink icon="call-outline" label="Call" href={`tel:${resource.phone}`} a11y={`Call ${resource.title}`} />}
      </View>
      <Text style={styles.note}>
        {resource.items!.length} {resource.items!.length === 1 ? 'resource' : 'resources'}
      </Text>
      {resource.items!.map((item) => (
        <ItemCard key={item.id} item={item} />
      ))}
    </View>
  );
}

const SAMPLE_NOTICE = 'Sample screen. This is not connected to Mental Health America staff yet, so nobody will reply. In a crisis, call or text 988.';

function PartnerTalk({ partner }: { partner: TalkPartner }) {
  const [mode, setMode] = useState<'message' | 'video' | null>(null);
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState<string[]>([]);

  if (mode) {
    return (
      <>
        <View style={styles.sampleBanner} accessibilityRole="alert">
          <Ionicons name="information-circle-outline" size={18} color={colors.rose} />
          <Text style={styles.sampleText}>{SAMPLE_NOTICE}</Text>
        </View>
        {mode === 'message' ? (
          <Card style={styles.chat}>
            {sent.map((m, i) => (
              <Text key={i} style={styles.bubble}>
                {m}
              </Text>
            ))}
            <View style={styles.composer}>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                placeholder={`Message ${partner.name}`}
                placeholderTextColor={colors.ink3}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add to sample conversation"
                onPress={() => {
                  if (!draft.trim()) return;
                  setSent((s) => [...s, draft.trim()]);
                  setDraft('');
                }}
                hitSlop={8}
              >
                <Ionicons name="send" size={20} color={colors.primary} />
              </Pressable>
            </View>
          </Card>
        ) : (
          <View style={styles.video}>
            <Ionicons name="videocam-outline" size={36} color="#ffffff" />
            <Text style={styles.videoText}>Video Chat With {partner.name}</Text>
          </View>
        )}
        <Text style={styles.back} accessibilityRole="button" onPress={() => setMode(null)}>
          Back To Ways To Talk
        </Text>
      </>
    );
  }

  return (
    <>
      <View style={styles.partnerHead}>
        <Image
          source={MHA_LOGO}
          style={styles.partnerLogo}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel="Mental Health America logo"
        />
        <Text style={styles.partnerRegion}>Mental Health America · {partner.region}</Text>
        <Text style={styles.partnerTitle}>Connect With {partner.name}</Text>
        <Text style={styles.note}>Get support, ask questions, or learn about programs.</Text>
      </View>
      <Card style={styles.listCard}>
        <Row
          icon={<Ionicons name="chatbubble-outline" size={20} color={colors.teal} />}
          iconBg={colors.tealSoft}
          title="Message"
          subtitle="Send a text message"
          onPress={() => setMode('message')}
          style={styles.row}
        />
        <View style={styles.divider} />
        <Row
          icon={<Ionicons name="call-outline" size={20} color={colors.primary} />}
          iconBg={colors.primarySoft}
          title="Call"
          subtitle="Call the Mental Health America office"
          onPress={() => openHref(`tel:${partner.phone}`)}
          style={styles.row}
        />
        <View style={styles.divider} />
        <Row
          icon={<Ionicons name="videocam-outline" size={20} color={colors.amber} />}
          iconBg={colors.amberSoft}
          title="Video Chat"
          subtitle="Talk with a staff member"
          onPress={() => setMode('video')}
          style={styles.row}
        />
      </Card>
      <Text style={styles.note}>
        MoodSense does not share your check-ins or sensing data with Mental Health America.
      </Text>
    </>
  );
}

function TalkPage({ catalog }: { catalog: HelpCatalog }) {
  return (
    <>
      {catalog.talkPartner && <PartnerTalk partner={catalog.talkPartner} />}
      <ResourceList resources={catalog.talk} />
    </>
  );
}

export function PeerPage({ catalog, onOpenRoom }: { catalog: HelpCatalog; onOpenRoom: (group: PeerGroup) => void }) {
  const { ids, called, load, toggle, markCalled } = useJoinedGroups();
  const [tab, setTab] = useState<'mine' | 'all'>('all');
  useEffect(() => {
    void load();
  }, [load]);

  const organizer = catalog.groupsOrganizer;
  if (!organizer) return <ResourceList resources={catalog.peer} />;

  const shown = tab === 'mine' ? catalog.groups.filter((g) => ids.includes(g.id)) : catalog.groups;

  const join = async (group: PeerGroup) => {
    if (ids.includes(group.id)) return;
    const event = calendarEventFor(group, organizer, new Date());
    try {
      if (!event) throw new Error('no upcoming meeting');
      if (await addGroupToCalendar(event, Platform.OS === 'ios')) {
        void toggle(group.id);
        joinRoomInBackground(group.id, group, isLlmEnabled());
      }
    } catch (err) {
      console.warn('Could not add group to calendar:', err);
      Alert.alert("Could not open your calendar", `${group.name} meets ${group.schedule}.`);
    }
  };

  return (
    <>
      <View style={styles.chips}>
        {(['mine', 'all'] as const).map((t) => (
          <Pill
            key={t}
            label={t === 'mine' ? 'My Groups' : 'All Groups'}
            color={tab === t ? colors.surface : colors.ink2}
            bg={tab === t ? colors.primary : colors.surface2}
            onPress={() => setTab(t)}
          />
        ))}
      </View>
      {shown.length === 0 && (
        <Text style={styles.note}>Groups you join will show up here.</Text>
      )}
      {shown.map((g) => {
        const joined = ids.includes(g.id);
        return (
          <CommunityCard
            key={g.id}
            logo={organizer.logo ? RESOURCE_LOGOS[organizer.logo] : undefined}
            emoji={g.emoji ?? '\u{1F91D}'}
            name={g.name}
            about={g.about}
            meta={[`${g.schedule} · ${g.format}`, ...(g.location ? [g.location] : [])]}
            actions={
              joined
                ? [
                    {
                      label: 'Joined',
                      icon: 'checkmark',
                      variant: 'soft',
                      accessibilityLabel: `Joined ${g.name}`,
                      // The organizer is not told about a join made here; the badge stays until
                      // the person taps it to call and confirm their place.
                      badge: called.includes(g.id)
                        ? undefined
                        : {
                            icon: 'call',
                            onPress: () => {
                              void markCalled(g.id);
                              openHref(`tel:${organizer.phone}`);
                            },
                            accessibilityLabel: `Call ${organizer.name} to confirm your place in ${g.name}`,
                          },
                    },
                    {
                      label: 'Chat',
                      icon: 'chatbubbles-outline',
                      variant: 'solid',
                      onPress: () => onOpenRoom(g),
                      accessibilityLabel: `Open the ${g.name} group chat`,
                    },
                  ]
                : [
                    {
                      label: 'Join',
                      variant: 'solid',
                      onPress: () => void join(g),
                      accessibilityLabel: `Join ${g.name}`,
                    },
                  ]
            }
          />
        );
      })}
      <ResourceList
        resources={[
          {
            id: 'organizer-call',
            title: `Call ${organizer.name}`,
            blurb: "Ask about a group, or one you do not see here.",
            phone: organizer.phone,
          },
          {
            id: 'organizer-page',
            title: 'Meeting Links And Details',
            blurb: 'The current list on their website.',
            url: organizer.url,
          },
        ]}
      />
      <Text style={styles.subhead}>More Ways To Find A Group</Text>
      <ResourceList resources={catalog.peer} />
    </>
  );
}

export default function HelpDetailScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'HelpDetail'>) {
  const { section, resourceId } = route.params;
  const catalog = useHelpCatalog();
  const opened = resourceId ? catalog.find.find((r) => r.id === resourceId) : undefined;

  useEffect(() => {
    if (section === 'talk') navigation.setOptions({ title: catalog.talkTitle });
    if (opened) navigation.setOptions({ title: opened.tile?.name ?? opened.title });
  }, [section, catalog.talkTitle, opened, navigation]);

  const openResource = (r: HelpResource) => {
    if (r.items?.length) {
      navigation.push('HelpDetail', { section: 'find', resourceId: r.id });
      return;
    }
    const href = hrefOf(r);
    if (href) openHref(href);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll}>
      {section === 'find' && (opened?.items?.length ? <ResourceItemsPage resource={opened} /> : <FindPage catalog={catalog} onOpen={openResource} />)}
      {section === 'talk' && <TalkPage catalog={catalog} />}
      {section === 'peer' && (
        <PeerPage catalog={catalog} onOpenRoom={(g) => navigation.push('GroupRoom', { groupId: g.id })} />
      )}
      {section === 'crisis' && (
        <>
          <Text style={styles.note}>If you are in danger or thinking about ending your life, reach out now.</Text>
          <ResourceList resources={catalog.crisis} accent={colors.rose} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  note: { ...type.caption, color: colors.ink3 },
  subhead: { ...type.caption, color: colors.ink3, fontWeight: '700', marginTop: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  listCard: { paddingVertical: spacing.xs },
  row: { paddingVertical: spacing.sm },
  textInstead: { ...type.caption, fontWeight: '700', paddingBottom: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  partnerHead: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  partnerLogo: { width: 88, height: 88, borderRadius: radius.md },
  partnerRegion: { ...type.caption, color: colors.ink3 },
  partnerTitle: { ...type.h2, color: colors.ink, marginTop: spacing.sm },
  sampleBanner: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.roseSoft,
  },
  sampleText: { ...type.caption, color: colors.ink, flex: 1 },
  chat: { gap: spacing.sm, minHeight: 200, justifyContent: 'flex-end' },
  bubble: {
    ...type.sub,
    alignSelf: 'flex-end',
    color: colors.surface,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  composer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    ...type.sub,
    flex: 1,
    color: colors.ink,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  video: {
    height: 240,
    borderRadius: radius.lg,
    backgroundColor: '#161a3a',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  videoText: { ...type.sub, color: '#ffffff' },
  back: { ...type.sub, color: colors.primary, fontWeight: '700', textAlign: 'center' },
  findPage: { gap: spacing.md },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.md },
  tile: {
    width: '48%',
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  tilePressed: { opacity: 0.7 },
  tileTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  tileName: { ...type.sub, color: colors.ink, fontWeight: '700' },
  tileLine: { ...type.caption, color: colors.ink3 },
  logoWrap: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  logo: { width: 40, height: 40 },
  resourceHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  resourceTitleWrap: { flex: 1, gap: 2 },
  resourceMeta: { ...type.caption, color: colors.ink2 },
  resourceCard: { gap: spacing.xs },
  resourceTitle: { ...type.sub, color: colors.ink, fontWeight: '700' },
  resourceBlurb: { ...type.sub, color: colors.ink2 },
  resourceFact: { ...type.caption, color: colors.ink2 },
  resourceFactLabel: { fontWeight: '700', color: colors.ink },
  resourceDetails: { ...type.caption, color: colors.ink3, marginTop: spacing.xs },
  resourceActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.xs },
  resourceAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  resourceActionText: { ...type.caption, color: colors.indigo, fontWeight: '700' },
});
