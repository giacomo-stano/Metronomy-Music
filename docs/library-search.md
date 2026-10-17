# Ricerca nelle sezioni della libreria

- La barra compatta in Cerca usa il simbolo Libreria a sinistra, lasciando
  un'unica lente a destra. Il pulsante sinistro continua a espandere la
  navigazione senza azzerare la pagina. La stessa vista nativa serve online e offline.
- Playlist, Artisti, Album, Brani, Preferiti e Scaricati hanno una ricerca
  contestuale, con cancellazione del testo e supporto ai temi esistenti.
- Brani e Album online usano il nuovo endpoint autenticato
  `GET /library/search?kind=songs|albums&q=...&offset=...`.
  Cerca anche oltre le pagine già caricate, con risultati ordinati per rilevanza
  da Navidrome e caricamento progressivo. Lo scorrimento normale mantiene
  l'ordinamento scelto dall'utente.
- Artisti, playlist, preferiti e contenuto delle playlist sono collezioni
  complete: il filtro resta nella sezione corrente. Scaricati e la libreria
  offline cercano nei dati locali senza interrogare il server.
- Le ricerche locali ignorano maiuscole e accenti e combinano titolo,
  artista e album. Le query online vengono ritardate di 220 ms; le risposte
  superate non sostituiscono i risultati correnti.
- La lista non cambia chiave durante la digitazione, quindi non rimonta
  il campo di testo. Le ricerche sono separate per sezione, conservate durante
  la navigazione e cancellate quando si torna alla radice con la riselezione
  della scheda Libreria.

## Distribuzione e verifica

Aggiornare sia il bridge sia l'app. L'icona richiede una nuova compilazione
nativa, non solo un aggiornamento JavaScript o Expo Go. Non cambiano volumi,
credenziali, download o file musicali.

Verifiche automatiche: TypeScript, test JavaScript (inclusi
`library-search.cjs`, `library-pagination.cjs`, `native-music-dock.cjs`),
test Python del bridge ed esportazione del bundle iOS.

Da verificare su iPhone: assenza della seconda lente durante la contrazione;
apertura e chiusura della tastiera senza perdita del focus; ricerca oltre i
primi 100 brani; cambio rapido della query; cancellazione del filtro; ricerca
in Scaricati e in modalità aereo. La compilazione Swift e la resa UIKit non
sono verificabili con la sola esportazione del bundle su Windows.
