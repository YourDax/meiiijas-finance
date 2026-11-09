// Регрессии по итогам полного аудита приложения.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, nowInTz } from '../lib/bot.js';
import { buildState, runAction } from '../lib/app.js';
import { runDaily } from '../lib/daily.js';
import { cardBalance, computePeriod } from '../lib/period.js';
import { formatDigest, monthSummary, prevMonthBounds } from '../lib/digest.js';
import { formatPlanFull } from '../lib/planview.js';
import { spendsToCsv } from '../lib/csv.js';
import { categorizeMerchant } from '../lib/cats.js';
import { computeMonth } from '../lib/report.js';

const at = (s) => nowInTz('Europe/Moscow', new Date(s));
const T = at('2026-11-09T09:00:00Z');
const ctx = { by: 'A', tz: 'Europe/Moscow' };
const act = (d, a, p = {}, t = T) => runAction(d, t, ctx, a, p);
const strip = (s) => s.replace(/<[^>]+>/g, '');

test('баланс не меняется сам: ни от дней, ни от утренней рассылки и чистки 1-го числа', async () => {
  let d = normalize({
    balance: { amount: 100000, ts: at('2026-09-02T09:00:00Z').ts },
    items: [{ id: 'b', type: 'bill', amount: 5000, day: 3, name: 'Кредит' }, { id: 'i', type: 'income', amount: 50000, day: 5, name: 'Зп' }],
    spends: [
      { id: 'old', amount: 30000, name: 'старая', cat: 'other', ts: at('2026-09-10T09:00:00Z').ts },
      { id: 'new', amount: 5000, name: 'новая', cat: 'other', ts: at('2026-10-10T09:00:00Z').ts },
    ],
  });
  const store = { load: async () => d, save: async (_, x) => { d = x; }, archive: async () => {} };
  const tg = { send: async () => ({ ok: true }) };
  for (const day of ['2026-10-01', '2026-11-01', '2026-11-02', '2026-12-01']) {
    await runDaily(1, { store, tg, today: at(`${day}T05:00:00Z`) });
    assert.equal(cardBalance(d), 65000, day);
  }
  assert.equal(computePeriod(d, at('2026-12-02T05:00:00Z')).now, 65000);
});

test('чистка архивирует траты до установки остатка', async () => {
  let d = normalize({
    balance: { amount: 1000, ts: at('2026-10-20T09:00:00Z').ts },
    spends: [{ id: 'x', amount: 10, name: 'x', cat: 'other', ts: at('2026-08-01T09:00:00Z').ts }],
  });
  const store = { load: async () => d, save: async (_, x) => { d = x; }, archive: async () => {} };
  await runDaily(1, { store, tg: { send: async () => ({ ok: true }) }, today: at('2026-11-01T05:00:00Z') });
  assert.equal(d.spends.length, 0);
});

test('оплаченная статья по формуле не откладывается второй раз', () => {
  const d = normalize({ balance: { amount: 50000, ts: T.ts - 1000 }, items: [{ id: 'tr', type: 'bill', spread: true, day: null, amount: 0, name: 'Транспорт', cat: 'transport', formula: { base: 3000, daily: 200 } }] });
  const r = act(d, 'spread_pay', { id: 'tr' });
  assert.equal(computePeriod(r.data, T).reserveTotal, 0);
});

test('перенос даты сохраняет отметку об оплате', () => {
  const d0 = normalize({ balance: { amount: 10000, ts: T.ts - 1000 }, items: [{ id: 'b', type: 'bill', amount: 700, day: 10, name: 'Счёт' }] });
  const key = computePeriod(d0, T).dueList[0].key;
  const d1 = act(d0, 'occ', { key }).data;
  const d2 = act(d1, 'edit', { id: 'b', field: 'when', value: '12' }).data;
  assert.equal(computePeriod(d2, T).dueSum, 0);
  assert.equal(cardBalance(d2), 9300);
});

test('возврат удалённой траты сохраняет привязку к статье', () => {
  const d0 = normalize({ balance: { amount: 10000, ts: T.ts - 1000 }, items: [{ id: 'sp', type: 'bill', spread: true, day: null, amount: 3000, name: 'Питомец', cat: 'other', catManual: true }] });
  const d1 = act(d0, 'spread_pay', { id: 'sp', amount: 500 }).data;
  const s = d1.spends.at(-1);
  const d2 = act(d1, 'delete', { id: s.id }).data;
  const d3 = act(d2, 'spend_restore', { amount: s.amount, name: s.name, cat: s.cat, ts: s.ts, src: s.src, linkId: s.linkId }).data;
  assert.equal(buildState(d3, T).spreadPayments[0].remaining, 2500);
});

test('отмена последней траты не трогает выписку и чужие записи', () => {
  const d = normalize({ spends: [
    { id: 'mine', amount: 100, name: 'моя', cat: 'other', ts: T.ts, by: 'A' },
    { id: 'other', amount: 200, name: 'чужая', cat: 'other', ts: T.ts, by: 'B' },
    { id: 'bank', amount: 999, name: 'выписка', cat: 'other', ts: T.ts, src: 'bank' },
  ] });
  assert.equal(act(d, 'spend_undo').result.undone.name, 'моя');
});

