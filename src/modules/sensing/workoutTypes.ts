/**
 * Maps iOS HealthKit workout names and Android Health Connect's numeric `ExerciseType` onto one shared vocabulary, so both platforms feed the same `health_workout` stream.
 * Pure logic kept out of collectors.ts so scripts/selfcheck-sensing.ts can test it without either native health API.
 */

export type NormalizedActivityType = 'walking' | 'running' | 'swimming' | 'other';

/**
 * Health Connect `ExerciseSessionRecord.exerciseType` constants, checked against react-native-health-connect's runtime `ExerciseType` export (lib/module/constants.js).
 * Only the activities this stream cares about are named here.
 */
const HC_EXERCISE_TYPE_RUNNING = 56;
const HC_EXERCISE_TYPE_RUNNING_TREADMILL = 57;
const HC_EXERCISE_TYPE_SWIMMING_OPEN_WATER = 73;
const HC_EXERCISE_TYPE_SWIMMING_POOL = 74;
const HC_EXERCISE_TYPE_WALKING = 79;

export function normalizeHealthConnectExerciseType(exerciseType: number): NormalizedActivityType {
  switch (exerciseType) {
    case HC_EXERCISE_TYPE_WALKING:
      return 'walking';
    case HC_EXERCISE_TYPE_RUNNING:
    case HC_EXERCISE_TYPE_RUNNING_TREADMILL:
      return 'running';
    case HC_EXERCISE_TYPE_SWIMMING_POOL:
    case HC_EXERCISE_TYPE_SWIMMING_OPEN_WATER:
      return 'swimming';
    default:
      return 'other';
  }
}

/**
 * A substring match rather than a full `HKWorkoutActivityType` table: that enum has 80+ values and only three matter here, so anything else falls back to `other`.
 */
export function normalizeHealthKitActivityName(
  activityName: string | null | undefined,
): NormalizedActivityType {
  if (!activityName) return 'other';
  const name = activityName.toLowerCase();
  if (name.includes('walk')) return 'walking';
  if (name.includes('run')) return 'running';
  if (name.includes('swim')) return 'swimming';
  return 'other';
}
