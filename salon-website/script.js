/* =========================================================
   INSTELLINGEN: vul dit in
   =========================================================
   SALONIZED_URL: het adres van jouw online agenda bij Salonized.
   Vervang [ACCOUNT] door de naam van je account, die staat vooraan
   in je eigen boekingslink: https://<account>.salonized.com/...
   Laat de rest van het adres staan.
*/
const SALONIZED_URL = 'https://[ACCOUNT].salonized.com/widget_bookings/new';

/* Hoe lang we wachten op de agenda voor we de melding tonen (in ms). */
const LAAD_TIMEOUT_MS = 14000;

/* ========================================================= */

(function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Mobiel menu ---------- */
  const toggle = document.querySelector('.nav-toggle');
  const menu = document.getElementById('menu');
  if (toggle && menu) {
    const setOpen = (open) => {
      document.body.classList.toggle('menu-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.querySelector('.sr-only').textContent = open ? 'Menu sluiten' : 'Menu';
      if (open) {
        const first = menu.querySelector('a');
        if (first) setTimeout(() => first.focus({ preventScroll: true }), 150);
      }
    };
    toggle.addEventListener('click', () => setOpen(!document.body.classList.contains('menu-open')));
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('menu-open')) { setOpen(false); toggle.focus(); }
    });
    window.matchMedia('(min-width: 861px)').addEventListener('change', (e) => { if (e.matches) setOpen(false); });
  }

  /* ---------- Huidige sectie in het menu aanduiden ---------- */
  const sectionLinks = [...document.querySelectorAll('.nav-links a[href^="#"]')];
  if (sectionLinks.length && 'IntersectionObserver' in window) {
    const byId = new Map(sectionLinks.map((a) => [a.getAttribute('href').slice(1), a]));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const link = byId.get(entry.target.id);
        if (!link) return;
        if (entry.isIntersecting) {
          sectionLinks.forEach((a) => a.removeAttribute('aria-current'));
          link.setAttribute('aria-current', 'page');
        } else if (link.getAttribute('aria-current')) {
          link.removeAttribute('aria-current');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    byId.forEach((_, id) => { const el = document.getElementById(id); if (el) io.observe(el); });
  }

  /* ---------- Rustig infaden bij scrollen ---------- */
  const reveals = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window) || reduceMotion) {
    reveals.forEach((el) => el.classList.add('is-visible'));
  } else {
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { entry.target.classList.add('is-visible'); obs.unobserve(entry.target); }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
    reveals.forEach((el) => io.observe(el));
  }

  /* ---------- Tagline: woord per woord oplichten ---------- */
  document.querySelectorAll('[data-words]').forEach((el) => {
    const nodes = [...el.childNodes];
    el.textContent = '';
    nodes.forEach((node) => {
      if (node.nodeType !== Node.TEXT_NODE) { el.appendChild(node); return; }
      node.textContent.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) { el.appendChild(document.createTextNode(part)); return; }
        const span = document.createElement('span');
        span.className = 'word';
        span.textContent = part;
        el.appendChild(span);
      });
    });
    const words = [...el.querySelectorAll('.word')];
    if (reduceMotion || !('IntersectionObserver' in window)) { words.forEach((w) => w.classList.add('is-lit')); return; }
    const io = new IntersectionObserver((entries, obs) => {
      const hits = entries.filter((e) => e.isIntersecting)
        .sort((a, b) => words.indexOf(a.target) - words.indexOf(b.target));
      hits.forEach((entry, i) => {
        entry.target.style.transitionDelay = (i * 90) + 'ms';
        entry.target.classList.add('is-lit');
        obs.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -40% 0px', threshold: 1 });
    words.forEach((w) => io.observe(w));
  });

  /* ---------- Openingsuren van vandaag ---------- */
  const today = new Date().getDay();
  const row = document.querySelector('.hours [data-day="' + today + '"]');
  if (row) {
    row.classList.add('is-today');
    const hours = row.querySelector('dd').textContent.trim();
    const label = document.querySelector('[data-today-label]');
    const value = document.querySelector('[data-today-hours]');
    const dot = document.querySelector('[data-today-dot]');
    if (label && value) {
      label.textContent = 'Vandaag, ' + row.querySelector('dt').textContent.toLowerCase();
      value.textContent = hours;
      if (dot && !/gesloten/i.test(hours)) dot.classList.add('is-open');
    }
  }

  /* ---------- Jaartal in de footer ---------- */
  document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });

  /* ---------- Salonized agenda ---------- */
  const frame = document.querySelector('[data-salonized]');
  if (!frame) return;

  const configured = /^https:\/\/[a-z0-9-]+\.salonized\.com\//i.test(SALONIZED_URL);
  const help = document.querySelector('[data-booking-help]');

  if (!configured) {
    frame.dataset.state = 'empty';
    if (help) help.hidden = true;
    console.warn('Salonized is nog niet gekoppeld: vul SALONIZED_URL in bovenaan script.js.');
    return;
  }

  document.querySelectorAll('[data-booking-link]').forEach((a) => { a.href = SALONIZED_URL; });

  const iframe = document.createElement('iframe');
  iframe.src = SALONIZED_URL;
  iframe.title = 'Online afspraak maken';
  iframe.setAttribute('allow', 'payment');
  iframe.loading = 'eager';

  const timer = setTimeout(() => {
    if (frame.dataset.state === 'loading') frame.dataset.state = 'error';
  }, LAAD_TIMEOUT_MS);

  iframe.addEventListener('load', () => {
    clearTimeout(timer);
    frame.dataset.state = 'ready';
    frame.classList.add('is-ready');
  });

  frame.appendChild(iframe);
})();
