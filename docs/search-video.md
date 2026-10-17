# Cerca — riferimento video del 17 ottobre 2026

Riferimento locale: `cerca.mp4`, 384 × 848, durata 14,37 s.
Fotogrammi confrontati a intervalli di 1,5 s e ogni 100 ms per:

- 2,0–3,1 s: il titolo scorre via; il campo resta fissato sopra i contenuti.
- 9,2–10,3 s: il titolo sfuma, il campo si restringe per la X, compare la
  cronologia e la tastiera viene gestita dal sistema.
- 11,1–12,2 s: cambio sorgente con indicatore di selezione scorrevole.

## Implementazione

`SearchScaffold` mantiene lo stesso TextInput durante la transizione e usa
Reanimated per scorrimento, chiusura del titolo, X e selettore. Nessun setState
per fotogramma. L'evento di scroll viene inoltrato alla barra di riproduzione
esistente. La X chiude la ricerca; nascondere la tastiera non chiude la ricerca.

Il titolo occupa 62 pt, il campo è alto 46 pt, il selettore 34 pt, i margini
laterali sono di 18 pt. Qobuz/Libreria resta sempre sotto il campo, anche durante
l'esplorazione. La preferenza Riduci movimento disabilita le transizioni temporali;
Riduci trasparenza continua a usare lo sfondo opaco già previsto dall'app.

La griglia ha due colonne di tessere rettangolari, copertine, colori e testi
bianchi sovrapposti. I contenuti sono i suggerimenti personalizzati Qobuz già
disponibili, non le categorie o le immagini editoriali Apple del video.
La scheda Libreria conserva gli ascolti recenti. I pulsanti ⋯ e gli indicatori
di download restano collegati alle azioni esistenti.

La cronologia ora conserva titolo, tipo, sorgente e copertina quando disponibili.
Le vecchie stringhe vengono migrate senza cancellarle. È limitata a 10 elementi
e separata per account; non conserva URL audio, token o corrispondenze con la
libreria potenzialmente obsolete. Toccare una voce esegue una nuova ricerca
nella sorgente corretta. Offline sono mostrate solo le voci della libreria.

## Verifica

Test automatici: geometria del collasso e rimbalzo, transizione focus/blur/X
eseguendo lo stato del vero SearchScreen, riselezione della sorgente, cambio
Qobuz/Libreria, reset scheda, blocco Qobuz offline, migrazione e dati della
cronologia, TypeScript, regressioni JavaScript ed esportazione bundle iOS.

Prima di dichiarare equivalenza visiva: provare su iPhone lo scorrimento lento e
veloce, focus durante lo scorrimento, chiusura interattiva della tastiera, X,
cambio sorgente, ritorno dalla scheda artista, temi chiaro/scuro, testo grande
e Riduci movimento. Windows non consente di verificare la resa UIKit o misurare
il frame pacing reale sul dispositivo.

Questo intervento non modifica il bridge e non richiede un suo aggiornamento.
