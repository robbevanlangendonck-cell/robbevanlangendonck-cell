'use strict';

// De agenda van Salon Lumière. Het model mag alleen via deze functies met de
// agenda werken. Elke functie valideert zijn invoer en geeft een gewoon object
// terug: { ok: true, ... } of { ok: false, error: '<uitleg in het Nederlands>' }.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DEFAULT_SALON_FILE = path.join(DATA_DIR, 'salon.json');
const DEFAULT_APPOINTMENTS_FILE = path.join(DATA_DIR, 'appointments.json');

// Volgorde volgt Date#getUTCDay(): 0 = zondag.
const WEEKDAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const OPEN_ORDER = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];

// Een doorverwijzing krijgt een categorie in plaats van vrije tekst. Zo kan er
// nooit een naam, telefoonnummer of gezondheidsdetail in het serverlog belanden.
const HANDOFF_REASONS = [
  'klacht',
  'allergie_of_huidprobleem',
  'haarprobleem',
  'medische_vraag',
  'groep',
  'bruidskapsel',
  'technisch_probleem',
  'andere',
];

const REFERENCE_PATTERN = /^LUM-\d{4}$/;
const FALLBACK_DURATION_MINUTES = 60;

function fail(error) {
  return { ok: false, error };
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalize(value) {
  return text(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** 'JJJJ-MM-DD' -> { date, weekday } of null als het geen echte kalenderdatum is. */
function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(value));
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const isReal =
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
  if (!isReal) return null;
  return { date: match[0], weekday: WEEKDAYS[utc.getUTCDay()] };
}

/** 'UU:MM' -> minuten sinds middernacht, of null. */
function parseTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text(value));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatTime(totalMinutes) {
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** '09:00' -> '9u', '16:30' -> '16u30' (zoals je het in Vlaanderen zegt). */
function spokenTime(totalMinutes) {
  const minutes = totalMinutes % 60;
  return `${Math.floor(totalMinutes / 60)}u${minutes ? String(minutes).padStart(2, '0') : ''}`;
}

function addDays(dateString, days) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Datum en uur van dit moment in de tijdzone van de salon. */
function zonedNow(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type) => parts.find((p) => p.type === type).value;
  const date = `${part('year')}-${part('month')}-${part('day')}`;
  return {
    date,
    minutes: Number(part('hour')) * 60 + Number(part('minute')),
    weekday: parseDate(date).weekday,
  };
}

/**
 * Maakt de agendafuncties aan.
 *
 * @param {object} [options]
 * @param {string} [options.appointmentsFile] Pad naar het JSON-bestand met afspraken.
 * @param {string} [options.salonFile] Pad naar de salongegevens.
 * @param {() => Date} [options.now] Klok; de tests geven hier een vast tijdstip mee.
 * @param {(reason: string) => void} [options.onHandoff] Krijgt de categorie van een doorverwijzing.
 */
