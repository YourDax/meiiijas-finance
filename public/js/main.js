// Запуск: слушатели событий, импорт PDF, выбор бюджета.
import { tgw, S, store, api, act, hooks } from './state.js';
import { $, esc, money, dayKey, dayLabel, catIcon, setInfo, toast } from './util.js';
import { closeSheet, sheet, btn } from './ui.js';
import { spendList, render } from './tabs.js';
import { H, deleteSpendWithUndo } from './handlers.js';

hooks.render = render;
hooks.load = (...a) => load(...a);
// Свайп по трате: влево — удалить (с отменой), вправо — изменить
let sw = null;
let suppressClickUntil = 0;
document.addEventListener('touchstart', (e) => {
  const el = e.target.closest?.('[data-swipe]');
  sw = el && e.touches.length === 1 ? { el, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, lock: false } : null;
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!sw) return;
  const dx = e.touches[0].clientX - sw.x;
  const dy = e.touches[0].clientY - sw.y;
  if (!sw.lock) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; } // это обычная прокрутка
    if (Math.abs(dx) < 10) return;
    sw.lock = true;
  }
  sw.dx = Math.max(-140, Math.min(140, dx));
  sw.el.style.transition = 'none';
  sw.el.style.transform = `translateX(${sw.dx}px)`;
}, { passive: true });
const endSwipe = (act_) => {
  if (!sw) return;
  const { el, dx, lock } = sw;
  sw = null;
  el.style.transition = 'transform .15s';
  el.style.transform = '';
  if (!lock) return;
  suppressClickUntil = Date.now() + 400; // палец отпущен — это не тап
  if (act_ && dx <= -90) deleteSpendWithUndo(el.dataset.id);
  else if (act_ && dx >= 90) H['spend-edit']({ ...el.dataset });
};
document.addEventListener('touchend', () => endSwipe(true), { passive: true });
document.addEventListener('touchcancel', () => endSwipe(false), { passive: true });

document.addEventListener('click', (e) => {
  if (Date.now() < suppressClickUntil) { e.preventDefault(); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const h = H[el.dataset.act];
  if (h) Promise.resolve(h({ ...el.dataset }, el)).catch((err) => toast(err.message, true));
});
// Клавиатура: Enter/Пробел нажимают элементы-«кнопки»; Enter в форме нажимает главное действие; Esc закрывает окно
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (e.key === 'Escape' && $('#ov')) return closeSheet();
  if ((e.key === 'Enter' || e.key === ' ') && t.matches?.('[role=button][data-act]')) { e.preventDefault(); return t.click(); }
  if (e.key === 'Enter' && t.tagName === 'INPUT') {
    const quick = t.dataset.enter;
    const primary = quick ? document.querySelector(`[data-act="${quick}"]`) : t.closest('.sheet')?.querySelector('.actions button:not(.ghost):not(.danger)');
    if (primary) { e.preventDefault(); primary.click(); }
  }
});
document.addEventListener('input', (e) => {
  const k = e.target.dataset?.input;
  if (k === 'flt-q') { S.filter.q = e.target.value; const l = $('#spend-list'); if (l) l.innerHTML = spendList(); }
});
document.addEventListener('change', (e) => {
  if (e.target.dataset?.input === 'flt-month') { S.filter.month = e.target.value; const l = $('#spend-list'); if (l) l.innerHTML = spendList(); }
});

// Файл выписки: читаем как base64 и показываем предпросмотр, прежде чем что-то записывать
function bindPdf() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/pdf,.pdf'; inp.id = 'pdf-input'; inp.hidden = true;
  document.body.appendChild(inp);
  inp.addEventListener('change', async () => {
    const f = inp.files?.[0]; inp.value = '';
    if (!f) return;
    if (f.size > 2.5 * 1024 * 1024) return toast('Файл больше 2,5 МБ: выгрузи выписку за более короткий период', true);
    const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(f); });
    const r = await act('import_parse', { pdf: b64 }, { silent: true });
    if (!r) return;
    const sh = sheet('Импорт выписки', `<div class="info"></div>
      ${r.sample.length ? `<div class="list" style="margin-top:10px">${r.sample.map((x) => `<div class="item" style="cursor:default"><div class="ico">${catIcon(x.cat)}</div><div class="grow"><div class="t">${esc(x.name)}</div><div class="s">${dayLabel(dayKey(x.ts))}</div></div><div class="amt">${money(Math.abs(x.amount))}</div></div>`).join('')}</div>${r.rows > r.sample.length ? `<p class="small muted center">…и ещё ${r.rows - r.sample.length}</p>` : ''}` : ''}
      <div class="actions" style="flex-direction:column">
        ${r.balance ? btn('✅ Записать траты и задать остаток', 'import-apply', { id: r.id, balance: 1 }) : ''}
        ${r.rows || r.deposits ? btn(r.rows ? '✅ Записать только траты' : '✅ Готово', 'import-apply', { id: r.id }, r.balance ? 'ghost' : '') : ''}
        ${btn('Отмена', 'import-cancel', { id: r.id }, 'ghost')}</div>`);
    setInfo($('.info', sh), r.preview);
  });
}

// ---------- запуск ----------
// Последнее состояние бюджета хранится на устройстве: приложение открывается сразу, свежие данные подтягиваются следом
const cacheKey = () => `state:${S.chatId}`;
const skeleton = () => { $('#app').innerHTML = '<div class="card sk"></div><div class="card sk tall"></div><div class="card sk"></div>'; };

async function load() {
  if (!S.state) {
    try {
      const cached = JSON.parse(store.get(cacheKey()) ?? 'null');
      if (cached?.today && cached?.cats) { S.state = cached; render(); }
    } catch { /* повреждённый кэш не мешает */ }
    if (!S.state) skeleton();
  }
  document.body.classList.add('spin');
  try {
    const j = await api('state');
    S.state = j.state; S.chatId = j.chatId;
    store.set(cacheKey(), JSON.stringify(j.state));
    render();
  } catch (e) {
    $('#app').innerHTML = `<p class="center pad">${esc(e.message)}</p><p class="center"><button data-act="retry">Повторить</button></p>`;
    hooks.boot = boot;
    H.retry = () => boot();
  } finally { document.body.classList.remove('spin'); }
}

// Цвета статусов зависят от светлой/тёмной темы Telegram
const applyTheme = () => { document.documentElement.dataset.theme = tgw?.colorScheme ?? ''; };

async function boot() {
  applyTheme();
  try { tgw?.onEvent?.('themeChanged', applyTheme); } catch { /* старые клиенты */ }
  if (!tgw?.initData) {
    $('#app').innerHTML = '<div class="card center"><p class="mid">📱 Открой из Telegram</p><p class="muted">Это мини-приложение бота. Отправь боту команду /app и нажми кнопку.</p></div>';
    return;
  }
  try { tgw.ready(); tgw.expand(); tgw.setHeaderColor?.('secondary_bg_color'); tgw.setBackgroundColor?.('secondary_bg_color'); } catch { /* старые клиенты */ }
  bindPdf();
  try {
    const c = await api('chats', {}, null);
    S.chats = c.chats;
    const saved = Number(store.get('chat'));
    const pick = [c.suggest, saved].find((id) => id && c.chats.some((x) => x.id === id));
    S.chatId = pick ?? c.chats[0].id;
  } catch (e) {
    $('#app').innerHTML = `<p class="center pad">${esc(e.message)}</p>`;
    return;
  }
  await load();
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && S.state && !$('#ov')) load(); });
boot();
