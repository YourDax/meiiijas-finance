// Выгрузка трат в CSV для Excel/Google Таблиц: разделитель «;», запятая в сумме, BOM для кириллицы.
import { catName } from './cats.js';

// Ячейка, начинающаяся с = + - @, в Excel превращается в формулу: экранируем апострофом
const cell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function spendsToCsv(spends, { tz = 'Europe/Moscow' } = {}) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const time = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const rows = [...spends].sort((a, b) => a.ts - b.ts).map((s) => [
    day.format(new Date(s.ts)),
    time.format(new Date(s.ts)),
    String(s.amount).replace('.', ','),
    s.name ?? '',
    catName(s.cat),
    s.by ?? '',
    s.src === 'bank' ? 'выписка' : 'вручную',
  ].map(cell).join(';'));
  return `﻿${['Дата', 'Время', 'Сумма', 'Название', 'Категория', 'Кто', 'Источник'].join(';')}\r\n${rows.join('\r\n')}${rows.length ? '\r\n' : ''}`;
}
