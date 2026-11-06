// Расчёт «до следующего поступления»: период, обязательные платежи в нём, лимит на день.
// Работает с календарными днями (номер дня = дни от 1970-01-01), поэтому легко переходит через границу месяцев.
import { daysInMonth, round2, spreadTarget } from './budget.js';
import { isWorkday, workdaysBetween } from './calendar.js';

const pad = (n) => String(n).padStart(2, '0');
export const dn = (y, m, d) => Math.round(Date.UTC(y, m, d) / 86400000);
export const fromDn = (n) => {
  const t = new Date(n * 86400000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
};
export const dateKey = (n) => {
  const t = fromDn(n);
  return `${t.y}${pad(t.m + 1)}${pad(t.d)}`;
};
const ymKey = (y, m) => `${y}-${pad(m + 1)}`;

export const LOOKBACK = 14;

// Сколько денег на карте сейчас: заданный остаток минус траты, записанные после его установки
export function cardBalance(data) {
  const b = data.balance;
  if (!b) return null;
  const spent = (data.spends ?? []).filter((s) => s.ts >= b.ts).reduce((sum, s) => sum + s.amount, 0);
  return round2(b.amount - spent);
}

// Платежи, которые оплачиваются с отдельного счёта-резерва (аренда, коммуналка, интернет)
export function isReserveBill(it) {
  if (!it || it.type !== 'bill' || it.spread) return false;
  if (it.fromReserve !== undefined) return !!it.fromReserve;
  return /аренд|коммунал|жкх|интернет/i.test(it.name ?? '');
}

// Будние дни в [a, b) по номерам дней (1970-01-01 — четверг)
export const weekdaysBetween = (a, b) => {
  let c = 0;
  for (let n = a; n < b; n++) if ((n + 3) % 7 < 5) c++;
  return c;
};

// Сумма обязательной траты «на цикл»: фиксированная или по формуле «база + ставка за рабочий день»
// (рабочие дни — по производственному календарю, без праздников)
export function spreadAmount(it, c) {
  return it.formula ? round2(it.formula.base + it.formula.daily * workdaysBetween(c.start, c.end)) : it.amount;
} // за сколько дней назад просим подтвердить «пришло/оплачено»

// Все наступления датированных пунктов в интервале [startDn, endDn]
export function occurrences(items, startDn, endDn) {
  const out = [];
  const s = fromDn(startDn);
  const e = fromDn(endDn);
  let y = s.y;
  let m = s.m;
  while (y < e.y || (y === e.y && m <= e.m)) {
    const dim = daysInMonth(y, m);
    const ym = ymKey(y, m);
    for (const it of items) {
      if (it.spread || it.day == null) continue;
      if (it.once && it.once !== ym) continue;
      const n = dn(y, m, Math.min(it.day, dim));
      if (n >= startDn && n <= endDn) {
        out.push({ item: it, dn: n, key: `${it.id}:${dateKey(n)}`, type: it.type, amount: it.amount, name: it.name });
      }
    }
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return out.sort((a, b) => a.dn - b.dn || (a.type === 'income' ? -1 : 1));
}

// «Месяц бюджета» (цикл) — от основного дохода до следующего такого же: например, с 5-го до 5-го.
// День начала цикла: настройка чата или самый ранний день регулярного дохода. Без доходов — календарный месяц.
export function anchorDay(items) {
  const days = items.filter((i) => i.type === 'income' && !i.spread && !i.once && i.day != null).map((i) => i.day);
  return days.length ? Math.min(...days) : null;
}

export function cycleBounds(n, anchor) {
  const t = fromDn(n);
  if (!anchor) return { start: dn(t.y, t.m, 1), end: dn(t.y, t.m + 1, 1) };
  const at = (y, m) => {
    const x = fromDn(dn(y, m, 1));
    return dn(x.y, x.m, Math.min(anchor, daysInMonth(x.y, x.m)));
  };
  const cur = at(t.y, t.m);
  return n >= cur ? { start: cur, end: at(t.y, t.m + 1) } : { start: at(t.y, t.m - 1), end: cur };
}

// Доля обязательных трат «на цикл» на дни [startDn, endDn)
export function spreadShare(items, startDn, endDn, anchor = anchorDay(items)) {
  let sum = 0;
  for (let n = startDn; n < endDn; n++) {
    const c = cycleBounds(n, anchor);
    const t = fromDn(c.start);
    const ym = ymKey(t.y, t.m);
    for (const it of items) {
      if (!it.spread || (it.once && it.once !== ym)) continue;
      if (it.formula) sum += (isWorkday(n) ? it.formula.daily : 0) + (n === c.start ? it.formula.base : 0);
      else sum += spreadAmount(it, c) / (c.end - c.start);
    }
  }
  return round2(sum);
}

// Резерв на аренду. Деньги должны лежать на отдельном счёте к дате платежа. Недостающее закрывают будущие доходы
// до этой даты — с самого позднего (аванс целиком), остальное переводится с ближайшего дохода или прямо сейчас с карты.
export function planReserve(items, reserve, todayDn, horizonDn, done = {}, step = 1000) {
  if (!reserve || typeof reserve.amount !== 'number') return null;
  const occ = occurrences(items, todayDn - LOOKBACK, horizonDn);
  const bills = occ.filter((o) => o.type === 'bill' && isReserveBill(o.item) && !done[o.key]);
  const cap = new Map();
  const fixed = new Map(); // фиксированный взнос в резерв с этого дохода (например, аванс → 16 000)
  for (const o of occ.filter((x) => x.type === 'income' && x.dn > todayDn)) {
    cap.set(o.dn, (cap.get(o.dn) ?? 0) + o.amount);
    if (o.item.toReserve != null) fixed.set(o.dn, (fixed.get(o.dn) ?? 0) + o.item.toReserve);
  }
  const up = (v) => v; // без округления: переводим ровно столько, сколько не хватает
  const alloc = new Map();
  const deadlines = [];
  let cum = 0;
  let covered = 0;
  let shortageNow = 0;
  for (const d of [...new Set(bills.map((o) => o.dn))].sort((a, b) => a - b)) {
    const here = bills.filter((o) => o.dn === d);
    const total = round2(here.reduce((s, o) => s + o.amount, 0));
    cum = round2(cum + total);
    let need = Math.max(0, round2(cum - reserve.amount - covered));
    const fundedBy = [];
    for (const t of [...cap.keys()].filter((x) => x < d).sort((a, b) => b - a)) {
      if (need <= 0) break;
      const room = cap.get(t);
      // фиксированный взнос не больше нужного (с округлением вверх); без него — всё нужное, если доход покрывает, иначе весь доход
      const take = fixed.has(t) ? Math.min(room, fixed.get(t), up(need)) : room >= need ? Math.min(room, up(need)) : room;
      if (take <= 0) continue;
      alloc.set(t, round2((alloc.get(t) ?? 0) + take));
      cap.set(t, round2(cap.get(t) - take));
      fundedBy.push({ dn: t, amount: take });
      need = Math.max(0, round2(need - take));
      covered = round2(covered + take);
    }
    // фиксированных взносов не хватило — добираем остаток из свободной части тех же доходов (до даты платежа)
    for (const t of [...cap.keys()].filter((x) => x < d).sort((a, b) => b - a)) {
      if (need <= 0) break;
      const take = Math.min(cap.get(t), need);
      if (take <= 0) continue;
      alloc.set(t, round2((alloc.get(t) ?? 0) + take));
      cap.set(t, round2(cap.get(t) - take));
      const ex = fundedBy.find((f) => f.dn === t);
      if (ex) ex.amount = round2(ex.amount + take);
      else fundedBy.push({ dn: t, amount: take });
      need = Math.max(0, round2(need - take));
      covered = round2(covered + take);
    }
    shortageNow = round2(shortageNow + need);
    covered = round2(covered + need);
    deadlines.push({ dn: d, bills: here, total, cum, required: Math.max(0, round2(cum - reserve.amount)), fundedBy, now: need });
  }
  const transferNow = shortageNow > 0 ? shortageNow : 0;
  return { have: reserve.amount, deadlines, alloc, shortageNow, transferNow };
}

// Цепочка периодов «от поступления до поступления». Для каждого считаем остаток после своих обязательных
// трат (surplus) и сколько нужно привезти из ПРЕДЫДУЩЕГО периода (need): если в периоде не хватает дохода
// на платежи, недостающее откладывается заранее — а если и предыдущему не хватает, нехватка идёт ещё раньше.
// reservedUntil: дни до этой даты уже зарезервированы целиком (остаток обязательных трат текущего цикла),
// поэтому доли трат на них в периодах не вычитаются повторно
export function buildPeriods(items, fromDn, toDn, anchor = anchorDay(items), rctx = null, reservedUntil = null) {
  const occ = occurrences(items, fromDn, toDn + 45);
  const starts = [...new Set(occ.filter((o) => o.type === 'income' && o.dn >= fromDn && o.dn <= toDn).map((o) => o.dn))];
  const periods = starts.map((start) => {
    const next = occ.find((o) => o.type === 'income' && o.dn > start);
    const end = next ? next.dn : start + 30;
    const inc = occ.filter((o) => o.type === 'income' && o.dn === start);
    const incomeSum = round2(inc.reduce((s, o) => s + o.amount, 0));
    const dues = occ.filter((o) => o.type === 'bill' && o.dn >= start && o.dn < end && !(rctx && isReserveBill(o.item)));
    const dueSum = round2(dues.reduce((s, o) => s + o.amount, 0));
    const share = spreadShare(items, reservedUntil == null ? start : Math.max(start, reservedUntil), end, anchor);
    const toReserve = rctx ? rctx.alloc.get(start) ?? 0 : 0; // сколько с этого дохода уйдёт в резерв на аренду
    const surplus = round2(incomeSum - dueSum - share - toReserve);
    return { start, end, days: Math.max(1, end - start), inc, incomeSum, dues, dueSum, share, toReserve, surplus };
  });
  let carry = 0; // сколько должно прийти в СЛЕДУЮЩИЙ период из этого
  for (let i = periods.length - 1; i >= 0; i--) {
    periods[i].needNext = carry;
    periods[i].free = round2(periods[i].surplus - carry);
    periods[i].need = Math.max(0, round2(carry - periods[i].surplus)); // нужно привезти из предыдущего периода
    carry = periods[i].need;
  }
  return periods;
}

// today: { y, m, d, ts, dayStart?, monthStart? }
export function computePeriod(data, today) {
  const todayDn = dn(today.y, today.m, today.d);
  const dayStart = today.dayStart ?? new Date(today.y, today.m, today.d).getTime();
  const monthStart = today.monthStart ?? dayStart - (today.d - 1) * 86400000;
  const done = data.done ?? {};
  const bal = data.balance;
  const balDn = bal ? todayDn + Math.floor((bal.ts - dayStart) / 86400000) : null;
  const sum = (arr) => round2(arr.reduce((s, x) => s + x.amount, 0));
  const spends = data.spends ?? [];
  const spendsAfter = (ts) => spends.filter((s) => s.ts >= ts);

  const items = data.items ?? [];
  const occs = occurrences(items, todayDn - 45, todayDn + 75);
  // Событие «учтено», если подтверждено кнопкой или произошло не позже даты, когда задан остаток на руках
  const reserveOn = !!data.reserve && typeof data.reserve.amount === 'number';
  // Платежи из резерва закрываются только кнопкой «Оплачено»: остаток на карте их не затрагивает
  const settled = (o) => !!done[o.key] || (balDn !== null && o.dn <= balDn && !(reserveOn && isReserveBill(o.item)));

  const pending = occs.filter((o) => o.dn <= todayDn && o.dn >= todayDn - LOOKBACK && !settled(o));
  const futureIncome = occs.find((o) => o.type === 'income' && o.dn > todayDn) ?? null;
  const dim = daysInMonth(today.y, today.m);
  const firstNextDn = dn(today.y, today.m + 1, 1);
  const periodEnd = futureIncome ? futureIncome.dn : firstNextDn; // нет известного дохода — до конца месяца
  const days = Math.max(1, periodEnd - todayDn);

  // Деньги на руках
  let now;
  if (bal) {
    now = bal.amount - sum(spendsAfter(bal.ts));
  } else {
    // Считаем по моменту подтверждения (как и траты), а не по дате события:
    // зарплата 31-го, подтверждённая 3-го, должна попасть в баланс нового месяца
    const acc = occs
      .filter((o) => done[o.key] && !done[o.key].skipped && done[o.key].ts >= monthStart)
      .reduce((s, o) => s + (o.type === 'income' ? o.amount : -o.amount), 0);
    now = acc - sum(spendsAfter(monthStart));
  }
  now = round2(now);

  // Обязательные платежи с датой, которые нужно оплатить до следующего поступления
  const dueList = occs.filter((o) => o.type === 'bill' && !settled(o) && o.dn >= todayDn - LOOKBACK && o.dn < periodEnd && !(reserveOn && isReserveBill(o.item)));
  const dueSum = sum(dueList);
  let run = now;
  const gaps = [];
  for (const o of dueList) {
    run = round2(run - o.amount);
    if (run < 0) gaps.push({ occ: o, short: round2(-run) });
  }

  // Обязательные траты «на цикл» (транспорт и т.п.): сумма задана на период между основными доходами,
  // например с 5-го до 5-го — а не на календарный месяц. Резерв = остаток суммы на оставшиеся дни цикла.
  const anchor = data.settings?.cycleAnchor ?? anchorDay(items);
  const cyc = cycleBounds(todayDn, anchor);
  const cycStart = fromDn(cyc.start);
  const ymCyc = ymKey(cycStart.y, cycStart.m);
  const cycleSpends = spendsAfter(dayStart - (todayDn - cyc.start) * 86400000);
  const spreadCur = items.filter((i) => i.spread && (!i.once || i.once === ymCyc)).map((i) => ({ ...i, amount: spreadAmount(i, cyc) }));
  const spentBy = spreadCur.map(() => 0);
  for (const s of cycleSpends) {
    const idx = spreadTarget(s, spreadCur);
    if (idx >= 0) spentBy[idx] = round2(spentBy[idx] + s.amount);
  }
  const daysNext = Math.max(0, periodEnd - cyc.end); // период заходит в следующий цикл (бывает, если доходов нет)
  // Под такие траты резервируется весь остаток суммы на цикл, без деления на дни периода
  const spread = spreadCur.map((i, k) => {
    const remaining = Math.max(0, round2(i.amount - spentBy[k]));
    let reserveV = remaining;
    if (i.formula) {
      // Проезд платится в рабочие дни: резервируем ставку за все оставшиеся рабочие дни цикла
      // (сегодняшний — если ещё не потрачено), даже если ранее потрачено больше
      const todaySpent = sum(spendsAfter(dayStart).filter((x) => spreadTarget(x, spreadCur) === k));
      const todayRate = isWorkday(todayDn) ? i.formula.daily : 0;
      reserveV = Math.max(0, round2(i.formula.daily * workdaysBetween(todayDn, cyc.end) - Math.min(todaySpent, todayRate)));
    }
    return { ...i, spent: spentBy[k], remaining, reserve: reserveV };
  });
  const nextReserve = daysNext > 0 ? spreadShare(items, cyc.end, periodEnd, anchor) : 0;
  const reserveTotal = round2(spread.reduce((s, i) => s + i.reserve, 0) + nextReserve);

  // Лимит. Траты, засчитанные в обязательные «в течение месяца», в лимит дня не входят — они уже в резерве
  const todaySpends = spendsAfter(dayStart);
  const freeToday = sum(todaySpends.filter((s) => spreadTarget(s, spreadCur) < 0));
  const spentToday = sum(todaySpends);
  // Если в следующем периоде дохода не хватает на платежи — недостающее откладываем из текущего
  const rplan = reserveOn ? planReserve(items, data.reserve, todayDn, todayDn + 130, done, data.settings?.reserveStep ?? 1000) : null;
  const ahead = futureIncome ? buildPeriods(items, futureIncome.dn, futureIncome.dn + 100, anchor, rplan, cyc.end) : [];
  const transferNow = rplan ? rplan.transferNow : 0; // перевести на резерв с карты прямо сейчас
  const pool0 = round2(now - dueSum - reserveTotal - transferNow); // деньги на карте после обязательного до ближайшего дохода

  // Деньги на жизнь делим ровно на ВСЕ дни цикла, включая периоды после ближайшего дохода, у которых
  // доход целиком уходит на резерв и обязательные платежи (на жизнь там остаётся только остаток зарплаты)
  const inCycle = ahead.filter((p) => p.start < cyc.end);
  const nextPeriod = ahead.find((p) => p.start >= cyc.end) ?? null; // первый период следующего цикла
  const reserveNextPeriod = nextPeriod ? nextPeriod.need : 0; // сколько нужно привезти в следующий цикл
  const futureSurplus = round2(inCycle.reduce((sum, p) => sum + p.surplus, 0));
  const totalDays = days + inCycle.reduce((sum, p) => sum + p.days, 0);
  const total = round2(pool0 + futureSurplus - reserveNextPeriod);
  const t = total / totalDays;
  const pool = total < 0 ? total : round2(Math.min(pool0, t * days));
  const perDay = Math.max(0, round2(t));
  const dayBudget = round2((total + freeToday) / totalDays);
  const leftToday = Math.max(0, round2(dayBudget - freeToday));

  // Траты текущего периода (с последнего поступления)
  const lastIncome = [...occs].reverse().find((o) => o.type === 'income' && o.dn <= todayDn);
  const periodStartDn = lastIncome ? lastIncome.dn : todayDn - (today.d - 1);
  const periodStartTs = dayStart - (todayDn - periodStartDn) * 86400000;
  const periodSpends = spendsAfter(periodStartTs);
  const byCatPeriod = {};
  const byUserPeriod = {};
  for (const s of periodSpends) {
    byCatPeriod[s.cat ?? 'other'] = round2((byCatPeriod[s.cat ?? 'other'] ?? 0) + s.amount);
    if (s.by) byUserPeriod[s.by] = round2((byUserPeriod[s.by] ?? 0) + s.amount);
  }

  return {
    todayDn, days, periodEnd, nextIncome: futureIncome, noIncome: !futureIncome,
    pending, pendingIncomes: pending.filter((o) => o.type === 'income'), pendingBills: pending.filter((o) => o.type === 'bill'),
    now, hasBalance: !!bal, dueList, dueSum, gaps, spread, reserveTotal,
    rplan, transferNow, reserveOn, cycleStart: cyc.start, cycleEnd: cyc.end, anchor, nextReserve, daysNext, curReserve: round2(spread.reduce((s, i) => s + i.reserve, 0)), nextPeriod, reserveNextPeriod, pool0, pool, perDay, perWeek: round2(perDay * 7), dayBudget, leftToday, spentToday, freeToday,
    cycleDays: totalDays, cycleTotal: total,
    shortfall: pool < 0 ? round2(-pool) : 0, shortfall0: pool0 < 0 ? round2(-pool0) : 0,
    periodStartDn, byCatPeriod, byUserPeriod, spentPeriod: sum(periodSpends),
  };
}

// Подтверждение «пришло/оплачено» (или пропуск). Возвращает наступление или null.
export function confirmOccurrence(data, key, today, skipped = false) {
  const todayDn = dn(today.y, today.m, today.d);
  const occ = occurrences(data.items ?? [], todayDn - 45, todayDn + 75).find((o) => o.key === key);
  if (!occ) return null;
  data.done = { ...(data.done ?? {}), [key]: { ts: today.ts, ...(skipped ? { skipped: true } : {}) } };
  // чистим старые отметки, чтобы данные не росли
  for (const k of Object.keys(data.done)) if (data.done[k].ts < today.ts - 120 * 86400000) delete data.done[k];
  const fromReserve = !!data.reserve && isReserveBill(occ.item);
  if (!skipped && fromReserve) {
    data.reserve.amount = round2(data.reserve.amount - occ.amount);
  } else if (!skipped && data.balance) {
    data.balance.amount = round2(data.balance.amount + (occ.type === 'income' ? occ.amount : -occ.amount));
  }
  return occ;
}
