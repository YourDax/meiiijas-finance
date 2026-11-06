import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatementText, prepareImport, previewText, classifyRow } from '../lib/statement.js';
import { processUpdate } from '../lib/engine.js';
import { normalize } from '../lib/bot.js';
import { computePeriod } from '../lib/period.js';
import { merchantInfo, categorizeMerchant } from '../lib/cats.js';

// Выдуманная выписка в том же формате, что и справка Т-Банка (данные вымышленные)
const STATEMENT = `Исх. № 1a2b3c
АКЦИОНЕРНОЕ ОБЩЕСТВО «ТБАНК»
Справка о движении средств
24.10.2026
Иванов Иван Иванович
Номер лицевого счета: 40817810000000000000
Сумма доступного остатка на 24.10.2026: 6 926.41 ₽
Движение средств за период с 19.10.2026 по 24.10.2026
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
24.10.2026
14:38
24.10.2026
15:12
-808.00 ₽ -808.00 ₽ Оплата в
YANDEX*5814*EDA Moskva
RUS
1111
23.10.2026
18:57
23.10.2026
19:12
-1 081.90 ₽ -1 081.90 ₽ Оплата в MAGNIT MM
BOLGURY Lyubercy RUS
1111
23.10.2026
08:27
23.10.2026
08:27
-90.00 ₽ -90.00 ₽ Внутренний перевод на
договор 5568765716
1111
22.10.2026
19:38
22.10.2026
19:38
+5 000.00 ₽ +5 000.00 ₽ Пополнение. Система
быстрых платежей
1111
22.10.2026
13:07
22.10.2026
13:07
-25 000.00 ₽ -25 000.00 ₽ Внешний перевод по
номеру телефона
+70000000000
1111
АО «ТБанк» универсальная лицензия Банка России № 2673, к/с 30101810145250000974 в ГУ Банка России по ЦФО
БИК 044525974 ИНН 7710140679 КПП 771301001 1
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
21.10.2026
09:43
21.10.2026
09:58
-285.97 ₽ -285.97 ₽ Оплата в MAGNIT MM
VEBMASTER MOSCOW RUS
1111
20.10.2026
20:09
20.10.2026
20:24
-573.00 ₽ -573.00 ₽ Оплата в
SBER*5411*SAMOKAT
SANKT-PETERBU RUS
1111
5 000,00 ₽Пополнения:
27 838,87 ₽Расходы:
С уважением,
Руководитель Управления
АО «ТБанк» универсальная лицензия Банка России № 2673, к/с 30101810145250000974 в ГУ Банка России по ЦФО
БИК 044525974 ИНН 7710140679 КПП 771301001 2`;

const today = { y: 2026, m: 9, d: 24, ts: new Date('2026-10-24T20:00:00+03:00').getTime(), dayStart: new Date('2026-10-24T00:00:00+03:00').getTime(), monthStart: new Date('2026-10-01T00:00:00+03:00').getTime() };

test('разбор выписки: строки, суммы сходятся с итогами, остаток', () => {
  const p = parseStatementText(STATEMENT, 'Europe/Moscow');
  assert.equal(p.rows.length, 7);
  assert.equal(p.ok, true);
  assert.deepEqual(p.totals, { inflow: 5000, outflow: 27838.87 });
  assert.deepEqual(p.balance, { date: '24.10.2026', amount: 6926.41 });
  assert.equal(p.rows[0].amount, -808);
  assert.equal(p.rows[1].amount, -1081.9);
  assert.equal(p.rows[0].ts, new Date('2026-10-24T14:38:00+03:00').getTime());
  assert.match(p.rows[0].desc, /^Оплата в YANDEX\*5814\*EDA Moskva RUS$/);
  assert.equal(parseStatementText('просто текст').ok, false);
});

test('классификация: магазины, переводы, поступления', () => {
  const p = parseStatementText(STATEMENT);
  const kinds = p.rows.map((r) => classifyRow(r));
  assert.deepEqual(kinds.map((k) => k.kind), ['purchase', 'purchase', 'internal', 'inflow', 'purchase', 'purchase', 'purchase']);
  assert.equal(kinds[0].cat, 'cafe');
  assert.equal(kinds[0].name, 'Яндекс Еда');
  assert.equal(kinds[1].cat, 'food');
  assert.equal(kinds[4].name, 'Перевод людям'); // номер телефона в данные не попадает
  assert.ok(!kinds[4].name.includes('7000'));
  assert.equal(merchantInfo('DIXY-90367D Lyubercy RUS').key, 'DIXY');
  assert.equal(categorizeMerchant('PK_foto-mania', 'PK_FOTO-MANIA', { 'PK_FOTO-MANIA': 'shop' }), 'shop');
});

