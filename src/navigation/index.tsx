import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { colors } from '../theme';
import { CONFIG } from '../config';
import { hasLocalAccount, isRestorableSession, waitForAuthState } from '../services/firebase';
import { resolveInitialRoute } from '../modules/auth/pure';
import AuthScreen from '../modules/auth/AuthScreen';
import ConsentDetailScreen from '../modules/consent/ConsentDetailScreen';
import ConsentOnboardingScreen from '../modules/consent/ConsentOnboardingScreen';
import TermsPrivacyScreen from '../modules/legal/TermsPrivacyScreen';
import TermsScreen from '../modules/legal/TermsScreen';
import PrivacyPolicyScreen from '../modules/legal/PrivacyPolicyScreen';
import HomeScreen from '../modules/checkin/HomeScreen';
import Phq4Screen from '../modules/phq4/Phq4Screen';
import ActivityPlayerScreen from '../modules/activities/ActivityPlayerScreen';
import { getActivity, type ActivityGoal } from '../modules/activities/config';
import GameScreen from '../modules/games/GameScreen';
import SoundPlayerScreen from '../modules/sounds/SoundPlayerScreen';
import { getSoundscape, type SoundscapeId } from '../modules/sounds/config';
import { getGame, type GameId } from '../modules/games/config';
import CommunityScreen from '../modules/community/CommunityScreen';
import RechargeScreen from '../modules/recharge/RechargeScreen';
import GroupRoomScreen from '../modules/community/GroupRoomScreen';
import HelpDetailScreen, { HELP_SECTION_TITLES, type HelpSection } from '../modules/community/HelpDetailScreen';
import ChooseCommunityScreen from '../modules/community/ChooseCommunityScreen';
import InsightsScreen from '../modules/sensing/InsightsScreen';
import StreamDebugScreen from '../modules/sensing/StreamDebugScreen';
import SettingsScreen from '../modules/settings/SettingsScreen';

export type RootStackParamList = {
  Auth: undefined;
  ConsentDetail: undefined;
  ConsentOnboarding: undefined;
  Terms: undefined;
  TermsPrivacy: undefined;
  PrivacyPolicy: undefined;
  ChooseCommunity: { manual?: boolean } | undefined;
  MainTabs: undefined;
  /** `resourceId` opens one Find Resources tile's list of what it offers. */
  HelpDetail: { section: HelpSection; resourceId?: string };
  /** The chat room of one peer group from My Groups: its members and the AI guide. */
  GroupRoom: { groupId: string };
  Phq4: undefined;
  /** `goal` is the feeling the Home card offered this activity for, so the player can lead with the same promise the user tapped. Optional: an activity opened from elsewhere has no such framing. */
  ActivityPlayer: { activityId: string; goal?: ActivityGoal };
  Game: { gameId: GameId };
  SoundPlayer: { soundId: SoundscapeId };
  Settings: undefined;
  /** Developer-mode raw event log. An empty `streams` array means every stream; `title` is named after the card the developer tapped. */
  StreamDebug: { streams: string[]; title: string };
};

export type MainTabsParamList = {
  Home: undefined;
  Community: undefined;
  /** Mood-based suggestions, activities, then Get Support (was the Help tab). */
  Recharge: undefined;
  You: undefined;
};

export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

export type MainTabScreenProps<T extends keyof MainTabsParamList> =
  BottomTabScreenProps<MainTabsParamList, T>;

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabsParamList>();

const TAB_ICONS: Record<
  keyof MainTabsParamList,
  { focused: keyof typeof Ionicons.glyphMap; unfocused: keyof typeof Ionicons.glyphMap }
> = {
  Home: { focused: 'home', unfocused: 'home-outline' },
  Community: { focused: 'people', unfocused: 'people-outline' },
  Recharge: { focused: 'leaf', unfocused: 'leaf-outline' },
  You: { focused: 'person', unfocused: 'person-outline' },
};

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        // A tab in the background does not re-render on store updates (a check-in, a sync) and
        // so does not compete with the tab being opened.
        freezeOnBlur: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.ink3,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.line,
        },
        tabBarLabelStyle: {
          fontSize: 11,
        },
        tabBarIcon: ({ focused, color, size }) => {
          const icons = TAB_ICONS[route.name];
          return (
            <Ionicons
              name={focused ? icons.focused : icons.unfocused}
              size={size}
              color={color}
            />
          );
        },
      })}
    >
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen name="Community" component={CommunityScreen} />
      <Tabs.Screen name="Recharge" component={RechargeScreen} />
      <Tabs.Screen name="You" component={InsightsScreen} />
    </Tabs.Navigator>
  );
}

