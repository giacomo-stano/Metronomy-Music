# FLAC engine probe (iOS) — AudioStreaming / AVAudioEngine

## Obiettivo
Verificare un motore alternativo senza modificare l'app Metronomy e senza convertire il file FLAC. Questo **non è ancora l'integrazione del secondo motore nel player Metronomy**: è un'app diagnostica indipendente per confrontare avvio, seek e fine traccia. Non esiste ancora evidenza che sia migliore di AVPlayer nel caso FLAC 24 bit / 192 kHz.

Sorgente: `dimitris-c/AudioStreaming`, Swift Package Manager, commit pin `b4848909377c2e36d31d2afd0a244e48c9a0f5a7`, licenza MIT.

## Compilazione
Pull request verso `develop` avvia automaticamente il workflow **Test alternative FLAC engine (iOS)**. Il job:
1. genera un piccolo progetto iOS SwiftUI con XcodeGen;
2. collega lo Swift Package `AudioStreaming`;
3. compila una app **Release unsigned** con bundle ID **com.anonymous.metronomy.flacprobe**;
4. pubblica l'artifact **Metronomy-FLAC-Probe-unsigned**.

**Non** è la IPA normale di Metronomy, non cambia `develop`, il bridge o la libreria Navidrome. Una IPA unsigned va firmata prima di essere installata (AltStore/SideStore, rispettando i limiti dell'account e verificando il bundle ID). La compilazione iOS e la compatibilità effettiva della libreria devono essere confermate dai log del job.

## Test locale: stesso FLAC senza conversione
1. Esportare una copia del FLAC originale nell'app **File** dell'iPhone usando il metodo preferito (senza conversione).
2. Aprire **FLAC Probe** e scegliere `Importa FLAC dall'app File`.
3. Avviare l'audio, annotare `Primo avanzamento` (solo proxy del primo suono), `Stato player` e `Durata nativa`.
4. Eseguire il seek al 94%, osservare i timestamp e lasciar arrivare il brano alla fine.
5. Verificare se `Posizione nativa` supera `Durata nativa`, se il brano continua a suonare quando il progress arriva al 100%, e se compare uno stato concluso.
6. Ripetere 3 volte.

## Test streaming: stesso FLAC via bridge
Immettere nella casella un URL **di streaming già autorizzato**, sullo stesso formato usato da Metronomy (`/stream/{id}?access_token=...`). Usare solo sul proprio dispositivo, non incollare in chat o nei log l'URL con token. L'app **non salva** l'URL dopo la chiusura; il diagnostico mostra solo durata/posizione/stato.

Il file di progetto abilita temporaneamente ATS `NSAllowsArbitraryLoads` **solo nell'app di prova**, per poter collegare il bridge HTTP privato. È una concessione di sicurezza inadatta a un'app pubblicata; non copiarla nella produzione.

Avviare streaming con WireGuard e confrontare tempo iniziale, frequenza dei seek, fine brano e richieste `STREAM_TRACE` del bridge.

## Criteri di successo
- Il brano FLAC originale parte rapidamente (ideale ≤2 s in rete cellulare, ma non è una garanzia).
- Seek 94%/99% corrisponde all'audio reale.
- La durata e il progress restano coerenti; il brano termina senza audio residuo oltre il 100%.
- Nessun blocco o crash, offline e streaming.

## Dopo il prototipo
Soltanto se funziona, implementare un adapter Expo Modules per audio FLAC, mantenendo la UI esistente. Background, AirPlay, remote controls, auth/sessione, download cache, repeat/queue, gapless e stato richiedono **una seconda fase**.

## Limitazioni
- Questo prototipo usa il conteggio del primo avanzamento come approssimazione, **non rileva il suono dal microfono**.
- Un cambiamento del motore può alterare il percorso audio e i controlli di sistema.
- Il file originale ha durata esatta ~436,587 s ed è 24/192: conservarlo inalterato per test A/B.
