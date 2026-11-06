// Обработка апдейтов Telegram: сообщения, фразы, кнопки, живая сводка.
// store: { load(chatId), save(chatId, data) }, tg: см. lib/tg.js — оба подменяются в тестах.
import { handleMessage, normalize, newId, applyTopup, undoTopup, depositToGoal } from './bot.js';
import { categorize } from './cats.js';
import { parseAny } from './nlp.js';
import { parseBatch } from './batch.js';
import { formatGuide } from './guide.js';
import { ymOf, computePlan } from './budget.js';
import { catName } from './cats.js';
import { ymLabelShort, formatList, listMarkup, dashMarkup, esc, money, dateStr } from './format.js';
import { overspendAlerts } from './digest.js';
import { dashText } from './dash.js';
import { findGoal, formatGoals, goalsMarkup, ymLabel, goalStatus } from './goals.js';
import { formatChart } from './charts.js';
import { formatForecast, forecastMarkup } from './forecast.js';
import { formatPlanFull } from './planview.js';
import { AWAIT_TTL, PROMPTS, applyEdit, catMarkup, editCard, editMarkup, findRec, linkMarkup } from './edit.js';
import { CATS } from './cats.js';
import { extractPdfText, parseStatementText, prepareImport, previewText, zonedTs } from './statement.js';
import { computePeriod, confirmOccurrence, fromDn, isReserveBill, cardBalance } from './period.js';
import { depositReserve, setTransportFormula } from './reserve.js';
import { parseAmount } from './parse.js';
import { buildPrompt, logEvent } from './prompt.js';
import { appUrl } from './webapp.js';

const HINTS = {
  inc: '💰 Напиши, например:\n«аванс 80к 5 числа» — каждый месяц\n«премия 20к разово» — один раз',
  bill: '📌 Напиши, например:\n«аренда 25000 1-го числа»\n«интернет 700 15 числа»',
  spend: '🧾 Напиши, например:\n«кофе 450», «такси 300», «продукты 2500»',
};

const TZ = () => process.env.TZ_NAME || 'Europe/Moscow';

// Когда срабатывает пункт: «каждое 5-е», «в течение месяца», «разово, ноябрь 2026»
function whenText(p, today) {
  if (p.spread) return '📆 В течение месяца';
  if (p.once) {
    const ym = p.onceYm ?? ymOf(today);
    return ym === ymOf(today)
      ? `1️⃣ Один раз в этом месяце · ${dateStr(p.day, today.m)}`
      : `1️⃣ Один раз · ${p.day}-го, ${ymLabelShort(ym)}`;
  }
  return `🔁 Каждый месяц · ${p.day}-го числа`;
}

function batchLine(it, today) {
  if (it.kind === 'spend') return `🧾 ${esc(it.name)} — ${money(it.amount)} · ${catName(it.cat)}`;
  const icon = it.kind === 'income' ? '💰' : '📌';
  return `${icon} ${esc(it.name)} — ${money(it.amount)} · ${whenText(it, today)}`;
}

// Пункт для хранения из распознанной записи (карточки или пакета)
function makeItem(p, by, today) {
  return {
    id: newId(), type: p.kind, amount: p.amount, name: p.name, by,
    ...(p.spread ? { spread: true, day: null, cat: p.cat ?? categorize(p.name) } : { day: p.day }),
    ...(p.once ? { once: p.onceYm ?? ymOf(today) } : {}),
  };
}

function cardText(p, today) {
  if (p.kind === 'batch') {
    const L = [`📥 Записать ${p.items.length} ${p.items.length === 1 ? 'пункт' : p.items.length < 5 ? 'пункта' : 'пунктов'}?`, ''];
    L.push(...p.items.map((it) => batchLine(it, today)));
    if (p.skipped?.length) L.push('', '⚠️ Не разобрал (проверь и отправь отдельно):', ...p.skipped.map((s) => `• ${esc(s)}`));
    return L.join('\n');
  }
  if (p.kind === 'goal') {
    return `🎯 Создать цель накопления?\n<b>${esc(p.name)}</b> — <b>${money(p.amount)}</b>\nК сроку: ${ymLabel(p.deadline)}`;
  }
  const icon = p.kind === 'income' ? '💰 Записать доход?' : '📌 Записать обязательную трату?';
  const when = whenText(p, today);
  let tip = '';
  if (p.spread) tip = '\n<i>Это сумма на весь месяц (например, транспорт). Если платёж в конкретный день — укажи число: «аренда 25000 1 числа»</i>';
  else if (p.dayAuto && p.kind === 'income' && !p.onceYm) tip = '\n<i>Чтобы повторялось каждый месяц, укажи число: «зарплата 80к 10 числа»</i>';
  else if (p.once && !p.onceYm) tip += '\n<i>Другой месяц: добавь «в ноябре» или «5 декабря»</i>';
  return `${icon}\n<b>${esc(p.name)}</b> — <b>${money(p.amount)}</b>\n${when}${tip}`;
}

