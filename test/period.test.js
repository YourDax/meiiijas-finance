import test from 'node:test';
import assert from 'node:assert/strict';
import { computePeriod, confirmOccurrence, occurrences, dn } from '../lib/period.js';
import { processUpdate } from '../lib/engine.js';
import { normalize } from '../lib/bot.js';
import { formatPlanFull as formatPlan } from '../lib/format.js';
import { formatDigest } from '../lib/digest.js';

const at = (y, m, d, h = 12) => ({ y, m, d, ts: new Date(y, m, d, h).getTime(), dayStart: new Date(y, m, d).getTime(), monthStart: new Date(y, m, 1).getTime() });
const today = at(2026, 9, 24); // 24 октября
const r2 = (n) => Math.round(n * 100) / 100;

const base = (extra = {}) => normalize({
  balance: { amount: 30000, ts: new Date(2026, 9, 24, 8).getTime() },
  items: [
    { id: 'adv', type: 'income', amount: 40000, day: 5, name: 'Аванс' },
    { id: 'sal', type: 'income', amount: 60000, day: 20, name: 'Зарплата' },
    { id: 'rent', type: 'bill', amount: 25000, day: 1, name: 'Аренда' },
    { id: 'net', type: 'bill', amount: 700, day: 28, name: 'Интернет' },
  ],
  ...extra,
});

test('период идёт до следующего дохода через границу месяца', () => {
  const p = computePeriod(base(), today);
  assert.equal(p.nextIncome.name, 'Аванс');
  assert.equal(p.days, 12); // 24 окт -> 5 ноя
  assert.deepEqual(p.dueList.map((o) => o.name), ['Интернет', 'Аренда']);
  assert.equal(p.dueSum, 25700);
  assert.equal(p.pool, 4300);
  assert.equal(p.perDay, r2(4300 / 12));
  assert.equal(p.gaps.length, 0);
});

test('будущий доход не входит в лимит', () => {
  const p = computePeriod(base({ balance: { amount: 5000, ts: today.ts - 1000 } }), today);
  assert.equal(p.pool, 5000 - 25700);
  assert.equal(p.gaps.length, 1);
  assert.equal(p.shortfall, 20700);
  assert.equal(p.gaps[0].occ.name, 'Аренда');
});

test('события не позже даты задания остатка уже учтены, позже — ждут подтверждения', () => {
  const d = base({ balance: { amount: 30000, ts: new Date(2026, 9, 20, 8).getTime() } });
  assert.equal(computePeriod(d, today).pending.length, 0);
  const d2 = base({ balance: { amount: 30000, ts: new Date(2026, 9, 18, 8).getTime() } });
  const p = computePeriod(d2, today);
  assert.deepEqual(p.pending.map((o) => o.name), ['Зарплата']);
  assert.equal(p.now, 30000);
});

test('«Пришло» увеличивает остаток один раз и убирает ожидание', () => {
  const d = base({ balance: { amount: 30000, ts: new Date(2026, 9, 18, 8).getTime() } });
  const key = computePeriod(d, today).pending[0].key;
  confirmOccurrence(d, key, today);
  assert.equal(d.balance.amount, 90000);
  assert.equal(computePeriod(d, today).pending.length, 0);
  assert.equal(computePeriod(d, today).now, 90000);
});

test('«Не было» ничего не меняет в остатке', () => {
  const d = base({ balance: { amount: 30000, ts: new Date(2026, 9, 18, 8).getTime() } });
  const key = computePeriod(d, today).pending[0].key;
  confirmOccurrence(d, key, today, true);
  assert.equal(d.balance.amount, 30000);
  assert.equal(computePeriod(d, today).pending.length, 0);
});

test('неоплаченный платёж остаётся долгом, оплаченный списывается из остатка', () => {
  const d = base({
    balance: { amount: 30000, ts: new Date(2026, 9, 18, 8).getTime() },
    items: [
      { id: 'adv', type: 'income', amount: 40000, day: 5, name: 'Аванс' },
      { id: 'gym', type: 'bill', amount: 3000, day: 22, name: 'Зал' },
    ],
  });
  let p = computePeriod(d, today);
  assert.deepEqual(p.pendingBills.map((o) => o.name), ['Зал']);
  assert.equal(p.pool, 27000);
  confirmOccurrence(d, p.pendingBills[0].key, today);
  p = computePeriod(d, today);
  assert.equal(d.balance.amount, 27000);
  assert.equal(p.pool, 27000);
});

