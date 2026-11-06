// Ежедневный cron Vercel: дайджест и итоги месяца для всех чатов.
import { nowInTz } from '../lib/bot.js';
import { runDaily } from '../lib/daily.js';
import { store } from '../lib/store.js';
import { tg } from '../lib/tg.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).send('unauthorized');
  }
  const today = nowInTz(process.env.TZ_NAME || 'Europe/Moscow');
  const ids = await store.listChats();
  const result = { chats: ids.length, sent: 0, skipped: 0, failed: 0 };
  for (const id of ids) {
    try {
      const r = await runDaily(id, { store, tg, today });
      if (r === 'sent') result.sent++; else result.skipped++;
    } catch (err) {
      result.failed++;
      console.error('cron error', id, err);
    }
  }
  return res.status(200).json(result);
}
