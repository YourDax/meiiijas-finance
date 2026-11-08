// Нажатия inline-кнопок.
import { normalize, newId, undoTopup, depositToGoal } from '../bot.js';
import { formatGuide } from '../guide.js';
import { computePlan } from '../budget.js';
import { formatList, listMarkup, esc, money, dateStr } from '../format.js';
import { formatGoals, goalsMarkup, ymLabel, goalStatus } from '../goals.js';
import { formatChart } from '../charts.js';
import { formatForecast, forecastMarkup } from '../forecast.js';
import { formatPlanFull } from '../planview.js';
import { PROMPTS, catMarkup, editCard, editMarkup, findRec, linkMarkup } from '../edit.js';
import { fromDn, cardBalance } from '../period.js';
import { depositReserve } from '../reserve.js';
import { logEvent } from '../prompt.js';
import { addGoal, applyImport, confirmOcc, removeRecord, setCategory, setLink, toggleReserve, unconfirmOcc } from '../ops.js';
import { paidList } from '../paid.js';
import { HINTS, TZ, whenText, batchLine, makeItem, cardText, cardMarkup } from './cards.js';
import { sendAlerts, refreshDash, sendAi } from './dash.js';

// Перерисовывает список «Оплаты» в том же сообщении
async function showPaid(tg, chatId, mid, data, today) {
  const p = paidList(data, today);
  await tg.edit(chatId, mid, p.text, p.markup ? { reply_markup: p.markup } : {});
}

export async function onCallback(cb, deps) {
  const { store, tg, today } = deps;
  const msg = cb.message;
  if (!msg) return tg.answer(cb.id);
  const chatId = msg.chat.id;
  const mid = msg.message_id;
  const [action, arg, arg2, arg3] = String(cb.data ?? '').split(':');
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
        addGoal(data, today, { name: p.name, amount: p.amount, deadline: p.deadline, by: p.by ?? by });
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
      const done = confirmOcc(data, today, key, skipped);
      if (!done) return tg.answer(cb.id, 'Не нашёл это событие');
      const { occ, leftover } = done;
      await store.save(chatId, data);
      await tg.answer(cb.id, skipped ? 'Пропустил' : occ.type === 'income' ? 'Деньги учтены 💚' : 'Платёж учтён ✅');
      if (!skipped && occ.type === 'income') {
        // Деньги пришли: напоминаем перевести часть на резерв для аренды, коммуналки и интернета
        const after = done.after;
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
      // из списка «Оплаты» нажатие обновляет этот же список, из сводки — только сводку
      if (arg3 === 'L') await showPaid(tg, chatId, mid, data, today);
      return refreshDash(chatId, data, today, deps);
    }
    case 'uc': {
      const key = `${arg}:${arg2}`;
      const r = unconfirmOcc(data, today, key);
      if (!r) return tg.answer(cb.id, 'Отметки уже нет');
      await store.save(chatId, data);
      await tg.answer(cb.id, 'Отметка снята ↩️');
      if (arg3 === 'L') await showPaid(tg, chatId, mid, data, today);
      return refreshDash(chatId, data, today, deps);
    }
    case 'pd': {
      await tg.answer(cb.id);
      const p = paidList(data, today);
      return tg.send(chatId, p.text, p.markup ? { reply_markup: p.markup } : {});
    }
    case 'ix': {
      const p = data.pending.find((x) => x.id === arg && x.kind === 'import');
      if (!p) { await tg.answer(cb.id, 'Уже обработано'); return tg.edit(chatId, mid, '🤷 Эта карточка устарела.'); }
      const { total, useBalance } = applyImport(data, today, p, { withBalance: arg2 === 'b', by, tz: TZ() });
      const balText = useBalance ? `
💼 Остаток на руках: ${money(p.balance.amount)} (на ${p.balance.date})` : '';
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
      const f = toggleReserve(data, today, arg);
      if (!f) return tg.answer(cb.id, 'Запись не найдена');
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
      const f = setCategory(data, today, arg, arg2);
      if (!f) return tg.answer(cb.id, 'Запись не найдена');
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
      const f = setLink(data, today, arg, arg2);
      if (!f) return tg.answer(cb.id, 'Запись не найдена');
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
      const removed = removeRecord(data, today, arg);
      if (!removed) return tg.answer(cb.id, 'Уже удалено');
      await store.save(chatId, data);
      await tg.answer(cb.id, removed.kind === 'spend' ? 'Трата удалена' : `Удалено: ${removed.rec.name}`);
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
