import test from 'node:test';
import assert from 'node:assert/strict';
import { buildState, runAction } from '../lib/app.js';
import { nowInTz } from '../lib/bot.js';
import { computeForecast } from '../lib/forecast.js';
import { computePeriod, dn, spreadShare } from '../lib/period.js';
import { computeMonth } from '../lib/report.js';

const tz = 'Europe/Moscow';
const at = (time) => nowInTz(tz, new Date(time));
const november = at('2026-11-23T10:00:00Z');
const december = at('2026-12-07T10:00:00Z');
const edit = (data, payload, today = november) => runAction(data, today, { tz }, 'item_month_amount', payload).data;
const view = (data, planMonth, today = november) => buildState(data, today, { tz, planMonth }).monthPlan;

test('правка суммы датированного платежа обновляет план и прогноз только выбранного месяца', () => {
  const data = {
    balance: { amount: 10000, ts: november.ts },
    reserve: { amount: 1500, ts: november.ts },
    items: [
      { id: 'salary', type: 'income', day: 5, name: 'Зарплата', amount: 90000 },
      { id: 'rent', type: 'bill', day: 27, name: 'Аренда', amount: 40000 },
    ],
  };
  const p = { id: 'rent', month: '2026-12', key: 'rent:20261227', amount: 44100 };
  const edited = edit(data, p);
  const dec = view(edited, '2026-12');
  assert.equal(dec.totalBills, 44100);
  assert.equal(dec.free, 45900);
  assert.equal(dec.bills[0].customAmount, true);
  assert.equal(dec.bills[0].fromReserve, true);
  assert.ok(computePeriod(edited, november).rplan.deadlines.some((d) => d.bills.some((b) => b.key === p.key && b.amount === 44100)));
  assert.equal(computeForecast(edited, november).billsTotal, 44100);
  assert.equal(view(edited, '2026-11').totalBills, 40000);
  assert.equal(view(edited, '2027-01').totalBills, 40000);
  assert.equal(buildState(edited, november).cardBalance, 10000);
  assert.equal(view(edit(edited, { ...p, reset: true }), '2026-12').totalBills, 40000);
  assert.throws(() => edit(edited, { ...p, key: 'rent:20261127' }), /такого события нет/);
});

test('поправка еженедельного платежа относится к дате и сохраняет прежнюю фактическую сумму', () => {
  const data = {
    items: [{ id: 'weekly', type: 'bill', day: 1, every: 'week', weekday: 0, name: 'Курс', amount: 500 }],
    done: { 'weekly:20261207': { ts: december.ts } },
  };
  const edited = edit(data, { id: 'weekly', month: '2026-12', key: 'weekly:20261207', amount: 800 }, december);
  const rows = view(edited, '2026-12', december).bills;
  assert.deepEqual(rows.map((o) => o.amount), [800, 500, 500, 500]);
  assert.equal(rows[0].actualAmount, 500);
  assert.equal(rows[0].status, 'done');
});

test('сумма статьи без даты переопределяет формулу только на выбранный цикл', () => {
  const data = { items: [
    { id: 'salary', type: 'income', day: 5, amount: 20000, name: 'Зарплата' },
    { id: 'bus', type: 'bill', day: null, spread: true, cat: 'transport', name: 'Транспорт', amount: 1000, formula: { base: 1000, daily: 184 } },
  ] };
  const edited = edit(data, { id: 'bus', month: '2026-12', amount: 6740 });
  assert.equal(computeForecast(edited, november).spread[0].amount, 6740);
  assert.equal(computePeriod(edited, december).spread[0].reserve, 6740);
  assert.ok(Math.abs(spreadShare(edited.items, dn(2026, 11, 5), dn(2027, 0, 5)) - 6740) < 0.01);
  assert.equal(view(edited, '2027-01').spreads[0].amount, view(data, '2027-01').spreads[0].amount);
  const added = runAction(edited, november, { tz }, 'item_add', {
    type: 'bill', name: 'Подарки', spread: true, once: '2026-12', amount: 5000,
  }).data;
  assert.equal(view(added, '2026-12').totalBills, 11740);
  assert.equal(view(added, '2027-01').spreads.length, 1);
});

