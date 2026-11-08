// Красивый вывод с эмодзи (Telegram HTML).
import { computePlan, everyText, ymOf } from './budget.js';
import { computePeriod } from './period.js';
import { CATS, GROUPS, catName } from './cats.js';

const CUR = process.env.CURRENCY || '₽';
export const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export const MONTHS_NOM_LOWER = MONTHS_NOM.map((s) => s.toLowerCase());
export const esc =(s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const money = (n) => `${Math.round(n).toLocaleString('ru-RU').replace(/[  ]/g, ' ')} ${CUR}`;
export const dateStr = (day, m) => `${day} ${MONTHS[m]}`;

export function bar(frac, len = 10) {
  const f = Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0));
  const full = Math.round(f * len);
  return '▓'.repeat(full) + '░'.repeat(len - full);
}

export const ymLabelShort = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS_NOM_LOWER[m - 1]} ${y}`;
};

// Пункты, которые ещё актуальны: регулярные, разовые этого месяца и разовые на будущие месяцы
const isVisible = (it, ym) => !it.once || !ym || it.once >= ym;

const whenLabel = (it, ym) => {
  if (it.spread) return 'в течение месяца';
  if (it.every) return everyText(it);
  if (it.once && ym && it.once > ym) return `${it.day}-го · 1️⃣ ${ymLabelShort(it.once)}`;
  return `${it.day}-го${it.once ? ' · 1️⃣ разово' : ''}`;
};

export function formatList(data, today) {
  const ym = today ? ymOf(today) : null;
  const idx = (data.items ?? []).map((it, i) => ({ it, i })).filter((x) => isVisible(x.it, ym));
  if (!idx.length && !monthSpendsOf(data, today).length) {
    return 'Пока пусто 🫥\nПросто напиши: «аванс 80к 5 числа», «аренда 25000 1-го» или «транспорт 6000 в месяц».';
  }
  const line = (x) => `${x.i + 1}. ${esc(x.it.name)} — <b>${money(x.it.amount)}</b> · ${whenLabel(x.it, ym)}`;
  const byDay = (a, b) => (a.it.day ?? 99) - (b.it.day ?? 99);
  const now = idx.filter((x) => !x.it.once || !ym || x.it.once === ym);
  const later = idx.filter((x) => x.it.once && ym && x.it.once > ym).sort((a, b) => a.it.once.localeCompare(b.it.once));
  const inc = now.filter((x) => x.it.type === 'income').sort(byDay);
  const bil = now.filter((x) => x.it.type === 'bill' && !x.it.spread).sort(byDay);
  const spr = now.filter((x) => x.it.spread);
  const out = [];
  if (inc.length) out.push('💰 <b>Доходы</b>', ...inc.map(line), '');
  if (bil.length) out.push('📌 <b>Обязательные платежи</b>', ...bil.map(line), '');
  if (spr.length) out.push('📆 <b>Обязательные траты в течение месяца</b>', ...spr.map(line), '');
  if (later.length) out.push('🗓 <b>Запланировано на другие месяцы</b>', ...later.map(line), '');
  const sp = monthSpendsOf(data, today);
  if (sp.length) {
    out.push('🧾 <b>Необязательные траты этого месяца</b>');
    out.push(...sp.slice(0, SPEND_LIMIT).map(spendLine));
    if (sp.length > SPEND_LIMIT) out.push(`<i>…и ещё ${sp.length - SPEND_LIMIT}</i>`);
    out.push('');
  }
  out.push('Нажми на пункт, чтобы изменить или удалить его.');
  return out.join('\n');
}

const SPEND_LIMIT = 10;
const monthSpendsOf = (data, today) =>
  (data.spends ?? []).filter((s) => s.ts >= (today?.monthStart ?? 0)).sort((a, b) => b.ts - a.ts);
const spendLine = (s) => {
  const d = new Intl.DateTimeFormat('ru-RU', { timeZone: process.env.TZ_NAME || 'Europe/Moscow', day: 'numeric', month: 'short' }).format(new Date(s.ts));
  return `• ${d} · ${esc(s.name || 'Трата')} — <b>${money(s.amount)}</b> · ${catName(s.cat)}`;
};

export function listMarkup(data, today) {
  const ym = today ? ymOf(today) : null;
  const icon = (it) => (it.type === 'income' ? '💰' : it.spread ? '📆' : '📌');
  const itemRows = (data.items ?? [])
    .filter((it) => isVisible(it, ym))
    .slice(0, 30)
    .map((it) => [{ text: `✏️ ${icon(it)} ${it.name.slice(0, 22)} · ${money(it.amount)}`, callback_data: `ei:${it.id}` }]);
  const spendRows = monthSpendsOf(data, today)
    .slice(0, SPEND_LIMIT)
    .map((s) => [{ text: `✏️ 🧾 ${(s.name || 'Трата').slice(0, 22)} · ${money(s.amount)}`, callback_data: `ei:${s.id}` }]);
  const rows = [...itemRows, ...spendRows];
  return rows.length ? { inline_keyboard: rows } : undefined;
}

// Кнопки под сводкой. Если есть неподтверждённые доходы/платежи — сверху кнопки «Пришло» / «Оплачено».
// Кнопка мини-приложения добавляется только если передан appUrl (в беседах кнопки web_app запрещены Telegram).
export function dashMarkup(data = null, today = null, { appUrl } = {}) {
  const confirmRows = [];
  if (data && today) {
    for (const o of computePeriod(data, today).pending.slice(0, 3)) {
      const label = `${o.type === 'income' ? '✅ Получено' : '✅ Оплачено'}: ${o.name.slice(0, 16)} ${money(o.amount)}`;
      confirmRows.push([
        { text: label, callback_data: `cf:${o.key}` },
        { text: '⏭ Не было', callback_data: `sk:${o.key}` },
      ]);
    }
  }
  return {
    inline_keyboard: [
      ...confirmRows,
      ...(appUrl ? [[{ text: '📱 Открыть приложение', web_app: { url: appUrl } }]] : []),
      [
        { text: '🧾 Трата', callback_data: 'h:spend' },
        { text: '💰 Доход', callback_data: 'h:inc' },
        { text: '📌 Платёж', callback_data: 'h:bill' },
      ],
      [
        { text: '✅ Оплаты', callback_data: 'pd' },
        { text: '➕ Пополнить', callback_data: 'h:topup' },
        { text: '➖ Снять', callback_data: 'h:withdraw' },
      ],
      [
        { text: '📋 Записи', callback_data: 'lst' },
        { text: '📊 Детали', callback_data: 'det' },
        { text: '🗓 Прогноз', callback_data: 'nx:1' },
      ],
      [
        { text: '🎯 Цели', callback_data: 'goals' },
        { text: '📈 Графики', callback_data: 'chart' },
        { text: '🤖 ИИ', callback_data: 'ai' },
        { text: '🔄', callback_data: 'refresh' },
      ],
    ],
  };
}

function formatPlanLegacy(data, today) {
  const p = computePlan(data, today);
  if (p.empty) return formatList(data, today);
  const L = [];
  L.push(`📅 <b>${MONTHS_NOM[today.m]} ${today.y}</b> — финансовый план`);
  L.push(`⏳ ${bar(today.d / p.dim)} день ${today.d} из ${p.dim}`, '');
  L.push(`💰 Доходы: <b>${money(p.totalIncome)}</b>`);
  L.push(`📌 Обязательные траты: <b>${money(p.totalBills)}</b>${p.mandatoryShare !== null ? ` (${p.mandatoryShare}% дохода)` : ''}`);
  L.push(`✨ Свободно за месяц: <b>${money(p.free)}</b>`, '');

  if (p.free < 0) {
    L.push(`🚨 <b>Обязательные траты больше дохода на ${money(-p.free)}!</b> Нужно сокращать или искать доп. доход.`, '');
  } else if (p.mandatoryShare >= 60) {
    L.push('⚠️ Обязательные траты съедают больше 60% дохода — свободных денег немного.', '');
  }

  if (p.spread.length) {
    L.push('📆 <b>В течение месяца</b>');
    for (const s of p.spread) {
      const frac = s.amount ? s.spent / s.amount : 0;
      L.push(`   🔻 ${esc(s.name)} — ${money(s.amount)}: потрачено ${money(s.spent)}, осталось ${money(s.remaining)}${s.spent > s.amount ? ' 🔴' : ''}`);
      if (!s.cat || s.cat === 'other') L.push('   ⚠️ <i>нет категории — траты не засчитываются сами (/list → пункт → 🗂)</i>');
      L.push(`   ${bar(frac)}`);
    }
    L.push('');
  }

  L.push('🗓 <b>Ближайшие события</b>');
  if (!p.timeline.length) L.push('Больше событий в этом месяце нет 🎉');
  for (const ev of p.timeline) {
    const sign = ev.type === 'income' ? '💚 +' : '🔻 −';
    L.push(`${sign}${money(ev.amount)} · ${dateStr(ev.eff, today.m)} · ${esc(ev.name)}  <i>(остаток ${money(ev.balanceAfter)})</i>`);
  }
  L.push('');

  for (const g of p.gaps) {
    L.push(`💥 <b>${dateStr(g.ev.eff, today.m)}</b> не хватит <b>${money(g.short)}</b> на «${esc(g.ev.name)}» — отложи заранее или сдвинь расходы.`);
  }
  if (p.gaps.length) L.push('');

  L.push(`💼 Сейчас на руках: <b>${money(p.now)}</b>${p.hasBalance ? '' : ' <i>(оценка; уточни: /balance сумма)</i>'}`);
  L.push(`🏁 К концу месяца останется: <b>${money(p.endBalance)}</b>`, '');

  L.push('🎯 <b>Можно тратить свободно</b>');
  L.push(`   📍 сегодня ещё: <b>${money(p.perDay)}</b>${p.spentToday > 0 ? ` <i>(уже потрачено ${money(p.spentToday)})</i>` : ''}`);
  L.push(`   🗒 в неделю: <b>${money(p.perWeek)}</b>`);
  L.push(`   <i>осталось дней: ${p.daysLeft}, всего свободно: ${money(Math.max(0, p.spendable))}</i>`, '');

  if (p.free > 0) {
    L.push('🧠 <b>Бюджеты месяца</b>');
    for (const [g, budget] of [['daily', p.split.daily], ['wishes', p.split.wishes]]) {
      const spent = p.groupSpent[g];
      const over = spent > budget;
      L.push(`   ${GROUPS[g]}: ${money(spent)} из ${money(budget)}${over ? ' 🔴' : ''}`);
      L.push(`   ${bar(budget ? spent / budget : 0)}`);
    }
    L.push('');
  }

  const cats = Object.entries(p.byCat).sort((a, b) => b[1] - a[1]);
  if (cats.length) {
    L.push('🧾 <b>Траты месяца</b>');
    for (const [k, v] of cats) L.push(`   ${catName(k)} — ${money(v)}`);
    const users = Object.entries(p.byUser);
    if (users.length > 1) {
      L.push('   👥 ' + users.sort((a, b) => b[1] - a[1]).map(([u, v]) => `${esc(u)} ${money(v)}`).join(' · '));
    }
  }
  return L.join('\n').trim();
}

export function formatHelp() {
  return [
    '👋 <b>Я считаю бюджет месяца для вашей беседы</b>',
    '',
    'Просто пиши обычными фразами:',
    '💰 «аванс 80к 5 числа» — доход (повторяется каждый месяц)',
    '📌 «аренда 25000 1-го» — обязательный платёж',
    '1️⃣ «премия 20к разово» — только в этом месяце; «ремонт 15000 в ноябре» — разово на другой месяц',
    '📆 «транспорт 6000 в месяц» — обязательная трата без даты на весь цикл (от основного дохода до следующего, например с 5-го до 5-го; изменить: /cycle 5)',
    '💵 «пополнил баланс 5000» — разовое пополнение баланса · ➖ «снял 3000» — снять деньги с баланса (не трата)',
    '✅ /paid — отметить платёж оплаченным (можно заранее) или снять отметку',
    '🧾 «кофе 450» — трата, бот сам определит категорию',
    '',
    'Доходы и платежи я переспрошу кнопками ✅/❌, траты записываю сразу (есть ↩️).',
    '📥 Можно списком: несколько строк в одном сообщении, с заголовками «Обязательные:», «Разовые:», «Доходы:». Подробнее и чек-лист, что внести: /guide',
    '',
    '📊 /plan — закреплённая сводка месяца, она обновляется сама',
    '📋 /list — все доходы, обязательные и необязательные траты; нажми на пункт, чтобы изменить сумму, название, срок или категорию либо удалить',
    '💼 /balance 12000 — деньги на руках сейчас. От этого зависит лимит «до следующего дохода», поэтому обновляй после крупных операций',
    '✅ В день дохода или платежа бот спросит кнопкой «Получено» / «Оплачено» — только после этого деньги учитываются. «Не было» пропускает событие',
    '🎯 «цель 200к к июню отпуск» — цель накопления · «отложил 5000 на отпуск» — в копилку · /goals — прогресс',
    '🏠 /reserve 46000 — сколько лежит на счёте под аренду, коммуналку и интернет; /reserve contract 8861 — чтобы переводы на него брались из выписки. С зарплаты бот напомнит, сколько перевести на резерв («перевёл на резерв 30к»)',
    '🚌 /transport 3500 180 — транспорт по формуле: карта + ставка за каждый рабочий день цикла (по производственному календарю)',
    '🗓 /next — планирование на следующий месяц (кнопка под сводкой); /next 2 — через месяц',
    '📈 /chart — графики трат по категориям, дням и людям',
    '🤖 /ai — готовый промт с вашими данными и списком изменений, чтобы вставить в ChatGPT/Claude. Можно с вопросом: <code>/ai стоит ли брать ноутбук за 80к?</code>',
    '📱 /app — мини-приложение: все функции бота в удобном интерфейсе (открывается в личном чате с ботом)',
    '↩️ /undo — отменить трату · ♻️ /reset confirm — стереть всё',
    '☀️ Каждое утро (с 7 до 8) присылаю дайджест: что сегодня и завтра, сколько можно потратить. 1-го числа — итоги прошлого месяца. Отключить: /digest off',
    '',
    'Суммы: <code>15000</code>, <code>15к</code>, <code>1,5к</code>, <code>80 000</code>.',
    'Чтобы бот видел обычные сообщения в беседе, в @BotFather выключи Group Privacy (/setprivacy → Disable) и перезайди ботом в беседу.',
  ].join('\n');
}

export { CATS };

export { formatPlan, formatPlanFull } from './planview.js';
