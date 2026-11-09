// Планирование на будущие месяцы: события по датам и бюджет каждого периода «от поступления до поступления».
import { daysInMonth, goalStatus, round2 } from './budget.js';
import { anchorDay, buildPeriods, cycleBounds, dn, fromDn, isReserveBill, occurrences, planReserve, spreadAmount } from './period.js';
import { MONTHS_NOM, dateStr, esc, money } from './format.js';

const ymOfDn = (n) => {
  const t = fromDn(n);
  return `${t.y}-${String(t.m + 1).padStart(2, '0')}`;
};
const label = (n) => {
  const t = fromDn(n);
  return dateStr(t.d, t.m);
};

// k — на сколько месяцев вперёд от текущего (1 = следующий)
export function computeForecast(data, today, k = 1) {
  const total = today.y * 12 + today.m + k;
  const y = Math.floor(total / 12);
  const m = total % 12;
  const ym = `${y}-${String(m + 1).padStart(2, '0')}`;
  const dim = daysInMonth(y, m);
  const monthStart = dn(y, m, 1);
  const monthEnd = monthStart + dim - 1;
  const items = data.items ?? [];

  const occ = occurrences(items, monthStart, monthEnd + 45);
  const inMonth = occ.filter((o) => o.dn <= monthEnd);
  const incomes = inMonth.filter((o) => o.type === 'income');
  const bills = inMonth.filter((o) => o.type === 'bill');
  const anchor = data.settings?.cycleAnchor ?? anchorDay(items);
  const cyc = cycleBounds(monthStart + (anchor ? Math.min(anchor, dim) - 1 : 0), anchor);
  const spread = items.filter((i) => i.spread && (!i.once || i.once === ym)).map((i) => ({ ...i, amount: spreadAmount(i, cyc) }));

  const incomeTotal = round2(incomes.reduce((s, o) => s + o.amount, 0));
  const billsTotal = round2(bills.reduce((s, o) => s + o.amount, 0) + spread.reduce((s, i) => s + i.amount, 0));
  const free = round2(incomeTotal - billsTotal);
  // Периоды: каждое поступление в этом месяце начинает период до следующего; нехватку откладываем из предыдущего
  const todayDn = dn(today.y, today.m, today.d);
  const rctx = data.reserve ? planReserve(items, data.reserve, todayDn, monthEnd + 70, data.done ?? {}, data.settings?.reserveStep) : null;
  const periods = buildPeriods(items, monthStart, monthEnd + 62, anchor, rctx).filter((p) => p.start <= monthEnd);
  // Деньги на жизнь делим ровно на все дни цикла: период, где доход уходит на резерв и обязательное,
  // живёт на остаток предыдущего (иначе в первом периоде получились бы вдвое большие суммы в день)
  const lastP = periods[periods.length - 1];
  let carry = 0;
  periods.forEach((p, i) => {
    const rest = periods.slice(i);
    const restS = round2(carry + rest.reduce((s, q) => s + q.surplus, 0) - (lastP ? lastP.needNext : 0));
    const t = restS / rest.reduce((s, q) => s + q.days, 0);
    const avail = round2(carry + p.surplus);
    const live = Math.min(avail, t * p.days);
    p.live = round2(live);
    p.liveDay = Math.floor(t);
    carry = Math.max(0, round2(avail - live));
  });
  const starts = periods.map((p) => p.start);

  const firstIncome = starts.length ? Math.min(...starts) : null;
  return { y, m, ym, dim, monthStart, monthEnd, incomes, bills, spread, incomeTotal, billsTotal, free, periods, firstIncome, events: [...inMonth].sort((a, b) => a.dn - b.dn) };
}

export function formatForecast(data, today, k = 1) {
  if (!(data.items ?? []).length) {
    return '🗓 Планировать пока нечего: добавь доходы и платежи — «аванс 80к 5 числа», «аренда 25000 1 числа».';
  }
  const f = computeForecast(data, today, k);
  const L = [`🗓 <b>${MONTHS_NOM[f.m]} ${f.y}</b>`];
  L.push(`💰 Доход ${money(f.incomeTotal)} · 📌 Обязательные ${money(f.billsTotal)} · ✨ Остаётся <b>${money(f.free)}</b>`);
  if (f.free < 0) L.push(`🚨 Обязательные траты больше дохода на ${money(-f.free)}`);

  // Что и когда: по датам, мелочь — одной строкой
  L.push('', '<b>Что и когда</b>');
  const toReserve = new Map(f.periods.map((p) => [p.start, p.toReserve]));
  const dated = f.events;
  const reserveBill = (o) => isReserveBill(o.item) && data.reserve;
  const small = dated.filter((o) => o.type === 'bill' && !reserveBill(o));
  const lines = [];
  for (const o of dated) {
    if (o.type === 'income') {
      lines.push([o.dn, `${label(o.dn)} · 💚 ${esc(o.name)} <b>+${money(o.amount)}</b>`]);
      if ((toReserve.get(o.dn) ?? 0) > 0) lines.push([o.dn, `      🏠 в резерв ${money(toReserve.get(o.dn))}`]);
    }
  }
  const byDate = new Map();
  for (const o of dated.filter((x) => x.type === 'bill' && reserveBill(x))) byDate.set(o.dn, [...(byDate.get(o.dn) ?? []), o]);
  for (const [d, list] of byDate) {
    lines.push([d, `${label(d)} · 🏠 ${list.map((o) => esc(o.name)).join(', ')} <b>−${money(list.reduce((s, o) => s + o.amount, 0))}</b> <i>(из резерва)</i>`]);
  }
  const plain = small.length > 3 ? [] : small;
  for (const o of plain) lines.push([o.dn, `${label(o.dn)} · 🔻 ${esc(o.name)} −${money(o.amount)}${o.item.once ? ' · разово' : ''}`]);
  lines.sort((x, y) => x[0] - y[0]);
  L.push(...lines.map((x) => x[1]));
  if (small.length > 3) {
    const sum = round2(small.reduce((s, o) => s + o.amount, 0));
    L.push(`🔻 Мелкие платежи (${small.length}): ${small.map((o) => esc(o.name)).join(', ')} — ${money(sum)}`);
  }
  if (f.spread.length) L.push(`📆 В течение месяца: ${f.spread.map((i) => `${esc(i.name)} ${money(i.amount)}`).join(' · ')}`);

  // Сколько можно тратить на жизнь
  L.push('', '<b>Можно тратить на жизнь</b>');
  if (!f.periods.length) L.push('Доходов в этом месяце нет — добавь: «аванс 80к 5 ноября».');
  for (const p of f.periods) {
    const range = `${label(p.start)} – ${label(p.end - 1)}`;
    L.push(p.live < 0
      ? `• ${range}: не хватает <b>${money(-p.live)}</b>`
      : `• ${range}: <b>${money(p.live)}</b> (≈${money(p.liveDay)} в день)${p.surplus < 0 ? ' <i>— из остатка зарплаты</i>' : ''}`);
  }
  L.push('', '<i>К первому периоду прибавится остаток текущего. Разовое на этот месяц: «ремонт 15000 в ' + ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'][f.m] + '».</i>');
  return L.join('\n');
}

export function forecastMarkup(k) {
  return {
    inline_keyboard: [
      [
        ...(k > 1 ? [{ text: '◀️ Раньше', callback_data: `nx:${k - 1}` }] : []),
        ...(k < 6 ? [{ text: 'Дальше ▶️', callback_data: `nx:${k + 1}` }] : []),
      ],
      [{ text: '📋 Список с разовыми', callback_data: 'lst' }],
    ],
  };
}
