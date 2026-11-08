// Слэш-команды: (текст, данные чата, сегодня, контекст) -> { reply, data, changed, dashboard, markup }
import { parseAmount, parseDay, parseCommand } from './parse.js';
import { formatHelp, formatList, listMarkup, esc, money } from './format.js';
import { categorize, catName } from './cats.js';
import { ymOf, computePlan } from './budget.js';
import { findGoal, formatGoals, goalsMarkup, ymLabel } from './goals.js';
import { formatChart } from './charts.js';
import { formatGuide } from './guide.js';
import { formatForecast, forecastMarkup } from './forecast.js';
import { depositReserve, formatReserve, setTransportFormula } from './reserve.js';
import { logEvent } from './prompt.js';
import { dn, dateKey, isReserveBill, cardBalance } from './period.js';
import { paidList } from './paid.js';

export const newId = () => Math.random().toString(36).slice(2, 8);

export const emptyData = () => ({
  items: [], spends: [], balance: null, pending: [], dash: null, settings: { digest: true },
  goals: [], log: [], lastExport: null, topups: [], awaiting: null, done: {}, rules: {}, imported: [], reserve: null,
  accounts: [], debts: [], catLimits: {}, customCats: [],
});

// Приводит сохранённые данные к актуальному формату (старые записи получают id)
export function normalize(raw) {
  const d = { ...emptyData(), ...(raw ?? {}) };
  // Старые записи получают id; неопознанные категории пересчитываются (словарь категорий пополняется)
  d.items = (d.items ?? []).map((it) => {
    const x = it.id ? it : { ...it, id: newId() };
    return x.spread && (!x.cat || x.cat === 'other') && !x.catManual ? { ...x, cat: categorize(x.name) } : x;
  });
  d.spends = (d.spends ?? []).map((s) => {
    const x = s.id ? s : { ...s, id: newId() };
    return (!x.cat || x.cat === 'other') && !x.catManual ? { ...x, cat: categorize(x.name) } : x;
  });
  d.pending = d.pending ?? [];
  d.goals = d.goals ?? [];
  d.topups = d.topups ?? [];
  d.done = d.done ?? {};
  d.rules = d.rules ?? {};
  d.reserve = d.reserve ?? null;
  d.imported = d.imported ?? [];
  d.log = d.log ?? [];
  d.settings = { digest: true, ...(d.settings ?? {}) };
  return d;
}

// Отложить деньги в цель: они уходят из свободных (если задан остаток на руках — вычитаем)
export function depositToGoal(data, today, goal, amount) {
  goal.saved = Math.round((goal.saved + amount) * 100) / 100;
  if (data.balance) data.balance.amount = Math.round((data.balance.amount - amount) * 100) / 100;
  logEvent(data, today.ts, `в цель «${goal.name}» отложено ${money(amount)} (всего ${money(goal.saved)})`);
}

// Разовое пополнение: если остаток на руках задан — прибавляем к нему, иначе записываем разовым доходом на сегодня
export function applyTopup(data, today, amount, name, by) {
  const rec = { id: newId(), amount, name, ts: today.ts, by };
  if (data.balance) {
    data.balance.amount = Math.round((data.balance.amount + amount) * 100) / 100;
    rec.mode = 'balance';
  } else {
    // снятие без заданного остатка записываем как уже оплаченный разовый платёж
    const it = { id: newId(), type: amount >= 0 ? 'income' : 'bill', amount: Math.abs(amount), day: today.d, name, once: ymOf(today), by };
    data.items.push(it);
    // деньги уже пришли — подтверждение не нужно
    data.done = { ...(data.done ?? {}), [`${it.id}:${dateKey(dn(today.y, today.m, today.d))}`]: { ts: today.ts } };
    rec.mode = 'income';
    rec.itemId = it.id;
  }
  data.topups = [...(data.topups ?? []), rec].slice(-50);
  logEvent(data, today.ts, amount >= 0 ? `разовое пополнение баланса «${name}»: +${money(amount)}` : `снятие с баланса «${name}»: −${money(-amount)}`);
  return rec;
}

