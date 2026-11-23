// Выгрузка трат в CSV для Excel/Google Таблиц: разделитель «;», запятая в сумме, BOM для кириллицы.
import { catName } from './cats.js';

// Ячейка, начинающаяся с = + - @, в Excel превращается в формулу: экранируем апострофом
const cell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function spendsToCsv(spends, options) {
  return operationsToCsv(spends, options, false);
}

export function historyToCsv(operations, options) {
  return operationsToCsv(operations, options, true);
}

function operationsToCsv(spends, { tz = 'Europe/Moscow' } = {}, history) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const time = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const kinds = { spend: 'Трата', topup: 'Пополнение', withdraw: 'Снятие' };
  const rows = [...spends].sort((a, b) => a.ts - b.ts).map((s) => [
    day.format(new Date(s.ts)),
    time.format(new Date(s.ts)),
    ...(history ? [kinds[s.kind]] : []),
    String(s.amount).replace('.', ','),
    s.name ?? '',
    s.cat || !history ? catName(s.cat) : '',
    s.by ?? '',
    s.src === 'bank' ? 'выписка' : history && s.src === 'plan' ? 'план' : 'вручную',
  ].map(cell).join(';'));
  const headers = ['Дата', 'Время', ...(history ? ['Тип'] : []), 'Сумма', 'Название', 'Категория', 'Кто', 'Источник'];
  return `﻿${headers.join(';')}\r\n${rows.join('\r\n')}${rows.length ? '\r\n' : ''}`;
}
