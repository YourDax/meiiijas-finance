// Обработчики действий (data-act).
import { S, store, api, act, hooks } from './state.js';
import { $, esc, money, isoStr, dayKey, timeStr, dayLabel, catTitle, thisMonth, parseAmt, setInfo, haptic, toast, ask } from './util.js';
import { renderExtras } from './extras.js';
import { closeSheet, sheet, val, field, buttons, btn, infoSheet } from './ui.js';
import { whenText, render, curBalance } from './tabs.js';
import { itemForm, bindItemForm, confirmSheet, leftoverSheet } from './forms.js';

// ---------- действия ----------
// Удаляет трату сразу и предлагает вернуть её (с прежним временем) в течение нескольких секунд
export async function deleteSpendWithUndo(id) {
  const x = S.state.spends.find((s) => s.id === id);
  if (!x) return;
  if (!(await act('delete', { id }, { silent: true }))) return;
  haptic('warning');
  toast(`Удалено: ${money(x.amount)} ${x.name ?? ''}`.trim(), false, {
    label: 'Отменить',
    run: async () => {
      const keep = { amount: x.amount, name: x.name, cat: x.cat, ts: x.ts, by: x.by, src: x.src, merchant: x.merchant };
      if (await act('spend_restore', keep, { silent: true })) toast('Трата возвращена');
    },
  });
}

// Что стало с деньгами после отметки: показываем новый баланс
function occToast(o) {
  if (o.type === 'income') return `Получено +${money(o.amount)} · на карте ${money(curBalance())}`;
  if (o.fromReserve && S.state.reserve) return `Оплачено из копилки · в копилке ${money(S.state.reserve.amount)}`;
  return `Оплачено −${money(o.amount)} · на карте ${money(curBalance())}`;
}

// Сообщение после записи траты: лимит важнее, затем предупреждение о дате
function afterSpend(r, text) {
  if (r.limit) toast(`${r.limit.name}: ${money(r.limit.spent)} из ${money(r.limit.limit)} за месяц`, r.limit.spent > r.limit.limit);
  else if (r.beforeBalance) toast('Записано. Дата раньше указанного остатка, поэтому баланс не изменился');
  else if (text) toast(text);
}

// Действия только над текущим месяцем: сам пункт и следующие месяцы не меняются
function monthBlock(it, key) {
  if (it.type !== 'bill') return '';
  const note = '<p class="small muted" style="margin:6px 0 0">Только за этот месяц. В следующих месяцах платёж останется.</p>';
  if (it.spread) {
    const s = S.state.spreadPayments?.find((x) => x.id === it.id);
    return s?.parts?.length ? `<div class="actions">${btn('↩️ Не оплачено', 'item-unpay-spread', { id: it.id }, 'ghost')}</div>${note}` : '';
  }
  const o = key ? S.state.payments?.find((x) => x.key === key) : null;
  if (!o) return '';
  if (o.status === 'done') return `<div class="actions">${btn('↩️ Не оплачено', 'item-unpay', { key }, 'ghost')}</div>${note}`;
  if (o.status === 'skipped') return `<div class="actions">${btn('↩️ Вернуть в этом месяце', 'item-unpay', { key }, 'ghost')}</div>${note}`;
  if (o.status === 'open') return `<div class="actions">${btn('🚫 Не платить в этом месяце', 'item-skip', { key }, 'ghost')}</div>${note}`;
  return '';
}

