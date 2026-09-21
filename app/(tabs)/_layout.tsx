import {Ionicons} from '@expo/vector-icons';
import {Tabs} from 'expo-router';
import React from 'react';
import {StyleSheet} from 'react-native';

import {colors} from '../../src/ui/theme.ts';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: {backgroundColor: colors.background},
        headerTitleStyle: {color: colors.text},
        headerShadowVisible: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        sceneStyle: {backgroundColor: colors.background},
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Read',
          tabBarIcon: ({color, size}) => <Ionicons name="scan-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="write"
        options={{
          title: 'Write',
          tabBarIcon: ({color, size}) => (
            <Ionicons name="create-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="convert"
        options={{
          title: 'Convert',
          tabBarIcon: ({color, size}) => (
            <Ionicons name="swap-horizontal-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({color, size}) => <Ionicons name="time-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
