# Klantmachine

Elke nacht nieuwe klanten klaarzetten, in vier stappen:

| Stap | Wat gebeurt er | Hoe |
|---|---|---|
| **1. vinden** | Alle bedrijven uit jouw regio (bv. kappers in Zeist) komen in een lijst: naam, adres, website, telefoon. | OpenStreetMap (gratis, geen account) of Google Maps (met eigen sleutel) |
| **2. checken** | Elke website wordt geopend en er komt **één punt** uit, bv. *geen boekknop*, *geen website*, *niet mobielvriendelijk*. | Vaste regels + Claude die de site leest |
| **3. schrijven** | Per bedrijf één kort, persoonlijk bericht. **Jij beslist**: goedkeuren, aanpassen of afwijzen. | Claude (of een sjabloon zonder sleutel) |
| **4. opvolgen** | Geen reactie na X dagen? Er staat een opvolgbericht klaar en je krijgt een **seintje op je telefoon**. | ntfy-app (gratis) |

Alles draait op je eigen computer. De lijst staat in `klantmachine.db`.

## Installeren (eenmalig)

Je hebt Python 3.10 of nieuwer nodig.

```bash
cd klantmachine
pip install -r requirements.txt
cp config.example.json config.json     # en vul je eigen gegevens in
cp .env.example .env                    # optioneel: sleutels
```

In `config.json` zet je:

- `regio`, `straal_km` en `branches`, zoals `["kapper", "barbier", "schoonheidssalon"]`. Mogelijk zijn: kapper, barbier, schoonheidssalon, nagelstudio, massage, tandarts, fysiotherapeut, restaurant, cafe, garage, fietsenmaker, bakker, slager, bloemist, sportschool, hondentrimsalon. Een eigen OpenStreetMap-tag kan ook, bv. `"shop=tattoo"`.
- `jouw_naam`, `jouw_bedrijf`, `jouw_aanbod` en `toon`: hiermee worden de berichten geschreven.
- `opvolgen_na_dagen`: na hoeveel dagen zonder reactie je opvolgt.
- `ntfy_topic`: een geheime naam die je zelf verzint (bv. `klantmachine-robbe-8f3k2`). Installeer de gratis app **ntfy** op je telefoon en abonneer je op diezelfde naam.

In `.env` (beide optioneel):

- `ANTHROPIC_API_KEY`: met deze sleutel leest Claude de websites en schrijft hij de berichten. Zonder sleutel werkt alles ook, maar dan met vaste regels en sjablonen. Kosten: een paar cent per bedrijf. Wil je het goedkoper, zet dan `"claude_model": "claude-haiku-5-5"` in `config.json`.
- `GOOGLE_MAPS_API_KEY`: zoekt via Google Maps (Places API) in plaats van OpenStreetMap. Daarmee vind je meestal meer bedrijven. Google geeft maandelijks gratis tegoed.

## Gebruiken

```bash
python -m km dashboard          # opent je overzicht op http://localhost:8000
```

In het dashboard druk je op **▶ hele machine draaien**. Daarna:

1. Tabblad **wacht op jou**: lees het bericht, pas het eventueel aan en kies **goedkeuren** of **afwijzen**.
2. Tabblad **nog versturen**: kies **bellen**, **whatsapp** (opent met het bericht al ingevuld) of **mail**, en daarna **verstuurd / gebeld**.
3. Tabblad **opvolgen**: hier staat een opvolgbericht klaar voor wie niet reageerde.
4. Kreeg je een reactie, kies dan **reageerde**. Wordt het iets, kies dan **klant!**

De stappen kun je ook los draaien:

```bash
python -m km vinden --regio Utrecht --branche kapper barbier
python -m km checken --pagespeed     # meet ook de mobiele snelheid (trager)
python -m km schrijven
python -m km opvolgen
python -m km lijst                   # stand van zaken
```

## Elke nacht automatisch

**Mac / Linux**: open `crontab -e` en voeg toe (pas het pad aan):

```
0 2 * * * cd /pad/naar/klantmachine && /usr/bin/python3 -m km nacht >> nacht.log 2>&1
```

**Windows**: maak in Taakplanner een taak die dagelijks om 02:00 dit uitvoert: `python -m km nacht`, met als map `klantmachine`.

Je computer moet dan wel aanstaan. 's Ochtends krijg je een seintje met het aantal berichten dat op jou wacht.

## Goed om te weten

- Stuur niet zomaar massaal: de machine schrijft, maar **jij** keurt elk bericht goed. Zo blijft het persoonlijk en voorkom je spam.
- Let op met ongevraagde e-mail: veel kappers en salons zijn een eenmanszaak, en die mag je in Nederland en België niet zomaar ongevraagd mailen. Bellen of langsgaan is veiliger en werkt vaak beter. Twijfel je, kijk dan op acm.nl (NL) of bij de FOD Economie (BE). Wie "nee" zegt, zet je op **afwijzen**.
- Bedrijven zonder telefoon of e-mail in de lijst: zoek die gegevens even op hun site of op Google.
