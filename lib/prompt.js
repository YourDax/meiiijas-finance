// Готовый промт с данными бюджета и списком изменений — для ручной вставки в чат с ИИ.
import { computePlan, everyText } from './budget.js';
import { computePeriod } from './period.js';
import { catName, GROUPS } from './cats.js';
import { goalStatus, ymLabel } from './goals.js';
import { MONTHS, MONTHS_NOM_LOWER } from './format.js';

const CUR = process.env.CURRENCY || '₽';
const n = (v) => `${Math.round(v).toLocaleString('ru-RU').replace(/[  ]/g, ' ')} ${CUR}`;
const fmtDate = (ts, tz) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'short' }).format(new Date(ts));

export function logEvent(data, ts, text) {
  data.log = [...(data.log ?? []), { ts, text }].slice(-200);
}

// Что изменилось с момента sinceTs: записи журнала + новые траты
export function collectChanges(data, sinceTs, tz) {
  const out = [];
  for (const e of data.log ?? []) if (e.ts > sinceTs) out.push(`${fmtDate(e.ts, tz)}: ${e.text}`);
  const sp = (data.spends ?? []).filter((s) => s.ts > sinceTs);
  if (sp.length) {
    const total = sp.reduce((s, x) => s + x.amount, 0);
    out.push(`новые траты: ${sp.length} шт. на ${n(total)}`);
  }
  return out;
}