export const H = {
  close: () => closeSheet(),
  ...renderExtras,

  'export-csv'() {
    sheet('Экспорт трат', `<p class="small muted">Файл придёт в личный чат с ботом. Открой его в Excel или Google Таблицах.</p>${buttons(btn('За этот месяц', 'export-run', { range: 'month' }), btn('За всё время', 'export-run', { range: 'all' }, 'ghost'))}`);
  },
  async 'export-run'(d) {
    const r = await act('export_csv', d.range === 'month' ? { month: thisMonth() } : {}, { silent: true });
    if (r) { closeSheet(); toast(`Отправил файл в чат с ботом: ${r.rows} трат`); }
  },
  usage() {
    const u = S.state.usage;
    sheet('Объём данных', `<p>Бюджет занимает <b>${Math.max(1, Math.round(u.bytes / 1024))} КБ</b> — ${u.percent}% от лимита хранилища на один запрос.</p>
      <p class="small muted">${u.warn ? 'Данных уже много: выгрузи траты в CSV и не импортируй выписки за очень длинные периоды. Старые траты бот сам убирает в архив 1-го числа.' : 'Всё в порядке. Старые траты бот сам убирает в архив 1-го числа, а выгрузить их можно в CSV.'}</p>${buttons(btn('⬇️ Выгрузить CSV', 'export-csv'), btn('Закрыть', 'close', {}, 'ghost'))}`);
  },
  tab: (d) => { S.tab = d.tab; render(); scrollTo(0, 0); },

  // Тап по категории на главной → траты этой категории за текущий месяц
  'cat-filter'(d) { S.filter = { month: 'cur', q: catTitle(d.cat) }; S.tab = 'spends'; render(); scrollTo(0, 0); },
  chip(d) { $('#q-name').value = d.name; $('#q-amt').focus(); },
  // Плавающая «＋»: все способы что-то добавить в одном месте
  'add-menu'() {
    const row = (ico, t, s, a) => `<div class="item" data-act="${a}"><div class="ico">${ico}</div><div class="grow"><div class="t">${t}</div><div class="s">${s}</div></div><span class="muted">›</span></div>`;
    sheet('Добавить', `<div class="list">
      ${row('🧾', 'Трата', 'сумма, на что, дата, категория', 'spend-add')}
      ${row('💬', 'Написать фразой', '«кофе 450», «аванс 80к 5 числа»', 'nl')}
      ${row('💰', 'Доход или платёж', 'регулярный или разовый', 'item-add')}
      ${row('💼', 'Изменить баланс', 'добавить, списать или указать точный остаток', 'balance')}
      ${row('🔁', 'Перевод между счетами', 'с карты на наличные и обратно', 'transfer')}
      ${row('🤝', 'Долг', 'кому должен ты или кто должен тебе', 'debt-add')}
      ${row('✅', 'Отметить оплату', 'платёж оплачен или доход пришёл', 'goto-plan')}
      ${row('🎯', 'Цель накоплений', 'сумма и срок', 'goal-add')}
      ${row('📥', 'Загрузить выписку', 'PDF из Т-Банка', 'import')}
    </div>`);
  },

  async chats() {
    sheet('Выбери бюджет', `<div class="list">${S.chats.map((c) => `<div class="item" data-act="pick-chat" data-id="${c.id}"><div class="ico">${c.type === 'private' ? '👤' : '👥'}</div><div class="grow"><div class="t">${esc(c.title)}</div></div>${c.id === S.chatId ? '✅' : ''}</div>`).join('')}</div>
      <p class="small muted">Беседа появляется здесь после того, как ты напишешь боту в ней.</p>`);
  },
  async 'pick-chat'(d) { closeSheet(); S.chatId = Number(d.id); store.set('chat', String(S.chatId)); S.state = null; S.planSettled = null; await hooks.load(); },

  async 'quick-spend'() {
    const amount = parseAmt($('#q-amt').value);
    if (!amount) return toast('Введи сумму, например 450 или 1,5к', true);
    const r = await act('spend_add', { amount, name: $('#q-name').value.trim() });
    if (r) afterSpend(r, `Записано: ${money(amount)}`);
  },
  async 'undo-last'() { const r = await act('spend_undo'); if (r?.undone) toast(`Отменено: ${money(r.undone.amount)} ${r.undone.name ?? ''}`); },

  async occ(d) {
    const r = await act('occ', { key: d.key, skip: !!d.skip, amount: d.amount ? Number(d.amount) : undefined });
    if (!r) return;
    if (r.transfer) {
      const t = r.transfer;
      sheet('🏠 Перевод в копилку', `<p><b>${esc(t.name)}</b> пришёл. Переведи в копилку <b>${money(t.amount)}</b>.</p>
        <p class="small muted">К ${isoStr(t.deadline)} нужно ${money(t.need)}, в копилке ${money(t.have)}${t.later.length ? `. Остальное закроет доход: ${t.later.map((x) => `${isoStr(x.date)} +${money(x.amount)}`).join(', ')}` : ''}.</p>
        ${buttons(btn(`✅ Перевёл ${money(t.amount)}`, 'reserve-quick', { amount: t.amount }), btn('Другая сумма', 'reserve-deposit', {}, 'ghost'))}${r.leftover ? '' : buttons(btn('Позже', 'close', {}, 'ghost'))}`);
      S.confirm = r.leftover ?? null;
    } else if (r.leftover) leftoverSheet(r.leftover);
    else toast(d.skip ? 'Отмечено: не было' : occToast(r.occ), false, { label: 'Отменить', run: () => act('occ_undo', { key: d.key }) });
  },
  // Дата пункта раньше заданного остатка: сумма считается уже учтённой, поэтому списываем только после подтверждения
  'occ-auto'(d) {
    const o = S.state.payments.find((x) => x.key === d.key);
    if (!o) return;
    const income = o.type === 'income';
    sheet(`${o.name} · ${money(o.amount)}`, `<p>Дата этого ${income ? 'поступления' : 'платежа'} раньше, чем ты указал остаток, поэтому он считается уже учтённым.</p>
      <p class="small muted">${income ? 'Если деньги ещё не приходили, а в остатке их нет, нажми кнопку, и сумма добавится.' : 'Если на самом деле ещё не платил, нажми кнопку, и сумма спишется.'}</p>
      ${buttons(btn(income ? `✅ Добавить ${money(o.amount)}` : `✅ Списать ${money(o.amount)}`, 'occ-auto-do', { key: o.key }), btn('Уже учтено', 'close', {}, 'ghost'))}`);
  },
  async 'occ-auto-do'(d) { closeSheet(); await H.occ({ key: d.key }); },
  'occ-amount'(d) {
    const o = S.state.payments.find((x) => x.key === d.key);
    if (!o) return;
    const income = o.type === 'income';
    sheet(o.name, `<p class="small muted">По плану ${money(o.amount)}. Укажи, сколько ${income ? 'пришло' : 'заплатил'} на самом деле. Сумма в плане не изменится.</p>${field('amount', 'Сумма', `inputmode="decimal" value="${o.amount}"`)}<input type="hidden" id="f-key" value="${esc(o.key)}">${buttons(btn(income ? '✅ Получено' : '✅ Оплачено', 'occ-amount-save'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'occ-amount-save'() {
    const amount = parseAmt(val('amount'));
    if (!amount) return toast('Введи сумму', true);
    const key = val('key');
    closeSheet();
    await H.occ({ key, amount });
  },
  'spread-amount'(d) {
    const s = S.state.spreadPayments.find((x) => x.id === d.id);
    if (!s) return;
    const parts = s.parts ?? [];
    const history = parts.length ? `<h2>Записано</h2><div class="list">${parts.map((x) => `<div class="item" style="cursor:default"><div class="grow"><div class="t">${money(x.amount)}</div><div class="s">${dayLabel(dayKey(x.ts))}, ${timeStr(x.ts)}</div></div>${btn('↩️ Отменить', 'spread-part-undo', { spend: x.id, id: s.id }, 'ghost small')}</div>`).join('')}</div>` : '';
    sheet(s.name, `<p class="small muted">Осталось ${money(s.remaining)} из ${money(s.amount)}. Запиши, сколько ушло сейчас: сумма спишется с карты, остальное останется в статье.</p>${field('amount', 'Сумма платежа', 'inputmode="decimal" placeholder="500"')}<input type="hidden" id="f-id" value="${esc(s.id)}">${buttons(btn('➕ Записать', 'spread-amount-save'), btn('Закрыть', 'close', {}, 'ghost'))}${history}`);
  },
  async 'spread-part-undo'(d) { if (await act('delete', { id: d.spend })) { toast(`Платёж отменён · на карте ${money(curBalance())}`); H['spread-amount']({ id: d.id }); } },
  async 'transport-ride'() {
    const r = await act('transport_ride');
    if (r) toast(`🚌 Поездка −${money(r.amount)} · на карте ${money(curBalance())}`, false, { label: 'Отменить', run: () => act('delete', { id: r.spendId }) });
  },
  async 'spread-amount-save'() {
    const amount = parseAmt(val('amount'));
    if (!amount) return toast('Введи сумму', true);
    const id = val('id');
    closeSheet();
    await H['spread-pay']({ id, amount });
  },
  async 'spread-pay'(d) {
    const r = await act('spread_pay', { id: d.id, amount: d.amount ? Number(d.amount) : undefined });
    if (r) toast(`Оплачено −${money(r.amount)} · на карте ${money(curBalance())}`, false, { label: 'Отменить', run: () => act('delete', { id: r.spendId }) });
  },
  async 'spread-undo'(d) { if (await act('delete', { id: d.spend })) toast(`Оплата отменена · на карте ${money(curBalance())}`); },
  async 'reserve-quick'(d) { closeSheet(); await act('reserve_deposit', { amount: Number(d.amount) }); if (S.confirm?.goals) { const l = S.confirm; S.confirm = null; leftoverSheet(l); } },
  async 'goal-leftover'(d) { closeSheet(); await act('goal_save', { id: d.id, amount: Number(d.amount) }); },

  balance() {
    sheet('Изменить баланс', `<p>Сейчас на карте: <b>${money(curBalance())}</b></p>${field('amount', 'Сумма', 'inputmode="decimal" placeholder="5000 или 5к" data-enter="topup-save"')}${field('name', 'Откуда или на что (необязательно)', 'maxlength="40" placeholder="Подарок, наличные…"')}
      <p class="small muted">«Добавить» — подарок, возврат, подработка. «Списать» — деньги ушли, но это не трата: на лимит не влияет. «Точный остаток» — если сумма разошлась с банком.</p>
      ${buttons(btn('➕ Добавить', 'topup-save'), btn('➖ Списать', 'withdraw-save'))}${buttons(btn('= Это точный остаток', 'balance-save', {}, 'ghost'))}`);
  },
  async 'balance-save'() {
    const raw = val('amount').trim();
    const a = raw === '0' ? 0 : parseAmt(raw);
    if (a === null) return toast('Не понял сумму', true);
    if (await act('balance_set', { amount: a })) closeSheet();
  },
  async 'topup-save'() {
    const amount = parseAmt(val('amount'));
    if (!amount) return toast('Введи сумму', true);
    const r = await act('topup', { amount, name: val('name') });
    if (r) { closeSheet(); toast(`Добавлено ${money(amount)} · на карте ${money(curBalance())}`, false, { label: 'Отменить', run: () => act('topup_undo', { id: r.id }) }); }
  },
  async 'withdraw-save'() {
    const amount = parseAmt(val('amount'));
    if (!amount) return toast('Введи сумму', true);
    const r = await act('withdraw', { amount, name: val('name') });
    if (r) { closeSheet(); toast(`Списано ${money(amount)} · на карте ${money(curBalance())}`, false, { label: 'Отменить', run: () => act('topup_undo', { id: r.id }) }); }
  },
  async 'occ-undo'(d) {
    const r = await act('occ_undo', { key: d.key });
    if (r) toast(`Отменено: ${r.name} · на карте ${money(curBalance())}`);
  },
  'goto-plan'() { closeSheet(); S.tab = 'plan'; render(); scrollTo(0, 0); },
  async 'topup-undo'(d) { if (await ask('Отменить эту запись? Баланс вернётся как было.')) await act('topup_undo', { id: d.id }); },

  'spend-add'() {
    sheet('Новая трата', `${field('amount', 'Сумма', 'inputmode="decimal" placeholder="450"')}${field('name', 'На что', 'maxlength="60" placeholder="Кофе"')}
      <label for="f-date">Когда</label><input id="f-date" type="date" value="${dayKey(S.state.now)}" max="${dayKey(S.state.now)}">
      <label for="f-cat">Категория</label><select id="f-cat"><option value="">Определить автоматически</option>${Object.entries(S.state.cats).map(([k, c]) => `<option value="${k}">${esc(c.name)}</option>`).join('')}</select>
      ${buttons(btn('Записать', 'spend-add-save'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'spend-add-save'() {
    const amount = parseAmt(val('amount'));
    if (!amount) return toast('Введи сумму', true);
    const r = await act('spend_add', { amount, name: val('name'), cat: val('cat') || undefined, date: val('date') || undefined });
    if (r) { closeSheet(); afterSpend(r, `Записано: ${money(amount)}`); }
  },
  'spend-edit'(d) {
    const x = S.state.spends.find((s) => s.id === d.id);
    if (!x) return;
    const spreads = S.state.items.filter((i) => i.spread);
    sheet('Трата', `<p class="small muted">${dayLabel(dayKey(x.ts))}, ${timeStr(x.ts)}${x.by ? ` · ${esc(x.by)}` : ''}${x.src === 'bank' ? ' · из выписки' : ''}</p>
      ${field('amount', 'Сумма', `inputmode="decimal" value="${x.amount}"`)}${field('name', 'Название', `maxlength="60" value="${esc(x.name)}"`)}
      <label for="f-date">Когда</label><input id="f-date" type="date" value="${dayKey(x.ts)}" max="${dayKey(S.state.now)}">
      <label for="f-cat">Категория</label><select id="f-cat">${Object.entries(S.state.cats).map(([k, c]) => `<option value="${k}" ${x.cat === k ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      ${spreads.length ? `<label for="f-link">Засчитывать в обязательную трату</label><select id="f-link"><option value="auto" ${!x.linkId ? 'selected' : ''}>Автоматически по категории</option><option value="none" ${x.linkId === 'none' ? 'selected' : ''}>Не засчитывать</option>${spreads.map((i) => `<option value="${esc(i.id)}" ${x.linkId === i.id ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select>` : ''}
      <input type="hidden" id="f-id" value="${esc(x.id)}">
      ${buttons(btn('Сохранить', 'spend-save'), btn('Удалить', 'del', { id: x.id }, 'danger'))}`);
  },
  async 'spend-save'() {
    const id = val('id'); const x = S.state.spends.find((s) => s.id === id);
    if (!x) return;
    const amount = parseAmt(val('amount'));
    if (!amount) return toast('Не понял сумму', true);
    const steps = [];
    if (amount !== x.amount) steps.push(['edit', { id, field: 'amount', value: String(amount) }]);
    if (val('name') !== x.name) steps.push(['edit', { id, field: 'name', value: val('name') }]);
    if (val('date') && val('date') !== dayKey(x.ts)) steps.push(['edit_date', { id, date: val('date') }]);
    if (val('cat') && val('cat') !== x.cat) steps.push(['edit_cat', { id, cat: val('cat') }]);
    if ($('#f-link') && val('link') !== (x.linkId ?? 'auto')) steps.push(['edit_link', { id, link: val('link') }]);
    for (const [a, p] of steps) if (!(await act(a, p, { silent: true }))) return;
    closeSheet(); haptic('success');
  },
  async del(d) { if (await ask('Удалить?')) { if (await act('delete', { id: d.id })) closeSheet(); } },

  'item-add'() {
    const sh = sheet('Новый пункт плана', itemForm(null) + buttons(btn('Добавить', 'item-add-save'), btn('Отмена', 'close', {}, 'ghost')));
    bindItemForm(sh);
  },
  async 'item-add-save'() {
    const type = val('type'); const sched = val('sched');
    const amount = parseAmt(val('amount'));
    if (!amount) return toast('Введи сумму', true);
    const p = { type, amount, name: val('name') };
    if (sched === 'spread') p.spread = true;
    else if (sched === 'week') { p.every = 'week'; p.weekday = Number(val('weekday')); }
    else { p.day = Number(val('day')); if (sched === 'once') p.once = val('once'); if (sched === 'quarter' || sched === 'year') { p.every = sched; p.month = Number(val('month')); } }
    if (await act('item_add', p)) closeSheet();
  },
  'item-edit'(d) {
    const it = S.state.items.find((i) => i.id === d.id);
    if (!it) return;
    const reserveBtn = it.type === 'bill' && !it.spread ? btn(it.fromReserve ? '💳 Платить с карты' : '🏠 Платить из копилки', 'toggle-reserve', { id: it.id }, 'ghost') : '';
    sheet(it.type === 'income' ? 'Доход' : 'Платёж', `${itemForm(it)}<input type="hidden" id="f-id" value="${esc(it.id)}">
      ${reserveBtn ? `<div class="actions" style="margin-top:10px">${reserveBtn}</div>` : ''}
      ${monthBlock(it, d.key)}
      ${buttons(btn('Сохранить', 'item-save'), btn(it.once ? 'Удалить' : 'Удалить навсегда', 'del', { id: it.id }, 'danger'))}`);
  },
  async 'item-unpay'(d) {
    closeSheet();
    if (await act('occ_undo', { key: d.key })) toast(`Отметка снята · на карте ${money(curBalance())}`);
  },
  async 'item-skip'(d) { closeSheet(); await H.occ({ key: d.key, skip: 1 }); },
  async 'item-unpay-spread'(d) {
    if (!(await ask('Снять все платежи по этой статье за текущий месяц? Деньги вернутся на карту.'))) return;
    closeSheet();
    const r = await act('spread_unpay', { id: d.id });
    if (r) toast(`Снято ${money(r.sum)} · на карте ${money(curBalance())}`);
  },
  async 'item-save'() {
    const id = val('id'); const it = S.state.items.find((i) => i.id === id);
    if (!it) return;
    const amount = parseAmt(val('amount'));
    if (!amount) return toast('Не понял сумму', true);
    const steps = [];
    if (amount !== it.amount) steps.push(['edit', { id, field: 'amount', value: String(amount) }]);
    if (val('name') !== it.name) steps.push(['edit', { id, field: 'name', value: val('name') }]);
    const w = val('when').trim();
    if (w && w !== whenText(it).replace(/^Каждый месяц · /, '')) steps.push(['edit', { id, field: 'when', value: w }]);
    if ($('#f-cat') && val('cat') !== it.cat) steps.push(['edit_cat', { id, cat: val('cat') }]);
    for (const [a, p] of steps) if (!(await act(a, p, { silent: true }))) return;
    closeSheet(); haptic('success');
  },
  async 'toggle-reserve'(d) { if (await act('toggle_reserve', { id: d.id })) closeSheet(); },

  'goal-add'() {
    sheet('Новая цель', `${field('name', 'Название', 'maxlength="40" placeholder="Отпуск"')}${field('target', 'Сколько нужно', 'inputmode="decimal" placeholder="200000 или 200к"')}
      <label for="f-deadline">К какому месяцу</label><input id="f-deadline" type="month" min="${thisMonth()}">
      ${buttons(btn('Создать', 'goal-add-save'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'goal-add-save'() {
    const target = parseAmt(val('target'));
    if (!target || !val('deadline')) return toast('Укажи сумму и месяц', true);
    if (await act('goal_add', { name: val('name'), target, deadline: val('deadline') })) closeSheet();
  },
  'goal-save'(d) {
    const g = S.state.goals.find((x) => x.id === d.id);
    sheet(`Отложить в «${g?.name ?? ''}»`, `<p class="small muted">Эта сумма уйдёт из свободных денег${S.state.balance ? ' и вычтется из остатка' : ''}.</p>${field('amount', 'Сумма', `inputmode="decimal" placeholder="${g?.status.perMonth ?? ''}" value="${g?.status.perMonth ?? ''}"`)}<input type="hidden" id="f-id" value="${esc(d.id)}">${buttons(btn('🐷 Отложить', 'goal-save-do'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'goal-save-do'() {
    const amount = parseAmt(val('amount'));
    if (!amount) return toast('Введи сумму', true);
    const r = await act('goal_save', { id: val('id'), amount });
    if (r) { closeSheet(); toast(`Накоплено ${money(r.saved)} из ${money(r.target)}`); }
  },
  async 'goal-del'(d) { if (await ask('Удалить цель? Отложенная сумма на карту не вернётся: сначала нажми «Взять из цели».') && await act('goal_delete', { id: d.id })) closeSheet(); },

  'reserve-set'() {
    sheet('Остаток копилки', `<p class="small muted">Сколько сейчас лежит на счёте под аренду, коммуналку и интернет.</p>${field('amount', 'Сумма', `inputmode="decimal" value="${S.state.reserve?.amount ?? ''}" placeholder="46000"`)}${buttons(btn('Сохранить', 'reserve-set-save'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'reserve-set-save'() {
    const raw = val('amount').trim(); const a = raw === '0' ? 0 : parseAmt(raw);
    if (a === null) return toast('Не понял сумму', true);
    const r = await act('reserve_set', { amount: a });
    if (!r) return;
    if (r.askSubtract) {
      sheet('Вычесть из остатка карты?', `<p>Раньше «Остаток» мог включать эти деньги. Вычесть ${money(a)} из остатка на карте?</p>${buttons(btn(`Вычесть ${money(a)}`, 'reserve-sub', { amount: a }), btn('Остаток уже без резерва', 'close', {}, 'ghost'))}`);
    } else closeSheet();
  },
  async 'reserve-sub'(d) { if (await act('reserve_subtract', { amount: Number(d.amount) })) closeSheet(); },
  'reserve-deposit'() {
    sheet('Перевёл в копилку', `${field('amount', 'Сколько', 'inputmode="decimal" placeholder="30000 или 30к"')}${buttons(btn('Записать', 'reserve-deposit-save'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'reserve-deposit-save'() {
    const amount = parseAmt(val('amount'));
    if (!amount) return toast('Введи сумму', true);
    const r = await act('reserve_deposit', { amount });
    if (r) { closeSheet(); toast(`В копилке ${money(r.total)}`); }
  },
  'reserve-plan'(d) {
    const it = S.state.items.find((i) => i.id === d.id);
    sheet(`Взнос с «${it?.name ?? ''}»`, `<p class="small muted">Сколько переводить в копилку с этого дохода. 0 — автоматически.</p>${field('amount', 'Сумма', `inputmode="decimal" value="${it?.toReserve ?? ''}" placeholder="0"`)}<input type="hidden" id="f-id" value="${esc(d.id)}">${buttons(btn('Сохранить', 'reserve-plan-save'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'reserve-plan-save'() {
    const raw = val('amount').trim() || '0'; const a = raw === '0' ? 0 : parseAmt(raw);
    if (a === null) return toast('Не понял сумму', true);
    if (await act('reserve_plan', { id: val('id'), amount: a })) closeSheet();
  },
  'reserve-step'() { sheet('Округление перевода', `<p class="small muted">До какой суммы округлять перевод в копилку вверх.</p>${field('amount', 'Шаг', `inputmode="decimal" value="${S.state.settings.reserveStep ?? 1000}"`)}${buttons(btn('Сохранить', 'reserve-step-save'), btn('Отмена', 'close', {}, 'ghost'))}`); },
  async 'reserve-step-save'() { const a = parseAmt(val('amount')); if (!a) return toast('Не понял сумму', true); if (await act('reserve_step', { amount: a })) closeSheet(); },
  'reserve-contract'() { sheet('Счёт копилки', `<p class="small muted">Последние цифры номера договора: по ним бот узнает переводы в копилку в выписке.</p>${field('number', 'Номер договора', `inputmode="numeric" value="${esc(S.state.reserve?.contract ?? '')}" placeholder="8861"`)}${buttons(btn('Сохранить', 'reserve-contract-save'), btn('Отмена', 'close', {}, 'ghost'))}`); },
  async 'reserve-contract-save'() { if (val('number').replace(/\D/g, '').length < 3) return toast('Нужно хотя бы 3 цифры', true); if (await act('reserve_contract', { number: val('number') })) closeSheet(); },
  async 'reserve-off'() { if (await ask('Выключить копилку? Платежи будут считаться с карты.')) await act('reserve_off'); },
  transport() {
    sheet('Транспорт по формуле', `<p class="small muted">Проездной + ставка за каждый рабочий день цикла (по производственному календарю). Дальше бот пересчитывает сам.</p>${field('base', 'Проездной', 'inputmode="decimal" placeholder="3500"')}${field('daily', 'За каждый будний день', 'inputmode="decimal" placeholder="180"')}${buttons(btn('Сохранить', 'transport-save'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'transport-save'() {
    const base = parseAmt(val('base')); const daily = parseAmt(val('daily'));
    if (!base || !daily) return toast('Заполни обе суммы', true);
    if (await act('transport', { base, daily })) closeSheet();
  },

  nl() {
    sheet('Написать фразой', `<p class="small muted">Как в чате с ботом: «кофе 450», «аванс 80к 5 числа», «аренда 25000 1-го», «цель 200к к июню отпуск», «отложил 5000 на отпуск». Можно несколькими строками.</p>
      <textarea id="f-text" rows="4" placeholder="кофе 450"></textarea>${buttons(btn('Отправить', 'nl-send'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'nl-send'() {
    const text = val('text').trim();
    if (!text) return;
    const r = await act('nl', { text }, { silent: true });
    if (!r) return;
    if (r.done) { closeSheet(); toast(r.done); haptic('success'); } else if (r.confirm) confirmSheet(r.confirm); else if (r.reply) { const sh = sheet('Ответ', `<div class="info"></div>${buttons(btn('Ок', 'close'))}`); setInfo($('.info', sh), r.reply); } else closeSheet();
  },
  async 'nl-commit'() { const c = S.confirm; if (c && (await act('nl_commit', { confirm: c }))) { closeSheet(); S.confirm = null; } },

  console() {
    sheet('Команды бота', `<p class="small muted">Любая команда из справки: <code>/reserve plan Зарплата 30000</code>, <code>/next 2</code>, <code>/chart</code>…</p><input id="f-cmd" placeholder="/plan"><div class="info card" id="cmd-out" style="margin-top:12px" hidden></div>${buttons(btn('Выполнить', 'console-run'), btn('Закрыть', 'close', {}, 'ghost'))}`);
  },
  async 'console-run'() {
    const text = val('cmd').trim(); if (!text) return;
    const r = await act('command', { text }, { silent: true });
    const out = $('#cmd-out'); if (!r) return;
    out.hidden = false; setInfo(out, r.reply);
  },

  async view(d) { return infoSheet(d.title || 'Подробнее', d.name); },
  async forecast(d) {
    const k = Math.min(6, Math.max(1, Number(d.k) || 1));
    return infoSheet('Планирование вперёд', 'forecast', { k }, `<div class="actions" style="margin-bottom:8px">${btn('← Раньше', 'forecast', { k: k - 1 }, 'ghost')}${btn('Дальше →', 'forecast', { k: k + 1 }, 'ghost')}</div>`);
  },
  async log() {
    const l = S.state.log;
    sheet('История изменений', l.length ? `<div class="list">${l.map((e) => `<div class="item" style="cursor:default"><div class="grow"><div class="t" style="white-space:normal">${esc(e.text ?? e.t ?? '')}</div><div class="s">${dayLabel(dayKey(e.ts))}, ${timeStr(e.ts)}</div></div></div>`).join('')}</div>` : '<p class="muted">Пока пусто.</p>');
  },
  ai() {
    sheet('Спросить совет у ИИ', `<p class="small muted">Соберу данные бюджета в готовый текст. Скопируй его и вставь в ChatGPT или Claude.</p>${field('q', 'Вопрос (необязательно)', 'maxlength="500" placeholder="Стоит ли брать ноутбук за 80к?"')}<div class="info card" id="ai-out" style="margin-top:12px" hidden></div>${buttons(btn('Собрать текст', 'ai-run'), btn('📋 Копировать', 'ai-copy', {}, 'ghost'))}`);
  },
  async 'ai-run'() {
    try {
      const j = await api('view', { name: 'ai', question: val('q') });
      const out = $('#ai-out'); out.hidden = false; out.textContent = j.html; out.style.userSelect = 'all';
    } catch (e) { toast(e.message, true); }
  },
  async 'ai-copy'() {
    const t = $('#ai-out')?.textContent; if (!t) return toast('Сначала нажми «Собрать текст»', true);
    try { await navigator.clipboard.writeText(t); toast('Скопировано'); } catch { toast('Нажми на текст и скопируй вручную', true); }
  },

  import() { $('#pdf-input').click(); },
  async 'import-apply'(d) {
    const r = await act('import_apply', { id: d.id, withBalance: !!d.balance });
    if (r) { closeSheet(); toast(`Записано трат: ${r.rows} на ${money(r.total)}`); }
  },
  async 'import-cancel'(d) { await act('import_cancel', { id: d.id }, { silent: true }); closeSheet(); },

  async digest() { await act('digest', { on: !S.state.settings.digest }); },
  cycle() {
    sheet('С какого числа считать месяц', `<p class="small muted">Обычно это день зарплаты. «Авто» — самое раннее число регулярного дохода.</p>${field('day', 'Число месяца (1–31) или «авто»', `value="${S.state.settings.cycleAnchor ?? 'авто'}"`)}${buttons(btn('Сохранить', 'cycle-save'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'cycle-save'() {
    const v = val('day').trim().toLowerCase();
    const day = /^(авто|auto)$/.test(v) ? 'auto' : Number(v);
    if (day !== 'auto' && !(Number.isInteger(day) && day >= 1 && day <= 31)) return toast('Число от 1 до 31 или «авто»', true);
    if (await act('cycle', { day })) closeSheet();
  },
  async reset() {
    if (!(await ask('Стереть ВСЕ данные этого бюджета? Это нельзя отменить.'))) return;
    if (!(await ask('Точно стереть? Доходы, платежи, траты и цели будут удалены.'))) return;
    await act('reset', { confirm: true });
  },
};
