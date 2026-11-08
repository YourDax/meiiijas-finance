// «Оплаты и поступления»: список ближайших и недавних обязательных платежей и доходов с отметками.
// Любой платёж можно отметить оплаченным заранее, а ошибочную отметку — снять.
import { computePeriod, fromDn } from './period.js';
import { dateStr, esc, money } from './format.js';

export const PAID_BACK = 14; // сколько дней назад показываем
export const PAID_AHEAD = 21; // сколько дней вперёд показываем
const MAX_ROWS = 24;

// Наступления датированных пунктов в окне вокруг сегодня (без «пополнений», они отменяются отдельно)
export function paidItems(data, today) {
  const p = computePeriod(data, today);
  const topupItems = new Set((data.topups ?? []).map((t) => t.itemId).filter(Boolean));
  const inWindow = p.occs.filter((o) => o.dn >= p.todayDn - PAID_BACK && o.dn <= p.todayDn + PAID_AHEAD && !topupItems.has(o.item.id));
  // Разовый пункт позже окна тоже показываем, чтобы его можно было отметить заранее
  const shown = new Set(inWindow.map((o) => o.item.id));
  const later = [];
  for (const o of p.occs) {
    if (o.dn <= p.todayDn + PAID_AHEAD || shown.has(o.item.id) || topupItems.has(o.item.id)) continue;
    shown.add(o.item.id);
    later.push(o);
  }
  return [...inWindow, ...later].map((o) => ({ occ: o, status: p.statusOf(o), past: o.dn <= p.todayDn }));
}

// Обязательные траты «в течение месяца» текущего цикла: у них нет даты, оплата записывается тратой этой статьи
export function spreadPayments(data, today) {
  const p = computePeriod(data, today);
  const dayStart = today.dayStart ?? new Date(today.y, today.m, today.d).getTime();
  const cycleTs = dayStart - (p.todayDn - p.cycleStart) * 86400000;
  return p.spread.map((s) => {
    const paid = (data.spends ?? []).filter((x) => x.src === 'plan' && x.linkId === s.id && x.ts >= cycleTs).sort((a, b) => b.ts - a.ts)[0];
    return { id: s.id, name: s.name, cat: s.cat, amount: s.amount, spent: s.spent, remaining: s.remaining, planSpendId: paid?.id ?? null };
  });
}

const ICON = { open: '⏳', done: '✅', skipped: '⏭', auto: '✔️' };

export function paidList(data, today) {
  const rows = paidItems(data, today);
  if (!rows.length) return { text: '✅ <b>Оплаты и поступления</b>\n\nБлижайших платежей и доходов нет. Добавь их: /income, /bill или «аренда 25000 1-го».', markup: undefined };
  const label = (o) => { const t = fromDn(o.dn); return dateStr(t.d, t.m); };
  const lines = rows.map(({ occ, status }) => `${ICON[status]} ${label(occ)} · ${esc(occ.name)} — <b>${occ.type === 'income' ? '+' : '−'}${money(occ.amount)}</b>`);
  const kb = [];
  for (const { occ, status, past } of rows) {
    if (kb.length >= MAX_ROWS) break;
    const short = occ.name.slice(0, 16);
    if (status === 'open') {
      // доход «приходит» только когда уже наступил; платёж можно оплатить заранее
      if (occ.type === 'income' && !past) continue;
      const row = [{ text: `${occ.type === 'income' ? '✅ Пришло' : '✅ Оплатил'}: ${short} ${money(occ.amount)}`, callback_data: `cf:${occ.key}:L` }];
      if (past) row.push({ text: '⏭', callback_data: `sk:${occ.key}:L` });
      kb.push(row);
    } else if (status === 'done' || status === 'skipped') {
      kb.push([{ text: `↩️ Снять отметку: ${short}`, callback_data: `uc:${occ.key}:L` }]);
    }
  }
  const text = [
    '✅ <b>Оплаты и поступления</b>',
    '⏳ ждёт отметки · ✅ отмечено · ⏭ не было · ✔️ уже учтено в остатке',
    '',
    ...lines,
    '',
    '<i>Нажми на платёж, чтобы отметить его оплаченным (можно заранее). Ошибся — «Снять отметку» вернёт деньги на место.</i>',
  ].join('\n');
  return { text, markup: kb.length ? { inline_keyboard: kb } : undefined };
}
