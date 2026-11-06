import test from 'node:test';
import assert from 'node:assert/strict';
import { processUpdate } from '../lib/engine.js';
import { normalize } from '../lib/bot.js';
import { formatList, listMarkup } from '../lib/format.js';
import { computePlan } from '../lib/budget.js';

const today = { y: 2026, m: 9, d: 24, ts: new Date(2026, 9, 24, 12).getTime(), monthStart: new Date(2026, 9, 1).getTime(), dayStart: new Date(2026, 9, 24).getTime() };

function harness(init) {
  const db = new Map([[1, init]]);
  const sent = [];
  const store = { load: async (id) => db.get(id), save: async (id, d) => db.set(id, structuredClone(d)) };
  const tg = { send: async (c, t, e) => { sent.push({ t, e }); return { ok: true, result: { message_id: 9 } }; }, edit: async (c, i, t, e) => { sent.push({ t, e, edit: true }); return { ok: true }; }, answer: async () => ({}), pin: async () => ({}) };
  const from = { id: 5, first_name: 'Лео' };
  return { db, sent, run: (u) => processUpdate(u, { store, tg, today }),
    msg: (text, f = from) => ({ message: { chat: { id: 1 }, from: f, text } }),
    press: (d) => ({ callback_query: { id: 'q', data: d, from, message: { chat: { id: 1 }, message_id: 5 } } }) };
}

const seed = () => normalize({
  items: [
    { id: 'rent', type: 'bill', amount: 25000, day: 1, name: 'Аренда' },
    { id: 'trn', type: 'bill', amount: 6000, day: null, spread: true, cat: 'transport', name: 'Транспорт' },
    { id: 'sal', type: 'income', amount: 80000, day: 5, name: 'Аванс' },
  ],
  spends: [{ id: 'cof', amount: 450, name: 'Кофе', cat: 'cafe', ts: today.ts - 1000, by: 'Лео' }],
});

test('список: обязательные, на месяц и необязательные траты + кнопки правки', () => {
  const d = seed();
  const t = formatList(d, today);
  assert.match(t, /Обязательные платежи/);
  assert.match(t, /Обязательные траты в течение месяца/);
  assert.match(t, /Необязательные траты этого месяца/);
  assert.match(t, /Кофе/);
  const ids = listMarkup(d, today).inline_keyboard.flat().map((b) => b.callback_data);
  assert.deepEqual(ids.sort(), ['ei:cof', 'ei:rent', 'ei:sal', 'ei:trn'].sort());
});

test('правка суммы обязательного платежа через карточку', async () => {
  const h = harness(seed());
  await h.run(h.press('ei:rent'));
  assert.match(h.sent.at(-1).t, /Аренда/);
  await h.run(h.press('ea:rent'));
  assert.ok(h.db.get(1).awaiting);
  await h.run(h.msg('не число'));
  assert.match(h.sent.at(-1).t, /Не понял сумму/);
  assert.ok(h.db.get(1).awaiting, 'ожидание сохраняется после ошибки');
  await h.run(h.msg('27к'));
  assert.equal(h.db.get(1).items.find((i) => i.id === 'rent').amount, 27000);
  assert.equal(h.db.get(1).awaiting, null);
});

test('чужое сообщение не принимается за ответ', async () => {
  const h = harness(seed());
  await h.run(h.press('ea:rent'));
  await h.run(h.msg('99999', { id: 7, first_name: 'Аня' }));
  assert.equal(h.db.get(1).items.find((i) => i.id === 'rent').amount, 25000);
  assert.ok(h.db.get(1).awaiting);
});

test('правка срока: число, «в течение месяца», другой месяц', async () => {
  const h = harness(seed());
  await h.run(h.press('ew:rent')); await h.run(h.msg('15'));
  assert.equal(h.db.get(1).items.find((i) => i.id === 'rent').day, 15);
  await h.run(h.press('ew:rent')); await h.run(h.msg('в течение месяца'));
  assert.equal(h.db.get(1).items.find((i) => i.id === 'rent').spread, true);
  await h.run(h.press('ew:trn')); await h.run(h.msg('в ноябре'));
  const trn = h.db.get(1).items.find((i) => i.id === 'trn');
  assert.deepEqual([trn.once, trn.spread], ['2026-11', false]);
  await h.run(h.press('ew:sal')); await h.run(h.msg('в течение месяца'));
  assert.match(h.sent.at(-1).t, /нужна дата/);
});

test('правка и удаление необязательной траты, смена категории', async () => {
  const h = harness(seed());
  await h.run(h.press('ea:cof')); await h.run(h.msg('600'));
  assert.equal(h.db.get(1).spends[0].amount, 600);
  await h.run(h.press('sc:cof:food'));
  assert.equal(h.db.get(1).spends[0].cat, 'food');
  assert.equal(computePlan(h.db.get(1), today).byCat.food, 600);
  await h.run(h.press('en:cof')); await h.run(h.msg('Кофе с собой'));
  assert.equal(h.db.get(1).spends[0].name, 'Кофе с собой');
  await h.run(h.press('del:cof'));
  assert.equal(h.db.get(1).spends.length, 0);
});

test('команда во время ожидания отменяет правку и выполняется', async () => {
  const h = harness(seed());
  await h.run(h.press('ea:rent'));
  await h.run(h.msg('/list'));
  assert.equal(h.db.get(1).awaiting, null);
  assert.equal(h.db.get(1).items.find((i) => i.id === 'rent').amount, 25000);
});
