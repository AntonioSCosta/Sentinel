import { STORAGE_KEY } from '../../src/campaign/flow.js';
import { seedEmptySlot } from './fixture.mjs';

const messages = {
  en: {
    local: 'Open this launcher on localhost.',
    occupied: 'A campaign save already exists. Use a separate browser profile or a different localhost port to start again.',
    failed: 'The browser could not prepare the playtest save. Check that local storage is available.',
  },
  'pt-PT': {
    local: 'Abre este lançador em localhost.',
    occupied: 'Já existe uma gravação. Para recomeçar, usa outro perfil de browser ou outra porta de localhost.',
    failed: 'O browser não conseguiu preparar a gravação de playtest. Verifica se o armazenamento local está disponível.',
  },
};
const buttons = document.querySelectorAll('button[data-locale]');
const status = document.getElementById('status');

async function start(locale) {
  status.lang = locale;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    status.textContent = messages[locale].local;
    return;
  }
  for (const button of buttons) button.disabled = true;
  try {
    const seed = () => seedEmptySlot(localStorage, locale);
    const written = navigator.locks ? await navigator.locks.request(STORAGE_KEY, seed) : seed();
    if (written) location.assign('../../index.html');
    else status.textContent = messages[locale].occupied;
  } catch { status.textContent = messages[locale].failed; }
  finally { for (const button of buttons) button.disabled = false; }
}

for (const button of buttons) button.addEventListener('click', () => void start(button.dataset.locale));
