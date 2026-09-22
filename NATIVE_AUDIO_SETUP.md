# Metronomy — AirPlay + volume di sistema iOS

Questa versione è basata sul progetto Expo SDK 57 caricato il 22/09/2026.

## Cosa è stato aggiunto

- `AVRoutePickerView` nativo per il pulsante AirPlay nel player.
- `MPVolumeView` nativo per lo slider del volume di sistema iOS.
- Lo slider segue i tasti volume fisici dell'iPhone e modifica il volume audio di sistema.
- In Expo Go rimane il fallback precedente, così il progetto non va in crash se il modulo nativo non è disponibile.
- `setAudioModeAsync` è configurato esplicitamente per playback (`allowsRecording: false`).

Il modulo nativo è in:

```text
modules/metronomy-audio-controls/
```

## Nota sulla cartella ios.zip caricata

La cartella `ios.zip` inviata contiene sorgenti di una app SwiftUI separata (`MetronomyApp.swift`, `PlayerManager.swift`, `HomeView.swift`, ecc.), ma non è la cartella iOS generata da Expo: non contiene `Podfile`, `.xcodeproj` o `.xcworkspace`.

Per questo non è stata fusa direttamente nel progetto Expo. Le feature native sono state aggiunte nel modo corretto per questo progetto: un **local Expo Module**, che EAS/Expo Autolinking include nella vera build iOS.

## Importante: Expo Go non può eseguire queste feature native

Per AirPlay e volume di sistema serve una development build di Metronomy.

Da PowerShell, nella root del progetto:

```powershell
npx expo install expo-dev-client
```

Ho già aggiunto il profilo `development` a `eas.json`.

Poi crea la build iOS:

```powershell
eas build --platform ios --profile development
```

Installa la build risultante sull'iPhone e avvia Metro con:

```powershell
npx expo start --dev-client
```

## Dopo modifiche native

Se modifichi file Swift dentro `modules/metronomy-audio-controls/ios`, devi creare una nuova build iOS.

Se modifichi solo `.ts` / `.tsx`, non serve ricompilare il codice nativo: durante lo sviluppo basta Metro; quando configureremo EAS Update, le modifiche compatibili potranno essere distribuite OTA.

## Test consigliato su iPhone reale

1. Avvia un brano.
2. Apri il player completo.
3. Muovi lo slider volume: deve cambiare il volume reale dell'iPhone.
4. Premi i tasti fisici volume: lo slider deve seguirli.
5. Tocca AirPlay: deve aprirsi il picker iOS delle route audio.
6. Seleziona una route AirPlay e verifica che la riproduzione continui.

`MPVolumeView`/routing non sono testabili correttamente nel Simulator: usa l'iPhone reale.

## SDK 57

Il progetto usa Expo SDK 57. Nell'`AudioPlayerOptions` installato in questa versione non è presente `allowsExternalPlayback` (è comparso in versioni successive di expo-audio), quindi questa integrazione non lo usa. AirPlay viene selezionato con `AVRoutePickerView` e instradato dalla sessione audio iOS.
