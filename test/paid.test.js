import test from 'node:test';
import assert from 'node:assert/strict';
import { runAction, buildState } from '../lib/app.js';
import { applyTopup, applyWithdraw, undoTopup, handleMessage, normalize } from '../lib/bot.js';
import { parseAny } from '../lib/nlp.js';
import { computePeriod, confirmOccurrence, unconfirmOccurrence } from '../lib/period.js';
import { paidList } from '../lib/paid.js';
import { processUpdate } from '../lib/engine.js';
import { dashMarkup } from '../lib/format.js';

// 9 ноября 2026, понедельник
const today = { y: 2026, m: 10, d: 9, ts: new Date(2026, 10, 9, 12).getTime(), monthStart: new Date(2026, 10, 1).getTime() };
const ctx = { by: 'Лео', tz: 'Europe/Moscow' };

// Бюджет: остаток 30 000, доход 20-го, кредит 15-го (до дохода — попадает в «ближайшие платежи»)
function budget() {
  let data = {};
  const step = (a, p) => { data = runAction(data, today, ctx, a, p).data; return data; };
  step('item_add', { type: 'income', amount: 80000, name: 'Зарплата', day: 20 });
  step('item_add', { type: 'bill', amount: 5000, name: 'Кредит', day: 15 });
  step('balance_set', { amount: 30000 });
  return { get data() { return data; }, step };
}
const keyOf = (data, name) => buildState(data, today, ctx).payments.find((x) => x.name === name).key;

test('снять с баланса: остаток уменьшается, это не трата, отмена возвращает деньги', () => {
  const b = budget();
  const before = computePeriod(normalize(b.data), today);
  const d = normalize(structuredClone(b.data));
  const rec = applyWithdraw(d, today, 3000, 'Наличные', 'Лео');
  assert.equal(rec.mode, 'balance');
  assert.equal(rec.amount, -3000);
  assert.equal(d.balance.amount, 27000);
  assert.equal(d.spends.length, 0, 'в траты не попадает');
  const after = computePeriod(d, today);
  assert.equal(after.spentToday, before.spentToday, 'дневные траты не изменились');
  assert.equal(after.now, before.now - 3000);
  assert.ok(undoTopup(d, rec.id));
  assert.equal(d.balance.amount, 30000);
});

test('снять без заданного остатка: записывается оплаченным разовым платежом и откатывается', () => {
  const d = normalize({});
  const rec = applyWithdraw(d, today, 1000, 'Наличные', 'Лео');
  assert.equal(rec.mode, 'income');
  const item = d.items.find((i) => i.id === rec.itemId);
  assert.equal(item.type, 'bill');
  assert.equal(item.amount, 1000);
  assert.ok(Object.keys(d.done).length === 1, 'платёж сразу отмечен оплаченным');
  assert.equal(computePeriod(d, today).now, -1000);
  undoTopup(d, rec.id);
  assert.equal(d.items.length, 0);
});

test('пополнение по-прежнему работает', () => {
  const d = normalize({ balance: { amount: 100, ts: today.ts - 1000 } });
  applyTopup(d, today, 50, 'Подарок', 'Лео');
  assert.equal(d.balance.amount, 150);
});

test('фразы «снял …» и команда /withdraw', () => {
  assert.deepEqual(parseAny('снял 3000 наличные', today), { kind: 'withdraw', amount: 3000, name: 'Наличные' });
  assert.equal(parseAny('снял с карты 5к на ремонт', today).amount, 5000);
  assert.equal(parseAny('снял с карты 5к на ремонт', today).kind, 'withdraw');
  assert.equal(parseAny('снял 700', today).name, 'Снятие');
  assert.equal(parseAny('-5000 с баланса', today).kind, 'withdraw');
  assert.equal(parseAny('кофе 450', today).kind, 'spend', 'обычная трата не затронута');
  assert.equal(parseAny('пополнил баланс 5000', today).kind, 'topup');
  const b = budget();
  const r = handleMessage('/withdraw 2000 Наличные', structuredClone(b.data), today, { by: 'Лео' });
  assert.equal(r.changed, true);
  assert.equal(r.data.balance.amount, 28000);
  assert.match(handleMessage('/withdraw', structuredClone(b.data), today, {}).reply, /Формат/);
});

