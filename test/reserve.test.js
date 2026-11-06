import test from 'node:test';
import assert from 'node:assert/strict';
import { computePeriod, dn, isReserveBill, planReserve, weekdaysBetween } from '../lib/period.js';
import { workdaysBetween, isWorkday } from '../lib/calendar.js';
import { processUpdate } from '../lib/engine.js';
import { handleMessage, normalize } from '../lib/bot.js';
import { formatPlanFull as formatPlan } from '../lib/format.js';
import { parseAny } from '../lib/nlp.js';
import { parseStatementText, prepareImport, previewText } from '../lib/statement.js';

const at = (y, m, d, h = 12) => ({ y, m, d, ts: new Date(y, m, d, h).getTime(), dayStart: new Date(y, m, d).getTime(), monthStart: new Date(y, m, 1).getTime() });
const r2 = (n) => Math.round(n * 100) / 100;

const base = (extra = {}) => normalize({
  items: [
    { id: 'sal', type: 'income', amount: 102600, day: 5, name: 'Зарплата' },
    { id: 'adv', type: 'income', amount: 17400, day: 20, name: 'Аванс' },
    { id: 'rent', type: 'bill', amount: 43000, day: 27, name: 'Аренда' },
    { id: 'net', type: 'bill', amount: 950, day: 27, name: 'Интернет' },
    { id: 'com', type: 'bill', amount: 2000, day: 27, name: 'Коммунальные услуги' },
    { id: 'sub', type: 'bill', amount: 500, day: 7, name: 'Подписка' },
  ],
  ...extra,
});

// платежи 27 октября уже оплачены (иначе бот считает их просроченными и просит срочно пополнить резерв)
const PAID_OCT = { 'rent:20261027': { ts: new Date(2026, 9, 27).getTime() }, 'net:20261027': { ts: new Date(2026, 9, 27).getTime() }, 'com:20261027': { ts: new Date(2026, 9, 27).getTime() } };

function harness(init, today) {
  const db = new Map([[1, init]]);
  const sent = [];
  const store = { load: async (id) => db.get(id), save: async (id, d) => db.set(id, structuredClone(d)) };
  const tg = {
    send: async (c, t, e) => { sent.push({ t, e }); return { ok: true, result: { message_id: 9 } }; },
    edit: async (c, i, t, e) => { sent.push({ t, e, edit: true }); return { ok: true }; },
    answer: async () => ({}), pin: async () => ({}),
  };
  const from = { id: 5, first_name: 'Лео' };
  const deps = { store, tg, today };
  return {
    db, sent,
    msg: (text) => processUpdate({ message: { chat: { id: 1 }, from, text } }, deps),
    press: (d) => processUpdate({ callback_query: { id: 'q', data: d, from, message: { chat: { id: 1 }, message_id: 5 } } }, deps),
  };
}

test('платежи аренда/интернет/коммуналка по умолчанию идут из резерва', () => {
  assert.ok(isReserveBill({ type: 'bill', name: 'Аренда квартиры' }));
  assert.ok(isReserveBill({ type: 'bill', name: 'Коммунальные услуги' }));
  assert.ok(!isReserveBill({ type: 'bill', name: 'Подписка' }));
  assert.ok(!isReserveBill({ type: 'bill', name: 'Интернет', fromReserve: false }));
  assert.ok(!isReserveBill({ type: 'bill', name: 'Транспорт', spread: true }));
});

test('в день зарплаты: аванс закрывает часть, остальное — перевести с зарплаты (без округления)', () => {
  const today = at(2026, 10, 5); // 5 ноября
  const d = base({
    balance: { amount: 107600, ts: today.ts - 1000 }, // зарплата уже на карте
    reserve: { amount: 0, ts: today.ts - 86400000 * 3, history: [] },
    done: { 'sal:20261105': { ts: today.ts }, ...PAID_OCT },
  });
  const rp = planReserve(d.items, d.reserve, dn(2026, 10, 5), dn(2026, 10, 5) + 130, d.done);
  assert.equal(rp.deadlines[0].cum, 45950);
  assert.equal(rp.alloc.get(dn(2026, 10, 20)), 17400); // аванс целиком
  assert.equal(rp.shortageNow, 28550);
  assert.equal(rp.transferNow, 28550);
  const p = computePeriod(d, today);
  assert.equal(p.transferNow, 28550);
  assert.ok(!p.dueList.some((o) => o.name === 'Аренда'), 'аренда не списывается с карты');
  const text = formatPlan(d, today);
  assert.match(text, /Резерв на аренду/);
  assert.match(text, /Переведи на резерв сейчас 28 550/);
  assert.match(text, /в резерв на аренду/); // в строке расчёта
});

