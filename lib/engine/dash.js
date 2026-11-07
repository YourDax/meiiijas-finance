// Живая сводка: отправка, обновление, предупреждения и промт для ИИ.
import { dashMarkup, esc } from '../format.js';
import { overspendAlerts } from '../digest.js';
import { dashText } from '../dash.js';
import { buildPrompt } from '../prompt.js';
import { appUrl } from '../webapp.js';
import { TZ } from './cards.js';

export async function sendAlerts(chatId, before, after, today, tg) {
  const alerts = overspendAlerts(before, after, today);
  if (alerts.length) await tg.send(chatId, alerts.join('\n\n'));
}

// Кнопка мини-приложения — только в личных чатах (id > 0): в беседах Telegram отклоняет web_app-кнопки
export const dashKb = (chatId, data, today) => dashMarkup(data, today, { appUrl: chatId > 0 ? appUrl() : undefined });

export async function refreshDash(chatId, data, today, { store, tg }) {
  if (!data.dash?.mid) return;
  const res = await tg.edit(chatId, data.dash.mid, dashText(data, today), { reply_markup: dashKb(chatId, data, today) });
  if (res && res.ok === false && !/not modified/i.test(res.description ?? '')) {
    data.dash = null; // сообщение удалено — при следующем /plan создадим новое
    await store.save(chatId, data);
  }
}

export async function sendDash(chatId, data, today, { store, tg }) {
  const res = await tg.send(chatId, dashText(data, today), { reply_markup: dashKb(chatId, data, today) });
  const mid = res?.result?.message_id;
  if (mid) {
    data.dash = { mid };
    await store.save(chatId, data);
    await tg.pin(chatId, mid).catch(() => {});
  }
}

// Промт для ручной вставки в чат с ИИ + список изменений с прошлого раза
export async function sendAi(chatId, data, today, { store, tg }, question) {
  const { text, changes } = buildPrompt(data, today, { question, tz: TZ() });
  await tg.send(
    chatId,
    '🤖 <b>Промт для ИИ готов.</b>\nСкопируй блок ниже целиком (нажми на него — Telegram скопирует) и вставь в ChatGPT, Claude или другой чат с ИИ. '
      + `В конце — что изменилось с прошлого раза (${changes.length ? `пунктов: ${changes.length}` : 'изменений нет'}).`,
  );
  await tg.send(chatId, `<pre>${esc(text)}</pre>`);
  data.lastExport = { ts: today.ts };
  await store.save(chatId, data);
}
