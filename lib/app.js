// Действия мини-приложения: те же операции, что у бота, но с данными вместо текста.
// runAction мутирует копию данных и возвращает { data, changed, result }; ввод-вывод — в appserver.js.
import { newId, normalize, emptyData, applyTopup, undoTopup, depositToGoal, handleMessage } from './bot.js';
import { CATS, categorize } from './cats.js';
import { computePlan, goalStatus, round2 } from './budget.js';
import { computePeriod, fromDn, isReserveBill, cardBalance } from './period.js';
import { findRec, applyEdit } from './edit.js';
import { logEvent, buildPrompt } from './prompt.js';
import { parseAny } from './nlp.js';
import { parseBatch } from './batch.js';
import { depositReserve, formatReserve } from './reserve.js';
import { extractPdfText, parseStatementText, prepareImport, previewText } from './statement.js';
import { formatPlanFull } from './planview.js';
import { formatForecast } from './forecast.js';
import { formatChart } from './charts.js';
import { formatGuide } from './guide.js';
import { formatDigest } from './digest.js';
import { formatGoals } from './goals.js';
import { formatHelp, formatList, money } from './format.js';
import { dashText as dash } from './dash.js';
import { sizeReport } from './size.js';
import { spendsToCsv } from './csv.js';
import { addGoal, applyImport, confirmOcc, makeImportPending, removeRecord, setCategory, setLink, toggleReserve } from './ops.js';

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
    usage: (({ bytes, percent, warn }) => ({ bytes, percent, warn }))(sizeReport(data)),
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
    case 'spend_restore': {
      // «Отменить» после свайп-удаления: возвращаем трату с прежним временем, а не «сейчас»
      const ts = Number(p.ts);
      if (!Number.isFinite(ts) || ts <= 0 || ts > today.ts + 86_400_000) throw new AppError('Некорректная дата траты');
      const cat = p.cat && CATS[p.cat] ? p.cat : categorize(String(p.name ?? ''));
      const s = { id: newId(), amount: amountOf(p.amount), name: textOf(p.name, 60, { required: false }), cat, ts, by: p.by ? textOf(p.by, 40) : by };
      for (const k of ['src', 'merchant']) if (typeof p[k] === 'string') s[k] = p[k].slice(0, 80);
      data.spends.push(s);
      return ok({ id: s.id });
    }
    case 'spend_undo': {
      const s = data.spends.pop();
      if (!s) throw new AppError('Нечего отменять');
      return ok({ undone: { amount: s.amount, name: s.name } });
    }
    case 'delete': {
      if (!removeRecord(data, today, String(p.id ?? ''))) throw new AppError('Уже удалено');
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
      if (!setCategory(data, today, String(p.id), p.cat)) throw new AppError('Запись не найдена');
      return ok();
    }
    case 'edit_link': {
      const id = String(p.id);
      if (findRec(data, id)?.kind !== 'spend') throw new AppError('Запись не найдена');
      if (!setLink(data, today, id, String(p.link ?? 'auto'))) throw new AppError('Такой статьи нет');
      return ok();
    }
    case 'toggle_reserve': {
      if (!toggleReserve(data, today, String(p.id))) throw new AppError('Запись не найдена');
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
      const done = confirmOcc(data, today, key, skipped);
      if (!done) throw new AppError('Не нашёл это событие');
      const { occ, leftover } = done;
      const result = { occ: occView(occ) };
      if (!skipped && occ.type === 'income') {
        const after = done.after;
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
      addGoal(data, today, { name, amount: target, deadline: String(p.deadline), by });
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
    case 'export_csv': {
      // Файл уходит в личный чат пользователя с ботом: здесь только готовим содержимое
      const month = /^\d{4}-\d{2}$/.test(String(p.month ?? '')) ? String(p.month) : null;
      const inMonth = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: ctx.tz ?? 'Europe/Moscow' }).startsWith(month);
      const rows = data.spends.filter((s) => !month || inMonth(s.ts));
      if (!rows.length) throw new AppError('Трат для выгрузки нет');
      return { data, changed: false, result: { csv: spendsToCsv(rows, { tz: ctx.tz }), rows: rows.length } };
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
        addGoal(data, today, { name: textOf(c.name, 40), amount: amountOf(c.amount), deadline: String(c.deadline), by });
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
      const { rows, total } = applyImport(data, today, pend, { withBalance: !!p.withBalance, by, tz: ctx.tz ?? 'Europe/Moscow' });
      return ok({ rows, total });
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
  const pend = makeImportPending(prep, parsed, ctx.by);
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
