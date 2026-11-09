"""Klantmachine — gebruik:

  python -m km vinden [--regio Zeist] [--branche kapper ...]
  python -m km checken [--limiet 25] [--pagespeed]
  python -m km schrijven
  python -m km opvolgen
  python -m km nacht            # alle 4 stappen achter elkaar (voor de nachtelijke cron)
  python -m km dashboard        # http://localhost:8000
  python -m km lijst            # korte stand van zaken
"""
from __future__ import annotations

import argparse

from . import checken, dashboard, opvolgen, schrijven, vinden
from .core import STATUSSEN, claude, db, load_config, load_env


def main() -> None:
    load_env()
    p = argparse.ArgumentParser(prog="km", description="Klantmachine in vier stappen")
    sub = p.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("vinden")
    v.add_argument("--regio")
    v.add_argument("--branche", nargs="+")
    c = sub.add_parser("checken")
    c.add_argument("--limiet", type=int)
    c.add_argument("--pagespeed", action="store_true", help="ook mobiele snelheid meten")
    sub.add_parser("schrijven")
    sub.add_parser("opvolgen")
    n = sub.add_parser("nacht")
    n.add_argument("--pagespeed", action="store_true")
    d = sub.add_parser("dashboard")
    d.add_argument("--poort", type=int, default=8000)
    sub.add_parser("lijst")
    a = p.parse_args()
    cfg = load_config()

    if a.cmd in ("checken", "schrijven", "opvolgen", "nacht") and claude() is None:
        print("i Geen ANTHROPIC_API_KEY: ik gebruik vaste regels en sjablonen (werkt ook, minder persoonlijk).")

    if a.cmd == "vinden":
        vinden.run(cfg, a.regio, a.branche)
    elif a.cmd == "checken":
        checken.run(cfg, a.limiet, a.pagespeed)
    elif a.cmd == "schrijven":
        schrijven.run(cfg)
    elif a.cmd == "opvolgen":
        opvolgen.run(cfg)
    elif a.cmd == "nacht":
        vinden.run(cfg)
        checken.run(cfg, met_pagespeed=a.pagespeed)
        schrijven.run(cfg)
        opvolgen.run(cfg)
    elif a.cmd == "dashboard":
        dashboard.run(cfg, a.poort)
    elif a.cmd == "lijst":
        tel = {r["status"]: r["n"] for r in db().execute(
            "SELECT status, COUNT(*) n FROM leads GROUP BY status")}
        for s in STATUSSEN:
            print(f"  {s:<12} {tel.get(s, 0)}")


if __name__ == "__main__":
    main()
