// Мини-приложение «Бюджет»: интерфейс к тем же данным, что и бот. Все запросы идут в /api/app с подписью Telegram.
const tgw = window.Telegram?.WebApp;
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const S = { state: null, chatId: null, chats: [], tab: 'home', filter: { month: 'cur', q: '' } };
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* без хранилища работаем как обычно */ } },
};

// ---------- утилиты ----------
const money = (n) => `${Math.round(n || 0).toLocaleString('ru-RU')} ${S.state?.currency ?? '₽'}`;
const isoStr = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
const dnStr = (dn) => { const t = new Date(dn * 86400000); return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`; };
const ymLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS_NOM[m - 1]} ${y}`; };
const ymGen = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; }; // «до июня 2027»
const tz = () => S.state?.tz || 'Europe/Moscow';
const dayKey = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: tz() });
const timeStr = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: tz() });
const dayLabel = (key) => { const [, m, d] = key.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
const catIcon = (k) => (S.state.cats[k]?.name ?? '📦').split(' ')[0];
const catTitle = (k) => (S.state.cats[k]?.name ?? '📦 Другое');
const thisMonth = () => { const t = S.state.today; return `${t.y}-${String(t.m + 1).padStart(2, '0')}`; };

// «15к», «1,5к», «80 000» → число; пусто → null
function parseAmt(s) {
  const m = String(s ?? '').toLowerCase().replace(/\s/g, '').replace(',', '.').match(/^(\d+(?:\.\d+)?)(к|k|тыс)?$/);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  return n > 0 ? Math.round(n * 100) / 100 : null;
}

// Тексты бота приходят в HTML Telegram: пропускаем только безопасные теги
function safeFragment(src) {
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
const setInfo = (el, html) => { el.replaceChildren(safeFragment(html)); };

const haptic = (t) => { try { tgw.HapticFeedback?.notificationOccurred(t); } catch { /* не критично */ } };
let toastTimer;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = isErr ? 'err' : ''; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, isErr ? 4000 : 2200);
}
const ask = (msg) => new Promise((res) => {
  if (tgw?.showConfirm) tgw.showConfirm(msg, (ok) => res(!!ok)); else res(window.confirm(msg));
});