test('«в течение месяца» режется по дням периода и не задваивается с тратой той же категории', () => {
  const d = base({
    items: [
      { id: 'adv', type: 'income', amount: 40000, day: 5, name: 'Аванс' },
      { id: 'trn', type: 'bill', amount: 6200, day: null, spread: true, cat: 'transport', name: 'Транспорт' },
    ],
  });
  // цикл бюджета 5 окт -> 5 ноя: период 24 окт -> 5 ноя — последний в цикле, резервируется весь остаток суммы
  const p = computePeriod(d, today);
  assert.equal(p.reserveTotal, 6200);
  assert.equal(p.nextReserve, 0);
  // такси 500 уменьшает остаток статьи и деньги на руках одновременно — лимит не меняется
  const d2 = structuredClone(d);
  d2.spends = [{ id: 's', amount: 500, cat: 'transport', ts: today.ts }];
  const p2 = computePeriod(d2, today);
  assert.equal(p2.pool, p.pool);
  assert.equal(p2.freeToday, 0);
  // кофе — свободная трата: пул уменьшается на всю сумму
  const d3 = structuredClone(d);
  d3.spends = [{ id: 's', amount: 400, cat: 'cafe', ts: today.ts }];
  const p3 = computePeriod(d3, today);
  assert.equal(p3.pool, r2(p.pool - 400));
  assert.equal(p3.freeToday, 400);
});

test('«сегодня ещё» = дневной бюджет минус потраченное сегодня', () => {
  const d = base();
  const p0 = computePeriod(d, today);
  d.spends = [{ id: 's', amount: 150, cat: 'cafe', ts: today.ts }];
  const p1 = computePeriod(d, today);
  assert.equal(p1.dayBudget, p0.dayBudget);
  assert.equal(p1.leftToday, r2(p0.dayBudget - 150));
});

test('нет будущих доходов — считаем до конца месяца', () => {
  const d = normalize({ balance: { amount: 8000, ts: today.ts - 1000 }, items: [{ id: 'r', type: 'bill', amount: 1000, day: 28, name: 'Связь' }] });
  const p = computePeriod(d, today);
  assert.equal(p.noIncome, true);
  assert.equal(p.days, 8);
});

test('occurrences: однократные пункты и конец месяца', () => {
  const items = [
    { id: 'a', type: 'bill', amount: 1, day: 31, name: 'a' },
    { id: 'b', type: 'bill', amount: 1, day: 10, name: 'b', once: '2026-11' },
  ];
  const occ = occurrences(items, dn(2026, 10, 1), dn(2026, 11, 31));
  assert.deepEqual(occ.map((o) => o.key.split(':')[1]), ['20261110', '20261130', '20261231']);
});

test('сводка и дайджест: период и подтверждения', () => {
  const d = base({ balance: { amount: 30000, ts: new Date(2026, 9, 18, 8).getTime() } });
  const plan = formatPlan(d, today);
  assert.match(plan, /план до следующего дохода/);
  assert.match(plan, /Ждут подтверждения/);
  assert.match(plan, /Следующий доход: Аванс/);
  assert.doesNotMatch(plan, /Бюджеты месяца|Подушка/);
  const dig = formatDigest(d, today);
  assert.match(dig, /Подтверди кнопками/);
  assert.match(dig, /Сегодня можно потратить/);
});

test('движок: «Пришло» -> остаток, предложение отложить в цель, повтор не двоит', async () => {
  const init = base({
    balance: { amount: 12000, ts: new Date(2026, 9, 18, 8).getTime() },
    goals: [{ id: 'g1', name: 'Отпуск', target: 100000, saved: 0, deadline: '2027-06' }],
  });
  const db = new Map([[1, init]]);
  const sent = [];
  const store = { load: async (id) => db.get(id), save: async (id, d) => db.set(id, structuredClone(d)) };
  const tg = {
    send: async (c, t, e) => { sent.push({ t, e }); return { ok: true, result: { message_id: 9 } }; },
    edit: async (c, i, t) => { sent.push({ t, edit: true }); return { ok: true }; },
    answer: async () => ({}),
    pin: async () => ({}),
  };
  const from = { id: 5, first_name: 'Лео' };
  const press = (data) => processUpdate({ callback_query: { id: 'q', data, from, message: { chat: { id: 1 }, message_id: 5 } } }, { store, tg, today });

  const key = computePeriod(db.get(1), today).pending[0].key; // зарплата 20-го
  await press(`cf:${key}`);
  assert.equal(db.get(1).balance.amount, 72000);
  const offer = sent.find((m) => m.t?.includes('Отложить в цель'));
  assert.ok(offer, 'предложили отложить остаток');
  const btn = offer.e.reply_markup.inline_keyboard[0][0].callback_data;
  assert.equal(btn, 'lg:g1:12000');

  await press(`cf:${key}`);
  assert.equal(db.get(1).balance.amount, 72000, 'повторное нажатие не двоит');

  await press(btn);
  assert.equal(db.get(1).goals[0].saved, 12000);
  assert.equal(db.get(1).balance.amount, 60000, 'отложенное вычтено из остатка');
});

