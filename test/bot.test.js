import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount } from '../lib/parse.js';
import { computePlan } from '../lib/budget.js';
import { handleMessage, nowInTz } from '../lib/bot.js';
import { parseFree } from '../lib/nlp.js';
import { categorize } from '../lib/cats.js';
import { processUpdate } from '../lib/engine.js';
import { formatPlanFull as formatPlan } from '../lib/format.js';

const today = { y: 2026, m: 9, d: 24, ts: new Date(2026, 9, 24, 12).getTime() }; // 24 окт, 31 день

function harness() {
  const db = new Map();
  const sent = [];
  const store = { load: async (id) => db.get(id) ?? null, save: async (id, d) => db.set(id, structuredClone(d)) };
  let mid = 100;
  const tg = {
    send: async (chat, text, extra) => { sent.push({ op: 'send', chat, text, extra }); return { ok: true, result: { message_id: ++mid } }; },
    edit: async (chat, id, text, extra) => { sent.push({ op: 'edit', chat, id, text, extra }); return { ok: true }; },
    answer: async () => ({ ok: true }),
    pin: async () => ({ ok: true }),
  };
  const msg = (text) => ({ message: { chat: { id: 1 }, from: { first_name: 'Лео' }, text } });
  const press = (data, mid = 101) => ({ callback_query: { id: 'q', data, from: { first_name: 'Лео' }, message: { chat: { id: 1 }, message_id: mid } } });
  const run = (u) => processUpdate(u, { store, tg, today });
  return { db, sent, run, msg, press };
}

test('parseAmount', () => {
  assert.equal(parseAmount('15000'), 15000);
  assert.equal(parseAmount('1,5к'), 1500);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('0'), null);
});

test('plan: доход, платежи, баланс, кассовый разрыв', () => {
  const data = {
    balance: { amount: 5000, ts: today.ts },
    spends: [],
    items: [
      { type: 'bill', amount: 25000, day: 25, name: 'Аренда' },
      { type: 'income', amount: 80000, day: 30, name: 'Зарплата' },
    ],
  };
  const p = computePlan(data, today);
  assert.equal(p.totalIncome, 80000);
  assert.equal(p.gaps.length, 1);
  assert.equal(p.gaps[0].short, 20000);
  assert.equal(p.endBalance, 60000);
  assert.equal(p.daysLeft, 8);
});

test('разовые пункты действуют только в своём месяце', () => {
  const data = { items: [{ type: 'income', amount: 1000, day: 28, name: 'Премия', once: '2026-09' }] };
  assert.equal(computePlan(data, today).totalIncome, 0);
  data.items[0].once = '2026-10';
  assert.equal(computePlan(data, today).totalIncome, 1000);
});

test('слэш-команды: пакет, /del, /spend', () => {
  const r = handleMessage('/income 80000 5 Аванс\n/bill 25000 1 Аренда\n/bill@bot 3к 10 Интернет', null, today);
  assert.equal(r.data.items.length, 3);
  const d = handleMessage('/del 3', r.data, today);
  assert.equal(d.data.items.length, 2);
  const s = handleMessage('/spend 450 Кофе', d.data, today);
  assert.equal(s.data.spends[0].cat, 'cafe');
  assert.ok(handleMessage('/plan', s.data, today).dashboard);
});

test('nlp: доходы, платежи, траты', () => {
  const a = parseFree('Аванс 80к 5 числа', today);
  assert.deepEqual([a.kind, a.amount, a.day, a.once, a.name], ['income', 80000, 5, false, 'Аванс']);
  const b = parseFree('аренда 25 000 1-го', today);
  assert.deepEqual([b.kind, b.amount, b.day, b.name], ['bill', 25000, 1, 'Аренда']);
  const c = parseFree('премия 20к разово', today);
  assert.deepEqual([c.kind, c.amount, c.once], ['income', 20000, true]);
  const s = parseFree('кофе 450', today);
  assert.deepEqual([s.kind, s.amount, s.cat], ['spend', 450, 'cafe']);
  assert.equal(parseFree('450 такси', today).cat, 'transport');
  assert.equal(parseFree('аренда 25000', today).spread, true);
});

test('nlp: болтовня игнорируется', () => {
  for (const t of ['привет', 'встречаемся в 18', 'ты придёшь в 19:30 к нам домой?', 'ок', 'я купил себе новые наушники и очень доволен 3000']) {
    assert.equal(parseFree(t, today), null, t);
  }
});

test('categorize', () => {
  assert.equal(categorize('Пятёрочка'), 'food');
  assert.equal(categorize('что-то непонятное'), 'other');
});

test('nowInTz даёт начало дня и месяца', () => {
  const t = nowInTz('Europe/Moscow', new Date('2026-10-24T09:30:00Z')); // 12:30 МСК
  assert.equal(t.d, 24);
  assert.equal(t.ts - t.dayStart, (12 * 60 + 30) * 60000);
  assert.equal(t.dayStart - t.monthStart, 23 * 86400000);
});

test('движок: карточка -> подтверждение -> сводка обновляется', async () => {
  const h = harness();
  await h.run(h.msg('/plan'));
  assert.equal(h.db.get(1).dash.mid, 101);

  await h.run(h.msg('аванс 80к 5 числа'));
  const card = h.sent.at(-1);
  assert.match(card.text, /Записать доход/);
  const pid = h.db.get(1).pending[0].id;

  await h.run(h.press(`ok:${pid}`, 102));
  const d = h.db.get(1);
  assert.equal(d.items.length, 1);
  assert.equal(d.pending.length, 0);
  assert.ok(h.sent.some((m) => m.op === 'edit' && m.id === 101), 'сводка обновилась');

  await h.run(h.msg('кофе 450'));
  assert.equal(h.db.get(1).spends.length, 1);
  const sid = h.db.get(1).spends[0].id;
  await h.run(h.press(`undo:${sid}`, 103));
  assert.equal(h.db.get(1).spends.length, 0);
});

test('движок: переключатель разово/ежемесячно и отмена', async () => {
  const h = harness();
  await h.run(h.msg('зарплата 90000'));
  let p = h.db.get(1).pending[0];
  assert.equal(p.once, true);
  await h.run(h.press(`tg:${p.id}`));
  assert.equal(h.db.get(1).pending[0].once, false);
  await h.run(h.press(`no:${p.id}`));
  assert.equal(h.db.get(1).pending.length, 0);
  assert.equal(h.db.get(1).items.length, 0);
});

test('сводка с тратами по категориям', () => {
  const data = {
    balance: { amount: 60000, ts: today.ts - 100000 },
    items: [{ type: 'income', amount: 100000, day: 30, name: 'ЗП' }, { type: 'bill', amount: 30000, day: 28, name: 'Аренда' }],
    spends: [
      { amount: 450, cat: 'cafe', by: 'Лео', ts: today.ts },
      { amount: 2000, cat: 'food', by: 'Аня', ts: today.ts },
    ],
  };
  const text = formatPlan(data, today);
  assert.match(text, /Кафе/);
  assert.doesNotMatch(text, /Лео|Аня/); // разбивки по людям нет
  assert.match(text, /сегодня ещё/);
});