test('после перевода в резерв подсказка меняется: с аванса переведёшь остальное', async () => {
  const today = at(2026, 10, 5);
  const h = harness(base({
    balance: { amount: 107600, ts: today.ts - 1000 },
    reserve: { amount: 0, ts: today.ts - 86400000 * 3, history: [] },
    done: { 'sal:20261105': { ts: today.ts }, ...PAID_OCT },
  }), today);
  await h.msg('перевёл на резерв 30к');
  const d = h.db.get(1);
  assert.equal(d.reserve.amount, 30000);
  assert.equal(d.balance.amount, 77600); // с карты ушли 30 000
  const p = computePeriod(d, today);
  assert.equal(p.transferNow, 0);
  assert.equal(p.rplan.deadlines[0].required, 15950);
  assert.equal(p.rplan.alloc.get(dn(2026, 10, 20)), 15950); // с аванса — ровно недостающее
  assert.match(formatPlan(d, today), /С дохода переведёшь: 20 ноября/);
});

test('кнопка «Пришло» на зарплате предлагает перевод в резерв и записывает его', async () => {
  const today = at(2026, 10, 5);
  const h = harness(base({
    balance: { amount: 5000, ts: today.ts - 86400000 },
    reserve: { amount: 0, ts: today.ts - 86400000 * 3, history: [] },
    done: { ...PAID_OCT },
  }), today);
  await h.press('cf:sal:20261105');
  assert.equal(h.db.get(1).balance.amount, 107600);
  const offer = h.sent.find((m) => m.t?.includes('Переведи на резерв'));
  assert.ok(offer, 'бот напомнил про резерв');
  const buttons = offer.e.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.deepEqual(buttons, ['rd:28550', 'rd:x']);
  await h.press('rd:28550');
  assert.equal(h.db.get(1).reserve.amount, 28550);
  assert.equal(h.db.get(1).balance.amount, 79050);

  // «Другая сумма»: бот ждёт число
  await h.press('rd:x');
  assert.equal(h.db.get(1).awaiting.kind, 'deposit');
  await h.msg('1000');
  assert.equal(h.db.get(1).reserve.amount, 29550);
  assert.equal(h.db.get(1).awaiting, null);
});

test('оплата аренды из резерва списывает резерв, а не карту', async () => {
  const today = at(2026, 9, 27); // 27 октября
  const h = harness(base({
    balance: { amount: 6000, ts: today.ts - 86400000 * 2 },
    reserve: { amount: 46000, ts: today.ts - 86400000 * 2, history: [] },
  }), today);
  const before = computePeriod(h.db.get(1), today);
  assert.deepEqual(before.pending.map((o) => o.name).sort(), ['Аренда', 'Интернет', 'Коммунальные услуги']);
  assert.equal(before.transferNow, 0);
  for (const id of ['rent', 'net', 'com']) await h.press(`cf:${id}:20261027`);
  const d = h.db.get(1);
  assert.equal(d.reserve.amount, r2(46000 - 45950));
  assert.equal(d.balance.amount, 6000);
});

test('/reserve: настройка, контракт, статус, выключение', () => {
  const today = at(2026, 9, 24);
  let r = handleMessage('/reserve 46000', base({ balance: { amount: 52926, ts: today.ts } }), today);
  assert.equal(r.data.reserve.amount, 46000);
  assert.ok(r.markup, 'предложили вычесть резерв из остатка карты');
  r = handleMessage('/reserve contract ...8861', r.data, today);
  assert.equal(r.data.reserve.contract, '8861');
  r = handleMessage('/reserve +4000', r.data, today);
  assert.equal(r.data.reserve.amount, 50000);
  assert.equal(r.data.balance.amount, 48926);
  assert.match(handleMessage('/reserve', r.data, today).reply, /Резерв на аренду/);
  r = handleMessage('/reserve off', r.data, today);
  assert.equal(r.data.reserve, null);
});

