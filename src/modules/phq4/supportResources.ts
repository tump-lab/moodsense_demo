/**
 * Deterministic crisis/support resource shown on the Mood Check result, and the policy deciding
 * when it has earned the screen.
 *
 * Kept as data and a pure function with no React Native or Expo imports, so a future localization
 * pass can swap the copy without touching Phq4Screen.tsx and scripts/selfcheck-phq4.ts can run the
 * whole policy under plain Node.
 *
 * Why it is not simply "moderate or worse": PHQ-4 asks four questions about the last two weeks, so
 * two items answered "nearly every day" reach 6 and tip a single check into moderate. On one check
 * that is a screening flag, not a crisis — offering the lifeline there met people who had only just
 * started using the app, and a card that shows up that readily is read as noise and stops carrying
 * weight when it matters. So a moderate score has to be a pattern rather than a moment: three
 * elevated checks inside the window, counting the one being scored, plus a quiet period after the
 * card was last shown. At the default weekly cadence that is most of a month reading elevated.
 * Severe is exempt from both — 9 of 12 is three or four items near-daily, which is reason enough on
 * its own, every time.
 *
 * Nothing about the score is hidden by this. The result screen still shows the Moderate band and
 * where both subscales sit against their cutoff, and every result is scored and saved in full; it
 * is only the lifeline card that waits for corroboration. The crisis resource itself is on every result
 * either way — as the card, or as `quietLine`.
 */
import { findCommunity } from '../community/communities';
import type { Phq4Severity } from './scoring';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CrisisResource {
  label: string;
  /** Number for the Call/Text buttons, or null when there is no verified number for the region. */
  phone: string | null;
  telHref: string | null;
  smsHref: string | null;
  /** Helpline directory, shown as a button when there is no verified number. */
  directoryUrl: string | null;
  /** Card copy, shown when the result earns the support card. */
  message: string;
  /**
   * One quiet line, shown on every Mood Check result the card is held back from.
   * PARTICIPANT_ONBOARDING.md promises the app never withholds crisis information, so the
   * policy below reserves the card, not the resource.
   */
  quietLine: string;
  /** Short sentence for chat replies and the support prompt. */
  inlineLine: string;
}

export const HELPLINE_DIRECTORY_URL = 'https://findahelpline.com';

const US_CRISIS_RESOURCE: CrisisResource = {
  label: '988 Suicide & Crisis Lifeline',
  phone: '988',
  telHref: 'tel:988',
  smsHref: 'sms:988',
  directoryUrl: null,
  message: "You are not alone. If things feel heavy right now, reach out — call or text 988 anytime, day or night.",
  quietLine: 'Any time things feel heavy, you can call or text 988.',
  inlineLine: 'You can call or text 988 anytime (United States).',
};

/**
 * Only the US number is verified (988lifeline.org). Anywhere else we send people to their local
 * emergency number and a directory rather than guess a number.
 */
const GENERIC_CRISIS_RESOURCE: CrisisResource = {
  label: 'Local crisis support',
  phone: null,
  telHref: null,
  smsHref: null,
  directoryUrl: HELPLINE_DIRECTORY_URL,
  message:
    "You are not alone. If things feel heavy right now, contact your local emergency number or a local crisis line, any time, day or night.",
  quietLine:
    'Any time things feel heavy, contact your local emergency number or a local crisis line (findahelpline.com).',
  inlineLine:
    'Please contact your local emergency number or a local crisis line (findahelpline.com) anytime.',
};

/**
 * Picks the resource for the user's region. The community the user chose (a country + city id,
 * see community/communities.ts) wins; the device locale region (e.g. 'US') is the fallback when
 * no community is chosen; unknown gets the generic wording.
 */
export function getCrisisResource(input: {
  communityId?: string | null;
  localeRegion?: string | null;
} = {}): CrisisResource {
  const community = findCommunity(input.communityId);
  const isUs = community
    ? community.country.id === 'us'
    : input.localeRegion?.toUpperCase() === 'US';
  return isUs ? US_CRISIS_RESOURCE : GENERIC_CRISIS_RESOURCE;
}

export const SUPPORT_RESOURCE_POLICY = {
  /** Total at or above which a result counts as elevated — the PHQ-4 "moderate" cutoff. */
  elevatedTotal: 6,
  /** Elevated checks needed inside the window, counting the one being scored. */
  elevatedChecksNeeded: 3,
  /** The fixed window those checks have to fall inside. */
  corroborationDays: 30,
  /** Quiet period after the card was last shown, before a moderate score may show it again. */
  cooldownDays: 14,
} as const;

export interface SupportResourceInput {
  severity: Phq4Severity;
  /**
   * How many *earlier* results inside `corroborationDays` reached `elevatedTotal`. The result
   * being scored is not counted here — the policy adds it — so this needs to be one short of
   * `elevatedChecksNeeded`.
   */
  priorElevated: number;
  /** Epoch ms the card was last shown to this account, or null if it never has been. */
  lastShownAt: number | null;
  now: number;
}

/**
 * A `lastShownAt` in the future (a clock that moved backwards) holds a moderate card back rather
 * than releasing it, which is the quieter way to be wrong. Severe ignores it either way.
 */
export function shouldShowSupportResource(input: SupportResourceInput): boolean {
  const { severity, priorElevated, lastShownAt, now } = input;
  if (severity === 'severe') return true;
  if (severity !== 'moderate') return false;
  if (priorElevated + 1 < SUPPORT_RESOURCE_POLICY.elevatedChecksNeeded) return false;
  if (lastShownAt == null) return true;
  return now - lastShownAt >= SUPPORT_RESOURCE_POLICY.cooldownDays * DAY_MS;
}
