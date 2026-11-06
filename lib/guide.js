// /guide — что нужно внести в бота и что можно делать.
import { computePlan, ymOf } from './budget.js';
import { cardBalance } from './period.js';
import { money } from './format.js';

export function formatGuide(data, today) {
  const ym = ymOf(today);
  const items = (data.items ?? []).filter((it) => !it.once || it.once === ym);
  const incomes = items.filter((i) => i.type === 'income');
  const bills = items.filter((i) => i.type === 'bill');
  const monthStart = today.monthStart ?? 0;
  const spends = (data.spends ?? []).filter((s) => s.ts >= monthStart);
  const p = computePlan(data, today);
  const mark = (ok) => (ok ? '✅' : '⬜');

  const steps = [
    { ok: incomes.length > 0, text: `<b>Доходы</b>${incomes.length ? ` — ${incomes.length} шт., ${money(p.totalIncome)}` : ''}`, how: '«аванс 80к 5 числа», «зарплата 90к 20 числа»' },
    { ok: bills.length > 0, text: `<b>Обязательные платежи</b>${bills.length ? ` — ${bills.length} шт., ${money(p.totalBills)}` : ''}`, how: '«аренда 25000 1 числа», «интернет 700 15 числа»; без даты, на весь месяц: «транспорт 6000 в месяц», «продукты 20к в месяц»' },
    { ok: !!data.balance, text: `<b>Деньги на руках сейчас</b>${data.balance ? ` — ${money(cardBalance(data))}` : ''}`, how: '/balance 12000 — главное для лимита до зарплаты; без него остаток считается очень примерно' },
    { ok: spends.length > 0, text: `<b>Ежедневные траты</b>${spends.length ? ` — ${spends.length} шт. за месяц` : ''}`, how: '«кофе 450», «такси 300», «продукты 2500»' },
    { ok: !!data.reserve, text: `<b>Резерв на аренду</b>${data.reserve ? ` — отложено ${money(data.reserve.amount)}` : ''}`, how: '/reserve 46000 — сколько лежит на отдельном счёте под аренду, коммуналку и интернет' },
    { ok: (data.goals ?? []).length > 0, text: '<b>Цели накопления</b> (по желанию)', how: '«цель 200к к июню отпуск»' },
  ];

  const L = ['🧭 <b>Что внести и что можно делать</b>', '', '<b>Что нужно внести</b>'];
  for (const s of steps) {
    L.push(`${mark(s.ok)} ${s.text}`);
    if (!s.ok) L.push(`      ↳ ${s.how}`);
  }

  const next = steps.find((s) => !s.ok);
  L.push('');
  L.push(next ? `👉 <b>Следующий шаг:</b> ${next.how.split(' — ')[0]}` : '🎉 Всё внесено! Дальше просто записывай траты — остальное бот считает сам.');

  L.push('', '<b>Можно сразу списком</b> — одним сообщением, по строке на пункт:');
  L.push('<pre>Обязательные:\nаренда 25000 1\nинтернет 700 15\nкредит 12000 20\nРазовые:\nремонт крана 3500 10\nДоходы:\nаванс 80к 5\nзарплата 90к 20</pre>');
  L.push('Заголовки «Обязательные», «Разовые», «Доходы», «Траты» задают тип для строк под ними — тогда число месяца можно писать просто цифрой. Строка без числа в «Обязательных» — трата на весь месяц (транспорт, продукты). Бот покажет одну карточку, ты подтвердишь ✅.');
  L.push('', '<b>Разовые пункты на другой месяц</b>: добавь месяц — «ремонт 15000 в ноябре», «премия 20к 5 декабря», или заголовок «Разовые на ноябрь:». Они появятся в плане, когда наступит месяц, а пока видны в /list.');
  L.push('<b>Разовое пополнение баланса</b>: «пополнил баланс 5000» или <code>/topup 5000 Подарок</code> — деньги сразу добавятся к остатку на руках (↩️ отменяет).');

  L.push('', '<b>Что можно делать</b>');
  L.push('📊 /plan — закреплённая сводка месяца (обновляется сама)');
  L.push('📈 /chart — графики трат · 🎯 /goals — цели');
  L.push('🤖 /ai — промт с твоими данными для ChatGPT/Claude');
  L.push('📋 /list — список и удаление · ↩️ /undo — отменить трату');
  L.push('☀️ /digest — утренний дайджест вкл/выкл');
  L.push('❓ /help — все команды');
  return L.join('\n');
}
