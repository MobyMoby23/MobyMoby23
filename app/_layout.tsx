import {Stack} from 'expo-router';
import {StatusBar} from 'expo-status-bar';
import React from 'react';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {colors} from '../src/ui/theme.ts';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: {backgroundColor: colors.background},
        }}
      />
    </SafeAreaProvider>
  );
}
