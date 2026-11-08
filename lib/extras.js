// Счета и переводы, долги, изменение целей, лимиты и свои категории.
// Функции мутируют data и при ошибке возвращают { error: 'текст для человека' }.
import { newId, applyTopup, applyWithdraw, undoTopup } from './bot.js';
import { computePlan, round2 } from './budget.js';
import { catName, isCustomCat, validCat } from './cats.js';
import { cardBalance } from './period.js';
import { depositReserve } from './reserve.js';
import { logEvent } from './prompt.js';
import { money } from './format.js';

const sideName = (data, side) => (side === 'card' ? 'Карта' : side === 'reserve' ? 'Копилка на аренду' : data.accounts.find((a) => a.id === side)?.name);

function sideAmount(data, side) {
  if (side === 'card') return data.balance ? cardBalance(data) : null;
  if (side === 'reserve') return data.reserve?.amount ?? null;
  return data.accounts.find((a) => a.id === side)?.amount ?? null;
}

function moveSide(data, side, delta) {
  if (side === 'card') data.balance.amount = round2(data.balance.amount + delta);
  else if (side === 'reserve') data.reserve.amount = round2(data.reserve.amount + delta);
  else { const a = data.accounts.find((x) => x.id === side); a.amount = round2(a.amount + delta); }
}

export function addAccount(data, today, name, amount) {
  if (data.accounts.length >= 20) return { error: 'Счетов уже слишком много' };
  const a = { id: newId(), name, amount };
  data.accounts.push(a);
  logEvent(data, today.ts, `новый счёт «${name}»: ${money(amount)}`);
  return { account: a };
}

export function editAccount(data, today, id, name, amount) {
  const a = data.accounts.find((x) => x.id === id);
  if (!a) return { error: 'Счёт не найден' };
  a.name = name;
  a.amount = amount;
  logEvent(data, today.ts, `счёт «${name}»: ${money(amount)}`);
  return { account: a };
}

export function deleteAccount(data, today, id) {
  const i = data.accounts.findIndex((x) => x.id === id);
  if (i < 0) return { error: 'Счёт уже удалён' };
  const [a] = data.accounts.splice(i, 1);
  logEvent(data, today.ts, `удалён счёт «${a.name}»`);
  return { account: a };
}

// Перевод между счетами: общая сумма денег не меняется, это не трата и не доход
export function transfer(data, today, from, to, amount) {
  if (from === to) return { error: 'Выбери два разных счёта' };
  const have = sideAmount(data, from);
  if (have === null) return { error: from === 'card' ? 'Сначала укажи остаток на карте' : 'Счёт списания не найден' };
  if (sideAmount(data, to) === null) return { error: to === 'card' ? 'Сначала укажи остаток на карте' : 'Счёт зачисления не найден' };
  if (amount > have) return { error: `На счёте только ${money(have)}` };
  if (from === 'card' && to === 'reserve') depositReserve(data, today, amount, 'manual');
  else {
    moveSide(data, from, -amount);
    moveSide(data, to, amount);
    logEvent(data, today.ts, `перевод ${money(amount)}: ${sideName(data, from)} → ${sideName(data, to)}`);
  }
  return { ok: true };
}

// kind: 'owe' — должен я, 'lent' — должны мне. withMoney: деньги прошли через карту прямо сейчас
export function addDebt(data, today, { name, kind, amount, withMoney, by }) {
  const d = { id: newId(), name, kind, total: amount, left: amount, ts: today.ts };
  data.debts.push(d);
  if (withMoney) {
    if (kind === 'owe') applyTopup(data, today, amount, `Взял в долг: ${name}`.slice(0, 40), by);
    else applyWithdraw(data, today, amount, `Дал в долг: ${name}`.slice(0, 40), by);
  }
  logEvent(data, today.ts, `${kind === 'owe' ? 'мой долг' : 'мне должны'}: «${name}» ${money(amount)}`);
  return { debt: d };
}