const cardMarkup = (p) => ({
  inline_keyboard: [
    [
      { text: '✅ Записать', callback_data: `ok:${p.id}` },
      { text: '❌ Отмена', callback_data: `no:${p.id}` },
    ],
    ...(p.kind === 'goal' || p.kind === 'batch' || p.spread ? [] : [[{ text: p.once ? '🔁 Сделать ежемесячным' : '1️⃣ Только в этом месяце', callback_data: `tg:${p.id}` }]]),
  ],
});

async function sendAlerts(chatId, before, after, today, tg) {
  const alerts = overspendAlerts(before, after, today);
  if (alerts.length) await tg.send(chatId, alerts.join('\n\n'));
}

export async function refreshDash(chatId, data, today, { store, tg }) {
  if (!data.dash?.mid) return;
  const res = await tg.edit(chatId, data.dash.mid, dashText(data, today), { reply_markup: dashMarkup(data, today) });
  if (res && res.ok === false && !/not modified/i.test(res.description ?? '')) {
    data.dash = null; // сообщение удалено — при следующем /plan создадим новое
    await store.save(chatId, data);
  }
}

async function sendDash(chatId, data, today, { store, tg }) {
  const res = await tg.send(chatId, dashText(data, today), { reply_markup: dashMarkup(data, today) });
  const mid = res?.result?.message_id;
  if (mid) {
    data.dash = { mid };
    await store.save(chatId, data);
    await tg.pin(chatId, mid).catch(() => {});
  }
}

// Промт для ручной вставки в чат с ИИ + список изменений с прошлого раза
async function sendAi(chatId, data, today, { store, tg }, question) {
  const { text, changes } = buildPrompt(data, today, { question, tz: TZ() });
  await tg.send(
    chatId,
    '🤖 <b>Промт для ИИ готов.</b>\nСкопируй блок ниже целиком (нажми на него — Telegram скопирует) и вставь в ChatGPT, Claude или другой чат с ИИ. '
      + `В конце — что изменилось с прошлого раза (${changes.length ? `пунктов: ${changes.length}` : 'изменений нет'}).`,
  );
  await tg.send(chatId, `<pre>${esc(text)}</pre>`);
  data.lastExport = { ts: today.ts };
  await store.save(chatId, data);
}

// Выписка Т-Банка (PDF): разбираем и показываем карточку с итогами до записи
async function onDocument(msg, deps) {
  const { store, tg, today } = deps;
  const doc = msg.document;
  const isPdf = doc.mime_type === 'application/pdf' || /\.pdf$/i.test(doc.file_name ?? '');
  if (!isPdf) return;
  const chatId = msg.chat.id;
  const by = msg.from?.first_name ?? undefined;
  if ((doc.file_size ?? 0) > 15 * 1024 * 1024) {
    await tg.send(chatId, '📄 Файл слишком большой. Выгрузи выписку за более короткий период.');
    return;
  }
  await tg.send(chatId, '📄 Читаю выписку…');
  let parsed;
  try {
    const info = await tg.getFile(doc.file_id);
    const buffer = await tg.download(info.result.file_path);
    parsed = parseStatementText(await (deps.pdfText ?? extractPdfText)(buffer), TZ());
  } catch (err) {
    console.error('statement error', err);
    await tg.send(chatId, '😵 Не получилось прочитать PDF. Пришли «Справку о движении средств» Т-Банка файлом без пароля.');
    return;
  }
  if (!parsed.rows.length) {
    await tg.send(chatId, '🤔 Не нашёл операций. Это должна быть «Справка о движении средств» Т-Банка (PDF из приложения: Счёт → Выписка).');
    return;
  }
  const data = normalize(await store.load(chatId));
  const prep = prepareImport(data, parsed, TZ());
  const pend = {
    id: newId(), kind: 'import', by,
    rows: prep.fresh.map((r) => ({ ts: r.ts, amount: r.amount, name: r.name, cat: r.cat, merchant: r.merchant, h: r.h })),
    seen: [...prep.fresh, ...prep.dupManual, ...prep.bills, ...prep.deposits].map((r) => r.h),
    deposits: prep.deposits.map(({ ts, amount, h, dupOf }) => ({ ts, amount, h, dupOf })),
    balance: parsed.balance,
  };
  data.pending = [...data.pending.filter((x) => x.kind !== 'import'), pend].slice(-10);
  await store.save(chatId, data);
  const rows = [];
  if (pend.rows.length || pend.deposits.length) {
    if (parsed.balance) rows.push([{ text: '✅ Записать траты и задать остаток', callback_data: `ix:${pend.id}:b` }]);
    rows.push([{ text: pend.rows.length ? '✅ Записать только траты' : '✅ Готово', callback_data: `ix:${pend.id}:n` }]);
  } else if (parsed.balance) {
    rows.push([{ text: '💼 Только задать остаток', callback_data: `ix:${pend.id}:b` }]);
  }
  rows.push([{ text: '❌ Отмена', callback_data: `no:${pend.id}` }]);
  await tg.send(chatId, previewText(prep, parsed, TZ()), { reply_markup: { inline_keyboard: rows } });
}