// ---------- запросы ----------
async function api(action, payload = {}, chatId = S.chatId) {
  const r = await fetch('/api/app', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData: tgw.initData, chatId: chatId ?? undefined, action, payload }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Ошибка ${r.status}`);
  return j;
}

// Действие, меняющее данные: обновляет состояние и экран. Возвращает result или null при ошибке
async function act(action, payload = {}, { silent = false } = {}) {
  document.body.classList.add('spin');
  try {
    const j = await api(action, payload);
    S.state = j.state;
    render();
    if (!silent) haptic('success');
    return j.result ?? {};
  } catch (e) {
    toast(e.message, true); haptic('error');
    return null;
  } finally {
    document.body.classList.remove('spin');
  }
}

// ---------- окна ----------
function closeSheet() { $('#ov')?.remove(); }
function sheet(title, body) {
  closeSheet();
  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'ov';
  ov.innerHTML = `<div class="sheet"><div class="grab"></div><h3>${esc(title)}</h3>${body}</div>`;
  ov.addEventListener('click', (e) => { if (e.target === ov) closeSheet(); });
  document.body.appendChild(ov);
  const first = ov.querySelector('input:not([type=hidden]),select');
  if (first && !matchMedia('(pointer: coarse)').matches) first.focus();
  return ov.querySelector('.sheet');
}
const val = (id) => $(`#f-${id}`)?.value ?? '';
const field = (id, label, extra = '') => `<label for="f-${id}">${label}</label><input id="f-${id}" ${extra}>`;
const buttons = (...b) => `<div class="actions">${b.join('')}</div>`;
const btn = (label, act_, data = {}, cls = '') =>
  `<button class="${cls}" data-act="${act_}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${label}</button>`;

async function infoSheet(title, name, params = {}, extraHtml = '') {
  const sh = sheet(title, `<div class="info muted">Загрузка…</div>${extraHtml}${buttons(btn('Закрыть', 'close', {}, 'ghost'))}`);
  try {
    const j = await api('view', { name, ...params });
    setInfo($('.info', sh), j.html);
    $('.info', sh).classList.remove('muted');
  } catch (e) { $('.info', sh).textContent = e.message; }
}

// ---------- вкладки ----------
const TABS = [['home', '🏠', 'Главная'], ['spends', '🧾', 'Траты'], ['plan', '📅', 'План'], ['goals', '🎯', 'Цели'], ['reserve', '🏦', 'Резерв'], ['more', '⚙️', 'Ещё']];

function budgetChip() {
  if (S.chats.length < 2) return '';
  const cur = S.chats.find((c) => c.id === S.chatId);
  return `<button class="ghost small" data-act="chats">📒 ${esc(cur?.title ?? 'Бюджет')} ▾</button>`;
}

function homeTab() {
  const s = S.state; const p = s.period;
  const lead = p.reserveOn ? '💳 На карте' : '💼 На руках';
  const left = p.leftToday;
  const pending = p.pending.map((o) => `
    <div class="card"><div class="row"><div class="ico mid">${o.type === 'income' ? '💰' : '📌'}</div>
      <div class="grow"><b>${esc(o.name)}</b><div class="small muted">${isoStr(o.date)}${o.fromReserve ? ' · из резерва' : ''}</div></div>
      <b class="${o.type === 'income' ? 'pos' : ''}">${o.type === 'income' ? '+' : '−'}${money(o.amount)}</b></div>
      <div class="row gap" style="margin-top:10px">
        ${btn(o.type === 'income' ? '✅ Пришло' : '✅ Оплачено', 'occ', { key: o.key }, 'grow')}
        ${btn('Не было', 'occ', { key: o.key, skip: 1 }, 'ghost')}
      </div></div>`).join('');
  const gaps = p.gaps.map((g) => `<div class="card alert bad small">⚠️ Перед «${esc(g.name)}» (${isoStr(g.date)}) не хватит <b>${money(g.short)}</b></div>`).join('');
  const due = p.dueList.length ? `<h2>Ближайшие платежи · ${money(p.dueSum)}</h2><div class="list">${p.dueList.map((o) => `
    <div class="item" style="cursor:default"><div class="ico">📌</div><div class="grow"><div class="t">${esc(o.name)}</div><div class="s">${isoStr(o.date)}</div></div><div class="amt">${money(o.amount)}</div></div>`).join('')}</div>` : '';
  const cats = Object.entries(p.byCatPeriod).sort((a, b) => b[1] - a[1]);
  const total = cats.reduce((x, [, v]) => x + v, 0) || 1;
  const catBlock = cats.length ? `<h2>Траты периода · ${money(p.spentPeriod)}</h2><div class="card">${cats.map(([k, v]) => `
    <div style="margin:6px 0"><div class="row between small"><span>${esc(catTitle(k))}</span><b>${money(v)}</b></div><div class="bar"><i style="width:${Math.round(v / total * 100)}%"></i></div></div>`).join('')}
    ${Object.keys(p.byUserPeriod).length > 1 ? `<div class="small muted" style="margin-top:8px">${Object.entries(p.byUserPeriod).map(([u, v]) => `${esc(u)}: ${money(v)}`).join(' · ')}</div>` : ''}</div>` : '';
  return `
    <div class="row between"><h1>Бюджет</h1>${budgetChip()}</div>
    ${p.shortfall > 0 ? `<div class="card alert bad small">⚠️ До дохода не хватает <b>${money(p.shortfall)}</b> на обязательные платежи.</div>` : ''}
    <div class="card hero">
      <div class="small muted">${lead}${p.hasBalance ? '' : ' · оценка'}</div>
      <div class="mid">${money(p.now)}</div>
      <div class="small muted" style="margin-top:14px">Сегодня ещё можно потратить</div>
      <div class="big ${left <= 0 ? 'neg' : ''}">${money(left)}</div>
      <div class="small muted">из ${money(p.dayBudget)} в день · потрачено ${money(p.spentToday)}</div>
      <div class="stats">
        <div class="stat"><span class="small muted">За период</span><b>${money(p.pool)}</b></div>
        <div class="stat"><span class="small muted">${p.noIncome ? 'До конца месяца' : 'До дохода'}</span><b>${p.days} дн.</b>${p.nextIncome ? `<span class="small muted">${esc(p.nextIncome.name)}, ${isoStr(p.nextIncome.date)}</span>` : ''}</div>
        <div class="stat"><span class="small muted">В неделю</span><b>${money(p.perWeek)}</b></div>
        <div class="stat"><span class="small muted">Платежи до дохода</span><b>${money(p.dueSum)}</b></div>
      </div>
      ${p.hasBalance ? '' : `<div class="small warn" style="margin-top:10px">Задай точный остаток — расчёты станут точнее.</div>`}
    </div>
    ${pending}${gaps}
    <div class="card">
      <div class="row gap"><input id="q-amt" inputmode="decimal" placeholder="Сумма" style="width:34%"><input id="q-name" placeholder="На что (кофе, такси…)" class="grow"></div>
      <div class="row gap" style="margin-top:8px">${btn('🧾 Записать трату', 'quick-spend', {}, 'grow')}${btn('↩️', 'undo-last', {}, 'ghost')}</div>
    </div>
    <div class="row gap wrap" style="margin-bottom:10px">
      ${btn('💼 Остаток', 'balance', {}, 'ghost small')}${btn('💵 Пополнить', 'topup', {}, 'ghost small')}
      ${btn('➕ Доход/платёж', 'item-add', {}, 'ghost small')}${btn('💬 Фразой', 'nl', {}, 'ghost small')}
    </div>
    ${due}${catBlock}
    <h2>Подробнее</h2>
    <div class="row gap wrap">
      ${btn('📋 План подробно', 'view', { name: 'plan', title: 'План подробно' }, 'ghost small')}
      ${btn('🗓 Прогноз', 'forecast', { k: 1 }, 'ghost small')}
      ${btn('📈 Графики', 'view', { name: 'chart', title: 'Графики трат' }, 'ghost small')}
      ${btn('☀️ Дайджест', 'view', { name: 'digest', title: 'Дайджест' }, 'ghost small')}
    </div>`;
}

function spendsTab() {
  const s = S.state;
  const months = [...new Set(s.spends.map((x) => dayKey(x.ts).slice(0, 7)))];
  const cur = thisMonth();
  if (!months.includes(cur)) months.unshift(cur);
  const topups = s.topups.length ? `<h2>Пополнения</h2><div class="list">${s.topups.map((t) => `
    <div class="item" style="cursor:default"><div class="ico">💵</div><div class="grow"><div class="t">${esc(t.name)}</div><div class="s">${dayLabel(dayKey(t.ts))}${t.by ? ` · ${esc(t.by)}` : ''}</div></div><div class="amt pos">+${money(t.amount)}</div>
    ${btn('↩️', 'topup-undo', { id: t.id }, 'ghost small')}</div>`).join('')}</div>` : '';
  return `
    <div class="row between"><h1>Траты</h1>${btn('➕ Трата', 'spend-add', {}, 'small')}</div>
    <div class="row gap"><select id="flt-month" data-input="flt-month" class="grow">
      ${months.map((m) => `<option value="${m}" ${(S.filter.month === 'cur' ? cur : S.filter.month) === m ? 'selected' : ''}>${ymLabel(m)}</option>`).join('')}
      <option value="all" ${S.filter.month === 'all' ? 'selected' : ''}>За всё время</option></select>
      <input id="flt-q" data-input="flt-q" placeholder="Поиск" value="${esc(S.filter.q)}" class="grow"></div>
    <div id="spend-list">${spendList()}</div>${topups}`;
}

function spendList() {
  const s = S.state;
  const month = S.filter.month === 'cur' ? thisMonth() : S.filter.month;
  const q = S.filter.q.trim().toLowerCase();
  const rows = s.spends.filter((x) => (month === 'all' || dayKey(x.ts).startsWith(month))
    && (!q || `${x.name} ${catTitle(x.cat)} ${x.by ?? ''}`.toLowerCase().includes(q)));
  if (!rows.length) return '<p class="muted center pad">Трат нет</p>';
  const sum = rows.reduce((a, x) => a + x.amount, 0);
  const groups = new Map();
  for (const x of rows) { const k = dayKey(x.ts); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
  const note = s.spendsTotal > s.spends.length ? `<p class="small muted center">Показаны последние ${s.spends.length} из ${s.spendsTotal}</p>` : '';
  return `<div class="card row between"><span class="muted">Итого</span><b>${money(sum)}</b></div>
    ${[...groups].map(([k, list]) => `<h2>${dayLabel(k)} · ${money(list.reduce((a, x) => a + x.amount, 0))}</h2><div class="list">${list.map((x) => `
      <div class="item" data-act="spend-edit" data-id="${esc(x.id)}"><div class="ico">${catIcon(x.cat)}</div>
        <div class="grow"><div class="t">${esc(x.name || catTitle(x.cat))}</div><div class="s">${timeStr(x.ts)}${x.by ? ` · ${esc(x.by)}` : ''}${x.src === 'bank' ? ' · из выписки' : ''}</div></div>
        <div class="amt">${money(x.amount)}</div></div>`).join('')}</div>`).join('')}${note}`;
}

const whenText = (it) => it.spread ? 'В течение месяца' : it.once ? `Один раз · ${it.day}-го, ${ymLabel(it.once)}` : `Каждый месяц · ${it.day}-го`;

function planTab() {
  const s = S.state;
  const sect = (title, list) => list.length ? `<h2>${title}</h2><div class="list">${list.map((it) => `
    <div class="item" data-act="item-edit" data-id="${esc(it.id)}"><div class="ico">${it.type === 'income' ? '💰' : it.spread ? catIcon(it.cat) : '📌'}</div>
      <div class="grow"><div class="t">${esc(it.name)}</div><div class="s">${whenText(it)}${it.type === 'bill' && !it.spread && it.fromReserve ? ' · 🏠 из резерва' : ''}${it.by ? ` · ${esc(it.by)}` : ''}</div></div>
      <div class="amt ${it.type === 'income' ? 'pos' : ''}">${money(it.amount)}</div></div>`).join('')}</div>` : '';
  const by = (f) => s.items.filter(f).sort((a, b) => (a.day ?? 99) - (b.day ?? 99));
  return `
    <div class="row between"><h1>План</h1>${btn('➕ Добавить', 'item-add', {}, 'small')}</div>
    <div class="card"><div class="row between"><span class="muted">Доходы в месяц</span><b class="pos">${money(s.plan.totalIncome)}</b></div>
      <div class="row between"><span class="muted">Обязательные</span><b>${money(s.plan.totalBills)}</b></div>
      <div class="row between"><span class="muted">Свободно</span><b class="${s.plan.free < 0 ? 'neg' : ''}">${money(s.plan.free)}</b></div></div>
    ${sect('Доходы', by((i) => i.type === 'income' && !i.once))}
    ${sect('Платежи по датам', by((i) => i.type === 'bill' && !i.spread && !i.once))}
    ${sect('В течение месяца', by((i) => i.spread))}
    ${sect('Разовые', by((i) => i.once && !i.spread))}
    ${s.items.length ? '' : '<p class="muted center pad">Пока пусто. Добавь доход и обязательные платежи.</p>'}
    <div class="row gap wrap" style="margin-top:14px">
      ${btn('💬 Записать фразой', 'nl', {}, 'ghost small')}${btn('🗓 Прогноз', 'forecast', { k: 1 }, 'ghost small')}${btn('📋 Подробный план', 'view', { name: 'plan', title: 'План подробно' }, 'ghost small')}
    </div>`;
}

function goalsTab() {
  const gs = S.state.goals;
  return `<div class="row between"><h1>Цели</h1>${btn('➕ Цель', 'goal-add', {}, 'small')}</div>
    ${gs.length ? gs.map((g) => { const st = g.status; return `
      <div class="card"><div class="row between"><b>🎯 ${esc(g.name)}</b>${st.done ? '<span class="tag">готово ✅</span>' : st.overdue ? '<span class="tag">срок вышел</span>' : ''}</div>
        <div class="small muted">до ${ymGen(g.deadline)}${st.done ? '' : ` · осталось ${st.monthsLeft} мес.`}</div>
        <div class="bar ${st.done ? 'ok' : ''}" style="margin:10px 0 6px"><i style="width:${st.percent}%"></i></div>
        <div class="row between small"><span>${money(g.saved)} из ${money(g.target)}</span><b>${st.percent}%</b></div>
        ${st.done ? '' : `<div class="small muted">Откладывать по ${money(st.perMonth)} в месяц</div>`}
        <div class="row gap" style="margin-top:10px">${btn('🐷 Отложить', 'goal-save', { id: g.id }, 'grow')}${btn('Удалить', 'goal-del', { id: g.id }, 'danger')}</div></div>`; }).join('')
      : '<p class="muted center pad">Целей пока нет.<br>Например: «Отпуск», 200 000, июнь 2027.</p>'}
    <div class="row gap wrap">${btn('📋 Сводка по целям', 'view', { name: 'goals', title: 'Цели' }, 'ghost small')}</div>`;
}

function reserveTab() {
  const s = S.state; const r = s.reserve;
  const incomes = s.items.filter((i) => i.type === 'income' && !i.once);
  if (!r) return `<h1>Резерв</h1><div class="card"><p>Резерв — отдельный счёт под аренду, коммуналку и интернет. Платежи из него не уменьшают остаток на карте.</p>
    ${btn('🏠 Включить резерв', 'reserve-set', {}, 'block')}</div>
    <h2>Транспорт</h2><div class="card"><p class="small muted">Формула: проездной + ставка за каждый будний день цикла.</p>${btn('🚌 Настроить транспорт', 'transport', {}, 'ghost block')}</div>`;
  return `<h1>Резерв</h1>
    <div class="card hero"><div class="small muted">Отложено на аренду и коммуналку</div><div class="big">${money(r.amount)}</div>
      ${r.contract ? `<div class="small muted">Счёт: договор …${esc(r.contract)}</div>` : ''}
      ${s.settings.reserveStep ? `<div class="small muted">Перевод округляется до ${money(s.settings.reserveStep)}</div>` : ''}</div>
    <div class="row gap wrap" style="margin-bottom:10px">${btn('➕ Перевёл в резерв', 'reserve-deposit', {}, 'grow')}${btn('✏️ Остаток', 'reserve-set', {}, 'ghost')}</div>
    <div class="info card" data-view="reserve"></div>
    ${incomes.length ? `<h2>Сколько переводить с дохода</h2><div class="list">${incomes.map((i) => `
      <div class="item" data-act="reserve-plan" data-id="${esc(i.id)}"><div class="ico">💰</div><div class="grow"><div class="t">${esc(i.name)}</div><div class="s">${i.toReserve ? 'задано вручную' : 'автоматически'}</div></div><div class="amt">${i.toReserve ? money(i.toReserve) : 'авто'}</div></div>`).join('')}</div>` : ''}
    <h2>Настройки</h2>
    <div class="row gap wrap">${btn('🔢 Округление', 'reserve-step', {}, 'ghost small')}${btn('📄 Договор', 'reserve-contract', {}, 'ghost small')}${btn('🚌 Транспорт', 'transport', {}, 'ghost small')}${btn('Выключить резерв', 'reserve-off', {}, 'danger small')}</div>`;
}

function moreTab() {
  const s = S.state;
  const row = (ico, title, sub, act_, data = {}) => `<div class="item" data-act="${act_}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}><div class="ico">${ico}</div><div class="grow"><div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div><span class="muted">›</span></div>`;
  return `<h1>Ещё</h1>
    ${S.chats.length > 1 ? `<div class="list">${row('📒', 'Бюджет', esc(S.chats.find((c) => c.id === S.chatId)?.title ?? ''), 'chats')}</div>` : ''}
    <h2>Данные</h2><div class="list">
      ${row('📥', 'Импорт выписки Т-Банка', 'PDF «Справка о движении средств»', 'import')}
      ${row('📈', 'Графики трат', 'по категориям, дням и людям', 'view', { name: 'chart', title: 'Графики трат' })}
      ${row('🗓', 'Планирование вперёд', 'прогноз на следующие месяцы', 'forecast', { k: 1 })}
      ${row('🕘', 'История изменений', `${s.log.length ? s.log.length + ' последних записей' : 'пока пусто'}`, 'log')}
    </div>
    <h2>Помощники</h2><div class="list">
      ${row('🤖', 'Промт для ИИ', 'данные бюджета для ChatGPT или Claude', 'ai')}
      ${row('📋', 'Что внести', 'чек-лист: чего ещё не хватает', 'view', { name: 'guide', title: 'Что внести' })}
      ${row('⌨️', 'Команды бота', 'любая команда или фраза, как в чате', 'console')}
      ${row('❓', 'Справка', '', 'view', { name: 'help', title: 'Справка' })}
    </div>
    <h2>Настройки</h2><div class="list">
      ${row('☀️', 'Утренний дайджест', s.settings.digest ? 'включён' : 'выключен', 'digest')}
      ${row('📆', 'Цикл бюджета', s.settings.cycleAnchor ? `с ${s.settings.cycleAnchor}-го числа` : 'авто (по основному доходу)', 'cycle')}
    </div>
    <h2>Опасная зона</h2><div class="list">${row('♻️', '<span class="neg">Стереть все данные</span>', 'бюджет этого чата будет очищен', 'reset')}</div>
    <p class="small muted center">Изменения сразу видны в боте, а закреплённая сводка в чате обновляется сама.</p>`;
}

const TAB = { home: homeTab, spends: spendsTab, plan: planTab, goals: goalsTab, reserve: reserveTab, more: moreTab };

function render() {
  if (!S.state) return;
  const tabs = $('#tabs');
  tabs.hidden = false;
  tabs.innerHTML = TABS.map(([k, ico, label]) => `<button class="${S.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}"><span>${ico}</span>${label}</button>`).join('');
  $('#app').innerHTML = TAB[S.tab]();
  document.querySelectorAll('#app [data-view]').forEach(async (el) => {
    try { setInfo(el, (await api('view', { name: el.dataset.view })).html); } catch { el.textContent = ''; }
  });
}

// ---------- формы ----------
function itemForm(it) {
  const spreadable = it ? it.type === 'bill' : true;
  return `
    ${it ? '' : `<label for="f-type">Что это</label><select id="f-type"><option value="income">💰 Доход</option><option value="bill" selected>📌 Обязательный платёж</option></select>`}
    ${field('name', 'Название', `value="${esc(it?.name ?? '')}" maxlength="60" placeholder="Аренда, Зарплата…"`)}
    ${field('amount', 'Сумма', `inputmode="decimal" value="${it ? it.amount : ''}" placeholder="25000 или 25к"`)}
    ${it ? '' : `<label for="f-sched">Когда</label><select id="f-sched"><option value="monthly">Каждый месяц, в определённое число</option><option value="spread" id="o-spread">В течение месяца (без даты)</option><option value="once">Один раз</option></select>
      <div id="w-day">${field('day', 'Число месяца', 'inputmode="numeric" placeholder="1–31"')}</div>
      <div id="w-once" hidden><label for="f-once">Месяц</label><input id="f-once" type="month" value="${thisMonth()}"></div>`}
    ${it ? `<label for="f-when">Когда (число, «в течение месяца», «в ноябре»)</label><input id="f-when" value="${esc(whenText(it).replace(/^Каждый месяц · /, ''))}">` : ''}
    ${it?.spread ? `<label for="f-cat">Категория</label><select id="f-cat">${Object.entries(S.state.cats).map(([k, c]) => `<option value="${k}" ${it.cat === k ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : ''}
    ${spreadable ? '' : ''}`;
}

function bindItemForm(sh) {
  const type = $('#f-type', sh); const sched = $('#f-sched', sh);
  if (!sched) return;
  const sync = () => {
    const isIncome = type.value === 'income';
    $('#o-spread', sh).disabled = isIncome;
    if (isIncome && sched.value === 'spread') sched.value = 'monthly';
    $('#w-day', sh).hidden = sched.value === 'spread';
    $('#w-once', sh).hidden = sched.value !== 'once';
  };
  type.addEventListener('change', sync); sched.addEventListener('change', sync); sync();
}

function confirmCard(c) {
  if (c.kind === 'goal') return `<div class="card">🎯 <b>${esc(c.name)}</b><br>${money(c.amount)} · до ${ymGen(c.deadline)}</div>`;
  const line = (it) => `${it.kind === 'spend' ? '🧾' : it.kind === 'income' ? '💰' : '📌'} <b>${esc(it.name)}</b> — ${money(it.amount)}${it.kind === 'spend' ? '' : ` · ${it.spread ? 'в течение месяца' : it.once ? `один раз, ${it.day}-го` : `каждое ${it.day}-е`}`}`;
  if (c.kind === 'batch') return `<div class="card small">${c.items.map((it) => `<div style="margin:4px 0">${line(it)}</div>`).join('')}${c.skipped?.length ? `<div class="warn" style="margin-top:8px">Не разобрал: ${c.skipped.map(esc).join('; ')}</div>` : ''}</div>`;
  return `<div class="card">${line(c)}${c.dayAuto && c.kind === 'income' ? '<div class="small muted" style="margin-top:6px">Число не указано — взял сегодняшнее. Лучше добавить вручную.</div>' : ''}</div>`;
}
let pendingConfirm = null;
function confirmSheet(c) {
  pendingConfirm = c;
  const title = c.kind === 'goal' ? 'Создать цель?' : c.kind === 'batch' ? `Записать ${c.items.length} пунктов?` : c.kind === 'income' ? 'Записать доход?' : 'Записать платёж?';
  sheet(title, confirmCard(c) + buttons(btn('✅ Записать', 'nl-commit'), btn('Отмена', 'close', {}, 'ghost')));
}

// ---------- действия ----------
const H = {
  close: () => closeSheet(),
  tab: (d) => { S.tab = d.tab; render(); scrollTo(0, 0); },

  async chats() {
    sheet('Выбери бюджет', `<div class="list">${S.chats.map((c) => `<div class="item" data-act="pick-chat" data-id="${c.id}"><div class="ico">${c.type === 'private' ? '👤' : '👥'}</div><div class="grow"><div class="t">${esc(c.title)}</div></div>${c.id === S.chatId ? '✅' : ''}</div>`).join('')}</div>
      <p class="small muted">Беседа появляется здесь после того, как ты напишешь боту в ней.</p>`);
  },
  async 'pick-chat'(d) { closeSheet(); S.chatId = Number(d.id); store.set('chat', String(S.chatId)); await load(); },

  async 'quick-spend'() {
    const amount = parseAmt($('#q-amt').value);
    if (!amount) return toast('Введи сумму, например 450 или 1,5к', true);
    const r = await act('spend_add', { amount, name: $('#q-name').value.trim() });
    if (r) toast(`Записано: ${money(amount)}`);
  },
  async 'undo-last'() { const r = await act('spend_undo'); if (r?.undone) toast(`Отменено: ${money(r.undone.amount)} ${r.undone.name ?? ''}`); },

  async occ(d) {
    const r = await act('occ', { key: d.key, skip: !!d.skip });
    if (!r) return;
    if (r.transfer) {
      const t = r.transfer;
      sheet('🏠 Перевод в резерв', `<p><b>${esc(t.name)}</b> пришёл. Переведи на резерв <b>${money(t.amount)}</b>.</p>
        <p class="small muted">К ${isoStr(t.deadline)} нужно ${money(t.need)}, в резерве ${money(t.have)}${t.later.length ? `. Остальное закроет доход: ${t.later.map((x) => `${isoStr(x.date)} +${money(x.amount)}`).join(', ')}` : ''}.</p>
        ${buttons(btn(`✅ Перевёл ${money(t.amount)}`, 'reserve-quick', { amount: t.amount }), btn('Другая сумма', 'reserve-deposit', {}, 'ghost'))}${r.leftover ? '' : buttons(btn('Позже', 'close', {}, 'ghost'))}`);
      pendingConfirm = r.leftover ?? null;
    } else if (r.leftover) leftoverSheet(r.leftover);
  },
  async 'reserve-quick'(d) { closeSheet(); await act('reserve_deposit', { amount: Number(d.amount) }); if (pendingConfirm?.goals) { const l = pendingConfirm; pendingConfirm = null; leftoverSheet(l); } },
  async 'goal-leftover'(d) { closeSheet(); await act('goal_save', { id: d.id, amount: Number(d.amount) }); },

  balance() {
    sheet('Остаток на руках', `<p class="small muted">Сколько денег на карте прямо сейчас. От этого зависит дневной лимит.</p>${field('amount', 'Сумма', `inputmode="decimal" value="${S.state.balance ? S.state.cardBalance : ''}" placeholder="12000"`)}${buttons(btn('Сохранить', 'balance-save'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'balance-save'() {
    const raw = val('amount').trim();
    const a = raw === '0' ? 0 : parseAmt(raw);
    if (a === null) return toast('Не понял сумму', true);
    if (await act('balance_set', { amount: a })) closeSheet();
  },
  topup() {
    sheet('Пополнение баланса', `<p class="small muted">Разовое поступление: подарок, возврат, подработка.</p>${field('amount', 'Сумма', 'inputmode="decimal" placeholder="5000"')}${field('name', 'Откуда', 'maxlength="40" placeholder="Подарок"')}${buttons(btn('Пополнить', 'topup-save'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'topup-save'() {
    const amount = parseAmt(val('amount'));
    if (!amount) return toast('Введи сумму', true);
    if (await act('topup', { amount, name: val('name') })) closeSheet();
  },
  async 'topup-undo'(d) { if (await ask('Отменить это пополнение?')) await act('topup_undo', { id: d.id }); },

  'spend-add'() {
    sheet('Новая трата', `${field('amount', 'Сумма', 'inputmode="decimal" placeholder="450"')}${field('name', 'На что', 'maxlength="60" placeholder="Кофе"')}
      <label for="f-cat">Категория</label><select id="f-cat"><option value="">Определить автоматически</option>${Object.entries(S.state.cats).map(([k, c]) => `<option value="${k}">${esc(c.name)}</option>`).join('')}</select>
      ${buttons(btn('Записать', 'spend-add-save'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'spend-add-save'() {
    const amount = parseAmt(val('amount'));
    if (!amount) return toast('Введи сумму', true);
    if (await act('spend_add', { amount, name: val('name'), cat: val('cat') || undefined })) closeSheet();
  },
  'spend-edit'(d) {
    const x = S.state.spends.find((s) => s.id === d.id);
    if (!x) return;
    const spreads = S.state.items.filter((i) => i.spread);
    sheet('Трата', `<p class="small muted">${dayLabel(dayKey(x.ts))}, ${timeStr(x.ts)}${x.by ? ` · ${esc(x.by)}` : ''}${x.src === 'bank' ? ' · из выписки' : ''}</p>
      ${field('amount', 'Сумма', `inputmode="decimal" value="${x.amount}"`)}${field('name', 'Название', `maxlength="60" value="${esc(x.name)}"`)}
      <label for="f-cat">Категория</label><select id="f-cat">${Object.entries(S.state.cats).map(([k, c]) => `<option value="${k}" ${x.cat === k ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      ${spreads.length ? `<label for="f-link">Засчитывать в обязательную трату</label><select id="f-link"><option value="auto" ${!x.linkId ? 'selected' : ''}>Автоматически по категории</option><option value="none" ${x.linkId === 'none' ? 'selected' : ''}>Не засчитывать</option>${spreads.map((i) => `<option value="${esc(i.id)}" ${x.linkId === i.id ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select>` : ''}
      <input type="hidden" id="f-id" value="${esc(x.id)}">
      ${buttons(btn('Сохранить', 'spend-save'), btn('Удалить', 'del', { id: x.id }, 'danger'))}`);
  },
  async 'spend-save'() {
    const id = val('id'); const x = S.state.spends.find((s) => s.id === id);
    if (!x) return;
    const amount = parseAmt(val('amount'));
    if (!amount) return toast('Не понял сумму', true);
    const steps = [];
    if (amount !== x.amount) steps.push(['edit', { id, field: 'amount', value: String(amount) }]);
    if (val('name') !== x.name) steps.push(['edit', { id, field: 'name', value: val('name') }]);
    if (val('cat') && val('cat') !== x.cat) steps.push(['edit_cat', { id, cat: val('cat') }]);
    if ($('#f-link') && val('link') !== (x.linkId ?? 'auto')) steps.push(['edit_link', { id, link: val('link') }]);
    for (const [a, p] of steps) if (!(await act(a, p, { silent: true }))) return;
    closeSheet(); haptic('success');
  },
  async del(d) { if (await ask('Удалить?')) { if (await act('delete', { id: d.id })) closeSheet(); } },

  'item-add'() {
    const sh = sheet('Новый пункт плана', itemForm(null) + buttons(btn('Добавить', 'item-add-save'), btn('Отмена', 'close', {}, 'ghost')));
    bindItemForm(sh);
  },
  async 'item-add-save'() {
    const type = val('type'); const sched = val('sched');
    const amount = parseAmt(val('amount'));
    if (!amount) return toast('Введи сумму', true);
    const p = { type, amount, name: val('name') };
    if (sched === 'spread') p.spread = true;
    else { p.day = Number(val('day')); if (sched === 'once') p.once = val('once'); }
    if (await act('item_add', p)) closeSheet();
  },
  'item-edit'(d) {
    const it = S.state.items.find((i) => i.id === d.id);
    if (!it) return;
    const reserveBtn = it.type === 'bill' && !it.spread ? btn(it.fromReserve ? '💳 Платить с карты' : '🏠 Платить из резерва', 'toggle-reserve', { id: it.id }, 'ghost') : '';
    sheet(it.type === 'income' ? 'Доход' : 'Платёж', `${itemForm(it)}<input type="hidden" id="f-id" value="${esc(it.id)}">
      ${reserveBtn ? `<div class="actions" style="margin-top:10px">${reserveBtn}</div>` : ''}
      ${buttons(btn('Сохранить', 'item-save'), btn('Удалить', 'del', { id: it.id }, 'danger'))}`);
  },
  async 'item-save'() {
    const id = val('id'); const it = S.state.items.find((i) => i.id === id);
    if (!it) return;
    const amount = parseAmt(val('amount'));
    if (!amount) return toast('Не понял сумму', true);
    const steps = [];
    if (amount !== it.amount) steps.push(['edit', { id, field: 'amount', value: String(amount) }]);
    if (val('name') !== it.name) steps.push(['edit', { id, field: 'name', value: val('name') }]);
    const w = val('when').trim();
    if (w && w !== whenText(it).replace(/^Каждый месяц · /, '')) steps.push(['edit', { id, field: 'when', value: w }]);
    if ($('#f-cat') && val('cat') !== it.cat) steps.push(['edit_cat', { id, cat: val('cat') }]);
    for (const [a, p] of steps) if (!(await act(a, p, { silent: true }))) return;
    closeSheet(); haptic('success');
  },
  async 'toggle-reserve'(d) { if (await act('toggle_reserve', { id: d.id })) closeSheet(); },

  'goal-add'() {
    sheet('Новая цель', `${field('name', 'Название', 'maxlength="40" placeholder="Отпуск"')}${field('target', 'Сколько нужно', 'inputmode="decimal" placeholder="200000 или 200к"')}
      <label for="f-deadline">К какому месяцу</label><input id="f-deadline" type="month" min="${thisMonth()}">
      ${buttons(btn('Создать', 'goal-add-save'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'goal-add-save'() {
    const target = parseAmt(val('target'));
    if (!target || !val('deadline')) return toast('Укажи сумму и месяц', true);
    if (await act('goal_add', { name: val('name'), target, deadline: val('deadline') })) closeSheet();
  },
  'goal-save'(d) {
    const g = S.state.goals.find((x) => x.id === d.id);
    sheet(`Отложить в «${g?.name ?? ''}»`, `<p class="small muted">Эта сумма уйдёт из свободных денег${S.state.balance ? ' и вычтется из остатка' : ''}.</p>${field('amount', 'Сумма', `inputmode="decimal" placeholder="${g?.status.perMonth ?? ''}" value="${g?.status.perMonth ?? ''}"`)}<input type="hidden" id="f-id" value="${esc(d.id)}">${buttons(btn('🐷 Отложить', 'goal-save-do'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'goal-save-do'() {
    const amount = parseAmt(val('amount'));
    if (!amount) return toast('Введи сумму', true);
    const r = await act('goal_save', { id: val('id'), amount });
    if (r) { closeSheet(); toast(`Накоплено ${money(r.saved)} из ${money(r.target)}`); }
  },
  async 'goal-del'(d) { if (await ask('Удалить цель?')) await act('goal_delete', { id: d.id }); },

  'reserve-set'() {
    sheet('Остаток резерва', `<p class="small muted">Сколько сейчас лежит на счёте под аренду, коммуналку и интернет.</p>${field('amount', 'Сумма', `inputmode="decimal" value="${S.state.reserve?.amount ?? ''}" placeholder="46000"`)}${buttons(btn('Сохранить', 'reserve-set-save'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'reserve-set-save'() {
    const raw = val('amount').trim(); const a = raw === '0' ? 0 : parseAmt(raw);
    if (a === null) return toast('Не понял сумму', true);
    const r = await act('reserve_set', { amount: a });
    if (!r) return;
    if (r.askSubtract) {
      sheet('Вычесть из остатка карты?', `<p>Раньше «Остаток» мог включать эти деньги. Вычесть ${money(a)} из остатка на карте?</p>${buttons(btn(`Вычесть ${money(a)}`, 'reserve-sub', { amount: a }), btn('Остаток уже без резерва', 'close', {}, 'ghost'))}`);
    } else closeSheet();
  },
  async 'reserve-sub'(d) { if (await act('reserve_subtract', { amount: Number(d.amount) })) closeSheet(); },
  'reserve-deposit'() {
    sheet('Перевёл в резерв', `${field('amount', 'Сколько', 'inputmode="decimal" placeholder="30000 или 30к"')}${buttons(btn('Записать', 'reserve-deposit-save'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'reserve-deposit-save'() {
    const amount = parseAmt(val('amount'));
    if (!amount) return toast('Введи сумму', true);
    const r = await act('reserve_deposit', { amount });
    if (r) { closeSheet(); toast(`В резерве ${money(r.total)}`); }
  },
  'reserve-plan'(d) {
    const it = S.state.items.find((i) => i.id === d.id);
    sheet(`Взнос с «${it?.name ?? ''}»`, `<p class="small muted">Сколько переводить в резерв с этого дохода. 0 — автоматически.</p>${field('amount', 'Сумма', `inputmode="decimal" value="${it?.toReserve ?? ''}" placeholder="0"`)}<input type="hidden" id="f-id" value="${esc(d.id)}">${buttons(btn('Сохранить', 'reserve-plan-save'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'reserve-plan-save'() {
    const raw = val('amount').trim() || '0'; const a = raw === '0' ? 0 : parseAmt(raw);
    if (a === null) return toast('Не понял сумму', true);
    if (await act('reserve_plan', { id: val('id'), amount: a })) closeSheet();
  },
  'reserve-step'() { sheet('Округление перевода', `<p class="small muted">До какой суммы округлять перевод в резерв вверх.</p>${field('amount', 'Шаг', `inputmode="decimal" value="${S.state.settings.reserveStep ?? 1000}"`)}${buttons(btn('Сохранить', 'reserve-step-save'), btn('Отмена', 'close', {}, 'ghost'))}`); },
  async 'reserve-step-save'() { const a = parseAmt(val('amount')); if (!a) return toast('Не понял сумму', true); if (await act('reserve_step', { amount: a })) closeSheet(); },
  'reserve-contract'() { sheet('Счёт резерва', `<p class="small muted">Последние цифры номера договора: по ним бот узнает переводы на резерв в выписке.</p>${field('number', 'Номер договора', `inputmode="numeric" value="${esc(S.state.reserve?.contract ?? '')}" placeholder="8861"`)}${buttons(btn('Сохранить', 'reserve-contract-save'), btn('Отмена', 'close', {}, 'ghost'))}`); },
  async 'reserve-contract-save'() { if (val('number').replace(/\D/g, '').length < 3) return toast('Нужно хотя бы 3 цифры', true); if (await act('reserve_contract', { number: val('number') })) closeSheet(); },
  async 'reserve-off'() { if (await ask('Выключить резерв? Платежи будут считаться с карты.')) await act('reserve_off'); },
  transport() {
    sheet('Транспорт по формуле', `<p class="small muted">Проездной + ставка за каждый будний день цикла. Дальше бот пересчитывает сам.</p>${field('base', 'Проездной', 'inputmode="decimal" placeholder="3500"')}${field('daily', 'За каждый будний день', 'inputmode="decimal" placeholder="180"')}${buttons(btn('Сохранить', 'transport-save'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'transport-save'() {
    const base = parseAmt(val('base')); const daily = parseAmt(val('daily'));
    if (!base || !daily) return toast('Заполни обе суммы', true);
    if (await act('transport', { base, daily })) closeSheet();
  },

  nl() {
    sheet('Написать фразой', `<p class="small muted">Как в чате с ботом: «кофе 450», «аванс 80к 5 числа», «аренда 25000 1-го», «цель 200к к июню отпуск», «отложил 5000 на отпуск». Можно несколькими строками.</p>
      <textarea id="f-text" rows="4" placeholder="кофе 450"></textarea>${buttons(btn('Отправить', 'nl-send'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'nl-send'() {
    const text = val('text').trim();
    if (!text) return;
    const r = await act('nl', { text }, { silent: true });
    if (!r) return;
    if (r.done) { closeSheet(); toast(r.done); haptic('success'); } else if (r.confirm) confirmSheet(r.confirm); else if (r.reply) { const sh = sheet('Ответ', `<div class="info"></div>${buttons(btn('Ок', 'close'))}`); setInfo($('.info', sh), r.reply); } else closeSheet();
  },
  async 'nl-commit'() { const c = pendingConfirm; if (c && (await act('nl_commit', { confirm: c }))) { closeSheet(); pendingConfirm = null; } },

  console() {
    sheet('Команды бота', `<p class="small muted">Любая команда из справки: <code>/reserve plan Зарплата 30000</code>, <code>/next 2</code>, <code>/chart</code>…</p><input id="f-cmd" placeholder="/plan"><div class="info card" id="cmd-out" style="margin-top:12px" hidden></div>${buttons(btn('Выполнить', 'console-run'), btn('Закрыть', 'close', {}, 'ghost'))}`);
  },
  async 'console-run'() {
    const text = val('cmd').trim(); if (!text) return;
    const r = await act('command', { text }, { silent: true });
    const out = $('#cmd-out'); if (!r) return;
    out.hidden = false; setInfo(out, r.reply);
  },

  async view(d) { return infoSheet(d.title || 'Подробнее', d.name); },
  async forecast(d) {
    const k = Math.min(6, Math.max(1, Number(d.k) || 1));
    return infoSheet('Планирование вперёд', 'forecast', { k }, `<div class="actions" style="margin-bottom:8px">${btn('← Раньше', 'forecast', { k: k - 1 }, 'ghost')}${btn('Дальше →', 'forecast', { k: k + 1 }, 'ghost')}</div>`);
  },
  async log() {
    const l = S.state.log;
    sheet('История изменений', l.length ? `<div class="list">${l.map((e) => `<div class="item" style="cursor:default"><div class="grow"><div class="t" style="white-space:normal">${esc(e.text ?? e.t ?? '')}</div><div class="s">${dayLabel(dayKey(e.ts))}, ${timeStr(e.ts)}</div></div></div>`).join('')}</div>` : '<p class="muted">Пока пусто.</p>');
  },
  ai() {
    sheet('Промт для ИИ', `<p class="small muted">Соберу данные бюджета и список изменений. Скопируй и вставь в ChatGPT или Claude.</p>${field('q', 'Вопрос (необязательно)', 'maxlength="500" placeholder="Стоит ли брать ноутбук за 80к?"')}<div class="info card" id="ai-out" style="margin-top:12px" hidden></div>${buttons(btn('Собрать промт', 'ai-run'), btn('📋 Копировать', 'ai-copy', {}, 'ghost'))}`);
  },
  async 'ai-run'() {
    try {
      const j = await api('view', { name: 'ai', question: val('q') });
      const out = $('#ai-out'); out.hidden = false; out.textContent = j.html; out.style.userSelect = 'all';
    } catch (e) { toast(e.message, true); }
  },
  async 'ai-copy'() {
    const t = $('#ai-out')?.textContent; if (!t) return toast('Сначала собери промт', true);
    try { await navigator.clipboard.writeText(t); toast('Скопировано'); } catch { toast('Нажми на текст и скопируй вручную', true); }
  },

  import() { $('#pdf-input').click(); },
  async 'import-apply'(d) {
    const r = await act('import_apply', { id: d.id, withBalance: !!d.balance });
    if (r) { closeSheet(); toast(`Записано трат: ${r.rows} на ${money(r.total)}`); }
  },
  async 'import-cancel'(d) { await act('import_cancel', { id: d.id }, { silent: true }); closeSheet(); },

  async digest() { await act('digest', { on: !S.state.settings.digest }); },
  cycle() {
    sheet('Цикл бюджета', `<p class="small muted">С какого числа считать «месяц» для трат без даты. «Авто» — по самому раннему регулярному доходу.</p>${field('day', 'Число месяца (1–31) или «авто»', `value="${S.state.settings.cycleAnchor ?? 'авто'}"`)}${buttons(btn('Сохранить', 'cycle-save'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'cycle-save'() {
    const v = val('day').trim().toLowerCase();
    const day = /^(авто|auto)$/.test(v) ? 'auto' : Number(v);
    if (day !== 'auto' && !(Number.isInteger(day) && day >= 1 && day <= 31)) return toast('Число от 1 до 31 или «авто»', true);
    if (await act('cycle', { day })) closeSheet();
  },
  async reset() {
    if (!(await ask('Стереть ВСЕ данные этого бюджета? Это нельзя отменить.'))) return;
    if (!(await ask('Точно стереть? Доходы, платежи, траты и цели будут удалены.'))) return;
    await act('reset', { confirm: true });
  },
};

function leftoverSheet(l) {
  sheet('🎉 Остаток прошлого периода', `<p>Не потрачено <b>${money(l.amount)}</b>. Отложить в цель?</p><div class="list">${l.goals.map((g) => `<div class="item" data-act="goal-leftover" data-id="${esc(g.id)}" data-amount="${l.amount}"><div class="ico">🎯</div><div class="grow"><div class="t">${esc(g.name)}</div></div><div class="amt">+${money(l.amount)}</div></div>`).join('')}</div>${buttons(btn('Оставить себе', 'close', {}, 'ghost'))}`);
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const h = H[el.dataset.act];
  if (h) Promise.resolve(h({ ...el.dataset }, el)).catch((err) => toast(err.message, true));
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
async function load() {
  document.body.classList.add('spin');
  try {
    const j = await api('state');
    S.state = j.state; S.chatId = j.chatId;
    render();
  } catch (e) {
    $('#app').innerHTML = `<p class="center pad">${esc(e.message)}</p><p class="center"><button data-act="retry">Повторить</button></p>`;
    H.retry = () => boot();
  } finally { document.body.classList.remove('spin'); }
}

async function boot() {
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
