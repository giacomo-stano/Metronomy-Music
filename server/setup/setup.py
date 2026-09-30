#!/usr/bin/env python3
"""Interactive first-run configuration for Metronomy Bridge.

Runs in a disposable Docker container. Navidrome passwords are used only to
query getMusicFolders and are never written to disk.
"""
from __future__ import annotations

import getpass
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
ACCOUNTS_PATH = ROOT / "backend" / "accounts.json"
OVERRIDE_PATH = ROOT / "docker-compose.override.yml"
TRASH_PATH = ROOT / "data" / "trash"
QOGET_CONFIG_PATH = Path(os.environ.get("QOGET_CONFIG", "/data/config/qoget/config.json"))


def say(message: str = "") -> None:
    print(message, flush=True)


def ask(prompt: str, default: str | None = None, secret: bool = False) -> str:
    suffix = f" [{default}]" if default else ""
    while True:
        value = (getpass.getpass if secret else input)(f"{prompt}{suffix}: ").strip()
        if value:
            return value
        if default is not None:
            return default
        say("Valore obbligatorio.")


def yes_no(prompt: str, default: bool = False) -> bool:
    suffix = " [Y/n]" if default else " [y/N]"
    while True:
        value = input(prompt + suffix + ": ").strip().lower()
        if not value:
            return default
        if value in {"y", "yes", "s", "si", "sì"}:
            return True
        if value in {"n", "no"}:
            return False
        say("Rispondi sì o no.")


def normalize_url(raw: str) -> str:
    raw = raw.strip().rstrip("/")
    parsed = urllib.parse.urlsplit(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("usa un URL completo, per esempio http://host.docker.internal:4533")
    hostname = parsed.hostname
    if hostname in {"localhost", "127.0.0.1", "::1"}:
        port = f":{parsed.port}" if parsed.port else ""
        netloc = f"host.docker.internal{port}"
        if parsed.username or parsed.password:
            raise ValueError("non inserire credenziali nell'URL")
        parsed = parsed._replace(netloc=netloc)
    if parsed.username or parsed.password:
        raise ValueError("non inserire credenziali nell'URL")
    return urllib.parse.urlunsplit(parsed)


def get_music_folders(base_url: str, username: str, password: str) -> list[dict]:
    salt = secrets.token_hex(12)
    token = hashlib.md5((password + salt).encode()).hexdigest()
    params = urllib.parse.urlencode({
        "u": username,
        "t": token,
        "s": salt,
        "v": "1.16.1",
        "c": "metronomy-setup",
        "f": "json",
    })
    url = f"{base_url}/rest/getMusicFolders.view?{params}"
    request = urllib.request.Request(url, headers={"User-Agent": "Metronomy-Setup/1"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))["subsonic-response"]
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError) as exc:
        raise RuntimeError("Navidrome non raggiungibile o risposta non valida") from exc
    if payload.get("status") != "ok":
        error = payload.get("error") or {}
        code = error.get("code")
        if code in (40, 41):
            raise RuntimeError("credenziali Navidrome non valide")
        raise RuntimeError(error.get("message") or "Navidrome ha rifiutato la richiesta")
    folders = payload.get("musicFolders", {}).get("musicFolder", [])
    if not isinstance(folders, list) or not folders:
        raise RuntimeError("questo account Navidrome non vede alcuna libreria musicale")
    clean = []
    for folder in folders:
        library_id = str(folder.get("id", ""))
        if not library_id.isdigit():
            raise RuntimeError("Navidrome ha restituito un ID libreria non supportato")
        clean.append({"id": library_id, "name": str(folder.get("name") or f"Library {library_id}")})
    return clean


def host_directory(prompt: str) -> str:
    # The wizard itself runs in a disposable container, so arbitrary host paths
    # are intentionally not mounted here and cannot be stat()'d safely. Docker
    # validates them later with create_host_path=false.
    while True:
        raw = ask(prompt)
        value = PurePosixPath(raw)
        if not value.is_absolute() or raw == "/" or ".." in value.parts:
            say("Inserisci un percorso assoluto Linux valido, per esempio /srv/media/music.")
            continue
        return str(value)


def safe_key(name: str, library_id: str, used: set[str]) -> str:
    value = re.sub(r"[^A-Za-z0-9_]", "_", name.strip()).strip("_").lower()
    if not value or value[0].isdigit():
        value = "library_" + library_id
    value = value[:48]
    candidate = value
    counter = 2
    while candidate in used:
        candidate = f"{value}_{counter}"
        counter += 1
    return candidate


