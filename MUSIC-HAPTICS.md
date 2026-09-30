# Music Haptics — Apple only

Base: `develop`, `a6ee230` (ripristino 0.2.2). Nessun motore Core Haptics,
analisi PCM, beat detector, impulso sintetico o dipendenza aggiuntiva.

## Funzionamento

- `MusicHapticsSupported` viene incluso nell'Info.plist tramite app.json.
- Dopo la selezione della sorgente audio e dei metadati lock-screen, l'app
  recupera l'ISRC dal brano o da `GET /songs/{id}` (anche catalogo offline).
  Accetta stringhe e liste nei campi `isrc`, `info.isrc`, `song.isrc`.
- Il modulo nativo usa solo `MAMusicHapticsManager` e
  `MPNowPlayingInfoPropertyInternationalStandardRecordingCode`.
- Letture/scritture dei metadati avvengono sulla main queue come expo-audio,
  preservando copertina, durata, tempo trascorso e velocità. L'ISRC viene
  applicato solo se titolo/artista corrispondono al brano selezionato.
- Gli eventi Apple confermano lo stato reale. La disponibilità della traccia
  non significa che la riproduzione aptica sia partita.
- In primo piano una verifica ogni due secondi rilegge/ripristina l'ISRC se
  necessario; nessun aggiornamento React quando lo stato non cambia.
- Le risposte vecchie sono ignorate, il logout pulisce gli observer; errori e
  timeout hanno un pulsante Riprova. Il controllo non cambia le impostazioni
  globali di accessibilità e non genera vibrazioni alternative.

## Compilazione e prova

Serve una **nuova build nativa iOS**: un reload di Expo Go non contiene questo
modulo. Usare il workflow iOS esistente sul branch che contiene le modifiche;
installare l'IPA mediante il consueto sistema di firma. Non è stata modificata
la versione dell'app né pubblicata una release/aggiornamento AltStore.

1. Su un iPhone compatibile con iOS 18+, attivare Impostazioni → Accessibilità
   → Feedback aptici musicali; verificare che Metronomy compaia tra le app.
2. Provare un brano che funziona con Music Haptics in Apple Music, possibilmente
   la stessa registrazione/ISRC, con Internet e il bridge raggiungibili.
3. Toccare l'indicatore nel player: ISRC brano e iOS devono coincidere;
   disponibilità e riproduzione confermata sono mostrate separatamente.
4. Provare pausa/ripresa, seek, brano successivo, cambi rapidi, ritorno dalle
   impostazioni, logout/login, schermo bloccato e riproduzione in background.
5. Provare ISRC assente, brano non disponibile, server offline, Music Haptics
   disattivato; nessuno di questi casi deve avviare un fallback artificiale.
6. Per un download locale verificare che il dettaglio ISRC sia stato salvato
   con i metadati offline. Avere il file sul telefono non garantisce che il
   servizio aptico Apple sia disponibile senza Internet.

Il backend non è presente in questa base del repository. Se il dettaglio
brano non espone l'ISRC, l'app mostra il dato mancante: non cerca per titolo
una registrazione potenzialmente diversa. Verificare il backend effettivamente
distribuito prima di concludere che il file non abbia il tag ISRC.

## Verifiche locali

`npx tsc --noEmit`

`node tests/apple-music-haptics.cjs`

I test JavaScript usano un modulo nativo simulato e non provano la vibrazione
fisica. Compilazione Swift e comportamento Apple richiedono macOS/iPhone.

Fonti: https://developer.apple.com/documentation/mediaaccessibility/music-haptics
e https://docs.expo.dev/versions/v57.0.0/.