test('транспорт по формуле: карта + ставка за будние дни цикла', async () => {
  const today = at(2026, 9, 24);
  assert.equal(weekdaysBetween(dn(2026, 9, 5), dn(2026, 10, 5)), 23); // 5 окт – 4 ноя: будни
  assert.equal(workdaysBetween(dn(2026, 9, 5), dn(2026, 10, 5)), 22); // 4 ноября — праздник
  assert.deepEqual(parseAny('транспорт карта 3500 + 180 по будням', today), { kind: 'transport', base: 3500, daily: 180 });
  const r = handleMessage('/transport 3500 180', base(), today);
  const it = r.data.items.find((i) => i.formula);
  assert.deepEqual([it.spread, it.cat, it.amount], [true, 'transport', 3500 + 180 * 22]);
  const p = computePeriod(r.data, today);
  assert.equal(p.spread.find((s) => s.name === 'Транспорт').amount, 7460);
  // в другом цикле — своё число будней (5 ноя – 4 дек: 22 будних)
  const next = at(2026, 10, 10);
  assert.equal(computePeriod(r.data, next).spread.find((s) => s.name === 'Транспорт').amount, 3500 + 180 * 22);
});

const STATEMENT = `Справка о движении средств
Сумма доступного остатка на 24.10.2026: 6 926.41 ₽
Дата и время
операции
Дата
списания
Сумма в валюте
операции
Сумма операции
в валюте карты
Описание
операции
Номер
карты
20.10.2026
13:03
20.10.2026
13:04
-16 000.00 ₽ -16 000.00 ₽ Внутренний перевод на
договор 8431728861
1111
20.10.2026
09:07
20.10.2026
09:22
-300.00 ₽ -300.00 ₽ Оплата в MAGNIT MM
MOSCOW RUS
1111
16 000,00 ₽Пополнения:
16 300,00 ₽Расходы:`;

test('выписка: перевод на счёт резерва пополняет резерв, ручная запись не задваивается', async () => {
  const today = at(2026, 9, 24, 20);
  const parsed = parseStatementText(STATEMENT);
  assert.equal(parsed.rows.length, 2);
  const manualTs = new Date(2026, 9, 20, 9).getTime();
  const d = base({
    reserve: { amount: 30000, ts: new Date(2026, 9, 18).getTime(), contract: '8861', history: [{ ts: manualTs, amount: 16000, src: 'manual' }] },
  });
  const prep = prepareImport(d, parsed);
  assert.equal(prep.deposits.length, 1);
  assert.equal(prep.deposits[0].amount, 16000);
  assert.equal(prep.deposits[0].dupOf, manualTs);
  assert.match(previewText(prep, parsed), /Переводы на резерв/);

  // без ручной записи — резерв растёт; повторная загрузка ничего не добавляет
  const h = harness(base({ reserve: { amount: 30000, ts: new Date(2026, 9, 18).getTime(), contract: '8861', history: [] } }), today);
  const upload = () => processUpdate({ message: { chat: { id: 1 }, from: { id: 5, first_name: 'Лео' }, document: { file_id: 'f', file_name: 'a.pdf', mime_type: 'application/pdf', file_size: 10 } } }, {
    store: { load: async (id) => h.db.get(id), save: async (id, x) => h.db.set(id, structuredClone(x)) },
    tg: { send: async (c, t, e) => { h.sent.push({ t, e }); return { ok: true, result: { message_id: 9 } }; }, edit: async () => ({ ok: true }), answer: async () => ({}), pin: async () => ({}), getFile: async () => ({ ok: true, result: { file_path: 'x' } }), download: async () => Buffer.from('x') },
    today, pdfText: async () => STATEMENT,
  });
  await upload();
  const pend = h.db.get(1).pending.find((p) => p.kind === 'import');
  await h.press(`ix:${pend.id}:n`);
  assert.equal(h.db.get(1).reserve.amount, 46000);
  assert.equal(h.db.get(1).reserve.history.at(-1).src, 'bank');
  await upload();
  assert.match(h.sent.at(-1).t, /Новые траты: 0/);
  assert.equal(h.db.get(1).reserve.amount, 46000);
});

