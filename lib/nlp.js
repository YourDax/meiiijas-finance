// Разбор обычных фраз: «аванс 80к 5 числа», «аренда 25000 1-го», «кофе 450».
import { categorize } from './cats.js';
import { ymOf } from './budget.js';

const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/ /g, ' ');

const INCOME_KW = /(^|\s)(аванс|зарплат|зп(?=\s|$)|получил|пришл|премия|премию|доход|подработк|возврат|кэшбэк|кешбэк|выплат|пенси|стипенди|поступил)/;
const ONCE_KW = /(разово|единоразов|в этом месяце|на этот месяц|один раз)/;
const ONCE_INCOME_KW = /(премия|премию|подарок|возврат|кэшбэк|кешбэк|подработк|пришл|получил)/;
const BILL_KW = /(^|\s)(аренд|ипотек|кредит|платеж|рассрочк|интернет|связь|подписк|коммунал|жкх|страховк|налог|садик|обязательн|ежемесячн|каждый месяц|долг|в месяц(?=\s|$)|в мес(?=\s|$)|\/мес(?=\s|$))/;

const FILLER = new Set([
  'каждый', 'каждое', 'каждого', 'месяц', 'числа', 'число', 'разово', 'единоразово', 'в', 'этом', 'месяце',
  'на', 'этот', 'только', 'получил', 'получила', 'получили', 'пришло', 'пришли', 'пришла', 'до', 'к', 'р',
  'руб', 'руб.', 'р.', '₽', '+', 'за', 'от', 'мне', 'нам', 'один', 'раз', 'потратил', 'потратила', 'купил',
  'купила', 'ежемесячно', 'я', 'мы', '/мес', 'мес',
]);

const DAY_RE = /(?:^|\s)(?:до\s+|к\s+|каждого\s+|каждое\s+)?(\d{1,2})\s*(?:-?\s*(?:го|ого|е|ое)\s+)?числ[аоеу]?(?=\s|$)|(?:^|\s)(\d{1,2})(?:-(?:го|ого|е|ое)|го|ого)(?=\s|$)/;
const AMOUNT_RE = /(\d{1,3}(?: \d{3})+|\d+)([.,]\d{1,2})?\s?(к|k|тыс|тр)?(?![а-яa-z0-9])/;
// «р» / «руб» / «₽» — только отдельным словом или сразу после цифры, иначе режется конец слов («маникюр» → «маникю»)
const CURRENCY_RE = /(?<![а-яa-z])(₽|руб\.?|р\.?)(?=\s|$)/g;

// Месяц в тексте: «в ноябре», «на январь 2027», «5 декабря». Для разовых пунктов на другой месяц.
const MONTH_FORMS = ['январ[ьяе]', 'феврал[ьяе]', 'март[ае]?', 'апрел[ьяе]', 'ма[йяе]', 'июн[ьяе]', 'июл[ьяе]', 'август[ае]?', 'сентябр[ьяе]', 'октябр[ьяе]', 'ноябр[ьяе]', 'декабр[ьяе]'];
const MONTH_PHRASE = new RegExp(String.raw`(?:^|\s)(?:(\d{1,2})\s+)?(?:(?:в|на|за)\s+)?(${MONTH_FORMS.join('|')})(?:\s+(20\d\d))?(?=\s|$)`);

// -> null | { ym, day, text } — text без найденной фразы
export function extractMonth(text, today) {
  const m = MONTH_PHRASE.exec(text);
  if (!m) return null;
  const idx = MONTH_FORMS.findIndex((f) => new RegExp('^(?:' + f + ')$').test(m[2]));
  if (idx < 0) return null;
  const y = m[3] ? Number(m[3]) : today.y + (idx < today.m ? 1 : 0);
  const day = m[1] && Number(m[1]) >= 1 && Number(m[1]) <= 31 ? Number(m[1]) : null;
  return { ym: `${y}-${String(idx + 1).padStart(2, '0')}`, day, text: text.replace(m[0], ' ') };
}

