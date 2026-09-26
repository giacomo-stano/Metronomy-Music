# Metronomy Server

Componente self-hosted di Metronomy. Collega il client iOS a Navidrome e, opzionalmente, a Qobuz tramite qoget.

La guida completa per una nuova installazione — server, configurazione Navidrome/Qobuz, app iOS, aggiornamenti, reset e troubleshooting — è nel [README principale](../README.md).

## Avvio rapido

```bash
docker compose -f docker-compose.setup.yml run --rm --build setup
docker compose up -d --build
```

Il wizard genera automaticamente `.env`, `backend/accounts.json`, `docker-compose.override.yml` e i mount delle librerie.

Non committare i file generati o i dati runtime.
