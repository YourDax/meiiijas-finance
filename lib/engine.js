// Обработка апдейтов Telegram: сообщения, фразы, кнопки, живая сводка.
// store: { load(chatId), save(chatId, data) }, tg: см. lib/tg.js — оба подменяются в тестах.
// Реализация разнесена по lib/engine/*.js; здесь только маршрутизация.
import { onCallback } from './engine/callbacks.js';
import { onMessage } from './engine/messages.js';

export { refreshDash } from './engine/dash.js';

export async function processUpdate(update, deps) {
  // Запоминаем, в каких беседах пользователь пользуется ботом: мини-приложение покажет их списком
  const m = update.message ?? update.callback_query?.message;
  const from = update.message?.from ?? update.callback_query?.from;
  if (m?.chat && m.chat.type !== 'private' && from?.id) {
    try { await deps.store.addUserChat?.(from.id, m.chat.id); } catch (e) { console.error('track chat', e); }
  }
  if (update.callback_query) return onCallback(update.callback_query, deps);
  if (update.message) return onMessage(update.message, deps);
}
