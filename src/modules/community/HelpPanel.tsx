/** The Recharge tab's Get Support list: the way in to each kind of support. Peer and official communities live on the Community tab. */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Card, Row } from '../../components';
import { colors, spacing } from '../../theme';
import type { RootStackParamList } from '../../navigation';
import { HELP_SECTION_TITLES, type HelpSection } from './HelpDetailScreen';
import { useHelpCatalog } from './useHelpCatalog';

export default function HelpPanel() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const catalog = useHelpCatalog();

  const entries: {
    section: HelpSection;
    title: string;
    subtitle: string;
    icon: keyof typeof Ionicons.glyphMap;
    tint: string;
    bg: string;
  }[] = [
    {
      section: 'find',
      title: HELP_SECTION_TITLES.find,
      subtitle: 'Local mental health services, programs, and tools',
      icon: 'search-outline',
      tint: colors.indigo,
      bg: colors.indigoSoft,
    },
    {
      section: 'talk',
      title: catalog.talkTitle,
      subtitle: catalog.talkPartner ? 'Message, call, or video chat with staff' : 'Reach a counsellor or helpline',
      icon: 'chatbubble-ellipses-outline',
      tint: colors.violet,
      bg: colors.violetSoft,
    },
    {
      section: 'crisis',
      title: HELP_SECTION_TITLES.crisis,
      subtitle: `Immediate help: ${catalog.crisis[0]?.title}`,
      icon: 'warning-outline',
      tint: colors.rose,
      bg: colors.roseSoft,
    },
  ];

  return (
    <View style={styles.panel}>
      {entries.map((e) => (
        <Card key={e.section} style={styles.card}>
          <Row
            icon={<Ionicons name={e.icon} size={20} color={e.tint} />}
            iconBg={e.bg}
            title={e.title}
            subtitle={e.subtitle}
            right={<Ionicons name="chevron-forward" size={18} color={colors.ink3} />}
            onPress={() => navigation.navigate('HelpDetail', { section: e.section })}
            accessibilityLabel={`${e.title}. ${e.subtitle}`}
          />
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.sm },
  card: { paddingVertical: spacing.xs },
});
