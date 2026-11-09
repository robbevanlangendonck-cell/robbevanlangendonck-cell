"""Stap 1 — vinden: alle bedrijven uit jouw regio ophalen.

Standaard via OpenStreetMap (gratis, geen sleutel).
Met GOOGLE_MAPS_API_KEY gebruik je Google Maps (Places API) — meer resultaten.
"""
from __future__ import annotations

import os
import time

import requests

from .core import USER_AGENT, db, nu

# branche -> OpenStreetMap-tags
OSM_TAGS = {
    "kapper": ['"shop"="hairdresser"'],
    "barbier": ['"shop"="hairdresser"["hairdresser"="barber"]', '"shop"="barber"'],
    "schoonheidssalon": ['"shop"="beauty"'],
    "nagelstudio": ['"shop"="beauty"["beauty"="nails"]'],
    "massage": ['"shop"="massage"'],
    "tandarts": ['"amenity"="dentist"'],
    "fysiotherapeut": ['"healthcare"="physiotherapist"'],
    "restaurant": ['"amenity"="restaurant"'],
    "cafe": ['"amenity"="cafe"'],
    "garage": ['"shop"="car_repair"'],
    "fietsenmaker": ['"shop"="bicycle"'],
    "bakker": ['"shop"="bakery"'],
    "slager": ['"shop"="butcher"'],
    "bloemist": ['"shop"="florist"'],
    "sportschool": ['"leisure"="fitness_centre"'],
    "hondentrimsalon": ['"shop"="pet_grooming"'],
}

OVERPASS = "https://overpass-api.de/api/interpreter"


def _geocode(regio: str) -> tuple[float, float]:
    r = requests.get(
        "https://nominatim.openstreetmap.org/search",
        params={"q": regio, "format": "json", "limit": 1, "countrycodes": "nl,be"},
        headers={"User-Agent": USER_AGENT},
        timeout=20,
    )
    r.raise_for_status()
    data = r.json()
    if not data:
        raise SystemExit(f"Regio '{regio}' niet gevonden.")
    return float(data[0]["lat"]), float(data[0]["lon"])


def _tags_voor(branche: str) -> list[str]:
    if branche in OSM_TAGS:
        return OSM_TAGS[branche]
    if "=" in branche:  # eigen tag, bv. "shop=tattoo"
        k, v = branche.split("=", 1)
        return [f'"{k}"="{v}"']
    raise SystemExit(
        f"Onbekende branche '{branche}'. Kies uit: {', '.join(OSM_TAGS)} "
        "of geef een OSM-tag zoals shop=tattoo"
    )


def zoek_osm(regio: str, branche: str, straal_km: float) -> list[dict]:
    lat, lon = _geocode(regio)
    straal = int(straal_km * 1000)
    delen = "".join(f"nwr[{t}](around:{straal},{lat},{lon});" for t in _tags_voor(branche))
    query = f"[out:json][timeout:60];({delen});out center tags;"
    r = requests.post(OVERPASS, data={"data": query}, headers={"User-Agent": USER_AGENT}, timeout=90)
    r.raise_for_status()
    out = []
    for el in r.json().get("elements", []):
        t = el.get("tags", {})
        if not t.get("name"):
            continue
        straat = " ".join(x for x in [t.get("addr:street"), t.get("addr:housenumber")] if x)
        plaats = t.get("addr:city") or regio
        out.append(
            {
                "bron_id": f"osm:{el['type']}/{el['id']}",
                "naam": t["name"],
                "branche": branche,
                "plaats": plaats,
                "adres": ", ".join(x for x in [straat, t.get("addr:postcode"), plaats] if x),
                "website": t.get("website") or t.get("contact:website") or t.get("url"),
                "telefoon": t.get("phone") or t.get("contact:phone"),
                "email": t.get("email") or t.get("contact:email"),
                "lat": el.get("lat") or el.get("center", {}).get("lat"),
                "lon": el.get("lon") or el.get("center", {}).get("lon"),
            }
        )
    return out


def zoek_google(regio: str, branche: str, key: str) -> list[dict]:
    velden = ",".join(
        "places." + f
        for f in ["id", "displayName", "formattedAddress", "websiteUri",
                  "nationalPhoneNumber", "location", "businessStatus"]
    ) + ",nextPageToken"
    out, token = [], None
    for _ in range(3):  # max 60 resultaten per zoekopdracht
        body = {"textQuery": f"{branche} in {regio}", "languageCode": "nl"}
        if token:
            body["pageToken"] = token
        r = requests.post(
            "https://places.googleapis.com/v1/places:searchText",
            json=body,
            headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": velden},
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
        for p in data.get("places", []):
            if p.get("businessStatus", "OPERATIONAL") != "OPERATIONAL":
                continue
            loc = p.get("location", {})
            out.append(
                {
                    "bron_id": f"google:{p['id']}",
                    "naam": p.get("displayName", {}).get("text", "?"),
                    "branche": branche,
                    "plaats": regio,
                    "adres": p.get("formattedAddress"),
                    "website": p.get("websiteUri"),
                    "telefoon": p.get("nationalPhoneNumber"),
                    "email": None,
                    "lat": loc.get("latitude"),
                    "lon": loc.get("longitude"),
                }
            )
        token = data.get("nextPageToken")
        if not token:
            break
        time.sleep(2)
    return out


def run(cfg: dict, regio: str | None = None, branches: list[str] | None = None) -> int:
    regio = regio or cfg["regio"]
    branches = branches or cfg["branches"]
    key = os.environ.get("GOOGLE_MAPS_API_KEY")
    con = db()
    nieuw = 0
    for branche in branches:
        bron = "Google Maps" if key else "OpenStreetMap"
        print(f"[1/4 vinden] {branche} in {regio} via {bron} ...")
        try:
            gevonden = zoek_google(regio, branche, key) if key else zoek_osm(
                regio, branche, cfg.get("straal_km", 10))
        except requests.RequestException as e:
            print(f"  ! zoeken mislukt: {e}")
            continue
        for b in gevonden:
            cur = con.execute(
                """INSERT OR IGNORE INTO leads
                   (bron_id, naam, branche, plaats, adres, website, telefoon, email, lat, lon,
                    status, gevonden_op, bijgewerkt_op)
                   VALUES (:bron_id, :naam, :branche, :plaats, :adres, :website, :telefoon,
                           :email, :lat, :lon, 'nieuw', :t, :t)""",
                {**b, "t": nu()},
            )
            nieuw += cur.rowcount
        con.commit()
        print(f"  {len(gevonden)} gevonden")
        time.sleep(1)  # vriendelijk voor de gratis servers
    print(f"  => {nieuw} nieuwe bedrijven in je lijst")
    return nieuw