test('дубли: вручную записанные, платежи из списка, повторная загрузка', () => {
  const data = normalize({
    items: [{ id: 'rent', type: 'bill', amount: 25000, day: 22, name: 'Аренда' }],
    spends: [{ id: 'm1', amount: 808, name: 'Доставка', cat: 'cafe', ts: new Date('2026-10-24T14:30:00+03:00').getTime() }],
    imported: [],
  });
  const parsed = parseStatementText(STATEMENT);
  const prep = prepareImport(data, parsed);
  assert.equal(prep.dupManual.length, 1);
  assert.equal(prep.bills.length, 1);
  assert.equal(prep.bills[0].matched, 'Аренда');
  assert.equal(prep.fresh.length, 3);
  assert.equal(prep.internal.length, 1);
  assert.equal(prep.inflow.length, 1);
  const text = previewText(prep, parsed);
  assert.match(text, /Новые траты: 3/);
  assert.match(text, /Остаток по выписке/);
  assert.doesNotMatch(text, /не сошлись/);

  data.imported = [...prep.fresh, ...prep.dupManual, ...prep.bills].map((r) => r.h);
  const again = prepareImport(data, parsed);
  assert.equal(again.fresh.length, 0);
  assert.equal(again.dupImport.length, 5);
});

function harness() {
  const db = new Map([[1, normalize({
    items: [{ id: 'adv', type: 'income', amount: 40000, day: 5, name: 'Аванс' }],
    goals: [],
  })]]);
  const sent = [];
  const store = { load: async (id) => db.get(id), save: async (id, d) => db.set(id, structuredClone(d)) };
  const tg = {
    send: async (c, t, e) => { sent.push({ t, e }); return { ok: true, result: { message_id: 9 } }; },
    edit: async (c, i, t) => { sent.push({ t, edit: true }); return { ok: true }; },
    answer: async () => ({}),
    pin: async () => ({}),
    getFile: async () => ({ ok: true, result: { file_path: 'docs/x.pdf' } }),
    download: async () => Buffer.from('fake'),
  };
  const deps = { store, tg, today, pdfText: async () => STATEMENT };
  const from = { id: 5, first_name: 'Лео' };
  return {
    db, sent,
    upload: (name = 'Справка.pdf') => processUpdate({ message: { chat: { id: 1 }, from, document: { file_id: 'f', file_name: name, mime_type: 'application/pdf', file_size: 1000 } } }, deps),
    press: (d) => processUpdate({ callback_query: { id: 'q', data: d, from, message: { chat: { id: 1 }, message_id: 5 } } }, deps),
  };
}

test('движок: PDF -> карточка -> запись трат и остатка, повторная загрузка не дублирует', async () => {
  const h = harness();
  await h.upload();
  const card = h.sent.at(-1);
  assert.match(card.t, /Выписка Т-Банка/);
  const pend = h.db.get(1).pending.find((p) => p.kind === 'import');
  assert.equal(pend.rows.length, 5);
  const btn = card.e.reply_markup.inline_keyboard.flat().find((b) => b.callback_data.endsWith(':b'));
  assert.ok(btn, 'есть кнопка с остатком');

  await h.press(btn.callback_data);
  const d = h.db.get(1);
  assert.equal(d.spends.length, 5);
  assert.ok(d.spends.every((s) => s.src === 'bank'));
  assert.equal(d.balance.amount, 6926.41);
  assert.equal(d.pending.length, 0);
  assert.ok(computePeriod(d, today).now === 6926.41);

  await h.upload();
  const card2 = h.sent.at(-1);
  assert.match(card2.t, /Новые траты: 0/);
  assert.match(card2.t, /уже импортированы: 5/);
});

test('движок: другие файлы игнорируются; смена категории запоминает магазин', async () => {
  const h = harness();
  const before = h.sent.length;
  await processUpdate({ message: { chat: { id: 1 }, from: { id: 5 }, document: { file_id: 'x', file_name: 'a.txt', mime_type: 'text/plain' } } }, { store: { load: async () => null, save: async () => {} }, tg: {}, today });
  assert.equal(h.sent.length, before);

  await h.upload();
  const pend = h.db.get(1).pending.find((p) => p.kind === 'import');
  await h.press(`ix:${pend.id}:n`);
  const magnit = h.db.get(1).spends.find((s) => s.merchant === 'MAGNIT');
  await h.press(`sc:${magnit.id}:home`);
  assert.equal(h.db.get(1).rules.MAGNIT, 'home');
  assert.equal(h.db.get(1).spends.find((s) => s.id === magnit.id).cat, 'home');
});

test('дубль с вручную записанной тратой: округлённая сумма и запись задним числом', () => {
  const parsed = parseStatementText(STATEMENT);
  const data = normalize({
    spends: [{ id: 'm', amount: 810, name: 'Доставка', cat: 'cafe', ts: new Date('2026-10-26T10:00:00+03:00').getTime() }],
  });
  // 808 в выписке и 810 вручную: разница 2 ₽ укладывается в 1% (8,08 ₽), дата в пределах 5 дней
  const prep = prepareImport(data, parsed);
  assert.equal(prep.dupManual.length, 1);
  assert.equal(prep.dupManual[0].matched, 'Доставка');
});
