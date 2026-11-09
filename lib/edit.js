// Редактирование пунктов и трат: карточки, кнопки и применение правок.
import { parseAmount, parseDay } from './parse.js';
import { extractMonth, defaultDay } from './nlp.js';
import { CATS, catName, categorize } from './cats.js';
import { ymLabelShort, esc, money } from './format.js';
import { logEvent } from './prompt.js';
import { everyText, monthDays, spreadTarget } from './budget.js';
import { dateKey, dn, isReserveBill } from './period.js';

export const AWAIT_TTL = 10 * 60 * 1000;

export function findRec(data, id) {
  const it = (data.items ?? []).find((x) => x.id === id);
  if (it) return { kind: 'item', rec: it };
  const sp = (data.spends ?? []).find((x) => x.id === id);
  if (sp) return { kind: 'spend', rec: sp };
  return null;
}

const describeWhen = (it) => {
  if (it.spread) return '📆 В течение месяца';
  if (it.every) return `🔁 ${everyText(it)}`;
  if (it.once) return `1️⃣ Один раз · ${it.day}-го, ${ymLabelShort(it.once)}`;
  return `🔁 Каждый месяц · ${it.day}-го числа`;
};

const spreadOf = (data) => (data?.items ?? []).filter((i) => i.spread);

// К какой обязательной трате «в течение месяца» относится необязательная трата
function linkLabel(rec, data) {
  const spread = spreadOf(data);
  if (!spread.length) return null;
  if (rec.linkId === 'none') return '🔗 Не засчитывается в обязательные траты';
  const idx = spreadTarget(rec, spread);
  if (idx < 0) return rec.linkId ? '🔗 Привязка потеряна (статья удалена)' : null;
  return `🔗 Засчитывается в «${esc(spread[idx].name)}»${rec.linkId ? ' (вручную)' : ''}`;
}

export function editCard(found, tz = 'Europe/Moscow', data = null) {
  const { kind, rec } = found;
  if (kind === 'spend') {
    const when = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(rec.ts));
    const link = linkLabel(rec, data);
    return `✏️ <b>${esc(rec.name || 'Трата')}</b>\n🧾 Необязательная трата\n💰 Сумма: <b>${money(rec.amount)}</b>\n🗂 Категория: ${catName(rec.cat)}${link ? `\n${link}` : ''}\n🕒 ${when}`;
  }
  const type = rec.type === 'income' ? '💰 Доход' : '📌 Обязательная трата';
  const cat = rec.spread
    ? `\n🗂 Категория: ${catName(rec.cat)}${!rec.cat || rec.cat === 'other' ? '\n⚠️ <i>Без категории траты сами не засчитываются — выбери категорию или привязывай траты вручную (🔗 в карточке траты).</i>' : ''}`
    : '';
  const pay = data?.reserve && rec.type === 'bill' && !rec.spread ? `\n${isReserveBill(rec) ? '🏠 Оплата из резерва на аренду' : '💳 Оплата с карты'}` : '';
  return `✏️ <b>${esc(rec.name)}</b>\n${type}\n💰 Сумма: <b>${money(rec.amount)}</b>\n📅 Когда: ${describeWhen(rec)}${cat}${pay}`;
}

export function editMarkup(found, data = null) {
  const id = found.rec.id;
  const rows = [[
    { text: '💰 Сумма', callback_data: `ea:${id}` },
    { text: '📝 Название', callback_data: `en:${id}` },
  ]];
  if (found.kind === 'spend') {
    rows.push([{ text: '🗂 Категория', callback_data: `ec:${id}` }]);
    if (spreadOf(data).length) rows.push([{ text: '🔗 К обязательной трате', callback_data: `el:${id}` }]);
  } else {
    rows.push(found.rec.spread
      ? [{ text: '📅 Когда', callback_data: `ew:${id}` }, { text: '🗂 Категория', callback_data: `ec:${id}` }]
      : [{ text: '📅 Когда', callback_data: `ew:${id}` }]);
    if (data?.reserve && found.rec.type === 'bill' && !found.rec.spread) {
      rows.push([{ text: isReserveBill(found.rec) ? '💳 Платить с карты' : '🏠 Платить из резерва', callback_data: `er:${id}` }]);
    }
  }
  rows.push([
    { text: '🗑 Удалить', callback_data: `del:${id}` },
    { text: '⬅️ К списку', callback_data: 'lb' },
  ]);
  return { inline_keyboard: rows };
}

export function catMarkup(id) {
  const keys = Object.keys(CATS);
  const rows = [];
  for (let i = 0; i < keys.length; i += 2) {
    rows.push(keys.slice(i, i + 2).map((k) => ({ text: CATS[k].name, callback_data: `sc:${id}:${k}` })));
  }
  rows.push([{ text: '⬅️ Назад', callback_data: `ei:${id}` }]);
  return { inline_keyboard: rows };
}

