// Текстовые графики (без внешних сервисов — данные не уходят третьим лицам).
import { computePlan } from './budget.js';
import { catName } from './cats.js';
import { MONTHS_NOM_LOWER, bar, dateStr, esc, money } from './format.js';

const SPARK = '▁▂▃▄▅▆▇█';

export function formatChart(data, today) {
  const p = computePlan(data, today);
  const monthStart = today.monthStart ?? new Date(today.y, today.m, 1).getTime();
  const spends = (data.spends ?? []).filter((s) => s.ts >= monthStart);
  if (!spends.length) return '📈 Пока нет трат за этот месяц. Напиши, например, «кофе 450».';

  const L = [`📈 <b>Траты: ${MONTHS_NOM_LOWER[today.m]} ${today.y}</b>`, `Всего: <b>${money(p.spentMonth)}</b>`, ''];

  // По категориям
  const cats = Object.entries(p.byCat).sort((a, b) => b[1] - a[1]);
  const max = cats[0][1];
  L.push('🗂 <b>По категориям</b>');
  for (const [k, v] of cats) {
    L.push(`${catName(k)}`);
    L.push(`${bar(v / max, 12)} ${money(v)} · ${Math.round((v / p.spentMonth) * 100)}%`);
  }

  // По дням
  const days = Array(today.d).fill(0);
  for (const s of spends) {
    const i = Math.min(today.d - 1, Math.max(0, Math.floor((s.ts - monthStart) / 86400000)));
    days[i] += s.amount;
  }
  const dmax = Math.max(...days);
  const spark = days.map((v) => (v === 0 ? '·' : SPARK[Math.min(7, Math.floor((v / dmax) * 7))])).join('');
  const peak = days.indexOf(dmax) + 1;
  L.push('', '📆 <b>По дням месяца</b>', `<code>${spark}</code>`, `<i>1-е → ${today.d}-е · пик ${dateStr(peak, today.m)}: ${money(dmax)}</i>`);

  const avg = p.spentMonth / today.d;
  L.push(`<i>В среднем ${money(avg)} в день</i>`);

  return L.join('\n');
}
