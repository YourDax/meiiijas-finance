import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { compareSpends, matchesQuery, deltaPct, dnOfKey, dayKeyOf } from '../public/stats.js';
import { spendsToCsv } from '../lib/csv.js';
import { sizeReport, SIZE_WARN } from '../lib/size.js';
import { handleApp } from '../lib/appserver.js';
import { runAction } from '../lib/app.js';
import { normalize } from '../lib/bot.js';
import { processUpdate } from '../lib/engine.js';
import { COMMANDS, REPLY_KEYBOARD } from '../lib/commands.js';

const TZ = 'Europe/Moscow';
const at = (y, m, d, h = 12) => new Date(Date.UTC(y, m - 1, d, h - 3)).getTime(); // час по Москве

test('dnOfKey / dayKeyOf: день в часовом поясе бюджета', () => {
  assert.equal(dnOfKey('1970-01-02') - dnOfKey('1970-01-01'), 1);
  assert.equal(dayKeyOf(Date.UTC(2026, 2, 5, 22, 30), TZ), '2026-03-06', '22:30 UTC — уже завтра по Москве');
});

test('deltaPct: рост, снижение, нет базы', () => {
  assert.equal(deltaPct(150, 100), 50);
  assert.equal(deltaPct(50, 100), -50);
  assert.equal(deltaPct(10, 0), null);
});

test('compareSpends: неделя и месяц сравниваются с тем же периодом прошлого', () => {
  // Среда 11 ноября 2026: неделя с пн 9 ноября, прошлая — с пн 2 ноября до среды 4-го
  const now = at(2026, 11, 11);
  const spends = [
    { amount: 100, ts: at(2026, 11, 9) }, { amount: 200, ts: at(2026, 11, 11) }, // эта неделя = 300
    { amount: 50, ts: at(2026, 11, 2) }, { amount: 50, ts: at(2026, 11, 4) }, // прошлая до среды = 100
    { amount: 999, ts: at(2026, 11, 6) }, // конец прошлой недели — в «до среды» не входит
    { amount: 400, ts: at(2026, 10, 5) }, { amount: 600, ts: at(2026, 10, 25) }, // октябрь: до 11-го = 400, весь = 1000
  ];
  const c = compareSpends(spends, now, TZ);
  assert.equal(c.week.cur, 300);
  assert.equal(c.week.prev, 100);
  assert.equal(c.week.pct, 200);
  assert.equal(c.month.cur, 100 + 200 + 50 + 50 + 999);
  assert.equal(c.month.prev, 400);
  assert.equal(c.month.prevFull, 1000);
  assert.equal(c.days.length, 14);
  assert.equal(c.days.at(-1).today, true);
  assert.equal(c.days.at(-1).sum, 200);
});

test('compareSpends: январь сравнивается с декабрём прошлого года', () => {
  const c = compareSpends([{ amount: 70, ts: at(2025, 12, 3) }, { amount: 10, ts: at(2026, 1, 3) }], at(2026, 1, 10), TZ);
  assert.equal(c.month.prev, 70);
  assert.equal(c.month.cur, 10);
});

test('matchesQuery: название, категория, сумма, «к», дата', () => {
  const spend = { amount: 1500, name: 'Кофе', cat: 'food', by: 'Лео', ts: at(2026, 3, 5) };
  const env = {
    catTitle: () => '🛒 Продукты',
    dayKey: (ts) => dayKeyOf(ts, TZ),
    dayLabel: (key) => { const [, m, d] = key.split('-').map(Number); return `${d} ${['января', 'февраля', 'марта'][m - 1]}`; },
  };
  for (const q of ['', 'кофе', 'продукт', 'лео', '1500', '1 500', '1,5к', '5 марта', '05.03']) assert.equal(matchesQuery(spend, q, env), true, q);
  for (const q of ['чай', '150000', '2к', '6 марта']) assert.equal(matchesQuery(spend, q, env), false, q);
  assert.equal(matchesQuery(spend, '15', env), true, 'сумма по началу числа');
});