// /app: в личном чате — кнопка запуска; в беседе кнопки web_app запрещены, поэтому объясняем, как открыть
async function openApp(msg, deps) {
  const { tg } = deps;
  const chatId = msg.chat.id;
  if (msg.chat.type === 'private') {
    try { await tg.setMenuButton?.(chatId, appUrl()); } catch (e) { console.error('menu button', e); }
    return tg.send(chatId, '📱 <b>Мини-приложение</b> — весь бюджет в удобном виде: траты, план, цели, резерв, импорт выписки. Кнопка «Бюджет» теперь и в меню чата.', {
      reply_markup: { inline_keyboard: [[{ text: '📱 Открыть приложение', web_app: { url: appUrl() } }]] },
    });
  }
  let name = '';
  try { name = (await tg.getMe?.())?.result?.username ?? ''; } catch { /* не критично */ }
  return tg.send(chatId, `📱 Мини-приложение открывается в личном чате с ботом${name ? ` — @${name}` : ''}: нажми /app там (или кнопку «Бюджет» в меню). Бюджет этой беседы появится в списке, как только ты здесь напишешь боту.`);
}

async function onMessage(msg, deps) {
  const { store, tg, today } = deps;
  if (msg.document) return onDocument(msg, deps);
  const text = msg.text;
  if (!text) return;
  const chatId = msg.chat.id;
  const by = msg.from?.first_name ?? undefined;
  const hasSlash = text.split('\n').some((l) => l.trim().startsWith('/'));

  // Мини-приложение: /app открывает его, /start в личном чате ставит кнопку меню
  const cmd = text.trim().match(/^\/(app|start)(@\w+)?(\s|$)/i)?.[1]?.toLowerCase();
  if (cmd === 'app') return openApp(msg, deps);
  if (cmd === 'start' && msg.chat.type === 'private') {
    try { await tg.setMenuButton?.(chatId, appUrl()); } catch (e) { console.error('menu button', e); }
  }

  // Ждём от пользователя новое значение для редактируемой записи
  const peek = await store.load(chatId);
  if (peek?.awaiting) {
    const cur = normalize(peek);
    const aw = cur.awaiting;
    const stale = today.ts - aw.ts > AWAIT_TTL;
    if (stale || text.trim().startsWith('/')) {
      cur.awaiting = null;
      await store.save(chatId, cur);
    } else if (aw.uid && msg.from?.id !== aw.uid) {
      return; // отвечает не тот, кто редактирует
    } else if (aw.kind === 'deposit') {
      const amt = parseAmount(text.trim().replace(/\s/g, '').toLowerCase());
      if (!amt) {
        await tg.send(chatId, '⚠️ Не понял сумму. Пример: 30000 или 30к.');
        return;
      }
      depositReserve(cur, today, amt, 'manual');
      cur.awaiting = null;
      await store.save(chatId, cur);
      await tg.send(chatId, `🏠 В резерв на аренду +${money(amt)}. Всего отложено <b>${money(cur.reserve.amount)}</b>.`);
      await refreshDash(chatId, cur, today, deps);
      return;
    } else {
      const r = applyEdit(cur, aw, text, today);
      if (r.error) {
        await tg.send(chatId, `⚠️ ${r.error}`);
        if (r.gone) { cur.awaiting = null; await store.save(chatId, cur); }
        return;
      }
      cur.awaiting = null;
      await store.save(chatId, cur);
      await tg.edit(chatId, aw.mid, editCard(r.found, TZ(), cur), { reply_markup: editMarkup(r.found, cur) });
      await tg.send(chatId, '✅ Обновлено');
      await refreshDash(chatId, cur, today, deps);
      return;
    }
  }

  if (hasSlash) {
    const stored = await store.load(chatId);
    const before = structuredClone(normalize(stored));
    const r = handleMessage(text, stored, today, { by });
    if (r.changed) await store.save(chatId, r.data);
    if (r.reply) await tg.send(chatId, r.reply, r.markup ? { reply_markup: r.markup } : {});
    if (r.changed) await sendAlerts(chatId, before, r.data, today, tg);
    if (r.ai) await sendAi(chatId, r.data, today, deps, r.ai.question);
    if (r.dashboard) await sendDash(chatId, r.data, today, deps);
    else if (r.changed) await refreshDash(chatId, r.data, today, deps);
    return;
  }

  if (text.trim().includes('\n')) {
    const batch = parseBatch(text, today);
    if (batch) {
      const data = normalize(await store.load(chatId));
      const pend = { id: newId(), kind: 'batch', items: batch.items, skipped: batch.skipped, by };
      if (!pend.items.length) {
        await tg.send(chatId, `🤔 Не смог разобрать строки:\n${pend.skipped.map((s) => `• ${esc(s)}`).join('\n')}\n\nПример: <code>аренда 25000 1</code> под заголовком «Обязательные:». Подсказка: /guide`);
        return;
      }
      data.pending = [...data.pending, pend].slice(-10);
      await store.save(chatId, data);
      await tg.send(chatId, cardText(pend, today), { reply_markup: cardMarkup(pend) });
    }
    return;
  }

  const p = parseAny(text, today);
  if (!p) return;
  const data = normalize(await store.load(chatId));

  if (p.kind === 'hint') {
    await tg.send(chatId, p.text);
    return;
  }
  if (p.kind === 'spend') {
    const before = structuredClone(data);
    const s = { id: newId(), amount: p.amount, name: p.name, cat: p.cat, ts: today.ts, by };
    data.spends.push(s);
    await store.save(chatId, data);
    await tg.send(chatId, `🧾 ${money(p.amount)} · ${esc(p.name)} · ${catName(p.cat)} ✅`, {
      reply_markup: { inline_keyboard: [[{ text: '↩️ Отменить', callback_data: `undo:${s.id}` }]] },
    });
    await sendAlerts(chatId, before, data, today, tg);
    await refreshDash(chatId, data, today, deps);
    return;
  }
  if (p.kind === 'topup') {
    const rec = applyTopup(data, today, p.amount, p.name, by);
    await store.save(chatId, data);
    const where = rec.mode === 'balance' ? `Теперь на карте ${money(cardBalance(data))}.` : 'Остаток на руках не задан — записал как разовый доход на сегодня.';
    await tg.send(chatId, `💵 Баланс пополнен на <b>${money(p.amount)}</b> (${esc(p.name)}). ${where}`, {
      reply_markup: { inline_keyboard: [[{ text: '↩️ Отменить', callback_data: `utop:${rec.id}` }]] },
    });
    await refreshDash(chatId, data, today, deps);
    return;
  }
  if (p.kind === 'rdeposit') {
    depositReserve(data, today, p.amount, 'manual');
    await store.save(chatId, data);
    await tg.send(chatId, `🏠 В резерв на аренду +${money(p.amount)}. Всего отложено <b>${money(data.reserve.amount)}</b>.`);
    await refreshDash(chatId, data, today, deps);
    return;
  }
  if (p.kind === 'transport') {
    const r = setTransportFormula(data, today, p.base, p.daily, newId);
    await store.save(chatId, data);
    await tg.send(chatId, `🚌 Транспорт: ${money(p.base)} + ${money(p.daily)} × ${r.weekdays} будних дней = <b>${money(r.it.amount)}</b> на текущий цикл. Дальше пересчитаю сам.`);
    await refreshDash(chatId, data, today, deps);
    return;
  }
  if (p.kind === 'save') {
    const g = findGoal(data, p.name);
    if (!g) {
      await tg.send(chatId, data.goals.length ? 'Не понял, в какую цель откладывать. Список: /goals' : 'Целей пока нет. Создай: «цель 200к к июню отпуск»');
      return;
    }
    depositToGoal(data, today, g, p.amount);
    await store.save(chatId, data);
    await tg.send(chatId, `🐷 В копилку «${esc(g.name)}»: +${money(p.amount)}. Накоплено ${money(g.saved)} из ${money(g.target)} ✅`);
    await refreshDash(chatId, data, today, deps);
    return;
  }

  const pend = {
    id: newId(), kind: p.kind, amount: p.amount, day: p.day, name: p.name,
    once: p.once, onceYm: p.onceYm ?? null, spread: !!p.spread, cat: p.cat, dayAuto: p.dayAuto, deadline: p.deadline, by,
  };
  data.pending = [...data.pending, pend].slice(-10);
  await store.save(chatId, data);
  await tg.send(chatId, cardText(pend, today), { reply_markup: cardMarkup(pend) });
}

