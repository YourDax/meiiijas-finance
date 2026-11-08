// Сводка «до следующего дохода» (текст закреплённого сообщения).
import { computePlan } from './budget.js';
import { computePeriod, fromDn } from './period.js';
import { MONTHS_NOM, bar, dateStr, esc, formatList, money } from './format.js';
import { catName } from './cats.js';

const dnLabel = (n) => {
  const t = fromDn(n);
  return dateStr(t.d, t.m);
};

export const inDays = (diff) => (diff <= 0 ? 'сегодня' : diff === 1 ? 'завтра' : `через ${diff} дн.`);

export function formatPlanFull(data, today) {
  if (!(data.items ?? []).length) return formatList(data, today);
  const m = computePlan(data, today); // итоги месяца
  const p = computePeriod(data, today);
  const L = [];

  L.push(`📅 <b>${MONTHS_NOM[today.m]} ${today.y}</b> — план до следующего дохода`);
  L.push(`⏳ ${bar(today.d / m.dim)} день ${today.d} из ${m.dim}`, '');

  if (p.pending.length) {
    L.push('🔔 <b>Ждут подтверждения</b>');
    for (const o of p.pending.slice(0, 5)) {
      L.push(o.type === 'income'
        ? `   💚 ${esc(o.name)} +${money(o.amount)} · ${dnLabel(o.dn)} — нажми «Получено»`
        : `   🔻 ${esc(o.name)} −${money(o.amount)} · ${dnLabel(o.dn)} — нажми «Оплачено»`);
    }
    L.push('');
  }

  L.push(`💼 На руках: <b>${money(p.now)}</b>${p.hasBalance ? '' : ' <i>(оценка; задай точный остаток: /balance сумма)</i>'}`);
  if (p.nextIncome) {
    const n = p.nextIncome;
    L.push(`💚 Следующий доход: ${esc(n.name)} <b>+${money(n.amount)}</b> — ${dnLabel(n.dn)} (${inDays(n.dn - p.todayDn)})`);
  } else {
    L.push('⚠️ Следующий доход не задан — считаю до конца месяца. Добавь: «аванс 80к 5 числа».');
  }
  if (p.pendingIncomes.length) L.push('⏳ <i>Поступление ещё не подтверждено — оно в расчёт не входит.</i>');
  L.push('');

  // Резерв на аренду, коммуналку и интернет
  const rp = p.rplan;
  const reserveBillsInfo = [];
  if (rp) {
    reserveBillsInfo.push(`🏠 <b>Резерв на аренду</b>: отложено <b>${money(rp.have)}</b>`);
    const d1 = rp.deadlines[0];
    if (d1) {
      const names = d1.bills.map((o) => `${esc(o.name)} ${money(o.amount)}`).join(', ');
      reserveBillsInfo.push(`   К ${dnLabel(d1.dn)} нужно <b>${money(d1.cum)}</b> (${names})`);
      if (p.transferNow > 0) {
        const later = d1.fundedBy.map((f) => `${dnLabel(f.dn)} +${money(f.amount)}`).join(', ');
        reserveBillsInfo.push(`   👉 <b>Переведи на резерв сейчас ${money(p.transferNow)}</b>${later ? ` <i>— остальное закроет доход (${later})</i>` : ''}`);
      } else if (d1.fundedBy.length) {
        reserveBillsInfo.push(`   👉 С дохода переведёшь: ${d1.fundedBy.map((f) => `${dnLabel(f.dn)} <b>${money(f.amount)}</b>`).join(', ')}`);
      } else {
        reserveBillsInfo.push('   ✅ Денег в резерве хватает');
      }
    } else {
      reserveBillsInfo.push('   Платежей из резерва впереди нет');
    }
  }

  L.push('📌 <b>До этого нужно оплатить</b>');
  if (!p.dueList.length && !p.spread.some((s) => s.reserve > 0)) L.push('   Платежей до следующего дохода нет 🎉');
  for (const o of p.dueList) L.push(`   🔻 −${money(o.amount)} · ${dnLabel(o.dn)} · ${esc(o.name)}`);
  for (const s of p.spread.filter((x) => x.reserve >= 10)) {
    L.push(`   📆 ${esc(s.name)}: ${money(s.reserve)} <i>(на цикл ${money(s.amount)}${s.spent > 0 ? `, уже потрачено ${money(s.spent)}` : ''})</i>`);
  }
  if (p.nextReserve > 0) {
    L.push(`   📆 Доли обязательных трат на ${p.daysNext} дн. следующего цикла: ${money(p.nextReserve)}`);
  }
  if (p.reserveNextPeriod > 0) {
    const np = p.nextPeriod;
    L.push(`   🔒 Отложить на следующий период (с ${dnLabel(np.start)}): ${money(p.reserveNextPeriod)} <i>— там платежей и трат на ${money(np.dueSum + np.share)}, а доход ${money(np.incomeSum)}</i>`);
  }
  L.push('');

  for (const g of p.gaps) {
    L.push(`💥 <b>${dnLabel(g.occ.dn)}</b> не хватит <b>${money(g.short)}</b> на «${esc(g.occ.name)}» — отложи заранее или сдвинь расходы.`);
  }
  if (p.gaps.length) L.push('');

  if (reserveBillsInfo.length) L.push('', ...reserveBillsInfo, '');

  const until = p.nextIncome ? `до ${dnLabel(p.nextIncome.dn)}` : 'до конца месяца';
  L.push(`🎯 <b>Можно потратить ${until}</b>`);
  if (p.pool < 0) {
    L.push(p.pool0 >= 0
      ? `   🚨 <b>Свободных денег нет:</b> на следующий период нужно отложить ${money(p.reserveNextPeriod)}, а доступно только ${money(p.pool0)}.`
      : `   🚨 <b>Не хватает ${money(p.shortfall0)}</b> — деньги на руках и платежи не сходятся.`);
  } else {
    L.push(`   💰 всего: <b>${money(p.pool)}</b> на ${p.days} ${p.days === 1 ? 'день' : p.days < 5 ? 'дня' : 'дней'}`);
    L.push(`   📍 сегодня ещё: <b>${money(p.leftToday)}</b>${p.freeToday > 0 ? ` <i>(уже потрачено ${money(p.freeToday)})</i>` : ''}`);
    L.push(`   📆 в день: ${money(p.perDay)} · 🗒 в неделю: ${money(p.perWeek)}`);
  }
  // Расчёт одной строкой: куда уходят деньги
  const parts = [`<b>${money(p.now)}</b> на руках`];
  if (p.dueSum > 0) parts.push(`− ${money(p.dueSum)} платежи`);
  if (p.curReserve + p.nextReserve >= 1) parts.push(`− ${money(p.curReserve + p.nextReserve)} обязательные траты цикла`);
  if (p.transferNow > 0) parts.push(`− ${money(p.transferNow)} в резерв на аренду`);
  if (p.reserveNextPeriod > 0) parts.push(`− ${money(p.reserveNextPeriod)} на следующий период`);
  L.push(`   🧮 ${parts.join(' ')} = <b>${money(p.pool)}</b>`);
  L.push('');

  if (p.spread.length) {
    L.push(`📆 <b>Обязательные траты на цикл</b> <i>(${dnLabel(p.cycleStart)} — ${dnLabel(p.cycleEnd - 1)})</i>`);
    for (const s of p.spread) {
      L.push(`   🔻 ${esc(s.name)} — ${money(s.amount)}: потрачено ${money(s.spent)}, осталось ${money(s.remaining)}${s.spent > s.amount ? ' 🔴' : ''}`);
      L.push(`   ${bar(s.amount ? s.spent / s.amount : 0)}`);
      if (!s.cat || s.cat === 'other') L.push('   ⚠️ <i>нет категории — траты не засчитываются сами (/list → пункт → 🗂)</i>');
    }
    L.push('');
  }

  const cats = Object.entries(p.byCatPeriod).sort((a, b) => b[1] - a[1]);
  if (cats.length) {
    L.push(`🧾 <b>Траты с ${dnLabel(p.periodStartDn)}</b> — ${money(p.spentPeriod)}`);
    for (const [k, v] of cats.slice(0, 6)) L.push(`   ${catName(k)} — ${money(v)}`);
    if (cats.length > 6) L.push(`   <i>…и ещё ${cats.length - 6} категорий (/chart)</i>`);
    L.push('');
  }

  L.push(`📊 <b>В месяце</b>: доходы ${money(m.totalIncome)} · обязательные ${money(m.totalBills)}${m.mandatoryShare !== null ? ` (${m.mandatoryShare}%)` : ''}`);
  if (m.free < 0) L.push(`🚨 <b>Обязательные траты больше дохода на ${money(-m.free)}.</b>`);
  return L.join('\n').trim();
}

