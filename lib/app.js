// Действия мини-приложения: те же операции, что у бота, но с данными вместо текста.
// runAction мутирует копию данных и возвращает { data, changed, result }; ввод-вывод — в appserver.js.
import { newId, normalize, emptyData, applyTopup, undoTopup, depositToGoal, handleMessage } from './bot.js';
import { CATS, categorize } from './cats.js';
import { computePlan, goalStatus, round2 } from './budget.js';
import { computePeriod, confirmOccurrence, fromDn, isReserveBill, cardBalance } from './period.js';
import { findRec, applyEdit } from './edit.js';
import { logEvent, buildPrompt } from './prompt.js';
import { parseAny } from './nlp.js';
import { parseBatch } from './batch.js';
import { parseAmount } from './parse.js';
import { depositReserve, formatReserve } from './reserve.js';
import { extractPdfText, parseStatementText, prepareImport, previewText, zonedTs } from './statement.js';
import { formatPlanFull } from './planview.js';
import { formatForecast } from './forecast.js';
import { formatChart } from './charts.js';
import { formatGuide } from './guide.js';
import { formatDigest } from './digest.js';
import { formatGoals } from './goals.js';
import { formatHelp, formatList, money } from './format.js';
import { dashText as dash } from './dash.js';

export class AppError extends Error {}

const stripTags = (s) => String(s).replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function amountOf(v, { allowZero = false } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0) || n > 1e9) throw new AppError('Некорректная сумма');
  return round2(n);
}

function textOf(v, max, { required = true } = {}) {
  const s = String(v ?? '').trim().slice(0, max);
  if (required && !s) throw new AppError('Пустое название');
  return s;
}

const YM = /^(20\d\d)-(0[1-9]|1[0-2])$/;

// Как событие выглядит для интерфейса
export function occView(o) {
  const t = fromDn(o.dn);
  return {
    key: o.key, id: o.item?.id ?? null, type: o.type, name: o.name, amount: o.amount, dn: o.dn,
    date: `${t.y}-${String(t.m + 1).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`,
    fromReserve: !!o.item && isReserveBill(o.item),
  };
}

// Полное состояние для интерфейса
export function buildState(raw, today, { tz, currency } = {}) {
  const data = normalize(raw);
  const p = computePeriod(data, today);
  const plan = computePlan(data, today);
  const spends = [...data.spends].sort((a, b) => b.ts - a.ts);
  return {
    now: today.ts, tz, currency,
    today: { y: today.y, m: today.m, d: today.d },
    cats: Object.fromEntries(Object.entries(CATS).map(([k, v]) => [k, { name: v.name, group: v.group }])),
    items: data.items.map((it) => ({ ...it, fromReserve: it.type === 'bill' && !it.spread ? isReserveBill(it) : undefined })),
    spends: spends.slice(0, 500).map(({ id, amount, name, cat, ts, by, src, linkId, merchant }) => ({ id, amount, name, cat, ts, by, src, linkId, merchant })),
    spendsTotal: spends.length,
    balance: data.balance, cardBalance: cardBalance(data),
    goals: data.goals.map((g) => ({ ...g, status: goalStatus(g, today) })),
    reserve: data.reserve ? { amount: data.reserve.amount, ts: data.reserve.ts, contract: data.reserve.contract ?? null, history: (data.reserve.history ?? []).slice(-20) } : null,
    settings: data.settings,
    topups: data.topups.slice(-10).reverse(),
    log: data.log.slice(-80).reverse(),
    period: {
      now: p.now, hasBalance: p.hasBalance, days: p.days, periodEnd: p.periodEnd,
      perDay: p.perDay, perWeek: p.perWeek, dayBudget: p.dayBudget, leftToday: p.leftToday, spentToday: p.spentToday, freeToday: p.freeToday,
      pool: p.pool, shortfall: p.shortfall, dueSum: p.dueSum, spentPeriod: p.spentPeriod,
      reserveOn: p.reserveOn, transferNow: p.transferNow, noIncome: p.noIncome,
      nextIncome: p.nextIncome ? occView(p.nextIncome) : null,
      pending: p.pending.map(occView), dueList: p.dueList.map(occView),
      gaps: p.gaps.map((g) => ({ ...occView(g.occ), short: g.short })),
      byCatPeriod: p.byCatPeriod, byUserPeriod: p.byUserPeriod,
    },
    plan: { totalIncome: plan.totalIncome, totalBills: plan.totalBills, free: plan.free },
  };
}

