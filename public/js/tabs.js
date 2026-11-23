// Вкладки: главная, история, план, цели, резерв, ещё.
import { S, api } from './state.js';
import { $, tz, esc, money, isoStr, ymLabel, ymGen, catIcon, catTitle, thisMonth, recentNames, setInfo } from './util.js';
import { btn } from './ui.js';
import { compareSpends } from '../stats.js';
import { historyTab } from './history.js';

// ---------- вкладки ----------
export const TABS = [['home', '🏠', 'Главная'], ['history', '🧾', 'История'], ['plan', '📅', 'План'], ['goals', '🎯', 'Цели'], ['reserve', '🏦', 'Счета'], ['more', '⚙️', 'Ещё']];

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
      <div class="grow"><b>${esc(o.name)}</b><div class="small muted">${isoStr(o.date)}${o.fromReserve && s.reserve ? ' · из копилки' : ''}</div></div>
      <b class="${o.type === 'income' ? 'pos' : ''}">${o.type === 'income' ? '+' : '−'}${money(o.amount)}</b></div>
      <div class="row gap" style="margin-top:10px">
        ${btn(o.type === 'income' ? '✅ Получено' : '✅ Оплачено', 'occ', { key: o.key }, 'grow')}
        ${btn('Не было', 'occ', { key: o.key, skip: 1 }, 'ghost')}
      </div></div>`).join('');
  const gaps = p.gaps.map((g) => `<div class="card alert bad small">⚠️ Перед «${esc(g.name)}» (${isoStr(g.date)}) не хватит <b>${money(g.short)}</b></div>`).join('');
  // Платежи из блока «Было или нет?» второй раз не показываем
  const dueRows = p.dueList.filter((o) => !p.pending.some((x) => x.key === o.key));
  const due = dueRows.length ? `${sec('Ближайшие платежи', money(dueRows.reduce((a, o) => a + o.amount, 0)))}<div class="list">${dueRows.map((o) => payRow(s.payments?.find((x) => x.key === o.key) ?? { ...o, status: 'open', past: true })).join('')}</div>` : '';
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
      <div class="bar ${p.freeToday > p.dayBudget ? 'over' : ''}"><i style="width:${p.dayBudget > 0 ? Math.min(100, Math.round(p.freeToday / p.dayBudget * 100)) : 0}%"></i></div>
      <div class="small muted">${p.dayBudget > 0 ? `Потрачено ${money(p.freeToday)} из ${money(p.dayBudget)} на день` : `Потрачено ${money(p.freeToday)}, свободных денег на день нет`}</div>
      ${p.afterOverspend ? `<div class="small overspend-forecast">${p.afterOverspend.days > 0
        ? `С завтра в среднем <b>${money(p.afterOverspend.perDay)} в день</b>`
        : 'Сегодня последний день расчётного периода'}</div>` : ''}
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
      <div class="stat"><span class="small muted">Можно потратить</span><b>${money(Math.max(0, p.pool))}</b></div>
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
  return `<div class="item payrow" data-act="item-edit" data-id="${esc(o.id)}" data-key="${esc(o.key)}"><div class="ico">${PAY_ICO[o.status]}</div><div class="grow"><div class="t">${esc(o.name)}</div><div class="s">${isoStr(o.date)}${reserve}${note}</div></div>
    <div class="amt ${o.type === 'income' ? 'pos' : ''}">${o.type === 'income' ? '+' : '−'}${money(o.amount)}</div><div class="payact">${payAction(o)}</div></div>`;
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

function limitsBlock() {
  const list = S.state.catLimits ?? [];
  if (!list.length) return '';
  return `<h2>Лимиты на месяц</h2><div class="card">${list.map((l) => { const over = l.spent > l.limit; return `<div class="tap" data-act="cat-limit-edit" data-cat="${esc(l.cat)}" style="margin:2px 0 8px"><div class="row between small"><span>${esc(catTitle(l.cat))}</span><b class="${over ? 'neg' : ''}">${money(l.spent)} из ${money(l.limit)}</b></div><div class="bar ${over ? 'over' : ''}"><i style="width:${Math.min(100, Math.round(l.spent / l.limit * 100))}%"></i></div></div>`; }).join('')}</div>`;
}

export const whenText = (it) => it.everyLabel ? it.everyLabel[0].toUpperCase() + it.everyLabel.slice(1)
  : it.spread ? (it.once ? `В течение месяца · ${ymLabel(it.once)}` : 'В течение месяца')
    : it.once ? `Один раз · ${it.day}-го, ${ymLabel(it.once)}` : `Каждый месяц · ${it.day}-го`;

export function planTab() {
  const s = S.state;
  const p = s.monthPlan;
  if (!p) return '<h1>План</h1><p class="muted">Загрузка плана…</p>';
  const [year, month] = p.ym.split('-').map(Number);
  const offset = (year - s.today.y) * 12 + month - 1 - s.today.m;
  const byId = new Map(s.items.map((it) => [it.id, it]));
  const row = (o, spread) => {
    const skipped = o.status === 'skipped';
    const formula = spread && !o.customAmount ? byId.get(o.id)?.formula : null;
    const subtitle = [
      spread ? catTitle(o.cat) : isoStr(o.date),
      o.once ? 'Разовый' : '',
      o.fromReserve && s.reserve ? 'Из копилки' : '',
      o.customAmount ? 'Сумма изменена' : '',
      o.status === 'done' ? `Подтверждено${o.actualAmount != null && o.actualAmount !== o.amount ? ` · ${money(o.actualAmount)}` : ''}` : '',
      skipped ? 'Не платим в этом месяце' : '',
      o.status === 'auto' ? 'Учтено в остатке' : '',
      formula ? `${money(formula.base)} за проездной + ${money(formula.daily)} × ${o.travelDays} дн.` : '',
    ].filter(Boolean).map(esc).join(' · ');
    const icon = o.status === 'done' ? '✅' : o.status === 'skipped' ? '⏭' : spread ? catIcon(o.cat) : o.type === 'income' ? '💰' : '📌';
    const progress = spread ? `<div class="plan-progress">
      <div class="small muted">Потрачено ${money(o.spent)} из ${money(o.amount)}</div>
      <progress aria-label="Потрачено ${money(o.spent)} из ${money(o.amount)}" class="${o.spent > o.amount ? 'over' : ''}" value="${Math.min(o.spent, o.amount)}" max="${o.amount || 1}"></progress>
    </div>` : '';
    const skip = o.type !== 'income' && o.status !== 'done' ? btn(skipped ? 'Вернуть в план' : 'Не платить в этом месяце', 'plan-month-skip',
      { id: o.id, key: o.key ?? '', month: p.ym }, 'ghost small') : '';
    const transport = o.transport ? btn('Настроить транспорт', 'transport', { id: o.id }, 'ghost small') : '';
    return `<div class="plan-record${skipped ? ' plan-record-skipped' : ''}">
      <div class="item plan-record-entry" data-act="plan-entry" data-id="${esc(o.id)}" data-key="${esc(o.key)}">
        <div class="ico" aria-hidden="true">${icon}</div><div class="grow"><div class="t">${esc(o.name)}</div><div class="s">${subtitle}</div></div>
        <div class="amt ${o.type === 'income' ? 'pos' : ''}">${money(o.amount)}</div><span class="muted" aria-hidden="true">›</span>
      </div>
      ${progress}
      ${skip || transport ? `<div class="plan-record-actions row wrap gap">${skip}${transport}</div>` : ''}
    </div>`;
  };
  const section = (title, rows, spread = false) => rows.length ? `${sec(title, money(rows.reduce((sum, x) => sum + (x.status === 'skipped' ? 0 : x.amount), 0)))}<div class="list">${rows.map((o) => row(o, spread)).join('')}</div>` : '';
  return `
    <div class="row between"><h1>План</h1>${btn('＋ Добавить', 'item-add', { month: p.ym }, 'small')}</div>
    <div class="plan-month-nav">
      <button class="ghost" data-act="plan-month" data-step="-1" aria-label="Предыдущий месяц">‹</button>
      <div><strong>${ymLabel(p.ym)}</strong><input type="month" aria-label="Месяц плана" data-input="plan-month" value="${p.ym}" min="2000-01" max="2099-12"></div>
      <button class="ghost" data-act="plan-month" data-step="1" aria-label="Следующий месяц относительно выбранного">›</button>
    </div>
    <div class="row between small plan-month-shortcuts">
      ${btn('Текущий', 'plan-month', { month: thisMonth() }, 'ghost small')}${btn('Следующий', 'plan-next', {}, 'ghost small')}
    </div>
    <div class="card lines">
      <div class="row between"><span class="muted">Доходы</span><b class="pos">${money(p.totalIncome)}</b></div>
      <div class="row between"><span class="muted">Обязательные расходы</span><b>${money(p.totalBills)}</b></div>
      <div class="row between"><span class="muted">Остаётся по плану</span><b class="${p.free < 0 ? 'neg' : ''}">${money(p.free)}</b></div>
    </div>
    ${section('Поступления', p.incomes)}
    ${section('Платежи по датам', p.bills)}
    ${section('В течение месяца', p.spreads, true)}
    ${!p.incomes.length && !p.bills.length && !p.spreads.length ? '<p class="muted center">На этот месяц ничего не запланировано.</p>' : ''}
    ${sec('Подробнее')}<div class="row gap wrap">
      ${btn('💬 Записать фразой', 'nl', {}, 'ghost small')}
      ${offset > 0 && offset <= 6 ? btn('🗓 Прогноз на этот месяц', 'forecast', { k: offset }, 'ghost small') : btn('📋 Подробный текущий план', 'view', { name: 'plan', title: 'План подробно' }, 'ghost small')}
      ${btn('Регулярные и разовые пункты', 'plan-templates', {}, 'ghost small')}
      ${p.spreads.some((x) => x.transport) ? '' : btn('Настроить транспорт', 'transport', {}, 'ghost small')}
    </div>`;
}

export function goalsTab() {
  const gs = S.state.goals;
  return `<div class="row between"><h1>Цели</h1>${btn('➕ Цель', 'goal-add', {}, 'small')}</div>
    ${gs.length ? gs.map((g) => { const st = g.status; return `
      <div class="card"><div class="row between"><b>🎯 ${esc(g.name)}</b>${st.done ? '<span class="tag">готово ✅</span>' : st.overdue ? '<span class="tag">срок вышел</span>' : ''}</div>
        <div class="small muted">до ${ymGen(g.deadline)}${st.done || st.overdue ? '' : ` · осталось ${st.monthsLeft} мес.`}</div>
        <div class="bar ${st.done ? 'ok' : ''}" style="margin:10px 0 6px"><i style="width:${st.percent}%"></i></div>
        <div class="row between small"><span>${money(g.saved)} из ${money(g.target)}</span><b>${st.percent}%</b></div>
        ${st.done ? '' : `<div class="small muted">${st.overdue ? `Осталось накопить ${money(st.remaining)}. Можно изменить срок` : `Откладывать по ${money(st.perMonth)} в месяц`}</div>`}
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
    ${sec('Транспорт')}<div class="card">${btn('🚌 Настроить транспорт', 'transport', {}, 'ghost block')}</div>`;
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

export const TAB = { home: homeTab, history: () => historyTab(limitsBlock()), plan: planTab, goals: goalsTab, reserve: reserveTab, more: moreTab };

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
