// Вебхук Telegram для Vercel.
import { timingSafeEqual } from 'node:crypto';
import { nowInTz } from '../lib/bot.js';
import { processUpdate } from '../lib/engine.js';
import { withChatLock } from '../lib/lock.js';
import { store } from '../lib/store.js';
import { tg } from '../lib/tg.js';

const safeEq = (a, b) => {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('Finance bot is running 💸');

  // Без секрета любой мог бы слать поддельные апдейты от чужого chat.id, поэтому работаем только с ним
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.error('WEBHOOK_SECRET не задан — вебхук отклоняет все запросы.');
    return res.status(500).send('WEBHOOK_SECRET is not configured');
  }
  if (!safeEq(req.headers['x-telegram-bot-api-secret-token'], secret)) {
    return res.status(401).send('unauthorized');
  }

  const update = req.body ?? {};
  const cb = update.callback_query;
  const chatId = update.message?.chat?.id ?? cb?.message?.chat?.id;
  try {
    const today = nowInTz(process.env.TZ_NAME || 'Europe/Moscow');
    const run = () => processUpdate(update, { store, tg, today });
    // Апдейты одного чата идут по очереди: нет потерянных обновлений
    await (chatId != null ? withChatLock(store, chatId, run) : run());
    if (chatId != null) store.markActive?.(chatId).catch(() => {}); // бота снова используют — вернём рассылку
  } catch (err) {
    console.error('webhook error', err);
    // Пользователь не должен остаться без ответа: сообщение — текстом, кнопка — всплывающим уведомлением
    if (cb?.id) await tg.answer(cb.id, '😵 Не получилось, попробуй ещё раз').catch(() => {});
    else if (chatId && update.message) await tg.send(chatId, '😵 Что-то пошло не так, попробуй ещё раз.').catch(() => {});
  }
  // Всегда 200, иначе Telegram будет бесконечно повторять апдейт
  return res.status(200).send('ok');
}
