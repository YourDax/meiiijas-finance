// Вкладки: главная, траты, план, цели, резерв, ещё.
import { S, api, store } from './state.js';
import { $, tz, esc, money, isoStr, ymLabel, ymGen, dayKey, timeStr, dayLabel, catIcon, catTitle, thisMonth, recentNames, setInfo } from './util.js';
import { btn } from './ui.js';
import { compareSpends, matchesQuery } from '../stats.js';

// ---------- вкладки ----------
export const TABS = [['home', '🏠', 'Главная'], ['spends', '🧾', 'Траты'], ['plan', '📅', 'План'], ['goals', '🎯', 'Цели'], ['reserve', '🏦', 'Счета'], ['more', '⚙️', 'Ещё']];

// Деньги на карте сейчас (после последнего ответа сервера)
export const curBalance = () => (S.state.balance ? S.state.cardBalance : S.state.period.now);

// Заголовок раздела: название слева, сумма или счётчик справа
const sec = (title, right = '') => `<h2><span>${title}</span>${right ? `<span class="sum">${right}</span>` : ''}</h2>`;

export function budgetChip() {
  if (S.chats.length < 2) return '';
  const cur = S.chats.find((c) => c.id === S.chatId);
  return `<button class="ghost small" data-act="chats">📒 ${esc(cur?.title ?? 'Бюджет')} ▾</button>`;
}

// Одна кнопка на поездку: списывает с карты и из статьи транспорта
function rideBlock() {
  const r = S.state.transportRide;
  if (!r) return '';
  return `<div class="card row between"><div class="grow"><b>🚌 Транспорт</b><div class="small muted">Осталось ${money(r.remaining)} из ${money(r.amount)}${r.ridesToday ? ` · сегодня поездок: ${r.ridesToday}` : ''}</div></div>${btn(`Поездка ${money(r.price)}`, 'transport-ride', {}, 'small')}</div>`;
}

