// «Оплаты и поступления»: список ближайших и недавних обязательных платежей и доходов с отметками.
// Любой платёж можно отметить оплаченным заранее, а ошибочную отметку — снять.
import { computePeriod, fromDn, isTransportItem } from './period.js';
import { round2 } from './budget.js';
import { dateStr, esc, money } from './format.js';
import { logEvent } from './prompt.js';

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
  const fact = (o) => ({ ...o, amount: data.done?.[o.key]?.amount ?? o.amount }); // отмечено другой суммой
  return [...inWindow, ...later]
    .filter((o) => !(o.item.every === 'week' && p.statusOf(o) === 'auto')) // прошлые недели, уже вошедшие в остаток, только засоряют список
    .map((o) => ({ occ: fact(o), status: p.statusOf(o), past: o.dn <= p.todayDn }));
}

// Обязательные траты «в течение месяца» текущего цикла: у них нет даты, оплата записывается тратой этой статьи
// Платежи по статье за текущий цикл, новые сверху
function cycleParts(data, today, p, id) {
  const dayStart = today.dayStart ?? new Date(today.y, today.m, today.d).getTime();
  const cycleTs = dayStart - (p.todayDn - p.cycleStart) * 86400000;
  return (data.spends ?? []).filter((x) => x.src === 'plan' && x.linkId === id && x.ts >= cycleTs).sort((a, b) => b.ts - a.ts);
}

// «Не оплачено» у статьи без даты: снимает её платежи только за текущий цикл, сама статья остаётся на следующие месяцы.
// -> { count, sum } | null, если снимать нечего
export function unpaySpread(data, today, id) {
  const p = computePeriod(data, today);
  const row = p.spread.find((s) => s.id === id);
  if (!row) return null;
  const parts = cycleParts(data, today, p, id);
  if (!parts.length) return null;
  const ids = new Set(parts.map((x) => x.id));
  data.spends = data.spends.filter((x) => !ids.has(x.id));
  const sum = round2(parts.reduce((a, x) => a + x.amount, 0));
  logEvent(data, today.ts, `оплата снята: «${row.name}» ${money(sum)}`);
  return { count: parts.length, sum };
}

export function spreadPayments(data, today) {
  const p = computePeriod(data, today);
  return p.spread.map((s) => {
    const parts = cycleParts(data, today, p, s.id);
    return { id: s.id, name: s.name, cat: s.cat, amount: s.amount, spent: s.spent, remaining: s.remaining, planSpendId: parts[0]?.id ?? null, parts: parts.slice(0, 30).map(({ id, amount, ts }) => ({ id, amount, ts })) };
  });
}

export const RIDE_PRICE = 90;
export const RIDE_NAME = 'Поездка';

// Кнопка поездки на главной: статья транспорта текущего цикла, если она есть в плане
export function transportRide(data, today) {
  const s = spreadPayments(data, today).find((s) => isTransportItem({ ...s, spread: true }));
  if (!s) return null;
  const dayStart = today.dayStart ?? new Date(today.y, today.m, today.d).getTime();
  const ridesToday = (data.spends ?? []).filter((x) => x.src === 'plan' && x.linkId === s.id && x.name === RIDE_NAME && x.ts >= dayStart).length;
  return { id: s.id, price: RIDE_PRICE, amount: s.amount, remaining: s.remaining, ridesToday };
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
      const row = [{ text: `${occ.type === 'income' ? '✅ Получено' : '✅ Оплачено'}: ${short} ${money(occ.amount)}`, callback_data: `cf:${occ.key}:L` }];
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
