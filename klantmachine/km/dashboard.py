"""Lokaal dashboard: berichten goedkeuren, bellen/appen/mailen en opvolgen."""
from __future__ import annotations

import json
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .core import db, nu, update_lead

HTML = (Path(__file__).parent / "dashboard.html").read_text(encoding="utf-8")

_bezig = {"stap": None, "log": ""}
_lock = threading.Lock()

ACTIES = {
    "goedkeuren": {"status": "goedgekeurd"},
    "verstuurd": {"status": "verstuurd"},
    "gereageerd": {"status": "gereageerd"},
    "klant": {"status": "klant"},
    "afwijzen": {"status": "afgewezen"},
    "terug": {"status": "concept"},
}


def _draai(cfg: dict, stap: str) -> None:
    from . import checken, opvolgen, schrijven, vinden

    try:
        if stap in ("vinden", "alles"):
            vinden.run(cfg)
        if stap in ("checken", "alles"):
            checken.run(cfg)
        if stap in ("schrijven", "alles"):
            schrijven.run(cfg)
        if stap in ("opvolgen", "alles"):
            opvolgen.run(cfg)
        _bezig["log"] = f"{stap}: klaar"
    except BaseException as e:  # ook SystemExit uit vinden
        traceback.print_exc()
        _bezig["log"] = f"{stap}: fout — {e}"
    finally:
        _bezig["stap"] = None
        _lock.release()


def maak_handler(cfg: dict):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _json(self, data, code=200):
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/":
                body = HTML.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            elif self.path == "/api/leads":
                rows = [dict(r) for r in db().execute(
                    "SELECT * FROM leads ORDER BY bijgewerkt_op DESC, id DESC")]
                self._json({"leads": rows, "bezig": _bezig, "afzender": cfg.get("jouw_naam", "")})
            else:
                self._json({"fout": "niet gevonden"}, 404)

        def do_POST(self):
            lengte = int(self.headers.get("Content-Length") or 0)
            data = json.loads(self.rfile.read(lengte) or b"{}")
            delen = self.path.strip("/").split("/")
            if delen[:2] == ["api", "run"] and len(delen) == 3:
                stap = delen[2]
                if stap not in ("vinden", "checken", "schrijven", "opvolgen", "alles"):
                    return self._json({"fout": "onbekende stap"}, 400)
                if not _lock.acquire(blocking=False):
                    return self._json({"fout": "er draait al een stap"}, 409)
                _bezig.update(stap=stap, log=f"{stap}: bezig ...")
                threading.Thread(target=_draai, args=(cfg, stap), daemon=True).start()
                return self._json({"ok": True})
            if delen[:2] == ["api", "lead"] and len(delen) == 3:
                con = db()
                lead_id = int(delen[2])
                actie = data.get("actie")
                velden = {}
                if "bericht" in data:
                    velden["bericht"] = data["bericht"]
                if "opvolg_bericht" in data:
                    velden["opvolg_bericht"] = data["opvolg_bericht"]
                if "notitie" in data:
                    velden["notitie"] = data["notitie"]
                if actie in ACTIES:
                    velden.update(ACTIES[actie])
                    if actie == "verstuurd":
                        velden["verstuurd_op"] = nu()
                elif actie == "opgevolgd":
                    # opvolging verstuurd: klok opnieuw starten
                    velden.update(verstuurd_op=nu(), opgevolgd_op=nu(), opvolg_bericht=None)
                    oud = con.execute("SELECT bericht, opvolg_bericht FROM leads WHERE id=?",
                                      (lead_id,)).fetchone()
                    if oud and oud["opvolg_bericht"]:
                        velden["bericht"] = oud["opvolg_bericht"]
                elif actie not in (None, "opslaan"):
                    return self._json({"fout": "onbekende actie"}, 400)
                if velden:
                    update_lead(con, lead_id, **velden)
                return self._json({"ok": True})
            self._json({"fout": "niet gevonden"}, 404)

    return H


def run(cfg: dict, poort: int = 8000) -> None:
    db()
    server = ThreadingHTTPServer(("127.0.0.1", poort), maak_handler(cfg))
    print(f"Klantmachine-dashboard: http://localhost:{poort}  (Ctrl+C om te stoppen)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
