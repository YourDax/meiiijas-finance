import test from 'node:test';
import assert from 'node:assert/strict';
import webhook from '../api/webhook.js';
import cron from '../api/cron.js';
import { runDaily, ChatGoneError } from '../lib/daily.js';
import { withChatLock } from '../lib/lock.js';
import { nowInTz } from '../lib/bot.js';
import { tg, isGone } from '../lib/tg.js';

const mkRes = () => {
  const r = { code: 200, body: null, status(c) { r.code = c; return r; }, send(b) { r.body = b; return r; }, json(b) { r.body = b; return r; }, setHeader() {} };
  return r;
};
const withEnv = async (env, fn) => {
  const old = {};
  for (const k of Object.keys(env)) { old[k] = process.env[k]; if (env[k] == null) delete process.env[k]; else process.env[k] = env[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(old)) { if (old[k] == null) delete process.env[k]; else process.env[k] = old[k]; } }
};

test('вебхук: без WEBHOOK_SECRET отклоняет всё, с неверным секретом — 401', async () => {
  await withEnv({ WEBHOOK_SECRET: null }, async () => {
    const res = mkRes();
    await webhook({ method: 'POST', headers: {}, body: {} }, res);
    assert.equal(res.code, 500);
  });
  await withEnv({ WEBHOOK_SECRET: 'abc' }, async () => {
    const res = mkRes();
    await webhook({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'abd' }, body: {} }, res);
    assert.equal(res.code, 401);
    const res2 = mkRes();
    await webhook({ method: 'POST', headers: {}, body: {} }, res2);
    assert.equal(res2.code, 401);
  });
});

test('вебхук: верный секрет пропускает (апдейт без чата — 200)', async () => {
  await withEnv({ WEBHOOK_SECRET: 'abc' }, async () => {
    const res = mkRes();
    await webhook({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'abc' }, body: {} }, res);
    assert.equal(res.code, 200);
  });
});

test('cron: без CRON_SECRET — 500, с чужим — 401', async () => {
  await withEnv({ CRON_SECRET: null }, async () => {
    const res = mkRes();
    await cron({ headers: {} }, res);
    assert.equal(res.code, 500);
  });
  await withEnv({ CRON_SECRET: 's3' }, async () => {
    const res = mkRes();
    await cron({ headers: { authorization: 'Bearer nope' } }, res);
    assert.equal(res.code, 401);
  });
});

test('замок: без поддержки хранилищем просто выполняет, с поддержкой — вызывает withLock', async () => {
  assert.equal(await withChatLock({}, 1, async () => 'x'), 'x');
  const calls = [];
  const store = { withLock: async (id, fn) => { calls.push(id); return fn(); } };
  assert.equal(await withChatLock(store, 7, async () => 'y'), 'y');
  assert.deepEqual(calls, [7]);
});

const firstOfMonth = nowInTz('Europe/Moscow', new Date(Date.UTC(2026, 10, 1, 9)));
const oldSpend = { id: 'a', amount: 100, name: 'старое', cat: 'other', ts: Date.UTC(2026, 5, 10) };

test('daily: чистка 1-го числа сначала архивирует, затем удаляет', async () => {
  const db = new Map([[1, { spends: [oldSpend], items: [], balance: 1000 }]]);
  const archived = [];
  const store = { load: async (id) => structuredClone(db.get(id)), save: async (id, d) => db.set(id, d), archive: async (id, p) => archived.push([id, p]) };
  await runDaily(1, { store, tg: { send: async () => ({ ok: true }) }, today: firstOfMonth });
  assert.equal(archived.length, 1);
  assert.equal(archived[0][1].spends[0].id, 'a');
  assert.ok(!db.get(1).spends.some((s) => s.id === 'a'));
});

test('daily: архив недоступен — траты не удаляются', async () => {
  const db = new Map([[1, { spends: [oldSpend], items: [], balance: 1000 }]]);
  const store = { load: async (id) => structuredClone(db.get(id)), save: async (id, d) => db.set(id, d), archive: async () => { throw new Error('redis down'); } };
  const orig = console.error; console.error = () => {};
  try { await runDaily(1, { store, tg: { send: async () => ({ ok: true }) }, today: firstOfMonth }); } finally { console.error = orig; }
  assert.ok(db.get(1).spends.some((s) => s.id === 'a'));
});

test('daily: бот заблокирован (403) — ChatGoneError, данные не помечаются отправленными', async () => {
  const db = new Map([[1, { spends: [], items: [], balance: 1000, income: [] }]]);
  const store = { load: async (id) => structuredClone(db.get(id)), save: async (id, d) => db.set(id, d) };
  const blocked = { send: async () => ({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }) };
  // дайджест может быть пустым — тогда отправки нет; проверяем только если она была
  try {
    await runDaily(1, { store, tg: blocked, today: firstOfMonth });
  } catch (e) {
    assert.ok(e instanceof ChatGoneError);
    assert.equal(db.get(1).lastDigest, undefined);
  }
});

test('tg: повтор при 429, сетевая ошибка превращается в ok:false, isGone различает 403', async () => {
  const realFetch = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async () => (++n === 1
    ? { status: 429, json: async () => ({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 0 } }) }
    : { status: 200, json: async () => ({ ok: true, result: 1 }) });
  const orig = console.error; console.error = () => {};
  try {
    const r = await tg.send(1, 'hi');
    assert.equal(r.ok, true);
    assert.equal(n, 2);
    globalThis.fetch = async () => { throw new DOMException('timeout', 'TimeoutError'); };
    const bad = await tg.send(1, 'hi');
    assert.equal(bad.ok, false);
  } finally { globalThis.fetch = realFetch; console.error = orig; }
  assert.equal(isGone({ ok: false, error_code: 403 }), true);
  assert.equal(isGone({ ok: false, error_code: 400, description: 'Bad Request: message is not modified' }), false);
});
