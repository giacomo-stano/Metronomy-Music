# Metronomy Dev: debug React Native con Metro, senza ricompilare IPA

## Stato e isolamento
Questo esperimento deriva da `experiment/flac-timeline-diagnostics` (PR #3) e ne mantiene gli strumenti per misurare durata e posizione native del FLAC. Non effettua modifiche a `develop`, alle app stable/beta né al bridge.

La nuova app usa:
- Nome: **Metronomy Dev**
- Bundle ID iOS: **com.anonymous.metronomy.dev** (distinto dalle app stable/beta)
- Configurazione Xcode **Debug**, `expo-dev-client` per Expo SDK 57, timing nativo **standard** (`METRONOMY_PRECISE_AUDIO_TIMING=false`).
- GitHub Actions: `.github/workflows/build-ios-dev.yml`; output **Metronomy-Dev-iOS-unsigned** (nessuna pubblicazione AltStore).
- Nessuna modifica permanente al lockfile della release: la dipendenza Dev Client è installata **solo nel job iOS**, dopo `npm ci`.

## Prima build iOS
Aprire la PR di questo branch contro `develop` e controllare l'esecuzione del workflow **Build Metronomy Dev iOS IPA** (trigger pull_request su questa PR). La nuova workflow_dispatch può non apparire nel menu Actions finché il file non esiste anche nel default branch; usare il job del pull request in quel caso. Se il job non parte, verificare le impostazioni Actions e i log, non dare per scontato che sia stato compilato.

Scaricare l'artifact `Metronomy-Dev-iOS-unsigned` e **firmare** la IPA con il metodo normalmente usato per AltStore/SideStore. Una IPA unsigned NON è installabile direttamente. Verificare il bundle ID dopo la firma. App stable e beta dovrebbero rimanere separate: questa build usa un identificativo distinto, ma bisogna rispettare il limite delle app firmate con account gratuiti.

## Preparare Metro su Windows
Clonare/aggiornare il branch di debug sul PC Windows, installare dipendenze con `npm ci`. Per avviare Metro:

```powershell
git switch experiment/dev-client-metro
npm ci
npx expo start --dev-client --host lan
```

Il pacchetto `expo-dev-client` deve essere **presente anche nell'ambiente locale** da cui si avvia Metro, così da mantenere allineato il runtime:
```powershell
npm install --no-save --package-lock=false "expo-dev-client@~57.0.19"
```
Ripetere l'installazione dopo `npm ci`, che elimina dipendenze non presenti nel lockfile.

PC e iPhone devono potersi raggiungere sulla stessa LAN; aprire eventuale firewall Windows per porta TCP **8081** in entrata solo sulla rete privata. Sul telefono, aprire Metronomy Dev e inserire l'indirizzo Metro nella schermata del launcher, per esempio `http://192.168.1.X:8081` con **l'IP effettivo del PC**, non quello del server Navidrome. La rete Wi-Fi è il percorso iniziale più semplice. Il traffico audio verso Metronomy Bridge può continuare a passare da WireGuard; Metro deve essere raggiungibile separatamente.

Se Metro propone un URL errato o il telefono non lo raggiunge, verificare firewall, subnet e VPN. La modalità `--host tunnel` può funzionare ma richiede configurazione di tunneling e ha tradeoff di latenza; non presumerne la disponibilità.

## Test seek
Riprodurre il FLAC 24/192, fare seek verso il 95–99%, osservare la fine reale dell'audio. Aprire **Impostazioni → Su questo iPhone → Diagnostica FLAC e seek** e premere `Aggiorna diagnostica`. Con Fast Refresh, modifiche TypeScript/JS saranno inviate via Metro senza rigenerare l'IPA. Le modifiche native Swift, i plugin `expo-audio`, i moduli iOS e i cambiamenti di Info.plist richiedono una nuova compilazione.

Le build Debug possono avere prestazioni diverse dalle Release, quindi verificare successivamente l'avvio audio sulla build Release.

## Isolamento e rischio
- Nessuna nuova credenziale nei log, nessun token in diagnostica.
- **Non installare la IPA unsigned come se fosse già firmata.**
- Il nome/bundle ID dev sono configurati esclusivamente con `METRONOMY_CHANNEL=dev`. Il workflow release esistente continua ad usare stable/beta.
- Non effettuare merge diretto della PR fino a quando la PR #1 e la PR #3 non siano state revisionate; questa PR deriva dal loro branch e contiene anche i commit precedenti.