export function RootNav() {
  // Resolved before mount so a returning signed-in user goes straight to MainTabs instead of flashing Auth.
  // A fresh install always starts at Auth.
  const [initialRoute, setInitialRoute] = useState<'Auth' | 'MainTabs' | null>(null);

  useEffect(() => {
    if (CONFIG.USE_FIREBASE) {
      waitForAuthState().then((user) => {
        const route = resolveInitialRoute(true, isRestorableSession(user), false);
        setInitialRoute(route);
      });
    } else {
      hasLocalAccount()
        .then((has) => setInitialRoute(resolveInitialRoute(false, false, has)))
        .catch(() => setInitialRoute('Auth'));
    }
  }, []);

  if (initialRoute === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack.Navigator
      initialRouteName={initialRoute}
      screenOptions={{
        headerShown: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="Auth" component={AuthScreen} />
      <Stack.Screen
        name="ConsentDetail"
        component={ConsentDetailScreen}
        options={{ presentation: 'modal', headerShown: true, title: 'Your data' }}
      />
      <Stack.Screen
        name="ConsentOnboarding"
        component={ConsentOnboardingScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Terms"
        component={TermsScreen}
        options={{ presentation: 'modal', headerShown: true, title: 'Terms of Service' }}
      />
      <Stack.Screen
        name="TermsPrivacy"
        component={TermsPrivacyScreen}
        options={{ presentation: 'modal', headerShown: true, title: 'Terms & privacy' }}
      />
      <Stack.Screen
        name="PrivacyPolicy"
        component={PrivacyPolicyScreen}
        options={{ presentation: 'modal', headerShown: true, title: 'Privacy Policy' }}
      />
      <Stack.Screen
        name="ChooseCommunity"
        component={ChooseCommunityScreen}
        options={{ presentation: 'modal', headerShown: true, title: 'Choose Your Community' }}
      />
      <Stack.Screen name="MainTabs" component={MainTabs} />
      <Stack.Screen
        name="HelpDetail"
        component={HelpDetailScreen}
        options={({ route }) => ({
          headerShown: true,
          title: HELP_SECTION_TITLES[route.params.section],
        })}
      />
      <Stack.Screen
        name="GroupRoom"
        component={GroupRoomScreen}
        options={{ headerShown: true, title: 'Group chat' }}
      />
      <Stack.Screen
        name="Phq4"
        component={Phq4Screen}
        options={{ presentation: 'modal', headerShown: true, title: 'Mood Check' }}
      />
      <Stack.Screen
        name="ActivityPlayer"
        component={ActivityPlayerScreen}
        options={({ route }) => ({
          presentation: 'modal',
          headerShown: true,
          // The screen puts its own X in the header, so hide the stack's back chevron.
          headerBackVisible: false,
          headerLeft: () => null,
          title: getActivity(route.params.activityId)?.title ?? 'Activity',
        })}
      />
      <Stack.Screen
        name="Game"
        component={GameScreen}
        options={({ route }) => ({
          presentation: 'modal',
          headerShown: true,
          headerBackVisible: false,
          headerLeft: () => null,
          title: getGame(route.params.gameId)?.title ?? 'Game',
        })}
      />
      <Stack.Screen
        name="SoundPlayer"
        component={SoundPlayerScreen}
        options={({ route }) => ({
          presentation: 'modal',
          headerShown: true,
          headerBackVisible: false,
          headerLeft: () => null,
          title: getSoundscape(route.params.soundId)?.title ?? 'Sound',
        })}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ headerShown: true, title: 'Settings', headerBackTitle: '' }}
      />
      <Stack.Screen
        name="StreamDebug"
        component={StreamDebugScreen}
        options={({ route }) => ({ headerShown: true, title: route.params.title })}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
});
