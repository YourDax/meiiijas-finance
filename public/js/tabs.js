// Вкладки: главная, траты, план, цели, резерв, ещё.
import { S, api } from './state.js';
import { $, tz, esc, money, isoStr, ymLabel, ymGen, dayKey, timeStr, dayLabel, catIcon, catTitle, thisMonth, recentNames, setInfo } from './util.js';
import { btn } from './ui.js';
import { compareSpends, matchesQuery } from '../stats.js';

// ---------- вкладки ----------
export const TABS = [['home', '🏠', 'Главная'], ['spends', '🧾', 'Траты'], ['plan', '📅', 'План'], ['goals', '🎯', 'Цели'], ['reserve', '🏦', 'Резерв'], ['more', '⚙️', 'Ещё']];

export function budgetChip() {
  if (S.chats.length < 2) return '';
  const cur = S.chats.find((c) => c.id === S.chatId);
  return `<button class="ghost small" data-act="chats">📒 ${esc(cur?.title ?? 'Бюджет')} ▾</button>`;
}

export function homeTab() {
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
  const due = p.dueList.length ? `<h2>Ближайшие платежи · ${money(p.dueSum)}</h2><div class="list">${p.dueList.map((o) => payRow(s.payments?.find((x) => x.key === o.key) ?? { ...o, status: 'open', past: true })).join('')}</div>` : '';
  const cats = Object.entries(p.byCatPeriod).sort((a, b) => b[1] - a[1]);
  const total = cats.reduce((x, [, v]) => x + v, 0) || 1;
  const catBlock = cats.length ? `<h2>Траты периода · ${money(p.spentPeriod)}</h2><div class="card">${cats.map(([k, v]) => `
    <div class="tap" data-act="cat-filter" data-cat="${esc(k)}" style="margin:2px -8px;padding:6px 8px"><div class="row between small"><span>${esc(catTitle(k))}</span><b>${money(v)} ›</b></div><div class="bar"><i style="width:${Math.round(v / total * 100)}%"></i></div></div>`).join('')}
    ${Object.keys(p.byUserPeriod).length > 1 ? `<div class="small muted" style="margin-top:8px">${Object.entries(p.byUserPeriod).map(([u, v]) => `${esc(u)}: ${money(v)}`).join(' · ')}</div>` : ''}</div>` : '';
  const onboarding = !s.items.length && !p.hasBalance ? `<div class="card alert small"><b>С чего начать</b>
    <div class="steps"><div data-act="balance" class="tap">1️⃣ Укажи остаток на карте ›</div><div data-act="item-add" class="tap">2️⃣ Добавь доход и обязательные платежи ›</div><div data-act="nl" class="tap">3️⃣ Записывай траты фразой: «кофе 450» ›</div></div></div>` : '';
  const names = recentNames();
  return `
    <div class="row between"><h1>Бюджет</h1>${budgetChip()}</div>
    ${p.shortfall > 0 ? `<div class="card alert bad small">⚠️ До дохода не хватает <b>${money(p.shortfall)}</b> на обязательные платежи.</div>` : ''}
    ${onboarding}
    <div class="card hero tap" data-act="balance" aria-label="Изменить остаток">
      <div class="small muted">${lead}${p.hasBalance ? '' : ' · оценка'} <span class="hint-edit">✏️ изменить</span></div>
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
      <div class="row gap"><input id="q-amt" data-enter="quick-spend" inputmode="decimal" placeholder="Сумма" style="width:34%"><input id="q-name" data-enter="quick-spend" placeholder="На что (кофе, такси…)" class="grow"></div>
      ${names.length ? `<div class="chips">${names.map((n) => `<button class="chip" data-act="chip" data-name="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}
      <div class="row gap" style="margin-top:8px">${btn('🧾 Записать трату', 'quick-spend', {}, 'grow')}${btn('↩️', 'undo-last', {}, 'ghost')}</div>
    </div>
    <div class="row gap wrap" style="margin-bottom:10px">
      ${btn('💼 Баланс', 'balance', {}, 'ghost small')}${btn('➕ Пополнить', 'topup', {}, 'ghost small')}${btn('➖ Снять', 'withdraw', {}, 'ghost small')}
      ${btn('➕ Доход/платёж', 'item-add', {}, 'ghost small')}${btn('💬 Фразой', 'nl', {}, 'ghost small')}
    </div>
    ${due}${catBlock}${dynamicsBlock()}
    <h2>Подробнее</h2>
    <div class="row gap wrap">
      ${btn('📋 План подробно', 'view', { name: 'plan', title: 'План подробно' }, 'ghost small')}
      ${btn('🗓 Прогноз', 'forecast', { k: 1 }, 'ghost small')}
      ${btn('📈 Графики', 'view', { name: 'chart', title: 'Графики трат' }, 'ghost small')}
      ${btn('☀️ Дайджест', 'view', { name: 'digest', title: 'Дайджест' }, 'ghost small')}
    </div>`;
}

export // Строка платежа или дохода с кнопкой отметки: оплатить можно в любой момент, ошибочную отметку — снять
const PAY_ICO = { open: '⏳', done: '✅', skipped: '⏭', auto: '✔️' };
function payAction(o) {
  if (o.status === 'open') {
    if (o.type === 'income' && !o.past) return '<span class="tag">ждём</span>';
    return btn(o.type === 'income' ? '✅ Пришло' : '✅ Оплачено', 'occ', { key: o.key }, 'small paybtn');
  }
  if (o.status === 'done' || o.status === 'skipped') return btn('↩️ Снять', 'occ-undo', { key: o.key }, 'ghost small');
  return '<span class="tag">в остатке</span>';
}
function payRow(o) {
  const note = o.status === 'skipped' ? ' · не было' : o.status === 'done' ? ' · отмечено' : '';
  return `<div class="item" data-act="item-edit" data-id="${esc(o.id)}"><div class="ico">${PAY_ICO[o.status]}</div><div class="grow"><div class="t">${esc(o.name)}</div><div class="s">${isoStr(o.date)}${note}</div></div>
    <div class="amt ${o.type === 'income' ? 'pos' : ''}">${o.type === 'income' ? '+' : ''}${money(o.amount)}</div>${payAction(o)}</div>`;
}
function paymentsBlock() {
  const list = S.state.payments ?? [];
  if (!list.length) return '';
  const open = list.filter((o) => o.status === 'open').length;
  return `<h2>Оплаты и поступления${open ? ` · ждут отметки: ${open}` : ''}</h2><div class="list">${list.map(payRow).join('')}</div>
    <p class="small muted">Платёж можно отметить оплаченным заранее. Отметил по ошибке — нажми «↩️ Снять», деньги вернутся.</p>`;
}

// Сколько потрачено на этой неделе и в этом месяце против прошлых, и 14 дней столбиками
function dynamicsBlock() {
  const s = S.state;
  if (s.spends.length < 3) return '';
  const c = compareSpends(s.spends, s.now, tz());
  const pct = (p) => (p === null ? '<span class="muted">нет данных</span>' : `<b class="${p > 0 ? 'neg' : 'pos'}">${p > 0 ? '▲ +' : p < 0 ? '▼ ' : ''}${Math.abs(p)}%</b>`);
  const max = Math.max(...c.days.map((d) => d.sum), 1);
  return `<h2>Динамика трат</h2><div class="card tap" data-act="view" data-name="chart" data-title="Графики трат">
    <div class="row between small"><span>Эта неделя · ${money(c.week.cur)}</span>${pct(c.week.pct)}</div>
    <div class="row between small" style="margin-top:4px"><span>Этот месяц · ${money(c.month.cur)}</span>${pct(c.month.pct)}</div>
    <div class="small muted" style="margin-top:2px">Сравнение с тем же периодом прошлого месяца и недели</div>
    <div class="spark" aria-hidden="true">${c.days.map((d) => `<i class="${d.today ? 'today' : ''}" style="height:${Math.max(4, Math.round(d.sum / max * 100))}%"></i>`).join('')}</div>
    <div class="row between small muted"><span>14 дней назад</span><span>сегодня</span></div></div>`;
}

function spendsTab() {
  const s = S.state;
  const months = [...new Set(s.spends.map((x) => dayKey(x.ts).slice(0, 7)))];
  const cur = thisMonth();
  if (!months.includes(cur)) months.unshift(cur);
  const topups = s.topups.length ? `<h2>Пополнения и снятия</h2><div class="list">${s.topups.map((t) => `
    <div class="item" style="cursor:default"><div class="ico">💵</div><div class="grow"><div class="t">${esc(t.name)}</div><div class="s">${dayLabel(dayKey(t.ts))}${t.by ? ` · ${esc(t.by)}` : ''}</div></div><div class="amt ${t.amount < 0 ? '' : 'pos'}">${t.amount < 0 ? '−' : '+'}${money(Math.abs(t.amount))}</div>
    ${btn('↩️', 'topup-undo', { id: t.id }, 'ghost small')}</div>`).join('')}</div>` : '';
  return `
    <div class="row between"><h1>Траты</h1><div class="row gap">${btn('⬇️ CSV', 'export-csv', {}, 'ghost small')}${btn('➕ Трата', 'spend-add', {}, 'small')}</div></div>
    <div class="row gap"><select id="flt-month" data-input="flt-month" class="grow">
      ${months.map((m) => `<option value="${m}" ${(S.filter.month === 'cur' ? cur : S.filter.month) === m ? 'selected' : ''}>${ymLabel(m)}</option>`).join('')}
      <option value="all" ${S.filter.month === 'all' ? 'selected' : ''}>За всё время</option></select>
      <input id="flt-q" data-input="flt-q" placeholder="Поиск" value="${esc(S.filter.q)}" class="grow"></div>
    <div id="spend-list">${spendList()}</div>${topups}`;
}

export function spendList() {
  const s = S.state;
  const month = S.filter.month === 'cur' ? thisMonth() : S.filter.month;
  const q = S.filter.q.trim().toLowerCase();
  const rows = s.spends.filter((x) => (month === 'all' || dayKey(x.ts).startsWith(month))
    && matchesQuery(x, q, { catTitle, dayLabel, dayKey }));
  if (!rows.length) return `<div class="center pad"><p class="muted">${q || month !== 'all' ? 'Трат не найдено' : 'Пока нет трат'}</p>${btn('🧾 Записать трату', 'spend-add', {}, '')}</div>`;
  const sum = rows.reduce((a, x) => a + x.amount, 0);
  const groups = new Map();
  for (const x of rows) { const k = dayKey(x.ts); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
  const note = s.spendsTotal > s.spends.length ? `<p class="small muted center">Показаны последние ${s.spends.length} из ${s.spendsTotal}</p>` : '';
  return `<div class="card row between"><span class="muted">Итого</span><b>${money(sum)}</b></div>
    ${[...groups].map(([k, list]) => `<h2>${dayLabel(k)} · ${money(list.reduce((a, x) => a + x.amount, 0))}</h2><div class="list">${list.map((x) => `
      <div class="swipe"><div class="sw sw-l">✏️ Изменить</div><div class="sw sw-r">🗑 Удалить</div><div class="item" data-act="spend-edit" data-swipe data-id="${esc(x.id)}"><div class="ico">${catIcon(x.cat)}</div>
        <div class="grow"><div class="t">${esc(x.name || catTitle(x.cat))}</div><div class="s">${timeStr(x.ts)}${x.by ? ` · ${esc(x.by)}` : ''}${x.src === 'bank' ? ' · из выписки' : ''}</div></div>
        <div class="amt">${money(x.amount)}</div></div></div>`).join('')}</div>`).join('')}${note}`;
}

export const whenText = (it) => it.spread ? 'В течение месяца' : it.once ? `Один раз · ${it.day}-го, ${ymLabel(it.once)}` : `Каждый месяц · ${it.day}-го`;

export function planTab() {
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
    ${paymentsBlock()}
    ${sect('Доходы', by((i) => i.type === 'income' && !i.once))}
    ${sect('Платежи по датам', by((i) => i.type === 'bill' && !i.spread && !i.once))}
    ${sect('В течение месяца', by((i) => i.spread))}
    ${sect('Разовые', by((i) => i.once && !i.spread))}
    ${s.items.length ? '' : '<p class="muted center pad">Пока пусто. Добавь доход и обязательные платежи.</p>'}
    <div class="row gap wrap" style="margin-top:14px">
      ${btn('💬 Записать фразой', 'nl', {}, 'ghost small')}${btn('🗓 Прогноз', 'forecast', { k: 1 }, 'ghost small')}${btn('📋 Подробный план', 'view', { name: 'plan', title: 'План подробно' }, 'ghost small')}
    </div>`;
}

export function goalsTab() {
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

export function reserveTab() {
  const s = S.state; const r = s.reserve;
  const incomes = s.items.filter((i) => i.type === 'income' && !i.once);
  if (!r) return `<h1>Резерв</h1><div class="card"><p>Резерв — отдельный счёт под аренду, коммуналку и интернет. Платежи из него не уменьшают остаток на карте.</p>
    ${btn('🏠 Включить резерв', 'reserve-set', {}, 'block')}</div>
    <h2>Транспорт</h2><div class="card"><p class="small muted">Формула: проездной + ставка за каждый рабочий день цикла (по производственному календарю).</p>${btn('🚌 Настроить транспорт', 'transport', {}, 'ghost block')}</div>`;
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

export function moreTab() {
  const s = S.state;
  const row = (ico, title, sub, act_, data = {}) => `<div class="item" data-act="${act_}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}><div class="ico">${ico}</div><div class="grow"><div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div><span class="muted">›</span></div>`;
  return `<h1>Ещё</h1>
    ${S.chats.length > 1 ? `<div class="list">${row('📒', 'Бюджет', esc(S.chats.find((c) => c.id === S.chatId)?.title ?? ''), 'chats')}</div>` : ''}
    <h2>Данные</h2><div class="list">
      ${row('📥', 'Импорт выписки Т-Банка', 'PDF «Справка о движении средств»', 'import')}
      ${row('📈', 'Графики трат', 'по категориям, дням и людям', 'view', { name: 'chart', title: 'Графики трат' })}
      ${row('🗓', 'Планирование вперёд', 'прогноз на следующие месяцы', 'forecast', { k: 1 })}
      ${row('⬇️', 'Экспорт трат', 'файл CSV придёт в чат с ботом', 'export-csv')}
      ${s.usage ? row('💾', 'Объём данных', `${Math.max(1, Math.round(s.usage.bytes / 1024))} КБ · ${s.usage.percent}% лимита${s.usage.warn ? ' — пора разгрузить' : ''}`, 'usage') : ''}
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

export const TAB = { home: homeTab, spends: spendsTab, plan: planTab, goals: goalsTab, reserve: reserveTab, more: moreTab };

export function render() {
  if (!S.state) return;
  const tabs = $('#tabs');
  tabs.hidden = false;
  tabs.innerHTML = TABS.map(([k, ico, label]) => `<button class="${S.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}"><span>${ico}</span>${label}</button>`).join('');
  $('#app').innerHTML = TAB[S.tab]();
  $('#fab').hidden = false;
  $('#app').querySelectorAll('[data-act]:not(button)').forEach((el) => { el.setAttribute('role', 'button'); el.tabIndex = 0; });
  document.querySelectorAll('#app [data-view]').forEach(async (el) => {
    try { setInfo(el, (await api('view', { name: el.dataset.view })).html); } catch { el.textContent = ''; }
  });
}
