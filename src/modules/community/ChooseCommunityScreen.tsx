/**
 * Community picker. First time (no community yet), the place resolved from the device's IP is
 * saved automatically with no prompt; manual choice only appears if the lookup fails. When
 * changing later, the resolved place is offered for one-tap confirmation and "Choose manually" walks country (US, Canada, Singapore) -> region -> city instead.
 * On the sign-up path there is no back target, so choosing goes on to MainTabs instead of going back.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Card, Row, Screen } from '../../components';
import { colors, spacing, type } from '../../theme';
import type { RootStackParamList } from '../../navigation';
import {
  MANUAL_COUNTRIES,
  MANUAL_REGIONS,
  OTHER_PLACE,
  communityLabel,
  placeLabel,
  placeToCommunityId,
  type Place,
} from './communities';
import { resolveLocation } from './resolveLocation';
import { getChosenCommunity, setChosenCommunity } from './store';
import { logEvent } from '../../services/logging';

export default function ChooseCommunityScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'ChooseCommunity'>>();
  // Sent from consent when the lookup already failed: go straight to manual, no spinner.
  const startManual = route.params?.manual === true;
  const [current, setCurrent] = useState<string | null>(null);
  const [detected, setDetected] = useState<Place | null>(null);
  const [detecting, setDetecting] = useState(!startManual);
  const [manual, setManual] = useState(startManual);
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      const id = await getChosenCommunity();
      if (!alive) return;
      setCurrent(id);
      if (startManual) return;
      const place = await resolveLocation();
      if (!alive) return;
      setDetected(place);
      if (place != null && id == null) {
        // Sign-up: no prompt, the IP-resolved place is the community.
        await choose(place, 'ip');
        return;
      }
      setDetecting(false);
      if (place == null) setManual(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const choose = async (place: Place, source: 'ip' | 'manual') => {
    const communityId = placeToCommunityId(place);
    if (saving != null) return;
    setSaving(communityId);
    try {
      const isChange = current != null;
      await setChosenCommunity(communityId);
      void logEvent('community_chosen', {
        communityId,
        countryId: place.countryCode,
        source,
        isChange,
      });
      if (navigation.canGoBack()) {
        navigation.goBack();
      } else {
        navigation.replace('MainTabs');
      }
    } finally {
      setSaving(null);
    }
  };

  const chevron = <Ionicons name="chevron-forward" size={20} color={colors.ink3} />;
  const divider = (i: number, n: number) => (i < n - 1 ? styles.rowDivider : undefined);

  if (detecting) {
    return (
      <Screen edges={['top', 'bottom']}>
        <Text style={styles.title}>Finding your community</Text>
        <ActivityIndicator color={colors.primary} style={styles.spinner} />
      </Screen>
    );
  }

  if (!manual && detected != null) {
    return (
      <Screen edges={['top', 'bottom']}>
        <Text style={styles.title}>Choose your community</Text>
        <Text style={styles.subtitle}>
          We use your approximate location to show anonymous mood trends from people near you
          — never your exact location.
        </Text>
        <Card variant="white" style={styles.card}>
          <Row
            title={placeLabel(detected)}
            subtitle="Based on your connection"
            onPress={() => void choose(detected, 'ip')}
            right={
              saving != null ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
              )
            }
            style={styles.rowDivider}
          />
          <Row title="Choose manually" onPress={() => setManual(true)} right={chevron} />
        </Card>
        {current != null ? (
          <Text style={styles.subtitle}>Current: {communityLabel(current) ?? current}</Text>
        ) : null}
      </Screen>
    );
  }

  if (countryCode == null) {
    return (
      <Screen edges={['top', 'bottom']}>
        <Text style={styles.title}>Choose your country</Text>
        <Text style={styles.subtitle}>
          Pick where you are. We only show anonymous mood trends from people near you.
        </Text>
        <Card variant="white" style={styles.card}>
          {MANUAL_COUNTRIES.map((c, i) => (
            <Row
              key={c.code}
              title={c.label}
              onPress={() => {
                setCountryCode(c.code);
                const regions = Object.keys(MANUAL_REGIONS[c.code]);
                if (regions.length === 1) setRegion(regions[0]);
              }}
              right={chevron}
              style={styles.rowDivider}
            />
          ))}
          <Row
            title="Other country"
            onPress={() => void choose(OTHER_PLACE, 'manual')}
            right={
              saving === placeToCommunityId(OTHER_PLACE) ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                chevron
              )
            }
          />
        </Card>
        {detected != null ? (
          <Text style={styles.backLink} onPress={() => setManual(false)}>
            {'‹'} Use {placeLabel(detected)}
          </Text>
        ) : null}
      </Screen>
    );
  }

  const regions = MANUAL_REGIONS[countryCode];
  const back = () => {
    setQuery('');
    if (region != null && Object.keys(regions).length > 1) setRegion(null);
    else {
      setRegion(null);
      setCountryCode(null);
    }
  };

  if (region == null) {
    const names = Object.keys(regions).sort();
    return (
      <Screen edges={['top', 'bottom']}>
        <Text style={styles.title}>Choose your area</Text>
        <Text style={styles.backLink} onPress={back}>
          {'‹'} Change country
        </Text>
        <Card variant="white" style={styles.card}>
          {names.map((r, i) => (
            <Row
              key={r}
              title={r}
              onPress={() => setRegion(r)}
              right={chevron}
              style={divider(i, names.length)}
            />
          ))}
        </Card>
      </Screen>
    );
  }

  const q = query.trim().toLowerCase();
  const cities = regions[region].filter((c) => c.toLowerCase().includes(q));
  const wholeRegion = { countryCode, region, city: region };
  return (
    <Screen edges={['top', 'bottom']}>
      <Text style={styles.title}>Choose your city</Text>
      <Text style={styles.backLink} onPress={back}>
        {'‹'} Change area
      </Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={`Search cities in ${region}`}
        placeholderTextColor={colors.ink3}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.search}
      />
      <Card variant="white" style={styles.card}>
        {cities.map((city, i) => {
          const place = { countryCode, region, city };
          const id = placeToCommunityId(place);
          return (
            <Row
              key={city}
              title={city}
              onPress={() => void choose(place, 'manual')}
              right={
                saving === id ? (
                  <ActivityIndicator color={colors.primary} />
                ) : id === current ? (
                  <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                ) : (
                  chevron
                )
              }
              style={styles.rowDivider}
            />
          );
        })}
        <Row
          title={regions[region].length > 0 ? `Elsewhere in ${region}` : `All of ${region}`}
          onPress={() => void choose(wholeRegion, 'manual')}
          right={
            saving === placeToCommunityId(wholeRegion) ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              chevron
            )
          }
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    ...type.title,
    color: colors.ink,
    marginTop: spacing.xl,
  },
  subtitle: {
    ...type.body,
    color: colors.ink2,
    marginTop: spacing.sm,
    lineHeight: 21,
  },
  search: {
    ...type.body,
    color: colors.ink,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  spinner: {
    marginTop: spacing.xl,
  },
  backLink: {
    ...type.caption,
    color: colors.primary,
    fontWeight: '700',
    marginTop: spacing.md,
  },
  card: {
    marginTop: spacing.xl,
    paddingVertical: spacing.xs,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
});
