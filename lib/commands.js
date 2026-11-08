// Меню команд бота и постоянная клавиатура личного чата — в одном месте для /start и scripts/set-webhook.mjs.
export const COMMANDS = [
  { command: 'plan', description: '📊 Сводка бюджета' },
  { command: 'app', description: '📱 Мини-приложение' },
  { command: 'spend', description: '🧾 Записать трату' },
  { command: 'list', description: '📋 Записи: изменить или удалить' },
  { command: 'guide', description: '🧭 Что внести и что можно делать' },
  { command: 'income', description: '💰 Добавить доход: сумма день название' },
  { command: 'bill', description: '📌 Обязательная трата: сумма день название' },
  { command: 'balance', description: '💼 Сколько денег сейчас' },
  { command: 'paid', description: '✅ Отметить оплаты и поступления' },
  { command: 'topup', description: '💵 Пополнить баланс' },
  { command: 'withdraw', description: '➖ Снять деньги с баланса' },
  { command: 'reserve', description: '🏠 Резерв на аренду' },
  { command: 'transport', description: '🚌 Транспорт по формуле' },
  { command: 'next', description: '🗓 Планирование на следующий месяц' },
  { command: 'chart', description: '📈 Графики трат' },
  { command: 'goals', description: '🎯 Цели накопления' },
  { command: 'ai', description: '🤖 Промт для ИИ с моими данными' },
  { command: 'del', description: '🗑 Удалить пункт по номеру' },
  { command: 'help', description: '❓ Помощь' },
];

export const BTN_SPEND = '🧾 Трата';
export const BTN_PLAN = '📊 Сводка';
export const BTN_APP = '📱 Приложение';
export const BTN_PAID = '✅ Оплаты';

// Нижняя клавиатура личного чата: три самых частых действия под рукой
export const REPLY_KEYBOARD = {
  keyboard: [[{ text: BTN_SPEND }, { text: BTN_PLAN }], [{ text: BTN_PAID }, { text: BTN_APP }]],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: 'Например: кофе 450',
};

// Нажатие кнопки клавиатуры = команда
export const KEY_COMMANDS = { [BTN_PLAN]: '/plan', [BTN_APP]: '/app', [BTN_PAID]: '/paid' };
