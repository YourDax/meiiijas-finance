// Ежедневная рассылка: итоги прошлого месяца (1-го числа) и утренний дайджест.
import { normalize } from './bot.js';
import { dateKey, formatDigest, monthSummary, prevMonthBounds } from './digest.js';
import { dashMarkup } from './format.js';

export async function runDaily(chatId, { store, tg, today }) {
  const data = normalize(await store.load(chatId));
  const key = dateKey(today);
  if (data.lastDigest === key) return 'skip';

  const ym = `${today.y}-${today.m + 1}`;
  if (today.d === 1 && data.lastSummary !== ym) {
    const prev = prevMonthBounds(today);
    const text = monthSummary(data, prev);
    if (text) await tg.send(chatId, text);
    data.lastSummary = ym;
    // Храним только то, что нужно: траты за прошлый месяц и позже
    data.spends = data.spends.filter((s) => s.ts >= prev.start);
    data.items = data.items.filter((it) => !it.once || it.once >= `${prev.y}-${String(prev.m + 1).padStart(2, '0')}`);
  }

  if (data.settings.digest !== false) {
    const text = formatDigest(data, today);
    if (text) await tg.send(chatId, text, { reply_markup: dashMarkup(data, today) });
  }
  data.lastDigest = key;
  await store.save(chatId, data);
  return 'sent';
}
