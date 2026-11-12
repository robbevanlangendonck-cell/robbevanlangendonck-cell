'use strict';
// Eén plek voor de boekings-URL. Vervang ACCOUNT door het Salonized-account van de salon,
// bijvoorbeeld https://salon-lumiere.salonized.com/widget_bookings/new
const BOOKING_URL = 'https://ACCOUNT.salonized.com/widget_bookings/new';
const PHONE = '014 00 00 00';
const TIMEOUT_MS = 14000;

const box = document.getElementById('agenda');
if (box) {
  const status = document.getElementById('status');
  const configured = !/ACCOUNT|</.test(BOOKING_URL);

  function fallback(message) {
    status.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = message;
    const open = document.createElement('a');
    open.className = 'btn';
    open.href = BOOKING_URL;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.textContent = 'Open de agenda in een nieuw tabblad';
    const call = document.createElement('p');
    call.innerHTML = 'Liever bellen? <a href="tel:' + PHONE.replace(/\s/g, '') + '">' + PHONE + '</a>';
    status.append(p);
    if (configured) status.append(open);
    status.append(call);
  }

  if (!configured) {
    fallback('Demo: de online agenda is nog niet gekoppeld. Zodra Salon Lumière een Salonized-account heeft, verschijnt de agenda hier.');
  } else {
    const frame = document.createElement('iframe');
    frame.title = 'Online afspraak maken bij Salon Lumière';
    frame.src = BOOKING_URL;
    const timer = setTimeout(() => fallback('De agenda is tijdelijk niet beschikbaar.'), TIMEOUT_MS);
    frame.addEventListener('load', () => {
      clearTimeout(timer);
      status.hidden = true;
      frame.classList.add('in');
    });
    box.append(frame);
  }
}
