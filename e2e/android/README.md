# Android-Tests (Maestro)

Die Abläufe laufen noch in keiner CI; man startet sie von Hand gegen ein
Gerät oder einen Emulator.

## Voraussetzungen

* [Maestro](https://maestro.mobile.dev) ist installiert (`maestro --version`).
* Ein Gerät ist per USB verbunden (`adb devices`) oder ein Emulator läuft.
* Die sem-App (`cloud.matzen.sem`) ist installiert (aktuelle APK, siehe
  `tools/install-apk.ps1`).
* Der Server ist erreichbar und das DSM-Konto ohne Zwei-Faktor-Anmeldung
  nutzbar (der Ablauf deckt den Bestätigungscode nicht ab).

## Anmeldung

```sh
maestro test -e SEM_USER=<benutzername> -e SEM_PASSWORD=<passwort> e2e/android/anmeldung.yaml
```

Der Ablauf löscht den App-Zustand, prüft die Anmeldemaske samt Server-Status,
meldet an, prüft die Tabs und die Einstellungen und meldet wieder ab. Das
Passwort nur über die Umgebung übergeben, nie in die Datei schreiben.
