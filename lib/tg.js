// Тонкая обёртка над Telegram Bot API: таймаут, повтор при 429, единый формат ошибки.
// Как и раньше, ответ Telegram возвращается как есть ({ ok, result | description }) — сетевые сбои превращаются в { ok: false }.
const TIMEOUT_MS = 10_000;
const MAX_RETRY_WAIT_S = 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, body, attempt = 0) {
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    console.error('tg network error', method, e?.name ?? e);
    return { ok: false, error_code: 0, description: `network: ${e?.name ?? 'error'}` };
  }
  const json = await res.json().catch(() => ({ ok: false, error_code: res.status, description: `bad response ${res.status}` }));
  if (json.ok === false) {
    const wait = json.parameters?.retry_after;
    if (json.error_code === 429 && attempt < 2 && wait != null && wait <= MAX_RETRY_WAIT_S) {
      await sleep(wait * 1000 + 100);
      return call(method, body, attempt + 1);
    }
    // «message is not modified» — штатная ситуация при обновлении сводки
    if (!/not modified/i.test(json.description ?? '')) console.error('tg error', method, json.error_code, json.description);
  }
  return json;
}

// Бот заблокирован пользователем, удалён из беседы или чат не существует
export const isGone = (res) =>
  res?.ok === false && (res.error_code === 403 || (res.error_code === 400 && /chat not found|PEER_ID_INVALID/i.test(res.description ?? '')));

export const tg = {
  send: (chat_id, text, extra = {}) =>
    call('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }),
  edit: (chat_id, message_id, text, extra = {}) =>
    call('editMessageText', { chat_id, message_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }),
  answer: (callback_query_id, text) => call('answerCallbackQuery', { callback_query_id, text }),
  getFile: (file_id) => call('getFile', { file_id }),
  download: async (file_path) => {
    const res = await fetch(`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file_path}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  },
  pin: (chat_id, message_id) => call('pinChatMessage', { chat_id, message_id, disable_notification: true }),
  getMe: () => call('getMe', {}),
  getChat: (chat_id) => call('getChat', { chat_id }),
  getChatMember: (chat_id, user_id) => call('getChatMember', { chat_id, user_id }),
  // Кнопка меню в личном чате, открывающая мини-приложение
  setMenuButton: (chat_id, url, text = 'Бюджет') =>
    call('setChatMenuButton', { chat_id, menu_button: { type: 'web_app', text, web_app: { url } } }),
};
