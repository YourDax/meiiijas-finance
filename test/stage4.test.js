import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFree, parseAny } from '../lib/nlp.js';
import { parseBatch } from '../lib/batch.js';
import { computePlan } from '../lib/budget.js';
import { formatList, formatPlanFull as formatPlan } from '../lib/format.js';
import { processUpdate } from '../lib/engine.js';
import { normalize } from '../lib/bot.js';

const today = { y: 2026, m: 9, d: 24, ts: new Date(2026, 9, 24, 12).getTime() };

function harness(init) {
  const db = new Map([[1, init ?? normalize(null)]]);
  const sent = [];
  const store = { load: async (id) => db.get(id), save: async (id, d) => db.set(id, structuredClone(d)) };
  const tg = { send: async (c, t) => { sent.push(t); return { ok: true, result: { message_id: 9 } }; }, edit: async (c, i, t) => { sent.push(t); return { ok: true }; }, answer: async () => ({}), pin: async () => ({}) };
  return { db, sent, run: (u) => processUpdate(u, { store, tg, today }),
    msg: (text) => ({ message: { chat: { id: 1 }, from: { first_name: 'Лео' }, text } }),
    press: (d) => ({ callback_query: { id: 'q', data: d, from: { first_name: 'Лео' }, message: { chat: { id: 1 }, message_id: 5 } } }) };
}

test('обязательная трата без числа — на весь месяц', () => {
  const p = parseFree('транспорт 6000 в месяц', today);
  assert.deepEqual([p.kind, p.amount, p.spread, p.cat, p.day], ['bill', 6000, true, 'transport', null]);
  assert.equal(parseFree('аренда 25000 1 числа', today).spread, undefined);
});

test('резерв «в течение месяца» не задваивается с тратами той же категории', () => {
  const base = normalize({
    balance: { amount: 50000, ts: today.ts - 1000 },
    items: [{ type: 'bill', amount: 6000, day: null, spread: true, cat: 'transport', name: 'Транспорт' }],
  });
  const a = computePlan(base, today);
  assert.equal(a.reservedSpread, 6000);
  assert.equal(a.endBalance, 44000);
  // потратили 1000 на такси: остаток на руках -1000, резерв -1000 => итог не меняется
  const b = computePlan({ ...base, spends: [{ amount: 1000, cat: 'transport', ts: today.ts }] }, today);
  assert.equal(b.reservedSpread, 5000);
  assert.equal(b.endBalance, 44000);
  // трата в другой категории уменьшает итог
  const c = computePlan({ ...base, spends: [{ amount: 1000, cat: 'cafe', ts: today.ts }] }, today);
  assert.equal(c.endBalance, 43000);
  assert.equal(computePlan(base, today).totalBills, 6000);
  assert.match(formatPlan({ ...base, items: [...base.items, { type: 'income', amount: 90000, day: 30, name: 'ЗП' }] }, today), /на цикл/i);
});

test('разовые на конкретный месяц', () => {
  const a = parseFree('ремонт 15000 в ноябре', today);
  assert.deepEqual([a.kind, a.once, a.onceYm, a.day], ['bill', true, '2026-11', 1]);
  const b = parseFree('премия 20к 5 декабря', today);
  assert.deepEqual([b.kind, b.onceYm, b.day], ['income', '2026-12', 5]);
  assert.equal(parseFree('отпуск 50000 на январь 2027', today).onceYm, '2027-01');
  assert.equal(parseFree('кофе 450', today).kind, 'spend');
});

test('пункт на будущий месяц не влияет на текущий план, но виден в /list', () => {
  const data = normalize({ items: [
    { id: 'a', type: 'income', amount: 80000, day: 5, name: 'Аванс' },
    { id: 'b', type: 'bill', amount: 15000, day: 1, name: 'Ремонт', once: '2026-11' },
  ] });
  assert.equal(computePlan(data, today).totalBills, 0);
  const list = formatList(data, today);
  assert.match(list, /Запланировано на другие месяцы/);
  assert.match(list, /ноябрь 2026/);
  const nov = { y: 2026, m: 10, d: 1, ts: new Date(2026, 10, 1, 9).getTime() };
  assert.equal(computePlan(data, nov).totalBills, 15000);
});

test('пакет: без числа — на весь месяц; заголовок с месяцем', () => {
  const r = parseBatch('Обязательные:\nаренда 25000 1\nтранспорт 6000\nРазовые на ноябрь:\nремонт 15000 10\nподарок 3000', today);
  const by = (n) => r.items.find((i) => i.name.toLowerCase().startsWith(n));
  assert.equal(by('аренда').day, 1);
  assert.equal(by('транспорт').spread, true);
  assert.deepEqual([by('ремонт').once, by('ремонт').onceYm, by('ремонт').day], [true, '2026-11', 10]);
  assert.equal(by('подарок').onceYm, '2026-11');
});

test('разовое пополнение: с балансом, без баланса, отмена', async () => {
  assert.equal(parseAny('пополнил баланс 5000', today).kind, 'topup');
  assert.equal(parseAny('пополнил копилку 3000 на отпуск', today).kind, 'save');

  const h = harness(normalize({ balance: { amount: 10000, ts: today.ts - 1000 } }));
  await h.run(h.msg('пополнил баланс 5000'));
  assert.equal(h.db.get(1).balance.amount, 15000);
  const id = h.db.get(1).topups[0].id;
  await h.run(h.press(`utop:${id}`));
  assert.equal(h.db.get(1).balance.amount, 10000);

  const h2 = harness();
  await h2.run(h2.msg('/topup 3000 Подарок'));
  const d = h2.db.get(1);
  assert.equal(d.items.length, 1);
  assert.equal(d.items[0].once, '2026-10');
  assert.equal(computePlan(d, today).totalIncome, 3000);
});

test('движок: карточка для траты на месяц и разовой на ноябрь', async () => {
  const h = harness();
  await h.run(h.msg('транспорт 6000 в месяц'));
  assert.match(h.sent.at(-1), /В течение месяца/);
  await h.run(h.press(`ok:${h.db.get(1).pending[0].id}`));
  assert.equal(h.db.get(1).items[0].spread, true);
  await h.run(h.msg('ремонт 15000 в ноябре'));
  assert.match(h.sent.at(-1), /ноябрь 2026/);
  await h.run(h.press(`ok:${h.db.get(1).pending[0].id}`));
  assert.equal(h.db.get(1).items[1].once, '2026-11');
  await h.run(h.msg('/bill 3000 Продукты'));
  assert.equal(h.db.get(1).items[2].spread, true);
});