// Тексты (HTML Telegram) тех же экранов, что показывает бот
export function buildView(raw, today, name, p = {}, tz = 'Europe/Moscow') {
  const data = normalize(raw);
  switch (name) {
    case 'plan': return formatPlanFull(data, today);
    case 'forecast': return formatForecast(data, today, Math.min(6, Math.max(1, Number(p.k) || 1)));
    case 'chart': return formatChart(data, today);
    case 'guide': return formatGuide(data, today);
    case 'reserve': return formatReserve(data, today);
    case 'digest': return formatDigest(data, today) ?? 'Дайджест появится, когда в бюджете будут доходы и платежи.';
    case 'goals': return formatGoals(data, today, computePlan(data, today).free);
    case 'list': return formatList(data, today);
    case 'help': return formatHelp();
    case 'dash': return dash(data, today);
    case 'ai': return buildPrompt(data, today, { question: textOf(p.question, 500, { required: false }), tz }).text;
    default: throw new AppError('Неизвестный экран');
  }
}

// Команда бота как есть («/reserve off», «/cycle 5»): ответ — текст бота
function viaCommand(data, today, ctx, text) {
  const r = handleMessage(text, data, today, { by: ctx.by });
  if (!r.changed) throw new AppError(stripTags(r.reply ?? 'Не получилось'));
  return { data: r.data, changed: true, result: { reply: r.reply } };
}

// p — результат validItem: once уже строка «ГГГГ-ММ»
function makeItem(p, by) {
  return {
    id: newId(), type: p.kind, amount: p.amount, name: p.name, by,
    ...(p.spread ? { spread: true, day: null, cat: p.cat && CATS[p.cat] ? p.cat : categorize(p.name) } : { day: p.day }),
    ...(p.once ? { once: p.once } : {}),
  };
}

function validItem(p, today) {
  const type = p.type;
  if (type !== 'income' && type !== 'bill') throw new AppError('Тип: доход или платёж');
  const amount = amountOf(p.amount);
  const name = textOf(p.name, 60);
  if (p.spread) {
    if (type !== 'bill') throw new AppError('Доходу нужна дата');
    return { kind: type, amount, name, spread: true, cat: p.cat };
  }
  const day = Number(p.day);
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new AppError('Число месяца 1–31');
  const out = { kind: type, amount, name, day };
  if (p.once) {
    if (!YM.test(String(p.once))) throw new AppError('Месяц в формате ГГГГ-ММ');
    out.once = String(p.once);
  }
  return out;
}

