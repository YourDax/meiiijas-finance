// Форматирование, разбор сумм, безопасный HTML, тосты и подтверждения.
import { tgw, S } from './state.js';

export const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
// ---------- утилиты ----------
export const money = (n) => `${Math.round(n || 0).toLocaleString('ru-RU')} ${S.state?.currency ?? '₽'}`;
export const isoStr = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
export const dnStr = (dn) => { const t = new Date(dn * 86400000); return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`; };
export const ymLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS_NOM[m - 1]} ${y}`; };
export const ymGen = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; }; // «до июня 2027»
export const tz = () => S.state?.tz || 'Europe/Moscow';
export const dayKey = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: tz() });
export const timeStr = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: tz() });
export const dayLabel = (key) => { const [, m, d] = key.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
export const catIcon = (k) => (S.state.cats[k]?.name ?? '📦').split(' ')[0];
export const catTitle = (k) => (S.state.cats[k]?.name ?? '📦 Другое');
export const thisMonth = () => { const t = S.state.today; return `${t.y}-${String(t.m + 1).padStart(2, '0')}`; };

// Самые частые названия последних трат — для быстрых чипов под формой
export function recentNames(limit = 6) {
  const cnt = new Map();
  for (const x of S.state.spends.slice(0, 80)) {
    const n = (x.name ?? '').trim();
    if (n && n.length <= 20 && x.src !== 'bank') cnt.set(n, (cnt.get(n) ?? 0) + 1);
  }
  return [...cnt].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([n]) => n);
}

// «15к», «1,5к», «80 000» → число; пусто → null
export function parseAmt(s) {
  const m = String(s ?? '').toLowerCase().replace(/\s/g, '').replace(',', '.').match(/^(\d+(?:\.\d+)?)(к|k|тыс)?$/);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  return n > 0 ? Math.round(n * 100) / 100 : null;
}

// Тексты бота приходят в HTML Telegram: пропускаем только безопасные теги
export function safeFragment(src) {
  const doc = new DOMParser().parseFromString(`<body>${src}</body>`, 'text/html');
  const ok = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'CODE', 'PRE']);
  const out = document.createDocumentFragment();
  (function walk(from, to) {
    for (const n of from.childNodes) {
      if (n.nodeType === 3) to.appendChild(document.createTextNode(n.textContent));
      else if (n.nodeType === 1) {
        if (ok.has(n.tagName)) { const e = document.createElement(n.tagName.toLowerCase()); walk(n, e); to.appendChild(e); } else walk(n, to);
      }
    }
  })(doc.body, out);
  return out;
}
export const setInfo = (el, html) => { el.replaceChildren(safeFragment(html)); };

export const haptic = (t) => { try { tgw.HapticFeedback?.notificationOccurred(t); } catch { /* не критично */ } };
export let toastTimer;
// action: { label, run } — кнопка в тосте (например, «Отменить»); такой тост висит дольше
export function toast(msg, isErr = false, action = null) {
  const t = $('#toast');
  t.textContent = msg; t.className = isErr ? 'err' : '';
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-btn'; b.textContent = action.label;
    b.addEventListener('click', () => { t.hidden = true; action.run(); });
    t.append(' ', b);
  }
  t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, action ? 10000 : isErr ? 4000 : 2200);
}
export const ask = (msg) => new Promise((res) => {
  if (tgw?.showConfirm) tgw.showConfirm(msg, (ok) => res(!!ok)); else res(window.confirm(msg));
});
