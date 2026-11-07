// Нижние окна, поля форм и кнопки.
import { tgw, api } from './state.js';
import { $, esc, setInfo } from './util.js';

// ---------- окна ----------
// Системная кнопка «Назад» Telegram закрывает открытое окно
export function closeSheet() { $('#ov')?.remove(); try { tgw.BackButton?.hide(); } catch { /* старые клиенты */ } }
try { tgw?.BackButton?.onClick(() => closeSheet()); } catch { /* старые клиенты */ }
export function sheet(title, body) {
  closeSheet();
  try { tgw.BackButton?.show(); } catch { /* старые клиенты */ }
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'ov';
  ov.innerHTML = `<div class="sheet"><div class="grab"></div><h3>${esc(title)}</h3>${body}</div>`;
  ov.addEventListener('click', (e) => { if (e.target === ov) closeSheet(); });
  document.body.appendChild(ov);
  const first = ov.querySelector('input:not([type=hidden]),select');
  if (first && !matchMedia('(pointer: coarse)').matches) first.focus();
  return ov.querySelector('.sheet');
}
export const val = (id) => $(`#f-${id}`)?.value ?? '';
export const field = (id, label, extra = '') => `<label for="f-${id}">${label}</label><input id="f-${id}" ${extra}>`;
export const buttons = (...b) => `<div class="actions">${b.join('')}</div>`;
export const btn = (label, act_, data = {}, cls = '') =>
  `<button class="${cls}" data-act="${act_}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${label}</button>`;

export async function infoSheet(title, name, params = {}, extraHtml = '') {
  const sh = sheet(title, `<div class="info muted">Загрузка…</div>${extraHtml}${buttons(btn('Закрыть', 'close', {}, 'ghost'))}`);
  try {
    const j = await api('view', { name, ...params });
    setInfo($('.info', sh), j.html);
    $('.info', sh).classList.remove('muted');
  } catch (e) { $('.info', sh).textContent = e.message; }
}