export function homeTab() {
  const s = S.state; const p = s.period;
  const lead = p.reserveOn ? '💳 На карте' : '💼 На руках';
  const left = p.leftToday;
  const pending = p.pending.map((o) => `
    <div class="card"><div class="row"><div class="ico mid">${o.type === 'income' ? '💰' : '📌'}</div>
      <div class="grow"><b>${esc(o.name)}</b><div class="small muted">${isoStr(o.date)}${o.fromReserve ? ' · из копилки' : ''}</div></div>
      <b class="${o.type === 'income' ? 'pos' : ''}">${o.type === 'income' ? '+' : '−'}${money(o.amount)}</b></div>
      <div class="row gap" style="margin-top:10px">
        ${btn(o.type === 'income' ? '✅ Получено' : '✅ Оплачено', 'occ', { key: o.key }, 'grow')}
        ${btn('Не было', 'occ', { key: o.key, skip: 1 }, 'ghost')}
      </div></div>`).join('');
  const gaps = p.gaps.map((g) => `<div class="card alert bad small">⚠️ Перед «${esc(g.name)}» (${isoStr(g.date)}) не хватит <b>${money(g.short)}</b></div>`).join('');
  const due = p.dueList.length ? `${sec('Ближайшие платежи', money(p.dueSum))}<div class="list">${p.dueList.map((o) => payRow(s.payments?.find((x) => x.key === o.key) ?? { ...o, status: 'open', past: true })).join('')}</div>` : '';
  const cats = Object.entries(p.byCatPeriod).sort((a, b) => b[1] - a[1]);
  const total = cats.reduce((x, [, v]) => x + v, 0) || 1;
  const catBlock = cats.length ? `${sec('Траты периода', money(p.spentPeriod))}<div class="card">${cats.map(([k, v]) => `
    <div class="tap" data-act="cat-filter" data-cat="${esc(k)}" style="margin:2px -8px;padding:6px 8px"><div class="row between small"><span>${esc(catTitle(k))}</span><b>${money(v)} ›</b></div><div class="bar"><i style="width:${Math.round(v / total * 100)}%"></i></div></div>`).join('')}
    ${Object.keys(p.byUserPeriod).length > 1 ? `<div class="small muted" style="margin-top:8px">${Object.entries(p.byUserPeriod).map(([u, v]) => `${esc(u)}: ${money(v)}`).join(' · ')}</div>` : ''}</div>` : '';
  const onboarding = !s.items.length && !p.hasBalance ? `<div class="card alert small"><b>Настроим бюджет за минуту</b><p>Три коротких шага: сколько денег сейчас, когда приходит доход и какие есть обязательные платежи.</p>${btn('Начать настройку', 'wizard', { step: 1 }, 'block')}</div>` : '';
  const names = recentNames();
  return `
    <div class="row between"><h1>Бюджет</h1>${budgetChip()}</div>
    ${p.shortfall > 0 ? `<div class="card alert bad small">⚠️ До дохода не хватает <b>${money(p.shortfall)}</b> на обязательные платежи.</div>` : ''}
    ${onboarding}
    ${gaps}
    <div class="card hero">
      <div class="small muted">Сегодня ещё можно потратить <button class="q" data-act="explain-limit" aria-label="Как считается эта сумма">?</button></div>
      <div class="big ${left <= 0 ? 'neg' : ''}">${money(left)}</div>
      <div class="bar ${p.spentToday > p.dayBudget ? 'over' : ''}"><i style="width:${p.dayBudget > 0 ? Math.min(100, Math.round(p.spentToday / p.dayBudget * 100)) : 0}%"></i></div>
      <div class="small muted">Потрачено ${money(p.spentToday)} из ${money(p.dayBudget)} на день</div>
      ${p.hasBalance ? '' : `<div class="small warn" style="margin-top:10px">Задай точный остаток — расчёты станут точнее.</div>`}
      <div class="hero-row tap" data-act="balance" aria-label="Изменить остаток"><span>${lead}${p.hasBalance ? '' : ' · оценка'} <span class="small muted">✏️</span></span><b class="mid">${money(p.now)}</b></div>
    </div>
    ${rideBlock()}
    ${sec('Записать трату')}
    <div class="card">
      <div class="row gap"><input id="q-amt" data-enter="quick-spend" inputmode="decimal" placeholder="Сумма" style="width:34%"><input id="q-name" data-enter="quick-spend" placeholder="На что (кофе, такси…)" class="grow"></div>
      ${names.length ? `<div class="chips">${names.map((n) => `<button class="chip" data-act="chip" data-name="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}
      <div style="margin-top:8px">${btn('🧾 Записать трату', 'quick-spend', {}, 'block')}</div>
      <div class="center">${btn('↩️ Отменить последнюю трату', 'undo-last', {}, 'linkbtn')}</div>
    </div>
    ${pending ? `${sec('Было или нет?')}${pending}` : ''}
    ${sec(p.noIncome ? 'До конца месяца' : 'До зарплаты', p.nextIncome ? `${esc(p.nextIncome.name)}, ${isoStr(p.nextIncome.date)}` : '')}
    <div class="card"><div class="stats" style="margin-top:0">
      <div class="stat"><span class="small muted">Можно потратить</span><b>${money(p.pool)}</b></div>
      <div class="stat"><span class="small muted">Осталось дней</span><b>${p.days} дн.</b></div>
      <div class="stat"><span class="small muted">Можно в неделю</span><b>${money(p.perWeek)}</b></div>
      <div class="stat"><span class="small muted">Платежи</span><b>${money(p.dueSum)}</b></div>
    </div></div>
    ${due}${catBlock}${dynamicsBlock()}`;
}

export // Строка платежа или дохода с кнопкой отметки: оплатить можно в любой момент, ошибочную отметку — снять
const PAY_ICO = { open: '⏳', done: '✅', skipped: '⏭', auto: '✔️' };
function payAction(o) {
  const label = o.type === 'income' ? '✅ Получено' : '✅ Оплачено';
  if (o.status === 'open') return `${btn('другая сумма', 'occ-amount', { key: o.key }, 'linkbtn')}${btn(label, 'occ', { key: o.key }, 'small paybtn')}`;
  if (o.status === 'done' || o.status === 'skipped') return btn('↩️ Отменить', 'occ-undo', { key: o.key }, 'ghost small paybtn');
  return btn(label, 'occ-auto', { key: o.key }, 'ghost small paybtn'); // дата раньше заданного остатка: спросим, прежде чем менять баланс
}
function payRow(o) {
  const note = o.status === 'skipped' ? ' · не было' : o.status === 'done' ? ' · отмечено' : o.status === 'auto' ? ' · уже в остатке' : '';
  const reserve = o.fromReserve && S.state.reserve ? ' · из копилки' : '';
  return `<div class="item payrow" data-act="item-edit" data-id="${esc(o.id)}"><div class="ico">${PAY_ICO[o.status]}</div><div class="grow"><div class="t">${esc(o.name)}</div><div class="s">${isoStr(o.date)}${reserve}${note}</div></div>
    <div class="amt ${o.type === 'income' ? 'pos' : ''}">${o.type === 'income' ? '+' : '−'}${money(o.amount)}</div><div class="payact">${payAction(o)}</div></div>`;
}
function spreadRow(s) {
  const paid = s.remaining <= 0;
  const pct = s.amount > 0 ? Math.min(100, Math.round(s.spent / s.amount * 100)) : 0;
  const second = !paid ? btn('оплатить всё', 'spread-pay', { id: s.id }, 'linkbtn') : s.planSpendId ? btn('↩️ отменить последний', 'spread-undo', { spend: s.planSpendId }, 'linkbtn') : '';
  const action = `${second}${btn('➕ Платёж', 'spread-amount', { id: s.id }, `small paybtn${paid ? ' ghost' : ''}`)}`;
  return `<div class="item payrow" data-act="item-edit" data-id="${esc(s.id)}"><div class="ico">${paid ? '✅' : catIcon(s.cat)}</div><div class="grow"><div class="t">${esc(s.name)}</div><div class="s">${s.spent > 0 ? `Потрачено ${money(s.spent)} из ${money(s.amount)}` : `Можно платить частями, всего ${money(s.amount)}`}</div>${s.spent > 0 ? `<div class="bar ${s.spent > s.amount ? 'over' : ''}" style="margin-top:6px"><i style="width:${pct}%"></i></div>` : ''}</div>
    <div class="amt">−${money(paid ? s.amount : s.remaining)}</div><div class="payact">${action}</div></div>`;
}
// Единый список плана: у каждого пункта своя кнопка, которая сразу меняет баланс
// Что уходит вниз, решается один раз при входе на вкладку: только что оплаченная строка остаётся на месте до переключения вкладки
function planRows() {
  const s = S.state;
  const pays = s.payments ?? [];
  const spreads = s.spreadPayments ?? [];
  if (!S.planSettled) S.planSettled = new Set([...pays.filter((o) => o.status !== 'open').map((o) => o.key), ...spreads.filter((x) => x.remaining <= 0).map((x) => x.id)]);
  return {
    pays: pays.filter((o) => !S.planSettled.has(o.key)), spreads: spreads.filter((x) => !S.planSettled.has(x.id)),
    settled: [...pays.filter((o) => S.planSettled.has(o.key)).map(payRow), ...spreads.filter((x) => S.planSettled.has(x.id)).map(spreadRow)],
  };
}
function paymentsBlock() {
  const { pays, spreads } = planRows();
  const bills = pays.filter((o) => o.type === 'bill');
  const incomes = pays.filter((o) => o.type === 'income');
  if (!pays.length && !spreads.length) return '';
  const wait = (l) => { const n = l.filter((o) => o.status === 'open').length; return n ? `ждут: ${n}` : ''; };
  const list = (rows) => `<div class="list">${rows.join('')}</div>`;
  return `<p class="small muted" style="margin:14px 2px 0">Кнопка сразу меняет баланс. Если нажать по ошибке, «↩️ Отменить» вернёт деньги.</p>
    ${bills.length ? `${sec('Обязательные платежи', wait(bills))}${list(bills.map(payRow))}` : ''}
    ${spreads.length ? `${sec('В течение месяца')}${list(spreads.map(spreadRow))}` : ''}
    ${incomes.length ? `${sec('Поступления', wait(incomes))}${list(incomes.map(payRow))}` : ''}`;
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
    ${limitsBlock()}<div id="spend-list">${spendList()}</div>${topups}`;
}

function limitsBlock() {
  const list = S.state.catLimits ?? [];
  if (!list.length) return '';
  return `<h2>Лимиты на месяц</h2><div class="card">${list.map((l) => { const over = l.spent > l.limit; return `<div class="tap" data-act="cat-limit-edit" data-cat="${esc(l.cat)}" style="margin:2px 0 8px"><div class="row between small"><span>${esc(catTitle(l.cat))}</span><b class="${over ? 'neg' : ''}">${money(l.spent)} из ${money(l.limit)}</b></div><div class="bar ${over ? 'over' : ''}"><i style="width:${Math.min(100, Math.round(l.spent / l.limit * 100))}%"></i></div></div>`; }).join('')}</div>`;
}

export function spendList() {
  const s = S.state;
  const month = S.filter.month === 'cur' ? thisMonth() : S.filter.month;
  const q = S.filter.q.trim().toLowerCase();
  const rows = s.spends.filter((x) => (month === 'all' || dayKey(x.ts).startsWith(month))
    && matchesQuery(x, q, { catTitle, dayLabel, dayKey }));
  if (!rows.length) return `<div class="center pad"><p class="muted">${q ? 'По такому запросу ничего нет' : 'В этом месяце трат пока нет. Запиши первую, например «кофе 450»'}</p>${btn('🧾 Записать трату', 'spend-add', {}, '')}</div>`;
  const sum = rows.reduce((a, x) => a + x.amount, 0);
  const groups = new Map();
  for (const x of rows) { const k = dayKey(x.ts); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
  const note = s.spendsTotal > s.spends.length ? `<p class="small muted center">Показаны последние ${s.spends.length} из ${s.spendsTotal}</p>` : '';
  const swipeHint = store.get('swipe-hint') ? '' : `<div class="card small row between"><span>Смахни трату влево, чтобы удалить, или вправо, чтобы изменить. Можно и просто нажать на неё.</span>${btn('Понятно', 'swipe-ok', {}, 'ghost small')}</div>`;
  return `${swipeHint}<div class="card row between"><span class="muted">Итого</span><b>${money(sum)}</b></div>
    ${[...groups].map(([k, list]) => `${sec(dayLabel(k), money(list.reduce((a, x) => a + x.amount, 0)))}<div class="list">${list.map((x) => `
      <div class="swipe"><div class="sw sw-l">✏️ Изменить</div><div class="sw sw-r">🗑 Удалить</div><div class="item" data-act="spend-edit" data-swipe data-id="${esc(x.id)}"><div class="ico">${catIcon(x.cat)}</div>
        <div class="grow"><div class="t">${esc(x.name || catTitle(x.cat))}</div><div class="s">${timeStr(x.ts)}${x.by ? ` · ${esc(x.by)}` : ''}${x.src === 'bank' ? ' · из выписки' : ''}</div></div>
        <div class="amt">${money(x.amount)}</div></div></div>`).join('')}</div>`).join('')}${note}`;
}

export const whenText = (it) => it.everyLabel ? it.everyLabel[0].toUpperCase() + it.everyLabel.slice(1) : it.spread ? 'В течение месяца' : it.once ? `Один раз · ${it.day}-го, ${ymLabel(it.once)}` : `Каждый месяц · ${it.day}-го`;

export function planTab() {
  const s = S.state;
  const sect = (title, list) => list.length ? `<h2>${title}</h2><div class="list">${list.map((it) => `
    <div class="item" data-act="item-edit" data-id="${esc(it.id)}"><div class="ico">${it.type === 'income' ? '💰' : it.spread ? catIcon(it.cat) : '📌'}</div>
      <div class="grow"><div class="t">${esc(it.name)}</div><div class="s">${whenText(it)}${it.type === 'bill' && !it.spread && it.fromReserve ? ' · 🏠 из копилки' : ''}${it.by ? ` · ${esc(it.by)}` : ''}</div></div>
      <div class="amt ${it.type === 'income' ? 'pos' : ''}">${money(it.amount)}</div></div>`).join('')}</div>` : '';
  // Пункты, у которых сейчас нечего отмечать: разовые из других месяцев
  const active = new Set([...(s.payments ?? []).map((o) => o.id), ...(s.spreadPayments ?? []).map((x) => x.id)]);
  const other = s.items.filter((i) => !active.has(i.id)).sort((a, b) => (a.once ?? '').localeCompare(b.once ?? ''));
  const { settled } = planRows();
  return `
    <div class="row between"><h1>План</h1>${btn('➕ Добавить', 'item-add', {}, 'small')}</div>
    <div class="card lines"><div class="row between tap" data-act="balance"><span>${s.period.reserveOn ? '💳 На карте' : '💼 На руках'} <span class="small muted">✏️</span></span><b class="mid">${money(curBalance())}</b></div>
      ${s.reserve ? `<div class="row between"><span class="muted">🏠 В копилке</span><b>${money(s.reserve.amount)}</b></div>` : ''}
      <div class="row between"><span class="muted">Доходы в месяц</span><b class="pos">${money(s.plan.totalIncome)}</b></div>
      <div class="row between"><span class="muted">Обязательные</span><b>${money(s.plan.totalBills)}</b></div>
      <div class="row between"><span class="muted">Свободно</span><b class="${s.plan.free < 0 ? 'neg' : ''}">${money(s.plan.free)}</b></div></div>
    ${paymentsBlock()}
    ${sect('Позже', other)}
    ${settled.length ? `${sec('Уже оплачено и получено', String(settled.length))}<div class="list">${settled.join('')}</div>` : ''}
    ${s.items.length ? '' : `<div class="center pad"><p class="muted">Здесь будут зарплата, аренда, кредит и другие регулярные суммы.</p>${btn('➕ Добавить первый пункт', 'item-add')}</div>`}
    ${sec('Подробнее')}<div class="row gap wrap">
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
        <div class="row gap wrap" style="margin-top:10px">${btn('🐷 Отложить', 'goal-save', { id: g.id }, 'grow')}${g.saved > 0 ? btn('Взять из цели', 'goal-out', { id: g.id }, 'ghost') : ''}${btn('✏️ Изменить', 'goal-edit', { id: g.id }, 'ghost')}</div></div>`; }).join('')
      : `<div class="center pad"><p class="muted">Цель помогает копить: укажи сумму и срок, и приложение подскажет, сколько откладывать в месяц.</p>${btn('🎯 Создать первую цель', 'goal-add')}</div>`}
    <div class="row gap wrap">${btn('📋 Сводка по целям', 'view', { name: 'goals', title: 'Цели' }, 'ghost small')}</div>`;
}

function accountsBlock() {
  const s = S.state;
  const row = (ico, name, sub, amount, act_, data = {}) => `<div class="item" data-act="${act_}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}><div class="ico">${ico}</div><div class="grow"><div class="t">${esc(name)}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div><div class="amt">${money(amount)}</div></div>`;
  return `<div class="list">
      ${row('💳', 'Карта', 'от неё считается лимит на день', curBalance(), 'balance')}
      ${s.reserve ? row('🏠', 'Копилка на аренду', 'аренда, коммуналка, интернет', s.reserve.amount, 'reserve-set') : ''}
      ${s.accounts.map((a) => row('💰', a.name, '', a.amount, 'account-edit', { id: a.id })).join('')}
    </div>
    <div class="row gap wrap" style="margin-bottom:10px">${btn('➕ Добавить счёт', 'account-add', {}, 'ghost small')}</div>
    <p class="small muted">Наличные, вклад, другая карта. Деньги на этих счетах не входят в лимит на день. Перевод между счетами — не трата.</p>`;
}

function debtsBlock() {
  const list = S.state.debts;
  const row = (d) => { const open = d.left > 0; return `<div class="item" style="cursor:default"><div class="ico">${open ? (d.kind === 'owe' ? '🔻' : '💚') : '✅'}</div><div class="grow"><div class="t">${esc(d.name)}</div><div class="s">${d.kind === 'owe' ? 'я должен' : 'должны мне'}${d.left !== d.total ? ` · всего было ${money(d.total)}` : ''}</div></div>
    <div class="payside"><div class="amt">${money(d.left)}</div>${open ? btn(d.kind === 'owe' ? 'Вернул' : 'Вернули', 'debt-pay', { id: d.id }, 'small paybtn') : btn('Удалить', 'debt-del', { id: d.id }, 'ghost small paybtn')}</div></div>`; };
  const group = (title, kind) => { const l = list.filter((d) => d.kind === kind); return l.length ? `${sec(title, money(l.reduce((a, d) => a + d.left, 0)))}<div class="list">${l.map(row).join('')}</div>` : ''; };
  return list.length ? `${group('Я должен', 'owe')}${group('Должны мне', 'lent')}` : '<p class="small muted">Записывай, кому должен ты и кто должен тебе. Когда долг вернут, сумма сама изменит баланс.</p>';
}

function reserveBlock() {
  const s = S.state; const r = s.reserve;
  const incomes = s.items.filter((i) => i.type === 'income' && !i.once);
  if (!r) return `<div class="card"><p class="small" style="margin-top:0">Отдельные деньги под аренду, коммуналку и интернет. Платежи из копилки не уменьшают деньги на карте, а приложение подсказывает, сколько отложить с дохода.</p>
    ${btn('🏠 Включить копилку', 'reserve-set', {}, 'block')}</div>
    ${sec('Транспорт')}<div class="card"><p class="small muted" style="margin-top:0">Формула: проездной + ставка за каждый рабочий день цикла (по производственному календарю).</p>${btn('🚌 Настроить транспорт', 'transport', {}, 'ghost block')}</div>`;
  return `${r.contract ? `<div class="small muted">Счёт: договор …${esc(r.contract)}</div>` : ''}
    ${s.settings.reserveStep ? `<div class="small muted" style="margin-bottom:8px">Перевод округляется до ${money(s.settings.reserveStep)}</div>` : ''}
    <div class="row gap wrap" style="margin-bottom:10px">${btn('➕ Перевёл в копилку', 'reserve-deposit', {}, 'grow')}${btn('✏️ Изменить остаток', 'reserve-set', {}, 'ghost')}</div>
    <div class="info card" data-view="reserve"></div>
    ${incomes.length ? `${sec('Сколько откладывать с дохода')}<div class="list">${incomes.map((i) => `
      <div class="item" data-act="reserve-plan" data-id="${esc(i.id)}"><div class="ico">💰</div><div class="grow"><div class="t">${esc(i.name)}</div><div class="s">${i.toReserve ? 'задано вручную' : 'автоматически'}</div></div><div class="amt">${i.toReserve ? money(i.toReserve) : 'авто'}</div></div>`).join('')}</div>` : ''}
    ${sec('Настройки копилки')}
    <div class="row gap wrap">${btn('🔢 Округление', 'reserve-step', {}, 'ghost small')}${btn('📄 Договор', 'reserve-contract', {}, 'ghost small')}${btn('🚌 Транспорт', 'transport', {}, 'ghost small')}${btn('Выключить копилку', 'reserve-off', {}, 'danger small')}</div>`;
}

const ACC_SECTIONS = [['accounts', 'Счета', accountsBlock], ['debts', 'Долги', debtsBlock], ['reserve', 'Копилка', reserveBlock]];

export function reserveTab() {
  const cur = ACC_SECTIONS.find(([k]) => k === S.accTab) ?? ACC_SECTIONS[0];
  const action = cur[0] === 'accounts' ? btn('🔁 Перевод', 'transfer', {}, 'small') : cur[0] === 'debts' ? btn('➕ Долг', 'debt-add', {}, 'small') : '';
  return `<div class="row between"><h1>Счета</h1>${action}</div>
    <div class="seg page-seg">${ACC_SECTIONS.map(([k, label]) => `<button class="${k === cur[0] ? 'on' : ''}" data-act="acc-tab" data-tab="${k}">${label}</button>`).join('')}</div>
    ${cur[2]()}`;
}

export function moreTab() {
  const s = S.state;
  const row = (ico, title, sub, act_, data = {}) => `<div class="item" data-act="${act_}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}><div class="ico">${ico}</div><div class="grow"><div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div><span class="muted">›</span></div>`;
  return `<h1>Ещё</h1>
    ${S.chats.length > 1 ? `<div class="list">${row('📒', 'Бюджет', esc(S.chats.find((c) => c.id === S.chatId)?.title ?? ''), 'chats')}</div>` : ''}
    <h2>Отчёты</h2><div class="list">
      ${row('📊', 'Итоги месяца', 'сколько пришло, ушло и осталось', 'month', { k: 0 })}
      ${row('📈', 'Графики трат', 'по категориям, дням и людям', 'view', { name: 'chart', title: 'Графики трат' })}
      ${row('🗓', 'Прогноз на следующие месяцы', 'что и когда придётся платить', 'forecast', { k: 1 })}
      ${row('📋', 'Подробный план', 'все суммы и расчёт до зарплаты', 'view', { name: 'plan', title: 'Подробный план' })}
      ${row('☀️', 'Сводка на сегодня', 'то же, что в утреннем сообщении', 'view', { name: 'digest', title: 'Сводка на сегодня' })}
    </div>
    <h2>Настроить учёт</h2><div class="list">
      ${row('🎚', 'Лимиты по категориям', s.catLimits.length ? `задано: ${s.catLimits.length}` : 'например, еда — 20 000 в месяц', 'cat-limits')}
      ${row('🗂', 'Свои категории', 'добавить или удалить', 'cats')}
      ${row('🧭', 'Пройти настройку заново', 'остаток, доход, платежи', 'wizard', { step: 1 })}
      ${row('📋', 'Чего ещё не хватает', 'чек-лист: что внести', 'view', { name: 'guide', title: 'Чего ещё не хватает' })}
    </div>
    <h2>Данные</h2><div class="list">
      ${row('📥', 'Загрузить выписку Т-Банка', 'PDF «Справка о движении средств»', 'import')}
      ${row('⬇️', 'Выгрузить траты в файл', 'таблица CSV придёт в чат с ботом', 'export-csv')}
      ${row('🕘', 'История изменений', `${s.log.length ? s.log.length + ' последних записей' : 'пока пусто'}`, 'log')}
    </div>
    <h2>Настройки</h2><div class="list">
      ${row('☀️', 'Сообщение каждое утро', s.settings.digest ? 'включено' : 'выключено', 'digest')}
      ${row('📆', 'С какого числа считать месяц', s.settings.cycleAnchor ? `с ${s.settings.cycleAnchor}-го числа` : 'автоматически, от зарплаты', 'cycle')}
    </div>
    <h2>Помощь</h2><div class="list">
      ${row('🤖', 'Спросить совет у ИИ', 'готовый текст с данными для ChatGPT или Claude', 'ai')}
      ${row('❓', 'Справка', '', 'view', { name: 'help', title: 'Справка' })}
    </div>
    <h2>Дополнительно</h2><div class="list">
      ${row('⌨️', 'Команды бота', 'для тех, кто привык к командам', 'console')}
      ${s.usage ? row('💾', 'Объём данных', `${Math.max(1, Math.round(s.usage.bytes / 1024))} КБ · ${s.usage.percent}% лимита${s.usage.warn ? ' — пора разгрузить' : ''}`, 'usage') : ''}
      ${row('♻️', '<span class="neg">Стереть все данные</span>', 'бюджет этого чата будет очищен', 'reset')}
    </div>
    <p class="small muted center">Изменения сразу видны в боте, а закреплённая сводка в чате обновляется сама.</p>`;
}

export const TAB = { home: homeTab, spends: spendsTab, plan: planTab, goals: goalsTab, reserve: reserveTab, more: moreTab };

let renderedTab = null;
export function render() {
  if (!S.state) return;
  if (S.tab !== renderedTab) { S.planSettled = null; renderedTab = S.tab; }
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
