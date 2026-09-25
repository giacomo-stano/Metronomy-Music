# Metronomy

Metronomy è un client musicale iOS per una libreria personale ospitata sul proprio server.

## Requisiti

Per usare l'app servono:

- un iPhone;
- AltStore installato sul dispositivo;
- un server Navidrome già configurato;
- il bridge Metronomy attivo sul server;
- connessione al bridge tramite rete locale o VPN.

## Installazione con AltStore

Aggiungi questa source personalizzata ad AltStore:

```text
https://raw.githubusercontent.com/giacomo-stano/Metronomy-Music/main/altstore-source.json
```

Dopo aver aggiunto la source:

1. apri la source **Metronomy** in AltStore;
2. seleziona **Metronomy**;
3. installa l'ultima versione disponibile;
4. completa normalmente la procedura di firma richiesta da AltStore.

Gli aggiornamenti successivi compariranno direttamente in AltStore quando viene pubblicata una nuova versione.

## Primo avvio

Al primo avvio inserisci:

- l'URL completo del bridge Metronomy, inclusa la porta (ad esempio `http://192.168.1.24:8180`);
- username e password del tuo account Navidrome.

Metronomy non si collega direttamente a Navidrome: il bridge è obbligatorio e deve essere raggiungibile dall'iPhone. Fuori dalla rete di casa è quindi necessario utilizzare una VPN o un'altra modalità di accesso remoto configurata sul server.

## Download diretto

Le versioni pubblicate dell'app sono disponibili anche nella sezione **Releases** di questo repository come file `Metronomy.ipa`.

> Metronomy non è distribuita tramite App Store. L'installazione avviene tramite sideloading e richiede quindi una firma valida gestita da AltStore.
