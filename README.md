# Metronomy

Metronomy è un client musicale iOS per una libreria personale self-hosted. Il progetto è composto da due parti:

- **Metronomy**: l'app iOS;
- **Metronomy Server**: il bridge self-hosted che collega l'app a Navidrome e, opzionalmente, a Qobuz tramite qoget.

Il server autentica gli utenti tramite Navidrome, espone libreria, artwork e streaming all'app, gestisce preferiti/download e può operare sui file delle librerie configurate. L'app **non si collega direttamente a Navidrome**: per usarla è necessario avere Metronomy Server attivo e raggiungibile dall'iPhone.

## Architettura

```text
iPhone / Metronomy
        |
        | HTTP/HTTPS
        v
Metronomy Server :8180
        |
        +----> Navidrome
        |
        +----> Qobuz / qoget (opzionale)
```

## Requisiti

### Server

- Linux;
- Docker Engine;
- Docker Compose v2;
- Git;
- un'istanza Navidrome già funzionante;
- il percorso assoluto sul server delle cartelle musicali usate dalle librerie Navidrome.

### iPhone

- iPhone con AltStore o un altro sistema di sideloading compatibile;
- connettività verso Metronomy Server tramite LAN, VPN oppure HTTPS reverse proxy.

Qobuz è opzionale. Se viene abilitato durante il setup, serve un account Qobuz valido.

---

# Installazione pulita di Metronomy Server

## 1. Clona il repository

Sul server:

```bash
git clone https://github.com/giacomo-stano/Metronomy-Music.git
cd Metronomy-Music/server
```

La directory `server/` contiene tutto ciò che serve al backend. Non è necessario copiare o compilare il codice iOS sul server.

## 2. Avvia il wizard di configurazione

```bash
docker compose -f docker-compose.setup.yml run --rm --build setup
```

Il wizard chiede:

1. URL di Navidrome;
2. indirizzo e porta su cui esporre Metronomy Server;
3. username e password di un utente Navidrome;
4. percorso assoluto sul server di ogni libreria Navidrome rilevata;
5. eventuali altri utenti Navidrome;
6. se abilitare Qobuz.

### URL Navidrome

Se Navidrome gira sullo **stesso server** ed è pubblicato sulla porta `4533`, il valore consigliato è:

```text
http://host.docker.internal:4533
```

Se Navidrome gira su un altro host, inserisci il suo URL completo, per esempio:

```text
http://192.168.1.50:4533
```

### Credenziali Navidrome

La password inserita nel wizard viene usata solo per interrogare Navidrome e rilevare automaticamente le librerie accessibili. **Non viene salvata** nella configurazione di Metronomy Server.

Per ogni libreria rilevata devi indicare il percorso reale sul filesystem Linux, per esempio:

```text
/srv/media/music
```

Metronomy genera automaticamente il mapping tra ID Navidrome e mount Docker. I mount vengono creati con `create_host_path: false`: se il percorso è sbagliato, Docker fallisce invece di creare silenziosamente una directory vuota.

## 3. Qobuz opzionale

Durante il setup il wizard chiede:

```text
Vuoi abilitare Qobuz tramite qoget? [y/N]
```

Se rispondi **no**, Metronomy funziona normalmente con la sola libreria Navidrome.

Se rispondi **sì**, devi fornire il `user_auth_token` della tua sessione Qobuz. Il token è sensibile: non pubblicarlo e non inserirlo in issue, log o screenshot.

Per recuperarlo:

1. accedi a `https://play.qobuz.com`;
2. apri gli strumenti per sviluppatori del browser;
3. vai nella scheda **Network**;
4. cerca la richiesta `user/login`;
5. apri la risposta;
6. copia il valore di `user_auth_token`;
7. incollalo nel wizard.

Metronomy valida il token tramite qoget e salva la configurazione nel volume Docker persistente `metronomy-data`. Non è necessario installare qoget sull'host e il token non viene scritto nel file `.env`.

La configurazione Qobuz è attualmente **server-wide**: tutti gli utenti autorizzati dello stesso Metronomy Server usano lo stesso account Qobuz.

Il token Qobuz può scadere. Se iniziano a comparire errori `401`, rilancia il wizard e sostituisci il token.

## 4. File generati dal wizard

Il setup crea automaticamente:

```text
server/
├── .env
├── docker-compose.override.yml
├── backend/
│   └── accounts.json
└── data/
    └── trash/
```

Inoltre, se Qobuz è attivo, la configurazione qoget viene salvata nel volume Docker persistente.

Questi file contengono configurazione privata e **non devono essere committati**.

## 5. Avvia il server

```bash
docker compose up -d --build
```

Controlla lo stato:

```bash
docker compose ps
```

Controlla i log:

```bash
docker compose logs -f bridge
```

Con le impostazioni predefinite Metronomy Server è raggiungibile su:

```text
http://IP_DEL_SERVER:8180
```

Non esporre direttamente la porta `8180` su Internet in HTTP. Per l'accesso remoto usa preferibilmente una VPN oppure un reverse proxy HTTPS.

---

# Installazione di Metronomy su iPhone

## Metodo consigliato: AltStore

Aggiungi questa source ad AltStore:

```text
https://raw.githubusercontent.com/giacomo-stano/Metronomy-Music/main/altstore-source.json
```

Poi:

1. apri AltStore;
2. aggiungi la source **Metronomy**;
3. apri la scheda di Metronomy;
4. installa l'ultima versione disponibile;
5. completa la normale procedura di firma richiesta da AltStore.

