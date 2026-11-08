// Общие операции над данными бюджета. Их используют и бот (кнопки), и мини-приложение (runAction),
// чтобы правило «что делает действие» жило в одном месте. Функции мутируют data и пишут журнал.
import { newId } from './bot.js';
import { CATS } from './cats.js';
import { dateStr, money } from './format.js';
import { ymLabel } from './goals.js';
import { computePeriod, confirmOccurrence, unconfirmOccurrence, fromDn, isReserveBill } from './period.js';
import { depositReserve } from './reserve.js';
import { logEvent } from './prompt.js';
import { findRec } from './edit.js';
import { zonedTs } from './statement.js';

// Удаляет трату или пункт плана по id. -> { kind: 'spend' | 'item', rec } | null
export function removeRecord(data, today, id) {
  const si = data.spends.findIndex((x) => x.id === id);
  if (si >= 0) {
    const [s] = data.spends.splice(si, 1);
    logEvent(data, today.ts, `удалена трата «${s.name}» ${money(s.amount)}`);
    return { kind: 'spend', rec: s };
  }
  const i = data.items.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const [it] = data.items.splice(i, 1);
  logEvent(data, today.ts, `удалён пункт «${it.name}» ${money(it.amount)}`);
  return { kind: 'item', rec: it };
}

// Категория траты или «размазанного» пункта; для трат с магазином запоминает правило. -> найденная запись | null
export function setCategory(data, today, id, cat) {
  const f = findRec(data, id);
  if (!f || (f.kind === 'item' && !f.rec.spread) || !CATS[cat]) return null;
  f.rec.cat = cat;
  f.rec.catManual = true; // выбрано вручную — автоопределение не перезапишет
  if (f.kind === 'spend' && f.rec.merchant) data.rules = { ...data.rules, [f.rec.merchant]: cat };
  logEvent(data, today.ts, `«${f.rec.name}»: категория ${CATS[cat].name}`);
  return f;
}

// Привязка траты к обязательной трате: 'auto' | 'none' | id статьи. -> найденная запись | null
export function setLink(data, today, id, link) {
  const f = findRec(data, id);
  if (!f || f.kind !== 'spend') return null;
  if (link === 'auto') delete f.rec.linkId;
  else if (link === 'none' || data.items.some((i) => i.id === link && i.spread)) f.rec.linkId = link;
  else return null;
  logEvent(data, today.ts, `трата «${f.rec.name}»: привязка к обязательной трате изменена`);
  return f;
}

// Платёж с карты <-> из резерва. -> найденная запись | null
export function toggleReserve(data, today, id) {
  const f = findRec(data, id);
  if (!f || f.kind !== 'item' || f.rec.spread || f.rec.type !== 'bill') return null;
  f.rec.fromReserve = !isReserveBill(f.rec);
  logEvent(data, today.ts, `«${f.rec.name}»: оплата ${f.rec.fromReserve ? 'из резерва' : 'с карты'}`);
  return f;
}

// «Пришло» / «Оплачено» / «Не было». -> { occ, leftover, after } | null.
// leftover — не потраченный в прошлом периоде остаток; after — период после прихода дохода (для перевода в резерв).
export function confirmOcc(data, today, key, skipped) {
  const before = computePeriod(data, today);
  const owed = before.pendingBills.reduce((s, o) => s + o.amount, 0);
  const leftover = Math.floor(Math.max(0, before.now - owed) / 100) * 100;
  const occ = confirmOccurrence(data, key, today, skipped);
  if (!occ) return null;
  const f = fromDn(occ.dn);
  logEvent(data, today.ts, skipped
    ? `«${occ.name}» ${dateStr(f.d, f.m)} — пропущено`
    : `${occ.type === 'income' ? 'пришло' : 'оплачено'}: «${occ.name}» ${money(occ.amount)}`);
  const after = !skipped && occ.type === 'income' ? computePeriod(data, today) : null;
  return { occ, leftover, after };
}

