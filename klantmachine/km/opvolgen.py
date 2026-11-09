"""Stap 4 — opvolgen: wie na X dagen niets zei, krijgt een opvolging klaargezet
en jij een seintje op je telefoon."""
from __future__ import annotations

from datetime import datetime, timedelta

from .core import db, seintje, update_lead
from .schrijven import schrijf


def run(cfg: dict) -> dict:
    con = db()
    grens = (datetime.now() - timedelta(days=cfg.get("opvolgen_na_dagen", 4))).isoformat()
    te_volgen = con.execute(
        """SELECT * FROM leads WHERE status = 'verstuurd' AND verstuurd_op <= ?
           AND opvolg_bericht IS NULL""",
        (grens,),
    ).fetchall()
    print(f"[4/4 opvolgen] {len(te_volgen)} opvolgingen klaarzetten ...")
    for lead in te_volgen:
        update_lead(con, lead["id"], opvolg_bericht=schrijf(cfg, lead, opvolging=True))
        print(f"  ↻ {lead['naam']}")

    tel = {r["status"]: r["n"] for r in con.execute(
        "SELECT status, COUNT(*) n FROM leads GROUP BY status")}
    wacht = tel.get("concept", 0)
    if wacht or te_volgen:
        seintje(
            cfg, "Klantmachine",
            f"{wacht} nieuwe berichten wachten op jouw ok\n"
            f"{len(te_volgen)} leads om op te volgen\n"
            f"{tel.get('gereageerd', 0)} reacties, {tel.get('klant', 0)} klanten",
        )
    return tel