test('карточка платежа: переключатель «из резерва / с карты»', async () => {
  const today = at(2026, 9, 24);
  const h = harness(base({ reserve: { amount: 1000, ts: today.ts, history: [] } }), today);
  await h.press('er:sub'); // подписка по умолчанию с карты
  assert.equal(h.db.get(1).items.find((i) => i.id === 'sub').fromReserve, true);
  await h.press('er:rent');
  assert.equal(h.db.get(1).items.find((i) => i.id === 'rent').fromReserve, false);
});

test('фиксированные взносы: с зарплаты 30 000, с аванса 16 000 — каждый месяц', () => {
  const today = at(2026, 9, 24);
  let r = handleMessage('/reserve plan Зарплата 30000 Аванс 16000', base({ reserve: { amount: 50, ts: today.ts, history: [] } }), today);
  assert.match(r.reply, /Всего в месяц 46 000/);
  assert.match(r.reply, /хватает/);
  const d = r.data;
  assert.equal(d.items.find((i) => i.id === 'adv').toReserve, 16000);
  // в декабре на счёте 50 ₽ (после оплаты 27 октября): нужно 45 900 -> аванс 16 000, зарплата ровно 29 900
  const nov = at(2026, 10, 1);
  const rp = planReserve(d.items, d.reserve, dn(2026, 10, 1), dn(2026, 10, 1) + 130, PAID_OCT);
  assert.equal(rp.alloc.get(dn(2026, 10, 20)), 16000);
  assert.equal(rp.alloc.get(dn(2026, 10, 5)), 29900);
  assert.equal(rp.shortageNow, 0);
  r = handleMessage('/reserve plan Аванс 5000', d, today);
  assert.match(r.reply, /не хватает 10 950/);
  assert.match(handleMessage('/reserve plan', d, today).reply, /Зарплата — 30 000/);
});

test('короткая фраза «Резерв 100» — это взнос в резерв, а не трата', () => {
  for (const s of ['Резерв 100', 'в резерв 2к', 'резерв +500']) {
    const r = parseAny(s, at(2026, 9, 28));
    assert.equal(r?.kind, 'rdeposit', s);
  }
  assert.equal(parseAny('Резерв 100', at(2026, 9, 28)).amount, 100);
});

test('производственный календарь: в ноябре 2026 — 20 рабочих дней, в декабре — 22', () => {
  assert.equal(workdaysBetween(dn(2026, 10, 1), dn(2026, 11, 1)), 20); // 4 ноября — праздник
  assert.equal(workdaysBetween(dn(2026, 11, 1), dn(2027, 0, 1)), 22); // 31 декабря — выходной
  assert.equal(isWorkday(dn(2026, 0, 12)), true, '12 января 2026 остаётся рабочим');
  assert.equal(isWorkday(dn(2026, 2, 9)), false, '8 марта выпало на воскресенье — выходной 9-го');
  assert.equal(isWorkday(dn(2026, 4, 11)), false, '9 мая выпало на субботу — выходной 11-го');
  assert.equal(workdaysBetween(dn(2026, 10, 1), dn(2026, 10, 8)), 4); // 2, 3, 5, 6 ноября (4-го праздник)
});

test('транспорт на календарный месяц: цикл с 1-го даёт 3500 + 180 × 20 за ноябрь', () => {
  const t = at(2026, 10, 6);
  let r = handleMessage('/cycle 1', base(), t);
  r = handleMessage('/transport 3500 180', r.data, t);
  assert.equal(r.data.items.find((i) => i.formula).amount, 3500 + 180 * 20);
});

test('траты «в течение месяца»: резервируется весь остаток, а не доля на дни до дохода', () => {
  const t = at(2026, 10, 6);
  const d = normalize({
    balance: { amount: 30000, ts: t.ts - 1000 },
    items: [
      { id: 'a', type: 'income', amount: 60000, day: 10, name: 'Зарплата' },
      { id: 'b', type: 'income', amount: 25000, day: 25, name: 'Аванс' },
      { id: 'pet', type: 'bill', amount: 4000, day: null, spread: true, cat: 'pets', name: 'Домашнее животное' },
    ],
    spends: [{ id: 's', amount: 160, cat: 'pets', ts: t.ts - 3600000 }],
  });
  const p = computePeriod(d, t);
  assert.equal(p.spread[0].reserve, 3840, 'не 4 дня из цикла, а весь остаток 4000 − 160');
  assert.equal(p.reserveTotal, 3840);
  assert.doesNotMatch(formatPlan(d, t), /на эти дни/);
});
