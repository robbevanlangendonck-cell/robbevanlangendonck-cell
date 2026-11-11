'use strict';

// Tests voor de agendafuncties. Elke test werkt op een eigen tijdelijk bestand,
// zodat data/appointments.json onaangeroerd blijft.

const { test, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createSalonTools, DEFAULT_APPOINTMENTS_FILE } = require('../tools');

// Vaste klok: maandag 9 november 2026, 10:00 in Kasterlee (09:00 UTC).
const NOW = new Date('2026-11-09T09:00:00Z');
const TUESDAY = '2026-11-10'; // open 9u-18u
const SATURDAY = '2026-11-14'; // open 8u-13u
const SUNDAY = '2026-11-15'; // gesloten
const MONDAY = '2026-11-16'; // gesloten
const LAST_FRIDAY = '2026-11-06'; // in het verleden

const realFileBefore = fs.existsSync(DEFAULT_APPOINTMENTS_FILE)
  ? fs.readFileSync(DEFAULT_APPOINTMENTS_FILE, 'utf8')
  : null;

let directory;
let appointmentsFile;
let tools;

function makeTools(overrides = {}) {
  return createSalonTools({ appointmentsFile, now: () => NOW, ...overrides });
}

function stored() {
  return JSON.parse(fs.readFileSync(appointmentsFile, 'utf8'));
}

function book(overrides = {}) {
  return tools.bookAppointment({
    service: 'Knippen dames',
    date: TUESDAY,
    time: '10:00',
    name: 'An Peeters',
    contact: '0470 12 34 56',
    ...overrides,
  });
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'salon-lumiere-test-'));
  appointmentsFile = path.join(directory, 'appointments.json');
  tools = makeTools();
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

after(() => {
  const realFileAfter = fs.existsSync(DEFAULT_APPOINTMENTS_FILE)
    ? fs.readFileSync(DEFAULT_APPOINTMENTS_FILE, 'utf8')
    : null;
  assert.equal(realFileAfter, realFileBefore, 'data/appointments.json mag niet wijzigen door de tests');
});

// ---- de gevraagde scenario's ----------------------------------------------

test('een vrij uur wordt geboekt en daarna niet meer aangeboden', () => {
  const before = tools.checkAvailability({ service: 'Knippen dames', date: TUESDAY });
  assert.equal(before.ok, true);
  assert.equal(before.weekday, 'dinsdag');
  assert.ok(before.slots.includes('10:00'));

  const booking = book();
  assert.equal(booking.ok, true);
  assert.match(booking.reference, /^LUM-\d{4}$/);

  const after = tools.checkAvailability({ service: 'Knippen dames', date: TUESDAY });
  assert.ok(!after.slots.includes('10:00'), '10:00 is bezet');
  // Knippen dames duurt 45 minuten: 10:00-10:45 blokkeert elke start van 09:30 tot 10:30.
  for (const blocked of ['09:30', '09:45', '10:15', '10:30']) {
    assert.ok(!after.slots.includes(blocked), `${blocked} overlapt met de afspraak`);
  }
  assert.ok(after.slots.includes('09:15'), '09:15-10:00 sluit net aan en blijft vrij');
  assert.ok(after.slots.includes('10:45'), '10:45 sluit net aan en blijft vrij');
});

test('een tweede klant krijgt het bezette uur ook voor een andere behandeling niet', () => {
  book();
  const heren = tools.checkAvailability({ service: 'Knippen heren', date: TUESDAY });
  assert.ok(!heren.slots.includes('10:00'));
  assert.ok(!heren.slots.includes('10:30'));
  assert.ok(heren.slots.includes('09:30'), '09:30-10:00 past nog voor 30 minuten');
});

test('een overlappende boeking wordt geweigerd', () => {
  assert.equal(book().ok, true);

  const same = book({ name: 'Bram Janssens', contact: 'bram@example.com' });
  assert.equal(same.ok, false);
  assert.match(same.error, /niet meer vrij/);

  const overlapping = book({ service: 'Knippen heren', time: '10:30', name: 'Bram Janssens' });
  assert.equal(overlapping.ok, false);

  const straddling = book({ service: 'Kleuren', time: '09:00', name: 'Bram Janssens' });
  assert.equal(straddling.ok, false, '09:00-10:30 overlapt met 10:00-10:45');

  assert.equal(stored().length, 1, 'alleen de eerste afspraak is bewaard');
});

test('boeken op maandag geeft een fout', () => {
  const result = book({ date: MONDAY });
  assert.equal(result.ok, false);
  assert.match(result.error, /gesloten op maandag/);
  assert.equal(tools.checkAvailability({ service: 'Knippen dames', date: MONDAY }).ok, false);
});