test('нехватка дохода в следующем периоде откладывается из текущего', () => {
  const d = normalize({
    balance: { amount: 30000, ts: new Date(2026, 9, 24, 8).getTime() },
    items: [
      { id: 'adv', type: 'income', amount: 10000, day: 5, name: 'Аванс' },
      { id: 'sal', type: 'income', amount: 30000, day: 20, name: 'Зарплата' },
      { id: 'ins', type: 'bill', amount: 50000, day: 25, name: 'Страховка', once: '2026-11' },
    ],
  });
  const p = computePeriod(d, today);
  // период 20 ноя -> 5 дек: доход 30 000, платёж 50 000 => нужно привезти 20 000;
  // период 5 -> 20 ноя даёт только 10 000, значит 10 000 откладываем уже сейчас
  assert.equal(p.nextPeriod.need, 10000);
  assert.equal(p.reserveNextPeriod, 10000);
  assert.equal(p.pool0, 30000);
  assert.equal(p.pool, 20000);
  assert.equal(p.perDay, r2(20000 / 12));
  const text = formatPlan(d, today);
  assert.match(text, /Отложить на следующий период/);
  assert.match(text, /🧮/);
  assert.match(formatDigest(d, today), /Не трогай 10 000/);
});

test('если откладывать нечего — пул равен свободным деньгам, строка расчёта показывает вычеты', () => {
  const d = base();
  const p = computePeriod(d, today);
  assert.equal(p.reserveNextPeriod, 0);
  const text = formatPlan(d, today);
  assert.match(text, /🧮 <b>30 000 ₽<\/b> на руках − 25 700 ₽ платежи = <b>4 300 ₽<\/b>/);
});

test('траты «на цикл» между основными доходами, а не на календарный месяц', () => {
  // как у пользователя: доходы 5-го и 20-го, цикл 5 окт -> 5 ноя, сегодня 24 окт
  const d = normalize({
    balance: { amount: 52926, ts: today.ts - 1000 },
    items: [
      { id: 's', type: 'income', amount: 102600, day: 5, name: 'Зарплата' },
      { id: 'a', type: 'income', amount: 17400, day: 20, name: 'Аванс' },
      { id: 'r', type: 'bill', amount: 43000, day: 27, name: 'Аренда' },
      { id: 'p', type: 'bill', amount: 2950, day: 27, name: 'Интернет и коммуналка' },
      { id: 'pet', type: 'bill', amount: 4000, day: null, spread: true, cat: 'pets', name: 'Домашнее животное' },
      { id: 'trn', type: 'bill', amount: 7100, day: null, spread: true, cat: 'transport', name: 'Транспорт' },
    ],
    spends: [
      { id: '1', amount: 3530, cat: 'pets', ts: new Date(2026, 9, 24, 10).getTime() - 5000000 },
      { id: '2', amount: 7100, cat: 'transport', ts: new Date(2026, 9, 10).getTime() },
    ],
  });
  const p = computePeriod(d, today);
  assert.equal(p.cycleStart, dn(2026, 9, 5));
  assert.equal(p.cycleEnd, dn(2026, 10, 5));
  assert.equal(p.nextReserve, 0, 'никаких долей на 1–4 ноября');
  assert.equal(p.reserveTotal, 470); // осталось от «животного»; транспорт на цикл уже потрачен
  assert.equal(p.pool, 52926 - 45950 - 470);
});