test('оплатить платёж можно заранее; он исчезает из «ближайших» и списывается с баланса', () => {
  const b = budget();
  const key = keyOf(b.data, 'Кредит');
  assert.equal(computePeriod(normalize(b.data), today).dueList.some((o) => o.key === key), true);
  const r = b.step('occ', { key });
  assert.equal(r.balance.amount, 25000);
  const p = computePeriod(normalize(r), today);
  assert.equal(p.dueList.some((o) => o.key === key), false);
  assert.equal(buildState(r, today, ctx).payments.find((x) => x.key === key).status, 'done');
});

test('снять отметку: деньги возвращаются, платёж снова ждёт оплаты', () => {
  const b = budget();
  const key = keyOf(b.data, 'Кредит');
  b.step('occ', { key });
  const r = b.step('occ_undo', { key });
  assert.equal(r.balance.amount, 30000);
  assert.equal(r.done[key], undefined);
  assert.equal(buildState(r, today, ctx).payments.find((x) => x.key === key).status, 'open');
  assert.throws(() => runAction(r, today, ctx, 'occ_undo', { key }), /нет/);
});

test('снять отметку «не было» не трогает баланс', () => {
  const b = budget();
  const key = keyOf(b.data, 'Кредит');
  b.step('occ', { key, skip: true });
  assert.equal(b.data.balance.amount, 30000);
  const r = b.step('occ_undo', { key });
  assert.equal(r.balance.amount, 30000);
});

test('если остаток заново задан после отметки, снятие отметки его не искажает', () => {
  const b = budget();
  const key = keyOf(b.data, 'Кредит');
  // отметка поставлена вчера, остаток переставлен сегодня (он уже учитывает платёж)
  const d = structuredClone(b.data);
  confirmOccurrence(d, key, { ...today, ts: today.ts - 86400000 });
  d.balance = { amount: 12345, ts: today.ts };
  unconfirmOccurrence(d, key, today);
  assert.equal(d.balance.amount, 12345);
});

test('старая отметка без записи о деньгах снимается и возвращает деньги', () => {
  const b = budget();
  const key = keyOf(b.data, 'Кредит');
  const d = structuredClone(b.data);
  d.done = { [key]: { ts: today.ts } }; // как было до этого обновления
  d.balance.amount = 25000;
  unconfirmOccurrence(d, key, today);
  assert.equal(d.balance.amount, 30000);
});

test('платёж из резерва: отметка и её снятие двигают резерв, а не карту', () => {
  const b = budget();
  b.step('item_add', { type: 'bill', amount: 20000, name: 'Аренда', day: 12 });
  b.step('reserve_set', { amount: 50000 });
  const key = keyOf(b.data, 'Аренда');
  const r = b.step('occ', { key });
  assert.equal(r.reserve.amount, 30000);
  assert.equal(r.balance.amount, 30000, 'карта не тронута');
  const u = b.step('occ_undo', { key });
  assert.equal(u.reserve.amount, 50000);
});

test('пополнения не попадают в «оплаты» и не снимаются как отметки', () => {
  const b = budget();
  const rec = applyTopup(b.data, today, 500, 'Подарок', 'Лео');
  const d = normalize(b.data);
  const none = normalize({});
  const rec2 = applyTopup(none, today, 700, 'Возврат', 'Лео');
  assert.ok(rec && rec2);
  assert.equal(buildState(none, today, ctx).payments.some((x) => x.name === 'Возврат'), false);
  const doneKey = Object.keys(none.done)[0];
  assert.throws(() => runAction(none, today, ctx, 'occ_undo', { key: doneKey }), /нет/);
  assert.ok(d);
});

test('state: статусы платежей и доходов', () => {
  const b = budget();
  const pays = buildState(b.data, today, ctx).payments;
  assert.equal(pays.find((x) => x.name === 'Кредит').status, 'open');
  assert.equal(pays.find((x) => x.name === 'Кредит').past, false);
  assert.equal(pays.find((x) => x.name === 'Зарплата').past, false);
  assert.ok(pays.every((x) => ['open', 'done', 'skipped', 'auto'].includes(x.status)));
});

