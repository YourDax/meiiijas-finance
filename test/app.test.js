import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyInitData, appUrl } from '../lib/webapp.js';
import { handleApp } from '../lib/appserver.js';
import { processUpdate } from '../lib/engine.js';

const TOKEN = '123456:TEST-TOKEN';
const NOW = new Date(2026, 10, 6, 12).getTime();

// Подписанный initData, как его выдаёт Telegram
function sign(user, { authDate = Math.floor(NOW / 1000), token = TOKEN, extra = {} } = {}) {
  const p = new URLSearchParams({ auth_date: String(authDate), query_id: 'AAH', user: JSON.stringify(user), ...extra });
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return p.toString();
}

const ME = { id: 42, first_name: 'Лео' };

function harness({ members = {} } = {}) {
  const db = new Map();
  const sent = [];
  const store = {
    load: async (id) => structuredClone(db.get(id) ?? null),
    save: async (id, d) => { db.set(id, structuredClone(d)); },
    userChats: async () => [-100],
  };
  const tg = {
    send: async (chat, text, extra) => { sent.push({ chat, text, extra }); return { ok: true }; },
    edit: async () => ({ ok: true }),
    getChatMember: async (chat) => ({ ok: !!members[chat], result: { status: members[chat] ? 'member' : 'left' } }),
    getChat: async (id) => ({ ok: true, result: { title: 'Семья', type: 'group', id } }),
  };
  const call = (action, payload = {}, extra = {}) => handleApp(
    { initData: sign(ME), action, payload, ...extra },
    { store, tg, now: NOW, env: { BOT_TOKEN: TOKEN, TZ_NAME: 'Europe/Moscow' } },
  );
  return { db, sent, call, store, tg };
}

test('initData: верная подпись принимается, подделка и устаревшие данные — нет', () => {
  const ok = verifyInitData(sign(ME), TOKEN, { now: NOW });
  assert.equal(ok.user.id, 42);
  assert.equal(verifyInitData(sign(ME, { token: 'другой' }), TOKEN, { now: NOW }), null, 'чужой токен');
  assert.equal(verifyInitData(sign(ME).replace('%D0%9B', 'X'), TOKEN, { now: NOW }), null, 'изменённые данные');
  assert.equal(verifyInitData(sign(ME, { authDate: Math.floor(NOW / 1000) - 3 * 86400 }), TOKEN, { now: NOW }), null, 'старше суток');
  assert.equal(verifyInitData('', TOKEN), null);
  assert.equal(verifyInitData(sign(ME), '', { now: NOW }), null, 'без токена бота');
});

