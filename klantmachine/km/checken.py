"""Stap 2 — checken: elke website openen en één verbeterpunt vinden."""
from __future__ import annotations

import html
import re
from datetime import date
from urllib.parse import urlparse

import requests

from .core import claude_json, db, nu, update_lead

BOEK_SYSTEMEN = [
    "salonized", "treatwell", "salonkee", "planway", "booksy", "fresha", "calendly",
    "setmore", "simplybook", "timify", "onlineafspraken", "afspraakplanner", "shore.com",
    "phorest", "acuityscheduling", "squareup.com/appointments", "zenchef", "resengo",
    "formitable", "thefork", "opentable", "bookingkit", "clinicminds", "mijnafspraakonline",
    "tebi", "zappointment", "afspraakmaken.nl", "boekingsmodule", "bookingwidget",
]
BOEK_WOORDEN = [
    "online afspraak", "afspraak maken", "afspraak boeken", "boek nu", "boek online",
    "online boeken", "reserveer", "reserveren", "plan je afspraak", "book now",
    "maak een afspraak", "direct boeken",
]
SOCIAL = ("facebook.com", "instagram.com", "linktr.ee", "tiktok.com")

PUNT_SCHEMA = {
    "type": "object",
    "properties": {
        "geschikt": {"type": "boolean",
                     "description": "true als er een concreet punt is waar het aanbod bij helpt"},
        "punt": {"type": "string", "description": "het ene punt, max 6 woorden, bv. 'geen boekknop'"},
        "uitleg": {"type": "string",
                   "description": "1-2 zinnen: wat je zag op de site en waarom het ze klanten kost"},
    },
    "required": ["geschikt", "punt", "uitleg"],
    "additionalProperties": False,
}


def _normaliseer(url: str) -> str:
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        url = "http://" + url
    return url