test('boeken op zondag geeft een fout', () => {
  const result = book({ date: SUNDAY });
  assert.equal(result.ok, false);
  assert.match(result.error, /gesloten op zondag/);
  assert.equal(tools.checkAvailability({ service: 'Knippen dames', date: SUNDAY }).ok, false);
});

test('boeken in het verleden geeft een fout', () => {
  const result = book({ date: LAST_FRIDAY });
  assert.equal(result.ok, false);
  assert.match(result.error, /verleden/);
  assert.equal(tools.checkAvailability({ service: 'Knippen dames', date: LAST_FRIDAY }).ok, false);
  assert.equal(fs.existsSync(appointmentsFile), false, 'er is niets weggeschreven');
});

test('een uur dat vandaag al voorbij is kan niet meer geboekt worden', () => {
  // Dinsdag 10 november 2026, 14:20 in Kasterlee.
  tools = makeTools({ now: () => new Date('2026-11-10T13:20:00Z') });

  const availability = tools.checkAvailability({ service: 'Knippen heren', date: TUESDAY });
  assert.equal(availability.slots[0], '14:30');

  const tooLate = book({ service: 'Knippen heren', time: '14:15' });
  assert.equal(tooLate.ok, false);
  assert.match(tooLate.error, /voorbij/);

  assert.equal(book({ service: 'Knippen heren', time: '14:30' }).ok, true);
});

test('een afspraak van 90 minuten past niet in het laatste halfuur voor sluitingstijd', () => {
  const availability = tools.checkAvailability({ service: 'Kleuren', date: TUESDAY });
  assert.equal(availability.durationMinutes, 90);
  assert.equal(availability.slots.at(-1), '16:30', 'laatste start is 90 minuten voor 18u');
  assert.ok(!availability.slots.includes('17:30'));

  const result = book({ service: 'Kleuren', time: '17:30' });
  assert.equal(result.ok, false);
  assert.match(result.error, /openingsuren/);

  // Zaterdag sluit de salon al om 13u.
  const saturday = tools.checkAvailability({ service: 'Kleuren', date: SATURDAY });
  assert.equal(saturday.slots[0], '08:00');
  assert.equal(saturday.slots.at(-1), '11:30');
  assert.equal(book({ service: 'Kleuren', date: SATURDAY, time: '12:30' }).ok, false);
});

test('annuleren met een verkeerde naam mislukt, met de juiste naam lukt het', () => {
  const { reference } = book();

  const wrongName = tools.cancelAppointment({ reference, name: 'Iemand Anders' });
  assert.equal(wrongName.ok, false);
  assert.equal(stored().length, 1, 'de afspraak staat er nog');

  const wrongCode = tools.cancelAppointment({ reference: 'LUM-0000', name: 'An Peeters' });
  assert.equal(wrongCode.ok, false);
  assert.equal(wrongCode.error, wrongName.error, 'de fout verraadt niet of de code bestaat');

  // Hoofdletters en extra spaties in de naam maken niet uit.
  const rightName = tools.cancelAppointment({ reference: reference.toLowerCase(), name: '  an  PEETERS ' });
  assert.equal(rightName.ok, true);
  assert.equal(rightName.cancelled.reference, reference);
  assert.deepEqual(stored(), []);

  const again = tools.cancelAppointment({ reference, name: 'An Peeters' });
  assert.equal(again.ok, false, 'twee keer annuleren kan niet');
});

test('na annuleren is het uur weer vrij', () => {
  const { reference } = book();
  assert.ok(!tools.checkAvailability({ service: 'Knippen dames', date: TUESDAY }).slots.includes('10:00'));

  assert.equal(tools.cancelAppointment({ reference, name: 'An Peeters' }).ok, true);

  assert.ok(tools.checkAvailability({ service: 'Knippen dames', date: TUESDAY }).slots.includes('10:00'));
  assert.equal(book({ name: 'Bram Janssens', contact: 'bram@example.com' }).ok, true);
});

// ---- extra controles --------------------------------------------------------

test('vrije tijdstippen lopen per 15 minuten binnen de openingsuren', () => {
  const { slots } = tools.checkAvailability({ service: 'Knippen heren', date: TUESDAY });
  assert.equal(slots[0], '09:00');
  assert.equal(slots[1], '09:15');
  assert.equal(slots.at(-1), '17:30');
  assert.equal(slots.length, 35);
  assert.ok(slots.every((slot) => /^\d{2}:(00|15|30|45)$/.test(slot)));
});

test('alleen referentiecode, behandeling, datum, uur, naam en contact worden bewaard', () => {
  book();
  assert.deepEqual(Object.keys(stored()[0]).sort(), [
    'contact',
    'date',
    'name',
    'reference',
    'service',
    'time',
  ]);
});