test('appUrl берёт адрес из окружения', () => {
  assert.equal(appUrl({ APP_URL: 'https://a.example/' }), 'https://a.example');
  assert.equal(appUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' }), 'https://x.vercel.app');
  assert.match(appUrl({}), /^https:\/\//);
});

test('API без подписи отвечает 401 и ничего не отдаёт', async () => {
  const h = harness();
  const r = await handleApp({ initData: 'user=%7B%7D&hash=' + '0'.repeat(64), action: 'state' }, { store: h.store, tg: h.tg, now: NOW, env: { BOT_TOKEN: TOKEN } });
  assert.equal(r.status, 401);
  assert.equal(r.json.state, undefined);
});

test('чужая беседа недоступна, своя — доступна', async () => {
  const closed = harness();
  assert.equal((await closed.call('state', {}, { chatId: -100 })).status, 403);
  const open = harness({ members: { '-100': true } });
  const r = await open.call('state', {}, { chatId: -100 });
  assert.equal(r.status, 200);
  assert.equal(r.json.chatId, -100);
  assert.equal((await open.call('state', {}, { chatId: 777 })).status, 403, 'положительный id — не беседа');
});

test('список бюджетов: личный и беседы, где пользователь состоит', async () => {
  const h = harness({ members: { '-100': true } });
  const r = await h.call('chats');
  assert.deepEqual(r.json.chats.map((c) => c.id), [42, -100]);
  assert.equal(r.json.chats[1].title, 'Семья');
  const none = await harness().call('chats');
  assert.deepEqual(none.json.chats.map((c) => c.id), [42]);
});

test('трата, отмена, остаток и пополнение меняют состояние', async () => {
  const h = harness();
  await h.call('balance_set', { amount: 10000 });
  let r = await h.call('spend_add', { amount: 450, name: 'Кофе' });
  assert.equal(r.status, 200);
  assert.equal(r.json.state.spends[0].name, 'Кофе');
  assert.equal(r.json.state.spends[0].cat, 'cafe');
  assert.equal(r.json.state.spends[0].by, 'Лео');
  assert.equal(r.json.state.cardBalance, 9550);
  r = await h.call('topup', { amount: 5000, name: 'Подарок' });
  assert.equal(r.json.state.balance.amount, 15000);
  r = await h.call('topup_undo', { id: r.json.result.id });
  assert.equal(r.json.state.balance.amount, 10000);
  r = await h.call('spend_undo');
  assert.equal(r.json.state.spends.length, 0);
  assert.equal((await h.call('spend_undo')).status, 400, 'нечего отменять');
});

test('валидация: отрицательные суммы, пустые названия и неверные даты отклоняются', async () => {
  const h = harness();
  assert.equal((await h.call('spend_add', { amount: -5, name: 'x' })).status, 400);
  assert.equal((await h.call('spend_add', { amount: 'abc' })).status, 400);
  assert.equal((await h.call('item_add', { type: 'bill', amount: 100, name: '', day: 5 })).status, 400);
  assert.equal((await h.call('item_add', { type: 'bill', amount: 100, name: 'A', day: 40 })).status, 400);
  assert.equal((await h.call('item_add', { type: 'income', amount: 100, name: 'A', spread: true })).status, 400, 'доходу нужна дата');
  assert.equal((await h.call('goal_add', { name: 'X', target: 100, deadline: '2027-13' })).status, 400);
  assert.equal((await h.call('nope')).status, 400, 'неизвестное действие');
  assert.equal((await h.call('reset')).status, 400, 'сброс без подтверждения');
});

test('доходы и платежи: добавить, изменить, подтвердить «пришло», удалить', async () => {
  const h = harness();
  await h.call('balance_set', { amount: 30000 });
  let r = await h.call('item_add', { type: 'income', amount: 60000, name: 'Зарплата', day: 5 });
  const id = r.json.state.items[0].id;
  await h.call('item_add', { type: 'bill', amount: 6000, name: 'Транспорт', spread: true });
  r = await h.call('edit', { id, field: 'amount', value: '70к' });
  assert.equal(r.json.state.items.find((i) => i.id === id).amount, 70000);
  assert.equal((await h.call('edit', { id, field: 'amount', value: 'много' })).status, 400);
  await h.call('edit', { id, field: 'name', value: 'Оклад' });

  // сегодня 6-е: зарплата 5-го уже наступила и ждёт подтверждения
  // (остаток задан раньше, поэтому проставим его до даты события)
  await h.db.set(42, { ...h.db.get(42), balance: { amount: 30000, ts: NOW - 5 * 86400000 } });
  const pending = (await h.call('state')).json.state.period.pending;
  assert.equal(pending.length, 1);
  r = await h.call('occ', { key: pending[0].key });
  assert.equal(r.json.state.balance.amount, 100000);
  assert.equal(r.json.state.period.pending.length, 0);
  assert.equal((await h.call('occ', { key: pending[0].key })).status, 400, 'повторное нажатие не двоит');

  r = await h.call('delete', { id });
  assert.equal(r.json.state.items.length, 1);
  assert.equal((await h.call('delete', { id })).status, 400);
});

test('«Не было» пропускает событие без изменения остатка', async () => {
  const h = harness();
  await h.call('balance_set', { amount: 1000 });
  await h.call('item_add', { type: 'income', amount: 5000, name: 'Аванс', day: 3 });
  await h.db.set(42, { ...h.db.get(42), balance: { amount: 1000, ts: NOW - 5 * 86400000 } });
  const key = (await h.call('state')).json.state.period.pending[0].key;
  const r = await h.call('occ', { key, skip: true });
  assert.equal(r.json.state.balance.amount, 1000);
  assert.equal(r.json.state.period.pending.length, 0);
});

test('цели: создать, отложить, удалить; отложенное вычитается из остатка', async () => {
  const h = harness();
  await h.call('balance_set', { amount: 50000 });
  let r = await h.call('goal_add', { name: 'Отпуск', target: 100000, deadline: '2027-06' });
  const id = r.json.state.goals[0].id;
  assert.equal(r.json.state.goals[0].status.remaining, 100000);
  r = await h.call('goal_save', { id, amount: 12000 });
  assert.equal(r.json.state.goals[0].saved, 12000);
  assert.equal(r.json.state.balance.amount, 38000);
  r = await h.call('goal_delete', { id });
  assert.equal(r.json.state.goals.length, 0);
});

test('резерв: задать, пополнить, отключить; транспорт, цикл и дайджест', async () => {
  const h = harness();
  await h.call('balance_set', { amount: 90000 });
  let r = await h.call('reserve_set', { amount: 46000 });
  assert.equal(r.json.result.askSubtract, true, 'раньше /balance мог включать резерв');
  r = await h.call('reserve_subtract', { amount: 46000 });
  assert.equal(r.json.state.balance.amount, 44000);
  r = await h.call('reserve_deposit', { amount: 30000 });
  assert.equal(r.json.state.reserve.amount, 76000);
  await h.call('reserve_contract', { number: '8861' });
  r = await h.call('reserve_step', { amount: 500 });
  assert.equal(r.json.state.settings.reserveStep, 500);
  r = await h.call('transport', { base: 3500, daily: 180 });
  assert.ok(r.json.state.items.some((i) => /транспорт/i.test(i.name) && i.spread));
  r = await h.call('cycle', { day: 5 });
  assert.equal(r.json.state.settings.cycleAnchor, 5);
  r = await h.call('cycle', { day: 'auto' });
  assert.equal(r.json.state.settings.cycleAnchor, undefined);
  r = await h.call('digest', { on: false });
  assert.equal(r.json.state.settings.digest, false);
  r = await h.call('reserve_off');
  assert.equal(r.json.state.reserve, null);
});

test('категория и привязка траты к обязательной статье', async () => {
  const h = harness();
  await h.call('item_add', { type: 'bill', amount: 6000, name: 'Транспорт', spread: true });
  const sid = (await h.call('spend_add', { amount: 300, name: 'что-то' })).json.result.id;
  let r = await h.call('edit_cat', { id: sid, cat: 'transport' });
  assert.equal(r.json.state.spends[0].cat, 'transport');
  assert.equal((await h.call('edit_cat', { id: sid, cat: 'нет такой' })).status, 400);
  const linkId = r.json.state.items.find((i) => i.spread).id;
  r = await h.call('edit_link', { id: sid, link: linkId });
  assert.equal(r.json.state.spends[0].linkId, linkId);
  r = await h.call('edit_link', { id: sid, link: 'auto' });
  assert.equal(r.json.state.spends[0].linkId, undefined);
  assert.equal((await h.call('edit_link', { id: sid, link: 'bogus' })).status, 400);
});

test('оплата платежа из резерва переключается', async () => {
  const h = harness();
  let r = await h.call('item_add', { type: 'bill', amount: 25000, name: 'Аренда', day: 1 });
  const id = r.json.state.items[0].id;
  assert.equal(r.json.state.items[0].fromReserve, true, 'аренда по умолчанию из резерва');
  r = await h.call('toggle_reserve', { id });
  assert.equal(r.json.state.items[0].fromReserve, false);
});

test('текст как в чате: траты — сразу, доходы — на подтверждение', async () => {
  const h = harness();
  let r = await h.call('nl', { text: 'кофе 450' });
  assert.match(r.json.result.done, /450/);
  assert.equal(r.json.state.spends.length, 1);
  r = await h.call('nl', { text: 'аванс 80к 5 числа' });
  assert.equal(r.json.result.confirm.kind, 'income');
  assert.equal(r.json.state.items.length, 0, 'до подтверждения ничего не записано');
  r = await h.call('nl_commit', { confirm: r.json.result.confirm });
  assert.equal(r.json.state.items[0].amount, 80000);
  assert.equal(r.json.state.items[0].day, 5);
  r = await h.call('nl', { text: 'цель 200к к июню отпуск' });
  assert.equal(r.json.result.confirm.kind, 'goal');
  r = await h.call('nl_commit', { confirm: r.json.result.confirm });
  assert.equal(r.json.state.goals[0].target, 200000);
  assert.equal((await h.call('nl_commit', { confirm: { kind: 'bill', amount: -1, name: 'x', day: 3 } })).status, 400, 'подтверждение проверяется заново');
});

test('консоль команд бота и экраны', async () => {
  const h = harness();
  let r = await h.call('command', { text: '/balance 12000' });
  assert.equal(r.json.state.balance.amount, 12000);
  r = await h.call('command', { text: '/plan' });
  assert.ok(r.json.result.reply.length > 20);
  assert.equal((await h.call('command', { text: 'просто слова' })).status, 400);
  for (const name of ['plan', 'forecast', 'chart', 'guide', 'reserve', 'digest', 'goals', 'list', 'help', 'dash', 'ai']) {
    const v = await h.call('view', { name, k: 2, question: 'стоит ли?' });
    assert.equal(v.status, 200, name);
    assert.equal(typeof v.json.html, 'string', name);
  }
  assert.equal((await h.call('view', { name: 'unknown' })).status, 400);
});

test('сброс данных очищает бюджет', async () => {
  const h = harness();
  await h.call('spend_add', { amount: 10, name: 'a' });
  const r = await h.call('reset', { confirm: true });
  assert.equal(r.json.state.spends.length, 0);
});

test('импорт выписки: большой файл отклоняется, не-выписка даёт понятную ошибку', async () => {
  const h = harness();
  assert.equal((await h.call('import_parse', { pdf: 'A'.repeat(3_400_001) })).status, 413);
  const d = await handleApp({ initData: sign(ME), action: 'import_parse', payload: { pdf: Buffer.from('x').toString('base64') } }, {
    store: h.store, tg: h.tg, now: NOW, env: { BOT_TOKEN: TOKEN }, pdfText: async () => 'Справка о движении средств',
  });
  assert.equal(d.status, 400);
  assert.equal((await h.call('import_apply', { id: 'нет' })).status, 400);
});

test('приложение обновляет закреплённую сводку в чате', async () => {
  const h = harness();
  const edits = [];
  h.tg.edit = async (...a) => { edits.push(a); return { ok: true }; };
  await h.store.save(42, { dash: { mid: 77 }, balance: { amount: 1000, ts: NOW - 86400000 } });
  await h.call('spend_add', { amount: 100, name: 'Кофе' });
  assert.equal(edits.length, 1, 'сводка в чате пересчитана');
  assert.equal(edits[0][1], 77);
});

test('бот: /app в личном чате даёт кнопку, в беседе объясняет; беседы запоминаются', async () => {
  const sent = [];
  const menu = [];
  const tracked = [];
  const deps = {
    store: { load: async () => null, save: async () => {}, addUserChat: async (u, c) => tracked.push([u, c]) },
    tg: {
      send: async (chat, text, extra) => { sent.push({ chat, text, extra }); return { ok: true }; },
      edit: async () => ({ ok: true }), answer: async () => ({}), pin: async () => ({}),
      setMenuButton: async (chat, url) => { menu.push([chat, url]); },
      getMe: async () => ({ result: { username: 'finbot' } }),
    },
    today: { y: 2026, m: 10, d: 6, ts: NOW, dayStart: new Date(2026, 10, 6).getTime(), monthStart: new Date(2026, 10, 1).getTime() },
  };
  await processUpdate({ message: { text: '/app', chat: { id: 42, type: 'private' }, from: ME } }, deps);
  assert.equal(sent[0].extra.reply_markup.inline_keyboard[0][0].web_app.url.startsWith('https://'), true);
  assert.equal(menu[0][0], 42);
  await processUpdate({ message: { text: '/app@finbot', chat: { id: -100, type: 'supergroup' }, from: ME } }, deps);
  assert.match(sent[1].text, /@finbot/);
  assert.equal(sent[1].extra, undefined, 'в беседе кнопки web_app недопустимы');
  assert.deepEqual(tracked, [[42, -100]], 'личные чаты не запоминаются, беседы — да');
});
