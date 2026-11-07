// Ежедневный cron Vercel: дайджест и итоги месяца для всех чатов.
// Требует CRON_SECRET в переменных окружения Vercel (Vercel сам шлёт его как Authorization: Bearer).
import { timingSafeEqual } from 'node:crypto';
import { nowInTz } from '../lib/bot.js';
import { runDaily, ChatGoneError } from '../lib/daily.js';
import { store } from '../lib/store.js';
import { tg } from '../lib/tg.js';

const BATCH = 8; // чатов параллельно: быстрее последовательного обхода и мягко для лимитов Telegram

const safeEq = (a, b) => {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('CRON_SECRET не задан — ежедневная рассылка отключена. Добавь переменную в Vercel → Settings → Environment Variables.');
    return res.status(500).send('CRON_SECRET is not configured');
  }
  if (!safeEq(req.headers.authorization, `Bearer ${secret}`)) return res.status(401).send('unauthorized');

  const today = nowInTz(process.env.TZ_NAME || 'Europe/Moscow');
  const inactive = (await store.inactiveChats?.().catch(() => null)) ?? new Set();
  const all = await store.listChats();
  const ids = all.filter((id) => !inactive.has(id));
  const result = { chats: all.length, sent: 0, skipped: inactive.size ? all.length - ids.length : 0, failed: 0, gone: 0 };

  for (let i = 0; i < ids.length; i += BATCH) {
    await Promise.all(ids.slice(i, i + BATCH).map(async (id) => {
      try {
        const r = await runDaily(id, { store, tg, today });
        if (r === 'sent') result.sent++; else result.skipped++;
      } catch (err) {
        if (err instanceof ChatGoneError) {
          result.gone++;
          await store.markInactive?.(id).catch(() => {});
          console.warn('cron: бот недоступен в чате, отключаю рассылку', id, err.message);
        } else {
          result.failed++;
          console.error('cron error', id, err);
        }
      }
    }));
  }
  return res.status(200).json(result);
}
