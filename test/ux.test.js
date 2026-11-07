import test from 'node:test';
import assert from 'node:assert/strict';
import { processUpdate } from '../lib/engine.js';
import { dashMarkup } from '../lib/format.js';

const today = { y: 2026, m: 9, d: 24, ts: new Date(2026, 9, 24, 12).getTime(), monthStart: new Date(2026, 9, 1).getTime() };

function harness(chatId) {
  const db = new Map();
  const sent = [];
  const store = { load: async (id) => db.get(id) ?? null, save: async (id, d) => db.set(id, structuredClone(d)) };
  let mid = 100;
  const tg = {
    send: async (chat, text, extra) => { sent.push({ op: 'send', chat, text, extra }); return { ok: true, result: { message_id: ++mid } }; },
    edit: async (chat, id, text, extra) => { sent.push({ op: 'edit', chat, id, text, extra }); return { ok: true }; },
    answer: async () => ({ ok: true }),
    pin: async () => ({ ok: true }),
  };
  const msg = (text) => ({ message: { chat: { id: chatId, type: chatId > 0 ? 'private' : 'group' }, from: { id: 7, first_name: 'Лео' }, text } });
  const press = (data, m = 101) => ({ callback_query: { id: 'q', data, from: { id: 7, first_name: 'Лео' }, message: { chat: { id: chatId }, message_id: m } } });
  const run = (u) => processUpdate(u, { store, tg, today });
  return { sent, run, msg, press };
}

const buttons = (mk) => mk.inline_keyboard.flat();

test('сводка: кнопка приложения только если передан appUrl', () => {
  assert.equal(buttons(dashMarkup()).some((b) => b.web_app), false);
  const b = buttons(dashMarkup(null, null, { appUrl: 'https://x.test' }));
  assert.equal(b[0].web_app.url, 'https://x.test');
});

test('сводка: есть быстрые кнопки добавления и графики', () => {
  const cbs = buttons(dashMarkup()).map((b) => b.callback_data);
  for (const c of ['h:spend', 'h:inc', 'h:bill', 'lst', 'det', 'nx:1', 'goals', 'chart', 'ai', 'refresh']) assert.ok(cbs.includes(c), c);
});

test('личный чат: в сводке кнопка мини-приложения, в беседе её нет', async () => {
  const priv = harness(5);
  await priv.run(priv.msg('/plan'));
  assert.ok(buttons(priv.sent.at(-1).extra.reply_markup).some((b) => b.web_app));
  const grp = harness(-5);
  await grp.run(grp.msg('/plan'));
  assert.equal(buttons(grp.sent.at(-1).extra.reply_markup).some((b) => b.web_app), false);
});

test('после записи траты можно сразу изменить её', async () => {
  const h = harness(5);
  await h.run(h.msg('кофе 450'));
  const reply = h.sent.find((s) => s.text.startsWith('🧾'));
  const kb = buttons(reply.extra.reply_markup);
  const edit = kb.find((b) => b.callback_data.startsWith('ei:'));
  assert.ok(edit, 'есть «Изменить»');
  assert.ok(kb.some((b) => b.callback_data.startsWith('undo:')), 'осталась «Отменить»');
  await h.run(h.press(edit.callback_data));
  const card = h.sent.at(-1);
  assert.equal(card.op, 'edit');
  assert.ok(buttons(card.extra.reply_markup).some((b) => b.callback_data.startsWith('ec:')), 'в карточке есть смена категории');
});