function createSalonTools(options = {}) {
  const appointmentsFile = options.appointmentsFile || DEFAULT_APPOINTMENTS_FILE;
  const salon = JSON.parse(fs.readFileSync(options.salonFile || DEFAULT_SALON_FILE, 'utf8'));
  const now = options.now || (() => new Date());
  const onHandoff = options.onHandoff || (() => {});
  const step = salon.slotStepMinutes || 15;
  const serviceNames = salon.services.map((service) => service.name);

  // ---- opslag -------------------------------------------------------------

  function readAppointments() {
    let raw;
    try {
      raw = fs.readFileSync(appointmentsFile, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Afsprakenbestand heeft een onverwachte vorm.');
    return parsed;
  }

  function writeAppointments(appointments) {
    // Eerst naar een tijdelijk bestand, dan hernoemen: zo blijft er nooit een
    // half geschreven bestand achter als het proces onderweg stopt.
    const temporary = `${appointmentsFile}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(appointments, null, 2)}\n`);
    fs.renameSync(temporary, appointmentsFile);
  }

  // ---- hulpfuncties -------------------------------------------------------

  function today() {
    return zonedNow(now(), salon.timezone);
  }

  function findService(value) {
    const wanted = normalize(value);
    return salon.services.find((service) => normalize(service.name) === wanted) || null;
  }

  function durationOf(serviceName) {
    const service = findService(serviceName);
    return service ? service.durationMinutes : FALLBACK_DURATION_MINUTES;
  }

  function hoursFor(weekday) {
    const hours = salon.openingHours[weekday];
    if (!hours) return null;
    return { open: parseTime(hours.open), close: parseTime(hours.close) };
  }

  function openingSummary() {
    const open = [];
    const closed = [];
    for (const weekday of OPEN_ORDER) {
      const hours = hoursFor(weekday);
      if (hours) open.push(`${weekday} ${spokenTime(hours.open)}-${spokenTime(hours.close)}`);
      else closed.push(weekday);
    }
    return `Open: ${open.join(', ')}. Gesloten: ${closed.join(' en ')}.`;
  }

  function busyIntervals(appointments, date) {
    return appointments
      .filter((appointment) => appointment.date === date)
      .map((appointment) => {
        const start = parseTime(appointment.time);
        return { start, end: start + durationOf(appointment.service) };
      });
  }

  function isFree(busy, start, end) {
    return busy.every((interval) => start >= interval.end || end <= interval.start);
  }

  /** Controleert behandeling en dag. Geeft { error } of { service, day, hours, current }. */
  function resolveServiceAndDay(input) {
    if (!text(input.service)) return { error: 'Geef een behandeling op.' };
    const service = findService(input.service);
    if (!service) {
      return { error: `Onbekende behandeling. Kies uit: ${serviceNames.join(', ')}.` };
    }
    const day = parseDate(input.date);
    if (!day) {
      return { error: 'Ongeldige datum. Gebruik het formaat JJJJ-MM-DD, bijvoorbeeld 2026-03-14.' };
    }
    const current = today();
    if (day.date < current.date) {
      return {
        error: `${day.date} ligt in het verleden. Vandaag is het ${current.weekday} ${current.date}.`,
      };
    }
    const hours = hoursFor(day.weekday);
    if (!hours) {
      return {
        error: `De salon is gesloten op ${day.weekday} (${day.date}). ${openingSummary()}`,
      };
    }
    return { service, day, hours, current };
  }

  function generateReference(appointments) {
    const taken = new Set(appointments.map((appointment) => appointment.reference));
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const reference = `LUM-${crypto.randomInt(1000, 10000)}`;
      if (!taken.has(reference)) return reference;
    }
    throw new Error('Geen vrije referentiecode gevonden.');
  }

  function validateName(value) {
    const name = text(value).replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 80 || !/\p{L}/u.test(name) || /[\p{Cc}<>]/u.test(name)) {
      return null;
    }
    return name;
  }

  function validateContact(value) {
    const contact = text(value);
    if (contact.length > 100) return null;
    const isEmail = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(contact);
    const digits = contact.replace(/\D/g, '').length;
    const isPhone = /^\+?[\d\s./()-]+$/.test(contact) && digits >= 8 && digits <= 15;
    return isEmail || isPhone ? contact : null;
  }

  // ---- de zes tools -------------------------------------------------------

  function getOpeningHours() {
    const openingHours = {};
    for (const weekday of OPEN_ORDER) {
      const hours = salon.openingHours[weekday];
      openingHours[weekday] = hours ? `${hours.open}-${hours.close}` : 'gesloten';
    }
    return { ok: true, openingHours, summary: openingSummary() };
  }

  function listServices() {
    return {
      ok: true,
      services: salon.services.map((service) => ({
        name: service.name,
        durationMinutes: service.durationMinutes,
      })),
      prices: 'Niet beschikbaar. Verwijs voor prijzen naar de salon.',
    };
  }

  function checkAvailability(input = {}) {
    const resolved = resolveServiceAndDay(input || {});
    if (resolved.error) return fail(resolved.error);
    const { service, day, hours, current } = resolved;

    const busy = busyIntervals(readAppointments(), day.date);
    const slots = [];
    for (let start = hours.open; start + service.durationMinutes <= hours.close; start += step) {
      const stillAhead = day.date > current.date || start > current.minutes;
      if (stillAhead && isFree(busy, start, start + service.durationMinutes)) {
        slots.push(formatTime(start));
      }
    }

    const result = {
      ok: true,
      service: service.name,
      durationMinutes: service.durationMinutes,
      date: day.date,
      weekday: day.weekday,
      slots,
    };
    if (slots.length === 0) result.message = 'Geen vrije tijdstippen meer op die dag.';
    return result;
  }

  function bookAppointment(input = {}) {
    const resolved = resolveServiceAndDay(input || {});
    if (resolved.error) return fail(resolved.error);
    const { service, day, hours, current } = resolved;

    const start = parseTime(input.time);
    if (start === null) return fail('Ongeldig uur. Gebruik het formaat UU:MM, bijvoorbeeld 14:30.');
    if (start % step !== 0) {
      return fail(`Afspraken starten per ${step} minuten (bijvoorbeeld 14:00, 14:15, 14:30 of 14:45).`);
    }
    const end = start + service.durationMinutes;
    if (start < hours.open || end > hours.close) {
      return fail(
        `Dat past niet binnen de openingsuren. Op ${day.weekday} is de salon open van ` +
          `${spokenTime(hours.open)} tot ${spokenTime(hours.close)}; ${service.name} duurt ` +
          `${service.durationMinutes} minuten en kan ten laatste om ` +
          `${spokenTime(hours.close - service.durationMinutes)} starten.`
      );
    }
    if (day.date === current.date && start <= current.minutes) {
      return fail('Dat tijdstip is al voorbij. Vraag de vrije tijdstippen op met check_availability.');
    }

    const name = validateName(input.name);
    if (!name) return fail('Geef de naam van de klant op (2 tot 80 tekens).');
    const contact = validateContact(input.contact);
    if (!contact) return fail('Geef een geldig telefoonnummer of e-mailadres op als contact.');

    const appointments = readAppointments();
    if (!isFree(busyIntervals(appointments, day.date), start, end)) {
      return fail(
        'Dat tijdstip is niet meer vrij: het overlapt met een andere afspraak. ' +
          'Vraag de vrije tijdstippen op met check_availability.'
      );
    }

    // Alleen deze zes velden worden bewaard (dataminimalisatie).
    const appointment = {
      reference: generateReference(appointments),
      service: service.name,
      date: day.date,
      time: formatTime(start),
      name,
      contact,
    };
    appointments.push(appointment);
    writeAppointments(appointments);

    return {
      ok: true,
      reference: appointment.reference,
      service: appointment.service,
      durationMinutes: service.durationMinutes,
      date: appointment.date,
      weekday: day.weekday,
      time: appointment.time,
    };
  }

  function cancelAppointment(input = {}) {
    const reference = text((input || {}).reference).toUpperCase();
    if (!REFERENCE_PATTERN.test(reference)) {
      return fail('Ongeldige referentiecode. Een code ziet eruit als LUM-1234.');
    }
    const name = normalize((input || {}).name);
    if (!name) return fail('Geef de naam op waarmee de afspraak geboekt is.');

    const appointments = readAppointments();
    const index = appointments.findIndex(
      (appointment) => appointment.reference === reference && normalize(appointment.name) === name
    );
    // Eén melding voor "code bestaat niet" en "naam klopt niet": zo verraadt de
    // fout niet welke codes in gebruik zijn.
    if (index === -1) return fail('Geen afspraak gevonden met die referentiecode en naam.');

    const [cancelled] = appointments.splice(index, 1);
    writeAppointments(appointments);
    return {
      ok: true,
      cancelled: {
        reference: cancelled.reference,
        service: cancelled.service,
        date: cancelled.date,
        time: cancelled.time,
      },
    };
  }

  function handoffToHuman(input = {}) {
    const reason = text((input || {}).reason);
    if (!HANDOFF_REASONS.includes(reason)) {
      return fail(`Ongeldige reden. Kies uit: ${HANDOFF_REASONS.join(', ')}.`);
    }
    onHandoff(reason);
    return {
      ok: true,
      noted: true,
      phone: salon.phone,
      email: salon.email,
      message:
        'Genoteerd voor de salon. Bij deze melding worden geen naam of contactgegevens ' +
        'bewaard, dus de salon kan de klant niet zelf terugbellen: vraag de klant om ' +
        'tijdens de openingsuren naar de salon te bellen of te mailen.',
    };
  }

  // ---- onderhoud ----------------------------------------------------------

  /** Verwijdert afspraken die langer dan `days` dagen geleden plaatsvonden. */
  function cleanupOldAppointments(days = salon.retentionDays || 30) {
    const cutoff = addDays(today().date, -days);
    const appointments = readAppointments();
    const kept = appointments.filter((appointment) => !(String(appointment.date) < cutoff));
    const removed = appointments.length - kept.length;
    if (removed > 0) writeAppointments(kept);
    return { removed, remaining: kept.length };
  }

  // ---- beschrijving voor het model ----------------------------------------

  const serviceProperty = {
    type: 'string',
    enum: serviceNames,
    description: 'De behandeling, exact zoals in list_services.',
  };
  const dateProperty = {
    type: 'string',
    description: 'Datum in het formaat JJJJ-MM-DD, bijvoorbeeld 2026-03-14.',
  };
  const noInput = { type: 'object', properties: {}, additionalProperties: false };

  const definitions = [
    {
      name: 'get_opening_hours',
      description:
        'Geeft de openingsuren van de salon per weekdag. Gebruik dit bij elke vraag over ' +
        'wanneer de salon open of gesloten is.',
      input_schema: noInput,
    },
    {
      name: 'list_services',
      description:
        'Geeft alle behandelingen met hun duur in minuten. Gebruik dit bij vragen over het ' +
        'aanbod en vóór je een behandeling voorstelt. Er zijn geen prijzen beschikbaar.',
      input_schema: noInput,
    },
    {
      name: 'check_availability',
      description:
        'Geeft de vrije starttijden (per 15 minuten) voor één behandeling op één dag, rekening ' +
        'houdend met openingsuren, duur en bestaande afspraken. Het antwoord bevat ook de ' +
        'weekdag van de datum: controleer of die klopt met wat de klant vroeg. Roep dit altijd ' +
        'aan voordat je een tijdstip voorstelt of bevestigt. Bereken beschikbaarheid nooit zelf.',
      input_schema: {
        type: 'object',
        properties: { service: serviceProperty, date: dateProperty },
        required: ['service', 'date'],
        additionalProperties: false,
      },
    },
    {
      name: 'book_appointment',
      description:
        'Maakt een afspraak als het tijdstip nog vrij is en geeft een referentiecode terug ' +
        '(bijvoorbeeld LUM-4821). Roep dit pas aan nadat de klant de herhaalde gegevens ' +
        'duidelijk met "ja" bevestigd heeft. Geeft een fout bij een dubbele boeking.',
      input_schema: {
        type: 'object',
        properties: {
          service: serviceProperty,
          date: dateProperty,
          time: {
            type: 'string',
            description: 'Starttijd in het formaat UU:MM (24 uur), bijvoorbeeld 14:30.',
          },
          name: { type: 'string', description: 'Naam van de klant.' },
          contact: {
            type: 'string',
            description: 'Telefoonnummer of e-mailadres van de klant.',
          },
        },
        required: ['service', 'date', 'time', 'name', 'contact'],
        additionalProperties: false,
      },
    },
    {
      name: 'cancel_appointment',
      description:
        'Annuleert een afspraak. Lukt alleen als de referentiecode en de naam allebei kloppen ' +
        'met de boeking.',
      input_schema: {
        type: 'object',
        properties: {
          reference: { type: 'string', description: 'Referentiecode, bijvoorbeeld LUM-4821.' },
          name: { type: 'string', description: 'Naam waarmee de afspraak geboekt is.' },
        },
        required: ['reference', 'name'],
        additionalProperties: false,
      },
    },
    {
      name: 'handoff_to_human',
      description:
        'Noteert dat een medewerker van de salon dit moet opvolgen en geeft het telefoonnummer ' +
        'van de salon terug. Gebruik dit als iets niet lukt of je het niet zeker weet: klachten, ' +
        'allergieën, haarproblemen, medische vragen, groepen, bruidskapsels met proefsessie. ' +
        'Geef alleen de categorie door, nooit een naam of contactgegevens.',
      input_schema: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            enum: HANDOFF_REASONS,
            description: 'Categorie die het best past bij de vraag van de klant.',
          },
        },
        required: ['reason'],
        additionalProperties: false,
      },
    },
  ];

  const handlers = {
    get_opening_hours: getOpeningHours,
    list_services: listServices,
    check_availability: checkAvailability,
    book_appointment: bookAppointment,
    cancel_appointment: cancelAppointment,
    handoff_to_human: handoffToHuman,
  };

  /** Voert een tool uit op naam. Gooit nooit: een fout komt terug als { ok: false }. */
  function execute(name, input) {
    const handler = Object.prototype.hasOwnProperty.call(handlers, name) ? handlers[name] : null;
    if (!handler) return fail(`Onbekende tool: ${String(name).slice(0, 40)}.`);
    try {
      return handler(input && typeof input === 'object' ? input : {});
    } catch (error) {
      // Bewust geen foutbericht doorgeven of loggen: dat kan stukjes uit het
      // afsprakenbestand bevatten.
      if (options.onError) options.onError(name, error);
      return fail(
        'De agenda is door een technische fout niet bereikbaar. Gebruik handoff_to_human ' +
          'met reden "technisch_probleem".'
      );
    }
  }

  return {
    salon,
    definitions,
    execute,
    getOpeningHours,
    listServices,
    checkAvailability,
    bookAppointment,
    cancelAppointment,
    handoffToHuman,
    cleanupOldAppointments,
    today,
  };
}

module.exports = {
  createSalonTools,
  HANDOFF_REASONS,
  DEFAULT_APPOINTMENTS_FILE,
  DEFAULT_SALON_FILE,
};
