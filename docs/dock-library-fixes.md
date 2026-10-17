# Barra e libreria — 17 ottobre 2026

## Barra, anche offline

- Barra estesa alta 72 pt (prima 64), simboli nativi a 23 pt; il contenitore
  comprende mini-player e distanza fra le due superfici (140 pt totali).
- La UITabBar flottante non applica di nuovo l'inset dell'home indicator, già
  gestito dal contenitore. La selezione e le gesture restano UIKit.
- Anche il fallback React Native ha barra a 72 pt e lente a 62 pt.
- Online e offline usano lo stesso componente; il cambio modalità resetta solo
  lo stato di scorrimento del dock. Non cambia la coda audio.

## Brani eliminati ancora visibili

Il precedente filtro `missing=false` dipendeva dalla scansione Navidrome. Ora
la pagina nativa verifica anche l'esistenza dei percorsi relativi nelle cartelle
autorizzate montate nel bridge, fuori dall'event loop. Non esegue nuove eliminazioni.
Le pagine vengono riempite dopo il filtro usando il cursore originale: eliminare
14 brani non provoca salti fra i brani delle pagine successive.

Un mount assente, un errore di permessi, un percorso sconosciuto o un symlink
non sono considerati prova di eliminazione. In questi casi va corretta la
configurazione/scansione: non si nasconde l'intera libreria per un errore Docker.
Nessuna ricerca fra cartelle di account diversi, nessun fallback amministratore.
Non ci sono tombstone permanenti: un file ripristinato può tornare visibile.

La cache viene invalidata dopo le eliminazioni tramite la revisione del catalogo;
al ritorno dell'app in primo piano si aggiorna la pagina attiva online.
Nessun timer di refresh durante lo scorrimento o cambio tab. Le cache online e
offline sono separate esplicitamente, e i cambi dei download aggiornano le liste
offline. Le copie locali non vengono eliminate né nascoste per una rimozione server.

## Verifica e distribuzione

Servono nuova build iOS e aggiornamento del bridge. Nessuna migrazione dei dati.
Test Python: file rimosso prima della scansione, album mancante, ripristino,
isolamento cartelle, path traversal, mount assente, symlink, errori IO,
flag missing e cursori di paginazione. Test JS: invalidazione cache e cambio modalità,
dimensioni/registrazione del dock, regressioni libreria e download locali.
La centratura effettiva della selezione UIKit va verificata su iPhone: i test
automatici su Windows non compilano né renderizzano la vista Swift.