// ── Короткая сводка: только то, что нужно знать сейчас. Подробности — по кнопке «Подробнее» (formatPlanFull) ──
export function formatPlan(data, today) {
  if (!(data.items ?? []).length) return formatList(data, today);
  const p = computePeriod(data, today);
  const L = [];

  // 1. Что тревожит
  for (const g of p.gaps) {
    L.push(`💥 ${dnLabel(g.occ.dn)} не хватит ${money(g.short)} на «${esc(g.occ.name)}»`);
  }
  if (L.length) L.push('');

  // 2. Главное: сколько можно тратить
  L.push(`💳 На карте: <b>${money(p.now)}</b>${p.hasBalance ? '' : ' <i>(оценка — задай /balance)</i>'}`);
  const until = p.nextIncome ? `до ${dnLabel(p.nextIncome.dn)}` : 'до конца месяца';
  if (p.pool >= 0) {
    L.push(`🎯 <b>Можно тратить: ${money(p.pool)}</b> ${until} (${p.days} дн.)`);
    L.push(`📍 Сегодня ещё <b>${money(p.leftToday)}</b> · в день ${money(p.perDay)}`);
  } else {
    L.push(`🚨 <b>Не хватает ${money(p.shortfall)}</b> ${until}`);
  }

  // 3. Куда ушли деньги — одной строкой
  const cuts = [];
  if (p.dueSum > 0) cuts.push(`платежи ${money(p.dueSum)}`);
  const mand = p.curReserve + p.nextReserve;
  if (mand >= 1) {
    const parts = p.spread.filter((x) => x.reserve >= 1).map((x) => `${esc(x.name.toLowerCase())} ${money(x.reserve)}`);
    cuts.push(`обязательные траты ${money(mand)}${parts.length ? ` (${parts.join(', ')})` : ''}`);
  }
  if (p.transferNow > 0) cuts.push(`в резерв ${money(p.transferNow)}`);
  if (p.reserveNextPeriod > 0) cuts.push(`на следующий период ${money(p.reserveNextPeriod)}`);
  if (cuts.length) L.push(`<i>Вычтено из карты: ${cuts.join(' · ')}</i>`);

  // 4. Резерв на аренду
  const rp = p.rplan;
  if (rp) {
    L.push('');
    const d1 = rp.deadlines[0];
    if (d1) {
      L.push(`🏠 Резерв на аренду: <b>${money(rp.have)}</b> из ${money(d1.cum)} · платёж ${dnLabel(d1.dn)}${d1.required <= 0 ? ' ✅' : ''}`);
    } else {
      L.push(`🏠 Резерв на аренду: <b>${money(rp.have)}</b>`);
    }
  }

  // 5. Что сделать
  const todo = [];
  if (p.pending.length) todo.push(`подтверди кнопками ниже: ${p.pending.slice(0, 3).map((o) => esc(o.name)).join(', ')}`);
  if (p.transferNow > 0) todo.push(`переведи в резерв <b>${money(p.transferNow)}</b>`);
  else if (rp && rp.alloc.size) {
    const [dnFirst, amt] = [...rp.alloc.entries()].sort((a, b) => a[0] - b[0])[0];
    todo.push(`с дохода ${dnLabel(dnFirst)} переведи в резерв ${money(amt)}`);
  }
  if (todo.length) {
    L.push('', '👉 <b>Что сделать</b>');
    for (const t of todo) L.push(`• ${t}`);
  }

  // 6. Дальше
  L.push('');
  if (p.nextIncome) {
    L.push(`💚 Дальше: ${esc(p.nextIncome.name)} <b>+${money(p.nextIncome.amount)}</b> — ${dnLabel(p.nextIncome.dn)} (${inDays(p.nextIncome.dn - p.todayDn)})`);
  } else {
    L.push('⚠️ Следующий доход не задан. Добавь: «аванс 80к 5 числа».');
  }
  return L.join('\n');
}