def yaml_string(value: str) -> str:
    # JSON strings are valid YAML strings and safely handle spaces/colon/backslashes.
    return json.dumps(value, ensure_ascii=False)


def atomic_write(path: Path, text: str, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp_name, mode)
        os.replace(temp_name, path)
    finally:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass


def backup_existing() -> None:
    existing = [p for p in (ENV_PATH, ACCOUNTS_PATH, OVERRIDE_PATH) if p.exists()]
    if not existing:
        return
    say("\nÈ già presente una configurazione Metronomy:")
    for path in existing:
        say(f"  - {path.relative_to(ROOT)}")
    if not yes_no("Vuoi sostituirla? Verrà creata una copia .bak", default=False):
        raise SystemExit("Configurazione lasciata invariata.")
    for path in existing:
        shutil.copy2(path, path.with_suffix(path.suffix + ".bak"))


def validate_no_overlap(paths: dict[str, str]) -> None:
    values = [(name, PurePosixPath(value)) for name, value in paths.items()]
    for i, (a_name, a) in enumerate(values):
        for b_name, b in values[i + 1:]:
            if a == b or a in b.parents or b in a.parents:
                raise RuntimeError(f'Le librerie "{a_name}" e "{b_name}" usano cartelle host uguali o annidate.')



def configure_qobuz() -> bool:
    """Optionally configure the server-wide qoget/Qobuz account."""
    existing = QOGET_CONFIG_PATH.is_file()
    if existing:
        say("\nÈ già presente una configurazione Qobuz/qoget persistente.")

    enabled = yes_no("Vuoi abilitare Qobuz tramite qoget?", default=existing)
    if not enabled:
        if existing and yes_no("Vuoi rimuovere anche l'account Qobuz già configurato?", default=False):
            try:
                QOGET_CONFIG_PATH.unlink()
                say("Account Qobuz rimosso.")
            except OSError as exc:
                raise RuntimeError(f"impossibile rimuovere la configurazione qoget: {exc}") from exc
        return False

    if existing and not yes_no("Vuoi sostituire l'account Qobuz esistente?", default=False):
        say("Configurazione Qobuz esistente mantenuta.")
        return True

    say("\nQobuz non accetta più il login email/password dai client di terze parti.")
    say("Serve il user_auth_token della tua sessione web Qobuz:")
    say("  1. Accedi a https://play.qobuz.com dal browser.")
    say("  2. Apri Strumenti sviluppatore > Network e filtra user/login.")
    say("  3. Ricarica la pagina di login e apri la risposta della richiesta login.")
    say("  4. Copia il valore user_auth_token e incollalo qui sotto.")
    say("Il token viene salvato solo nel volume dati Metronomy e non in .env.\n")

    while True:
        token = ask("Qobuz user_auth_token", secret=True)
        QOGET_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        env = {**os.environ, "QOGET_CONFIG": str(QOGET_CONFIG_PATH)}
        try:
            result = subprocess.run(
                ["qoget", "login"],
                input=token + "\n",
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                env=env,
                timeout=30,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise RuntimeError("qoget non è disponibile o Qobuz non ha risposto in tempo") from exc
        finally:
            token = ""

        if result.returncode == 0 and QOGET_CONFIG_PATH.is_file():
            try:
                os.chmod(QOGET_CONFIG_PATH, 0o600)
            except OSError:
                pass
            say("Account Qobuz verificato e configurato.")
            return True

        message = (result.stdout or "").strip()
        if message:
            say("qoget: " + message.splitlines()[-1][:300])
        say("Token Qobuz non valido o scaduto.")
        if not yes_no("Vuoi riprovare?", default=True):
            return False


def main() -> int:
    say("Metronomy Bridge — configurazione iniziale")
    say("Le password Navidrome servono solo per rilevare le librerie e non vengono salvate.\n")
    backup_existing()

    while True:
        try:
            navidrome_url = normalize_url(ask("URL Navidrome raggiungibile dal container", "http://host.docker.internal:4533"))
            break
        except ValueError as exc:
            say(f"URL non valido: {exc}")

    bind_address = ask("Indirizzo su cui esporre Metronomy", "0.0.0.0")
    port = ask("Porta Metronomy", "8180")
    if not port.isdigit() or not (1 <= int(port) <= 65535):
        raise SystemExit("Porta non valida.")

    users: dict[str, list[str]] = {}
    destinations: dict[str, dict] = {}
    host_paths: dict[str, str] = {}
    by_library_id: dict[str, str] = {}

    say("\nConfigura almeno un utente Navidrome.")
    while True:
        username = ask("Username Navidrome")
        if username in users:
            say("Questo utente è già stato aggiunto.")
            continue
        password = ask("Password Navidrome", secret=True)
        try:
            folders = get_music_folders(navidrome_url, username, password)
        except RuntimeError as exc:
            say(f"Errore: {exc}.")
            if yes_no("Vuoi riprovare questo utente?", default=True):
                continue
            if users:
                break
            continue

        say(f"Librerie visibili a {username}:")
        for folder in folders:
            say(f"  - {folder['name']} (rilevata automaticamente)")

        allowed: list[str] = []
        for folder in folders:
            library_id = folder["id"]
            if library_id in by_library_id:
                key = by_library_id[library_id]
                say(f"  {folder['name']}: usa il mapping già configurato.")
            else:
                key = safe_key(folder["name"], library_id, set(destinations))
                path = host_directory(f'Percorso sul server della libreria "{folder["name"]}"')
                destinations[key] = {
                    "label": folder["name"],
                    "library_id": int(library_id),
                    "root": f"/libraries/{key}",
                }
                host_paths[key] = path
                by_library_id[library_id] = key
            allowed.append(key)
        users[username] = allowed

        # Remove the password reference as soon as this iteration is complete.
        password = ""
        if not yes_no("Vuoi aggiungere un altro utente Navidrome?", default=False):
            break

    if not users or not destinations:
        raise SystemExit("Configurazione annullata: serve almeno un utente e una libreria.")

    TRASH_PATH.mkdir(parents=True, exist_ok=True)
    try:
        validate_no_overlap(host_paths)
    except RuntimeError as exc:
        raise SystemExit(str(exc)) from None

    try:
        qobuz_enabled = configure_qobuz()
    except RuntimeError as exc:
        raise SystemExit(f"Configurazione Qobuz fallita: {exc}") from None

    secret = secrets.token_hex(32)
    env_text = f"""# Generated by Metronomy setup. Do not commit this file.\nMETRONOMY_BIND_ADDRESS={bind_address}\nMETRONOMY_PORT={port}\nNAVIDROME_URL={navidrome_url}\nMULTI_USER=true\nAPP_API_KEY={secret}\nMETRONOMY_TRASH_PATH=./data/trash\nMETRONOMY_DATA_VOLUME=metronomy-data\nQOBUZ_ENABLED={str(qobuz_enabled).lower()}\n"""
    accounts_text = json.dumps({"users": users, "destinations": destinations}, ensure_ascii=False, indent=2) + "\n"

    override_lines = [
        "# Generated by setup/setup.py. Do not edit library IDs by hand.",
        "services:",
        "  bridge:",
        "    volumes:",
    ]
    for key, path in host_paths.items():
        override_lines.extend([
            "      - type: bind",
            f"        source: {yaml_string(path)}",
            f"        target: {yaml_string('/libraries/' + key)}",
            "        bind:",
            "          create_host_path: false",
        ])
    override_text = "\n".join(override_lines) + "\n"

    atomic_write(ENV_PATH, env_text, 0o600)
    atomic_write(ACCOUNTS_PATH, accounts_text, 0o600)
    atomic_write(OVERRIDE_PATH, override_text, 0o600)

    # Keep generated files owned like the checked-out project when possible.
    try:
        owner = ROOT.stat()
        for path in (ENV_PATH, ACCOUNTS_PATH, OVERRIDE_PATH):
            os.chown(path, owner.st_uid, owner.st_gid)
    except (OSError, PermissionError):
        pass

    say("\nConfigurazione completata.")
    say(f"  Utenti: {', '.join(users)}")
    say(f"  Librerie: {', '.join(d['label'] for d in destinations.values())}")
    say(f"  Qobuz: {'abilitato' if qobuz_enabled else 'non configurato'}")
    say(f"  Endpoint: http://SERVER_IP:{port}")
    say("\nOra avvia il backend con:")
    say("  docker compose up -d --build")
    say("\nPoi controlla i log con:")
    say("  docker compose logs -f bridge")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        say("\nConfigurazione annullata.")
        raise SystemExit(130)
