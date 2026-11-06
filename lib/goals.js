// Цели накопления: расчёт, поиск, вывод.
import { goalStatus } from './budget.js';

export { goalStatus };
import { MONTHS_NOM_LOWER, bar, esc, money } from './format.js';

export const ymLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS_NOM_LOWER[m - 1]} ${y}`;
};

export function findGoal(data, name) {
  const goals = data.goals ?? [];
  const n = String(name ?? '').trim().toLowerCase();
  if (!n) return goals.length === 1 ? goals[0] : null;
  return goals.find((g) => g.name.toLowerCase().includes(n) || n.includes(g.name.toLowerCase())) ?? null;
}

// Сколько откладывать — рекомендация по сроку цели; из лимита на жизнь она не вычитается
export function formatGoals(data, today) {
  const goals = data.goals ?? [];
  if (!goals.length) {
    return '🎯 Целей пока нет.\nНапиши: «цель 200к к июню отпуск» — посчитаю, сколько откладывать в месяц.';
  }
  const L = ['🎯 <b>Цели накопления</b>', ''];
  let need = 0;
  for (const g of goals) {
    const s = goalStatus(g, today);
    L.push(`${s.done ? '🏆' : '🎯'} <b>${esc(g.name)}</b> — до ${ymLabel(g.deadline)}`);
    L.push(`   ${bar(s.percent / 100)} ${s.percent}% · ${money(g.saved)} из ${money(g.target)}`);
    if (s.done) L.push('   ✅ Цель достигнута!');
    else if (s.overdue) L.push(`   ⏰ Срок прошёл, осталось ${money(s.remaining)}`);
    else {
      L.push(`   📆 нужно откладывать ~<b>${money(s.perMonth)}</b> в месяц (${s.monthsLeft} мес.)`);
      need += s.perMonth;
    }
    L.push('');
  }
  L.push('Добавить в копилку: «отложил 5000 на отпуск».');
  return L.join('\n').trim();
}

export function goalsMarkup(data) {
  const rows = (data.goals ?? []).slice(0, 10).map((g) => [{ text: `🗑 ${g.name.slice(0, 28)}`, callback_data: `gdel:${g.id}` }]);
  return rows.length ? { inline_keyboard: rows } : undefined;
}