// Снять деньги с баланса (наличные, перевод, возврат долга): не трата, в категории и дневной лимит не попадает
export const applyWithdraw = (data, today, amount, name, by) => applyTopup(data, today, -amount, name || 'Снятие', by);

export function undoTopup(data, id) {
  const i = (data.topups ?? []).findIndex((t) => t.id === id);
  if (i < 0) return null;
  const [rec] = data.topups.splice(i, 1);
  if (rec.mode === 'balance' && data.balance) data.balance.amount = Math.round((data.balance.amount - rec.amount) * 100) / 100;
  if (rec.mode === 'income') data.items = data.items.filter((x) => x.id !== rec.itemId);
  return rec;
}

function addItem(type, c, data, today, ctx) {
  const amount = parseAmount(c.args[0]);
  let day = parseDay(c.args[1]);
  // «/bill 6000 Транспорт» — без числа месяца: трата в течение месяца
  const spread = type === 'bill' && amount && c.args.length >= 2 && day === null;
  const name = (spread ? c.args.slice(1) : c.args.slice(2)).join(' ').trim() || (type === 'income' ? 'Доход' : '');
  const ex = type === 'income' ? '/income 80000 5 Аванс' : '/bill 25000 1 Аренда';
  if (!amount || (!day && !spread) || !name) {
    return { reply: `Формат: <code>${ex}</code>\n(сумма без пробелов, число месяца 1–31, название)\n${type === 'bill' ? 'Без числа — трата в течение месяца: <code>/bill 6000 Транспорт</code>\n' : ''}Или просто напиши обычной фразой: «аванс 80к 5 числа».` };
  }
  if (spread) {
    data.items.push({ type, amount, day: null, spread: true, cat: categorize(name), name: name.slice(0, 60), id: newId(), by: ctx.by });
    logEvent(data, today.ts, `добавлена трата в течение месяца «${name}» ${money(amount)}`);
    return { reply: `📆 Трата добавлена: ${esc(name)} — <b>${money(amount)}</b> в течение месяца ✅`, changed: true };
  }
  data.items.push({ type, amount, day, name: name.slice(0, 60), id: newId(), by: ctx.by });
  logEvent(data, today.ts, `добавлен ${type === 'income' ? 'доход' : 'платёж'} «${name}» ${money(amount)}, ${day}-го`);
  const icon = type === 'income' ? '💰 Доход добавлен' : '📌 Трата добавлена';
  return { reply: `${icon}: ${esc(name)} — <b>${money(amount)}</b>, каждое ${day}-е число ✅`, changed: true };
}

