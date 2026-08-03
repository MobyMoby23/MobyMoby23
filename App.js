import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import {
  fetchAircraft,
  toFeet,
  toKnots,
  toFeetPerMinute,
} from './src/api/opensky';

const INITIAL_REGION = {
  latitude: 51.47, // London Heathrow — busy airspace, good first impression
  longitude: -0.4543,
  latitudeDelta: 2.2,
  longitudeDelta: 2.2,
};

const REFRESH_MS = 20000;
const MAX_MARKERS = 250; // keep the map responsive in dense airspace

export default function App() {
  const [aircraft, setAircraft] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');

  const regionRef = useRef(INITIAL_REGION);
  const mapRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const results = await fetchAircraft(regionRef.current);
      setAircraft(results);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not load aircraft.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + periodic refresh.
  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const onRegionChangeComplete = useCallback((region) => {
    regionRef.current = region;
  }, []);

  const onSearch = useCallback(() => {
    Keyboard.dismiss();
    const needle = search.trim().toUpperCase();
    if (!needle) return;
    const match = aircraft.find((a) => a.callsign.toUpperCase().includes(needle));
    if (!match) {
      setError(`No airborne flight matching “${search}” in view.`);
      return;
    }
    setError(null);
    setSelected(match);
    mapRef.current?.animateToRegion(
      {
        latitude: match.latitude,
        longitude: match.longitude,
        latitudeDelta: 1.0,
        longitudeDelta: 1.0,
      },
      600
    );
  }, [aircraft, search]);

  const statusText = error
    ? error
    : lastUpdated
    ? `${aircraft.length} aircraft · updated ${lastUpdated.toLocaleTimeString()}`
    : aircraft.length
    ? `${aircraft.length} aircraft`
    : 'Move the map to load live traffic';

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={INITIAL_REGION}
          onRegionChangeComplete={onRegionChangeComplete}
          onPress={() => setSelected(null)}
          showsCompass
          showsUserLocation={false}
        >
          {aircraft.slice(0, MAX_MARKERS).map((plane) => (
            <Marker
              key={plane.id}
              coordinate={{ latitude: plane.latitude, longitude: plane.longitude }}
              anchor={{ x: 0.5, y: 0.5 }}
              flat
              rotation={plane.heading || 0}
              onPress={(e) => {
                // Prevent the map's onPress from immediately clearing selection.
                e.stopPropagation?.();
                setSelected(plane);
              }}
              tracksViewChanges={Platform.OS === 'ios'}
            >
              <MaterialCommunityIcons
                name="airplane"
                size={selected?.id === plane.id ? 30 : 22}
                color={selected?.id === plane.id ? '#f97316' : '#2563eb'}
              />
            </Marker>
          ))}
        </MapView>

        <SafeAreaView style={styles.topOverlay} pointerEvents="box-none" edges={['top']}>
          <View style={styles.statusBar}>
            {loading ? (
              <ActivityIndicator size="small" color="#2563eb" />
            ) : (
              <MaterialCommunityIcons name="airplane" size={16} color="#2563eb" />
            )}
            <Text style={styles.statusText} numberOfLines={1}>
              {statusText}
            </Text>
          </View>
        </SafeAreaView>

        <TouchableOpacity
          style={styles.refreshButton}
          onPress={load}
          disabled={loading}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="refresh" size={24} color="#111827" />
        </TouchableOpacity>

        {selected && <AircraftDetail plane={selected} onClose={() => setSelected(null)} />}

        <SafeAreaView style={styles.bottomOverlay} pointerEvents="box-none" edges={['bottom']}>
          <View style={styles.searchBar}>
            <MaterialCommunityIcons name="magnify" size={20} color="#6b7280" />
            <TextInput
              style={styles.searchInput}
              placeholder="Find a flight (e.g. BAW123)"
              placeholderTextColor="#9ca3af"
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="search"
              value={search}
              onChangeText={setSearch}
              onSubmitEditing={onSearch}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <MaterialCommunityIcons name="close-circle" size={20} color="#9ca3af" />
              </TouchableOpacity>
            )}
          </View>
        </SafeAreaView>

        <StatusBar style="dark" />
      </View>
    </SafeAreaProvider>
  );
}

function AircraftDetail({ plane, onClose }) {
  const altitude = toFeet(plane.baroAltitude ?? plane.geoAltitude);
  const speed = toKnots(plane.velocity);
  const climb = toFeetPerMinute(plane.verticalRate);

  return (
    <View style={styles.detailCard}>
      <View style={styles.detailHeader}>
        <MaterialCommunityIcons name="airplane" size={22} color="#2563eb" />
        <Text style={styles.detailTitle}>{plane.displayName}</Text>
        <TouchableOpacity onPress={onClose} hitSlop={10}>
          <MaterialCommunityIcons name="close" size={22} color="#6b7280" />
        </TouchableOpacity>
      </View>

      <Text style={styles.detailSubtitle}>{plane.originCountry}</Text>

      <View style={styles.statsRow}>
        <Stat label="Altitude" value={altitude != null ? `${altitude.toLocaleString()} ft` : '—'} />
        <Stat label="Speed" value={speed != null ? `${speed} kt` : '—'} />
      </View>
      <View style={styles.statsRow}>
        <Stat
          label="Heading"
          value={plane.heading != null ? `${Math.round(plane.heading)}°` : '—'}
        />
        <Stat
          label="Vertical rate"
          value={climb != null ? `${climb > 0 ? '+' : ''}${climb} fpm` : '—'}
        />
      </View>

      <Text style={styles.detailFooter}>ICAO24: {String(plane.id).toUpperCase()}</Text>
    </View>
  );
}

function Stat({ label, value }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.94)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 8,
    maxWidth: '100%',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  statusText: { color: '#374151', fontSize: 13, flexShrink: 1 },
  refreshButton: {
    position: 'absolute',
    right: 16,
    bottom: 96,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.96)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 24,
    width: '100%',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#111827', padding: 0 },
  detailCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 72,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: '#111827' },
  detailSubtitle: { color: '#6b7280', marginTop: 2, marginBottom: 12 },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  stat: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  statLabel: { color: '#6b7280', fontSize: 12 },
  statValue: { color: '#111827', fontSize: 17, fontWeight: '600', marginTop: 2 },
  detailFooter: { color: '#9ca3af', fontSize: 12, marginTop: 2 },
});
