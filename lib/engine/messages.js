// Текстовые сообщения: команды, ответы на запросы правки, фразы, /app.
import { handleMessage, normalize, newId, applyTopup, depositToGoal } from '../bot.js';
import { parseAny } from '../nlp.js';
import { parseBatch } from '../batch.js';
import { catName } from '../cats.js';
import { esc, money } from '../format.js';
import { findGoal } from '../goals.js';
import { AWAIT_TTL, applyEdit, editCard, editMarkup } from '../edit.js';
import { cardBalance } from '../period.js';
import { depositReserve, setTransportFormula } from '../reserve.js';
import { parseAmount } from '../parse.js';
import { appUrl } from '../webapp.js';
import { COMMANDS, REPLY_KEYBOARD, KEY_COMMANDS, BTN_SPEND } from '../commands.js';
import { HINTS, TZ, cardText, cardMarkup } from './cards.js';
import { sendAlerts, refreshDash, sendDash, sendAi } from './dash.js';
import { onDocument } from './documents.js';

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

export async function onMessage(msg, deps) {
  const { store, tg, today } = deps;
  if (msg.document) return onDocument(msg, deps);
  let text = msg.text;
  if (!text) return;
  // Кнопки нижней клавиатуры: «Сводка» и «Приложение» работают как команды, «Трата» подсказывает формат
  if (text.trim() === BTN_SPEND) return tg.send(msg.chat.id, HINTS.spend);
  text = KEY_COMMANDS[text.trim()] ?? text;
  const chatId = msg.chat.id;
  const by = msg.from?.first_name ?? undefined;
  const hasSlash = text.split('\n').some((l) => l.trim().startsWith('/'));

  // Мини-приложение: /app открывает его, /start в личном чате ставит кнопку меню
  const cmd = text.trim().match(/^\/(app|start)(@\w+)?(\s|$)/i)?.[1]?.toLowerCase();
  if (cmd === 'app') return openApp(msg, deps);
  if (cmd === 'start' && msg.chat.type === 'private') {
    try { await tg.setMenuButton?.(chatId, appUrl()); } catch (e) { console.error('menu button', e); }
    try { await tg.setCommands?.(COMMANDS); } catch (e) { console.error('commands', e); }
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
    const extra = r.markup ? { reply_markup: r.markup } : cmd === 'start' && msg.chat.type === 'private' ? { reply_markup: REPLY_KEYBOARD } : {};
    if (r.reply) await tg.send(chatId, r.reply, extra);
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
      reply_markup: { inline_keyboard: [[
        { text: '✏️ Изменить', callback_data: `ei:${s.id}` },
        { text: '↩️ Отменить', callback_data: `undo:${s.id}` },
      ]] },
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
    await tg.send(chatId, `🚌 Транспорт: ${money(p.base)} + ${money(p.daily)} × ${r.weekdays} рабочих дней = <b>${money(r.it.amount)}</b> на текущий цикл. Дальше пересчитаю сам.`);
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