def _tekst(html_src: str) -> str:
    s = re.sub(r"(?is)<(script|style|noscript|svg).*?</\1>", " ", html_src)
    s = re.sub(r"(?s)<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def pagespeed(url: str) -> int | None:
    """Mobiele snelheidsscore 0-100 via Google PageSpeed (gratis, soms traag)."""
    try:
        r = requests.get(
            "https://www.googleapis.com/pagespeedonline/v5/runPagespeed",
            params={"url": url, "strategy": "mobile", "category": "performance"},
            timeout=90,
        )
        r.raise_for_status()
        score = r.json()["lighthouseResult"]["categories"]["performance"]["score"]
        return round(score * 100) if score is not None else None
    except (requests.RequestException, KeyError, ValueError):
        return None


def signalen(website: str | None, met_pagespeed: bool = False) -> dict:
    """Verzamelt feiten over de website (zonder AI)."""
    s: dict = {"website": website}
    if not website:
        s["geen_website"] = True
        return s
    url = _normaliseer(website)
    if any(d in urlparse(url).netloc for d in SOCIAL):
        s["alleen_social"] = True
        return s
    try:
        r = requests.get(url, timeout=20, headers={
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile"})
        r.raise_for_status()
    except requests.RequestException as e:
        s["kapot"] = str(e)[:160]
        return s
    src = r.text
    laag = src.lower()
    tekst = _tekst(src)
    s["eind_url"] = r.url
    s["https"] = r.url.startswith("https://")
    s["mobiel_viewport"] = 'name="viewport"' in laag or "name='viewport'" in laag
    s["boeksysteem"] = next((b for b in BOEK_SYSTEMEN if b in laag), None)
    s["boekwoorden"] = [w for w in BOEK_WOORDEN if w in tekst.lower()]
    s["tel_link"] = "href=\"tel:" in laag or "href='tel:" in laag
    s["whatsapp"] = "wa.me/" in laag or "api.whatsapp.com" in laag
    jaren = [int(j) for j in re.findall(r"(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(20\d\d)", laag)]
    if jaren:
        s["copyright_jaar"] = max(jaren)
    mails = sorted(set(re.findall(r"mailto:([\w.+-]+@[\w-]+\.[\w.-]+)", src, re.I)))
    if mails:
        s["emails"] = mails[:3]
    s["tekst_fragment"] = tekst[:5000]
    if met_pagespeed:
        s["pagespeed_mobiel"] = pagespeed(r.url)
    return s


def punt_zonder_ai(s: dict) -> tuple[bool, str, str]:
    """Kiest het belangrijkste punt met vaste regels."""
    if s.get("geen_website"):
        return True, "geen website", "Ze hebben geen eigen website; wie online zoekt, vindt ze niet."
    if s.get("alleen_social"):
        return True, "alleen social media", "Hun 'website' is een social-mediapagina; geen eigen site."
    if s.get("kapot"):
        return True, "website werkt niet", "De website laadt niet; bezoekers zien een foutmelding."
    if not s.get("boeksysteem") and not s.get("boekwoorden"):
        return True, "geen boekknop", "Op de site kun je nergens online een afspraak maken."
    if not s.get("mobiel_viewport"):
        return True, "niet mobielvriendelijk", "De site is niet gemaakt voor de telefoon."
    if s.get("pagespeed_mobiel") is not None and s["pagespeed_mobiel"] < 50:
        return True, "trage website", f"Mobiele snelheidsscore {s['pagespeed_mobiel']}/100."
    if not s.get("https"):
        return True, "geen beveiligde verbinding", "De site draait zonder https; browsers tonen 'niet veilig'."
    if s.get("copyright_jaar") and s["copyright_jaar"] < date.today().year - 4:
        return True, "verouderde website", f"De site lijkt sinds {s['copyright_jaar']} niet bijgewerkt."
    return False, "geen duidelijk punt", "Website ziet er op orde uit."


def punt_met_ai(cfg: dict, lead, s: dict) -> tuple[bool, str, str] | None:
    feiten = {k: v for k, v in s.items() if k != "tekst_fragment"}
    prompt = f"""Je helpt een ondernemer klanten te vinden.
Zijn aanbod: {cfg['jouw_aanbod']}

Bedrijf: {lead['naam']} ({lead['branche']}, {lead['plaats']})
Automatisch verzamelde feiten over hun website:
{feiten}

Zichtbare tekst van de homepage (eerste deel):
<site>
{s.get('tekst_fragment', '(geen)')}
</site>

Kies het ÉNE punt op deze website dat het bedrijf het meest klanten kost én waar het aanbod
bij helpt. Wees concreet en eerlijk: verzin niets wat niet uit de feiten of tekst blijkt.
Een woord als 'afspraak maken' naast alleen een telefoonnummer is géén online boekknop.
Is er geen overtuigend punt, zet geschikt op false."""
    data = claude_json(cfg, prompt, PUNT_SCHEMA)
    if not data:
        return None
    return data["geschikt"], data["punt"], data["uitleg"]


def run(cfg: dict, limiet: int | None = None, met_pagespeed: bool = False) -> int:
    con = db()
    leads = con.execute(
        "SELECT * FROM leads WHERE status = 'nieuw' ORDER BY id LIMIT ?",
        (limiet or cfg.get("max_nieuwe_per_nacht", 25),),
    ).fetchall()
    print(f"[2/4 checken] {len(leads)} websites openen ...")
    for lead in leads:
        s = signalen(lead["website"], met_pagespeed)
        uitslag = None
        if not (s.get("geen_website") or s.get("alleen_social") or s.get("kapot")):
            uitslag = punt_met_ai(cfg, lead, s)
        geschikt, punt, uitleg = uitslag or punt_zonder_ai(s)
        email = lead["email"] or (s.get("emails") or [None])[0]
        s.pop("tekst_fragment", None)
        update_lead(
            con, lead["id"],
            status="gecheckt" if geschikt else "afgewezen",
            punt=punt, punt_uitleg=uitleg, signalen=repr(s), email=email,
            notitie=None if geschikt else "machine: geen duidelijk punt gevonden",
            gecheckt_op=nu(),
        )
        print(f"  {'✓' if geschikt else '–'} {lead['naam']}: {punt}")
    return len(leads)