test('CSV: заголовок, BOM, запятая в сумме, экранирование и защита от формул', () => {
  const csv = spendsToCsv([
    { amount: 450.5, name: 'Кофе; с "молоком"', cat: 'food', ts: at(2026, 3, 5, 9), by: 'Лео' },
    { amount: 100, name: '=SUM(A1)', cat: 'nope', ts: at(2026, 3, 4, 8), src: 'bank' },
  ]);
  assert.ok(csv.startsWith('﻿Дата;Время;Сумма;Название;Категория;Кто;Источник\r\n'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.match(lines[1], /^2026-03-04;08:00;100;'=SUM\(A1\);.*;;выписка$/, 'по возрастанию даты, формула экранирована');
  assert.match(lines[2], /^2026-03-05;09:00;450,5;"Кофе; с ""молоком""";/);
});

test('sizeReport: считает размер и предупреждает о крупных бюджетах', () => {
  assert.equal(sizeReport({ spends: [] }).warn, false);
  const big = { imported: Array.from({ length: Math.ceil(SIZE_WARN / 20) }, (_, i) => `hash-${String(i).padStart(12, '0')}`) };
  const r = sizeReport(big);
  assert.equal(r.warn, true);
  assert.match(r.top[0], /^imported:/);
});

test('spend_restore возвращает трату с прежним временем и не принимает будущее', () => {
  const today = { y: 2026, m: 10, d: 11, ts: at(2026, 11, 11) };
  const ctx = { by: 'Лео', tz: TZ };
  const r = runAction({}, today, ctx, 'spend_restore', { amount: 450, name: 'Кофе', cat: 'food', ts: at(2026, 11, 3), src: 'bank' });
  const s = r.data.spends.at(-1);
  assert.equal(s.ts, at(2026, 11, 3));
  assert.equal(s.src, 'bank');
  assert.throws(() => runAction({}, today, ctx, 'spend_restore', { amount: 1, ts: today.ts + 5 * 86400000 }), /дата/i);
  assert.throws(() => runAction({}, today, ctx, 'spend_restore', { amount: 0, ts: today.ts }), /сумма/i);
});

// ---- экспорт через API
const TOKEN = '123456:TEST-TOKEN';
const NOW = at(2026, 11, 6);
function sign(user) {
  const p = new URLSearchParams({ auth_date: String(Math.floor(NOW / 1000)), query_id: 'AAH', user: JSON.stringify(user) });
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  p.set('hash', createHmac('sha256', createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update(check).digest('hex'));
  return p.toString();
}
function api(sendDocument) {
  const db = new Map();
  const store = { load: async (id) => structuredClone(db.get(id) ?? null), save: async (id, d) => { db.set(id, structuredClone(d)); }, userChats: async () => [] };
  const tg = { send: async () => ({ ok: true }), edit: async () => ({ ok: true }), sendDocument };
  const call = (action, payload = {}) => handleApp({ initData: sign({ id: 42, first_name: 'Лео' }), action, payload }, { store, tg, now: NOW, env: { BOT_TOKEN: TOKEN, TZ_NAME: TZ } });
  return { call };
}

test('export_csv: файл уходит пользователю в личный чат, фильтр по месяцу', async () => {
  const docs = [];
  const h = api(async (chat, name, content, caption) => { docs.push({ chat, name, content, caption }); return { ok: true }; });
  await h.call('spend_add', { amount: 100, name: 'Чай' });
  assert.equal((await h.call('export_csv', { month: '2020-01' })).status, 400, 'за тот месяц трат нет');
  const r = await h.call('export_csv', { month: '2026-11' });
  assert.equal(r.status, 200);
  assert.equal(r.json.result.rows, 1);
  assert.equal(docs[0].chat, 42);
  assert.match(docs[0].name, /^траты-2026-11-06\.csv$/);
  assert.match(docs[0].content, /Чай/);
  assert.equal(r.json.result.csv, undefined, 'содержимое файла в ответ приложению не отдаём');
});

test('export_csv: если Telegram не принял файл — понятная ошибка', async () => {
  const h = api(async () => ({ ok: false }));
  await h.call('spend_add', { amount: 100, name: 'Чай' });
  const r = await h.call('export_csv', {});
  assert.equal(r.status, 502);
  assert.match(r.json.error, /\/start/);
});

test('state содержит объём данных', async () => {
  const h = api(async () => ({ ok: true }));
  const r = await h.call('state');
  assert.ok(r.json.state.usage.bytes > 0);
  assert.equal(r.json.state.usage.warn, false);
});

// ---- бот: клавиатура и команды
function bot(chatId = 5, type = 'private') {
  const db = new Map();
  const sent = [];
  const calls = [];
  const store = { load: async (id) => db.get(id) ?? null, save: async (id, d) => db.set(id, structuredClone(d)) };
  const tg = {
    send: async (chat, text, extra) => { sent.push({ chat, text, extra }); return { ok: true, result: { message_id: 1 } }; },
    edit: async () => ({ ok: true }), answer: async () => ({ ok: true }), pin: async () => ({ ok: true }),
    setMenuButton: async () => ({ ok: true }),
    setCommands: async (c) => { calls.push(['commands', c]); return { ok: true }; },
  };
  const today = { y: 2026, m: 9, d: 24, ts: new Date(2026, 9, 24, 12).getTime(), monthStart: new Date(2026, 9, 1).getTime() };
  const say = (text) => processUpdate({ message: { chat: { id: chatId, type }, from: { id: 7, first_name: 'Лео' }, text } }, { store, tg, today });
  return { sent, calls, say };
}

test('/start в личном чате: меню команд, постоянная клавиатура', async () => {
  const b = bot();
  await b.say('/start');
  assert.deepEqual(b.calls[0], ['commands', COMMANDS]);
  assert.deepEqual(b.sent.at(-1).extra.reply_markup, REPLY_KEYBOARD);
  assert.ok(COMMANDS.length <= 100 && COMMANDS.every((c) => /^[a-z_]{1,32}$/.test(c.command) && c.description.length <= 256));
});

test('/start в беседе: клавиатуру не навязываем', async () => {
  const b = bot(-5, 'group');
  await b.say('/start');
  assert.equal(b.sent.at(-1).extra.reply_markup, undefined);
  assert.equal(b.calls.length, 0);
});

test('кнопки клавиатуры: «Сводка» открывает сводку, «Трата» подсказывает формат', async () => {
  const b = bot();
  await b.say('кофе 450');
  await b.say('📊 Сводка');
  assert.ok(b.sent.some((m) => m.extra?.reply_markup?.inline_keyboard?.flat().some((x) => x.callback_data === 'refresh')), 'пришла сводка с кнопками');
  const before = b.sent.length;
  await b.say('🧾 Трата');
  assert.match(b.sent[before].text, /кофе 450/);
  await b.say('📱 Приложение');
  assert.ok(b.sent.at(-1).extra.reply_markup.inline_keyboard[0][0].web_app);
});

test('normalize: пустые данные содержат список трат', () => {
  assert.deepEqual(normalize({}).spends, []);
});
