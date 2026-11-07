// Ежедневная рассылка: итоги прошлого месяца (1-го числа) и утренний дайджест.
import { normalize } from './bot.js';
import { dateKey, formatDigest, monthSummary, prevMonthBounds } from './digest.js';
import { dashMarkup } from './format.js';
import { isGone } from './tg.js';
import { withChatLock } from './lock.js';

// Бот заблокирован/удалён из чата: cron перестаёт сюда писать
export class ChatGoneError extends Error {}

async function sendOrThrow(tg, chatId, text, extra) {
  const res = await tg.send(chatId, text, extra);
  if (isGone(res)) throw new ChatGoneError(res.description);
  return res;
}

export const runDaily = (chatId, deps) => withChatLock(deps.store, chatId, () => runDailyLocked(chatId, deps));

async function runDailyLocked(chatId, { store, tg, today }) {
  const data = normalize(await store.load(chatId));
  const key = dateKey(today);
  if (data.lastDigest === key) return 'skip';

  const ym = `${today.y}-${today.m + 1}`;
  if (today.d === 1 && data.lastSummary !== ym) {
    const prev = prevMonthBounds(today);
    const text = monthSummary(data, prev);
    if (text) await sendOrThrow(tg, chatId, text);
    data.lastSummary = ym;
    // Старое не удаляем безвозвратно: сначала кладём в архив. Не удалось заархивировать — ничего не чистим.
    const keepFrom = `${prev.y}-${String(prev.m + 1).padStart(2, '0')}`;
    const oldSpends = data.spends.filter((s) => s.ts < prev.start);
    const oldItems = data.items.filter((it) => it.once && it.once < keepFrom);
    if (oldSpends.length || oldItems.length) {
      let archived = !store.archive; // хранилище без архива (тесты) — прежнее поведение
      try {
        if (store.archive) { await store.archive(chatId, { at: today.ts, spends: oldSpends, items: oldItems }); archived = true; }
      } catch (e) {
        console.error('archive failed, cleanup skipped', chatId, e);
      }
      if (archived) {
        data.spends = data.spends.filter((s) => s.ts >= prev.start);
        data.items = data.items.filter((it) => !it.once || it.once >= keepFrom);
      }
    }
  }

  if (data.settings.digest !== false) {
    const text = formatDigest(data, today);
    if (text) await sendOrThrow(tg, chatId, text, { reply_markup: dashMarkup(data, today) });
  }
  data.lastDigest = key;
  await store.save(chatId, data);
  return 'sent';
}
