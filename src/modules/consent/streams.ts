/** The same streams are described in prose in ./consentText.ts; keep the two in step. */
import { Platform } from 'react-native';
import { colors } from '../../theme';
import type { ConsentKey } from './store';

export interface StreamRowSpec {
  key: ConsentKey;
  emoji: string;
  iconBg: string;
  title: string;
  subtitle: string;
}

export const STREAMS: StreamRowSpec[] = [
  {
    key: 'motion',
    emoji: '\u{1F4F1}',
    iconBg: colors.surface2,
    title: 'Motion & activity',
    subtitle: 'accelerometer, steps, activity type',
  },
  {
    key: 'screen',
    emoji: '\u{1F513}',
    iconBg: colors.surface2,
    title: 'Screen & usage',
    subtitle: 'screen on-off, unlock frequency',
  },
  {
    key: 'health',
    emoji: '\u{2665}',
    iconBg: colors.surface2,
    title: 'Health data',
    subtitle: 'heart rate, breathing, blood oxygen, steps, workouts from HealthKit/Health Connect',
  },
  {
    key: 'sleep',
    emoji: '\u{1F31C}',
    iconBg: colors.surface2,
    title: 'Sleep tracking',
    subtitle: 'sleep stages from health platforms, plus estimated sleep from phone inactivity',
  },
  {
    key: 'appUsage',
    emoji: '\u{1F4CA}',
    iconBg: colors.surface2,
    title: 'App usage stats',
    subtitle:
      Platform.OS === 'ios'
        ? 'screen time, plus daily time marks for app groups and apps you pick yourself'
        : 'screen time, time in social and video apps, unlock counts',
  },
  {
    key: 'calls',
    emoji: '\u{1F4DE}',
    iconBg: colors.surface2,
    title: 'Call length',
    subtitle:
      Platform.OS === 'ios'
        ? 'how long calls last — never who you called; uses location only to keep running, never stores it'
        : 'how long calls last — never who you called',
  },
];