// ---- бот: список «Оплаты»
test('paidList: платёж можно отметить заранее, будущий доход — нет, отмеченное можно снять', () => {
  const b = budget();
  const data = normalize(structuredClone(b.data));
  const first = paidList(data, today);
  const cbs = first.markup.inline_keyboard.flat().map((x) => x.callback_data);
  assert.ok(cbs.some((c) => /^cf:.+:L$/.test(c) && c.includes(keyOf(data, 'Кредит'))));
  assert.equal(cbs.some((c) => c.includes(keyOf(data, 'Зарплата'))), false, 'доход 20-го ещё не «пришёл»');
  assert.match(first.text, /Кредит/);
  confirmOccurrence(data, keyOf(data, 'Кредит'), today);
  const second = paidList(data, today).markup.inline_keyboard.flat().map((x) => x.callback_data);
  assert.ok(second.includes(`uc:${keyOf(data, 'Кредит')}:L`));
  assert.ok(second.every((c) => c.length <= 64));
});

function bot() {
  const db = new Map();
  const sent = [];
  const store = { load: async (id) => db.get(id) ?? null, save: async (id, d) => db.set(id, structuredClone(d)) };
  const tg = {
    send: async (chat, text, extra) => { sent.push({ op: 'send', chat, text, extra }); return { ok: true, result: { message_id: 1 } }; },
    edit: async (chat, id, text, extra) => { sent.push({ op: 'edit', chat, id, text, extra }); return { ok: true }; },
    answer: async (id, text) => { sent.push({ op: 'answer', text }); return { ok: true }; },
    pin: async () => ({ ok: true }),
  };
  const deps = { store, tg, today };
  const say = (text) => processUpdate({ message: { chat: { id: 5, type: 'private' }, from: { id: 7, first_name: 'Лео' }, text } }, deps);
  const press = (data, mid = 50) => processUpdate({ callback_query: { id: 'q', data, from: { id: 7, first_name: 'Лео' }, message: { chat: { id: 5 }, message_id: mid } } }, deps);
  return { db, sent, say, press };
}

test('бот: /paid → нажатие оплачивает и перерисовывает список → «Снять отметку» возвращает', async () => {
  const b = bot();
  await b.say('/balance 30000');
  await b.say('/bill 5000 15 Кредит');
  await b.say('/paid');
  const list = b.sent.at(-1);
  assert.match(list.text, /Оплаты и поступления/);
  const pay = list.extra.reply_markup.inline_keyboard.flat().find((x) => x.callback_data.startsWith('cf:'));
  assert.ok(pay, 'есть кнопка «Оплатил»');
  await b.press(pay.callback_data, 77);
  const edited = b.sent.filter((m) => m.op === 'edit' && m.id === 77).at(-1);
  assert.ok(edited, 'список в том же сообщении обновился');
  assert.equal(b.db.get(5).balance.amount, 25000);
  const undo = edited.extra.reply_markup.inline_keyboard.flat().find((x) => x.callback_data.startsWith('uc:'));
  assert.ok(undo, 'появилась кнопка «Снять отметку»');
  await b.press(undo.callback_data, 77);
  assert.equal(b.db.get(5).balance.amount, 30000);
  await b.press(undo.callback_data, 77);
  assert.ok(b.sent.some((m) => m.op === 'answer' && /уже нет/.test(m.text)), 'повторное снятие безопасно');
});

test('бот: «снял 3000» уменьшает баланс и даёт отмену', async () => {
  const b = bot();
  await b.say('/balance 30000');
  await b.say('снял 3000 наличные');
  const msg = b.sent.at(-1);
  assert.match(msg.text, /снято/);
  assert.equal(b.db.get(5).balance.amount, 27000);
  await b.press(msg.extra.reply_markup.inline_keyboard[0][0].callback_data);
  assert.equal(b.db.get(5).balance.amount, 30000);
});

test('сводка: есть кнопки «Оплаты», «Пополнить», «Снять»', () => {
  const cbs = dashMarkup().inline_keyboard.flat().map((x) => x.callback_data);
  for (const c of ['pd', 'h:topup', 'h:withdraw']) assert.ok(cbs.includes(c), c);
});
