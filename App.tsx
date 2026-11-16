import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNav } from './src/navigation';
import SensingProvider from './src/modules/sensing/SensingProvider';
import ErrorBoundary from './src/components/ErrorBoundary';
import { colors } from './src/theme';

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.ink,
    primary: colors.primary,
    border: colors.line,
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navTheme}>
        <ErrorBoundary>
          <SensingProvider />
          <RootNav />
          {/* Lives at the root rather than on a screen: the Screen Time pickers are driven from
              screenTimeSetup.ts, which runs both at the end of consent onboarding and on sign-in,
              and the explainer has to be able to appear over either. */}
        </ErrorBoundary>
        <StatusBar style="dark" />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