export function runAction(raw, today, ctx, action, p = {}) {
  const data = normalize(structuredClone(raw ?? {}));
  const by = ctx.by;
  const ok = (result = {}) => ({ data, changed: true, result });

  switch (action) {
    case 'item_add': {
      const v = validItem(p, today);
      data.items.push(makeItem(v, by));
      logEvent(data, today.ts, `добавлен ${v.kind === 'income' ? 'доход' : 'платёж'} «${v.name}» ${money(v.amount)}${v.spread ? ', в течение месяца' : `, ${v.day}-го`}`);
      return ok();
    }
    case 'spend_add': {
      const amount = amountOf(p.amount);
      const name = textOf(p.name, 60, { required: false });
      const cat = p.cat && CATS[p.cat] ? p.cat : categorize(name);
      const s = { id: newId(), amount, name, cat, ts: today.ts, by };
      data.spends.push(s);
      return ok({ id: s.id, cat });
    }
    case 'spend_undo': {
      const s = data.spends.pop();
      if (!s) throw new AppError('Нечего отменять');
      return ok({ undone: { amount: s.amount, name: s.name } });
    }
    case 'delete': {
      const id = String(p.id ?? '');
      const si = data.spends.findIndex((x) => x.id === id);
      if (si >= 0) {
        const [s] = data.spends.splice(si, 1);
        logEvent(data, today.ts, `удалена трата «${s.name}» ${money(s.amount)}`);
        return ok();
      }
      const i = data.items.findIndex((x) => x.id === id);
      if (i < 0) throw new AppError('Уже удалено');
      const [it] = data.items.splice(i, 1);
      logEvent(data, today.ts, `удалён пункт «${it.name}» ${money(it.amount)}`);
      return ok();
    }
    case 'edit': {
      const field = String(p.field);
      if (!['amount', 'name', 'when'].includes(field)) throw new AppError('Это поле нельзя изменить');
      const r = applyEdit(data, { id: String(p.id), field }, String(p.value ?? ''), today);
      if (r.error) throw new AppError(r.error);
      return ok();
    }
    case 'edit_cat': {
      const f = findRec(data, String(p.id));
      if (!f || (f.kind === 'item' && !f.rec.spread) || !CATS[p.cat]) throw new AppError('Запись не найдена');
      f.rec.cat = p.cat;
      f.rec.catManual = true;
      if (f.kind === 'spend' && f.rec.merchant) data.rules = { ...data.rules, [f.rec.merchant]: p.cat };
      logEvent(data, today.ts, `«${f.rec.name}»: категория ${CATS[p.cat].name}`);
      return ok();
    }
    case 'edit_link': {
      const f = findRec(data, String(p.id));
      if (!f || f.kind !== 'spend') throw new AppError('Запись не найдена');
      const link = String(p.link ?? 'auto');
      if (link === 'auto') delete f.rec.linkId;
      else if (link === 'none' || data.items.some((i) => i.id === link && i.spread)) f.rec.linkId = link;
      else throw new AppError('Такой статьи нет');
      logEvent(data, today.ts, `трата «${f.rec.name}»: привязка к обязательной трате изменена`);
      return ok();
    }
    case 'toggle_reserve': {
      const f = findRec(data, String(p.id));
      if (!f || f.kind !== 'item' || f.rec.spread || f.rec.type !== 'bill') throw new AppError('Запись не найдена');
      f.rec.fromReserve = !isReserveBill(f.rec);
      logEvent(data, today.ts, `«${f.rec.name}»: оплата ${f.rec.fromReserve ? 'из резерва' : 'с карты'}`);
      return ok();
    }
    case 'balance_set': {
      const amount = amountOf(p.amount, { allowZero: true });
      data.balance = { amount, ts: today.ts };
      logEvent(data, today.ts, `остаток на руках обновлён: ${money(amount)}`);
      return ok();
    }
    case 'topup': {
      const rec = applyTopup(data, today, amountOf(p.amount), textOf(p.name, 40, { required: false }) || 'Пополнение', by);
      return ok({ id: rec.id, mode: rec.mode });
    }
    case 'topup_undo': {
      const rec = undoTopup(data, String(p.id));
      if (!rec) throw new AppError('Уже отменено');
      return ok();
    }
    case 'occ': {
      const key = String(p.key ?? '');
      if (data.done?.[key]) throw new AppError('Уже учтено');
      const skipped = !!p.skip;
      const before = computePeriod(data, today);
      const owed = before.pendingBills.reduce((s, o) => s + o.amount, 0);
      const leftover = Math.floor(Math.max(0, before.now - owed) / 100) * 100;
      const occ = confirmOccurrence(data, key, today, skipped);
      if (!occ) throw new AppError('Не нашёл это событие');
      const f = fromDn(occ.dn);
      logEvent(data, today.ts, skipped
        ? `«${occ.name}» ${f.d}.${f.m + 1} — пропущено`
        : `${occ.type === 'income' ? 'пришло' : 'оплачено'}: «${occ.name}» ${money(occ.amount)}`);
      const result = { occ: occView(occ) };
      if (!skipped && occ.type === 'income') {
        const after = computePeriod(data, today);
        if (after.reserveOn && after.transferNow > 0) {
          const d1 = after.rplan.deadlines[0];
          result.transfer = {
            amount: after.transferNow, name: occ.name, need: d1.cum, have: after.rplan.have, deadline: occView({ dn: d1.dn, key: '', type: 'bill', name: '', amount: 0 }).date,
            later: d1.fundedBy.map((x) => ({ date: occView({ dn: x.dn, key: '', type: 'income', name: '', amount: 0 }).date, amount: x.amount })),
          };
        }
        if (leftover > 0 && data.balance) {
          const goals = data.goals.filter((g) => goalStatus(g, today).remaining > 0).slice(0, 3).map((g) => ({ id: g.id, name: g.name }));
          if (goals.length) result.leftover = { amount: leftover, goals };
        }
      }
      return ok(result);
    }
    case 'goal_add': {
      const name = textOf(p.name, 40);
      if (!YM.test(String(p.deadline))) throw new AppError('Срок в формате ГГГГ-ММ');
      const target = amountOf(p.target);
      data.goals.push({ id: newId(), name, target, deadline: String(p.deadline), saved: 0, by });
      logEvent(data, today.ts, `новая цель «${name}»: ${money(target)} до ${p.deadline}`);
      return ok();
    }
    case 'goal_delete': {
      const i = data.goals.findIndex((x) => x.id === String(p.id));
      if (i < 0) throw new AppError('Уже удалено');
      const [g] = data.goals.splice(i, 1);
      logEvent(data, today.ts, `удалена цель «${g.name}»`);
      return ok();
    }
    case 'goal_save': {
      const g = data.goals.find((x) => x.id === String(p.id));
      if (!g) throw new AppError('Цель не найдена');
      depositToGoal(data, today, g, amountOf(p.amount));
      return ok({ saved: g.saved, target: g.target });
    }
    case 'reserve_set': {
      const amount = amountOf(p.amount, { allowZero: true });
      const first = !data.reserve;
      data.reserve = { ...(data.reserve ?? {}), amount, ts: today.ts, history: [] };
      logEvent(data, today.ts, `остаток резерва на аренду: ${money(amount)}`);
      return ok({ askSubtract: first && !!data.balance && data.balance.amount >= amount && amount > 0 });
    }
    case 'reserve_subtract': {
      const amount = amountOf(p.amount);
      if (!data.balance) throw new AppError('Сначала задай остаток на руках');
      data.balance.amount = round2(data.balance.amount - amount);
      return ok();
    }
    case 'reserve_deposit': {
      depositReserve(data, today, amountOf(p.amount), 'manual');
      return ok({ total: data.reserve.amount });
    }
    case 'reserve_plan': {
      const it = data.items.find((i) => i.id === String(p.id) && i.type === 'income');
      if (!it) throw new AppError('Доход не найден');
      const amount = amountOf(p.amount, { allowZero: true });
      if (amount === 0) delete it.toReserve; else it.toReserve = amount;
      logEvent(data, today.ts, `взнос в резерв с «${it.name}»: ${amount ? money(amount) : 'авто'}`);
      return ok();
    }
    case 'reserve_off': return viaCommand(data, today, ctx, '/reserve off');
    case 'reserve_contract': return viaCommand(data, today, ctx, `/reserve contract ${String(p.number ?? '').replace(/\D/g, '')}`);
    case 'reserve_step': return viaCommand(data, today, ctx, `/reserve step ${amountOf(p.amount)}`);
    case 'transport': return viaCommand(data, today, ctx, `/transport ${amountOf(p.base)} ${amountOf(p.daily)}`);
    case 'cycle': {
      const v = String(p.day ?? 'auto');
      return viaCommand(data, today, ctx, `/cycle ${v === 'auto' ? 'auto' : Number(v)}`);
    }
    case 'digest': return viaCommand(data, today, ctx, `/digest ${p.on ? 'on' : 'off'}`);
    case 'reset': {
      if (p.confirm !== true) throw new AppError('Нужно подтверждение');
      Object.assign(data, emptyData());
      return ok();
    }
    case 'command': {
      const text = String(p.text ?? '').slice(0, 2000);
      const r = handleMessage(text, data, today, { by });
      let reply = r.reply;
      if (r.dashboard) reply = dash(r.data, today);
      if (r.ai) reply = buildPrompt(r.data, today, { question: r.ai.question }).text;
      if (!reply) throw new AppError('Команда не распознана. Список: /help');
      return { data: r.data, changed: r.changed, result: { reply, ai: !!r.ai } };
    }
    case 'nl': {
      // Свободный текст как в чате: траты и пополнения записываем сразу, остальное — на подтверждение
      const text = String(p.text ?? '').trim().slice(0, 2000);
      if (!text) throw new AppError('Пустой текст');
      if (text.includes('\n')) {
        const batch = parseBatch(text, today);
        if (!batch || !batch.items.length) throw new AppError(`Не смог разобрать строки:\n${(batch?.skipped ?? []).join('\n')}`);
        return { data, changed: false, result: { confirm: { kind: 'batch', items: batch.items, skipped: batch.skipped } } };
      }
      const r = parseAny(text, today);
      if (!r) throw new AppError('Не понял. Пример: «кофе 450» или «аванс 80к 5 числа»');
      if (r.kind === 'hint') return { data, changed: false, result: { reply: r.text } };
      if (r.kind === 'spend') {
        const s = { id: newId(), amount: r.amount, name: r.name, cat: r.cat, ts: today.ts, by };
        data.spends.push(s);
        return ok({ done: `🧾 ${money(r.amount)} · ${r.name}` });
      }
      if (r.kind === 'topup') {
        applyTopup(data, today, r.amount, r.name, by);
        return ok({ done: `💵 Баланс пополнен на ${money(r.amount)}` });
      }
      if (r.kind === 'rdeposit') {
        depositReserve(data, today, r.amount, 'manual');
        return ok({ done: `🏠 В резерв +${money(r.amount)}` });
      }
      if (r.kind === 'transport') return viaCommand(data, today, ctx, `/transport ${r.base} ${r.daily}`);
      if (r.kind === 'save') {
        const g = data.goals.find((x) => x.name.toLowerCase().includes(String(r.name ?? '').toLowerCase())) ?? (data.goals.length === 1 ? data.goals[0] : null);
        if (!g) throw new AppError('Не понял, в какую цель откладывать');
        depositToGoal(data, today, g, r.amount);
        return ok({ done: `🐷 В «${g.name}» +${money(r.amount)}` });
      }
      return { data, changed: false, result: { confirm: r } };
    }
    case 'nl_commit': {
      const c = p.confirm ?? {};
      if (c.kind === 'goal') {
        if (!YM.test(String(c.deadline))) throw new AppError('Срок в формате ГГГГ-ММ');
        data.goals.push({ id: newId(), name: textOf(c.name, 40), target: amountOf(c.amount), deadline: String(c.deadline), saved: 0, by });
        logEvent(data, today.ts, `новая цель «${c.name}»: ${money(c.amount)} до ${c.deadline}`);
        return ok();
      }
      const lines = c.kind === 'batch' ? (Array.isArray(c.items) ? c.items.slice(0, 50) : []) : [c];
      if (!lines.length) throw new AppError('Нечего записывать');
      for (const it of lines) {
        if (it.kind === 'spend') {
          data.spends.push({ id: newId(), amount: amountOf(it.amount), name: textOf(it.name, 60, { required: false }), cat: it.cat && CATS[it.cat] ? it.cat : categorize(it.name), ts: today.ts, by });
        } else {
          const v = validItem({ type: it.kind, amount: it.amount, name: it.name, day: it.day, spread: !!it.spread, cat: it.cat, once: it.once ? (it.onceYm ?? `${today.y}-${String(today.m + 1).padStart(2, '0')}`) : null }, today);
          data.items.push(makeItem(v, by));
        }
      }
      logEvent(data, today.ts, `ввод из текста: ${lines.map((it) => `${it.name} ${money(it.amount)}`).join(', ')}`);
      return ok({ count: lines.length });
    }
    case 'import_cancel': {
      data.pending = data.pending.filter((x) => x.id !== String(p.id));
      return ok();
    }
    case 'import_apply': {
      const pend = data.pending.find((x) => x.id === String(p.id) && x.kind === 'import');
      if (!pend) throw new AppError('Эта выписка уже обработана');
      data.pending = data.pending.filter((x) => x.id !== pend.id);
      for (const r of pend.rows) {
        data.spends.push({ id: newId(), amount: Math.abs(r.amount), name: r.name, cat: r.cat, ts: r.ts, by: pend.by ?? by, src: 'bank', h: r.h, merchant: r.merchant });
      }
      for (const dep of pend.deposits ?? []) {
        if (dep.dupOf) {
          const h = (data.reserve?.history ?? []).find((x) => x.ts === dep.dupOf);
          if (h) h.matched = true;
        } else {
          depositReserve(data, today, dep.amount, 'bank', dep.h);
          data.reserve.history[data.reserve.history.length - 1].ts = dep.ts;
        }
      }
      data.imported = [...data.imported, ...pend.seen].slice(-3000);
      const withBalance = !!p.withBalance && !!pend.balance;
      if (withBalance) {
        const [dd, mm, yyyy] = pend.balance.date.split('.').map(Number);
        data.balance = { amount: pend.balance.amount, ts: Math.min(today.ts, zonedTs(yyyy, mm, dd, 23, 59, ctx.tz ?? 'Europe/Moscow')) };
      }
      const total = pend.rows.reduce((s, r) => s + Math.abs(r.amount), 0);
      logEvent(data, today.ts, `импорт выписки: ${pend.rows.length} трат на ${money(total)}${withBalance ? ', остаток обновлён' : ''}`);
      return ok({ rows: pend.rows.length, total });
    }
    default:
      throw new AppError('Неизвестное действие');
  }
}

