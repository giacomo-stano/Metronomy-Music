# Metronomy

Metronomy è un client musicale mobile costruito con **React Native + Expo**, pensato per offrire un'esperienza iOS moderna e fluida sopra una libreria musicale self-hosted.

L'app si collega a un bridge HTTP che gestisce autenticazione e accesso a **Navidrome**, e include riproduzione, libreria, ricerca, download offline e controlli audio nativi iOS.

> Stato del progetto: **early development / private alpha**.

---

## Funzionalità

- Home con album recenti e contenuti consigliati
- Libreria con album, artisti, playlist e brani
- Ricerca di artisti, album e tracce
- Player completo con:
  - play / pausa
  - precedente / successivo
  - shuffle e repeat
  - seek
  - coda di riproduzione riordinabile
  - lyrics
  - artwork e background dinamici
- Mini-player persistente
- Download locale e modalità offline
- Cache e prefetch delle copertine e dei brani degli album
- Preferiti e azioni contestuali sui brani
- Tema chiaro/scuro
- Animazioni e interazioni elastiche in stile iOS
- Background playback
- Controlli nativi iOS:
  - **AirPlay** tramite `AVRoutePickerView`
  - **volume di sistema** tramite `MPVolumeView`

---

## Stack

- **Expo SDK 57**
- **React Native 0.86**
- **React 19**
- **TypeScript**
- `expo-audio`
- `expo-symbols`
- `expo-glass-effect`
- `expo-blur`
- `expo-linear-gradient`
- `react-native-reanimated`
- `react-native-gesture-handler`
- Expo local modules per le integrazioni native iOS

---

## Architettura

```text
Metronomy
├── App.tsx
├── src/
│   ├── api.ts
│   ├── PlayerSheet.tsx
│   ├── LibraryScreen.tsx
│   ├── SearchScreen.tsx
│   ├── LoginScreen.tsx
│   ├── SettingsScreen.tsx
│   ├── OfflineDownloads.tsx
│   ├── offlineStore.ts
│   ├── albumPrefetch.ts
│   ├── theme.tsx
│   └── ...
├── modules/
│   └── metronomy-audio-controls/
│       ├── ios/
│       └── src/
├── assets/
├── app.json
├── eas.json
└── package.json
```

Il codice nativo specifico di Metronomy vive in:

```text
modules/metronomy-audio-controls/
```

La cartella `ios/` generata da Expo Prebuild non viene versionata e può essere rigenerata quando necessario.

---

## Requisiti

Per lo sviluppo JavaScript/TypeScript:

- Node.js
- npm
- Expo CLI tramite `npx`
- iPhone o simulatore compatibile

Per le feature native iOS:

- macOS
- Xcode
- iPhone fisico consigliato
- Expo Development Build

Le feature AirPlay e volume di sistema **non possono essere testate correttamente con Expo Go**.

---

## Installazione

Clona il repository:

```bash
git clone https://github.com/giacomo-stano/Metronomy-Music.git
cd Metronomy-Music
```

Installa le dipendenze:

```bash
npm install
```

Verifica il progetto:

```bash
npx expo-doctor
```

---

## Configurazione

Crea il file `.env` partendo dall'esempio:

```bash
cp .env.example .env
```

Su Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Configura:

```env
EXPO_PUBLIC_METRONOMY_BASE_URL=http://YOUR_SERVER_IP:8180
EXPO_PUBLIC_METRONOMY_API_KEY=YOUR_APP_API_KEY
```

`EXPO_PUBLIC_*` viene incluso nel bundle dell'app: non usare queste variabili per segreti che devono rimanere privati sul client.

Metronomy utilizza il bridge configurato come `BASE_URL` per autenticare l'utente e comunicare con il server musicale.

---

## Avvio con Expo

Per le parti compatibili con Expo Go:

```bash
npx expo start
```

Per la versione con codice nativo:

```bash
npx expo start --dev-client
```

---

## Development build iOS

Metronomy contiene codice Swift personalizzato per AirPlay e volume di sistema.

Installa il development client:

```bash
npx expo install expo-dev-client
```

Su un Mac genera il progetto iOS:

```bash
npx expo prebuild --platform ios
```

Installa i CocoaPods:

```bash
npx pod-install
```

Apri il workspace:

```bash
open ios/*.xcworkspace
```

In Xcode:

1. seleziona il target Metronomy;
2. apri **Signing & Capabilities**;
3. abilita **Automatically manage signing**;
4. seleziona il tuo Apple Account / Personal Team;
5. scegli un iPhone fisico;
6. compila ed esegui l'app.

Dopo la prima installazione puoi continuare lo sviluppo React Native con:

```bash
npx expo start --dev-client
```

Per maggiori dettagli sulle feature native consulta [`NATIVE_AUDIO_SETUP.md`](./NATIVE_AUDIO_SETUP.md).

---

## AirPlay e volume di sistema

Il modulo locale:

```text
modules/metronomy-audio-controls
```

espone due controlli nativi iOS.

### AirPlay

Utilizza:

```text
AVRoutePickerView
```

per mostrare il picker di sistema delle route audio compatibili.

### Volume

Utilizza:

```text
MPVolumeView
```

per controllare il volume audio di sistema e restare sincronizzato con i pulsanti fisici dell'iPhone.

Quando modifichi codice Swift nel modulo nativo devi ricompilare la build iOS.

Le modifiche esclusivamente `.ts` / `.tsx` non richiedono una nuova compilazione nativa.

---

## Server e autenticazione

Metronomy non comunica direttamente con Navidrome dal client.

Il flusso previsto è:

```text
Metronomy
    ↓ HTTP/HTTPS
Metronomy Bridge
    ↓
Navidrome
```

Il bridge espone endpoint per:

- login/logout
- home
- ricerca
- album
- copertine
- streaming
- lyrics
- operazioni di libreria

L'accesso viene effettuato usando le credenziali Navidrome dell'utente.

---

## Modalità offline

Metronomy può salvare localmente musica e metadati per permettere la riproduzione anche senza connessione al server.

La modalità offline comprende:

- brani scaricati
- copertine locali
- metadati della libreria
- lyrics disponibili localmente
- profili offline separati per account/server

---

## Comandi utili

```bash
# Avvia Expo
npm start

# Avvia development client
npx expo start --dev-client

# Controlla dipendenze e configurazione
npx expo-doctor

# Controllo TypeScript
npx tsc --noEmit

# Genera il progetto iOS
npx expo prebuild --platform ios
```

---

## Versioning

Il progetto usa Git per il versionamento.

Convenzione consigliata:

```text
main      → versione stabile
develop   → sviluppo corrente
```

Esempi di commit:

```text
feat: add native AirPlay support
feat: add offline album downloads
fix: improve player opening
perf: preload album artwork
ui: refine player animations
```

Le release seguono Semantic Versioning:

```text
v0.1.0
v0.2.0
v1.0.0
```

---

## Sicurezza

Non committare:

- `.env`
- password
- token di autenticazione
- certificati iOS
- provisioning profile
- chiavi private

Il `.gitignore` del progetto esclude già i principali file sensibili e generati.

---

## Roadmap

Tra le aree previste per lo sviluppo:

- miglioramento integrazione iOS
- gestione avanzata delle route audio
- controlli Lock Screen / Control Center
- miglioramenti alla modalità offline
- sincronizzazione e aggiornamenti dell'app
- ottimizzazioni di performance e caching
- ulteriore rifinitura dell'interfaccia e delle animazioni

---

## Note

Metronomy è attualmente un progetto in sviluppo attivo. API, struttura e comportamento possono cambiare rapidamente tra una versione e l'altra.
