/**
 * The Screen Time grant and the three pickers, as one guided run instead of three things to find
 * in Settings.
 *
 * Why this exists: on iOS the app cannot choose the apps itself. Apple returns opaque
 * `ApplicationToken` / `ActivityCategoryToken` values and publishes no way to construct one, so
 * there is no call that pre-selects "Social", YouTube or Netflix, and no "all apps" token either —
 * `FamilyActivityPicker` is the only path, by the same design that stops the app learning which
 * apps someone picked (docs/SENSING.md, "The opaque-token problem"). What *was* costing us the
 * stream was leaving all three pickers behind two taps in Settings, where a participant who never
 * went looking produced no rows at all. So the pickers now come to them, once, in order, each
 * carrying a line telling them the single row to tap — see `pickerHeader` in
 * ScreenTimeController.swift.
 *
 * That header line turned out not to be enough on its own: inside a system sheet it is one grey
 * line, and testers read the picker as a settings screen they had wandered into. `./screenTimeIntro`
 * now states what the two groups are for, in the app's own voice, before any of this is presented.
 */
import { Platform } from 'react-native';
import * as iosUsage from '../../../modules/moodsense-ios-usage';
import { logEvent } from '../../services/logging';

/** One picker for the whole phone. Social and audio/video are no longer asked for separately. */
const SETUP_ORDER: readonly iosUsage.UsageCategory[] = ['total'];

/**
 * Breathing room between modals. The authorization alert and each picker are separate
 * presentations, and UIKit will not present over one that is still animating away — without a gap
 * the second and third pickers are dropped on the floor, and whatever the user was last touching
 * (a keyboard, a scroll) is still live underneath the first.
 */
const MODAL_GAP_MS = 450;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ScreenTimeSetupResult {
  /** The authorization status after asking; nothing is presented unless this is `approved`. */
  status: iosUsage.ScreenTimeAuthorizationStatus;
  /** Categories the participant saved a selection for. */
  completed: iosUsage.UsageCategory[];
  /** Categories they cancelled out of. They can still set those from Settings later. */
  skipped: iosUsage.UsageCategory[];
}

const UNAVAILABLE: ScreenTimeSetupResult = {
  status: 'unavailable',
  completed: [],
  skipped: [],
};

/**
 * Asks for Screen Time and then walks the pickers. Safe to call on any platform and on a build
 * without the entitlement: both report `unavailable` and present nothing.
 *
 * Cancelling one picker does not stop the run — someone who skips "social" may still want the
 * other two, and the alternative is making one Cancel cost them the whole setup.
 */
export async function runScreenTimeSetup(
  only?: readonly iosUsage.UsageCategory[]
): Promise<ScreenTimeSetupResult> {
  if (Platform.OS !== 'ios' || !iosUsage.isScreenTimeConfigured) return UNAVAILABLE;

  let status: iosUsage.ScreenTimeAuthorizationStatus;
  try {
    status = await iosUsage.screenTimeAuthorizationStatus();
    if (status === 'notDetermined') status = await iosUsage.requestScreenTimeAuthorization();
  } catch {
    return UNAVAILABLE;
  }
  if (status !== 'approved') {
    void logEvent('ios_screen_time_setup', { status, completed: 0, skipped: 0 });
    return { status, completed: [], skipped: [] };
  }

  const completed: iosUsage.UsageCategory[] = [];
  const skipped: iosUsage.UsageCategory[] = [];
  const wanted = only ?? SETUP_ORDER;
  for (const category of SETUP_ORDER) {
    if (!wanted.includes(category)) continue;
    // Also covers the step from the authorization alert into the first picker.
    await wait(MODAL_GAP_MS);
    try {
      const result = await iosUsage.presentActivityPicker(category);
      (result.cancelled ? skipped : completed).push(category);
    } catch {
      skipped.push(category);
    }
  }

  // Logged as one line per run so a cohort's setup completion is readable without reconstructing it
  // from three separate picker events.
  void logEvent('ios_screen_time_setup', {
    status,
    completed: completed.length,
    skipped: skipped.length,
    skippedCategories: skipped.join(','),
  });

  return { status, completed, skipped };
}

/**
 * The setup run, narrowed to the buckets that have nothing in them yet.
 *
 * Called on sign-in, where the pickers are modal, so it must not shove sheets in front of someone
 * who has already answered them. It used to stand down as soon as *any* bucket had a selection,
 * and that was wrong: the three buckets are filled by three separate pickers, so one of them being
 * set says nothing about the other two. What it produced in practice was an install where `social`
 * held a selection and `total` never did — and `total` is the one the trend card reads for screen
 * time, so the card showed "not recorded" for days while monitoring reported itself healthy on 17
 * social events. Asking only for the empty buckets keeps the sheets rare without letting a partial
 * setup settle in as permanent.
 *
 * A participant who deliberately clears one bucket will be asked for it again on the next sign-in.
 * That is the right trade against a stream that silently never starts.
 */
export async function runScreenTimeSetupIfUnset(): Promise<ScreenTimeSetupResult | null> {
  if (Platform.OS !== 'ios' || !iosUsage.isScreenTimeConfigured) return null;
  let missing: iosUsage.UsageCategory[] = [...SETUP_ORDER];
  try {
    const status = await iosUsage.screenTimeAuthorizationStatus();
    // Refused earlier: iOS will not present the sheet again, and the pickers need the grant first.
    if (status === 'denied' || status === 'unavailable') return null;
    if (status === 'approved') {
      const summary = await iosUsage.selectionSummary();
      missing = SETUP_ORDER.filter((category) => {
        const count = summary[category];
        return (count?.applications ?? 0) === 0 && (count?.categories ?? 0) === 0;
      });
      if (missing.length === 0) return null;
    }
  } catch {
    return null;
  }

  // Straight to the authorization alert and Apple's own picker, with no explainer in front.
  return runScreenTimeSetup(missing);
}
