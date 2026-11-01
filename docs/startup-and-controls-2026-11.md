# Avvio audio e controlli condivisi — 1 novembre 2026

Base verificata: `develop`, commit `700b455029e27672234fef14e6fa98186628a7e5` (beta 59.1).

## Avvio del primo brano

Tre attese evitabili individuate nel codice:

1. `AVPlayerItem` aspettava sia le tracce sia la durata precisa prima di diventare pronto. Ora il caricamento automatico richiede solo le tracce, sia per una sorgente nuova sia per quella preparata in anticipo. `AVURLAssetPreferPreciseDurationAndTimingKey` resta attivo; la coda dei seek, le tolleranze e la gestione della fine del brano rimangono invariate. Il player mostra la durata del catalogo finché riceve quella nativa.
2. `OfflineStore.source()` aspettava il controllo di ogni file, copertina e residuo nell'archivio locale. Ora può leggere l'indice e verificare immediatamente il solo brano richiesto. Download, rimozioni e pulizia continuano ad aspettare l'audit completo. Una lettura anticipata non salva un indice parziale e non restituisce un file inesistente.
3. Il bridge eseguiva in serie la verifica catalogo Qobuz e la risoluzione dello stream. Ora le due richieste partono insieme. Il risultato viene restituito soltanto se entrambe riescono; un rifiuto o un annullamento cancella e attende il worker. Nessuna modifica alle autorizzazioni o alla qualità audio.

Le misurazioni nelle impostazioni distinguono ora sessione audio, verifica locale, installazione sorgente e attesa nativa. Sono tempi locali senza titolo, URL o credenziali. I tempi cumulativi partono dal tocco; il caricamento nativo parte dall'installazione della sorgente. Le due richieste Qobuz possono sovrapporsi e i loro tempi non vanno sommati.

Questi cambiamenti rimuovono dipendenze dal percorso critico. Non sono misurazioni sulla VPN WireGuard dell'utente e non dimostrano un numero preciso di secondi risparmiati. La rete, il formato e Navidrome possono ancora incidere.

Riferimento Apple: le proprietà in [automaticallyLoadedAssetKeys](https://developer.apple.com/documentation/avfoundation/avplayeritem/automaticallyloadedassetkeys) vengono caricate prima che l'elemento diventi pronto.

## Barra compatta

- Non reinstallare il simbolo del pulsante compatto a ogni aggiornamento della riproduzione.
- Dissolvenza tra la barra UIKit e il simbolo compatto prima di nascondere il vecchio contenitore, evitando il cambio brusco finale.
- Generazione delle animazioni: una completion interrotta non può nascondere o azzerare l'animazione successiva.
- Rimozione dalla finestra: annullamento e rilascio dell'animatore, così la successiva apertura può riallineare il layout.

Il componente è lo stesso nella sessione online e offline. Le condizioni per accessibilità, Reduce Motion e schermi stretti restano operative.

## Grafica

`MusicControlButton` unifica i tre puntini e i filtri in Home, libreria, Cerca, pagine catalogo e player. Su iOS usa SF Symbols a 22 punti, con area di tocco minima 44 × 44. `musicChrome` centralizza dimensioni e risposta alla pressione/apertura/chiusura.

I menu condividono tipografia, separatori, selezione con segno di spunta, evidenziazione della riga premuta, superficie leggibile e scorrimento. La libreria usa lo stesso materiale con fallback e supporto a Reduce Transparency delle altre schermate.

Questa è un'unificazione dei controlli esistenti, non una riscrittura integrale in UIKit/SwiftUI. `FloatingMenu` resta un pannello React Native; non è un `UIMenu` di sistema. Non si afferma identità pixel per pixel con Apple Music.

## Verifiche

- 27 suite JavaScript/TypeScript superate; `tsc --noEmit` superato.
- 62 test bridge superati, inclusi sovrapposizione delle richieste e cancellazione del resolver.
- I nuovi test sul primo accesso locale e sul parallelismo Qobuz falliscono sulla base precedente e passano con la correzione.
- Patch native verificate dopo applicazione: mantenimento del timing preciso, rimozione della durata dai requisiti di readiness, idempotenza e migrazione delle vecchie patch.
- Export iOS Hermes riuscito: 1321 moduli. Non equivale a una compilazione Swift/Xcode.

Da verificare su iPhone: primo brano dopo apertura, FLAC/VBR con seek avanti/indietro, avanzamento automatico, scroll con inversioni rapide, modalità offline, tema chiaro/scuro e testo ingrandito. La fluidità UIKit e il miglioramento temporale reale richiedono una nuova build e una prova sul dispositivo.

Distribuzione: nuova build dell'app per le modifiche native e aggiornamento del bridge per Qobuz. Nessun tag, release o build avviato da questo intervento.