// День по умолчанию для разового пункта без числа: в текущем месяце — сегодня, в будущем — консервативно
export const defaultDay = (kind, ym, today) => (ym && ym !== ymOf(today) ? (kind === 'income' ? 28 : 1) : today.d);

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// -> null | { kind: 'income'|'bill'|'spend'|'hint', amount, day, name, once, dayAuto, cat, text }
export function parseFree(raw, today) {
  let t = norm(String(raw ?? '')).trim();
  if (!t || t.length > 120 || t.includes('?') || /https?:\/\//.test(t)) return null;
  const plus = t.startsWith('+');
  let work = plus ? t.slice(1).trim() : t;

  let monthYm = null;
  let monthDay = null;
  const mo = extractMonth(work, today);
  if (mo) { monthYm = mo.ym; monthDay = mo.day; work = mo.text; }

  let day = null;
  const dm = DAY_RE.exec(work);
  if (dm) {
    const d = Number(dm[1] ?? dm[2]);
    day = d >= 1 && d <= 31 ? d : null;
    work = work.replace(dm[0], ' ');
  }
  if (day === null && monthDay !== null) day = monthDay;

  const am = AMOUNT_RE.exec(work);
  if (!am) return null;
  let amount = parseFloat(am[1].replace(/ /g, '') + (am[2] ? am[2].replace(',', '.') : ''));
  if (am[3]) amount *= 1000;
  amount = Math.round(amount * 100) / 100;
  if (!(amount > 0)) return null;

  const before = work.slice(0, am.index);
  const after = work.slice(am.index + am[0].length);
  const hasCur = /(₽|руб|(^|\s)р\.?(\s|$))/.test(`${before} ${after}`);
  const atEdge = before.trim() === '' || after.replace(CURRENCY_RE, ' ').trim() === '';
  const nameTokens = `${before} ${after}`
    .replace(CURRENCY_RE, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w));

  const isIncome = plus || INCOME_KW.test(t);
  const isBill = !isIncome && (day !== null || monthYm !== null || BILL_KW.test(t));
  const once = ONCE_KW.test(t) || monthYm !== null || (isIncome && ONCE_INCOME_KW.test(t));
  const name = cap(nameTokens.join(' ').slice(0, 60));

  if (isIncome) {
    const dayAuto = day === null;
    return {
      kind: 'income', amount, day: day ?? defaultDay('income', monthYm, today), name: name || 'Доход',
      once: once || dayAuto, onceYm: monthYm, dayAuto,
    };
  }
  if (isBill) {
    // Без числа месяца и не разовый — трата «в течение месяца» (транспорт, продукты и т.п.)
    if (day === null && !once) {
      const nm = name || 'Платёж';
      return { kind: 'bill', amount, day: null, name: nm, once: false, spread: true, cat: categorize(nm) };
    }
    return {
      kind: 'bill', amount, day: day ?? defaultDay('bill', monthYm, today), name: name || 'Платёж',
      once, onceYm: monthYm, dayAuto: day === null,
    };
  }

  // Обычная трата — только короткие фразы вида «кофе 450», чтобы не реагировать на болтовню
  if (!nameTokens.length || nameTokens.length > 4 || !atEdge) return null;
  if (amount < 10 && !hasCur) return null;
  // «встретимся в 18», «до 20» — это время, а не сумма
  if (!hasCur && /(^|\s)(в|к|на|до|с|по|около|после|через|за|из)$/.test(before.trim())) return null;
  const nm = nameTokens.join(' ');
  return { kind: 'spend', amount, name: cap(nm), cat: categorize(nm) };
}