// Разбор PDF-выписки: сохраняет карточку импорта в данных и возвращает предпросмотр
export async function importParse(raw, today, ctx, buffer, { pdfText = extractPdfText } = {}) {
  const data = normalize(structuredClone(raw ?? {}));
  let parsed;
  try {
    parsed = parseStatementText(await pdfText(buffer), ctx.tz);
  } catch {
    throw new AppError('Не получилось прочитать PDF. Нужна «Справка о движении средств» Т-Банка без пароля.');
  }
  if (!parsed.rows.length) throw new AppError('Не нашёл операций. Это должна быть «Справка о движении средств» Т-Банка.');
  const prep = prepareImport(data, parsed, ctx.tz);
  const pend = {
    id: newId(), kind: 'import', by: ctx.by,
    rows: prep.fresh.map((r) => ({ ts: r.ts, amount: r.amount, name: r.name, cat: r.cat, merchant: r.merchant, h: r.h })),
    seen: [...prep.fresh, ...prep.dupManual, ...prep.bills, ...prep.deposits].map((r) => r.h),
    deposits: prep.deposits.map(({ ts, amount, h, dupOf }) => ({ ts, amount, h, dupOf })),
    balance: parsed.balance,
  };
  data.pending = [...data.pending.filter((x) => x.kind !== 'import'), pend].slice(-10);
  return {
    data, changed: true,
    result: {
      id: pend.id, rows: pend.rows.length, deposits: pend.deposits.length, balance: parsed.balance ?? null,
      total: pend.rows.reduce((s, r) => s + Math.abs(r.amount), 0),
      sample: pend.rows.slice(0, 30).map(({ ts, amount, name, cat }) => ({ ts, amount, name, cat })),
      preview: previewText(prep, parsed, ctx.tz),
    },
  };
}