Gli aggiornamenti successivi vengono pubblicati nella stessa source.

## Download diretto IPA

Le versioni pubblicate sono disponibili anche nella sezione **Releases** del repository come file `Metronomy.ipa`.

Metronomy non è distribuita tramite App Store: l'installazione richiede quindi una firma valida tramite AltStore o un sistema di sideloading equivalente.

---

# Primo accesso

Con Metronomy Server già attivo, apri l'app e inserisci:

### Bridge

```text
http://IP_DEL_SERVER:8180
```

Esempio su rete locale:

```text
http://192.168.1.50:8180
```

### Login

Usa le normali credenziali dell'utente Navidrome configurato nel wizard.

Il flusso è:

```text
Metronomy -> Metronomy Server -> autenticazione Navidrome
```

La password Navidrome non viene salvata permanentemente dal bridge. Metronomy Server crea una sessione temporanea in memoria.

Dopo il login verifica nell'ordine:

1. Home;
2. Libreria → Brani;
3. Album e artisti;
4. riproduzione;
5. artwork;
6. preferiti e playlist;
7. download offline;
8. Qobuz, se configurato.

Prima di usare funzioni che modificano o eliminano file sul server, verifica che la libreria mostrata nell'app corrisponda alla directory corretta.

---

# Verifica del backend da terminale

L'endpoint `/health` è autenticato. Una richiesta anonima può quindi rispondere:

```json
{"detail":"Sessione scaduta. Accedi nuovamente."}
```

Questo non significa che il server sia offline.

Per verificare login e sessione:

```bash
curl -sS -X POST http://IP_DEL_SERVER:8180/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"UTENTE","password":"PASSWORD_NAVIDROME"}'
```

La risposta contiene un bearer token temporaneo. Usalo quindi con:

```bash
curl -sS http://IP_DEL_SERVER:8180/health \
  -H 'Authorization: Bearer TOKEN'
```

La risposta attesa è:

```json
{"status":"ok","navidrome":"ok"}
```

---

# Modificare utenti, librerie o Qobuz

Rilancia il wizard:

```bash
cd Metronomy-Music/server
docker compose -f docker-compose.setup.yml run --rm --build setup
```

Se trova una configurazione esistente, il wizard chiede conferma prima di sostituirla e crea copie `.bak` dei file principali.

Dopo la modifica:

```bash
docker compose up -d --build
```

---

# Aggiornamento

## Metronomy Server

Dalla directory del repository:

```bash
git pull
cd server
docker compose up -d --build
```

Il volume `metronomy-data` conserva i dati persistenti, inclusa la configurazione Qobuz.

## App iOS

Se usi AltStore, gli aggiornamenti compaiono direttamente nella source Metronomy quando viene pubblicata una nuova release.

---

# Reset completo del server

Usa questa procedura solo se vuoi simulare una nuova installazione o cancellare completamente la configurazione Metronomy Server.

Dalla directory `server/`:

```bash
docker compose down --remove-orphans
```

Poi elimina il volume dati predefinito:

```bash
docker volume rm metronomy-data
```

e i file generati:

```bash
rm -f .env docker-compose.override.yml backend/accounts.json
rm -rf data
```

Questa procedura non elimina le cartelle musicali montate dall'host.

Per reinstallare:

```bash
docker compose -f docker-compose.setup.yml run --rm --build setup
docker compose up -d --build
```

---

# Troubleshooting

### L'app si connette ma Qobuz dice che qoget non è configurato

Rilancia il wizard e abilita Qobuz. Non è necessario configurare qoget manualmente sull'host.

### Qobuz restituisce errori 401

Il token Qobuz è probabilmente scaduto. Rilancia il wizard e inserisci un nuovo `user_auth_token`.

### Docker non parte dopo il setup

Controlla:

```bash
docker compose logs --tail=100 bridge
docker compose config
```

Verifica soprattutto i percorsi delle librerie inseriti nel wizard.

### Il server risponde "Sessione scaduta" su /health

È previsto per una richiesta non autenticata. Effettua prima `/auth/login` e usa il bearer token.

### L'app funziona in LAN ma non fuori casa

Il bridge deve essere raggiungibile dall'iPhone. Configura una VPN oppure un reverse proxy HTTPS. Non è consigliato esporre direttamente la porta HTTP `8180` su Internet.

---

# File privati

Non pubblicare né committare:

```text
server/.env
server/backend/accounts.json
server/docker-compose.override.yml
server/data/
```

Le credenziali Qobuz vengono conservate nel volume Docker e non nel repository.

---

# Note tecniche

Metronomy Server usa principalmente l'API Subsonic/OpenSubsonic di Navidrome. Alcune funzioni che richiedono informazioni sul filesystem utilizzano anche endpoint nativi di Navidrome: questi endpoint non sono una API pubblica stabile e possono cambiare tra versioni.

Dopo un aggiornamento importante di Navidrome è quindi consigliato verificare almeno login, browsing, streaming, download e operazioni sui file.

Il server include qoget per l'integrazione opzionale con Qobuz. Usa questa funzione solo con il tuo account e con contenuti che sei autorizzato a utilizzare.

---

# Sviluppo

Il client React Native / Expo si trova nella root del repository. Per installare le dipendenze:

```bash
npm install
```

e avviare Metro:

```bash
npx expo start
```

Alcune funzioni di Metronomy utilizzano moduli nativi e richiedono una development build completa per essere testate; Expo Go non rappresenta tutte le funzionalità della release iOS.

Il codice del server si trova in `server/`.
