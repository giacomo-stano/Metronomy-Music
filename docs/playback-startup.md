# Avvio della riproduzione

L'avvio attraversa tre fasi: scelta del file/risoluzione Qobuz, apertura del
player nativo, avanzamento dell'audio. Fuori casa lo stream della libreria
attraversa anche WireGuard e l'upload domestico; Qobuz richiede al bridge la
risoluzione autorizzata, poi l'iPhone legge la URL HTTPS restituita.

## Ottimizzazioni

- Il bridge mantiene fino a tre processi `metronomy-appid stream-serve`.
  Riutilizza prima quello già caldo: client HTTP, bundle Qobuz e firma valida
  non vengono ricreati per ogni brano. Ogni traccia continua a passare da
  `FileURL`, con i controlli di abbonamento/disponibilità e rifiuto delle anteprime.
  Le credenziali vengono rilette a ogni richiesta; cambio configurazione,
  errori o dieci minuti di vita ricreano il client. Nessuna URL firmata è salvata.
- Su iOS, negli ultimi 25 secondi, viene preparata una sola traccia successiva
  della coda ordinata. Si risolve la sorgente e si chiede a Expo di predisporre
  l'asset con buffer preferito di 5 secondi. La richiesta di buffer non garantisce
  che siano già disponibili 5 secondi di audio. Non viene avviato un secondo player.
  Shuffle e ripeti-un-brano non fanno richieste speculative.
- Preparazioni scadute dopo 45 secondi, cambi coda/account/modalità, logout,
  rimozioni e risultati tardivi vengono invalidati. Un tap non aspetta una
  preparazione ancora incompleta: usa l'avvio normale. Le copie locali sono
  sempre ricontrollate e hanno precedenza sullo stream, anche online.
- Le tre copertine successive sono caricate solo dopo l'avvio del brano,
  con un ritardo di 1,5 secondi, per ridurre la concorrenza sulla connessione.
- La patch Expo per il riuso dell'asset conserva la sorgente corretta per il
  ripristino dei servizi audio e scarta un asset già fallito durante la preparazione.
  La precisione della durata/seek e il formato FLAC richiesto restano invariati.

Non vengono memorizzate autorizzazioni Navidrome: il bridge continua a verificare
l'accesso come prima. Il primo brano a freddo, selezioni casuali, rete lenta,
indicizzazione nativa e un server lento possono ancora richiedere attesa.

## Misurare sul dispositivo

Aprire **Impostazioni → Su questo iPhone → Tempi di avvio audio** dopo la prova.
Sono mostrati gli ultimi otto tentativi della sessione, senza titolo, ID,
URL, account o token. I dati sono soltanto in memoria, non vengono inviati.
Il logout li azzera; non è necessaria una registrazione del microfono.

- **Preparazione sorgente**: dal tocco alla scelta del file o alla risposta Qobuz.
- **Player pronto dal tocco**: prima notifica nativa di asset caricato.
- **Primo avanzamento dal tocco**: primo stato in riproduzione, non in buffering,
  con posizione positiva. È una misura software con intervallo di aggiornamento
  di circa 250 ms, non una misura acustica del primo suono.
- **Risposta bridge / verifica catalogo / risoluzione stream Qobuz**:
  tempi `Server-Timing` della richiesta di risoluzione effettuata durante il tap.
  Sono inclusi nella preparazione sorgente e non vanno sommati tra loro.
  Non sono disponibili quando quella richiesta è stata anticipata.
- **Preparato in anticipo** indica che era disponibile una sorgente pre-risolta;
  non prova che il buffer fosse pieno.

Confrontare alcuni avvii a freddo e cambi automatici della stessa coda su Wi-Fi e
WireGuard, separando Qobuz, libreria server e file iPhone. Preparazione alta con
bridge rapido suggerisce attesa di rete; player pronto/avanzamento alti dopo una
risoluzione rapida suggeriscono trasferimento/buffering/indicizzazione nativa.
I tempi delle tracce della libreria includono la rete soprattutto nella fase
nativa, perché la loro URL non richiede una risoluzione API preliminare.

## Aggiornamento e verifiche

Servono sia una nuova app iOS (contiene anche la patch nativa) sia il bridge
ricostruito con il nuovo adattatore Go. Non cambiano volumi, configurazioni o
cartelle della musica. Non basta un riavvio del vecchio container.

Validazione locale: TypeScript, suite JavaScript, test Python del bridge, test Go
dell'adattatore e del client Qobuz fissato dal Dockerfile, compilazione Go per
Linux e bundle Expo iOS. La compilazione Swift e i tempi reali di avvio richiedono
la build iOS e una prova sull'iPhone. Non è stata avviata una build o release.
