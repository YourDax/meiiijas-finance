// Формы пунктов плана, карточки подтверждения, остаток прошлого периода.
import { S } from './state.js';
import { $, esc, money, ymGen, thisMonth, MONTHS_NOM } from './util.js';
import { sheet, field, buttons, btn } from './ui.js';
import { whenText } from './tabs.js';

// ---------- формы ----------
export function itemForm(it) {
  const spreadable = it ? it.type === 'bill' : true;
  return `
    ${it ? '' : `<label for="f-type">Что это</label><select id="f-type"><option value="income">💰 Доход</option><option value="bill" selected>📌 Обязательный платёж</option></select>`}
    ${field('name', 'Название', `value="${esc(it?.name ?? '')}" maxlength="60" placeholder="Аренда, Зарплата…"`)}
    ${field('amount', 'Сумма', `inputmode="decimal" value="${it ? it.amount : ''}" placeholder="25000 или 25к"`)}
    ${it ? '' : `<label for="f-sched">Когда</label><select id="f-sched"><option value="monthly">Каждый месяц, в определённое число</option><option value="spread" id="o-spread">В течение месяца (без даты)</option><option value="week">Каждую неделю</option><option value="quarter">Раз в квартал</option><option value="year">Раз в год</option><option value="once">Один раз</option></select>
      <div id="w-weekday" hidden><label for="f-weekday">День недели</label><select id="f-weekday">${['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'].map((d, i) => `<option value="${i}">${d}</option>`).join('')}</select></div>
      <div id="w-month" hidden><label for="f-month">Месяц первого платежа</label><select id="f-month">${MONTHS_NOM.map((m, i) => `<option value="${i}" ${i === S.state.today.m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      <div id="w-day">${field('day', 'Число месяца', 'inputmode="numeric" placeholder="1–31"')}</div>
      <div id="w-once" hidden><label for="f-once">Месяц</label><input id="f-once" type="month" value="${thisMonth()}"></div>`}
    ${it?.every ? `<p class="small muted">Когда: ${esc(whenText(it))}. Чтобы сменить повтор, удали пункт и добавь заново.</p>` : it ? `<label for="f-when">Когда (число, «в течение месяца», «в ноябре»)</label><input id="f-when" value="${esc(whenText(it).replace(/^Каждый месяц · /, ''))}">` : ''}
    ${it?.spread ? `<label for="f-cat">Категория</label><select id="f-cat">${Object.entries(S.state.cats).map(([k, c]) => `<option value="${k}" ${it.cat === k ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : ''}
    ${spreadable ? '' : ''}`;
}

export function bindItemForm(sh) {
  const type = $('#f-type', sh); const sched = $('#f-sched', sh);
  if (!sched) return;
  const sync = () => {
    const isIncome = type.value === 'income';
    $('#o-spread', sh).disabled = isIncome;
    if (isIncome && sched.value === 'spread') sched.value = 'monthly';
    $('#w-day', sh).hidden = sched.value === 'spread' || sched.value === 'week';
    $('#w-weekday', sh).hidden = sched.value !== 'week';
    $('#w-month', sh).hidden = sched.value !== 'quarter' && sched.value !== 'year';
    $('#w-once', sh).hidden = sched.value !== 'once';
  };
  type.addEventListener('change', sync); sched.addEventListener('change', sync); sync();
}

export function confirmCard(c) {
  if (c.kind === 'goal') return `<div class="card">🎯 <b>${esc(c.name)}</b><br>${money(c.amount)} · до ${ymGen(c.deadline)}</div>`;
  const line = (it) => `${it.kind === 'spend' ? '🧾' : it.kind === 'income' ? '💰' : '📌'} <b>${esc(it.name)}</b> — ${money(it.amount)}${it.kind === 'spend' ? '' : ` · ${it.spread ? 'в течение месяца' : it.once ? `один раз, ${it.day}-го` : `каждое ${it.day}-е`}`}`;
  if (c.kind === 'batch') return `<div class="card small">${c.items.map((it) => `<div style="margin:4px 0">${line(it)}</div>`).join('')}${c.skipped?.length ? `<div class="warn" style="margin-top:8px">Не разобрал: ${c.skipped.map(esc).join('; ')}</div>` : ''}</div>`;
  return `<div class="card">${line(c)}${c.dayAuto && c.kind === 'income' ? '<div class="small muted" style="margin-top:6px">Число не указано — взял сегодняшнее. Лучше добавить вручную.</div>' : ''}</div>`;
}
export function confirmSheet(c) {
  S.confirm = c;
  const title = c.kind === 'goal' ? 'Создать цель?' : c.kind === 'batch' ? `Записать ${c.items.length} пунктов?` : c.kind === 'income' ? 'Записать доход?' : 'Записать платёж?';
  sheet(title, confirmCard(c) + buttons(btn('✅ Записать', 'nl-commit'), btn('Отмена', 'close', {}, 'ghost')));
}

export function leftoverSheet(l) {
  sheet('🎉 Остаток прошлого периода', `<p>Не потрачено <b>${money(l.amount)}</b>. Отложить в цель?</p><div class="list">${l.goals.map((g) => `<div class="item" data-act="goal-leftover" data-id="${esc(g.id)}" data-amount="${l.amount}"><div class="ico">🎯</div><div class="grow"><div class="t">${esc(g.name)}</div></div><div class="amt">+${money(l.amount)}</div></div>`).join('')}</div>${buttons(btn('Оставить себе', 'close', {}, 'ghost'))}`);
}
