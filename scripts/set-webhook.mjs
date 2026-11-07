// Регистрирует вебхук и меню команд. Запуск: npm run set-webhook (переменные из окружения).
import { COMMANDS } from '../lib/commands.js';

const { BOT_TOKEN, WEBHOOK_SECRET, PUBLIC_URL } = process.env;
if (!BOT_TOKEN) {
  console.error('Нужна переменная BOT_TOKEN (и PUBLIC_URL + WEBHOOK_SECRET для регистрации вебхука)');
  process.exit(1);
}
const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

if (PUBLIC_URL) console.log(await api('setWebhook', {
  url: `${PUBLIC_URL.replace(/\/$/, '')}/api/webhook`,
  secret_token: WEBHOOK_SECRET || undefined,
  allowed_updates: ['message', 'callback_query'],
}));
// Кнопка «Бюджет» в меню всех личных чатов с ботом открывает мини-приложение
if (PUBLIC_URL) console.log(await api('setChatMenuButton', {
  menu_button: { type: 'web_app', text: 'Бюджет', web_app: { url: PUBLIC_URL.replace(/\/$/, '') } },
}));
console.log(await api('setMyCommands', { commands: COMMANDS }));