async function onCallback(cb, deps) {
  const { store, tg, today } = deps;
  const msg = cb.message;
  if (!msg) return tg.answer(cb.id);
  const chatId = msg.chat.id;
  const mid = msg.message_id;
  const [action, arg, arg2] = String(cb.data ?? '').split(':');
  const data = normalize(await store.load(chatId));
  const by = cb.from?.first_name;

  switch (action) {
    case 'ok': {
      const p = data.pending.find((x) => x.id === arg);
      if (!p) { await tg.answer(cb.id, 'Уже обработано'); return tg.edit(chatId, mid, '🤷 Эта карточка устарела.'); }
      data.pending = data.pending.filter((x) => x.id !== arg);
      if (p.kind === 'batch') {
        const before = structuredClone(data);
        for (const it of p.items) {
          if (it.kind === 'spend') {
            data.spends.push({ id: newId(), amount: it.amount, name: it.name, cat: it.cat, ts: today.ts, by: p.by ?? by });
          } else {
            data.items.push(makeItem(it, p.by ?? by, today));
          }
        }
        logEvent(data, today.ts, `пакетный ввод: ${p.items.map((it) => `${it.name} ${money(it.amount)}`).join(', ')}`);
        await store.save(chatId, data);
        await tg.answer(cb.id, 'Записано ✅');
        await tg.edit(chatId, mid, `✅ Записано пунктов: ${p.items.length}\n\n${p.items.map((it) => batchLine(it, today)).join('\n')}`);
        await sendAlerts(chatId, before, data, today, tg);
        return refreshDash(chatId, data, today, deps);
      }
      if (p.kind === 'goal') {
        data.goals.push({ id: newId(), name: p.name, target: p.amount, deadline: p.deadline, saved: 0, by: p.by ?? by });
        logEvent(data, today.ts, `новая цель «${p.name}»: ${money(p.amount)} до ${ymLabel(p.deadline)}`);
        await store.save(chatId, data);
        await tg.answer(cb.id, 'Цель создана 🎯');
        await tg.edit(chatId, mid, `🎯 Цель создана: <b>${esc(p.name)}</b> — ${money(p.amount)} до ${ymLabel(p.deadline)}`);
        return refreshDash(chatId, data, today, deps);
      }
      data.items.push(makeItem(p, p.by ?? by, today));
      logEvent(data, today.ts, `добавлен ${p.kind === 'income' ? 'доход' : 'платёж'} «${p.name}» ${money(p.amount)}, ${whenText(p, today).replace(/^\S+\s/, '')}`);
      await store.save(chatId, data);
      await tg.answer(cb.id, 'Записано ✅');
      await tg.edit(chatId, mid, `✅ Записано: <b>${esc(p.name)}</b> — ${money(p.amount)} · ${whenText(p, today).replace(/^\S+\s/, '')}`);
      return refreshDash(chatId, data, today, deps);
    }
    case 'no': {
      data.pending = data.pending.filter((x) => x.id !== arg);
      await store.save(chatId, data);
      await tg.answer(cb.id, 'Отменено');
      return tg.edit(chatId, mid, '❌ Не записываю.');
    }
    case 'tg': {
      const p = data.pending.find((x) => x.id === arg);
      if (!p) return tg.answer(cb.id, 'Карточка устарела');
      p.once = !p.once;
      await store.save(chatId, data);
      await tg.answer(cb.id);
      return tg.edit(chatId, mid, cardText(p, today), { reply_markup: cardMarkup(p) });
    }
    case 'undo': {
      const i = data.spends.findIndex((s) => s.id === arg);
      if (i < 0) return tg.answer(cb.id, 'Уже отменено');
      const [s] = data.spends.splice(i, 1);
      await store.save(chatId, data);
      await tg.answer(cb.id, 'Отменено ↩️');
      await tg.edit(chatId, mid, `↩️ Отменено: ${money(s.amount)} ${esc(s.name)}`);
      return refreshDash(chatId, data, today, deps);
    }
    case 'utop': {
      const rec = undoTopup(data, arg);
      if (!rec) return tg.answer(cb.id, 'Уже отменено');
      logEvent(data, today.ts, `пополнение «${rec.name}» ${money(rec.amount)} отменено`);
      await store.save(chatId, data);
      await tg.answer(cb.id, 'Отменено ↩️');
      await tg.edit(chatId, mid, `↩️ Пополнение отменено: ${money(rec.amount)}`);
      return refreshDash(chatId, data, today, deps);
    }
    case 'cf': case 'sk': {
      const key = `${arg}:${arg2}`; // ключ события = id пункта + дата
      if (data.done?.[key]) return tg.answer(cb.id, 'Уже учтено');
      const skipped = action === 'sk';
      const before = computePeriod(data, today);
      // Неизрасходованный остаток прошлого периода: деньги, которые не нужны на платежи прямо сейчас
      const owed = before.pendingBills.reduce((s, o) => s + o.amount, 0);
      const leftover = Math.floor(Math.max(0, before.now - owed) / 100) * 100;
      const occ = confirmOccurrence(data, key, today, skipped);
      if (!occ) return tg.answer(cb.id, 'Не нашёл это событие');
      logEvent(data, today.ts, skipped
        ? `«${occ.name}» ${dateStr(fromDn(occ.dn).d, fromDn(occ.dn).m)} — пропущено`
        : `${occ.type === 'income' ? 'пришло' : 'оплачено'}: «${occ.name}» ${money(occ.amount)}`);
      await store.save(chatId, data);
      await tg.answer(cb.id, skipped ? 'Пропустил' : occ.type === 'income' ? 'Деньги учтены 💚' : 'Платёж учтён ✅');
      if (!skipped && occ.type === 'income') {
        // Деньги пришли: напоминаем перевести часть на резерв для аренды, коммуналки и интернета
        const after = computePeriod(data, today);
        if (after.reserveOn && after.transferNow > 0) {
          const d1 = after.rplan.deadlines[0];
          const later = d1.fundedBy.map((f) => `${dateStr(fromDn(f.dn).d, fromDn(f.dn).m)} +${money(f.amount)}`).join(', ');
          await tg.send(chatId, [
            `🏠 <b>${esc(occ.name)}</b> пришёл. Переведи на резерв <b>${money(after.transferNow)}</b>.`,
            `К ${dateStr(fromDn(d1.dn).d, fromDn(d1.dn).m)} нужно ${money(d1.cum)}, в резерве ${money(after.rplan.have)}${later ? `, остальное закроет доход: ${later}` : ''}.`,
          ].join('\n'), {
            reply_markup: { inline_keyboard: [
              [{ text: `✅ Перевёл ${money(after.transferNow)}`, callback_data: `rd:${after.transferNow}` }],
              [{ text: '✏️ Другая сумма', callback_data: 'rd:x' }],
            ] },
          });
        }
      }
      if (!skipped && occ.type === 'income' && leftover > 0 && data.balance) {
        const goals = data.goals.filter((g) => goalStatus(g, today).remaining > 0).slice(0, 3);
        if (goals.length) {
          await tg.send(chatId, `🎉 <b>${esc(occ.name)}</b> пришёл. За прошлый период не потрачено <b>${money(leftover)}</b>.\nОтложить в цель?`, {
            reply_markup: { inline_keyboard: [
              ...goals.map((g) => [{ text: `🎯 ${g.name.slice(0, 24)} +${money(leftover)}`, callback_data: `lg:${g.id}:${leftover}` }]),
              [{ text: 'Оставить себе', callback_data: 'lg:no:0' }],
            ] },
          });
        }
      }
      return refreshDash(chatId, data, today, deps);
    }
    case 'ix': {
      const p = data.pending.find((x) => x.id === arg && x.kind === 'import');
      if (!p) { await tg.answer(cb.id, 'Уже обработано'); return tg.edit(chatId, mid, '🤷 Эта карточка устарела.'); }
      data.pending = data.pending.filter((x) => x.id !== arg);
      for (const r of p.rows) {
        data.spends.push({
          id: newId(), amount: Math.abs(r.amount), name: r.name, cat: r.cat, ts: r.ts,
          by: p.by ?? by, src: 'bank', h: r.h, merchant: r.merchant,
        });
      }
      for (const dep of p.deposits ?? []) {
        if (dep.dupOf) {
          const h = (data.reserve?.history ?? []).find((x) => x.ts === dep.dupOf);
          if (h) h.matched = true; // этот перевод уже записан вручную
        } else {
          depositReserve(data, today, dep.amount, 'bank', dep.h);
          data.reserve.history[data.reserve.history.length - 1].ts = dep.ts;
        }
      }
      data.imported = [...data.imported, ...p.seen].slice(-3000);
      let balText = '';
      if (arg2 === 'b' && p.balance) {
        const [dd, mm, yyyy] = p.balance.date.split('.').map(Number);
        const endTs = zonedTs(yyyy, mm, dd, 23, 59, TZ());
        data.balance = { amount: p.balance.amount, ts: Math.min(today.ts, endTs) };
        balText = `
💼 Остаток на руках: ${money(p.balance.amount)} (на ${p.balance.date})`;
      }
      const total = p.rows.reduce((s, r) => s + Math.abs(r.amount), 0);
      logEvent(data, today.ts, `импорт выписки: ${p.rows.length} трат на ${money(total)}${arg2 === 'b' ? ', остаток обновлён' : ''}`);
      await store.save(chatId, data);
      await tg.answer(cb.id, 'Импортировано ✅');
      await tg.edit(chatId, mid, `✅ Из выписки записано трат: ${p.rows.length} на ${money(total)}.${balText}`);
      return refreshDash(chatId, data, today, deps);
    }
    case 'rd': {
      if (arg === 'x') {
        data.awaiting = { kind: 'deposit', uid: cb.from?.id, mid, ts: today.ts };
        await store.save(chatId, data);
        await tg.answer(cb.id);
        return tg.send(chatId, '🏠 Сколько перевёл на резерв? Пришли сумму, например <code>30000</code>.', {
          reply_markup: { inline_keyboard: [[{ text: '✖️ Отмена', callback_data: 'eq' }]] },
        });
      }
      const amt = Number(arg);
      if (!(amt > 0)) return tg.answer(cb.id);
      depositReserve(data, today, amt, 'manual');
      await store.save(chatId, data);
      await tg.answer(cb.id, 'Записал 🏠');
      await tg.edit(chatId, mid, `🏠 В резерв на аренду +${money(amt)}. Всего отложено <b>${money(data.reserve.amount)}</b>.`);
      return refreshDash(chatId, data, today, deps);
    }
    case 'rb': {
      const amt = Number(arg);
      if (amt > 0 && data.balance) data.balance.amount = Math.round((data.balance.amount - amt) * 100) / 100;
      await store.save(chatId, data);
      await tg.answer(cb.id, 'Готово');
      await tg.edit(chatId, mid, amt > 0 && data.balance ? `✅ Остаток на карте теперь ${money(cardBalance(data))} (резерв ${money(data.reserve?.amount ?? 0)} лежит отдельно).` : '👌 Остаток на карте оставляю как есть.');
      return refreshDash(chatId, data, today, deps);
    }
    case 'er': {
      const f = findRec(data, arg);
      if (!f || f.kind !== 'item' || f.rec.spread || f.rec.type !== 'bill') return tg.answer(cb.id, 'Запись не найдена');
      f.rec.fromReserve = !isReserveBill(f.rec);
      logEvent(data, today.ts, `«${f.rec.name}»: оплата ${f.rec.fromReserve ? 'из резерва' : 'с карты'}`);
      await store.save(chatId, data);
      await tg.answer(cb.id, f.rec.fromReserve ? 'Платёж из резерва' : 'Платёж с карты');
      await tg.edit(chatId, mid, editCard(f, TZ(), data), { reply_markup: editMarkup(f, data) });
      return refreshDash(chatId, data, today, deps);
    }
    case 'lg': {
      if (arg === 'no') {
        await tg.answer(cb.id);
        return tg.edit(chatId, mid, '👌 Остаток остаётся в свободных деньгах.');
      }
      const g = data.goals.find((x) => x.id === arg);
      const amount = Number(arg2);
      if (!g || !(amount > 0)) return tg.answer(cb.id, 'Цель не найдена');
      depositToGoal(data, today, g, amount);
      await store.save(chatId, data);
      await tg.answer(cb.id, 'Отложено 🐷');
      await tg.edit(chatId, mid, `🐷 В цель «${esc(g.name)}» отложено ${money(amount)}. Накоплено ${money(g.saved)} из ${money(g.target)}.`);
      return refreshDash(chatId, data, today, deps);
    }
    case 'ei': {
      const f = findRec(data, arg);
      if (!f) return tg.answer(cb.id, 'Запись не найдена');
      await tg.answer(cb.id);
      return tg.edit(chatId, mid, editCard(f, TZ(), data), { reply_markup: editMarkup(f, data) });
    }
    case 'ea': case 'en': case 'ew': {
      const f = findRec(data, arg);
      if (!f) return tg.answer(cb.id, 'Запись не найдена');
      const field = { ea: 'amount', en: 'name', ew: 'when' }[action];
      data.awaiting = { id: arg, field, uid: cb.from?.id, mid, ts: today.ts };
      await store.save(chatId, data);
      await tg.answer(cb.id);
      return tg.send(chatId, PROMPTS[field](f), { reply_markup: { inline_keyboard: [[{ text: '✖️ Отмена', callback_data: 'eq' }]] } });
    }
    case 'eq':
      data.awaiting = null;
      await store.save(chatId, data);
      await tg.answer(cb.id, 'Отменено');
      return tg.edit(chatId, mid, '✖️ Изменение отменено.');
    case 'ec': {
      const f = findRec(data, arg);
      if (!f) return tg.answer(cb.id, 'Запись не найдена');
      await tg.answer(cb.id);
      return tg.edit(chatId, mid, `${editCard(f, TZ(), data)}\n\n🗂 Выбери новую категорию:`, { reply_markup: catMarkup(arg) });
    }
    case 'sc': {
      const f = findRec(data, arg);
      if (!f || (f.kind === 'item' && !f.rec.spread) || !CATS[arg2]) return tg.answer(cb.id, 'Запись не найдена');
      f.rec.cat = arg2;
      f.rec.catManual = true; // выбрано вручную — автоопределение не перезапишет
      if (f.kind === 'spend' && f.rec.merchant) data.rules = { ...data.rules, [f.rec.merchant]: arg2 }; // запомнить магазин
      logEvent(data, today.ts, `«${f.rec.name}»: категория ${catName(arg2)}`);
      await store.save(chatId, data);
      await tg.answer(cb.id, 'Категория изменена');
      await tg.edit(chatId, mid, editCard(f, TZ(), data), { reply_markup: editMarkup(f, data) });
      return refreshDash(chatId, data, today, deps);
    }
    case 'el': {
      const f = findRec(data, arg);
      if (!f || f.kind !== 'spend') return tg.answer(cb.id, 'Запись не найдена');
      await tg.answer(cb.id);
      return tg.edit(chatId, mid, `${editCard(f, TZ(), data)}\n\n🔗 В какую обязательную трату засчитать эту сумму?`, { reply_markup: linkMarkup(arg, data) });
    }
    case 'sl': {
      const f = findRec(data, arg);
      if (!f || f.kind !== 'spend') return tg.answer(cb.id, 'Запись не найдена');
      if (arg2 === 'auto') delete f.rec.linkId;
      else f.rec.linkId = arg2; // id статьи или 'none'
      logEvent(data, today.ts, `трата «${f.rec.name}»: привязка к обязательной трате изменена`);
      await store.save(chatId, data);
      await tg.answer(cb.id, 'Готово');
      await tg.edit(chatId, mid, editCard(f, TZ(), data), { reply_markup: editMarkup(f, data) });
      return refreshDash(chatId, data, today, deps);
    }
    case 'lb': {
      await tg.answer(cb.id);
      const markup = listMarkup(data, today);
      return tg.edit(chatId, mid, formatList(data, today), markup ? { reply_markup: markup } : {});
    }
    case 'del': {
      const si = data.spends.findIndex((x) => x.id === arg);
      if (si >= 0) {
        const [s] = data.spends.splice(si, 1);
        logEvent(data, today.ts, `удалена трата «${s.name}» ${money(s.amount)}`);
        await store.save(chatId, data);
        await tg.answer(cb.id, 'Трата удалена');
        const mk = listMarkup(data, today);
        await tg.edit(chatId, mid, formatList(data, today), mk ? { reply_markup: mk } : {});
        return refreshDash(chatId, data, today, deps);
      }
      const i = data.items.findIndex((x) => x.id === arg);
      if (i < 0) return tg.answer(cb.id, 'Уже удалено');
      const [it] = data.items.splice(i, 1);
      logEvent(data, today.ts, `удалён пункт «${it.name}» ${money(it.amount)}`);
      await store.save(chatId, data);
      await tg.answer(cb.id, `Удалено: ${it.name}`);
      const markup = listMarkup(data, today);
      await tg.edit(chatId, mid, formatList(data, today), markup ? { reply_markup: markup } : {});
      return refreshDash(chatId, data, today, deps);
    }
    case 'gdel': {
      const i = data.goals.findIndex((x) => x.id === arg);
      if (i < 0) return tg.answer(cb.id, 'Уже удалено');
      const [g] = data.goals.splice(i, 1);
      logEvent(data, today.ts, `удалена цель «${g.name}»`);
      await store.save(chatId, data);
      await tg.answer(cb.id, `Удалено: ${g.name}`);
      const markup = goalsMarkup(data);
      await tg.edit(chatId, mid, formatGoals(data, today, computePlan(data, today).free), markup ? { reply_markup: markup } : {});
      return refreshDash(chatId, data, today, deps);
    }
    case 'h':
      await tg.answer(cb.id);
      return tg.send(chatId, HINTS[arg] ?? HINTS.inc);
    case 'lst': {
      await tg.answer(cb.id);
      const markup = listMarkup(data, today);
      return tg.send(chatId, formatList(data, today), markup ? { reply_markup: markup } : {});
    }
    case 'goals': {
      await tg.answer(cb.id);
      const markup = goalsMarkup(data);
      return tg.send(chatId, formatGoals(data, today, computePlan(data, today).free), markup ? { reply_markup: markup } : {});
    }
    case 'nx': {
      const k = Math.min(6, Math.max(1, Number(arg) || 1));
      await tg.answer(cb.id);
      const text = formatForecast(data, today, k);
      // со сводки открываем новым сообщением, а «Раньше/Дальше» листают это же сообщение
      if (data.dash?.mid === mid) return tg.send(chatId, text, { reply_markup: forecastMarkup(k) });
      return tg.edit(chatId, mid, text, { reply_markup: forecastMarkup(k) });
    }
    case 'det':
      await tg.answer(cb.id);
      return tg.send(chatId, formatPlanFull(data, today));
    case 'guide':
      await tg.answer(cb.id);
      return tg.send(chatId, formatGuide(data, today));
    case 'chart':
      await tg.answer(cb.id);
      return tg.send(chatId, formatChart(data, today));
    case 'ai':
      await tg.answer(cb.id);
      return sendAi(chatId, data, today, deps, '');
    case 'refresh':
      await tg.answer(cb.id, 'Обновлено');
      return refreshDash(chatId, data, today, deps);
    default:
      return tg.answer(cb.id);
  }
}

export async function processUpdate(update, deps) {
  // Запоминаем, в каких беседах пользователь пользуется ботом: мини-приложение покажет их списком
  const m = update.message ?? update.callback_query?.message;
  const from = update.message?.from ?? update.callback_query?.from;
  if (m?.chat && m.chat.type !== 'private' && from?.id) {
    try { await deps.store.addUserChat?.(from.id, m.chat.id); } catch (e) { console.error('track chat', e); }
  }
  if (update.callback_query) return onCallback(update.callback_query, deps);
  if (update.message) return onMessage(update.message, deps);
}
