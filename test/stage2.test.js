import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDigest, monthSummary, overspendAlerts, prevMonthBounds } from '../lib/digest.js';
import { runDaily } from '../lib/daily.js';
import { processUpdate } from '../lib/engine.js';
import { normalize } from '../lib/bot.js';

const today = { y: 2026, m: 9, d: 24, ts: new Date(2026, 9, 24, 12).getTime() };
const base = () => normalize({
  balance: { amount: 30000, ts: new Date(2026, 9, 1).getTime() },
  items: [
    { type: 'income', amount: 100000, day: 30, name: 'Зарплата' },
    { type: 'bill', amount: 25000, day: 25, name: 'Аренда' },
    { type: 'bill', amount: 700, day: 24, name: 'Интернет' },
  ],
});

test('дайджест: сегодня, завтра, лимит', () => {
  const t = formatDigest(base(), today);
  assert.match(t, /Сегодня/);
  assert.match(t, /Завтра/);
  assert.match(t, /Аренда/);
  assert.match(t, /Сегодня можно потратить/);
  assert.equal(formatDigest(normalize(null), today), null);
});

test('итоги месяца', () => {
  const prev = prevMonthBounds({ y: 2026, m: 10, d: 1, ts: 0, monthStart: new Date(2026, 10, 1).getTime() });
  assert.equal(prev.m, 9);
  const data = base();
  data.spends = [
    { amount: 5000, cat: 'food', ts: prev.start + 86400000 },
    { amount: 3000, cat: 'cafe', ts: prev.start + 2 * 86400000 },
  ];
  const t = monthSummary(data, prev);
  assert.match(t, /Итоги: октябрь 2026/);
  assert.match(t, /Еда/);
  assert.match(t, /в плюсе/);
});

test('предупреждения о перерасходе срабатывают один раз', () => {
  const before = base();
  const after = structuredClone(before);
  after.spends.push({ amount: 20000, cat: 'shop', ts: today.ts });
  const alerts = overspendAlerts(before, after, today);
  assert.ok(alerts.some((a) => /закончились|Дневной лимит/.test(a)), alerts.join('|'));
  const again = structuredClone(after);
  again.spends.push({ amount: 100, cat: 'shop', ts: today.ts });
  assert.equal(overspendAlerts(after, again, today).length, 0, 'повторно не предупреждаем');
});

test('cron: одно сообщение в день, /digest off отключает', async () => {
  const db = new Map([[1, base()]]);
  const sent = [];
  const store = { load: async (id) => db.get(id), save: async (id, d) => db.set(id, structuredClone(d)) };
  const tg = { send: async (c, t) => { sent.push(t); return { ok: true }; } };
  assert.equal(await runDaily(1, { store, tg, today }), 'sent');
  assert.equal(await runDaily(1, { store, tg, today }), 'skip');
  assert.equal(sent.length, 1);

  const d = db.get(1); d.settings.digest = false; d.lastDigest = null; db.set(1, d);
  await runDaily(1, { store, tg, today });
  assert.equal(sent.length, 1);
});

test('cron 1-го числа: итоги месяца + очистка старых трат', async () => {
  const first = { y: 2026, m: 10, d: 1, ts: new Date(2026, 10, 1, 9).getTime(), monthStart: new Date(2026, 10, 1).getTime() };
  const data = base();
  data.spends = [
    { amount: 100, cat: 'food', ts: new Date(2026, 6, 5).getTime() },
    { amount: 900, cat: 'food', ts: new Date(2026, 9, 5).getTime() },
  ];
  const db = new Map([[1, data]]);
  const sent = [];
  const store = { load: async (id) => db.get(id), save: async (id, d) => db.set(id, structuredClone(d)) };
  const tg = { send: async (c, t) => { sent.push(t); return { ok: true }; } };
  await runDaily(1, { store, tg, today: first });
  assert.match(sent[0], /Итоги/);
  assert.equal(db.get(1).spends.length, 1);
});

test('движок: тревога при трате, превышающей бюджет', async () => {
  const db = new Map([[1, base()]]);
  const sent = [];
  const store = { load: async (id) => db.get(id), save: async (id, d) => db.set(id, structuredClone(d)) };
  const tg = { send: async (c, t) => { sent.push(t); return { ok: true, result: { message_id: 1 } }; }, edit: async () => ({ ok: true }), answer: async () => ({}), pin: async () => ({}) };
  await processUpdate({ message: { chat: { id: 1 }, from: { first_name: 'Лео' }, text: 'техника 60000' } }, { store, tg, today });
  assert.ok(sent.some((t) => /исчерпан|Дневной лимит|закончились/.test(t)), sent.join('\n---\n'));
});
