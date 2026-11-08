import test from 'node:test';
import assert from 'node:assert/strict';
import { runAction, buildState, buildView } from '../lib/app.js';
import { computePlan } from '../lib/budget.js';
import { normalize } from '../lib/bot.js';
import { occurrences, dn } from '../lib/period.js';
import { catName } from '../lib/cats.js';
import { computeMonth } from '../lib/report.js';

// 9 ноября 2026, понедельник
const today = { y: 2026, m: 10, d: 9, ts: Date.UTC(2026, 10, 9, 9), monthStart: Date.UTC(2026, 9, 31, 21), dayStart: Date.UTC(2026, 10, 8, 21) };
const ctx = { by: 'Лео', tz: 'Europe/Moscow' };

function budget() {
  let data = {};
  const step = (a, p) => { const r = runAction(data, today, ctx, a, p); data = r.data; return r.result; };
  step('item_add', { type: 'income', amount: 80000, name: 'Зарплата', day: 20 });
  step('item_add', { type: 'bill', amount: 5000, name: 'Коммуналка', day: 15 });
  step('balance_set', { amount: 30000 });
  return { get data() { return data; }, step, state: () => buildState(data, today, ctx) };
}
const pay = (b, name) => b.state().payments.find((x) => x.name === name);

test('оплата другой суммой: списывается факт, отмена возвращает факт', () => {
  const b = budget();
  const key = pay(b, 'Коммуналка').key;
  const r = b.step('occ', { key, amount: 6200 });
  assert.equal(r.occ.amount, 6200);
  assert.equal(b.state().cardBalance, 23800);
  assert.equal(pay(b, 'Коммуналка').amount, 6200, 'в строке фактическая сумма');
  b.step('occ_undo', { key });
  assert.equal(b.state().cardBalance, 30000);
  assert.equal(pay(b, 'Коммуналка').amount, 5000, 'после отмены снова плановая');
});

test('статья без даты: частичная оплата уменьшает остаток статьи', () => {
  const b = budget();
  b.step('item_add', { type: 'bill', amount: 6000, name: 'Транспорт', spread: true });
  const id = b.state().spreadPayments[0].id;
  b.step('spread_pay', { id, amount: 1500 });
  assert.equal(b.state().spreadPayments[0].remaining, 4500);
  assert.equal(b.state().cardBalance, 28500);
});

test('трата задним числом и смена даты', () => {
  const b = budget();
  const r = b.step('spend_add', { amount: 400, name: 'Кофе', date: '2026-11-08' });
  assert.equal(r.beforeBalance, true, 'трата раньше остатка его не меняет, об этом предупреждаем');
  assert.equal(b.state().cardBalance, 30000);
  const s2 = b.step('spend_add', { amount: 100, name: 'Чай' });
  assert.equal(s2.beforeBalance, false);
  assert.equal(b.state().cardBalance, 29900);
  b.step('edit_date', { id: s2.id, date: '2026-11-07' });
  assert.equal(b.state().cardBalance, 30000);
  assert.throws(() => b.step('spend_add', { amount: 1, name: 'x', date: '2026-11-10' }), /будущем/);
  assert.throws(() => b.step('spend_add', { amount: 1, name: 'x', date: 'вчера' }), /дата/);
});

test('счета: добавить, перевести, нельзя больше остатка, изменить и удалить', () => {
  const b = budget();
  const { account } = b.step('account_add', { name: 'Наличные', amount: 1000 });
  b.step('transfer', { from: 'card', to: account.id, amount: 2000 });
  assert.equal(b.state().cardBalance, 28000);
  assert.equal(b.state().accounts[0].amount, 3000);
  assert.equal(b.state().spends.length, 0, 'перевод не трата');
  assert.throws(() => b.step('transfer', { from: account.id, to: 'card', amount: 9000 }), /только/);
  assert.throws(() => b.step('transfer', { from: 'card', to: 'card', amount: 1 }), /разных/);
  assert.throws(() => b.step('transfer', { from: 'card', to: 'reserve', amount: 1 }), /не найден/);
  b.step('transfer', { from: account.id, to: 'card', amount: 3000 });
  assert.equal(b.state().cardBalance, 31000);
  b.step('account_edit', { id: account.id, name: 'Кошелёк', amount: 50 });
  assert.equal(b.state().accounts[0].name, 'Кошелёк');
  b.step('account_delete', { id: account.id });
  assert.equal(b.state().accounts.length, 0);
});

test('перевод с карты в копилку уменьшает карту и увеличивает копилку', () => {
  const b = budget();
  b.step('reserve_set', { amount: 100 });
  b.step('transfer', { from: 'card', to: 'reserve', amount: 900 });
  assert.equal(b.state().reserve.amount, 1000);
  assert.equal(b.state().cardBalance, 29100);
});

