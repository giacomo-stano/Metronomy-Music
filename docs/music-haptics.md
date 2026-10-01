# Apple Music Haptics: integrazione e verifica

## Caso osservato

Su iPhone 17 Pro / iOS 27, “Creep in a T-Shirt” (`USAT21300493`):
ISRC applicazione e iOS uguali, funzione attiva, traccia Apple disponibile,
audio in riproduzione, ma nessuna conferma aptica. Questo esclude un ISRC
mancante per **quel brano**, non dimostra un errore del motore aptico di iOS.
La vecchia diagnostica non distingueva un callback negativo da nessun callback
e non controllava durata/posizione del Now Playing.

## Problemi verificati e correzioni

- Il mapping delle liste del bridge scartava gli ISRC. OpenSubsonic ammette un
  array, mentre il client provava solo il primo codice. Ora conserviamo tutti
  gli identificatori reali, anche nei download offline, e proviamo gli altri
  candidati prima di dichiarare la traccia non disponibile. Se una richiesta
  fallisce, il risultato è sconosciuto, non “non disponibile”.
- Il modulo aptico scriveva l'ISRC quando si interrogava la diagnostica e
  ricreava l'observer a distanza di 350/900 ms. Un observer non è un comando
  di avvio; queste operazioni sono state rimosse.
- Ora expo-audio pubblica identità, ISRC e timeline nello stesso dizionario,
  anche dopo seek, aggiornamenti della copertina e controlli dalla schermata
  bloccata. Il modulo aptico legge soltanto. Al cambio brano l'ISRC precedente
  viene rimosso se il nuovo brano non ne ha uno.
- Se AVPlayer non conosce ancora la durata dello stream, usiamo la durata reale
  del catalogo Navidrome. Una durata valida di AVPlayer ha sempre precedenza.
  I brani della libreria sono esplicitamente non-live.
- La diagnostica distingue disponibilità, risposta Apple e conferma di
  riproduzione. Mostra inoltre durata, posizione, velocità, uscita audio e
  configurazione della build; può essere condivisa senza credenziali.

Non è stato dimostrato che la durata fosse errata nel caso dello screenshot:
la modifica alla timeline protegge questo caso e lo rende verificabile.
expo-audio 57.0.5 già conserva le chiavi estranee durante gli aggiornamenti:
non attribuiamo il problema a una cancellazione periodica dell'ISRC.

## Build e distribuzione

Queste modifiche richiedono una **nuova build nativa iOS**, non soltanto Metro,
Expo Go o un aggiornamento JavaScript. Da GitHub Actions, eseguire il workflow
“Build Metronomy iOS IPA” sul branch `develop`, poi installare/firmare l'IPA
con la procedura abituale. Non sono necessari tag o release.

`plugins/withMusicHapticsMetadata.js` applica automaticamente l'estensione a
expo-audio durante `expo prebuild --platform ios`. La trasformazione è
idempotente e verificata per **expo-audio 57.0.5**: usare `npm ci`. Un cambio
di versione richiede la revisione del plugin; una struttura sorgente inattesa
blocca la generazione invece di produrre una build incompleta.

Aggiornare anche il codice del bridge e ricostruire il servizio `bridge` dalla
cartella `server/`, mantenendo i propri file Compose, override e configurazioni.
La nuova app resta compatibile con il vecchio dettaglio `/songs/{id}`, ma solo
il bridge aggiornato conserva tutti gli ISRC nelle liste. I download offline
precedenti possono avere metadati incompleti: non vengono cancellati né
riscaricati automaticamente.

## Prova su dispositivo (ancora necessaria)

1. Collegare l'iPhone a Internet e abilitare Music Haptics in Accessibilità.
2. Aprire la nuova build e riprodurre il brano del caso osservato.
3. Nella diagnostica verificare `Integrazione nativa: 3`, `Metadati player: sì`,
   ISRC `USAT21300493`, durata positiva, posizione crescente, velocità `1`,
   `Live: no` e timeline valida.
4. Provare pausa/ripresa, seek, due cambi rapidi di brano e schermo bloccato.
   Verificare sia la conferma di iOS sia la vibrazione fisica.
