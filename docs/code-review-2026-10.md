# Revisione del codice — 30 ottobre 2026

Base verificata: `develop`, commit `1805ee2756a2c4ad6ada88a6cf0f1f90b1f52631`
(beta 58.1, successivo al fix del passaggio automatico tra brani).
I 154 file locali di codice, configurazione e test inventariati coincidevano
con i rispettivi blob del repository prima di questa revisione. Le modifiche
sono state isolate rispetto a una copia di quel contenuto: il checkout locale
contiene anche modifiche pregresse e non è stato ripristinato né riordinato.

## Ambito e metodo

- App React Native/Expo: richieste, account, cache, ricerca, navigazione,
  riproduzione, precaricamento, download e archivio offline.
- Bridge Python: autenticazione, separazione delle librerie, catalogo Qobuz,
  coda download, percorsi, cestino, paginazione e connessioni a Navidrome.
- Moduli Swift e plugin Expo: esame statico dei confini nativi, gestione delle
  risorse e compatibilità delle patch. Nessuna modifica Swift in questa revisione.
- Adattatore Go, configurazione dell'app e workflow di build/pubblicazione.
- Analisi TypeScript con controlli di simboli inutilizzati, ricerca dei
  riferimenti, analisi degli import Python e test di regressione.

È una revisione statica e automatizzata con ispezione manuale dei flussi critici;
non certifica l'assenza di ogni bug e non sostituisce una prova su iPhone o sul
server reale. Nessuna musica o configurazione privata del server è stata modificata.

## Difetti confermati e corretti

| Priorità | Problema | Correzione e prova |
| --- | --- | --- |
| P1 | Una richiesta di eliminazione singola annullata rilasciava il lock mentre il thread continuava a copiare/rimuovere il file. Un'altra operazione sul cestino poteva sovrapporsi. | `server/backend/app/file_ops.py`: attesa protetta della fine del lavoro, come già previsto per gli album. Test con thread controllato e annullamento durante l'operazione. |
| P2 | Dopo la rimozione di un download locale, il ripristino attendeva 250 ms e poteva eseguire un seek sul brano selezionato nel frattempo. | `src/PlayerSheet.tsx`: controllo di brano corrente e componente montato prima di seek/ripresa, dopo le attese e prima degli errori. Test del callback effettivo con cambio brano e smontaggio. |
| P2 | Un precaricamento album lento poteva terminare dopo un refresh forzato e sovrascriverne la cache con dati precedenti. | `src/albumPrefetch.ts`: soltanto la richiesta più recente per quell'album aggiorna la cache. Test con risposte completate in ordine inverso. |
| P2 | L'annullamento durante la lettura del corpo HTTP o dell'archivio offline poteva comunque consegnare il risultato. | `src/api.ts`: ricontrollo del segnale dopo entrambe le letture. Test di annullamento tardivo, chiamata già annullata e risposta 401 di un vecchio account. |

I quattro test mirati falliscono usando il corrispondente codice precedente e
passano con le correzioni. I test del cestino usano un'operazione simulata e non
eliminano file musicali.

## Codice rimosso

- Stato `results`, setter e ramo di ricerca irraggiungibile in `App.tsx`:
  la ricerca è già gestita da `SearchScreen`, e l'effetto usciva prima di quel ramo.
- Prop `onDownloaded` passata attraverso ricerca/catalogo ma mai invocata:
  il completamento viene già osservato tramite `ServerDownloadStore`.
- Wrapper interni inutilizzati `getHome`, `searchLibrary`, metodo
  `LibraryIndex.match`, helper `network.duplicate`, export
  `remoteControlsAvailable` e costante `SEARCH_PINNED_HEIGHT`.
- Import, costanti colore e callback `restorePlayer` non referenziati.
- 26 stili senza riferimenti in App, player e libreria, inclusi residui grafici
  dei vecchi Music Haptics. Non sono stati rimossi stili utilizzati.
- Il test che chiamava `network.duplicate` ora verifica `download_targets`,
  cioè il percorso usato effettivamente dai download.