// Снять отметку «пришло/оплачено/не было». -> { name, skipped } | null.
// Отметки разовых пополнений баланса так не снимаются: для них есть «Отменить пополнение».
export function unconfirmOcc(data, today, key) {
  const id = key.split(':')[0];
  if ((data.topups ?? []).some((t) => t.itemId === id)) return null;
  const r = unconfirmOccurrence(data, key, today);
  if (!r) return null;
  const name = data.items.find((i) => i.id === id)?.name ?? 'платёж';
  logEvent(data, today.ts, `отметка снята: «${name}»`);
  return { name, skipped: r.skipped };
}

// «Оплачено» у статьи без даты: записывает трату на весь остаток статьи, баланс уменьшается как от обычной траты.
// -> { spend } | { error: 'none' | 'paid' }
export function paySpread(data, today, id, by) {
  const row = computePeriod(data, today).spread.find((s) => s.id === id);
  if (!row) return { error: 'none' };
  if (row.remaining <= 0) return { error: 'paid' };
  const spend = { id: newId(), amount: row.remaining, name: row.name, cat: row.cat ?? 'other', ts: today.ts, by, src: 'plan', linkId: id };
  data.spends.push(spend);
  logEvent(data, today.ts, `оплачено: «${row.name}» ${money(spend.amount)}`);
  return { spend };
}

export function addGoal(data, today, { name, amount, deadline, by }) {
  const g = { id: newId(), name, target: amount, deadline, saved: 0, by };
  data.goals.push(g);
  logEvent(data, today.ts, `новая цель «${name}»: ${money(amount)} до ${ymLabel(deadline)}`);
  return g;
}

// Карточка импорта выписки, ожидающая подтверждения
export function makeImportPending(prep, parsed, by) {
  return {
    id: newId(), kind: 'import', by,
    rows: prep.fresh.map((r) => ({ ts: r.ts, amount: r.amount, name: r.name, cat: r.cat, merchant: r.merchant, h: r.h })),
    seen: [...prep.fresh, ...prep.dupManual, ...prep.bills, ...prep.deposits].map((r) => r.h),
    deposits: prep.deposits.map(({ ts, amount, h, dupOf }) => ({ ts, amount, h, dupOf })),
    balance: parsed.balance,
  };
}

// Записывает подтверждённую выписку: траты, переводы в резерв, дедупликацию и (по желанию) остаток
export function applyImport(data, today, pend, { withBalance, by, tz }) {
  data.pending = data.pending.filter((x) => x.id !== pend.id);
  for (const r of pend.rows) {
    data.spends.push({ id: newId(), amount: Math.abs(r.amount), name: r.name, cat: r.cat, ts: r.ts, by: pend.by ?? by, src: 'bank', h: r.h, merchant: r.merchant });
  }
  for (const dep of pend.deposits ?? []) {
    if (dep.dupOf) {
      const h = (data.reserve?.history ?? []).find((x) => x.ts === dep.dupOf);
      if (h) h.matched = true; // этот перевод уже записан вручную
    } else {
      depositReserve(data, today, dep.amount, 'bank', dep.h);
      data.reserve.history[data.reserve.history.length - 1].ts = dep.ts;
    }
  }
  data.imported = [...data.imported, ...pend.seen].slice(-3000);
  const useBalance = !!withBalance && !!pend.balance;
  if (useBalance) {
    const [dd, mm, yyyy] = pend.balance.date.split('.').map(Number);
    data.balance = { amount: pend.balance.amount, ts: Math.min(today.ts, zonedTs(yyyy, mm, dd, 23, 59, tz)) };
  }
  const total = pend.rows.reduce((s, r) => s + Math.abs(r.amount), 0);
  logEvent(data, today.ts, `импорт выписки: ${pend.rows.length} трат на ${money(total)}${useBalance ? ', остаток обновлён' : ''}`);
  return { rows: pend.rows.length, total, useBalance };
}