export function payDebt(data, today, id, amount, by) {
  const d = data.debts.find((x) => x.id === id);
  if (!d) return { error: 'Долг не найден' };
  if (d.left <= 0) return { error: 'Этот долг уже закрыт' };
  if (amount > d.left) return { error: `Осталось только ${money(d.left)}` };
  const rec = d.kind === 'owe'
    ? applyWithdraw(data, today, amount, `Возврат долга: ${d.name}`.slice(0, 40), by)
    : applyTopup(data, today, amount, `Вернули долг: ${d.name}`.slice(0, 40), by);
  d.left = round2(d.left - amount);
  logEvent(data, today.ts, `долг «${d.name}»: ${money(amount)}, осталось ${money(d.left)}`);
  return { debt: d, topupId: rec.id };
}

export function undoDebtPay(data, today, id, topupId) {
  const d = data.debts.find((x) => x.id === id);
  if (!d) return { error: 'Долг не найден' };
  const rec = undoTopup(data, topupId);
  if (!rec) return { error: 'Уже отменено' };
  d.left = round2(d.left + Math.abs(rec.amount));
  logEvent(data, today.ts, `долг «${d.name}»: платёж отменён`);
  return { debt: d };
}

export function deleteDebt(data, today, id) {
  const i = data.debts.findIndex((x) => x.id === id);
  if (i < 0) return { error: 'Долг уже удалён' };
  const [d] = data.debts.splice(i, 1);
  logEvent(data, today.ts, `удалён долг «${d.name}»`);
  return { debt: d };
}

// Забрать деньги из цели: обратное действие к «Отложить»
export function withdrawGoal(data, today, id, amount) {
  const g = data.goals.find((x) => x.id === id);
  if (!g) return { error: 'Цель не найдена' };
  if (amount > g.saved) return { error: `В цели только ${money(g.saved)}` };
  g.saved = round2(g.saved - amount);
  if (data.balance) data.balance.amount = round2(data.balance.amount + amount);
  logEvent(data, today.ts, `из цели «${g.name}» взято ${money(amount)} (осталось ${money(g.saved)})`);
  return { goal: g };
}

export function editGoal(data, today, id, { name, target, deadline }) {
  const g = data.goals.find((x) => x.id === id);
  if (!g) return { error: 'Цель не найдена' };
  Object.assign(g, { name, target, deadline });
  logEvent(data, today.ts, `цель «${name}» изменена: ${money(target)} до ${deadline}`);
  return { goal: g };
}

// amount = 0 снимает лимит
export function setCatLimit(data, today, cat, amount) {
  if (!validCat(data, cat)) return { error: 'Такой категории нет' };
  const rest = { ...data.catLimits };
  if (amount > 0) rest[cat] = amount; else delete rest[cat];
  data.catLimits = rest;
  logEvent(data, today.ts, amount > 0 ? `лимит «${catName(cat)}»: ${money(amount)} в месяц` : `лимит «${catName(cat)}» снят`);
  return { ok: true };
}

export function catLimitsView(data, today) {
  const { byCat } = computePlan(data, today);
  return Object.entries(data.catLimits).map(([cat, limit]) => ({ cat, limit, spent: byCat[cat] ?? 0 }));
}

// Предупреждение после траты: израсходовано 90% лимита или больше
export function limitWarning(data, today, cat) {
  const limit = data.catLimits[cat];
  if (!limit) return null;
  const spent = computePlan(data, today).byCat[cat] ?? 0;
  return spent >= limit * 0.9 ? { name: catName(cat), spent, limit } : null;
}

export function addCustomCat(data, today, rawName) {
  const name = /^\p{Extended_Pictographic}/u.test(rawName) ? rawName : `🏷 ${rawName}`;
  const key = `u:${name}`;
  if (data.customCats.includes(key)) return { error: 'Такая категория уже есть' };
  if (data.customCats.length >= 30) return { error: 'Категорий уже слишком много' };
  data.customCats = [...data.customCats, key];
  logEvent(data, today.ts, `новая категория ${name}`);
  return { key };
}

export function deleteCustomCat(data, today, key) {
  if (!isCustomCat(key) || !data.customCats.includes(key)) return { error: 'Категория не найдена' };
  const used = data.spends.filter((s) => s.cat === key).length + data.items.filter((i) => i.cat === key).length;
  if (used) return { error: `Категория используется в записях: ${used}. Сначала смени им категорию` };
  data.customCats = data.customCats.filter((k) => k !== key);
  const rest = { ...data.catLimits };
  delete rest[key];
  data.catLimits = rest;
  logEvent(data, today.ts, `удалена категория ${key.slice(2)}`);
  return { ok: true };
}
