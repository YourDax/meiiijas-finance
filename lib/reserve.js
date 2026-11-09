// Резерв на аренду, коммуналку и интернет: отдельный счёт, на который часть дохода переводится заранее.
import { round2 } from './budget.js';
import { anchorDay, computePeriod, cycleBounds, dn, fromDn, isReserveBill, isTransportItem, spreadAmount } from './period.js';
import { workdaysBetween } from './calendar.js';
import { dateStr, esc, money } from './format.js';
import { logEvent } from './prompt.js';

const label = (n) => {
  const t = fromDn(n);
  return dateStr(t.d, t.m);
};

export const reserveEnabled = (data) => !!data.reserve && typeof data.reserve.amount === 'number';

// Пополнение резерва. Ручной перевод уменьшает остаток карты; перевод из выписки остаток не трогает (он уже в выписке).
export function depositReserve(data, today, amount, src = 'manual', h = null) {
  data.reserve = data.reserve ?? { amount: 0, ts: today.ts, history: [] };
  data.reserve.amount = round2(data.reserve.amount + amount);
  data.reserve.history = [...(data.reserve.history ?? []), { ts: today.ts, amount, src, ...(h ? { h } : {}) }].slice(-60);
  if (src === 'manual' && data.balance) data.balance.amount = round2(data.balance.amount - amount);
  logEvent(data, today.ts, `в резерв на аренду ${amount >= 0 ? '+' : ''}${money(amount)} (всего ${money(data.reserve.amount)})`);
}

// Текст /reserve
export function formatReserve(data, today) {
  if (!reserveEnabled(data)) {
    return [
      '🏠 <b>Резерв на аренду</b> пока не настроен.',
      'Это отдельный счёт, на который с дохода откладывается часть денег на аренду, коммуналку и интернет.',
      '',
      'Задай, сколько там лежит сейчас: <code>/reserve 46000</code>',
      'Номер договора счёта (для автоучёта из выписки): <code>/reserve contract 8861</code> — последние цифры',
    ].join('\n');
  }
  const p = computePeriod(data, today);
  const rp = p.rplan;
  const L = [`🏠 <b>Резерв на аренду</b>: отложено <b>${money(data.reserve.amount)}</b>`];
  if (data.reserve.contract) L.push(`   Счёт: договор …${esc(data.reserve.contract)}`);
  const bills = (data.items ?? []).filter((i) => isReserveBill(i));
  if (bills.length) L.push(`   Платят из резерва: ${bills.map((b) => `${esc(b.name)} ${money(b.amount)} (${b.day}-го)`).join(', ')}`);
  for (const d of rp.deadlines.slice(0, 2)) {
    L.push('', `📅 <b>К ${label(d.dn)}</b> нужно ${money(d.cum)}`);
    if (d.required <= 0) L.push('   ✅ Хватает');
    else {
      if (d.now > 0) L.push(`   👉 Перевести с карты сейчас: <b>${money(d.now)}</b>${p.transferNow ? ` (с округлением ${money(p.transferNow)})` : ''}`);
      for (const f of d.fundedBy) L.push(`   💚 Со следующего дохода (${label(f.dn)}): ${money(f.amount)}`);
    }
  }
  L.push('', 'Перевёл деньги: <code>/reserve +30000</code> или «перевёл на резерв 30к»', 'Поправить остаток: <code>/reserve 46000</code>');
  return L.join('\n');
}

// Транспорт по формуле: карта (база) + ставка за каждый рабочий день цикла
export function setTransportFormula(data, today, base, daily, newId) {
  const items = data.items;
  let it = items.find(isTransportItem);
  if (!it) {
    it = { id: newId(), type: 'bill', spread: true, cat: 'transport', name: 'Транспорт', day: null, amount: 0 };
    items.push(it);
  }
  it.formula = { base, daily };
  const todayDn = dn(today.y, today.m, today.d);
  const cyc = cycleBounds(todayDn, data.settings?.cycleAnchor ?? anchorDay(items));
  it.amount = spreadAmount(it, cyc);
  logEvent(data, today.ts, `транспорт по формуле: ${money(base)} + ${money(daily)} за рабочий день → ${money(it.amount)} на цикл`);
  return { it, cyc, weekdays: workdaysBetween(cyc.start, cyc.end) };
}