test('/cycle задаёт день начала цикла и меняет резерв', async () => {
  const { handleMessage } = await import('../lib/bot.js');
  const d = normalize({
    balance: { amount: 20000, ts: today.ts - 1000 },
    items: [
      { id: 's', type: 'income', amount: 50000, day: 5, name: 'Зарплата' },
      { id: 'trn', type: 'bill', amount: 2700, day: null, spread: true, cat: 'transport', name: 'Транспорт' },
    ],
  });
  assert.equal(computePeriod(d, today).reserveTotal, 2700); // цикл 5 -> 5, последний период
  const r = handleMessage('/cycle 20', d, today);
  assert.equal(r.data.settings.cycleAnchor, 20);
  // цикл 20 окт -> 20 ноя: осталось 27 дн., период 12 дн. => 12/27 остатка
  assert.equal(computePeriod(r.data, today).reserveTotal, r2(2700 * 12 / 27));
  assert.match(handleMessage('/cycle auto', r.data, today).reply, /авто/);
  assert.match(handleMessage('/cycle', d, today).reply, /Цикл бюджета сейчас/);
});

test('транспорт по формуле: резервируются будни впереди, даже если ранее потрачено больше', () => {
  const sunday = at(2026, 9, 25); // воскресенье, период до 5 ноября
  const d = normalize({
    balance: { amount: 7159, ts: sunday.ts - 1000 },
    items: [
      { id: 'sal', type: 'income', amount: 102600, day: 5, name: 'Зарплата' },
      { id: 'trn', type: 'bill', amount: 7640, day: null, spread: true, cat: 'transport', name: 'Транспорт', formula: { base: 3500, daily: 180 } },
    ],
    spends: [{ id: 's', amount: 7100, cat: 'transport', ts: sunday.ts - 86400000 }],
  });
  const p = computePeriod(d, sunday);
  // будни 26–30 октября (5) и 2–4 ноября (3) = 8 дней × 180
  assert.equal(p.spread[0].reserve, 1440);
  assert.equal(p.pool, 7159 - 1440);
  assert.match(formatDigest(d, sunday), /Уже вычтено обязательное: транспорт 1 440/);
});

test('короткая сводка показывает, из чего состоят обязательные траты', async () => {
  const { formatPlan } = await import('../lib/format.js');
  const sunday = at(2026, 9, 25);
  const d = normalize({
    balance: { amount: 7159, ts: sunday.ts - 1000 },
    items: [
      { id: 'sal', type: 'income', amount: 102600, day: 5, name: 'Зарплата' },
      { id: 'trn', type: 'bill', amount: 7640, day: null, spread: true, cat: 'transport', name: 'Транспорт', formula: { base: 3500, daily: 180 } },
      { id: 'pet', type: 'bill', amount: 4000, day: null, spread: true, cat: 'pets', name: 'Домашнее животное' },
    ],
    spends: [{ id: 's1', amount: 7100, cat: 'transport', ts: sunday.ts - 86400000 }, { id: 's2', amount: 3530, cat: 'pets', ts: sunday.ts - 86400000 }],
  });
  const text = formatPlan(d, sunday);
  assert.match(text, /обязательные траты 1 910 ₽ \(транспорт 1 440 ₽, домашнее животное 470 ₽\)/);
});

test('сообщение о пополнении показывает деньги на карте с учётом трат после /balance', async () => {
  const sunday = at(2026, 9, 27, 11);
  const sent = [];
  const db = new Map([[1, normalize({
    balance: { amount: 8009, ts: sunday.ts - 2 * 86400000 },
    spends: [
      { id: 'a', amount: 180, cat: 'transport', ts: sunday.ts - 86400000 },
      { id: 'b', amount: 700, cat: 'food', ts: sunday.ts - 86400000 },
      { id: 'c', amount: 100, cat: 'pets', ts: sunday.ts - 86400000 },
    ],
    items: [{ id: 'sal', type: 'income', amount: 100000, day: 5, name: 'Зарплата' }],
  })]]);
  const store = { load: async (id) => db.get(id), save: async (id, d) => db.set(id, structuredClone(d)) };
  const tg = { send: async (c, t) => { sent.push(t); return { ok: true, result: { message_id: 9 } }; }, edit: async () => ({ ok: true }), answer: async () => ({}), pin: async () => ({}) };
  await processUpdate({ message: { chat: { id: 1 }, from: { id: 5 }, text: 'пополнение 500' } }, { store, tg, today: sunday });
  // 8 009 + 500 − 980 потрачено = 7 529 — столько же, сколько в /plan
  assert.match(sent[0], /Теперь на карте 7 529 ₽/);
  assert.equal(computePeriod(db.get(1), sunday).now, 7529);
});
