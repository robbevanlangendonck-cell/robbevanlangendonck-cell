# Salon Lumière – AI-receptionist (demo)

Webchat voor een fictieve kapsalon in Kasterlee: afspraken maken, verzetten en annuleren via de Claude API. Alle gegevens zijn verzonnen.

1. Nodig: Node.js 20 of hoger en een API-sleutel van Anthropic (console.anthropic.com).
2. Installeer de afhankelijkheden: `cd salon-receptionist && npm install`.
3. Maak je instellingen aan: `cp .env.example .env`.
4. Zet je sleutel in `.env` als `ANTHROPIC_API_KEY=...`; dat bestand staat in `.gitignore` en de sleutel bereikt nooit de browser.
5. Start de demo met `npm start` en open http://localhost:3000.
6. Draai de tests met `npm test`; die gebruiken een tijdelijk bestand, niet `data/appointments.json`.
7. Geboekte afspraken verschijnen in `data/appointments.json`; de salongegevens staan in `data/salon.json`.
8. Een ander model? Pas `MODEL` bovenaan `server.js` aan of zet `CLAUDE_MODEL` in `.env`.
9. `npm run cleanup` verwijdert afspraken ouder dan 30 dagen; de server doet dat ook bij het starten en daarna elke dag.
10. Krijg je "Ik kan nu niet antwoorden", kijk dan in de serverlog: daar staat de oorzaak, zonder persoonsgegevens.
