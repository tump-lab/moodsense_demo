/**
 * tsc picks up the generic `@firebase/auth` types instead of the react-native ones, so
 * getReactNativePersistence exists at runtime but is missing from the types. Declare it here.
 */
import type { Persistence, ReactNativeAsyncStorage } from '@firebase/auth';

declare module '@firebase/auth' {
  export function getReactNativePersistence(
    storage: ReactNativeAsyncStorage
  ): Persistence;
}
