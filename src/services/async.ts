/**
 * Deadlines for work that has no deadline of its own.
 *
 * The cases this exists for are native calls that answer through a callback the OS may simply never
 * make: a permission sheet that is dismissed in a way the bridge does not report, a modal that fails
 * to present, a Firestore write with no network. None of those reject — they stay pending — so a
 * screen that `await`s one sits on a spinner forever. Racing a timer against them turns "never" into
 * an error the caller can show and offer a retry for.
 *
 * No React Native or Expo imports, so Node self-checks can use it.
 */

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} did not finish within ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Rejects with a `TimeoutError` if `work` has not settled within `ms`.
 *
 * `work` is not cancelled — nothing here can cancel a native call in flight — so a late result is
 * simply ignored. That is the right trade for the permission sheets: one that arrives after the
 * deadline has already been handled as a refusal, and a refusal is a legitimate answer.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([work, deadline]).finally(() => {
    if (timer != null) clearTimeout(timer);
  });
}
