(() => {
  'use strict';

  const MAX_LENGTH = 2000; // tekens per bericht, zelfde grens als op de server
  const MAX_HISTORY = 40; // zoveel berichten gaan hooguit mee naar de server
  const TIMEOUT_MS = 120 * 1000;
  const UNAVAILABLE = 'Ik kan nu niet antwoorden. Bel gerust naar 014 00 00 00.';

  const log = document.getElementById('log');
  const form = document.getElementById('form');
  const input = document.getElementById('message');
  const sendButton = document.getElementById('send');
  const quick = document.getElementById('quick');

  // Het gesprek leeft alleen hier, in het geheugen van deze pagina. De server
  // onthoudt niets: bij elk bericht gaat het gesprek opnieuw mee.
  const history = [];
  let busy = false;
  let typing = null;

  function scrollToEnd() {
    log.scrollTop = log.scrollHeight;
  }

  // De chat toont gewone tekst. Vet uit Markdown (**zo**) zou als sterretjes verschijnen.
  function plainText(text) {
    return text.replace(/\*\*(.+?)\*\*/g, '$1');
  }

  function addMessage(role, text, isError) {
    const bubble = document.createElement('div');
    bubble.className = `message message--${role}${isError ? ' message--error' : ''}`;

    const speaker = document.createElement('span');
    speaker.className = 'visually-hidden';
    speaker.textContent = role === 'user' ? 'Jij: ' : 'Receptionist: ';

    const body = document.createElement('p');
    body.textContent = role === 'user' ? text : plainText(text);

    bubble.append(speaker, body);
    log.append(bubble);
    scrollToEnd();
  }

  function showTyping() {
    typing = document.createElement('div');
    typing.className = 'message message--assistant typing';

    const label = document.createElement('span');
    label.className = 'visually-hidden';
    label.textContent = 'De receptionist is aan het typen…';

    const dots = document.createElement('span');
    dots.className = 'typing__dots';
    dots.setAttribute('aria-hidden', 'true');
    dots.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));

    typing.append(label, dots);
    log.append(typing);
    scrollToEnd();
  }

  function hideTyping() {
    if (typing) typing.remove();
    typing = null;
  }

  function setBusy(value) {
    busy = value;
    sendButton.disabled = value;
    log.setAttribute('aria-busy', String(value));
  }

  async function askReceptionist() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.slice(-MAX_HISTORY) }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data && typeof data.reply === 'string') return { reply: data.reply };
      return { error: (data && typeof data.error === 'string' && data.error) || UNAVAILABLE };
    } catch (error) {
      return { error: UNAVAILABLE };
    } finally {
      clearTimeout(timer);
    }
  }

  async function send(rawText) {
    const text = rawText.trim();
    if (!text || busy) return;

    quick.hidden = true;
    if (text.length > MAX_LENGTH) {
      addMessage('assistant', `Je bericht is te lang. Hou het bij maximaal ${MAX_LENGTH} tekens.`, true);
      return;
    }

    input.value = '';
    addMessage('user', text);
    history.push({ role: 'user', content: text });

    setBusy(true);
    showTyping();
    const result = await askReceptionist();
    hideTyping();

    if (result.reply) {
      history.push({ role: 'assistant', content: result.reply });
      addMessage('assistant', result.reply);
    } else {
      // Het onbeantwoorde bericht gaat uit het gesprek, zodat opnieuw proberen kan.
      history.pop();
      addMessage('assistant', result.error, true);
    }
    setBusy(false);
    input.focus();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    send(input.value);
  });

  quick.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-message]');
    if (button) send(button.dataset.message);
  });
})();
