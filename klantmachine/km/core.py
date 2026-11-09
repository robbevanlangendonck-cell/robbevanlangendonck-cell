"""Gedeelde basis: config, database, Claude-client en meldingen."""
from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("KLANTMACHINE_DB", ROOT / "klantmachine.db"))
USER_AGENT = "klantmachine/1.0 (lokale leadtool)"

# Statussen in de volgorde van de machine
STATUSSEN = [
    "nieuw",          # 1. gevonden
    "gecheckt",       # 2. website bekeken, punt gevonden
    "concept",        # 3. bericht geschreven, wacht op jou
    "goedgekeurd",    #    jij keurde goed, nog versturen/bellen
    "verstuurd",      # 4. verstuurd / gebeld, wacht op reactie
    "gereageerd",     #    er kwam een reactie
    "klant",          #    binnen!
    "afgewezen",      #    geen interesse / niet geschikt
]


def load_env() -> None:
    """Leest .env (KEY=waarde) zonder extra pakketten."""
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if v.strip() and not os.environ.get(k.strip()):
            os.environ[k.strip()] = v.strip()


def load_config() -> dict:
    path = ROOT / "config.json"
    if not path.exists():
        path = ROOT / "config.example.json"
        print("! config.json ontbreekt, ik gebruik config.example.json (kopieer en pas aan).")
    return json.loads(path.read_text(encoding="utf-8"))


def db() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bron_id TEXT UNIQUE,
            naam TEXT NOT NULL,
            branche TEXT,
            plaats TEXT,
            adres TEXT,
            website TEXT,
            telefoon TEXT,
            email TEXT,
            lat REAL, lon REAL,
            status TEXT NOT NULL DEFAULT 'nieuw',
            punt TEXT,
            punt_uitleg TEXT,
            signalen TEXT,
            bericht TEXT,
            opvolg_bericht TEXT,
            notitie TEXT,
            gevonden_op TEXT,
            gecheckt_op TEXT,
            verstuurd_op TEXT,
            opgevolgd_op TEXT,
            bijgewerkt_op TEXT
        );
        """
    )
    return con


def nu() -> str:
    return datetime.now().isoformat(timespec="seconds")


def update_lead(con: sqlite3.Connection, lead_id: int, **velden) -> None:
    velden["bijgewerkt_op"] = nu()
    cols = ", ".join(f"{k} = ?" for k in velden)
    con.execute(f"UPDATE leads SET {cols} WHERE id = ?", [*velden.values(), lead_id])
    con.commit()


# ---------------------------------------------------------------- Claude

_client = None


def claude():
    """Geeft een Anthropic-client terug, of None als er geen sleutel is."""
    global _client
    if _client is not None:
        return _client
    if not os.environ.get("ANTHROPIC_API_KEY") and not os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        return None
    import anthropic

    _client = anthropic.Anthropic()
    return _client


def claude_json(cfg: dict, prompt: str, schema: dict, system: str = "") -> dict | None:
    """Vraagt Claude om een antwoord dat exact aan `schema` voldoet."""
    client = claude()
    if client is None:
        return None
    import anthropic

    extra = {"system": system} if system else {}
    try:
        resp = client.beta.messages.create(
            model=cfg.get("claude_model", "claude-opus-5-5"),
            max_tokens=4000,
            **extra,
            messages=[{"role": "user", "content": prompt}],
            output_config={
                "effort": "low",
                "format": {"type": "json_schema", "schema": schema},
            },
            # Bij een (onterechte) weigering automatisch een ander model laten afmaken.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.RateLimitError:
        print("  ! Claude: te veel verzoeken, sla over")
        return None
    except anthropic.APIStatusError as e:
        print(f"  ! Claude-fout {e.status_code}: {e.message}")
        return None
    except anthropic.APIConnectionError:
        print("  ! Claude niet bereikbaar")
        return None
    if resp.stop_reason in ("refusal", "max_tokens"):
        return None
    text = next((b.text for b in resp.content if b.type == "text"), None)
    return json.loads(text) if text else None


# ---------------------------------------------------------------- seintje

def seintje(cfg: dict, titel: str, tekst: str) -> None:
    """Push-melding op je telefoon via ntfy.sh (gratis app, geen account)."""
    topic = cfg.get("ntfy_topic")
    if not topic:
        return
    try:
        requests.post(
            f"https://ntfy.sh/{topic}",
            data=tekst.encode("utf-8"),
            headers={"Title": titel.encode("utf-8"), "Tags": "bell"},
            timeout=10,
        )
    except requests.RequestException as e:
        print(f"  ! seintje mislukt: {e}")
