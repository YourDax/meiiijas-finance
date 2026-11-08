// Тексты и кнопки карточек подтверждения (доход, платёж, цель, пакет).
import { newId } from '../bot.js';
import { categorize } from '../cats.js';
import { ymOf } from '../budget.js';
import { catName } from '../cats.js';
import { ymLabelShort, esc, money, dateStr } from '../format.js';
import { ymLabel } from '../goals.js';

export const HINTS = {
  inc: '💰 Напиши, например:\n«аванс 80к 5 числа» — каждый месяц\n«премия 20к разово» — один раз',
  bill: '📌 Напиши, например:\n«аренда 25000 1-го числа»\n«интернет 700 15 числа»',
  spend: '🧾 Напиши, например:\n«кофе 450», «такси 300», «продукты 2500»',
  topup: '➕ Напиши, например:\n«пополнил баланс 5000» или «+3000 на карту подарок»',
  withdraw: '➖ Напиши, например:\n«снял 3000» или «снял с карты 5к наличные».\nЭто не трата: на дневной лимит и категории не влияет, только уменьшает баланс.',
};

export const TZ = () => process.env.TZ_NAME || 'Europe/Moscow';

// Когда срабатывает пункт: «каждое 5-е», «в течение месяца», «разово, ноябрь 2026»
export function whenText(p, today) {
  if (p.spread) return '📆 В течение месяца';
  if (p.once) {
    const ym = p.onceYm ?? ymOf(today);
    return ym === ymOf(today)
      ? `1️⃣ Один раз в этом месяце · ${dateStr(p.day, today.m)}`
      : `1️⃣ Один раз · ${p.day}-го, ${ymLabelShort(ym)}`;
  }
  return `🔁 Каждый месяц · ${p.day}-го числа`;
}

export function batchLine(it, today) {
  if (it.kind === 'spend') return `🧾 ${esc(it.name)} — ${money(it.amount)} · ${catName(it.cat)}`;
  const icon = it.kind === 'income' ? '💰' : '📌';
  return `${icon} ${esc(it.name)} — ${money(it.amount)} · ${whenText(it, today)}`;
}

// Пункт для хранения из распознанной записи (карточки или пакета)
export function makeItem(p, by, today) {
  return {
    id: newId(), type: p.kind, amount: p.amount, name: p.name, by,
    ...(p.spread ? { spread: true, day: null, cat: p.cat ?? categorize(p.name) } : { day: p.day }),
    ...(p.once ? { once: p.onceYm ?? ymOf(today) } : {}),
  };
}

export function cardText(p, today) {
  if (p.kind === 'batch') {
    const L = [`📥 Записать ${p.items.length} ${p.items.length === 1 ? 'пункт' : p.items.length < 5 ? 'пункта' : 'пунктов'}?`, ''];
    L.push(...p.items.map((it) => batchLine(it, today)));
    if (p.skipped?.length) L.push('', '⚠️ Не разобрал (проверь и отправь отдельно):', ...p.skipped.map((s) => `• ${esc(s)}`));
    return L.join('\n');
  }
  if (p.kind === 'goal') {
    return `🎯 Создать цель накопления?\n<b>${esc(p.name)}</b> — <b>${money(p.amount)}</b>\nК сроку: ${ymLabel(p.deadline)}`;
  }
  const icon = p.kind === 'income' ? '💰 Записать доход?' : '📌 Записать обязательную трату?';
  const when = whenText(p, today);
  let tip = '';
  if (p.spread) tip = '\n<i>Это сумма на весь месяц (например, транспорт). Если платёж в конкретный день — укажи число: «аренда 25000 1 числа»</i>';
  else if (p.dayAuto && p.kind === 'income' && !p.onceYm) tip = '\n<i>Чтобы повторялось каждый месяц, укажи число: «зарплата 80к 10 числа»</i>';
  else if (p.once && !p.onceYm) tip += '\n<i>Другой месяц: добавь «в ноябре» или «5 декабря»</i>';
  return `${icon}\n<b>${esc(p.name)}</b> — <b>${money(p.amount)}</b>\n${when}${tip}`;
}

export const cardMarkup = (p) => ({
  inline_keyboard: [
    [
      { text: '✅ Записать', callback_data: `ok:${p.id}` },
      { text: '❌ Отмена', callback_data: `no:${p.id}` },
    ],
    ...(p.kind === 'goal' || p.kind === 'batch' || p.spread ? [] : [[{ text: p.once ? '🔁 Сделать ежемесячным' : '1️⃣ Только в этом месяце', callback_data: `tg:${p.id}` }]]),
  ],
});
