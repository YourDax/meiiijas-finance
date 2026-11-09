// Итоги месяца: сколько получено, оплачено и потрачено.
import { daysInMonth, round2 } from './budget.js';
import { catName } from './cats.js';
import { MONTHS_NOM, esc, money } from './format.js';
import { dn, occurrences } from './period.js';
import { zonedTs } from './statement.js';

// k — на сколько месяцев назад от текущего (0 = этот месяц)
export function computeMonth(data, today, k = 0, tz = 'Europe/Moscow') {
  const total = today.y * 12 + today.m - k;
  const y = Math.floor(total / 12);
  const m = total % 12;
  const from = zonedTs(y, m + 1, 1, 0, 0, tz);
  const next = total + 1;
  const to = zonedTs(Math.floor(next / 12), (next % 12) + 1, 1, 0, 0, tz);
  const inMonth = (ts) => ts >= from && ts < to;
  const sum = (arr) => round2(arr.reduce((s, x) => s + x.amount, 0));

  const done = data.done ?? {};
  const topupItems = new Set((data.topups ?? []).map((t) => t.itemId).filter(Boolean));
  const marked = occurrences(data.items ?? [], dn(y, m, 1), dn(y, m, daysInMonth(y, m)))
    .filter((o) => done[o.key] && !done[o.key].skipped && !topupItems.has(o.item.id))
    .map((o) => ({ name: o.name, type: o.type, amount: done[o.key].amount ?? o.amount }));
  const topups = (data.topups ?? []).filter((t) => inMonth(t.ts));
  const isDebt = (t) => t.debtId || t.debtNew || /^(Взял в долг|Вернули долг):/.test(t.name ?? '');
  const borrowed = topups.filter((t) => t.amount > 0 && isDebt(t)); // деньги пришли, но это не доход
  const received = [...marked.filter((o) => o.type === 'income'), ...topups.filter((t) => t.amount > 0 && !isDebt(t))];
  const paid = marked.filter((o) => o.type === 'bill');
  const withdrawn = topups.filter((t) => t.amount < 0).map((t) => ({ name: t.name, amount: -t.amount }));
  const spends = (data.spends ?? []).filter((s) => inMonth(s.ts));

  const byCat = {};
  for (const s of spends) byCat[s.cat ?? 'other'] = round2((byCat[s.cat ?? 'other'] ?? 0) + s.amount);
  const income = sum(received);
  const bills = sum(paid);
  const spent = sum(spends);
  const out = sum(withdrawn);
  const debtIn = sum(borrowed);
  return { y, m, received, paid, withdrawn, borrowed, income, bills, spent, out, debtIn, net: round2(income + debtIn - bills - spent - out), byCat };
}

export function formatMonth(data, today, k = 0, tz = 'Europe/Moscow') {
  const r = computeMonth(data, today, k, tz);
  const L = [`📊 <b>${MONTHS_NOM[r.m]} ${r.y}</b>`, ''];
  const rows = (list) => list.map((x) => `   ${esc(x.name)} — ${money(x.amount)}`);
  L.push(`💰 Получено: <b>${money(r.income)}</b>`, ...rows(r.received), '');
  if (r.debtIn > 0) L.push(`🤝 Долги, деньги пришли (не доход): <b>${money(r.debtIn)}</b>`, ...rows(r.borrowed), '');
  L.push(`📌 Оплачено обязательных: <b>${money(r.bills)}</b>`, ...rows(r.paid), '');
  L.push(`🧾 Траты: <b>${money(r.spent)}</b>`);
  for (const [cat, v] of Object.entries(r.byCat).sort((a, b) => b[1] - a[1])) L.push(`   ${catName(cat)} — ${money(v)}`);
  if (r.out > 0) L.push('', `➖ Списано (не траты): <b>${money(r.out)}</b>`, ...rows(r.withdrawn));
  L.push('', `${r.net >= 0 ? '✨ Осталось' : '🔻 Ушло больше, чем пришло, на'}: <b>${money(Math.abs(r.net))}</b>`);
  L.push('', '<i>Считаются доходы и платежи, отмеченные кнопками, и записанные траты. Старые траты бот убирает в архив, поэтому давние месяцы могут быть неполными.</i>');
  return L.join('\n');
}
