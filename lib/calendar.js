// Производственный календарь РФ: рабочие дни без праздников и переносов (нужен для транспорта по формуле).
// Основа — правила Трудового кодекса: праздники из списка ниже, а праздник на выходной переносится на ближайший
// следующий рабочий день (ст. 112). Точные переносы года правительство утверждает отдельным постановлением,
// поэтому их можно задать в OVERRIDES: off — дополнительные выходные, work — дни, которые остаются рабочими.
// Даты — [месяц 0–11, число].

const FIXED = [
  [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8], // новогодние каникулы
  [1, 23], [2, 8], [4, 1], [4, 9], [5, 12], [10, 4],
];

const OVERRIDES = {
  // 2026: выходные 3 и 10 января перенесены на 9 января и 31 декабря; 12 января остаётся рабочим
  2026: { off: [[11, 31]], work: [[0, 12]] },
};

const dnOf = (y, m, d) => Math.round(Date.UTC(y, m, d) / 86400000);
const isWeekend = (n) => (n + 3) % 7 >= 5; // 1970-01-01 — четверг

const cache = new Map();
function yearInfo(year) {
  if (cache.has(year)) return cache.get(year);
  const holi = new Set(FIXED.map(([m, d]) => dnOf(year, m, d)));
  const off = new Set();
  for (const n0 of [...holi].sort((a, b) => a - b)) {
    let n = n0;
    if (isWeekend(n)) { // праздник выпал на выходной — выходной день переносится на следующий рабочий
      do n += 1; while (isWeekend(n) || holi.has(n) || off.has(n));
    }
    off.add(n);
  }
  const o = OVERRIDES[year] ?? { off: [], work: [] };
  const work = new Set(o.work.map(([m, d]) => dnOf(year, m, d)));
  for (const [m, d] of o.off) off.add(dnOf(year, m, d));
  const info = { off, work };
  cache.set(year, info);
  return info;
}

// n — номер дня от 1970-01-01 (как в period.js)
export function isWorkday(n) {
  const { off, work } = yearInfo(new Date(n * 86400000).getUTCFullYear());
  if (work.has(n)) return true;
  return !isWeekend(n) && !off.has(n);
}

// Рабочих дней в [a, b)
export function workdaysBetween(a, b) {
  let c = 0;
  for (let n = a; n < b; n++) if (isWorkday(n)) c++;
  return c;
}
