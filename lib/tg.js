// Тонкая обёртка над Telegram Bot API.
const call = (method, body) =>
  fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

export const tg = {
  send: (chat_id, text, extra = {}) =>
    call('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }),
  edit: (chat_id, message_id, text, extra = {}) =>
    call('editMessageText', { chat_id, message_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }),
  answer: (callback_query_id, text) => call('answerCallbackQuery', { callback_query_id, text }),
  getFile: (file_id) => call('getFile', { file_id }),
  download: async (file_path) => {
    const res = await fetch(`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file_path}`);
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
