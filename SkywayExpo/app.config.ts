import type { ExpoConfig } from 'expo/config';

/**
 * Expo app config.
 *
 * Two things here are load-bearing for CarPlay:
 *
 *  - the `@bradford-tech/expo-carplay` plugin, which writes the CarPlay scene
 *    manifest and entitlement into the iOS project at prebuild time and
 *    bridges the phone scene delegate. Without it the app builds but the car
 *    screen never connects.
 *  - `UIBackgroundModes: ["location"]`, without which iOS suspends location
 *    updates when the phone locks and the car's follow camera freezes. The
 *    CarPlay module only enables background updates when this is present.
 */
const config: ExpoConfig = {
  name: 'Skyway',
  slug: 'skyway',
  version: '1.0.0',
  orientation: 'default',
  scheme: 'skyway',
  userInterfaceStyle: 'automatic',

  ios: {
    bundleIdentifier: 'com.example.skyway',
    supportsTablet: false,
    infoPlist: {
      UIBackgroundModes: ['location', 'audio'],
      NSLocationWhenInUseUsageDescription:
        'Skyway needs your location to show where you are, route you, and warn you about hazards and weather ahead.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'Skyway keeps following your route while the screen is off or CarPlay is driving the display, so guidance and warnings carry on.',
      ITSAppUsesNonExemptEncryption: false,
    },
    entitlements: {
      // Granted by Apple on request, not self-service. Until it is on the App
      // ID the app builds and the phone half works, but the car screen stays
      // blank: https://developer.apple.com/contact/carplay/
      'com.apple.developer.carplay-maps': true,
    },
  },

  android: {
    package: 'com.example.skyway',
    permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'FOREGROUND_SERVICE'],
  },

  plugins: [
    '@bradford-tech/expo-carplay',
    'expo-location',
    [
      'expo-build-properties',
      {
        ios: {
          // Expo SDK 57's own floor; comfortably above the CarPlay scene APIs
          // and the CarPlay module's iOS 15 minimum.
          deploymentTarget: '16.4',
        },
      },
    ],
  ],

  extra: {
    eas: {
      // Replace with your own project id after `eas init`.
      projectId: '00000000-0000-0000-0000-000000000000',
    },
  },
};

export default config;
