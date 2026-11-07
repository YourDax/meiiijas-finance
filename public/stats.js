// Статистика трат для интерфейса: сравнение недель и месяцев, ряд по дням, поиск. Чистые функции без DOM.

// Ключ дня «ГГГГ-ММ-ДД» в часовом поясе tz
export const dayKeyOf = (ts, tz) => new Date(ts).toLocaleDateString('en-CA', { timeZone: tz });

// Номер дня от 1970-01-01 для ключа «ГГГГ-ММ-ДД»
export const dnOfKey = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
};
const keyOfDn = (dn) => new Date(dn * 86400000).toISOString().slice(0, 10);

// 0 — понедельник … 6 — воскресенье (1 января 1970 — четверг)
const weekdayOfDn = (dn) => (((dn + 3) % 7) + 7) % 7;

const sum = (list) => list.reduce((a, x) => a + x.amount, 0);

// Изменение в процентах; null, если сравнивать не с чем
export const deltaPct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

export function compareSpends(spends, nowTs, tz) {
  const todayKey = dayKeyOf(nowTs, tz);
  const todayDn = dnOfKey(todayKey);
  const withDn = spends.map((s) => ({ amount: s.amount, dn: dnOfKey(dayKeyOf(s.ts, tz)), ym: dayKeyOf(s.ts, tz).slice(0, 7), d: Number(dayKeyOf(s.ts, tz).slice(8)) }));

  // Неделя с понедельника; прошлую берём до того же дня недели, чтобы сравнение было честным
  const ws = todayDn - weekdayOfDn(todayDn);
  const elapsed = todayDn - ws;
  const weekCur = sum(withDn.filter((s) => s.dn >= ws && s.dn <= todayDn));
  const weekPrev = sum(withDn.filter((s) => s.dn >= ws - 7 && s.dn <= ws - 7 + elapsed));

  const ym = todayKey.slice(0, 7);
  const dayOfMonth = Number(todayKey.slice(8));
  const [y, m] = ym.split('-').map(Number);
  const prevYm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const monthCur = sum(withDn.filter((s) => s.ym === ym));
  const monthPrev = sum(withDn.filter((s) => s.ym === prevYm && s.d <= dayOfMonth));
  const monthPrevFull = sum(withDn.filter((s) => s.ym === prevYm));

  const days = [];
  for (let dn = todayDn - 13; dn <= todayDn; dn++) days.push({ key: keyOfDn(dn), sum: sum(withDn.filter((s) => s.dn === dn)), today: dn === todayDn });

  return {
    week: { cur: weekCur, prev: weekPrev, pct: deltaPct(weekCur, weekPrev) },
    month: { cur: monthCur, prev: monthPrev, prevFull: monthPrevFull, pct: deltaPct(monthCur, monthPrev) },
    days,
    hasData: spends.length > 0,
  };
}

// Поиск по названию, категории, автору, сумме («450», «1 500», «1,5к») и дате («5 марта», «05.03»)
export function matchesQuery(spend, q, { catTitle, dayLabel, dayKey }) {
  const query = String(q ?? '').trim().toLowerCase();
  if (!query) return true;
  const key = dayKey(spend.ts);
  const [, mm, dd] = key.split('-');
  const hay = `${spend.name ?? ''} ${catTitle(spend.cat)} ${spend.by ?? ''} ${dayLabel(key)} ${dd}.${mm}`.toLowerCase();
  if (hay.includes(query)) return true;
  const digits = query.replace(/\s/g, '').replace(',', '.');
  if (/^\d+(\.\d+)?$/.test(digits)) return String(spend.amount).startsWith(digits);
  const k = digits.match(/^(\d+(?:\.\d+)?)(к|k)$/);
  return !!k && spend.amount === Math.round(Number(k[1]) * 1000 * 100) / 100;
}
