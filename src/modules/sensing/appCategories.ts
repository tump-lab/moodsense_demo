/**
 * Maps Android package names to the categories the app reports on: social, audio/video, and calls.
 * The call bucket only measures time in the dialer or in-call UI, since Android exposes no call duration to a normal app, and it misses calls made inside WhatsApp or Messenger.
 */

export type AppCategory = 'social' | 'audioVideo' | 'call' | 'other';

export const APP_CATEGORY_MAP: Readonly<Record<string, AppCategory>> = {
  // Social: apps that ship under more than one package are listed under each, since a missing package is silently counted as `other`.
  'com.facebook.katana': 'social',
  'com.facebook.lite': 'social',
  'com.facebook.orca': 'social',
  'com.whatsapp': 'social',
  'com.whatsapp.w4b': 'social',
  'com.instagram.android': 'social',
  'com.linkedin.android': 'social',
  'com.twitter.android': 'social',
  'com.zhiliaoapp.musically': 'social',
  'com.ss.android.ugc.trill': 'social',
  'com.ss.android.ugc.aweme': 'social',
  'com.xingin.xhs': 'social',
  'com.tencent.mm': 'social',
  'com.snapchat.android': 'social',
  'com.reddit.frontpage': 'social',
  'org.telegram.messenger': 'social',
  'com.discord': 'social',

  // Audio / video, with podcast clients covered well since on Android they are spread across many third-party apps.
  'com.google.android.youtube': 'audioVideo',
  'com.google.android.apps.youtube.music': 'audioVideo',
  'com.netflix.mediaclient': 'audioVideo',
  'tv.danmaku.bili': 'audioVideo',
  'com.bilibili.app.in': 'audioVideo',
  'com.spotify.music': 'audioVideo',
  'au.com.shiftyjelly.pocketcasts': 'audioVideo',
  'fm.castbox.audiobook.radio.podcast': 'audioVideo',
  'app.podcast.cosmos': 'audioVideo',
  'com.ximalaya.ting.android': 'audioVideo',
  'com.audible.application': 'audioVideo',
  'com.amazon.avod.thirdpartyclient': 'audioVideo',
  'com.disney.disneyplus': 'audioVideo',
  'tv.twitch.android.app': 'audioVideo',
  'com.qiyi.video': 'audioVideo',
  'com.tencent.qqlive': 'audioVideo',

  // Calls: dialer and in-call UI packages differ per OEM, so the common ones are listed rather than substring-matched on "dialer".
  'com.google.android.dialer': 'call',
  'com.android.dialer': 'call',
  'com.android.incallui': 'call',
  'com.android.server.telecom': 'call',
  'com.samsung.android.dialer': 'call',
  'com.samsung.android.incallui': 'call',
  'com.miui.dialer': 'call',
  'com.oneplus.dialer': 'call',
  'com.oppo.dialer': 'call',
  'com.transsion.phonemaster': 'call',
};

export function categorizeApp(packageName: string): AppCategory {
  return APP_CATEGORY_MAP[packageName] ?? 'other';
}

export type CategoryDurations = Record<AppCategory, number>;

const EMPTY_CATEGORY_DURATIONS: CategoryDurations = {
  social: 0,
  audioVideo: 0,
  call: 0,
  other: 0,
};

export function aggregateCategoryDurations(
  stats: Array<{ packageName: string; totalForegroundTime: number }>,
): CategoryDurations {
  const totals: CategoryDurations = { ...EMPTY_CATEGORY_DURATIONS };
  for (const s of stats) {
    const category = categorizeApp(s.packageName);
    totals[category] += s.totalForegroundTime ?? 0;
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Name-based default categorization (platform-independent)
// ---------------------------------------------------------------------------

/**
 * The two buckets this app actually measures, by common app name rather
 * than package/bundle identifier — see this file's module doc for why the
 * identifier-based map above can't be the whole story. `aliases` covers a
 * rename (X was Twitter) or a transliteration (RedNote / Xiaohongshu) that a
 * person might type either way.
 *
 * Deliberately only the two buckets a participant would ever need to
 * recognize in a picker or a manual "add an app" field — `call` is dialer
 * plumbing, not a named app someone selects, so it has no entry here.
 */
interface NamedApp {
  name: string;
  category: 'social' | 'audioVideo';
  aliases?: string[];
}

export const DEFAULT_APP_CATEGORIES: readonly NamedApp[] = [
  // Social media.
  { name: 'Facebook', category: 'social' },
  { name: 'WhatsApp', category: 'social' },
  { name: 'Instagram', category: 'social' },
  { name: 'X', category: 'social', aliases: ['Twitter'] },
  { name: 'TikTok', category: 'social' },
  { name: 'RedNote', category: 'social', aliases: ['Xiaohongshu', '小红书'] },

  // Audio / video.
  { name: 'YouTube', category: 'audioVideo' },
  { name: 'Netflix', category: 'audioVideo' },
  { name: 'Podcasts', category: 'audioVideo', aliases: ['Podcast'] },
];

// 'podcast(s)' also matches generically below (e.g. "Apple Podcasts",
// "Google Podcasts", "Podcast Addict") so a client isn't limited to apps
// literally named "Podcasts" — "Podcast apps" is a class of app, not one
// product. Clients whose name doesn't contain the word at all (Pocket
// Casts, Overcast, Spotify) still need their own exact/alias entry above.
const AUDIO_VIDEO_KEYWORDS = ['podcast'];

/** Lowercased name -> category, built once from DEFAULT_APP_CATEGORIES so
 *  the alias list above stays the single source of truth. */
const NAME_LOOKUP: ReadonlyMap<string, AppCategory> = new Map(
  DEFAULT_APP_CATEGORIES.flatMap((app) => [
    [app.name.toLowerCase(), app.category] as const,
    ...(app.aliases ?? []).map((alias) => [alias.toLowerCase(), app.category] as const),
  ])
);

/**
 * Default-categorizes a common app by its display name, falling back to
 * `other` for anything not in the hardcoded roster above — so an app this
 * app has never heard of degrades to "uncategorized" rather than blocking
 * whatever flow is calling this (onboarding, a manual add, …).
 *
 * This is the one default-categorization path that works regardless of
 * platform: unlike `categorizeApp`, it needs no package name or bundle
 * identifier, so it can back a manual "which app is this" fallback — the
 * closest thing to automatic categorization iOS can get, since its own
 * app-selection picker never discloses that identity to this app in the
 * first place (see the module doc above).
 */
export function defaultCategoryForAppName(appName: string): AppCategory {
  const normalized = appName.trim().toLowerCase();
  if (normalized === '') return 'other';

  const exact = NAME_LOOKUP.get(normalized);
  if (exact) return exact;

  // Substring match for compound names (e.g. "Instagram Lite", "Pocket
  // Casts"), skipping names short enough to false-positive inside an
  // unrelated word — "x" alone would otherwise match "netflix" or "box",
  // and an exact-match input of just "x" or "X" is already handled above.
  const MIN_SUBSTRING_LEN = 3;
  for (const [name, category] of NAME_LOOKUP) {
    if (name.length < MIN_SUBSTRING_LEN) continue;
    if (normalized.includes(name)) return category;
  }
  for (const keyword of AUDIO_VIDEO_KEYWORDS) {
    if (normalized.includes(keyword)) return 'audioVideo';
  }
  return 'other';
}
