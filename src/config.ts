import { Platform } from 'react-native';

const USE_FIREBASE = Boolean(process.env.EXPO_PUBLIC_FIREBASE_API_KEY);

// Google sign-in also needs Firebase, because the Google credential is swapped for a Firebase session.
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';

const AI_ENABLED = process.env.EXPO_PUBLIC_AI_ENABLED !== 'false';

export const CONFIG = {
  USE_FIREBASE,
  GOOGLE_WEB_CLIENT_ID,
  GOOGLE_IOS_CLIENT_ID,
  // Off on iOS: App Review guideline 4.8 requires Sign in with Apple alongside any third-party login, and that
  // is not built yet. iOS users sign in with email and password.
  USE_GOOGLE_SIGNIN: USE_FIREBASE && Boolean(GOOGLE_WEB_CLIENT_ID) && Platform.OS !== 'ios',
  AI_ENABLED,
  // The Claude key is a secret on the Cloudflare Worker in worker/, never EXPO_PUBLIC_*, which is inlined into the
  // bundle. API_URL is that Worker's address (not a secret). Model names are not secrets either; the Worker checks
  // them against an allowlist. Haiku is the default because the text jobs are short and it is about 5x cheaper than Opus.
  API_URL: (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, ''),
  ANTHROPIC_MODEL: process.env.EXPO_PUBLIC_ANTHROPIC_MODEL ?? 'claude-haiku-4-5',
  SENSING: {
    // These two timers drive most Firestore writes: at 5 min, ~30 participants stay under the
    // Spark plan's 20K writes/day (2 x 288 x 30 = ~17K). Raise activityIntervalMs before growing
    // the cohort much past that.
    accelerometerIntervalMs: 300_000,
    activityIntervalMs: 300_000,
    // 6s at 20Hz is long enough to hold several strides at any walking pace, and short enough
    // that the sensor is off for ~98% of each window.
    activityBurstMs: 6_000,
    activitySampleIntervalMs: 50,
    uploadBatchSize: 200,
  },
  LOGGING: {
    uploadBatchSize: 200,
  },
  UPLOAD_FLUSH_INTERVAL_MS: 5 * 60_000,
} as const;
