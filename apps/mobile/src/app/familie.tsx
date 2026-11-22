import type { FamilyLocation } from '@sem/contracts';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Button,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import FamilyMap from '../components/FamilyMap';
import {
  activeBoost,
  endBoost,
  fetchBoosts,
  fetchLocations,
  formatAccuracy,
  formatAge,
  mapStyleUrl,
  POLL_INTERVAL_MS,
  startBoost,
  type BoostMap,
} from '../lib/family';
import { formatClock } from '../lib/location/sharing';
import { session } from '../lib/sessionClient';

type State =
  | { status: 'loading' }
  | { status: 'error'; reason: string }
  | { status: 'ready'; locations: FamilyLocation[] };

const styleUrl = mapStyleUrl(process.env.EXPO_PUBLIC_MAP_STYLE_URL);

export default function FamilieScreen() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [now, setNow] = useState(() => Date.now());
  const [focus, setFocus] = useState<{ deviceId: string; nonce: number } | undefined>();
  const [boosts, setBoosts] = useState<BoostMap>(new Map());
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [busyDevice, setBusyDevice] = useState<string | undefined>();
  const reload = useRef<() => void>(() => undefined);

  const notify = (deviceId: string, text: string) =>
    setNotices((previous) => ({ ...previous, [deviceId]: text }));

  async function toggleBoost(deviceId: string, active: boolean) {
    setBusyDevice(deviceId);
    if (active) {
      if (await endBoost(session.authFetch, deviceId)) {
        setBoosts((previous) => {
          const next = new Map(previous);
          next.delete(deviceId);
          return next;
        });
        notify(deviceId, 'Live-Verfolgung beendet.');
      } else {
        notify(deviceId, 'Live-Verfolgung konnte nicht beendet werden.');
      }
    } else {
      const result = await startBoost(session.authFetch, deviceId);
      if (result.ok) {
        setBoosts((previous) => new Map(previous).set(deviceId, result.boostUntil));
        notify(
          deviceId,
          result.pushed
            ? 'Das Gerät wurde benachrichtigt.'
            : 'Das Gerät erfährt es mit seinem nächsten Bericht.',
        );
      } else {
        notify(deviceId, 'Live-Verfolgung konnte nicht gestartet werden.');
      }
    }
    setBusyDevice(undefined);
  }

  // Polls only while the screen has focus and the app is in the foreground.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      let timer: ReturnType<typeof setInterval> | undefined;

      const load = async () => {
        const [result, nextBoosts] = await Promise.all([
          fetchLocations(session.authFetch),
          fetchBoosts(session.authFetch),
        ]);
        if (!active) return;
        setNow(Date.now());
        setBoosts(nextBoosts);
        if (result.ok) {
          setState({ status: 'ready', locations: result.locations });
        } else {
          // A failed refresh keeps the last known positions.
          console.warn(`Loading locations failed: ${result.error}`);
          setState((previous) =>
            previous.status === 'ready' ? previous : { status: 'error', reason: result.error },
          );
        }
      };
      const start = () => {
        if (timer !== undefined) return;
        void load();
        timer = setInterval(() => void load(), POLL_INTERVAL_MS);
      };
      const stop = () => {
        clearInterval(timer);
        timer = undefined;
      };

      reload.current = () => {
        setState({ status: 'loading' });
        void load();
      };
      if (AppState.currentState === 'active') start();
      const subscription = AppState.addEventListener('change', (next) => {
        if (next === 'active') start();
        else stop();
      });
      return () => {
        active = false;
        stop();
        subscription.remove();
      };
    }, []),
  );

  if (state.status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator accessibilityLabel="Standorte werden geladen" />
      </View>
    );
  }
  if (state.status === 'error') {
    return (
      <View style={styles.center} testID="family-error">
        <Text>Standorte konnten nicht geladen werden.</Text>
        <Text style={styles.reason} testID="family-error-reason">
          {state.reason}
        </Text>
        <Button title="Erneut versuchen" onPress={() => reload.current()} />
      </View>
    );
  }

  const { locations } = state;
  return (
    <View style={styles.container}>
      <View style={styles.map} testID="family-map">
        <FamilyMap
          locations={locations}
          styleUrl={styleUrl}
          {...(focus ? { focus } : {})}
          // Debugging lets chrome://inspect show the map's console and network.
          dom={{ style: styles.dom, webviewDebuggingEnabled: true }}
        />
      </View>
      <FlatList
        style={styles.list}
        testID="family-list"
        data={locations}
        ListEmptyComponent={
          <Text style={styles.empty} testID="family-empty">
            Noch teilt niemand seinen Standort.
          </Text>
        }
        keyExtractor={(item) => item.deviceId}
        renderItem={({ item }) => {
          const accuracy = formatAccuracy(item.accuracy);
          const boostUntil = activeBoost(boosts, item.deviceId, now);
          const notice = notices[item.deviceId];
          return (
            <View style={styles.item}>
              <Pressable
                accessibilityRole="button"
                testID={`family-item-${item.deviceId}`}
                style={({ pressed }) => pressed && styles.pressed}
                onPress={() =>
                  setFocus((previous) => ({
                    deviceId: item.deviceId,
                    nonce: (previous?.nonce ?? 0) + 1,
                  }))
                }
              >
                <Text style={styles.user}>{item.user}</Text>
                <Text style={styles.detail}>
                  {item.deviceName} · {formatAge(item.recordedAt, now)}
                  {accuracy === undefined ? '' : ` · ${accuracy}`}
                </Text>
              </Pressable>
              <View style={styles.boost}>
                {boostUntil !== undefined && (
                  <Text style={styles.live} testID={`family-boost-${item.deviceId}`}>
                    Live bis {formatClock(boostUntil)}
                  </Text>
                )}
                <Button
                  testID={`family-boost-toggle-${item.deviceId}`}
                  title={boostUntil === undefined ? '10 min live verfolgen' : 'Beenden'}
                  disabled={busyDevice === item.deviceId}
                  onPress={() => void toggleBoost(item.deviceId, boostUntil !== undefined)}
                />
              </View>
              {notice !== undefined && <Text style={styles.detail}>{notice}</Text>}
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 },
  map: { flex: 3, minHeight: 200 },
  dom: { width: '100%', height: '100%' },
  list: { flex: 2 },
  reason: { color: '#555', fontSize: 12, textAlign: 'center' },
  empty: { padding: 16, textAlign: 'center' },
  item: { paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  pressed: { opacity: 0.7 },
  user: { fontSize: 16, fontWeight: '600' },
  detail: { color: '#555' },
  boost: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  live: { color: '#b00020', fontWeight: '600' },
});
