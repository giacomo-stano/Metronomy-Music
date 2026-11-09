# Diagnostica HTTP Range — AVPlayer / FLAC

## Scopo
Confrontare la lettura del medesimo brano FLAC 24-bit/192 kHz nelle IPA con timing `precise` e `standard`, su Wi-Fi locale e rete cellulare via WireGuard.

Il bridge inoltra gli header `Range` di AVPlayer a Navidrome e quelli di risposta (`Content-Range`, `Content-Length`, `Accept-Ranges`) al client. I normali header `Server-Timing` misurano soltanto la preparazione della risposta, **non** i byte audio trasmessi.

## Attivazione temporanea
Il codice di questo branch deve essere distribuito nel **container bridge**. La sola modifica su GitHub non altera il server in esecuzione.

Configurare la variabile d'ambiente del servizio bridge (ad esempio nel `docker-compose.yml` effettivamente utilizzato):

```yaml
services:
  bridge:
    environment:
      STREAM_TRACE: "true"
```

Conservare le altre variabili, i bind mount e i volumi già presenti. Ricreare **solo** il container bridge con la procedura Docker Compose della propria installazione, quindi seguire i log:

```bash
docker logs --since 2m -f metronomy-bridge 2>&1 | grep --line-buffered STREAM_TRACE
```

In caso di fallimento prima dell'autenticazione, non viene generato un evento STREAM_TRACE: questo strumento misura solo il percorso audio autorizzato.

## Prova controllata
1. Scegliere un brano problematico FLAC 24/192 e uno normale.
2. Iniziare la raccolta dei log, poi avviare **un solo brano alla volta**.
3. Annotare i tempi di `Tempi di avvio audio` sull'iPhone e l'ora del test. Evitare download paralleli.
4. Fare 3–5 prove con timing preciso e 3–5 con timing standard, mantenendo la stessa connessione. Ripetere il test su Wi-Fi e rete cellulare via VPN.
5. Selezionare un punto vicino alla fine del brano e osservare se AVPlayer richiede altre porzioni del file; confrontare l'indicatore con la fine effettiva dell'audio.
6. Disabilitare `STREAM_TRACE` e ricreare il container al termine.

## Interpretazione

Eventi (stesso `req`):
- `phase=headers`: il bridge ha ricevuto gli header della risposta upstream; `upstream_headers_ms` misura l'attesa da Navidrome.
- `phase=finished`: `first_byte_ms` misura l'attesa dei primi byte **lato bridge**, `transferred_bytes` e `total_ms` descrivono il trasferimento. `completed=False` indica che il trasferimento è stato interrotto o non è terminato normalmente; **può essere normale** se AVPlayer abbandona un Range e ne richiede un altro.
- `phase=error`: un errore HTTP è avvenuto prima di ricevere gli header.

`song` è un hash abbreviato per correlare letture dello stesso file; `req` identifica una singola richiesta. Nessun ID reale, header Authorization, URL o token è scritto nei log.

**Limiti:** queste misurazioni non mostrano i tempi interni del decoder AVFoundation né garantiscono che i byte abbiano già raggiunto l'iPhone. Se `first_byte_ms` è breve ma il player aspetta diversi secondi, serve correlare le letture Range con il timestamp di readiness nativa e, se necessario, analizzare MTU/RTT. La precisione della timeline FLAC dipende anche dall'indice temporale e dai metadati del file.

## Test
Dalla directory `server/backend` con dipendenze Python installate:

```bash
python -m unittest discover -s tests -p 'test_stream_diagnostics.py' -v
```
