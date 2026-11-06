// Чистая логика расчёта бюджета на месяц. Без ввода-вывода — легко тестировать.
import { catGroup } from './cats.js';

export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate(); // m: 0..11

export const round2 = (n) => Math.round(n * 100) / 100;

// Расчёт по цели накопления: сколько осталось и сколько откладывать в месяц
export function goalStatus(g, today) {
  const [dy, dm] = g.deadline.split('-').map(Number);
  const monthsLeft = Math.max(1, (dy - today.y) * 12 + (dm - 1 - today.m) + 1);
  const remaining = Math.max(0, round2(g.target - g.saved));
  const overdue = (dy - today.y) * 12 + (dm - 1 - today.m) < 0;
  return {
    monthsLeft, remaining, overdue,
    done: remaining === 0,
    percent: g.target > 0 ? Math.min(100, Math.floor((g.saved / g.target) * 100)) : 0,
    perMonth: Math.ceil(remaining / monthsLeft),
  };
}

export const ymOf =(today) => `${today.y}-${String(today.m + 1).padStart(2, '0')}`;

// В какую обязательную трату «в течение месяца» засчитывается необязательная трата (индекс или -1).
// Сначала явная привязка (linkId, 'none' — не засчитывать), затем совпадение категории.
// Категория «Другое» автоматически не засчитывается: иначе любая неопознанная трата
// (например, «маникюр») попадала бы в любую неопознанную статью («домашнее животное»).
export function spreadTarget(spend, spreadItems) {
  if (spend.linkId) return spreadItems.findIndex((i) => i.id === spend.linkId);
  const cat = spend.cat ?? 'other';
  if (cat === 'other') return -1;
  return spreadItems.findIndex((i) => i.cat === cat);
}

// today: { y, m (0..11), d, ts, dayStart?, monthStart? }
export function computePlan(data, today) {
  const dim = daysInMonth(today.y, today.m);
  const ym = ymOf(today);
  const dayStart = today.dayStart ?? new Date(today.y, today.m, today.d).getTime();
  const monthStart = today.monthStart ?? dayStart - (today.d - 1) * 86400000;

  // Разовые пункты действуют только в своём месяце
  const items = (data.items ?? [])
    .filter((it) => !it.once || it.once === ym)
    .map((it) => ({ ...it, eff: it.spread ? null : Math.min(it.day, dim) }));
  const sum = (arr) => round2(arr.reduce((s, i) => s + i.amount, 0));
  const totalIncome = sum(items.filter((i) => i.type === 'income'));
  const totalBills = sum(items.filter((i) => i.type === 'bill'));

  const bal = data.balance;
  const allSpends = data.spends ?? [];
  const spendsAfter = (ts) => allSpends.filter((s) => s.ts >= ts);
  const monthSpends = spendsAfter(monthStart);
  const spentMonth = sum(monthSpends);
  const spentToday = sum(spendsAfter(dayStart));

  // Разбивка трат месяца
  const byCat = {};
  const byUser = {};
  const groupSpent = { daily: 0, wishes: 0 };
  for (const s of monthSpends) {
    byCat[s.cat ?? 'other'] = round2((byCat[s.cat ?? 'other'] ?? 0) + s.amount);
    if (s.by) byUser[s.by] = round2((byUser[s.by] ?? 0) + s.amount);
    const g = catGroup(s.cat);
    groupSpent[g] = round2(groupSpent[g] + s.amount);
  }

  // Деньги «на сейчас»
  let now;
  if (bal) {
    now = bal.amount - sum(spendsAfter(bal.ts));
  } else {
    const past = items.filter((i) => i.eff !== null && i.eff < today.d);
    now = sum(past.filter((i) => i.type === 'income')) - sum(past.filter((i) => i.type === 'bill')) - spentMonth;
  }
  now = round2(now);

  // Что ещё впереди (сегодняшние события считаем предстоящими)
  const upcoming = items
    .filter((i) => i.eff !== null && i.eff >= today.d)
    .sort((a, b) => a.eff - b.eff || (a.type === 'income' ? -1 : 1));
  const upIncome = sum(upcoming.filter((i) => i.type === 'income'));
  const upBills = sum(upcoming.filter((i) => i.type === 'bill'));

  // Симуляция остатка по событиям + кассовые разрывы
  let run = now;
  let minBal = now;
  const timeline = [];
  const gaps = [];
  for (const ev of upcoming) {
    run = round2(run + (ev.type === 'income' ? ev.amount : -ev.amount));
    if (run < minBal) minBal = run;
    timeline.push({ ...ev, balanceAfter: run });
    if (run < 0 && ev.type === 'bill') gaps.push({ ev, short: round2(-run) });
  }

  // Траты «в течение месяца» (транспорт и т.п.): резерв = сумма минус уже потраченное в той же категории
  // Каждая трата идёт максимум в одну такую статью (см. spreadTarget)
  const spreadItems = items.filter((i) => i.spread);
  const spentBy = spreadItems.map(() => 0);
  for (const s of monthSpends) {
    const idx = spreadTarget(s, spreadItems);
    if (idx >= 0) spentBy[idx] = round2(spentBy[idx] + s.amount);
  }
  const spread = spreadItems.map((i, k) => ({
    ...i, spent: spentBy[k], remaining: Math.max(0, round2(i.amount - spentBy[k])),
  }));
  const reservedSpread = round2(spread.reduce((s, i) => s + i.remaining, 0));

  const endBalance = round2(now + upIncome - upBills - reservedSpread);
  const spendable = endBalance;
  const daysLeft = dim - today.d + 1;
  const perDay = Math.max(0, round2(spendable / daysLeft)); // сколько ещё можно сегодня
  const perWeek = round2(perDay * 7);
  // Дневной лимит на весь день (без обрезки до нуля) — нужен для предупреждений о перерасходе
  const dayBudget = round2((spendable + spentToday) / daysLeft);

  // Свободные деньги месяца. На цели накопления откладывается нужная в месяц сумма,
  // остальное делим на повседневное (75%) и желания (25%)
  const free = round2(totalIncome - totalBills);
  const available = Math.max(0, free); // цели накопления из свободных денег не вычитаются — откладываются с зарплаты по усмотрению
  const split = {
    daily: round2(available * 0.75),
    wishes: round2(available * 0.25),
  };
  const mandatoryShare = totalIncome > 0 ? Math.round((totalBills / totalIncome) * 100) : null;

  return {
    dim, daysLeft, totalIncome, totalBills, free, split, mandatoryShare,
    now, endBalance, available, spendable, perDay, perWeek, dayBudget, spentMonth, spentToday,
    byCat, byUser, groupSpent, spread, reservedSpread,
    timeline, gaps, minBal, hasBalance: !!bal, empty: items.length === 0,
  };
}
