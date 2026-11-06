// Утренний дайджест, напоминания, итоги месяца и предупреждения о перерасходе.
import { daysInMonth, round2 } from './budget.js';
import { catName } from './cats.js';
import { MONTHS, dateStr, esc, money } from './format.js';
import { computePeriod, fromDn, occurrences } from './period.js';
import { inDays } from './planview.js';

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

export const dateKey = (t) => `${t.y}-${String(t.m + 1).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;

const dnLabel = (n) => {
  const t = fromDn(n);
  return dateStr(t.d, t.m);
};

export function formatDigest(data, today) {
  if (!(data.items ?? []).length) return null;
  const p = computePeriod(data, today);
  const wd = WEEKDAYS[new Date(today.y, today.m, today.d).getDay()];
  const L = [`☀️ <b>Доброе утро!</b> ${wd}, ${dateStr(today.d, today.m)}`, ''];
  const line = (o) => `${o.type === 'income' ? '💚 +' : '🔻 −'}${money(o.amount)} · ${esc(o.name)}`;

  if (p.pending.length) L.push('🔔 <b>Подтверди кнопками ниже</b>', ...p.pending.map((o) => `${line(o)} · ${dnLabel(o.dn)}`), '');

  // События сегодня и завтра
  const upcoming = occurrences(data.items ?? [], p.todayDn, p.todayDn + 1).filter((o) => !data.done?.[o.key] && !p.pending.includes(o));
  const todayEv = upcoming.filter((o) => o.dn === p.todayDn);
  const tomorrowEv = upcoming.filter((o) => o.dn === p.todayDn + 1);
  if (todayEv.length) L.push('📌 <b>Сегодня</b>', ...todayEv.map(line), '');
  if (tomorrowEv.length) L.push('⏰ <b>Завтра</b>', ...tomorrowEv.map(line), '');

  for (const g of p.gaps.filter((x) => x.occ.dn <= p.todayDn + 7)) {
    L.push(`💥 ${dnLabel(g.occ.dn)} не хватит ${money(g.short)} на «${esc(g.occ.name)}»`);
  }

  if (p.pool < 0) {
    L.push(`🚨 До ${p.nextIncome ? dnLabel(p.nextIncome.dn) : 'конца месяца'} не хватает <b>${money(p.shortfall)}</b>`);
  } else {
    L.push(`🎯 <b>Сегодня можно потратить: ${money(p.leftToday)}</b>`);
    L.push(p.nextIncome
      ? `До «${esc(p.nextIncome.name)}» (${dnLabel(p.nextIncome.dn)}, ${inDays(p.nextIncome.dn - p.todayDn)}) всего ${money(p.pool)} — по ${money(p.perDay)} в день`
      : `До конца месяца всего ${money(p.pool)} — по ${money(p.perDay)} в день`);
  }
  // Что уже вычтено из денег на карте — чтобы было видно, что обязательное учтено
  const cuts = [];
  for (const sItem of p.spread.filter((x) => x.reserve >= 10)) cuts.push(`${esc(sItem.name.toLowerCase())} ${money(sItem.reserve)}`);
  for (const o of p.dueList) cuts.push(`${esc(o.name.toLowerCase())} ${money(o.amount)} (${dnLabel(o.dn)})`);
  if (cuts.length) L.push(`<i>Уже вычтено обязательное: ${cuts.join(' · ')}</i>`);
  if (p.transferNow > 0) L.push(`🏠 Переведи в резерв на аренду <b>${money(p.transferNow)}</b>`);
  else if (p.reserveNextPeriod > 0) L.push(`🔒 Не трогай ${money(p.reserveNextPeriod)} — они нужны на следующий период`);
  L.push('', '<i>Отключить утренние сообщения: /digest off</i>');
  return L.join('\n');
}

// Итоги прошлого месяца. prev: { y, m, start, end } — границы по времени (мс).
export function monthSummary(data, prev) {
  const ym = `${prev.y}-${String(prev.m + 1).padStart(2, '0')}`;
  const items = (data.items ?? []).filter((it) => !it.once || it.once === ym);
  const sum = (a) => round2(a.reduce((s, x) => s + x.amount, 0));
  const income = sum(items.filter((i) => i.type === 'income'));
  const bills = sum(items.filter((i) => i.type === 'bill'));
  const spends = (data.spends ?? []).filter((s) => s.ts >= prev.start && s.ts < prev.end);
  if (!spends.length && !income && !bills) return null;

  const spent = sum(spends);
  const byCat = {};
  for (const s of spends) byCat[s.cat ?? 'other'] = round2((byCat[s.cat ?? 'other'] ?? 0) + s.amount);
  const free = round2(income - bills);
  const saved = round2(free - spent);

  const L = [`📊 <b>Итоги: ${MONTHS_NOM[prev.m]} ${prev.y}</b>`, ''];
  L.push(`💰 Доходы: ${money(income)}`);
  L.push(`📌 Обязательные: ${money(bills)}`);
  L.push(`🧾 Потрачено сверх обязательных: <b>${money(spent)}</b>`);
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length) L.push('', '🔝 <b>Больше всего ушло на</b>', ...top.map(([k, v]) => `${catName(k)} — ${money(v)}`));

  L.push('');
  if (income > 0) {
    const hasGoals = (data.goals ?? []).length > 0;
    const verdict = saved >= 0 ? (hasGoals ? '👍 В плюсе — эти деньги можно направить в цели накопления: «отложил 5000 на цель».' : '👍 Остались в плюсе. Заведи цель накопления: «цель 200к к июню отпуск».') : '🔴 Ушли в минус — в этом месяце тратим осторожнее.';
    L.push(`🐷 Осталось в плюсе: <b>${money(saved)}</b>`, verdict);
  }
  return L.join('\n');
}

export function prevMonthBounds(today) {
  const y = today.m === 0 ? today.y - 1 : today.y;
  const m = today.m === 0 ? 11 : today.m - 1;
  const end = today.monthStart ?? new Date(today.y, today.m, 1).getTime();
  return { y, m, end, start: end - daysInMonth(y, m) * 86400000 };
}

// Предупреждения после новой траты: сравниваем период до и после.
export function overspendAlerts(before, after, today) {
  if (!(after.items ?? []).length) return [];
  const a = computePeriod(before, today);
  const b = computePeriod(after, today);
  if (b.spentToday <= a.spentToday) return [];
  const out = [];
  const until = b.nextIncome ? dnLabel(b.nextIncome.dn) : 'конца месяца';
  if (b.pool < 0 && a.pool >= 0) {
    out.push(`🚨 Свободные деньги до ${until} закончились: на обязательные платежи не хватает ${money(b.shortfall)}.`);
  } else if (b.dayBudget > 0 && b.freeToday > b.dayBudget && a.freeToday <= a.dayBudget) {
    out.push(`⚠️ Дневной лимит превышен: сегодня потрачено ${money(b.freeToday)} при лимите ${money(b.dayBudget)}. На остальные дни до ${until} — по ${money(b.perDay)} в день.`);
  }
  return out;
}

export { MONTHS };
