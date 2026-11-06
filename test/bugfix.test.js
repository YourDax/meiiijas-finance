import test from 'node:test';
import assert from 'node:assert/strict';
import { computePlan } from '../lib/budget.js';
import { processUpdate } from '../lib/engine.js';
import { normalize } from '../lib/bot.js';
import { parseFree } from '../lib/nlp.js';

const today = { y: 2026, m: 9, d: 24, ts: new Date(2026, 9, 24, 12).getTime(), monthStart: new Date(2026, 9, 1).getTime(), dayStart: new Date(2026, 9, 24).getTime() };

function harness(init) {
  const db = new Map([[1, init]]);
  const sent = [];
  const store = { load: async (id) => db.get(id), save: async (id, d) => db.set(id, structuredClone(d)) };
  const tg = { send: async (c, t) => { sent.push(t); return { ok: true, result: { message_id: 9 } }; }, edit: async (c, i, t) => { sent.push(t); return { ok: true }; }, answer: async () => ({}), pin: async () => ({}) };
  const from = { id: 5, first_name: 'Лео' };
  return { db, sent, run: (u) => processUpdate(u, { store, tg, today }),
    msg: (text) => ({ message: { chat: { id: 1 }, from, text } }),
    press: (d) => ({ callback_query: { id: 'q', data: d, from, message: { chat: { id: 1 }, message_id: 5 } } }) };
}

// Старые данные: обе записи когда-то получили категорию «other»
const legacy = () => ({
  balance: { amount: 50000, ts: today.ts - 100000 },
  items: [
    { id: 'pet', type: 'bill', amount: 4000, day: null, spread: true, cat: 'other', name: 'Домашнее животное' },
    { id: 'trn', type: 'bill', amount: 6000, day: null, spread: true, cat: 'transport', name: 'Транспорт' },
  ],
  spends: [{ id: 'm', amount: 3000, name: 'Маникюр', cat: 'other', ts: today.ts - 1000 }],
});

test('баг: «маникюр 3000» не попадает в «Домашнее животное»', () => {
  const p = computePlan(normalize(legacy()), today);
  const pet = p.spread.find((s) => s.id === 'pet');
  assert.equal(pet.spent, 0);
  assert.equal(p.byCat.beauty, 3000);
});

test('две статьи без распознанной категории не делят одни и те же траты', () => {
  const d = normalize({
    items: [
      { id: 'a', type: 'bill', amount: 1000, spread: true, cat: 'other', catManual: true, name: 'Разное А' },
      { id: 'b', type: 'bill', amount: 1000, spread: true, cat: 'other', catManual: true, name: 'Разное Б' },
    ],
    spends: [{ id: 's', amount: 500, name: 'что-то странное', cat: 'other', ts: today.ts - 1000 }],
  });
  const p = computePlan(d, today);
  assert.deepEqual(p.spread.map((s) => s.spent), [0, 0]);
});

test('ручная привязка траты к статье и отмена привязки', async () => {
  const h = harness(normalize({
    items: [{ id: 'gift', type: 'bill', amount: 5000, spread: true, cat: 'other', catManual: true, name: 'Подарки' }],
    spends: [{ id: 'x', amount: 1200, name: 'Цветы маме', cat: 'other', catManual: true, ts: today.ts - 1000 }],
  }));
  await h.run(h.press('el:x'));
  assert.match(h.sent.at(-1), /В какую обязательную трату/);
  await h.run(h.press('sl:x:gift'));
  assert.equal(computePlan(h.db.get(1), today).spread[0].spent, 1200);
  assert.match(h.sent.at(-1), /Засчитывается в «Подарки»/);
  await h.run(h.press('sl:x:none'));
  assert.equal(computePlan(h.db.get(1), today).spread[0].spent, 0);
  await h.run(h.press('sl:x:auto'));
  assert.equal(h.db.get(1).spends[0].linkId, undefined);
});

test('смена категории статьи вручную сохраняется и начинает считать траты', async () => {
  const h = harness(normalize({
    items: [{ id: 'gift', type: 'bill', amount: 5000, spread: true, cat: 'other', name: 'Подарки' }],
    spends: [{ id: 'x', amount: 700, name: 'Цветы', cat: 'shop', ts: today.ts - 1000 }],
  }));
  await h.run(h.press('sc:gift:shop'));
  const it = h.db.get(1).items[0];
  assert.deepEqual([it.cat, it.catManual], ['shop', true]);
  assert.equal(computePlan(h.db.get(1), today).spread[0].spent, 700);
});

test('новые ключевые слова', () => {
  assert.equal(parseFree('маникюр 3000', today).cat, 'beauty');
  assert.equal(parseFree('корм для кота 1500', today)?.cat, 'pets');
  assert.equal(parseFree('котлеты 300', today).cat, 'other');
});

test('баг: слова на «р» не обрезаются как «рубли»', () => {
  assert.equal(parseFree('маникюр 3000', today).name, 'Маникюр');
  assert.equal(parseFree('педикюр 2000 р.', today).name, 'Педикюр');
  assert.equal(parseFree('кофе 450 р', today).name, 'Кофе');
  assert.equal(parseFree('такси 300 ₽', today).amount, 300);
});

test('старая запись «Маникю» (после обрезки) тоже попадает в «Красоту»', () => {
  const d = normalize({ spends: [{ id: 'm', amount: 3000, name: 'Маникю', cat: 'other', ts: today.ts - 1000 }] });
  assert.equal(d.spends[0].cat, 'beauty');
});

test('без подушки и 20% накоплений: лимит = остаток к концу месяца, цели из свободных денег не вычитаются', async () => {
  const { formatPlanFull: formatPlan } = await import('../lib/format.js');
  const data = normalize({
    balance: { amount: 10000, ts: today.ts - 1000 },
    items: [
      { id: 'i', type: 'income', amount: 100000, day: 30, name: 'ЗП' },
      { id: 'b', type: 'bill', amount: 40000, day: 28, name: 'Аренда' },
    ],
    goals: [{ id: 'g', name: 'Отпуск', target: 90000, saved: 0, deadline: '2027-06' }], // 9 мес. -> 10000/мес
  });
  const p = computePlan(data, today);
  assert.equal(p.endBalance, 70000);
  assert.equal(p.spendable, 70000);
  assert.equal(p.free, 60000);
  assert.equal(p.available, 60000); // цель (10 000/мес) из свободных денег не вычитается
  assert.equal(p.goalsNeed, undefined);
  assert.equal(p.split.savings, undefined);
  const text = formatPlan(data, today);
  assert.doesNotMatch(text, /Подушка|Накопления 20%|Бюджеты месяца/);
  assert.match(text, /до следующего дохода/);
});
