// Регистрирует вебхук и меню команд. Запуск: npm run set-webhook (переменные из окружения).
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
console.log(await api('setMyCommands', {
  commands: [
    { command: 'guide', description: '🧭 Что внести и что можно делать' },
    { command: 'plan', description: '📊 План месяца' },
    { command: 'income', description: '💰 Добавить доход: сумма день название' },
    { command: 'bill', description: '📌 Обязательная трата: сумма день название' },
    { command: 'balance', description: '💼 Сколько денег сейчас' },
    { command: 'topup', description: '💵 Разовое пополнение баланса' },
    { command: 'spend', description: '🧾 Записать трату' },
    { command: 'reserve', description: '🏠 Резерв на аренду' },
    { command: 'transport', description: '🚌 Транспорт по формуле' },
    { command: 'next', description: '🗓 Планирование на следующий месяц' },
    { command: 'chart', description: '📈 Графики трат' },
    { command: 'goals', description: '🎯 Цели накопления' },
    { command: 'ai', description: '🤖 Промт для ИИ с моими данными' },
    { command: 'list', description: '📋 Все доходы и платежи' },
    { command: 'del', description: '🗑 Удалить пункт по номеру' },
    { command: 'help', description: '❓ Помощь' },
  ],
}));
