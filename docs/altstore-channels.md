# Pubblicazione AltStore: beta e stabile

La pubblicazione è **manuale e intenzionale**, ma dopo l'avvio del workflow non
occorre caricare l'IPA o modificare il JSON a mano. Un push su GitHub non pubblica
né una beta né una release. Questo flusso è per **AltStore Classic**, non PAL.

| Modalità `channel` | Branch | App su iPhone | Destinazione |
| --- | --- | --- | --- |
| `artifact` (predefinita) | qualsiasi | Metronomy | Solo artifact IPA, scadenza 14 giorni |
| `beta` | `develop` | Metronomy Beta | GitHub prerelease + source beta |
| `stable` | `main` | Metronomy | GitHub release + source stabile esistente |

La beta ha bundle identifier distinto (`com.anonymous.metronomy.beta`), dati,
login e download **locali** separati. La stabile conserva l'identificatore già
pubblicato nella source (`com.anonymous.metronomy.SFNN9B96MD`): non cambiarlo senza
una migrazione. Nome dell'app e dicitura Beta nelle Impostazioni distinguono i test.

**Attenzione:** se entrambe le app usano lo stesso server/account Navidrome,
musica, preferiti, download qoget e cancellazioni sul server sono condivisi e reali.
La beta non è un ambiente server di prova. Occupa inoltre uno slot di sideloading.

## Prima attivazione

1. Questi file devono essere presenti in `develop` per le beta e in `main` prima
   della prima release stabile. Non basta copiare solo il workflow: servono anche
   `scripts/`, `release/`, `app.config.js` e i test referenziati dal workflow.
2. GitHub costruisce la schermata **Run workflow** dalla definizione sul branch
   predefinito (`main`). Finché i nuovi input sono soltanto su `develop`, usa il
   comando CLI qui sotto. Il workflow `build-ios.yml` esiste già su `main`, quindi
   può ricevere un dispatch esplicito con `--ref develop`. Non è necessario
   pubblicare una release per portare la configurazione su `main`.
3. Il workflow concede `contents: write` soltanto al job di pubblicazione e usa il
   `GITHUB_TOKEN` automatico. Non servono Apple ID, password o token personali nel
   repository. Le regole di protezione del branch devono consentire al workflow di
   aggiornare il solo file source; altrimenti il job si ferma, senza force-push.
4. Il repository e gli asset devono essere pubblici. Un link a un artifact Actions
   privato o temporaneo non è un URL di distribuzione AltStore.

## Pubblicare una beta

Con il nuovo workflow presente anche su `main`:

1. GitHub → Actions → **Build Metronomy iOS IPA** → **Run workflow**.
2. Seleziona branch **develop** e `channel: beta`.
3. Scrivi le novità in `notes`; lascia disattivata la conferma stabile.
4. Avvia e attendi entrambi i job (build e pubblicazione).

Alternativa con GitHub CLI autenticata, utilizzabile anche prima di aggiornare
il workflow su `main`:

```bash
gh workflow run build-ios.yml --repo giacomo-stano/Metronomy-Music --ref develop -f channel=beta -f notes="Descrizione delle modifiche"
```

Il comando **avvia una build e pubblica una prerelease**: non eseguirlo se vuoi
soltanto preparare la configurazione. Ogni avvio ha un numero build distinto;
anche un nuovo tentativo dell'intero workflow riceve un numero diverso.

Source beta da aggiungere su iPhone **dopo la prima pubblicazione riuscita**:

```text
https://raw.githubusercontent.com/giacomo-stano/Metronomy-Music/develop/altstore-beta.json
```

Prima della prima beta la source contiene intenzionalmente zero app: non presenta
versioni fittizie o link a IPA inesistenti. Installa Metronomy Beta una sola volta
dalla source; gli aggiornamenti successivi saranno segnalati da AltStore.

## Pubblicare una release vera

1. Concludi i test e porta su `main` il codice che intendi distribuire.
2. Aumenta `expo.version` in `app.json` rispetto alla source stabile (ad esempio,
   da `0.2.2` a `0.2.3`). Tieni coerenti anche `package.json` e `package-lock.json`.
3. Avvia il workflow sul branch **main**, scegli **stable**, inserisci le note e
   seleziona **Confermo la pubblicazione di una release stabile**.
4. Il controllo iniziale rifiuta una versione uguale o precedente a quella già
   distribuita. Una beta non può essere promossa rinominando semplicemente l'IPA:
   la stabile viene ricompilata con il bundle identifier della stabile.

L'URL stabile già installato dagli utenti non cambia:

```text
https://raw.githubusercontent.com/giacomo-stano/Metronomy-Music/main/altstore-source.json
```

## Garanzie e limiti

- La source viene aggiornata **dopo** la pubblicazione dell'IPA, non prima.
- Versione, build, dimensione, iOS minimo e permessi vengono letti dal pacchetto
  effettivo. Il checksum SHA-256 è verificato prima del caricamento.
- Le prerelease beta non diventano la release GitHub `latest` e non modificano
  la source stabile. Non ci sono aggiornamenti di `main` durante una beta.
- Le IPA già pubblicate non vengono sovrascritte e la cronologia viene conservata.
  Non cancellare i tag/release citati dalle source: romperesti i relativi download.
- Se fallisce un upload, può restare una **bozza** su GitHub, ma la source non
  cambia. Per le beta, avvia un nuovo workflow completo. Per una stabile, ispeziona
  la bozza prima di rimuovere quella pubblicazione incompleta e riprovare; non
  rimuovere mai una release già distribuita. Un fallimento nell'aggiornamento del
  JSON dopo il caricamento può lasciare una release pubblica non ancora in source:
  controlla i permessi e correggi la source usando `ipa-manifest.json` della release.
- Usa **Re-run all jobs**, non soltanto il job di pubblicazione: il numero del
  tentativo deve coincidere con quello contenuto nell'IPA e nel piano di build.
- AltStore rileva gli aggiornamenti quando aggiorna la source (può esserci cache).
  Pubblicazione automatizzata non significa installazione silenziosa garantita:
  aggiornamento e firma restano gestiti da AltStore/AltServer secondo la tua
  configurazione. Non disinstallare l'app per aggiornarla.
- Questo workflow non aggiorna il bridge Linux. Se una build richiede nuovi
  endpoint, va aggiornato anche il bridge.

## Test locali senza pubblicazione

```bash
node tests/altstore-release.cjs
python -m unittest discover -s tests -p test_ipa_manifest.py -v
npx tsc --noEmit
```

I test usano IPA sintetiche e API simulate: nessuna release o richiesta di scrittura
GitHub. La build completa macOS e l'installazione AltStore vanno verificate con la
prima beta autorizzata.

Riferimenti: [aggiornamenti AltStore](https://faq.altstore.io/developers/updating-apps),
[schema source](https://faq.altstore.io/developers/make-a-source),
[varianti Expo](https://docs.expo.dev/build-reference/variants/).