test('ongeldige invoer wordt geweigerd met een duidelijke fout', () => {
  const invalid = [
    { service: 'Permanent' },
    { service: '' },
    { date: '10/11/2026' },
    { date: '2026-02-30' },
    { time: '25:00' },
    { time: 'tien uur' },
    { time: '10:10' },
    { time: '08:45' },
    { name: '' },
    { name: 'x' },
    { name: '12345' },
    { contact: '' },
    { contact: 'geen idee' },
    { contact: '123' },
  ];
  for (const overrides of invalid) {
    const result = book(overrides);
    assert.equal(result.ok, false, `geweigerd: ${JSON.stringify(overrides)}`);
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.length > 10);
  }
  assert.equal(fs.existsSync(appointmentsFile), false, 'er is niets weggeschreven');

  assert.equal(tools.checkAvailability({}).ok, false);
  assert.equal(tools.checkAvailability(null).ok, false);
  assert.equal(tools.cancelAppointment({ reference: '4821', name: 'An Peeters' }).ok, false);
  assert.equal(tools.cancelAppointment({ reference: 'LUM-4821' }).ok, false);
  assert.equal(tools.handoffToHuman({ reason: 'An Peeters, 0470 12 34 56' }).ok, false);
});

test('een e-mailadres is ook een geldig contact', () => {
  assert.equal(book({ contact: 'an.peeters@example.com' }).ok, true);
});

test('openingsuren en behandelingen komen uit de salongegevens, zonder prijzen', () => {
  const hours = tools.getOpeningHours();
  assert.equal(hours.openingHours.maandag, 'gesloten');
  assert.equal(hours.openingHours.zondag, 'gesloten');
  assert.equal(hours.openingHours.dinsdag, '09:00-18:00');
  assert.equal(hours.openingHours.vrijdag, '09:00-18:00');
  assert.equal(hours.openingHours.zaterdag, '08:00-13:00');

  const { services } = tools.listServices();
  assert.deepEqual(services, [
    { name: 'Knippen dames', durationMinutes: 45 },
    { name: 'Knippen heren', durationMinutes: 30 },
    { name: 'Knippen kinderen', durationMinutes: 30 },
    { name: 'Kleuren', durationMinutes: 90 },
    { name: 'Opsteekkapsel', durationMinutes: 60 },
  ]);
  assert.doesNotMatch(JSON.stringify(tools.listServices()), /€|euro|\d+[.,]\d{2}/i);
});

test('handoff_to_human noteert alleen een categorie en geeft het telefoonnummer terug', () => {
  const noted = [];
  tools = makeTools({ onHandoff: (reason) => noted.push(reason) });

  const result = tools.handoffToHuman({ reason: 'allergie_of_huidprobleem' });
  assert.equal(result.ok, true);
  assert.equal(result.phone, '014 00 00 00');
  assert.deepEqual(noted, ['allergie_of_huidprobleem']);
});

test('execute stuurt door naar de juiste tool en vangt onbekende tools en fouten op', () => {
  assert.equal(tools.definitions.length, 6);
  for (const definition of tools.definitions) {
    assert.equal(tools.execute(definition.name, {}).ok !== undefined, true);
  }
  assert.equal(tools.execute('get_opening_hours', {}).ok, true);
  assert.equal(tools.execute('delete_everything', {}).ok, false);
  assert.equal(tools.execute('constructor', {}).ok, false);

  fs.writeFileSync(appointmentsFile, '{ dit is geen geldige json');
  const broken = tools.execute('check_availability', { service: 'Knippen dames', date: TUESDAY });
  assert.equal(broken.ok, false);
  assert.match(broken.error, /technische fout/);
});

test('cleanup verwijdert alleen afspraken ouder dan 30 dagen', () => {
  const appointment = (reference, date) => ({
    reference,
    service: 'Knippen heren',
    date,
    time: '10:00',
    name: 'Test Klant',
    contact: 'test@example.com',
  });
  fs.writeFileSync(
    appointmentsFile,
    JSON.stringify([
      appointment('LUM-1001', '2026-10-09'), // 31 dagen geleden: weg
      appointment('LUM-1002', '2026-10-10'), // precies 30 dagen geleden: blijft
      appointment('LUM-1003', '2026-11-03'), // vorige week: blijft
      appointment('LUM-1004', TUESDAY), // morgen: blijft
    ])
  );

  assert.deepEqual(tools.cleanupOldAppointments(), { removed: 1, remaining: 3 });
  assert.deepEqual(
    stored().map((item) => item.reference),
    ['LUM-1002', 'LUM-1003', 'LUM-1004']
  );
  assert.deepEqual(tools.cleanupOldAppointments(), { removed: 0, remaining: 3 });
});