export function buildPrompt(data, today, { question, tz = 'Europe/Moscow' } = {}) {
  const p = computePlan(data, today);
  const per = computePeriod(data, today);
  const sinceTs = data.lastExport?.ts ?? today.ts - 7 * 86400000;
  const changes = collectChanges(data, sinceTs, tz);
  const ym = `${today.y}-${String(today.m + 1).padStart(2, '0')}`;
  const items = (data.items ?? []).filter((it) => !it.once || it.once === ym);

  const line = (it) => `- ${it.name}: ${n(it.amount)}, ${it.spread ? 'в течение месяца (без конкретной даты)' : it.every ? everyText(it) : `${it.day}-го числа`}${it.once ? ' (разово)' : ''}`;
  const future = (data.items ?? []).filter((it) => it.once && it.once > ym);
  const monthSpends = (data.spends ?? [])
    .filter((s) => s.ts >= (today.monthStart ?? 0))
    .sort((a, b) => b.ts - a.ts);

  const build = (spendLimit) => {
    const S = [];
    S.push('Ты — личный финансовый консультант. Отвечай по-русски, конкретно и с цифрами, без общих советов и воды. Используй только данные ниже, ничего не выдумывай. Если данных не хватает — так и скажи.');
    S.push('');
    S.push('ЗАДАЧА');
    S.push('1. Оцени состояние бюджета на месяц (хорошо / рискованно / плохо) и объясни почему.');
    S.push('2. Назови 3 статьи расходов, где можно сократить траты, и на какую сумму.');
    S.push('3. Если есть кассовые разрывы — предложи, как их закрыть (перенос платежей, откладывание денег заранее).');
    S.push('4. Оцени реалистичность целей накопления и предложи план.');
    S.push('5. Дай план на ближайшую неделю: дневной лимит и что нужно отложить.');
    S.push('6. Задай не более 3 уточняющих вопросов, если они помогут точнее.');
    if (question) S.push(`7. Ответь на мой вопрос: ${question}`);
    S.push('');
    S.push(`ДАННЫЕ НА ${today.d} ${MONTHS[today.m]} ${today.y} (валюта: ${CUR}, в месяце ${p.dim} дн., осталось ${p.daysLeft})`);
    S.push('Доходы (повторяются ежемесячно, если не помечено «разово»):');
    S.push(...(items.filter((i) => i.type === 'income').map(line).concat() || []));
    if (!items.some((i) => i.type === 'income')) S.push('- нет');
    S.push('Обязательные платежи:');
    S.push(...items.filter((i) => i.type === 'bill').map(line));
    if (!items.some((i) => i.type === 'bill')) S.push('- нет');
    if (future.length) {
      S.push('Запланировано на другие месяцы (разово):');
      S.push(...future.map((it) => `- ${it.once}: ${it.type === 'income' ? 'доход' : 'расход'} «${it.name}» ${n(it.amount)}`));
    }
    const tops = (data.topups ?? []).filter((t) => t.ts >= (today.monthStart ?? 0));
    if (tops.length) S.push('Разовые пополнения баланса в этом месяце: ' + tops.map((t) => `${t.name} ${n(t.amount)}`).join('; '));
    S.push('');
    S.push(`Сумма доходов: ${n(p.totalIncome)}; обязательных: ${n(p.totalBills)} (${p.mandatoryShare ?? 0}% дохода); свободно за месяц: ${n(p.free)}`);
    S.push(`Деньги на руках сейчас: ${n(per.now)}${per.hasBalance ? '' : ' (оценка)'}`);
    if (per.nextIncome) {
      S.push(`Следующий доход: «${per.nextIncome.name}» ${n(per.nextIncome.amount)} через ${per.nextIncome.dn - per.todayDn} дн.; до него платежи с датой: ${n(per.dueSum)}${per.dueList.length ? ' (' + per.dueList.map((o) => o.name + ' ' + n(o.amount)).join(', ') + ')' : ''}`);
    } else S.push('Следующий доход не задан (считаю до конца месяца).');
    S.push(`Можно тратить до следующего дохода: ${n(Math.max(0, per.pool))} на ${per.days} дн. → ${n(per.perDay)} в день; сегодня ещё ${n(per.leftToday)}`);
    if (per.reserveTotal > 0) S.push(`Из них зарезервировано на обязательные траты «в течение месяца»: ${n(per.reserveTotal)}`);
    S.push('Цели накопления откладываются с зарплаты по усмотрению (из свободных денег периода не вычитаются); неизрасходованный остаток периода бот предлагает отложить в цель.');
    if (per.gaps.length) {
      S.push('Кассовые разрывы: ' + per.gaps.map((g) => `не хватает ${n(g.short)} на «${g.occ.name}»`).join('; '));
    } else S.push('Кассовых разрывов нет.');
    if (per.pending.length) S.push('Ждут подтверждения (пришло/оплачено): ' + per.pending.map((o) => `${o.name} ${n(o.amount)}`).join('; '));
    S.push('');
    S.push(`Потрачено в этом месяце: ${n(p.spentMonth)} (сегодня ${n(p.spentToday)})`);
    const cats = Object.entries(p.byCat).sort((a, b) => b[1] - a[1]);
    if (cats.length) S.push('По категориям: ' + cats.map(([k, v]) => `${catName(k)} ${n(v)}`).join('; '));
    if (monthSpends.length) {
      S.push(`Последние траты (${Math.min(spendLimit, monthSpends.length)} из ${monthSpends.length}):`);
      for (const s of monthSpends.slice(0, spendLimit)) {
        S.push(`- ${fmtDate(s.ts, tz)} · ${n(s.amount)} · ${s.name || 'без названия'} · ${catName(s.cat)}`);
      }
    }
    S.push('');
    S.push('Цели накопления:');
    if (!(data.goals ?? []).length) S.push('- нет');
    for (const g of data.goals ?? []) {
      const st = goalStatus(g, today);
      S.push(`- ${g.name}: накоплено ${n(g.saved)} из ${n(g.target)} до ${ymLabel(g.deadline)} → нужно ~${n(st.perMonth)} в месяц`);
    }
    S.push('');
    S.push(`ЧТО ИЗМЕНИЛОСЬ С ПРОШЛОГО ЗАПРОСА${data.lastExport ? ` (${fmtDate(data.lastExport.ts, tz)})` : ' (за последние 7 дней)'}`);
    S.push(...(changes.length ? changes.map((c) => `- ${c}`) : ['- изменений нет']));
    S.push('');
    S.push('ФОРМАТ ОТВЕТА: короткие пункты с цифрами, в конце — итог одной строкой и первое действие на сегодня.');
    return S.join('\n');
  };

  // Telegram ограничивает сообщение 4096 символами — сокращаем список трат при необходимости
  let limit = 25;
  let text = build(limit);
  while (text.length > 3500 && limit > 0) {
    limit = Math.max(0, limit - 5);
    text = build(limit);
  }
  return { text, changes, limit };
}

export { MONTHS_NOM_LOWER };
