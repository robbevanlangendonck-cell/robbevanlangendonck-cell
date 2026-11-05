# Salonwebsite met Salonized-boeking

Een kleine website (gewone HTML, CSS en JavaScript, zonder build-stap) met een reserveerpagina waarop de online agenda van Salonized staat.

## Hoe het werkt

- Salonized bewaart je agenda en afspraken. De website toont alleen die agenda.
- Op `reserveren.html` laadt `script.js` je Salonized-agenda in een venster (iframe). Klanten boeken dus echt bij Salonized, en de afspraak staat meteen in jouw agenda.
- Elke knop "Reserveer" op de site gaat naar `reserveren.html`.
- Laadt de agenda niet binnen 14 seconden, dan ziet de bezoeker een melding met een knop om de agenda in een nieuw tabblad te openen en je telefoonnummer.
- Zolang de koppeling niet is ingevuld, ziet de bezoeker "Online boeken kan binnenkort" met je telefoonnummer.

Salonized heeft geen publieke API. Hun widget is de officiële manier om online boeken op je eigen site te zetten.

## 1. Salonized koppelen

1. Log in op Salonized en ga naar **Instellingen → Online boekingen → Styling en delen**.
2. Zoek je eigen boekingslink. Die begint met `https://<jouwaccount>.salonized.com/`.
3. Open `script.js` en vul bovenaan je accountnaam in:

   ```js
   const SALONIZED_URL = 'https://jouwaccount.salonized.com/widget_bookings/new';
   ```

4. Vervang ook `[ACCOUNT]` in het `<noscript>`-blok van `reserveren.html`.
5. Open `reserveren.html` in je browser en controleer of de agenda verschijnt.

Stel in Salonized ook je hoofdkleur in, zodat de agenda bij de site past.

### Laadt de agenda niet in het venster?

Salonized beschrijft officieel twee manieren met hun eigen code: een **inline widget** en een **pop-upknop**. Die code vind je op dezelfde plek in Salonized ("Code to add an open booking widget on my website" of "Code to add the button on my website").

- Inline: vervang in `reserveren.html` het hele blok `<div class="booking-frame" ...>...</div>` door de code van Salonized. Plak die code ongewijzigd.
- Zie je de inline optie niet in je account? Vraag Salonized-support om die aan te zetten.

## 2. Je gegevens invullen

Alle velden die je nog moet invullen staan tussen vierkante haken, bijvoorbeeld `[NAAM ZAAK]`. Zoek ze zo op:

```bash
grep -n "\[" index.html reserveren.html privacy.html 404.html script.js
```

| Veld | Waar |
|---|---|
| `[NAAM ZAAK]`, `[GEMEENTE]`, `[STRAAT + NR]`, `[POSTCODE]` | alle pagina's, ook de JSON-LD bovenaan `index.html` |
| `[TELEFOON]` | tekst en `tel:` links. Gebruik in de link het internationale formaat, bv. `tel:+3231234567` |
| `[MAIL]` | tekst en `mailto:` links |
| `[UREN]` | `index.html`, blok Openingsuren. Schrijf "09:00 tot 18:00" of "Gesloten". De kaart bovenaan toont automatisch de uren van vandaag. |
| `[DIENST 1]` tot `[DIENST 6]`, `[DUUR]`, `[PRIJS]` | `index.html`, sectie Diensten. Voeg rijen toe of verwijder ze. |
| `[KORTE TITEL ...]`, `[KORT VERHAAL ...]` | `index.html`, sectie Over ons |
| Foto | zet een foto in `assets/` en vervang het blok in sectie Over ons door de `<img>` in de commentaarregel erboven |
| `[ANNULATIEBELEID]`, `[BETAALMOGELIJKHEDEN]`, `[PARKEERINFO]` | `index.html`, sectie Vragen |
| `[ONDERNEMINGSNUMMER]` | footer |
| JSON-LD openingsuren | `index.html` bovenaan: één regel per dag, in het formaat `"opens": "09:00"` |
| Privacyverklaring | `privacy.html` is een sjabloon. Laat het nakijken. |

Kleuren pas je aan bovenaan `style.css` (`--brand`, `--btn`, ...).

## 3. Online zetten

Werkt op elke gewone webhosting, Netlify, Cloudflare Pages of GitHub Pages. Upload de inhoud van deze map.

- `404.html` gebruikt paden vanaf de root (`/style.css`). Dat werkt als de site op een eigen domein staat. Staat ze in een submap, pas die paden dan aan.
- De agenda van Salonized kan zelf cookies zetten. Vermeld dat in je privacyverklaring (staat al in het sjabloon).
- Het lettertype (Manrope, OFL-licentie) staat lokaal in `assets/fonts`, dus er gaan geen gegevens naar Google Fonts.

## Bestanden

```
index.html        homepagina
reserveren.html   reserveerpagina met de Salonized-agenda
privacy.html      privacyverklaring (sjabloon)
404.html          pagina niet gevonden
style.css         opmaak en kleuren
script.js         instellingen (SALONIZED_URL) en gedrag
favicon.svg
assets/           lettertype, deelafbeelding (og-image.png), foto's
```
