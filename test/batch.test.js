import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBatch } from '../lib/batch.js';
import { formatGuide } from '../lib/guide.js';
import { processUpdate } from '../lib/engine.js';
import { normalize } from '../lib/bot.js';

const today = { y: 2026, m: 9, d: 24, ts: new Date(2026, 9, 24, 12).getTime() };

function harness() {
  const db = new Map([[1, normalize(null)]]);
  const sent = [];
  const store = { load: async (id) => db.get(id), save: async (id, d) => db.set(id, structuredClone(d)) };
  const tg = { send: async (c, t, e) => { sent.push(t); return { ok: true, result: { message_id: 9 } }; }, edit: async (c, i, t) => { sent.push(t); return { ok: true }; }, answer: async () => ({}), pin: async () => ({}) };
  return { db, sent, run: (u) => processUpdate(u, { store, tg, today }),
    msg: (text) => ({ message: { chat: { id: 1 }, from: { first_name: 'Лео' }, text } }),
    press: (d) => ({ callback_query: { id: 'q', data: d, from: { first_name: 'Лео' }, message: { chat: { id: 1 }, message_id: 5 } } }) };
}

test('пакет с заголовками: обязательные, разовые, доходы', () => {
  const r = parseBatch(`Обязательные:
аренда 25000 1
- интернет 700 15
1. кредит 12 000 20
Разовые:
ремонт крана 3500
Доходы:
аванс 80к 5
что-то непонятное`, today);
  const by = (n) => r.items.find((i) => i.name.toLowerCase().startsWith(n));
  assert.equal(r.items.length, 5);
  assert.deepEqual([by('аренда').kind, by('аренда').amount, by('аренда').day, by('аренда').once], ['bill', 25000, 1, false]);
  assert.equal(by('кредит').amount, 12000);
  assert.equal(by('кредит').day, 20);
  assert.deepEqual([by('ремонт').once, by('ремонт').day], [true, 24]);
  assert.deepEqual([by('аванс').kind, by('аванс').amount, by('аванс').day], ['income', 80000, 5]);
  assert.equal(r.skipped.length, 1);
});

test('пакет без заголовков: полные фразы; болтовня игнорируется', () => {
  const ok = parseBatch('аренда 25000 1 числа\nинтернет 700 15 числа\nпремия 20к разово', today);
  assert.equal(ok.items.length, 3);
  assert.equal(ok.items[2].once, true);
  assert.equal(parseBatch('привет, как дела\nвстретимся в 18 у метро', today), null);
  assert.equal(parseBatch('аренда 25000 1 числа\nа ещё я думаю что', today), null);
  assert.equal(parseBatch('одна строка 500', today), null);
});

test('заголовок «Траты»', () => {
  const r = parseBatch('Траты:\nкофе 450\nтакси 300\nпродукты 2500', today);
  assert.deepEqual(r.items.map((i) => i.kind), ['spend', 'spend', 'spend']);
});

test('движок: пакет -> одна карточка -> запись всего', async () => {
  const h = harness();
  await h.run(h.msg('Обязательные:\nаренда 25000 1\nинтернет 700 15\nДоходы:\nаванс 80к 5'));
  assert.match(h.sent.at(-1), /Записать 3 пункта/);
  const pid = h.db.get(1).pending[0].id;
  await h.run(h.press(`ok:${pid}`));
  const d = h.db.get(1);
  assert.equal(d.items.length, 3);
  assert.equal(d.pending.length, 0);
  assert.match(h.sent.at(-1), /Записано пунктов: 3/);
});

test('движок: пакет без разобранных строк даёт подсказку', async () => {
  const h = harness();
  await h.run(h.msg('Обязательные:\nчто-то\nещё что-то'));
  assert.match(h.sent.at(-1), /Не смог разобрать/);
  assert.equal(h.db.get(1).items.length, 0);
});

test('/guide: чек-лист и следующий шаг', async () => {
  const empty = formatGuide(normalize(null), today);
  assert.match(empty, /⬜ <b>Доходы/);
  assert.match(empty, /Следующий шаг/);
  assert.match(empty, /Обязательные:/);
  const h = harness();
  await h.run(h.msg('/income 80000 5 Аванс'));
  await h.run(h.msg('/guide'));
  assert.match(h.sent.at(-1), /✅ <b>Доходы/);
});
