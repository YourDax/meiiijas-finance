import test from 'node:test';
import assert from 'node:assert/strict';
import { buildState, runAction } from '../lib/app.js';
import { nowInTz } from '../lib/bot.js';

const tz = 'Europe/Moscow';
const now = nowInTz(tz, new Date('2026-11-23T12:00:00Z'));
const act = (data, action, payload = {}) => runAction(data, now, { by: 'Тест', tz }, action, payload);

test('правка и отмена пополнения или снятия меняют остаток на разницу', () => {
  let { data } = act(null, 'balance_set', { amount: 1000 });
  const topup = act(data, 'topup', { amount: 200 });
  const withdrawal = act(topup.data, 'withdraw', { amount: 100 });
  data = act(withdrawal.data, 'topup_edit', { id: topup.result.id, amount: 250, name: 'Возврат' }).data;
  data = act(data, 'topup_edit', { id: withdrawal.result.id, amount: 150, name: 'Наличные' }).data;
  assert.equal(buildState(data, now).cardBalance, 1100);
  data = act(data, 'topup_undo', { id: withdrawal.result.id }).data;
  assert.equal(buildState(data, now).cardBalance, 1250);
  data.balance = { amount: 900, ts: now.ts + 1 };
  data = act(data, 'topup_edit', { id: topup.result.id, amount: 500, name: 'Возврат' }).data;
  assert.equal(act(data, 'topup_undo', { id: topup.result.id }).data.balance.amount, 900);
});

test('разовое пополнение без заданного остатка редактируется вместе с пунктом плана и не дублируется', () => {
  const { data, result } = act(null, 'topup', { amount: 1000, name: 'Подарок' });
  const edited = act(data, 'topup_edit', { id: result.id, amount: 1100, name: 'Перевод' }).data;
  const state = buildState(edited, now);
  assert.equal(state.items[0].amount, 1100);
  assert.equal(state.items[0].name, 'Перевод');
  assert.deepEqual(state.confirmedHistory, []);
  const removed = act(edited, 'topup_undo', { id: result.id }).data;
  assert.equal(removed.items.length, 0);
  assert.deepEqual(removed.done, {});
});

test('история включает подтверждённый доход, позволяет исправить сумму и выгрузить выбранный тип', () => {
  const start = act(null, 'balance_set', { amount: 1000 }).data;
  const plan = act(start, 'item_add', { type: 'income', amount: 400, name: 'Подработка', day: now.d }).data;
  const key = buildState(plan, now).payments.find((o) => o.name === 'Подработка').key;
  const confirmed = act(plan, 'occ', { key }).data;
  const spent = act(confirmed, 'spend_add', { amount: 50, name: 'Кофе' }).data;
  const edited = act(spent, 'occ_edit_amount', { key, amount: 500 }).data;
  const state = buildState(edited, now);
  assert.equal(state.cardBalance, 1450);
  assert.equal(state.confirmedHistory[0].amount, 500);
  assert.equal(state.items[0].amount, 400);
  const csv = act(edited, 'export_csv', { history: true, month: '2026-11', kind: 'topup' }).result;
  assert.equal(csv.rows, 1);
  assert.match(csv.csv, /Пополнение;500;Подработка/);
  assert.doesNotMatch(csv.csv, /Кофе/);
  assert.equal(buildState(act(edited, 'occ_undo', { key }).data, now).cardBalance, 950);
});

test('все поля траты сохраняются вместе, а ошибка привязки оставляет исходную запись', () => {
  const { data, result } = act(null, 'spend_add', { amount: 50, name: 'Кофе' });
  const fields = { id: result.id, amount: 70, name: 'Обед', cat: 'cafe', date: '2026-11-22' };
  assert.throws(() => act(data, 'spend_edit', { ...fields, link: 'missing' }), /Статья не найдена/);
  assert.equal(data.spends[0].amount, 50);
  const { data: saved } = act(data, 'spend_edit', { ...fields, link: 'none' });
  assert.equal(saved.spends[0].name, 'Обед');
  assert.equal(saved.spends[0].amount, 70);
  assert.equal(saved.spends[0].linkId, 'none');
  assert.ok(saved.spends[0].ts < now.ts);
});
