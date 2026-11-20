import { useCallback, useEffect, useState } from 'react';
import { Button, Linking, StyleSheet, Switch, Text, View } from 'react-native';
import { locationSharing, sharingSettings } from '../lib/location/adapter';
import type { DeniedPermission } from '../lib/location/sharing';

const EXPLANATION =
  'Wenn eingeschaltet, sendet dieses Phone etwa alle 10 Sekunden seinen Standort an den Familien-Server – auch im Hintergrund. Alle angemeldeten Familienmitglieder sehen die letzte Position auf der Karte. Ein Verlauf wird nicht gespeichert. Das kostet spürbar Akku.';

const BATTERY_HINT =
  'Damit das Senden im Hintergrund nicht gestoppt wird: Samsung – Akku → ‚Nicht eingeschränkt‘ und die App nicht in den Standby versetzen lassen. Nothing Phone – Akkunutzung der App → ‚Nicht eingeschränkt‘.';

const DENIED_TEXTS: Record<DeniedPermission, string> = {
  foreground: 'Ohne die Standort-Berechtigung kann der Standort nicht geteilt werden.',
  notifications:
    'Ohne die Benachrichtigungs-Berechtigung kann Android den Hinweis „sem teilt deinen Standort“ nicht anzeigen.',
  background:
    'Bitte in den App-Einstellungen unter Standort „Immer zulassen“ wählen, sonst stoppt das Senden im Hintergrund.',
};

function formatTime(at: number): string {
  const date = new Date(at);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

const STATUS_REFRESH_MS = 5_000;

/** Android only: switch, explanation, permission hint and status of the location sharing. */
export function LocationSharingSection() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState<DeniedPermission | undefined>();
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setEnabled(await sharingSettings.isEnabled());
    setLastSentAt(await sharingSettings.getLastSentAt());
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), STATUS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  async function toggle(next: boolean) {
    setBusy(true);
    setDenied(undefined);
    try {
      if (next) {
        const result = await locationSharing.enable();
        if (!result.ok) setDenied(result.denied);
      } else {
        await locationSharing.disable();
      }
    } catch {
      // Starting failed (e.g. the system refused the service): the switch stays off.
    }
    await refresh();
    setBusy(false);
  }

  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Standort teilen</Text>
      <Switch
        testID="location-sharing"
        accessibilityLabel="Standort teilen"
        value={enabled}
        disabled={busy}
        onValueChange={(next) => void toggle(next)}
      />
      <Text style={styles.text}>{EXPLANATION}</Text>
      {denied !== undefined && (
        <Text testID="location-permission-hint" style={styles.text}>
          {DENIED_TEXTS[denied]}
        </Text>
      )}
      <Text testID="location-status">
        {lastSentAt === null
          ? 'Noch nichts gesendet'
          : `Zuletzt gesendet: ${formatTime(lastSentAt)}`}
      </Text>
      <Text style={styles.text}>{BATTERY_HINT}</Text>
      <Button title="App-Einstellungen öffnen" onPress={() => void Linking.openSettings()} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { alignItems: 'center', gap: 8, maxWidth: 480 },
  heading: { fontSize: 16, fontWeight: '600' },
  text: { textAlign: 'center' },
});
