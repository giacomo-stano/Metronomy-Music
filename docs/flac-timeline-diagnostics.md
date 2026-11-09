# Esperimento: timeline FLAC con avvio rapido

Branch basato sulla modalità sperimentale di avvio rapido (`METRONOMY_PRECISE_AUDIO_TIMING=false`).

## Obiettivo
Distinguere:
1. una differenza tra durata nativa AVPlayer e catalogo Navidrome;
2. un disallineamento tra `currentTime` nativo, cursore e audio;
3. un errore legato al target del seek vicino alla fine.

La modifica non cambia `AVPlayer`, durata visualizzata, `seekPlayback` né richieste HTTP: **solo misurazioni**.

## Installazione
Nella build GitHub Actions scegliere il branch `experiment/flac-timeline-diagnostics`, `channel=artifact`, `precise_audio_timing=standard`. La pipeline produce una IPA *unsigned*: per installarla serve firmarla come nelle build precedenti. ATTENZIONE: il channel `artifact` utilizza il bundle ID *stable* secondo l'attuale workflow, perciò l'installazione potrebbe sovrascrivere la versione stabile o i suoi dati locali. Fare un backup e verificare l'ID prima di installare.

## Prova consigliata
- Riprodurre il FLAC 24/192 in streaming fino a quando inizia normalmente.
- Eseguire un seek verso ~95–99%, osservare barra e audio, attendere 2 secondi.
- Quando la barra arriva alla fine mentre il brano continua, lasciare che suoni ancora alcuni secondi; non cambiare traccia.
- Aprire Impostazioni → Su questo iPhone → Diagnostica FLAC e seek → Aggiorna diagnostica.
- Condividere i campioni: `prima seek`, `seek completato`, `1.5s dopo seek`, `vicino alla fine`, più il sintomo osservato.

La diagnosi registra durata e posizione **native non limitate** oltre alla durata catalogo. Se la barra visualizza zero secondi rimanenti mentre `nativePosition` continua a crescere oltre `nativeDuration`, il problema è nel riferimento temporale nativo; non va risolto solo cambiando la barra.

Il database Navidrome resta invariato e non vengono registrati titoli, token o URL.
