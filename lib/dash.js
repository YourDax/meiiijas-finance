// Текст закреплённой сводки: план месяца + краткий блок целей.
import { formatPlan, bar, money, esc } from './format.js';
import { goalStatus } from './goals.js';

export function dashText(data, today) {
  const base = formatPlan(data, today);
  const goals = data.goals ?? [];
  if (!goals.length || base.startsWith('Пока пусто')) return base;
  const lines = goals.slice(0, 5).map((g) => {
    const s = goalStatus(g, today);
    const tail = s.done ? '🏆 готово' : `~${money(s.perMonth)}/мес`;
    return `   ${esc(g.name)} ${bar(s.percent / 100, 8)} ${s.percent}% · ${tail}`;
  });
  return `${base}\n\n🎯 <b>Цели</b>\n${lines.join('\n')}`;
}
