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
};
