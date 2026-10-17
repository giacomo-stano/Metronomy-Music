# Dock iOS nativo — riferimento video 16 ottobre

La build iOS registra `MetronomyDock` nel modulo locale già collegato ai controlli audio.
La barra usa `UITabBar`, il mini-player controlli UIKit e `UIGlassEffect` su iOS 26+
(materiale sfocato sulle versioni precedenti). Il menu del mini-player è un `UIMenu`
aperto con pressione prolungata su copertina/titolo. Non sono usate API private.

Non è ancora una migrazione a `UITabBarController`/SwiftUI `TabView`: le schermate e
la loro cronologia restano React Native. Il mini-player si compatta con un'animazione
UIKit durante lo scorrimento, non usa l'accessorio/minimizzazione di sistema del
tab controller. Non promette di riprodurre ogni gesto o transizione di Apple Music.

## Comportamenti osservati nel riferimento (17 secondi)

- 0–1 s: mini-player largo sopra la barra, copertina/titolo/artista + play/avanti.
- 1,1–2,4 s: scroll verso il basso; una sola riga con sezione a sinistra,
  mini-player al centro (titolo E artista, solo play), Cerca a destra.
- 2,5 s: risalita; ritorno alla barra estesa. Nessun ripristino dopo un timer inattivo.
- 7,8–12 s: pressione/trascinamento sulla barra. Le gesture e la lente restano
  quelle di UITabBar; il contenitore non deve tagliarle quando la barra è estesa.
- 12,5 s / 14,6 s: apertura e chiusura player. L'origine è ora il rettangolo
  effettivo del mini-player in coordinate finestra, non un punto fisso. L'apertura
  aspetta Modal.onShow e la chiusura torna alla stessa origine; non è un'animazione
  UIKit condivisa con la copertina, ma un morph Reanimated del pannello.

Metronomy mantiene quattro tab: non viene aggiunta la sezione Radio del video.
La pressione del pulsante sezione compatto espande la barra senza azzerare la pagina.
La soglia cumulativa filtra piccoli cambi di direzione e il rimbalzo a fine lista.
Proporzioni/timing sono adattati al riferimento, ma la parità visiva richiede prova
su iPhone, specialmente lente nativa e morph del player; non è certificata dai test JS.

## Invarianti

- Nessun nuovo player o cambiamento al bridge, alla coda o al download.
- Selezionare una sezione ripristina la sua pagina; riselezionarla torna alla radice.
- Le vecchie build senza il modulo, Expo Go e Android usano il dock precedente.
- Copertina anche da file locale, richieste cancellabili, nessun URL registrato o
  cache HTTP persistente. Gli eventi di menu obsoleti non agiscono su un nuovo brano.
- Play/pausa, avanti, apri player e “Altre opzioni del brano…” nel menu nativo.
  Quest'ultima apre il menu completo esistente (download, preferiti, eliminazione,
  ecc.); gli altri menu della libreria NON sono ancora convertiti a UIMenu.
- Nessun timer/progresso audio inviato al dock; configurazione e callback stabili.

## Verifica richiesta prima di distribuire

Serve una **nuova build iOS**: un aggiornamento JS non aggiunge il modulo nativo.
TypeScript, test JS e bundle Expo non sostituiscono compilazione Xcode e prove su iPhone.

1. Verificare build Xcode e linking, poi avviare sia senza brano sia con musica attiva.
2. Provare tutte le tab, il ritorno a un album aperto e la riselezione anche dopo 10 s.
3. Scorrere rapidamente avanti/indietro: mini-player compatto, nessun salto di lista,
   tocchi e scroll consentiti nello spazio trasparente intorno al dock.
4. Provare play/pausa, buffering, avanti a fine coda, apertura player da entrambi i
   layout, pressione prolungata per il menu e ritorno; verificare anche brani Qobuz.
5. Tenere aperto il menu mentre cambia brano: le vecchie azioni devono essere ignorate.
6. Verificare tastiera Cerca, rotazione, home indicator, tema chiaro/scuro,
   VoiceOver, Riduci movimento, Riduci trasparenza e dimensioni testo maggiori.
7. Modalità aereo: copertina locale e riproduzione; logout/login: nessun comando
   indirizzato al vecchio account. Nessun cambiamento al background audio.

Controllare visivamente il comportamento di UITabBar standalone su iOS target:
gli automatismi del tab controller non sono disponibili in questa integrazione.
