<#
.SYNOPSIS
  Lädt die APK eines GitHub-Release und installiert sie per adb auf dem Handy.

.DESCRIPTION
  Holt die APK des neuesten (oder angegebenen) Release mit `gh release download`,
  prüft mit `adb devices`, dass genau ein Gerät bereit ist, und installiert mit
  `adb install -r` (Update ohne Datenverlust).

  Voraussetzungen: GitHub CLI (angemeldet), Android Platform Tools (adb),
  am Handy Entwickleroptionen und USB- bzw. kabelloses Debugging.

.PARAMETER Tag
  Release-Tag, z. B. v0.1.0. Ohne Angabe: neuestes Release.

.PARAMETER Pair
  Adresse für `adb pair` (IP:Port aus "Gerät mit Kopplungscode koppeln").
  Nur einmal pro PC nötig; fragt den Kopplungscode ab.

.PARAMETER Connect
  Adresse für `adb connect` (IP:Port aus "Kabelloses Debugging").

.PARAMETER Serial
  Seriennummer bzw. Adresse des Geräts, falls mehrere verbunden sind.

.PARAMETER Start
  Startet die App nach der Installation.

.EXAMPLE
  ./tools/install-apk.ps1
.EXAMPLE
  ./tools/install-apk.ps1 -Tag v0.1.0 -Connect 192.168.1.50:37123 -Start
.EXAMPLE
  ./tools/install-apk.ps1 -Pair 192.168.1.50:41234 -Connect 192.168.1.50:37123
#>
[CmdletBinding()]
param(
    [string] $Tag,
    [string] $Pair,
    [string] $Connect,
    [string] $Serial,
    [switch] $Start,
    [string] $Repo = 'Interface007/sem.app',
    [string] $Package = 'cloud.matzen.sem'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Native {
    param([string] $Command, [string[]] $Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command $($Arguments -join ' ') ist fehlgeschlagen (Exit-Code $LASTEXITCODE)."
    }
}

foreach ($tool in 'gh', 'adb') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool wurde nicht gefunden. Bitte installieren und in PATH aufnehmen."
    }
}

if ($Pair) {
    $code = Read-Host "Kopplungscode für $Pair"
    Invoke-Native adb @('pair', $Pair, $code)
}

if ($Connect) {
    $output = & adb connect $Connect
    Write-Host $output
    if ($LASTEXITCODE -ne 0 -or $output -notmatch 'connected to') {
        throw "adb connect $Connect ist fehlgeschlagen."
    }
    if (-not $Serial) { $Serial = $Connect }
}

# adb devices: "<serial>\t<state>"; only "device" is ready for install.
$devices = @(& adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '^\S+\s+\S+' } |
    ForEach-Object {
        $parts = $_ -split '\s+'
        [pscustomobject]@{ Serial = $parts[0]; State = $parts[1] }
    })

if ($Serial) {
    $device = $devices | Where-Object Serial -EQ $Serial
    if (-not $device) { throw "Gerät $Serial ist nicht verbunden." }
} else {
    $ready = @($devices | Where-Object State -EQ 'device')
    if ($ready.Count -eq 0) {
        $states = ($devices | ForEach-Object { "$($_.Serial) ($($_.State))" }) -join ', '
        throw "Kein bereites Gerät gefunden. $(if ($states) { "Verbunden: $states. " })" +
            'USB-Debugging aktiv und PC am Handy freigegeben?'
    }
    if ($ready.Count -gt 1) {
        throw "Mehrere Geräte verbunden ($($ready.Serial -join ', ')). Bitte -Serial angeben."
    }
    $device = $ready[0]
}
if ($device.State -ne 'device') {
    throw "Gerät $($device.Serial) ist nicht bereit (Status: $($device.State))."
}

$download = Join-Path ([IO.Path]::GetTempPath()) "sem-apk-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $download | Out-Null
try {
    $ghArgs = @('release', 'download')
    if ($Tag) { $ghArgs += $Tag }
    $ghArgs += @('--repo', $Repo, '--pattern', '*.apk', '--dir', $download)
    Invoke-Native gh $ghArgs

    $apk = @(Get-ChildItem -Path $download -Filter '*.apk')
    if ($apk.Count -ne 1) { throw "Erwartet genau eine APK im Release, gefunden: $($apk.Count)." }

    Write-Host "Installiere $($apk[0].Name) auf $($device.Serial) ..."
    Invoke-Native adb @('-s', $device.Serial, 'install', '-r', $apk[0].FullName)

    if ($Start) {
        Invoke-Native adb @('-s', $device.Serial, 'shell', 'monkey', '-p', $Package,
            '-c', 'android.intent.category.LAUNCHER', '1')
    }
    Write-Host 'Fertig.'
} finally {
    Remove-Item -Recurse -Force $download
}