export function handleLine(line, data, today, ctx = {}) {
  const c = parseCommand(line);
  if (!c) return null;
  switch (c.cmd) {
    case 'start': case 'help': return { reply: formatHelp() };
    case 'income': return addItem('income', c, data, today, ctx);
    case 'bill': return addItem('bill', c, data, today, ctx);
    case 'list': return { reply: formatList(data, today), markup: listMarkup(data, today) };
    case 'plan': case 'report': return { dashboard: true };
    case 'balance': {
      const a = c.args[0] === '0' ? 0 : parseAmount(c.args[0]);
      if (a === null) return { reply: 'Формат: <code>/balance 12000</code> — сколько денег на руках прямо сейчас' };
      data.balance = { amount: a, ts: today.ts };
      logEvent(data, today.ts, `остаток на руках обновлён: ${money(a)}`);
      return { reply: `💼 Остаток на руках: <b>${money(a)}</b> ✅`, changed: true };
    }
    case 'spend': {
      const a = parseAmount(c.args[0]);
      if (!a) return { reply: 'Формат: <code>/spend 450 Кофе</code>' };
      const name = c.args.slice(1).join(' ').slice(0, 60);
      const cat = categorize(name);
      data.spends.push({ amount: a, name, cat, ts: today.ts, id: newId(), by: ctx.by });
      return { reply: `🧾 Записано: ${money(a)} ${esc(name)} · ${catName(cat)} ✅`, changed: true };
    }
    case 'undo': {
      const s = data.spends.pop();
      return s
        ? { reply: `↩️ Отменено: ${money(s.amount)} ${esc(s.name)}`, changed: true }
        : { reply: 'Нечего отменять 🙂' };
    }
    case 'del': {
      const n = Number(c.args[0]);
      if (!Number.isInteger(n) || n < 1 || n > data.items.length) {
        return { reply: 'Нажми 🗑 в /list или укажи номер, например <code>/del 2</code>' };
      }
      const [it] = data.items.splice(n - 1, 1);
      logEvent(data, today.ts, `удалён пункт «${it.name}» ${money(it.amount)}`);
      return { reply: `🗑 Удалено: ${esc(it.name)}`, changed: true };
    }
    case 'topup': {
      const a = parseAmount(c.args[0]);
      if (!a) return { reply: 'Формат: <code>/topup 5000 Подарок</code> — разовое пополнение баланса' };
      const name = c.args.slice(1).join(' ').slice(0, 40) || 'Пополнение';
      applyTopup(data, today, a, name, ctx.by);
      return { reply: `💵 Баланс пополнен на <b>${money(a)}</b> (${esc(name)}) ✅`, changed: true };
    }
    case 'withdraw': {
      const a = parseAmount(c.args[0]);
      if (!a) return { reply: 'Формат: <code>/withdraw 3000 Наличные</code> — снять деньги с баланса (не трата)' };
      const name = c.args.slice(1).join(' ').slice(0, 40) || 'Снятие';
      applyWithdraw(data, today, a, name, ctx.by);
      return { reply: `➖ С баланса снято <b>${money(a)}</b> (${esc(name)}) ✅`, changed: true };
    }
    case 'paid': {
      const p = paidList(data, today);
      return { reply: p.text, markup: p.markup };
    }
    case 'reserve': {
      const a0 = (c.args[0] ?? '').toLowerCase();
      if (a0 === 'off' || a0 === 'выкл') {
        data.reserve = null;
        return { reply: '🏠 Резерв на аренду выключен: платежи считаются с карты.', changed: true };
      }
      if (a0 === 'contract' || a0 === 'договор') {
        const num = (c.args[1] ?? '').replace(/\D/g, '');
        if (num.length < 3) return { reply: 'Формат: <code>/reserve contract 8861</code> — последние цифры номера договора счёта резерва' };
        data.reserve = data.reserve ?? { amount: 0, ts: today.ts, history: [] };
        data.reserve.contract = num;
        return { reply: `🏠 Счёт резерва: договор …${num}. Переводы на него из выписки буду учитывать сам.${data.reserve.amount ? '' : '\nТеперь задай остаток резерва: /reserve 46000'}`, changed: true };
      }
      if (a0 === 'plan' || a0 === 'взнос') {
        // /reserve plan Зарплата 30000 Аванс 16000 — сколько переводить в резерв с каждого дохода
        const pairs = [];
        const t = c.args.slice(1);
        for (let i = 0; i + 1 < t.length; i += 2) pairs.push([t[i].toLowerCase(), t[i + 1]]);
        const incomes = data.items.filter((i) => i.type === 'income');
        if (!pairs.length) {
          const cur = incomes.filter((i) => i.toReserve != null).map((i) => `${i.name} — ${money(i.toReserve)}`);
          return { reply: `🏠 Взносы в резерв с доходов: ${cur.length ? cur.join(', ') : 'не заданы (бот берёт аванс целиком, остальное — с зарплаты)'}.
Задать: <code>/reserve plan Зарплата 30000 Аванс 16000</code>; убрать: <code>/reserve plan Аванс 0</code>` };
        }
        const done = [];
        for (const [name, val] of pairs) {
          const it = incomes.find((i) => i.name.toLowerCase().includes(name));
          const amt = val === '0' ? 0 : parseAmount(val);
          if (!it || amt === null) return { reply: `Не понял «${name} ${val}». Пример: <code>/reserve plan Зарплата 30000 Аванс 16000</code>` };
          if (amt === 0) delete it.toReserve; else it.toReserve = amt;
          done.push(`${it.name} → ${amt ? money(amt) : 'авто'}`);
        }
        const total = incomes.reduce((s, i) => s + (i.toReserve ?? 0), 0);
        const need = data.items.filter((i) => isReserveBill(i)).reduce((s, i) => s + i.amount, 0);
        logEvent(data, today.ts, `взносы в резерв: ${done.join(', ')}`);
        return { reply: `🏠 Взносы в резерв: ${done.join(', ')}.
Всего в месяц ${money(total)}, платежей из резерва на ${money(need)}${total >= need ? ' ✅ хватает' : ` ⚠️ не хватает ${money(need - total)}`}.`, changed: true };
      }
      if (a0 === 'step') {
        const st = parseAmount(c.args[1]);
        if (!st) return { reply: 'Формат: <code>/reserve step 1000</code> — до какой суммы округлять перевод вверх' };
        data.settings.reserveStep = st;
        return { reply: `🏠 Перевод в резерв округляю вверх до ${money(st)}.`, changed: true };
      }
      if (a0.startsWith('+')) {
        const amt = parseAmount(a0.slice(1) || c.args[1]);
        if (!amt) return { reply: 'Формат: <code>/reserve +30000</code> — сколько перевёл на резерв' };
        depositReserve(data, today, amt, 'manual');
        return { reply: `🏠 В резерв: +${money(amt)}. Всего отложено <b>${money(data.reserve.amount)}</b>${data.balance ? `. Остаток на карте: ${money(cardBalance(data))}` : ''}`, changed: true };
      }
      const amt = a0 === '0' ? 0 : parseAmount(a0);
      if (amt === null || (a0 === '' )) return { reply: formatReserve(data, today) };
      const first = !data.reserve;
      data.reserve = { ...(data.reserve ?? {}), amount: amt, ts: today.ts, history: [] };
      logEvent(data, today.ts, `остаток резерва на аренду: ${money(amt)}`);
      const hint = first && data.balance && data.balance.amount >= amt
        ? { markup: { inline_keyboard: [[{ text: `Вычесть ${money(amt)} из остатка карты`, callback_data: `rb:${amt}` }], [{ text: 'Остаток карты уже без резерва', callback_data: 'rb:0' }]] } }
        : {};
      return {
        reply: `🏠 Резерв на аренду: <b>${money(amt)}</b> ✅${hint.markup ? `\n\nРаньше /balance мог включать эти деньги. Остаток на карте сейчас ${money(cardBalance(data))} — вычесть резерв из него?` : ''}`,
        changed: true, ...hint,
      };
    }
    case 'transport': {
      const base = parseAmount(c.args[0]);
      const daily = parseAmount(c.args[1]);
      if (!base || !daily) return { reply: 'Формат: <code>/transport 3500 180</code> — карта 3 500 + 180 за каждый рабочий день цикла (по производственному календарю)' };
      const r = setTransportFormula(data, today, base, daily, newId);
      return { reply: `🚌 Транспорт: ${money(base)} + ${money(daily)} × ${r.weekdays} рабочих дней = <b>${money(r.it.amount)}</b> на текущий цикл. Дальше пересчитаю сам.`, changed: true };
    }
    case 'cycle': {
      const v = (c.args[0] ?? '').toLowerCase();
      if (v === 'auto' || v === 'авто') {
        delete data.settings.cycleAnchor;
        return { reply: '📆 Цикл бюджета: по самому раннему регулярному доходу (авто).', changed: true };
      }
      const d = parseDay(v);
      if (!d) {
        const cur = data.settings.cycleAnchor ? `с ${data.settings.cycleAnchor}-го числа (задан вручную)` : 'определяется по самому раннему регулярному доходу (авто)';
        return { reply: `📆 Цикл бюджета сейчас ${cur}.
Обязательные траты «в течение месяца» считаются на цикл — период от этого числа до такого же в следующем месяце, а не на календарный месяц.
Изменить: <code>/cycle 5</code> или <code>/cycle auto</code>` };
      }
      data.settings.cycleAnchor = d;
      logEvent(data, today.ts, `цикл бюджета: с ${d}-го числа`);
      return { reply: `📆 Цикл бюджета теперь с ${d}-го числа: обязательные траты «в течение месяца» считаются на период от ${d}-го до ${d}-го.`, changed: true };
    }
    case 'guide': case 'what': case 'todo': return { reply: formatGuide(data, today) };
    case 'next': case 'forecast': {
      const k = Math.min(6, Math.max(1, Number(c.args[0]) || 1));
      return { reply: formatForecast(data, today, k), markup: forecastMarkup(k) };
    }
    case 'chart': return { reply: formatChart(data, today) };
    case 'goals': return { reply: formatGoals(data, today, computePlan(data, today).free), markup: goalsMarkup(data) };
    case 'goal': {
      const amount = parseAmount(c.args[0]);
      const ym = /^(20\d\d)-(0[1-9]|1[0-2])$/.test(c.args[1] ?? '') ? c.args[1] : null;
      const name = c.args.slice(2).join(' ').trim() || 'Цель';
      if (!amount || !ym) return { reply: 'Формат: <code>/goal 200000 2027-06 Отпуск</code>\nИли проще: «цель 200к к июню отпуск»' };
      data.goals.push({ id: newId(), name: name.slice(0, 40), target: amount, deadline: ym, saved: 0, by: ctx.by });
      logEvent(data, today.ts, `новая цель «${name}»: ${money(amount)} до ${ymLabel(ym)}`);
      return { reply: `🎯 Цель добавлена: ${esc(name)} — ${money(amount)} до ${ymLabel(ym)} ✅\nСмотри /goals`, changed: true };
    }
    case 'save': {
      const amount = parseAmount(c.args[0]);
      const g = findGoal(data, c.args.slice(1).join(' '));
      if (!amount) return { reply: 'Формат: <code>/save 5000 Отпуск</code>' };
      if (!g) return { reply: 'Не нашёл такую цель. Список: /goals' };
      depositToGoal(data, today, g, amount);
      return { reply: `🐷 В копилку «${esc(g.name)}»: +${money(amount)}. Накоплено ${money(g.saved)} из ${money(g.target)} ✅`, changed: true };
    }
    case 'ai': case 'prompt': return { ai: { question: c.args.join(' ') } };
    case 'digest': {
      const v = (c.args[0] ?? '').toLowerCase();
      if (v !== 'on' && v !== 'off') {
        return { reply: `☀️ Утренний дайджест сейчас: <b>${data.settings.digest ? 'включён' : 'выключен'}</b>\nПереключить: <code>/digest on</code> или <code>/digest off</code>` };
      }
      data.settings.digest = v === 'on';
      return { reply: v === 'on' ? '☀️ Утренний дайджест включён (придёт с 7 до 8 утра).' : '🔕 Утренний дайджест выключен.', changed: true };
    }
    case 'reset':
      if (c.args[0] !== 'confirm') return { reply: '⚠️ Это сотрёт все данные. Подтверди: <code>/reset confirm</code>' };
      Object.assign(data, emptyData());
      return { reply: '♻️ Всё очищено. Начнём заново: /help', changed: true };
    default: return null;
  }
}

export function handleMessage(text, raw, today, ctx = {}) {
  const data = normalize(raw);
  const replies = [];
  let changed = false;
  let dashboard = false;
  let ai = null;
  let markup;
  for (const line of String(text ?? '').split('\n')) {
    const r = handleLine(line, data, today, ctx);
    if (!r) continue;
    if (r.reply) replies.push(r.reply);
    if (r.markup) markup = r.markup;
    changed ||= !!r.changed;
    dashboard ||= !!r.dashboard;
    ai = r.ai ?? ai;
  }
  return { reply: replies.join('\n\n') || null, data, changed, dashboard, markup, ai };
}

export function nowInTz(tz = 'Europe/Moscow', date = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const sinceMidnight = ((+p.hour * 60 + +p.minute) * 60 + +p.second) * 1000 + date.getMilliseconds();
  const dayStart = date.getTime() - sinceMidnight;
  const d = +p.day;
  return {
    y: +p.year, m: +p.month - 1, d, ts: date.getTime(),
    dayStart, monthStart: dayStart - (d - 1) * 86400000,
  };
}

export { ymOf };
