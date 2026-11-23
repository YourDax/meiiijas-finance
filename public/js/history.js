import { S, store } from './state.js';
import { esc, dayKey, dayLabel, timeStr, ymLabel, thisMonth, catIcon, catTitle } from './util.js';
import { btn } from './ui.js';
import { matchesQuery } from '../stats.js';

const kinds = { spend: 'Трата', topup: 'Пополнение', withdraw: 'Снятие' };
const types = { all: 'Все операции', spend: 'Траты', topup: 'Пополнения', withdraw: 'Снятия' };
const amount = (n) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${esc(S.state.currency ?? '₽')}`;
const signed = (n) => n === 0 ? amount(0) : `${n > 0 ? '+' : '−'}${amount(Math.abs(n))}`;

function operations() {
  return [
    ...S.state.spends.map((x) => ({ ...x, kind: 'spend' })),
    ...S.state.topups.map((x) => ({ ...x, kind: x.amount < 0 ? 'withdraw' : 'topup', amount: Math.abs(x.amount) })),
    ...(S.state.confirmedHistory ?? []),
  ];
}

export function historyTab(limits) {
  const current = thisMonth();
  const selected = S.filter.month === 'cur' ? current : S.filter.month;
  const months = new Set([current, ...operations().map((x) => dayKey(x.ts).slice(0, 7))]);
  if (selected !== 'all') months.add(selected);
  return `
    <div class="row between"><h1>История</h1>${btn('⬇️ CSV', 'export-csv', { history: '1' }, 'ghost small')}</div>
    <div class="history-actions">
      ${btn('＋ Трата', 'spend-add', {}, 'small')}${btn('＋ Пополнение', 'topup-add', {}, 'small')}${btn('Снятие', 'topup-add', { kind: 'withdraw' }, 'ghost small')}
    </div>
    <div class="history-filters">
      <select aria-label="Период" data-input="history-month">
        ${[...months].sort().reverse().map((m) => `<option value="${m}" ${selected === m ? 'selected' : ''}>${ymLabel(m)}</option>`).join('')}
        <option value="all" ${selected === 'all' ? 'selected' : ''}>За всё время</option>
      </select>
      <select aria-label="Тип операции" data-input="history-kind">${Object.entries(types).map(([key, label]) =>
        `<option value="${key}" ${S.filter.kind === key ? 'selected' : ''}>${label}</option>`).join('')}</select>
      <input type="search" aria-label="Поиск по истории" data-input="history-q" placeholder="Название, сумма или дата" value="${esc(S.filter.q)}">
    </div>
    <div id="history-list">${historyList()}</div>${limits}`;
}

function operationRow(x) {
  const spend = x.kind === 'spend' && !x.key;
  const action = x.key ? 'history-plan' : spend ? 'spend-edit' : 'topup-edit';
  const icon = spend ? catIcon(x.cat) : x.kind === 'topup' ? '💰' : '💸';
  const source = x.key ? (x.fromReserve ? 'из копилки' : 'по плану') : x.src === 'bank' ? 'из выписки' : x.src === 'plan' ? 'по плану' : '';
  const meta = [spend ? catTitle(x.cat) : kinds[x.kind], timeStr(x.ts), source, x.by].filter(Boolean).map(esc).join(' · ');
  const row = `<div class="item" role="button" tabindex="0" data-act="${action}" ${spend ? 'data-swipe' : ''} data-id="${esc(x.key ?? x.id)}">
    <div class="ico" aria-hidden="true">${icon}</div><div class="grow"><div class="t">${esc(x.name || (spend ? catTitle(x.cat) : kinds[x.kind]))}</div>
    <div class="s">${meta}</div></div><div class="amt ${x.kind === 'topup' ? 'pos' : ''}">${signed(x.kind === 'topup' ? x.amount : -x.amount)}</div></div>`;
  return `<div class="history-entry${spend ? ' swipe' : ''}">${spend ? '<div class="sw sw-l">✏️ Изменить</div><div class="sw sw-r">🗑 Удалить</div>' : ''}${row}</div>`;
}

export function historyList() {
  const { kind, q } = S.filter;
  const month = S.filter.month === 'cur' ? thisMonth() : S.filter.month;
  const rows = operations().filter((x) => (kind === 'all' || x.kind === kind)
    && (month === 'all' || dayKey(x.ts).startsWith(month))
    && matchesQuery(x, q, { catTitle: () => x.cat ? catTitle(x.cat) : kinds[x.kind], dayLabel, dayKey }))
    .sort((a, b) => b.ts - a.ts);
  const note = S.state.spendsTotal > S.state.spends.length && (kind === 'all' || kind === 'spend')
    ? `<p class="small muted center">В списке доступны последние ${S.state.spends.length} записанных трат. Более ранние сохранённые траты доступны в CSV.</p>` : '';
  if (!rows.length) return `<div class="card center"><p class="muted">${q.trim() ? 'Ничего не найдено' : 'За выбранный период нет таких операций'}</p>
    ${q.trim() || kind !== 'all' || month !== 'all' ? btn('Сбросить фильтры', 'history-reset', {}, 'ghost small') : ''}</div>${note}`;
  const groups = new Map();
  let incoming = 0;
  let outgoing = 0;
  for (const x of rows) {
    if (x.kind === 'topup') incoming += x.amount;
    else outgoing += x.amount;
  }
  for (const x of rows.slice(0, S.historyLimit)) {
    const key = dayKey(x.ts);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x);
  }
  const showSwipe = rows.some((x) => x.kind === 'spend' && !x.key) && !store.get('swipe-hint');
  return `<div class="card history-totals">
    <div><span class="small muted">Пришло</span><b class="pos">${signed(incoming)}</b></div>
    <div><span class="small muted">Ушло</span><b>${signed(-outgoing)}</b></div>
    <div><span class="small muted">Разница</span><b>${signed(Math.round((incoming - outgoing) * 100) / 100)}</b></div>
  </div>
  ${showSwipe ? `<div class="card small row between"><span>Нажми на запись, чтобы открыть её. Траты можно менять свайпом вправо и удалять свайпом влево.</span>${btn('Понятно', 'swipe-ok', {}, 'ghost small')}</div>` : ''}
  ${[...groups].map(([key, list]) => `<h2>${dayLabel(key)}${key.slice(0, 4) !== String(S.state.today.y) ? ` ${key.slice(0, 4)}` : ''}</h2>
    <div class="list history-items">${list.map(operationRow).join('')}</div>`).join('')}
    ${rows.length > S.historyLimit ? `<div class="center">${btn('Показать ещё', 'history-more', {}, 'ghost')}</div>` : ''}${note}`;
}