// ── Цели накопления ──────────────────────────────────────────────────────────
const MONTH_STEMS = ['январ', 'феврал', 'март', 'апрел', 'ма[йяе]', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
const GOAL_FILLER = new Set(['цель', 'накопить', 'копить', 'на', 'к', 'до', 'в', 'за', 'руб', 'руб.', 'р', 'р.', '₽', 'мне', 'нам']);

// «цель 200к к июню отпуск», «накопить 100000 до декабря 2027 ноутбук», «цель 50к через 6 месяцев на машину»
function parseGoal(t, today) {
  let work = t;
  let deadline = null;

  const inM = /через\s+(\d{1,2})\s*мес\S*/.exec(work);
  if (inM) {
    const k = Number(inM[1]);
    const total = today.y * 12 + today.m + k;
    deadline = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
    work = work.replace(inM[0], ' ');
  } else {
    for (let i = 0; i < 12; i++) {
      const re = new RegExp(String.raw`(?:^|\s)(?:(?:к|до|на|в)\s+)?(?:конец\s+|концу\s+)?${MONTH_STEMS[i]}\S*(?:\s+(20\d\d))?(?=\s|$)`);
      const m = re.exec(work);
      if (!m) continue;
      const y = m[1] ? Number(m[1]) : today.y + (i <= today.m ? 1 : 0);
      deadline = `${y}-${String(i + 1).padStart(2, '0')}`;
      work = work.replace(m[0], ' ');
      break;
    }
  }
  if (!deadline) return { kind: 'hint', text: 'Укажи срок: «цель 200к к июню отпуск» или «цель 50к через 6 месяцев машина»' };

  const am = AMOUNT_RE.exec(work);
  if (!am) return null;
  let amount = parseFloat(am[1].replace(/ /g, '') + (am[2] ? am[2].replace(',', '.') : ''));
  if (am[3]) amount *= 1000;
  if (!(amount > 0)) return null;
  const rest = (work.slice(0, am.index) + ' ' + work.slice(am.index + am[0].length))
    .replace(CURRENCY_RE, ' ').split(/\s+/).filter((w) => w && !GOAL_FILLER.has(w));
  return { kind: 'goal', amount: Math.round(amount * 100) / 100, deadline, name: cap(rest.join(' ').slice(0, 40)) || 'Цель' };
}

// «отложил 5000 на отпуск», «в копилку 3к»
const SAVE_FILLER = new Set(['отложил', 'отложила', 'отложили', 'накопил', 'накопила', 'пополнил', 'пополнила', 'внес', 'внесла', 'в', 'на', 'копилку', 'цель', 'в копилку', 'руб', 'р', '₽']);
function parseSave(t) {
  const am = AMOUNT_RE.exec(t);
  if (!am) return null;
  let amount = parseFloat(am[1].replace(/ /g, '') + (am[2] ? am[2].replace(',', '.') : ''));
  if (am[3]) amount *= 1000;
  if (!(amount > 0)) return null;
  const rest = (t.slice(0, am.index) + ' ' + t.slice(am.index + am[0].length))
    .replace(CURRENCY_RE, ' ').split(/\s+/).filter((w) => w && !SAVE_FILLER.has(w));
  return { kind: 'save', amount: Math.round(amount * 100) / 100, name: rest.join(' ') };
}

const parseFreeBase = parseFree;
export function parseAny(raw, today) {
  const t = norm(String(raw ?? '')).trim();
  if (!t || t.length > 120 || t.includes('?')) return null;
  if (/^(цель|накопить|копить)(\s|$)/.test(t)) return parseGoal(t, today);
  const tr = /транспорт.*?(\d[\d ]*)\s*(?:\+|и)\s*(\d+)\s*(?:₽|р|руб\S*)?\s*(?:за\s+)?(?:по\s+)?(?:буд|кажд)/.exec(t);
  if (tr) return { kind: 'transport', base: Number(tr[1].replace(/ /g, '')), daily: Number(tr[2]) };
  if ((/^(перевел|отложил|положил|закинул|внес)\S*\s/.test(t) && /(резерв|аренд|коммунал)/.test(t)) || /^(в\s+|на\s+)?резерв\S*\s/.test(t)) {
    const am = AMOUNT_RE.exec(t);
    if (am) {
      let v = parseFloat(am[1].replace(/ /g, '') + (am[2] ? am[2].replace(',', '.') : ''));
      if (am[3]) v *= 1000;
      if (v > 0) return { kind: 'rdeposit', amount: Math.round(v * 100) / 100 };
    }
  }
  if (isTopup(t)) return parseTopup(t);
  if (/^(отложил|отложила|накопил|накопила|пополнил|пополнила|в копилку)(\s|$)/.test(t)) return parseSave(t);
  return parseFreeBase(raw, today);
}

// ── Разовое пополнение баланса ───────────────────────────────────────────────
// «пополнил баланс 5000», «пополнение 3к», «положил на карту 10к», «+5000 на баланс»
const TOPUP_WHERE = /(баланс|счет|карт|кошел|наличн)/;
const isTopup = (t) =>
  (/^(пополни\S*|положил\S*|докинул\S*|закинул\S*|внес\S*|перевел\S*\s+себе)(\s|$)/.test(t) && TOPUP_WHERE.test(t))
  || /^пополнение(\s|$)/.test(t)
  || (t.startsWith('+') && TOPUP_WHERE.test(t));

const TOPUP_FILLER = new Set(['пополнил', 'пополнила', 'пополнение', 'положил', 'положила', 'докинул', 'закинул', 'внес', 'внесла', 'на', 'в', 'баланс', 'баланса', 'счет', 'карту', 'карты', 'карте', 'кошелек', 'наличные', 'руб', 'р', '₽', '+', 'себе', 'перевел', 'перевела']);
function parseTopup(t) {
  const am = AMOUNT_RE.exec(t);
  if (!am) return null;
  let amount = parseFloat(am[1].replace(/ /g, '') + (am[2] ? am[2].replace(',', '.') : ''));
  if (am[3]) amount *= 1000;
  if (!(amount > 0)) return null;
  const rest = (t.slice(0, am.index) + ' ' + t.slice(am.index + am[0].length))
    .replace(CURRENCY_RE, ' ').split(/\s+/).filter((w) => w && !TOPUP_FILLER.has(w));
  return { kind: 'topup', amount: Math.round(amount * 100) / 100, name: cap(rest.join(' ').slice(0, 40)) || 'Пополнение' };
}