test('пропуск оставляет строки и фактические траты, освобождает резерв и восстанавливается', () => {
  const data = {
    balance: { amount: 20000, ts: december.ts - 1000 },
    items: [
      { id: 'salary', type: 'income', day: 5, name: 'Зарплата', amount: 35000 },
      { id: 'bill', type: 'bill', day: 12, name: 'Подписка', amount: 1800 },
      { id: 'pet', type: 'bill', spread: true, day: null, cat: 'pets', name: 'Питомец', amount: 6000 },
    ],
    spends: [
      { id: 'one', amount: 400, cat: 'other', linkId: 'pet', ts: december.ts },
      { id: 'two', amount: 800, cat: 'pets', ts: at('2026-12-05T08:00:00Z').ts },
      { id: 'three', amount: 300, cat: 'pets', ts: at('2026-12-04T08:00:00Z').ts },
    ],
  };
  const set = (raw, id, skip) => runAction(raw, december, { tz }, 'item_month_skip', { id, month: '2026-12', skip }).data;
  const edited = set(set(data, 'bill', true), 'pet', true);
  const p = view(edited, '2026-12', december);
  assert.equal(p.totalBills, 0);
  assert.equal(p.bills[0].status, 'skipped');
  assert.equal(p.spreads[0].status, 'skipped');
  assert.equal(p.spreads[0].spent, 1200);
  assert.equal(p.spreads[0].amount, 6000);
  assert.equal(computePeriod(edited, december).reserveTotal, 0);
  assert.equal(computePeriod(edited, december).dueSum, 0);
  assert.equal(computeForecast(edited, november).billsTotal, 0);
  assert.equal(buildState(edited, december).cardBalance, buildState(data, december).cardBalance);
  assert.equal(view(edited, '2027-01', december).totalBills, 7800);
  const restored = set(set(edited, 'pet', false), 'bill', false);
  assert.equal(view(restored, '2026-12', december).totalBills, 7800);
  assert.equal(computePeriod(restored, december).reserveTotal, 4800);
});

test('пропуск месяца оставляет подтверждённую неделю в факте и исключает другие недели', () => {
  const data = {
    items: [{ id: 'weekly', type: 'bill', day: 1, every: 'week', weekday: 0, name: 'Курс', amount: 500 }],
    done: { 'weekly:20261207': { ts: december.ts, amount: 500, applied: null } },
  };
  const result = runAction(data, december, { tz }, 'item_month_skip', { id: 'weekly', month: '2026-12', skip: true }).data;
  const plan = view(result, '2026-12', december);
  assert.deepEqual(plan.bills.map((o) => o.status), ['done', 'skipped', 'skipped', 'skipped']);
  assert.equal(computeMonth(result, december, 0, tz).bills, 500);
  assert.equal(computeForecast(result, november).billsTotal, 500);
});

test('формула транспорта резервирует проездной и расход на дни поездок', () => {
  const data = { balance: { amount: 20000, ts: december.ts - 1000 } };
  const configured = runAction(data, december, { tz }, 'transport', { base: 3500, daily: 180, days: 'all' }).data;
  const row = view(configured, '2026-12', december).spreads[0];
  assert.equal(row.amount, 3500 + 31 * 180);
  assert.equal(row.travelDays, 31);
  assert.equal(computePeriod(configured, december).reserveTotal, 3500 + 25 * 180);
  const result = runAction(configured, december, { tz }, 'transport', { id: row.id, base: 3500, daily: 0 }).data;
  assert.equal(view(result, '2026-12', december).spreads[0].amount, 3500);
  assert.equal(computePeriod(result, december).reserveTotal, 3500);
});
