# Dock iOS nativo — primo passaggio

La build iOS registra `MetronomyDock` nel modulo locale già collegato ai controlli audio.
La barra usa `UITabBar`, il mini-player controlli UIKit e `UIGlassEffect` su iOS 26+
(materiale sfocato sulle versioni precedenti). Il menu del mini-player è un `UIMenu`
ancorato al suo pulsante. Non sono usate API private.

Non è ancora una migrazione a `UITabBarController`/SwiftUI `TabView`: le schermate e
la loro cronologia restano React Native. Il mini-player si compatta con un'animazione
UIKit durante lo scorrimento, non usa l'accessorio/minimizzazione di sistema del
tab controller. Non promette di riprodurre ogni gesto o transizione di Apple Music.

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
4. Provare play/pausa, buffering, avanti a fine coda, apertura player, menu e ritorno.
5. Tenere aperto il menu mentre cambia brano: le vecchie azioni devono essere ignorate.
6. Verificare tastiera Cerca, rotazione, home indicator, tema chiaro/scuro,
   VoiceOver, Riduci movimento, Riduci trasparenza e dimensioni testo maggiori.
7. Modalità aereo: copertina locale e riproduzione; logout/login: nessun comando
   indirizzato al vecchio account. Nessun cambiamento al background audio.

Controllare visivamente il comportamento di UITabBar standalone su iOS target:
gli automatismi del tab controller non sono disponibili in questa integrazione.
