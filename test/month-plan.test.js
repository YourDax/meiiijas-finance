import test from 'node:test';
import assert from 'node:assert/strict';
import { buildState, runAction } from '../lib/app.js';
import { nowInTz } from '../lib/bot.js';
import { computeForecast } from '../lib/forecast.js';
import { computePeriod, dn, spreadShare } from '../lib/period.js';

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