test('«в копилку 3к» при двух целях не выбирает цель наугад', () => {
  const d = normalize({ goals: [{ id: 'a', name: 'Отпуск', target: 1000, saved: 0, deadline: '2027-01' }, { id: 'b', name: 'Ноут', target: 1000, saved: 0, deadline: '2027-01' }] });
  assert.throws(() => act(d, 'nl', { text: 'в копилку 3к' }), /какую цель/);
});

test('отмена операций с долгом восстанавливает и долг', () => {
  const d0 = act(normalize({ balance: { amount: 10000, ts: T.ts - 1000 } }), 'debt_add', { kind: 'owe', name: 'Аня', amount: 2000 }).data;
  const r = act(d0, 'debt_pay', { id: d0.debts[0].id, amount: 500 });
  assert.equal(act(r.data, 'topup_undo', { id: r.result.topupId }).data.debts[0].left, 2000);
  assert.equal(act(r.data, 'debt_pay_undo', { id: d0.debts[0].id, topupId: r.result.topupId }).data.debts[0].left, 2000);
  const lent = act(normalize({ balance: { amount: 10000, ts: T.ts - 1000 } }), 'debt_add', { kind: 'lent', name: 'Оля', amount: 300, withMoney: true }).data;
  const undone = act(lent, 'topup_undo', { id: lent.topups[0].id }).data;
  assert.equal(undone.debts.length, 0);
  assert.equal(undone.balance.amount, 10000);
});

test('отмена пополнения не портит точный остаток, заданный позже', () => {
  const r = act(normalize({ balance: { amount: 10000, ts: T.ts - 5000 } }), 'topup', { amount: 5000, name: 'x' });
  const T2 = { ...T, ts: T.ts + 1000 };
  const d = act(r.data, 'balance_set', { amount: 15000 }, T2).data;
  assert.equal(act(d, 'topup_undo', { id: r.result.id }, T2).data.balance.amount, 15000);
});

test('округление перевода работает, только если задано', () => {
  const base = { balance: { amount: 50000, ts: T.ts - 1000 }, reserve: { amount: 0, ts: 1, history: [] }, items: [{ id: 'r', type: 'bill', amount: 12345, day: 15, name: 'Аренда' }] };
  assert.equal(computePeriod(normalize(base), T).transferNow, 12345); // только платёж ближайшего месяца
  assert.equal(computePeriod(normalize({ ...base, settings: { reserveStep: 5000 } }), T).transferNow, 15000);
});

test('итоги месяца учитывают периодичность', () => {
  const d = normalize({ items: [{ id: 'y', type: 'bill', amount: 30000, day: 1, every: 'year', month: 2, name: 'Страховка' }, { id: 'w', type: 'bill', amount: 1000, day: 1, every: 'week', weekday: 0, name: 'Кружок' }] });
  assert.match(strip(monthSummary(d, prevMonthBounds(at('2026-11-01T05:00:00Z')))), /Обязательные: 4\s000/);
});

test('равенство в подробном плане сходится', () => {
  const d = normalize({ balance: { amount: 50000, ts: T.ts - 1000 }, items: [{ id: 'a', type: 'income', amount: 1000, day: 5, name: 'Зп' }, { id: 'b', type: 'income', amount: 2000, day: 20, name: 'Аванс' }, { id: 'c', type: 'bill', amount: 5000, day: 11, name: 'Кредит' }] });
  assert.match(strip(formatPlanFull(d, T)), /= 37\s000/);
});

test('сумму статьи по формуле нельзя молча изменить', () => {
  const d = normalize({ items: [{ id: 'tr', type: 'bill', spread: true, day: null, amount: 5000, name: 'Транспорт', cat: 'transport', formula: { base: 1000, daily: 200 } }] });
  assert.throws(() => act(d, 'edit', { id: 'tr', field: 'amount', value: '100' }), /формуле/);
});

test('транспорт без проездного', () => {
  const d = act(normalize({}), 'transport', { base: 0, daily: 180 }).data;
  assert.deepEqual(d.items[0].formula, { base: 0, daily: 180 });
});

test('свои категории доходят до CSV и правил выписки', () => {
  assert.match(spendsToCsv([{ amount: 1, name: 'x', cat: 'u:🏷 Хобби', ts: T.ts }]), /🏷 Хобби/);
  assert.equal(categorizeMerchant('SHOPX', 'SHOPX', { SHOPX: 'u:🏷 Хобби' }), 'u:🏷 Хобби');
});

test('дайджест не повторяет платёж, ждущий подтверждения', () => {
  const d = normalize({ items: [{ id: 'b', type: 'bill', amount: 700, day: 9, name: 'Счёт' }, { id: 'i', type: 'income', amount: 1000, day: 20, name: 'Зп' }] });
  assert.doesNotMatch(strip(formatDigest(d, T)), /📌 Сегодня/);
});

test('долг не считается доходом в итогах месяца', () => {
  const d = act(normalize({ balance: { amount: 100, ts: T.ts - 1000 } }), 'debt_add', { kind: 'owe', name: 'Аня', amount: 2000, withMoney: true }).data;
  const r = computeMonth(d, T);
  assert.equal(r.income, 0);
  assert.equal(r.net, 2000);
});