export function linkMarkup(spendId, data) {
  const rows = spreadOf(data).slice(0, 12).map((i) => [{ text: `📆 ${i.name.slice(0, 28)}`, callback_data: `sl:${spendId}:${i.id}` }]);
  rows.push([{ text: '🚫 Не засчитывать', callback_data: `sl:${spendId}:none` }, { text: '♻️ Автоматически', callback_data: `sl:${spendId}:auto` }]);
  rows.push([{ text: '⬅️ Назад', callback_data: `ei:${spendId}` }]);
  return { inline_keyboard: rows };
}

export const PROMPTS = {
  amount: (f) => `✏️ Пришли новую сумму для «${f.rec.name}» (сейчас ${money(f.rec.amount)}), например <code>15000</code> или <code>15к</code>.`,
  name: (f) => `✏️ Пришли новое название для «${f.rec.name}».`,
  when: (f) => `📅 Когда «${f.rec.name}»? Пришли:\n• число месяца, например <code>15</code>\n• <code>в течение месяца</code> — без даты (только для расходов)\n• <code>в ноябре</code> или <code>5 декабря</code> — разово на другой месяц\n• <code>каждый месяц</code> — вернуть ежемесячный`,
};

// Отметка «оплачено» привязана к дате: при переносе пункта она переезжает на новую дату, иначе платёж снова станет к оплате
function moveDoneMarks(data, rec, wasOnce) {
  if (rec.spread || rec.day == null) return;
  const prefix = `${rec.id}:`;
  for (const key of Object.keys(data.done ?? {})) {
    if (!key.startsWith(prefix)) continue;
    const s = key.slice(prefix.length);
    let [y, m] = [Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1];
    if (wasOnce && rec.once) [y, m] = [Number(rec.once.slice(0, 4)), Number(rec.once.slice(5, 7)) - 1]; // разовый пункт перенесён на другой месяц
    const days = monthDays(rec, y, m);
    if (days.length !== 1) continue;
    const next = `${prefix}${dateKey(dn(y, m, days[0]))}`;
    if (next !== key && !data.done[next]) {
      data.done[next] = data.done[key];
      delete data.done[key];
    }
  }
}

// Применяет ответ пользователя к записи. -> { ok: true } | { error }
export function applyEdit(data, aw, text, today) {
  const found = findRec(data, aw.id);
  if (!found) return { error: 'Запись уже удалена.', gone: true };
  const { kind, rec } = found;
  const raw = String(text ?? '').trim();
  if (!raw) return { error: 'Пустое сообщение, попробуй ещё раз.' };

  if (aw.field === 'amount') {
    const a = parseAmount(raw.replace(/\s/g, '').toLowerCase());
    if (!a) return { error: 'Не понял сумму. Пример: 15000 или 15к.' };
    if (rec.formula) return { error: 'Эта сумма считается по формуле: проездной + рабочие дни. Измени формулу в настройке транспорта или командой /transport.' };
    logEvent(data, today.ts, `«${rec.name}»: сумма ${money(rec.amount)} → ${money(a)}`);
    rec.amount = a;
    return { ok: true, found };
  }

  if (aw.field === 'name') {
    const nm = raw.slice(0, 60);
    logEvent(data, today.ts, `переименовано «${rec.name}» → «${nm}»`);
    rec.name = nm;
    if (kind === 'item' && rec.spread && !rec.catManual) rec.cat = categorize(nm);
    return { ok: true, found };
  }

  if (aw.field === 'when' && kind === 'item') {
    const t = raw.toLowerCase().replace(/ё/g, 'е');
    const mo = extractMonth(t, today);
    const wasOnce = !!rec.once;
    const hadEvery = rec.every ? { every: rec.every, weekday: rec.weekday, month: rec.month } : null;
    delete rec.every; delete rec.weekday; delete rec.month; // новый срок заменяет периодичность
    const fail = (error) => { if (hadEvery) Object.assign(rec, hadEvery); return { error }; };
    if (mo) {
      rec.once = mo.ym;
      rec.day = mo.day ?? (rec.spread || !rec.day ? defaultDay(rec.type, mo.ym, today) : rec.day);
      rec.spread = false;
      delete rec.cat;
    } else if (/(в течение|без даты|весь месяц|на месяц)/.test(t)) {
      if (rec.type === 'income') return fail('Доходу нужна дата. Пришли число месяца.');
      rec.spread = true;
      rec.day = null;
      rec.cat = categorize(rec.name);
      delete rec.once;
    } else if (/(каждый месяц|ежемесяч)/.test(t)) {
      if (!rec.day) return fail('Сначала укажи число месяца, например 15.');
      delete rec.once;
    } else {
      const d = parseDay(t.replace(/(-?го|числа|число)/g, '').trim());
      if (!d) return fail('Не понял. Пример: 15, «в течение месяца» или «в ноябре».');
      rec.day = d;
      rec.spread = false;
      delete rec.cat;
    }
    moveDoneMarks(data, rec, wasOnce);
    logEvent(data, today.ts, `«${rec.name}»: срок изменён — ${describeWhen(rec).replace(/^\S+\s/, '')}`);
    return { ok: true, found };
  }
  return { error: 'Это поле нельзя изменить.' };
}
