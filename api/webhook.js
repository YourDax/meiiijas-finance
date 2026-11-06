// Вебхук Telegram для Vercel.
import { nowInTz } from '../lib/bot.js';
import { processUpdate } from '../lib/engine.js';
import { store } from '../lib/store.js';
import { tg } from '../lib/tg.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('Finance bot is running 💸');

  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).send('unauthorized');
  }

  const update = req.body ?? {};
  const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
  try {
    const today = nowInTz(process.env.TZ_NAME || 'Europe/Moscow');
    await processUpdate(update, { store, tg, today });
  } catch (err) {
    console.error('webhook error', err);
    if (chatId && update.message) {
      await tg.send(chatId, '😵 Что-то пошло не так, попробуй ещё раз.').catch(() => {});
    }
  }
  // Всегда 200, иначе Telegram будет бесконечно повторять апдейт
  return res.status(200).send('ok');
}
