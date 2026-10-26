# Layout su dispositivi diversi

Correzioni:
- Barra UIKit: simboli normalizzati in un riquadro reale di 24 pt, separazione
  dalle etichette e font dei tab limitato a 12 pt. Aspetti stacked, inline e
  compact inline configurati insieme. Altezza barra 76 pt.
- Mini player: 60 pt nella vista estesa; righe misurate con i font UIKit.
  Su larghezze utili inferiori a 350 pt resta esteso. La visibilità si aggiorna
  anche quando cambia la larghezza, senza attendere un evento di navigazione.
- Fallback: riquadri distinti per icone e testi, etichette a una riga e
  selezione che resta nel proprio tab anche durante l'ingrandimento.
- Ricerca: intestazione, campo e selettore crescono con il testo. Lo spazio
  riservato allo scorrimento usa le stesse misure dell'intestazione.
  I riquadri diventano a colonna singola con schermo stretto o testo grande,
  con spazio riservato al pulsante delle opzioni.
- Menu: larghezza adattata alla dimensione del testo, sempre nei margini
  di sicurezza e con scorrimento delle azioni.
- Player: metadati e controlli vengono misurati prima di dimensionare la
  copertina. I controlli restano sopra l'indicatore Home anche sui telefoni
  più corti. Coda e testi rispettano l'area sicura superiore.
- I componenti della barra e del player sono condivisi online/offline.

## Verifica automatica

`node tests/responsive-layout.cjs` controlla 10 viewport in punti, inclusi
320, 360, 375, 390 (iPhone 13), 393, 402, 430, 440, 768 e 1024, e 6 scale
di testo da 1 a 3. Verifica la geometria della selezione animata, dello spazio
per la ricerca, dei menu e del player. La suite viene eseguita nella CI iOS.

Questi controlli non renderizzano UIKit e non sostituiscono una prova su iPhone.

## Prova sulla nuova build nativa

- iPhone 13 / iOS 26 e iPhone più recente / iOS 27: testo normale, testo
  ingrandito, zoom schermo; tema chiaro e scuro.
- Barra completa e ridotta: selezione di tutti i tab, pressione e trascinamento,
  pausa/riproduzione, cambio brano. Icona e didascalia devono restare separate.
- Ripetere nella libreria offline, con un brano scaricato e titoli lunghi.
- Ricerca: tastiera aperta/chiusa, X, cambio Qobuz/Libreria, scorrimento,
  riquadri con titoli lunghi e menu con molte azioni.
- Player su schermo corto: copertina, titolo, barra e controlli non devono
  sovrapporsi. Testare anche un brano Qobuz con stato di download.
- Accessibilità: VoiceOver, Riduci movimento e Riduci trasparenza.
- iPad: ridimensionamento della finestra con barra/menu aperti.

Serve una nuova build iOS per la correzione UIKit. Il bridge non cambia.
