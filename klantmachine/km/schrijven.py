"""Stap 3 — schrijven: per bedrijf één persoonlijk bericht. Jij beslist."""
from __future__ import annotations

from .core import claude_json, db, update_lead

BERICHT_SCHEMA = {
    "type": "object",
    "properties": {"bericht": {"type": "string"}},
    "required": ["bericht"],
    "additionalProperties": False,
}

SJABLONEN = {
    "geen boekknop": "Hoi! Op jullie site kun je nog geen afspraak boeken. Ik heb een idee hoe je dat "
                     "in één middag regelt. Mag ik het laten zien?",
    "geen website": "Hoi! Ik zocht {naam} online maar vond geen eigen website. Mensen in {plaats} "
                    "zoeken wel zo. Zal ik laten zien hoe dat er voor jullie uit kan zien?",
    "alleen social media": "Hoi! Ik zag dat {naam} vooral via social media te vinden is. Met een "
                           "eigen site vinden nieuwe klanten jullie via Google. Mag ik een voorbeeld sturen?",
    "website werkt niet": "Hoi! Ik probeerde jullie website te openen maar die laadt niet. Wist je dat al? "
                          "Ik kan helpen het snel op te lossen.",
}
STANDAARD = ("Hoi! Ik keek even naar de website van {naam}: {uitleg_klein} Ik heb een idee hoe je dat "
             "snel oplost. Mag ik het laten zien?")


def sjabloon(lead) -> str:
    t = SJABLONEN.get((lead["punt"] or "").lower(), STANDAARD)
    uitleg = (lead["punt_uitleg"] or "").strip()
    return t.format(naam=lead["naam"], plaats=lead["plaats"] or "de buurt",
                    uitleg_klein=uitleg[:1].lower() + uitleg[1:])


def schrijf(cfg: dict, lead, opvolging: bool = False) -> str:
    if opvolging:
        opdracht = (f"Je stuurde eerder dit bericht en kreeg geen reactie:\n\"{lead['bericht']}\"\n"
                    "Schrijf een korte, luchtige opvolging (max 2 zinnen). Niet opdringerig, "
                    "geen schuldgevoel, maak het makkelijk om ja of nee te zeggen.")
    else:
        opdracht = ("Schrijf één kort eerste bericht (WhatsApp/e-mail, max 3 zinnen) aan dit bedrijf. "
                    "Noem het punt concreet, bied een oplossing aan, eindig met een kleine vraag "
                    "(bv. 'Mag ik het laten zien?'). Begin met 'Hoi!' of de naam van de zaak.")
    prompt = f"""Afzender: {cfg['jouw_naam']} van {cfg['jouw_bedrijf']}.
Aanbod: {cfg['jouw_aanbod']}
Toon: {cfg.get('toon', 'vriendelijk en kort')}

Ontvanger: {lead['naam']} ({lead['branche']}, {lead['plaats']})
Gevonden punt op hun website: {lead['punt']} — {lead['punt_uitleg']}

{opdracht}
Schrijf in het Nederlands, als een echt mens: geen 'Ik hoop dat dit bericht je goed bereikt',
geen uitroeptekens-spam, geen emoji's, geen prijzen, niets verzinnen. Alleen de berichttekst."""
    data = claude_json(cfg, prompt, BERICHT_SCHEMA)
    if data and data["bericht"].strip():
        return data["bericht"].strip()
    if opvolging:
        return "Hoi! Even een vriendelijk duwtje: zal ik het voorbeeld sturen? Een kort ja of nee is ook prima."
    return sjabloon(lead)


def run(cfg: dict) -> int:
    con = db()
    leads = con.execute("SELECT * FROM leads WHERE status = 'gecheckt' ORDER BY id").fetchall()
    print(f"[3/4 schrijven] {len(leads)} berichten schrijven ...")
    for lead in leads:
        bericht = schrijf(cfg, lead)
        update_lead(con, lead["id"], status="concept", bericht=bericht)
        print(f"  ✎ {lead['naam']}")
    return len(leads)
