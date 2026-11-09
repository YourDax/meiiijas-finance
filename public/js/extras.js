// Обработчики новых разделов: мастер настройки, счета, долги, цели, лимиты, категории, итоги.
import { S, store, act } from './state.js';
import { $, esc, money, thisMonth, parseAmt, toast, ask, isoStr } from './util.js';
import { closeSheet, sheet, val, field, buttons, btn, infoSheet } from './ui.js';
import { render, curBalance } from './tabs.js';

const parseOrZero = (raw) => (String(raw).trim() === '0' ? 0 : parseAmt(raw));
const steps = (n) => `<div class="wizard-step">Шаг ${n} из 3</div>`;
const skip = (next) => btn('Пропустить', 'wizard', { step: next }, 'ghost');

export const renderExtras = {
  // ---------- первая настройка ----------
  wizard(d) {
    store.set('wizard', '1');
    const step = Number(d.step);
    if (step === 1) {
      sheet('Сколько денег сейчас?', `${steps(1)}<p class="small muted">Посмотри в приложении банка и введи сумму на карте. От неё считается, сколько можно тратить в день.</p>${field('amount', 'Сейчас на карте', 'inputmode="decimal" placeholder="30000 или 30к"')}${buttons(btn('Дальше', 'wizard-balance'), skip(2))}`);
    } else if (step === 2) {
      sheet('Когда приходят деньги?', `${steps(2)}<p class="small muted">Зарплата, аванс, стипендия: то, что приходит каждый месяц. Если доходов несколько, остальные добавишь на вкладке «План».</p>${field('name', 'Название', 'maxlength="60" value="Зарплата"')}${field('amount', 'Сумма', 'inputmode="decimal" placeholder="80000 или 80к"')}${field('day', 'Какого числа', 'inputmode="numeric" placeholder="1–31"')}${buttons(btn('Дальше', 'wizard-item', { type: 'income', next: 3 }), skip(3))}`);
    } else if (step === 3) {
      sheet('Что нужно платить каждый месяц?', `${steps(3)}<p class="small muted">Аренда, кредит, подписка. Эти деньги приложение сразу отложит и не даст потратить их случайно.</p>${field('name', 'Название', 'maxlength="60" placeholder="Аренда"')}${field('amount', 'Сумма', 'inputmode="decimal" placeholder="25000 или 25к"')}${field('day', 'Какого числа', 'inputmode="numeric" placeholder="1–31"')}${buttons(btn('Готово', 'wizard-item', { type: 'bill', next: 4 }), btn('Добавить ещё', 'wizard-item', { type: 'bill', next: 3 }, 'ghost'))}${buttons(skip(4))}`);
    } else {
      sheet('🎉 Всё готово', `<p>На главной видно, сколько можно потратить сегодня.</p><div class="steps small"><div>🧾 Купил что-то — запиши сумму на главной.</div><div>📅 Заплатил по счёту или получил зарплату — нажми кнопку на вкладке «План», и баланс изменится сам.</div><div>＋ Всё остальное — под круглой кнопкой внизу.</div></div>${buttons(btn('Начать', 'close'))}`);
    }
  },
  async 'wizard-balance'() {
    const a = parseOrZero(val('amount'));
    if (a === null) return toast('Введи сумму, например 30000', true);
    if (await act('balance_set', { amount: a }, { silent: true })) renderExtras.wizard({ step: 2 });
  },
  async 'wizard-item'(d) {
    const amount = parseAmt(val('amount'));
    const day = Number(val('day'));
    if (!val('name').trim()) return toast('Введи название', true);
    if (!amount) return toast('Введи сумму', true);
    if (!Number.isInteger(day) || day < 1 || day > 31) return toast('Число месяца от 1 до 31', true);
    if (await act('item_add', { type: d.type, amount, name: val('name'), day }, { silent: true })) renderExtras.wizard({ step: d.next });
  },
  'acc-tab'(d) { S.accTab = d.tab; render(); window.scrollTo(0, 0); },
  'swipe-ok'() { store.set('swipe-hint', '1'); render(); },

  // Откуда взялась сумма на день
  'explain-limit'() {
    const p = S.state.period;
    const line = (t, v, cls = '') => `<div class="row between small" style="margin:6px 0"><span>${t}</span><b class="${cls}">${v}</b></div>`;
    const b = p.breakdown ?? {};
    const signed = (v) => `${v > 0 ? '+' : '−'}${money(Math.abs(v))}`;
    // Строка расчёта, которая раскрывается в список: какие именно платежи и доходы в ней учтены
    const detail = (t, value, rows, cls = '') => (rows?.length ? `<details class="calc"><summary><span>${t}</span><b class="${cls}">${value}</b></summary><div class="calc-rows">${rows.map((r) => `<div class="row between small"><span>${esc(r.name)}${r.date || r.note ? ` <span class="muted">· ${r.date ? isoStr(r.date) : esc(r.note)}</span>` : ''}</span><b class="${r.amount > 0 ? 'pos' : ''}">${signed(r.amount)}</b></div>`).join('')}</div></details>` : line(t, value, cls));
    const minus = (t, v, rows) => (v >= 1 ? detail(t, `−${money(v)}`, rows) : '');
    const known = p.now - p.dueSum - p.reserveTotal - p.transferNow - p.reserveNextPeriod;
    const later = p.cycleTotal - known;
    sheet('Как считается лимит на день', `<p class="small muted">Строки со стрелкой раскрываются: там видно, что именно вычитается и прибавляется.</p><div class="card" style="padding:8px 14px">
      ${line('На карте сейчас', money(p.now))}
      ${minus(`Платежи ${p.noIncome ? 'до конца месяца' : 'до зарплаты'}`, p.dueSum, b.due)}
      ${minus('Обязательные траты без даты', p.reserveTotal, b.spread)}
      ${minus('Отложить в копилку на аренду', p.transferNow, b.transfer)}
      ${minus('Отложить на следующий месяц', p.reserveNextPeriod, b.next)}
      ${Math.abs(later) >= 1 ? detail('Будущие доходы месяца за вычетом их платежей', signed(later), b.future) : ''}
      ${line('Остаётся на жизнь', money(p.cycleTotal))}
      ${p.freeToday >= 1 ? line('Прибавляем потраченное сегодня: оно входит в лимит дня', `+${money(p.freeToday)}`) : ''}
      ${line('Дней впереди', p.cycleDays)}
      ${line('На один день', money(p.dayBudget))}
      ${line('Уже потрачено сегодня из лимита', money(p.freeToday))}
      ${line('Сегодня ещё можно', money(p.leftToday), p.leftToday <= 0 ? 'neg' : 'pos')}
    </div>${buttons(btn('Понятно', 'close'))}`);
  },

  // ---------- итоги ----------
  async month(d) {
    const k = Math.min(12, Math.max(0, Number(d.k) || 0));
    return infoSheet('Итоги месяца', 'month', { k }, `<div class="actions" style="margin-bottom:8px">${k < 12 ? btn('← Раньше', 'month', { k: k + 1 }, 'ghost') : ''}${k > 0 ? btn('Позже →', 'month', { k: k - 1 }, 'ghost') : ''}</div>`);
  },

  // ---------- счета ----------
  'account-add'() {
    sheet('Новый счёт', `<p class="small muted">Наличные, вклад, другая карта.</p>${field('name', 'Название', 'maxlength="40" placeholder="Наличные"')}${field('amount', 'Сколько там сейчас', 'inputmode="decimal" placeholder="5000"')}${buttons(btn('Добавить', 'account-add-save'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'account-add-save'() {
    const amount = parseOrZero(val('amount'));
    if (amount === null) return toast('Введи сумму', true);
    if (await act('account_add', { name: val('name'), amount })) closeSheet();
  },
  'account-edit'(d) {
    const a = S.state.accounts.find((x) => x.id === d.id);
    if (!a) return;
    sheet('Счёт', `${field('name', 'Название', `maxlength="40" value="${esc(a.name)}"`)}${field('amount', 'Сколько там сейчас', `inputmode="decimal" value="${a.amount}"`)}<input type="hidden" id="f-id" value="${esc(a.id)}">${buttons(btn('Сохранить', 'account-save'), btn('Удалить', 'account-del', { id: a.id }, 'danger'))}`);
  },
  async 'account-save'() {
    const amount = parseOrZero(val('amount'));
    if (amount === null) return toast('Введи сумму', true);
    if (await act('account_edit', { id: val('id'), name: val('name'), amount })) closeSheet();
  },
  async 'account-del'(d) { if (await ask('Удалить счёт? Сумма на нём больше не будет учитываться.')) { if (await act('account_delete', { id: d.id })) closeSheet(); } },
  transfer() {
    const s = S.state;
    const sides = [
      ...(s.balance ? [['card', `💳 Карта · ${money(s.cardBalance)}`]] : []),
      ...(s.reserve ? [['reserve', `🏠 Копилка на аренду · ${money(s.reserve.amount)}`]] : []),
      ...s.accounts.map((a) => [a.id, `💰 ${a.name} · ${money(a.amount)}`]),
    ];
    if (sides.length < 2) return sheet('Перевод между счетами', `<p class="small">Для перевода нужно два счёта. Сначала ${s.balance ? '' : 'укажи остаток на карте и '}добавь ещё один счёт.</p>${buttons(btn('➕ Добавить счёт', 'account-add'), btn('Закрыть', 'close', {}, 'ghost'))}`);
    const opts = (sel) => sides.map(([v, t]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`).join('');
    sheet('Перевод между счетами', `<p class="small muted">Деньги остаются твоими: это не трата.</p><label for="f-from">Откуда</label><select id="f-from">${opts(sides[0][0])}</select><label for="f-to">Куда</label><select id="f-to">${opts(sides[1][0])}</select>${field('amount', 'Сумма', 'inputmode="decimal" placeholder="5000"')}${buttons(btn('🔁 Перевести', 'transfer-save'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'transfer-save'() {
    const amount = parseAmt(val('amount'));
    if (!amount) return toast('Введи сумму', true);
    const from = val('from'); const to = val('to');
    if (await act('transfer', { from, to, amount })) {
      closeSheet();
      toast(`Переведено ${money(amount)}`, false, { label: 'Отменить', run: () => act('transfer', { from: to, to: from, amount }) });
    }
  },

  // ---------- долги ----------
  'debt-add'() {
    sheet('Новый долг', `<label for="f-kind">Кто кому должен</label><select id="f-kind"><option value="owe">Я должен</option><option value="lent">Должны мне</option></select>${field('name', 'Кто', 'maxlength="40" placeholder="Аня, банк…"')}${field('amount', 'Сумма', 'inputmode="decimal" placeholder="5000"')}<label for="f-money">Деньги</label><select id="f-money"><option value="">Только записать, баланс не менять</option><option value="1">Деньги прошли через карту сейчас</option></select>${buttons(btn('Записать', 'debt-add-save'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'debt-add-save'() {
    const amount = parseAmt(val('amount'));
    if (!amount) return toast('Введи сумму', true);
    if (await act('debt_add', { kind: val('kind'), name: val('name'), amount, withMoney: !!val('money') })) closeSheet();
  },
  'debt-pay'(d) {
    const x = S.state.debts.find((v) => v.id === d.id);
    if (!x) return;
    const owe = x.kind === 'owe';
    sheet(x.name, `<p class="small muted">Осталось ${money(x.left)}. ${owe ? 'Сумма спишется с карты.' : 'Сумма добавится на карту.'}</p>${field('amount', 'Сколько вернули', `inputmode="decimal" value="${x.left}"`)}<input type="hidden" id="f-id" value="${esc(x.id)}">${buttons(btn(owe ? 'Вернул' : 'Вернули', 'debt-pay-save'), btn('Удалить долг', 'debt-del', { id: x.id }, 'danger'))}`);
  },
  async 'debt-pay-save'() {
    const amount = parseAmt(val('amount'));
    if (!amount) return toast('Введи сумму', true);
    const id = val('id');
    const r = await act('debt_pay', { id, amount });
    if (r) {
      closeSheet();
      toast(`Записано · на карте ${money(curBalance())}`, false, { label: 'Отменить', run: () => act('debt_pay_undo', { id, topupId: r.topupId }) });
    }
  },
  async 'debt-del'(d) { if (await ask('Удалить запись о долге? Баланс не изменится.')) { if (await act('debt_delete', { id: d.id })) closeSheet(); } },

  // ---------- цели ----------
  'goal-out'(d) {
    const g = S.state.goals.find((x) => x.id === d.id);
    if (!g) return;
    sheet(`Взять из «${g.name}»`, `<p class="small muted">В цели ${money(g.saved)}. Сумма вернётся на карту.</p>${field('amount', 'Сколько взять', `inputmode="decimal" value="${g.saved}"`)}<input type="hidden" id="f-id" value="${esc(g.id)}">${buttons(btn('Взять', 'goal-out-save'), btn('Отмена', 'close', {}, 'ghost'))}`);
  },
  async 'goal-out-save'() {
    const amount = parseAmt(val('amount'));
    if (!amount) return toast('Введи сумму', true);
    if (await act('goal_withdraw', { id: val('id'), amount })) { closeSheet(); toast(`Взято ${money(amount)} · на карте ${money(curBalance())}`); }
  },
  'goal-edit'(d) {
    const g = S.state.goals.find((x) => x.id === d.id);
    if (!g) return;
    sheet('Цель', `${field('name', 'Название', `maxlength="40" value="${esc(g.name)}"`)}${field('target', 'Сколько нужно', `inputmode="decimal" value="${g.target}"`)}<label for="f-deadline">К какому месяцу</label><input id="f-deadline" type="month" min="${thisMonth()}" value="${esc(g.deadline)}"><input type="hidden" id="f-id" value="${esc(g.id)}">${buttons(btn('Сохранить', 'goal-edit-save'), btn('Удалить', 'goal-del', { id: g.id }, 'danger'))}`);
  },
  async 'goal-edit-save'() {
    const target = parseAmt(val('target'));
    if (!target || !val('deadline')) return toast('Укажи сумму и месяц', true);
    if (await act('goal_edit', { id: val('id'), name: val('name'), target, deadline: val('deadline') })) closeSheet();
  },

  // ---------- лимиты и категории ----------
  'cat-limits'() {
    const set = new Map(S.state.catLimits.map((l) => [l.cat, l]));
    sheet('Лимиты по категориям', `<p class="small muted">Сколько можно тратить на категорию за календарный месяц. Приложение предупредит, когда потрачено 90%.</p><div class="list">${Object.entries(S.state.cats).map(([k, c]) => `<div class="item" data-act="cat-limit-edit" data-cat="${esc(k)}"><div class="grow"><div class="t">${esc(c.name)}</div></div><span class="muted small">${set.has(k) ? money(set.get(k).limit) : 'нет лимита'}</span></div>`).join('')}</div>${buttons(btn('Закрыть', 'close', {}, 'ghost'))}`);
    $('#ov').querySelectorAll('[data-act]:not(button)').forEach((el) => { el.setAttribute('role', 'button'); el.tabIndex = 0; });
  },
  'cat-limit-edit'(d) {
    const cur = S.state.catLimits.find((l) => l.cat === d.cat);
    sheet(S.state.cats[d.cat]?.name ?? 'Лимит', `<p class="small muted">0 — убрать лимит.</p>${field('amount', 'Лимит на месяц', `inputmode="decimal" value="${cur?.limit ?? ''}" placeholder="20000"`)}<input type="hidden" id="f-cat" value="${esc(d.cat)}">${buttons(btn('Сохранить', 'cat-limit-save'), btn('Отмена', 'cat-limits', {}, 'ghost'))}`);
  },
  async 'cat-limit-save'() {
    const amount = parseOrZero(val('amount'));
    if (amount === null) return toast('Введи сумму', true);
    if (await act('cat_limit', { cat: val('cat'), amount })) renderExtras['cat-limits']();
  },
  cats() {
    const own = Object.entries(S.state.cats).filter(([, c]) => c.custom);
    sheet('Свои категории', `<p class="small muted">Появятся в списке категорий при записи траты.</p>${own.length ? `<div class="list">${own.map(([k, c]) => `<div class="item" style="cursor:default"><div class="grow"><div class="t">${esc(c.name)}</div></div>${btn('Удалить', 'cat-del', { key: k }, 'ghost small')}</div>`).join('')}</div>` : ''}${field('name', 'Новая категория', 'maxlength="30" placeholder="🎨 Хобби"')}${buttons(btn('Добавить', 'cat-add-save'), btn('Закрыть', 'close', {}, 'ghost'))}`);
  },
  async 'cat-add-save'() {
    if (!val('name').trim()) return toast('Введи название', true);
    if (await act('cat_add', { name: val('name') })) renderExtras.cats();
  },
  async 'cat-del'(d) { if (await act('cat_delete', { key: d.key })) renderExtras.cats(); },
};
