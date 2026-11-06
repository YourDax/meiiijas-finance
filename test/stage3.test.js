import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAny } from '../lib/nlp.js';
import { goalStatus, formatGoals } from '../lib/goals.js';
import { formatChart } from '../lib/charts.js';
import { buildPrompt, logEvent } from '../lib/prompt.js';
import { processUpdate } from '../lib/engine.js';
import { normalize } from '../lib/bot.js';

const today = { y: 2026, m: 9, d: 24, ts: new Date(2026, 9, 24, 12).getTime() };

function harness(init) {
  const db = new Map([[1, init ?? normalize(null)]]);
  const sent = [];
  const store = { load: async (id) => db.get(id), save: async (id, d) => db.set(id, structuredClone(d)) };
  const tg = {
    send: async (c, t, e) => { sent.push({ t, e }); return { ok: true, result: { message_id: 7 } }; },
    edit: async (c, id, t) => { sent.push({ t, edit: true }); return { ok: true }; },
    answer: async () => ({}), pin: async () => ({}),
  };
  const msg = (text) => ({ message: { chat: { id: 1 }, from: { first_name: 'Лео' }, text } });
  const press = (data) => ({ callback_query: { id: 'q', data, from: { first_name: 'Лео' }, message: { chat: { id: 1 }, message_id: 5 } } });
  return { db, sent, run: (u) => processUpdate(u, { store, tg, today }), msg, press };
}

test('nlp: цели', () => {
  const g = parseAny('цель 200к к июню отпуск', today);
  assert.deepEqual([g.kind, g.amount, g.deadline, g.name], ['goal', 200000, '2027-06', 'Отпуск']);
  const g2 = parseAny('накопить 100000 до декабря 2027 ноутбук', today);
  assert.deepEqual([g2.deadline, g2.name], ['2027-12', 'Ноутбук']);
  const g3 = parseAny('цель 50к через 6 месяцев машина', today);
  assert.equal(g3.deadline, '2027-04');
  assert.equal(parseAny('цель 50к отпуск', today).kind, 'hint');
  const s = parseAny('отложил 5000 на отпуск', today);
  assert.deepEqual([s.kind, s.amount, s.name], ['save', 5000, 'отпуск']);
  assert.equal(parseAny('кофе 450', today).kind, 'spend');
});

test('расчёт цели', () => {
  const g = { name: 'Отпуск', target: 200000, saved: 40000, deadline: '2027-06' };
  const s = goalStatus(g, today); // окт 2026 .. июнь 2027 = 9 мес.
  assert.equal(s.monthsLeft, 9);
  assert.equal(s.perMonth, Math.ceil(160000 / 9));
  assert.equal(s.percent, 20);
  const text = formatGoals({ goals: [{ id: 'a', ...g }] }, today);
  assert.match(text, /нужно откладывать/);
  assert.doesNotMatch(text, /Не хватает|укладывается/); // сравнения со свободными деньгами нет
});

test('график', () => {
  const data = normalize({ spends: [
    { amount: 450, cat: 'cafe', ts: today.ts, by: 'Лео' },
    { amount: 2000, cat: 'food', ts: today.ts - 86400000, by: 'Аня' },
  ] });
  const t = formatChart(data, today);
  assert.match(t, /По категориям/);
  assert.doesNotMatch(t, /Кто сколько/);
  assert.match(formatChart(normalize(null), today), /Пока нет трат/);
});

test('промт: данные, вопрос и изменения с прошлого раза', () => {
  const data = normalize({
    balance: { amount: 30000, ts: today.ts - 86400000 },
    items: [{ type: 'income', amount: 100000, day: 30, name: 'Зарплата' }, { type: 'bill', amount: 25000, day: 25, name: 'Аренда' }],
    spends: [{ amount: 450, cat: 'cafe', ts: today.ts - 1000, name: 'Кофе' }],
    goals: [{ id: 'g', name: 'Отпуск', target: 200000, saved: 0, deadline: '2027-06' }],
    lastExport: { ts: today.ts - 3 * 86400000 },
  });
  logEvent(data, today.ts - 86400000, 'добавлен платёж «Аренда» 25 000 ₽');
  logEvent(data, today.ts - 10 * 86400000, 'старое событие');
  const { text, changes } = buildPrompt(data, today, { question: 'стоит ли брать ноутбук?' });
  assert.match(text, /финансовый консультант/);
  assert.match(text, /ответь на мой вопрос: стоит ли брать ноутбук/i);
  assert.match(text, /Зарплата/);
  assert.match(text, /ЧТО ИЗМЕНИЛОСЬ/);
  assert.ok(changes.some((c) => /Аренда/.test(c)));
  assert.ok(!changes.some((c) => /старое/.test(c)));
  assert.ok(text.length < 4000);
});

test('движок: цель через карточку, копилка, /ai сохраняет метку', async () => {
  const h = harness();
  await h.run(h.msg('цель 200к к июню отпуск'));
  const pid = h.db.get(1).pending[0].id;
  await h.run(h.press(`ok:${pid}`));
  assert.equal(h.db.get(1).goals.length, 1);
  await h.run(h.msg('отложил 5000 на отпуск'));
  assert.equal(h.db.get(1).goals[0].saved, 5000);
  await h.run(h.msg('/ai можно ли отдохнуть?'));
  assert.ok(h.sent.some((m) => m.t.startsWith('<pre>') && /можно ли отдохнуть/.test(m.t)));
  assert.ok(h.db.get(1).lastExport.ts);
  await h.run(h.msg('/chart'));
  await h.run(h.press('chart'));
});

test('/ai: второй запрос показывает только новые изменения', async () => {
  const h = harness();
  await h.run(h.msg('/bill 25000 1 Аренда'));
  await h.run(h.msg('/ai'));
  const first = h.sent.filter((m) => m.t.startsWith('<pre>')).at(-1).t;
  assert.match(first, /Аренда/);
  await new Promise((r) => setTimeout(r, 5));
  // имитируем, что прошло время: сдвигаем метку и добавляем событие позже
  const d = h.db.get(1); d.lastExport.ts = today.ts + 1000; h.db.set(1, d);
  await h.run(h.msg('/ai'));
  const second = h.sent.filter((m) => m.t.startsWith('<pre>')).at(-1).t;
  assert.match(second, /изменений нет/);
});
