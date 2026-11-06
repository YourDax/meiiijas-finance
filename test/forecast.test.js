import test from 'node:test';
import assert from 'node:assert/strict';
import { computeForecast, formatForecast } from '../lib/forecast.js';
import { processUpdate } from '../lib/engine.js';
import { normalize, handleMessage } from '../lib/bot.js';
import { dashMarkup } from '../lib/format.js';

const at = (y, m, d) => ({ y, m, d, ts: new Date(y, m, d, 12).getTime(), dayStart: new Date(y, m, d).getTime(), monthStart: new Date(y, m, 1).getTime() });
const today = at(2026, 9, 24);
const r2 = (n) => Math.round(n * 100) / 100;

const data = () => normalize({
  items: [
    { id: 'adv', type: 'income', amount: 40000, day: 5, name: 'Аванс' },
    { id: 'sal', type: 'income', amount: 60000, day: 20, name: 'Зарплата' },
    { id: 'rent', type: 'bill', amount: 25000, day: 1, name: 'Аренда' },
    { id: 'net', type: 'bill', amount: 700, day: 28, name: 'Интернет' },
    { id: 'trn', type: 'bill', amount: 6000, day: null, spread: true, cat: 'transport', name: 'Транспорт' },
  ],
  goals: [{ id: 'g', name: 'Отпуск', target: 90000, saved: 0, deadline: '2027-06' }],
});

test('прогноз следующего месяца: периоды между поступлениями', () => {
  const f = computeForecast(data(), today, 1); // ноябрь 2026
  assert.equal(f.ym, '2026-11');
  assert.equal(f.incomeTotal, 100000);
  assert.equal(f.billsTotal, 25000 + 700 + 6000);
  assert.equal(f.free, 68300);
  assert.equal(f.periods.length, 2);
  const [p1, p2] = f.periods;
  assert.equal(p1.days, 15); // 5 -> 20 ноября
  assert.equal(p1.dueSum, 0);
  assert.equal(p1.share, 3000);
  assert.equal(p1.free, 37000);
  assert.equal(p2.days, 15); // 20 ноября -> 5 декабря
  assert.equal(p2.dueSum, 25700); // интернет 28 ноября + аренда 1 декабря
  assert.equal(p2.share, 3000); // цикл 5 ноября -> 5 декабря: 15 из 30 дней
  assert.equal(p2.free, r2(60000 - 25700 - 3000));
});

test('разовые на будущий месяц попадают только в него', () => {
  const d = data();
  d.items.push({ id: 'rep', type: 'bill', amount: 15000, day: 10, name: 'Ремонт', once: '2026-11' });
  d.items.push({ id: 'bon', type: 'income', amount: 20000, day: 12, name: 'Премия', once: '2026-12' });
  const nov = computeForecast(d, today, 1);
  assert.equal(nov.billsTotal, 25000 + 700 + 6000 + 15000);
  assert.equal(nov.incomeTotal, 100000);
  assert.equal(nov.periods[0].dueSum, 15000);
  const dec = computeForecast(d, today, 2);
  assert.equal(dec.incomeTotal, 120000);
  assert.equal(dec.billsTotal, 25000 + 700 + 6000);
});

test('текст прогноза и навигация', () => {
  const text = formatForecast(data(), today, 1);
  assert.match(text, /Ноябрь 2026/);
  assert.match(text, /Что и когда/);
  assert.match(text, /Можно тратить на жизнь/);
  assert.match(text, /прибавится остаток текущего/);
  assert.ok(text.length < 1200, 'отчёт короткий');
  assert.match(formatForecast(normalize(null), today, 1), /Планировать пока нечего/);
  const r = handleMessage('/next 2', data(), today);
  assert.match(r.reply, /Декабрь 2026/);
  assert.deepEqual(r.markup.inline_keyboard[0].map((b) => b.callback_data), ['nx:1', 'nx:3']);
});

test('кнопка на сводке и листание в том же сообщении', async () => {
  assert.ok(dashMarkup().inline_keyboard.flat().some((b) => b.callback_data === 'nx:1'));
  const db = new Map([[1, { ...data(), dash: { mid: 5 } }]]);
  const sent = [];
  const store = { load: async (id) => db.get(id), save: async (id, d) => db.set(id, d) };
  const tg = { send: async (c, t) => { sent.push({ op: 'send', t }); return { ok: true, result: { message_id: 9 } }; }, edit: async (c, i, t) => { sent.push({ op: 'edit', t }); return { ok: true }; }, answer: async () => ({}), pin: async () => ({}) };
  const press = (cd, mid) => processUpdate({ callback_query: { id: 'q', data: cd, from: { id: 1 }, message: { chat: { id: 1 }, message_id: mid } } }, { store, tg, today });
  await press('nx:1', 5); // со сводки — новое сообщение
  assert.equal(sent.at(-1).op, 'send');
  await press('nx:2', 9); // из прогноза — правка того же сообщения
  assert.equal(sent.at(-1).op, 'edit');
  assert.match(sent.at(-1).t, /Декабрь 2026/);
});

test('прогноз: нехватка периода покрывается из предыдущего', () => {
  const d = normalize({
    items: [
      { id: 'adv', type: 'income', amount: 10000, day: 5, name: 'Аванс' },
      { id: 'sal', type: 'income', amount: 30000, day: 20, name: 'Зарплата' },
      { id: 'ins', type: 'bill', amount: 50000, day: 25, name: 'Страховка', once: '2026-11' },
    ],
  });
  const f = computeForecast(d, today, 1);
  const [p1, p2] = f.periods;
  assert.equal(p2.surplus, -20000);
  assert.equal(p2.need, 20000);
  assert.equal(p1.needNext, 20000);
  assert.equal(p1.free, -10000);
  assert.equal(p1.need, 10000);
  const text = formatForecast(d, today, 1);
  assert.match(text, /не хватает/); // страховка 50 000 при доходе 40 000: нехватка делится на дни цикла
});

test('деньги на жизнь делятся на все дни цикла, а не только на первый период', () => {
  const d = normalize({
    items: [
      { id: 'sal', type: 'income', amount: 100000, day: 5, name: 'Зарплата', toReserve: 30000 },
      { id: 'adv', type: 'income', amount: 20000, day: 20, name: 'Аванс', toReserve: 16000 },
      { id: 'rent', type: 'bill', amount: 46000, day: 27, name: 'Аренда' },
      { id: 'trn', type: 'bill', amount: 13160, day: null, spread: true, cat: 'transport', name: 'Транспорт' },
    ],
    reserve: { amount: 46000, ts: today.ts, history: [] },
  });
  const f = computeForecast(d, today, 1);
  const [p1, p2] = f.periods;
  assert.equal(p1.surplus, 63420); // 100 000 − 30 000 в резерв − 6 580 обязательные траты
  assert.equal(p2.surplus, -2580); // 20 000 − 16 000 в резерв − 6 580
  assert.equal(p1.liveDay, 2028); // (63 420 − 2 580) / 30 дней, а не 63 420 / 15
  assert.equal(p1.live, 30420);
  assert.equal(p2.live, 30420);
  assert.equal(p2.liveDay, 2028);
  const text = formatForecast(d, today, 1);
  assert.match(text, /≈2 028 ₽ в день/);
  assert.match(text, /из остатка зарплаты/);
});