test('долги: мой долг и долг мне, частичное погашение, отмена, закрытие', () => {
  const b = budget();
  const { debt } = b.step('debt_add', { name: 'Аня', kind: 'owe', amount: 5000 });
  assert.equal(b.state().cardBalance, 30000, 'без галочки деньги не двигаются');
  const r = b.step('debt_pay', { id: debt.id, amount: 2000 });
  assert.equal(b.state().cardBalance, 28000);
  assert.equal(b.state().debts[0].left, 3000);
  b.step('debt_pay_undo', { id: debt.id, topupId: r.topupId });
  assert.equal(b.state().cardBalance, 30000);
  assert.equal(b.state().debts[0].left, 5000);
  assert.throws(() => b.step('debt_pay', { id: debt.id, amount: 6000 }), /только/);
  const lent = b.step('debt_add', { name: 'Паша', kind: 'lent', amount: 1000, withMoney: true }).debt;
  assert.equal(b.state().cardBalance, 29000, 'дал в долг с карты');
  b.step('debt_pay', { id: lent.id, amount: 1000 });
  assert.equal(b.state().cardBalance, 30000, 'вернули на карту');
  assert.throws(() => b.step('debt_pay', { id: lent.id, amount: 1 }), /закрыт/);
  b.step('debt_delete', { id: lent.id });
  assert.equal(b.state().debts.length, 1);
});

test('цели: взять деньги обратно и изменить', () => {
  const b = budget();
  b.step('goal_add', { name: 'Отпуск', target: 10000, deadline: '2027-06' });
  const id = b.state().goals[0].id;
  b.step('goal_save', { id, amount: 4000 });
  assert.equal(b.state().cardBalance, 26000);
  b.step('goal_withdraw', { id, amount: 1500 });
  assert.equal(b.state().goals[0].saved, 2500);
  assert.equal(b.state().cardBalance, 27500);
  assert.throws(() => b.step('goal_withdraw', { id, amount: 9000 }), /только/);
  b.step('goal_edit', { id, name: 'Море', target: 20000, deadline: '2027-08' });
  assert.deepEqual([b.state().goals[0].name, b.state().goals[0].target, b.state().goals[0].deadline], ['Море', 20000, '2027-08']);
});

test('лимиты по категориям: расход, предупреждение, снятие', () => {
  const b = budget();
  b.step('cat_limit', { cat: 'food', amount: 1000 });
  assert.equal(b.step('spend_add', { amount: 100, name: 'Хлеб', cat: 'food' }).limit, null);
  const r = b.step('spend_add', { amount: 850, name: 'Продукты', cat: 'food' });
  assert.deepEqual([r.limit.spent, r.limit.limit], [950, 1000]);
  assert.equal(b.state().catLimits[0].spent, 950);
  b.step('cat_limit', { cat: 'food', amount: 0 });
  assert.equal(b.state().catLimits.length, 0);
  assert.throws(() => b.step('cat_limit', { cat: 'нет', amount: 5 }), /категории/);
});

test('свои категории: создать, использовать, нельзя удалить занятую', () => {
  const b = budget();
  const { key } = b.step('cat_add', { name: 'Хобби' });
  assert.equal(catName(key), '🏷 Хобби');
  assert.equal(b.state().cats[key].name, '🏷 Хобби');
  assert.throws(() => b.step('cat_add', { name: 'Хобби' }), /есть/);
  const s = b.step('spend_add', { amount: 10, name: 'Нитки', cat: key });
  assert.equal(s.cat, key);
  assert.throws(() => b.step('cat_delete', { key }), /используется/);
  b.step('delete', { id: s.id });
  b.step('cat_delete', { key });
  assert.equal(b.state().cats[key], undefined);
});

test('повторы: неделя, квартал, год', () => {
  const b = budget();
  b.step('item_add', { type: 'bill', amount: 100, name: 'Уроки', every: 'week', weekday: 0 });
  b.step('item_add', { type: 'bill', amount: 900, name: 'Налог', every: 'quarter', day: 10, month: 1 });
  b.step('item_add', { type: 'bill', amount: 3000, name: 'Страховка', every: 'year', day: 12, month: 10 });
  b.step('item_add', { type: 'bill', amount: 7000, name: 'Домен', every: 'year', day: 12, month: 5 });
  const d = normalize(b.data);
  const inNov = occurrences(d.items, dn(2026, 10, 1), dn(2026, 10, 30));
  assert.equal(inNov.filter((o) => o.name === 'Уроки').length, 5, 'понедельников в ноябре 2026 — пять');
  assert.equal(inNov.filter((o) => o.name === 'Налог').length, 1, 'ноябрь входит в квартальный ряд от февраля');
  assert.equal(inNov.filter((o) => o.name === 'Страховка').length, 1);
  assert.equal(inNov.filter((o) => o.name === 'Домен').length, 0);
  assert.equal(computePlan(d, today).totalBills, 5000 + 500 + 900 + 3000);
  const key = pay(b, 'Уроки').key;
  b.step('occ', { key });
  assert.equal(b.state().cardBalance, 29900);
  assert.throws(() => b.step('item_add', { type: 'bill', amount: 1, name: 'x', every: 'week', weekday: 9 }), /недели/);
});

test('итоги месяца: фактические суммы, траты и результат', () => {
  const b = budget();
  b.step('occ', { key: pay(b, 'Зарплата').key, amount: 81000 });
  b.step('occ', { key: pay(b, 'Коммуналка').key });
  b.step('spend_add', { amount: 1000, name: 'Хлеб', cat: 'food' });
  b.step('withdraw', { amount: 500, name: 'Наличные' });
  const r = computeMonth(normalize(b.data), today, 0, 'Europe/Moscow');
  assert.deepEqual([r.income, r.bills, r.spent, r.out, r.net], [81000, 5000, 1000, 500, 74500]);
  assert.match(buildView(b.data, today, 'month', { k: 0 }), /Ноябрь 2026/);
  assert.equal(computeMonth(normalize(b.data), today, 1, 'Europe/Moscow').income, 0);
});
