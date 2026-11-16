/**
 * Dev-only demo data so Insights looks alive on a fresh install. It runs only in __DEV__ with
 * Developer mode on and only into empty tables. Every row is recorded so turning Developer mode
 * off removes it, and sensing rows are written as already uploaded so they never reach the cloud.
 */
import { exec, queryAll, type Mood } from '../../services/db';
import { getActiveUid } from '../../services/firebase';

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function countRows(table: 'checkins' | 'sensing_events', uid: string): Promise<number> {
  const rows = await queryAll<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE uid = ?`,
    [uid]
  );
  return rows[0]?.n ?? 0;
}

type SeededTable = 'checkins' | 'sensing_events' | 'phq4_results';

let trackingReady: Promise<void> | null = null;
function ensureTrackingTable(): Promise<void> {
  if (!trackingReady) {
    trackingReady = exec(
      `CREATE TABLE IF NOT EXISTS demo_seed_rows (
         tbl TEXT NOT NULL,
         row_id INTEGER NOT NULL,
         PRIMARY KEY (tbl, row_id)
       )`
    ).then(() => undefined);
  }
  return trackingReady;
}

async function trackSeeded(table: SeededTable, result: { changes: number; lastInsertRowId: number }): Promise<void> {
  if (result.changes === 0) return;
  await exec('INSERT OR IGNORE INTO demo_seed_rows (tbl, row_id) VALUES (?, ?)', [table, result.lastInsertRowId]);
}

/** Deletes every row seedDemoData wrote. Returns whether there were any. */
export async function clearDemoData(): Promise<boolean> {
  try {
    await ensureTrackingTable();
    const rows = await queryAll<{ n: number }>('SELECT COUNT(*) AS n FROM demo_seed_rows');
    if ((rows[0]?.n ?? 0) === 0) return false;
    for (const table of ['checkins', 'sensing_events', 'phq4_results'] as const) {
      await exec(`DELETE FROM ${table} WHERE id IN (SELECT row_id FROM demo_seed_rows WHERE tbl = ?)`, [table]);
    }
    await exec('DELETE FROM demo_seed_rows');
    return true;
  } catch {
    return false;
  }
}

export async function seedDemoData(): Promise<void> {
  if (!__DEV__) return;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const uid = getActiveUid();

  try {
    await ensureTrackingTable();
    // Seven days of check-ins with one day skipped, so the trend chart shows its hollow "no data" dot.
    if ((await countRows('checkins', uid)) === 0) {
      // index 0 = 6 days ago ... index 6 = today; null = skipped day
      const moods: (Mood | null)[] = ['calm', 'good', 'low', null, 'good', 'stressed', 'calm'];
      for (let i = 0; i < moods.length; i++) {
        const mood = moods[i];
        if (mood == null) continue;
        const ts = now - (6 - i) * DAY_MS;
        await trackSeeded(
          'checkins',
          await exec(
            'INSERT OR IGNORE INTO checkins (date, mood, note, ts, uid) VALUES (?, ?, ?, ?, ?)',
            [localDateStr(new Date(ts)), mood, null, ts, uid]
          )
        );
      }
    }

    if ((await countRows('sensing_events', uid)) === 0) {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const morning = dayStart.getTime() + 8 * 60 * 60 * 1000;

      const insert = async (stream: string, ts: number, payload: object) =>
        trackSeeded(
          'sensing_events',
          await exec(
            'INSERT INTO sensing_events (stream, ts, payload, uploaded, uid) VALUES (?, ?, ?, 1, ?)',
            [stream, ts, JSON.stringify(payload), uid]
          )
        );

      await insert('steps', morning + 2 * 60 * 60 * 1000, { count: 3180 });
      await insert('steps', Math.min(now - 60_000, morning + 9 * 60 * 60 * 1000), {
        count: 6214,
      });

      for (let i = 0; i < 9; i++) {
        const ts = morning + i * 50 * 60 * 1000;
        if (ts >= now) break;
        await insert('screen', ts, { state: i % 2 === 0 ? 'active' : 'background' });
      }

      for (let i = 0; i < 4; i++) {
        await insert('accelerometer', morning + i * 90 * 60 * 1000, {
          x: 0.02 * i,
          y: -0.01,
          z: 0.98,
        });
      }

      // Shaped like the real activity payload (label plus the features behind it),
      // so anything reading the stream sees the same fields as in production.
      const activityWindows: Array<{ type: string; confidence: number; sdG: number; peakRateHz: number; steps: number }> = [
        { type: 'still', confidence: 0.9, sdG: 0.006, peakRateHz: 0, steps: 0 },
        { type: 'still', confidence: 0.85, sdG: 0.011, peakRateHz: 0, steps: 0 },
        { type: 'walking', confidence: 0.62, sdG: 0.214, peakRateHz: 1.83, steps: 11 },
        { type: 'walking', confidence: 0.58, sdG: 0.198, peakRateHz: 1.92, steps: 12 },
        { type: 'running', confidence: 0.71, sdG: 0.812, peakRateHz: 2.83, steps: 17 },
        { type: 'moving', confidence: 0.44, sdG: 0.132, peakRateHz: 0.5, steps: 1 },
        { type: 'still', confidence: 0.88, sdG: 0.009, peakRateHz: 0, steps: 0 },
      ];
      for (let i = 0; i < activityWindows.length; i++) {
        const ts = morning + i * 45 * 60 * 1000;
        if (ts >= now) break;
        const w = activityWindows[i];
        await insert('activity', ts, {
          type: w.type,
          confidence: w.confidence,
          source: 'steps',
          sampleCount: 118,
          windowMs: 6000,
          meanG: 1.02,
          sdG: w.sdG,
          peakRateHz: w.peakRateHz,
          steps: w.steps,
          stepsPerMin: Math.round((w.steps / 0.1) * 10) / 10,
        });
      }
    }
  } catch {
    // Seeding is cosmetic — never let it break the screen.
  }
}

/**
 * Screenshot mode (dev builds only): a believable month for one person, so Home, the trend card, the
 * forecast and the You tab look like a real participant's for paper figures and demos. A steady start,
 * a stressful week about a week ago, then a recovery, with sleep, steps and screen time moving with
 * it so the rhythm line and the forecast agree with the check-ins. Every row is tracked in
 * demo_seed_rows, so turning Screenshot or Developer mode off deletes exactly these rows. Sensing rows
 * are written as already uploaded and check-ins skip the cloud mirror, so nothing reaches Firestore.
 */
export async function seedScreenshotData(): Promise<void> {
  if (!__DEV__) return;
  const DAYS = 30;
  const uid = getActiveUid();
  try {
    await ensureTrackingTable();
    // One seed per account: a second toggle must not stack a second month on top.
    const seeded = await queryAll<{ n: number }>(
      `SELECT COUNT(*) AS n FROM checkins WHERE uid = ? AND source = 'demo'`,
      [uid]
    );
    if ((seeded[0]?.n ?? 0) > 0) return;

    // Deterministic, so every capture of the same day looks the same.
    let s = 7;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);

    // 1 = lightest day, 0 = heaviest. Index 0 is DAYS-1 days ago, the last index is today.
    const lightness = (i: number) => {
      const dip = Math.exp(-((i - 21) ** 2) / 10); // the stressful week, about a week ago
      const recover = i > 23 ? Math.min(1, (i - 23) / 5) * 0.12 : 0;
      return Math.max(0.05, Math.min(0.95, 0.66 - 0.5 * dip + recover + (rand() - 0.5) * 0.12));
    };
    const moodFor = (l: number): Mood =>
      l > 0.72 ? (rand() < 0.5 ? 'good' : 'calm') : l > 0.52 ? (rand() < 0.6 ? 'calm' : 'tired') : l > 0.35 ? (rand() < 0.6 ? 'stressed' : 'tired') : 'low';
    const reasonsFor = (m: Mood): string[] => {
      const pool: Record<Mood, string[][]> = {
        good: [['people'], ['me_time'], ['sleep', 'me_time'], ['people', 'body']],
        calm: [['me_time'], ['sleep'], ['body']],
        tired: [['sleep'], ['work_study', 'sleep']],
        stressed: [['work_study'], ['work_study', 'people']],
        low: [['work_study', 'sleep'], ['people']],
      };
      const options = pool[m];
      return options[Math.floor(rand() * options.length)]!;
    };

    const insertSensing = async (stream: string, ts: number, payload: object) =>
      trackSeeded(
        'sensing_events',
        await exec('INSERT INTO sensing_events (stream, ts, payload, uploaded, uid) VALUES (?, ?, ?, 1, ?)', [
          stream,
          ts,
          JSON.stringify(payload),
          uid,
        ])
      );

    const now = new Date();
    const HOUR = 60 * 60 * 1000;
    for (let i = 0; i < DAYS; i++) {
      const daysAgo = DAYS - 1 - i;
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
      const start = day.getTime();
      const l = lightness(i);
      const isToday = daysAgo === 0;

      // Passive signals that track the day: lighter days sleep longer, move more, scroll less.
      const sleepH = 5.6 + 2.3 * l + (rand() - 0.5) * 0.5;
      const wakeTs = start + (7 + rand()) * HOUR;
      await insertSensing('sleep_night', wakeTs, {
        date: localDateStr(new Date(start - 24 * HOUR)),
        wakeTs,
        totalAsleepMs: Math.round(sleepH * HOUR),
      });
      const dayFraction = isToday ? Math.min(1, (Date.now() - start) / (24 * HOUR)) : 1;
      const steps = Math.round((3500 + 7500 * l + rand() * 1500) * dayFraction);
      const lastTs = isToday ? Date.now() - 60_000 : start + 21 * HOUR;
      await insertSensing('health_steps_daily', lastTs, { date: localDateStr(day), steps });
      const screenH = (6.2 - 3.4 * l + (rand() - 0.5) * 0.6) * dayFraction;
      await insertSensing('app_usage', lastTs, { totalForegroundTimeMs: Math.round(screenH * HOUR) });

      // Check-ins: every day, two or three times, so the self-reported line is continuous and a
      // mixed day (a heavy morning, a lighter evening) lands between HIGH and LOW.
      const slots = isToday ? [8.5, 12.5] : rand() < 0.5 ? [9, 14, 20] : [9.5, 19.5];
      for (const h of slots) {
        const ts = Math.round(start + h * HOUR);
        if (ts > Date.now()) continue;
        // Some days are mixed (a heavy morning, a lighter evening), as real ones are.
        const mood = moodFor(Math.max(0, Math.min(1, l + (rand() - 0.5) * 0.35)));
        await trackSeeded(
          'checkins',
          await exec(
            `INSERT OR IGNORE INTO checkins (date, mood, note, ts, uid, source, reasons) VALUES (?, ?, NULL, ?, ?, 'demo', ?)`,
            [localDateStr(day), mood, ts, uid, JSON.stringify(reasonsFor(mood))]
          )
        );
      }
    }

    // Weekly PHQ-4: mild during the stressful week, back to minimal since.
    const phq4: [number, [number, number, number, number]][] = [
      [26, [1, 0, 0, 1]],
      [19, [1, 1, 0, 1]],
      [12, [1, 1, 1, 1]],
      [7, [2, 2, 1, 2]],
      [0, [1, 0, 0, 0]],
    ];
    for (const [daysAgo, [q1, q2, q3, q4]] of phq4) {
      const ts = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, daysAgo === 0 ? 8 : 20, 40).getTime();
      if (ts > Date.now()) continue;
      await trackSeeded(
        'phq4_results',
        await exec(
          `INSERT INTO phq4_results (ts, q1, q2, q3, q4, total, anxiety, depression, uid, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo')`,
          [ts, q1, q2, q3, q4, q1 + q2 + q3 + q4, q1 + q2, q3 + q4, uid]
        )
      );
    }
  } catch {
    // Seeding is cosmetic — never let it break the screen.
  }
}