Mantenuti i fallback Expo Go/Android, migrazione Aurora→Metronomy, guardie
multiutente, codice di recupero e route legacy pubbliche (`/import-requests`,
anteprime, ecc.). Non sono codice morto solo perché l'app attuale non li chiama:
rimuoverli cambierebbe la compatibilità del bridge con client precedenti.
Nessuna modifica alle dipendenze o al disegno dell'interfaccia.

## Prevenzione delle regressioni

`noUnusedLocals` e `noUnusedParameters` sono ora attivi nel controllo TypeScript.
`npm test` esegue tutte le suite `.cjs` presenti in `tests`, con processo separato
e timeout per suite. Il workflow iOS usa questo comando: prima elencava soltanto
18 delle 25 suite esistenti, lasciandone fuori alcune su offline, sessioni e UI.
Le nuove suite verranno incluse automaticamente. `npm run typecheck` esegue il
controllo dei tipi. Non sono stati aggiunti trigger di build o pubblicazione.

## Controlli eseguiti

| Controllo | Esito |
| --- | --- |
| TypeScript, inclusi i due nuovi controlli unused | Superato |
| Suite JavaScript/TypeScript tramite `npm test` | 27/27 superate |
| Test Python del bridge | 60/60 superati |
| Test del manifest IPA | 1/1 superato |
| Test Go dell'adattatore sulla revisione qoget fissata nel Dockerfile | Superati |
| Verifica delle due patch Expo Audio installate | Superata |
| Export iOS Metro/Hermes | Superato, 1319 moduli |

I test Python locali usano Python 3.13 e il virtualenv già disponibile; la CI
e Docker continuano a usare Python 3.12. I blocchi iniziali del sandbox su
loopback e directory temporanea sono stati risolti prima del risultato finale.
L'export Hermes non è una compilazione Swift/Xcode, una firma IPA o una prova su
dispositivo. Non sono state misurate latenze reali su VPN/Qobuz in questa revisione.

## Punti da affrontare separatamente

1. **P2 — Controlli solo visivi nella coda.** In `PlayerSheet`, i toggle
   `autoplay` e `automix` cambiano soltanto lo stato grafico locale; non abilitano
   una coda infinita né un mix audio. Vanno implementati o presentati chiaramente
   come non disponibili. Non è stato aggiunto un motore audio in questo refactoring.
2. **P2 — Ripristino dopo rimozione locale.** La protezione dal cambio brano è
   corretta, ma rimane l'attesa fissa di 250 ms: se lo stream è lento, il seek può
   non essere ancora disponibile. Conviene centralizzare questo percorso nel
   controller di riproduzione e attendere lo stato nativo, verificando anche
   rimozione offline, pausa e background su dispositivo.
3. **P2 — Persistenza delle sessioni.** Il token del bridge viene salvato in
   AsyncStorage. Una migrazione a Keychain/SecureStore ridurrebbe l'esposizione
   dei segreti locali; richiede una migrazione compatibile dei login esistenti.
   Questo rilievo non implica che sia avvenuta una fuga di credenziali.
4. **P3 — Dimensione dei componenti.** `App.tsx` supera 3000 righe e
   `PlayerSheet.tsx` circa 2000. Separare gradualmente controller audio,
   presentazione, navigazione e azioni renderebbe più semplice verificare il ciclo
   di vita. Una riscrittura simultanea sarebbe più rischiosa di questi interventi.
5. **P3 — Copertura nativa.** Diversi test UI verificano matematica, wiring o
   mock: servono anche prove end-to-end su iPhone per tastiera, Dynamic Type,
   gesture, background e AVPlayer. Sono limiti della verifica, non crash riprodotti.

## Distribuzione

Questa revisione richiede una nuova build dell'app e l'aggiornamento del bridge
per includere rispettivamente le correzioni client e quella del cestino.
Nessuna migrazione dei dati, reinstallazione del server o riscaricamento della
musica. La pubblicazione della revisione su `develop` non avvia una build iOS
o una release: il workflow iOS resta manuale. I test del bridge possono essere
eseguiti automaticamente dal workflow già presente.
