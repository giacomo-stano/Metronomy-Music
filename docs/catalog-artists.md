# Ricerca e pagine artista Qobuz

La ricerca resta unica (artisti, brani e album). Un artista con nome esatto viene
mostrato prima degli altri risultati; le tre categorie sono poi alternate mantenendo
l'ordine restituito da Qobuz. I suggerimenti usano la query e nomi realmente trovati.

La scheda artista usa una superficie scura immersiva, senza cambiare il tema salvato
per il resto dell'app. Foto, biografia, ultima uscita, top brani, categorie di uscite e
artisti simili provengono da Qobuz. `artist/page` viene affiancato a `artist/get` per
compatibilità; i dati opzionali non disponibili non bloccano la discografia.

- **Album principali**: fino a due album ordinati per il campo `popularity` di Qobuz,
  quando presente nella prima pagina. Non sono gli “Album essenziali” editoriali Apple.
- **Top brani**: solo i `top_tracks` del provider; mai i primi brani di un album
  spacciati per una classifica. Il pulsante principale riproduce quelli disponibili.
- **Tutta la discografia**: lista paginata a blocchi di 40, oltre ai caroselli iniziali.
- **Riproduci album**: carica le pagine dei brani e usa il player principale. Non
  accoda download sul server; gli URL completi sono richiesti dal player al bisogno.
- I brani già presenti mantengono l'identità Navidrome, incluse copie locali e preferiti.
- I tre puntini conservano il menu esistente e il controllo duplicati/destinazioni.
- La stella dell'artista è una preferenza locale per account/dispositivo; non modifica
  i preferiti del conto Qobuz condiviso e non è la stella dei brani Navidrome.
- Video e playlist editoriali Apple non sono riprodotti o simulati in questa pagina.

## Aggiornamento

Servono sia il bridge aggiornato (nuovo endpoint autenticato
`GET /network/artist/{id}/profile`) sia il client aggiornato. Nessuna migrazione del
database, modifica ai volumi o reinstallazione del server è necessaria. Ricostruire
il servizio `bridge` usando i propri file Compose e installare una nuova build client.

## Verifica

Automatica: `npx tsc --noEmit`, `node tests/artist-catalog.cjs`, tutti gli altri
`tests/*.cjs` e `python -m unittest discover -s server/tests -p 'test_*.py' -v`.

Su iPhone con il proprio account Qobuz (non disponibile nei test con fixture):

1. Cercare “Neffa” in tema chiaro e scuro; aprire l'artista dai risultati.
2. Controllare foto, fade, dimensioni dei controlli, biografia e categorie disponibili.
3. Avviare un top brano, poi un album completo: nessun job download deve comparire.
4. Aprire i tre puntini di brano/album: scaricare solo dopo scelta esplicita; verificare
   l'avviso sui duplicati e la corretta cartella per Giacomo/Lorenza.
5. Aprire album e artista simile, poi tornare indietro: posizione di scorrimento intatta.
6. Provare annullamento durante caricamento/riproduzione, cambio tab, logout,
   connessione assente, testi grandi, VoiceOver e Riduci movimento.

Riferimenti per i contratti del provider:
[Minim Artists API](https://minim.readthedocs.io/en/dev/api-ref/minim.api.qobuz.PrivateArtistsAPI.html),
[implementazione LMS](https://github.com/LMS-Community/plugin-Qobuz/blob/master/API.pm).