5. Se non vibra, condividere la diagnostica durante la riproduzione: un callback
   assente è diverso da una risposta negativa. Confrontare anche lo stato
   Music Haptics nella scheda audio del Centro di Controllo e il medesimo brano
   in Apple Music. Non sostituire l'ISRC con quello di un'altra registrazione.

I test locali coprono orchestrazione, race, timeout, metadati, compatibilità
offline e trasformazione del codice nativo. Windows non consente di compilare
e provare il framework iOS: compilazione Xcode e prova aptica fisica sono
verifiche distinte. Non dichiariamo risolto il caso hardware prima della prova.

## Fonti e limiti

- [Apple: Music Haptics](https://developer.apple.com/documentation/mediaaccessibility/music-haptics):
  configurazione Info.plist, stato globale e ISRC nel Now Playing. Le API
  pubbliche verificano disponibilità e osservano lo stato; non offrono un
  comando per forzare l'avvio di una traccia aptica.
- [Apple: Music Haptics su iPhone](https://support.apple.com/guide/iphone/iphff2ceeb16/ios):
  richiede un iPhone supportato, brani compatibili e connessione Internet.
  L'audio scaricato può essere offline; non promettiamo tracce aptiche offline.
- [OpenSubsonic: Child](https://opensubsonic.netlify.app/docs/responses/child/):
  il campo `isrc` può contenere più codici.

Nessun Core Haptics, analisi PCM o vibrazione sintetica è stato aggiunto.

## Seconda prova su iPhone: nessuna notifica dopo 41,8 secondi

L'integrazione 2, installata sul dispositivo, mostra durata 234,5 s, posizione
41,8 s, velocità 1, ISRC corretto, traccia disponibile e zero callback anche
dopo disattivazione/riattivazione da Centro di Controllo. Le correzioni precedenti
non hanno quindi risolto il feedback fisico in quel caso. Non abbiamo evidenza
per attribuire il problema a Navidrome, a un ISRC assente o a una durata nulla.

Nel codice restavano due aspetti verificabili, corretti nell'integrazione 3:

- La sottoscrizione aptica veniva creata dopo l'avvio audio e rimossa ad ogni
  selezione/riprova. Ora `prepareObserver` viene atteso **prima** di replace,
  pubblicazione dei metadati e play. Un unico observer resta vivo fino alla
  distruzione del modulo; un callback arrivato prima dell'effetto React viene
  conservato, ma conta come conferma solo per ISRC e proprietario corrispondenti.
- expo-audio pubblicava tutto il Now Playing ad ogni tick UI (250 ms). Ora un
  filtro nativo conserva i tick dell'interfaccia ma sopprime le pubblicazioni
  identiche in avanzamento normale. Cambi di metadati, item, velocità e salti
  temporali di almeno 250 ms passano; questo preserva pausa/ripresa, buffering,
  seek e loop. La posizione iOS avanza dalla posizione base e dalla velocità.
  Un seek inferiore a 250 ms può essere assorbito nella tolleranza della timeline.

Apple documenta che [il tempo trascorso viene calcolato automaticamente](https://developer.apple.com/documentation/mediaplayer/mpnowplayinginfopropertyelapsedplaybacktime)
e non richiede aggiornamenti frequenti. **Non è però dimostrato che le scritture
frequenti fossero la causa delle vibrazioni assenti.** Questa è una correzione
di integrazione da verificare sul dispositivo, non una conferma di soluzione.

La diagnostica 3 aggiunge numero di registrazioni dell'observer, notifiche del
toggle di sistema e pubblicazioni del player. Il contatore dei callback è
cumulativo per l'istanza nativa e non viene azzerato da Riprova. La dicitura
“Audio rilevato da iOS” è sostituita con “Riproduzione dichiarata nel Now Playing”:
leggere il nostro dizionario non prova che il servizio aptico lo abbia accettato.
La posizione corrente mostrata è stimata dalla posizione base pubblicata.

Il filtro è in `plugins/native/MetronomyNowPlayingPolicy.swift`; lo stesso file
usato da expo-audio viene compilato ed eseguito con test di regressione nel
workflow macOS prima della build iOS. I test Swift e la vibrazione fisica non
sono eseguibili dalla postazione Windows; i test Node/TypeScript sono separati.
Questa seconda modifica riguarda solo l'app: **nessun nuovo aggiornamento del
bridge è necessario**.
