// Пакетный ввод: несколько строк в одном сообщении, с заголовками «Обязательные:», «Разовые:», «Доходы:».
import { parseFree, extractMonth, defaultDay } from './nlp.js';
import { categorize } from './cats.js';

const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/ /g, ' ');

const HEADERS = [
  [/^(обязательн\S*|регулярн\S*|ежемесячн\S*|платежи|платежи и счета|счета)$/, { type: 'bill', once: false }],
  [/^(разов\S*|единоразов\S*|одноразов\S*)$/, { type: 'bill', once: true }],
  [/^(доход\S*|поступлени\S*|зарплат\S*)$/, { type: 'income', once: false }],
  [/^(трат\S*|покупк\S*|расход\S*)$/, { type: 'spend', once: false }],
];

const NUM_RE = /(\d{1,3}(?: \d{3})+|\d+)([.,]\d{1,2})?\s?(к|k|тыс)?(?![а-яa-z0-9])/g;
const FILLER = new Set(['руб', 'руб.', 'р', 'р.', '₽', 'числа', 'число', 'каждый', 'месяц', 'до', 'к', 'в', 'на']);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const stripBullet = (l) => l.replace(/^\s*(?:[-–—•*·]|\d+[.)])\s+/, '').trim();

function headerOf(line, today) {
  let t = norm(line).replace(/[:：]\s*$/, '').trim();
  if (!t) return null;
  // Заголовок может содержать месяц: «Разовые на ноябрь:»
  let onceYm = null;
  const mo = extractMonth(t, today);
  if (mo && mo.day === null) { onceYm = mo.ym; t = mo.text.trim(); }
  if (/\d/.test(t)) return null;
  for (const [re, ctx] of HEADERS) {
    if (re.test(t)) return onceYm ? { ...ctx, once: true, onceYm } : ctx;
  }
  return null;
}

// Строка вида «аренда 25000 1» внутри раздела: сумма + число месяца без слова «числа»
function parseInContext(line, ctx, today) {
  const t = norm(line);
  const nums = [...t.matchAll(NUM_RE)].map((m) => {
    let v = parseFloat(m[1].replace(/ /g, '') + (m[2] ? m[2].replace(',', '.') : ''));
    if (m[3]) v *= 1000;
    return { v, raw: m[0], idx: m.index, suffix: !!m[3], int: !m[2] && !m[3] && /^\d{1,2}$/.test(m[1]) };
  });
  if (!nums.length) return null;

  let amountTok;
  let dayTok = null;
  if (nums.length === 1) {
    amountTok = nums[0];
  } else {
    const sorted = [...nums].sort((a, b) => b.v - a.v);
    amountTok = sorted[0];
    dayTok = nums.find((x) => x !== amountTok && x.int && x.v >= 1 && x.v <= 31) ?? null;
  }
  if (!(amountTok.v > 0)) return null;

  let rest = t;
  for (const tok of [amountTok, dayTok].filter(Boolean).sort((a, b) => b.idx - a.idx)) {
    rest = rest.slice(0, tok.idx) + ' ' + rest.slice(tok.idx + tok.raw.length);
  }
  const words = rest.split(/\s+/).filter((w) => w && !FILLER.has(w));
  const name = cap(words.join(' ').slice(0, 60));

  if (ctx.type === 'spend') {
    return { kind: 'spend', amount: amountTok.v, name: name || 'Трата', cat: categorize(name) };
  }
  const amount = Math.round(amountTok.v * 100) / 100;
  const nm = name || (ctx.type === 'income' ? 'Доход' : 'Платёж');
  if (!dayTok && !ctx.once) {
    // Обязательная трата без числа — «в течение месяца» (транспорт и т.п.); доходу число нужно
    if (ctx.type === 'bill') return { kind: 'bill', amount, day: null, name: nm, once: false, spread: true, cat: categorize(nm) };
    return { kind: 'skip', reason: 'нет числа месяца' };
  }
  return {
    kind: ctx.type, amount, day: dayTok ? dayTok.v : defaultDay(ctx.type, ctx.onceYm, today),
    name: nm, once: !!ctx.once, onceYm: ctx.onceYm ?? null, dayAuto: !dayTok,
  };
}

// -> null (не пакет) | { items, skipped }
export function parseBatch(raw, today) {
  const lines = String(raw ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2 || lines.length > 40) return null;

  let ctx = null;
  let hasHeader = false;
  const items = [];
  const skipped = [];
  let body = 0;

  for (const original of lines) {
    const h = headerOf(original, today);
    if (h) { ctx = h; hasHeader = true; continue; }
    body++;
    const line = stripBullet(original);
    let p = parseFree(line, today);
    if (ctx && (!p || p.kind === 'hint' || p.kind === 'spend' || (ctx.type === 'spend' && p.kind !== 'spend'))) {
      p = parseInContext(line, ctx, today) ?? p;
    }
    // «аванс 80к 5» без слова «числа»: число месяца берём из голой цифры
    if (ctx && p && (p.kind === 'income' || p.kind === 'bill') && (p.dayAuto || p.spread) && !ctx.once) {
      const alt = parseInContext(line, { ...ctx, type: p.kind }, today);
      if (alt && alt.kind === p.kind && !alt.dayAuto && !alt.spread) p = { ...alt, once: p.once || alt.once };
    }
    if (ctx?.once && p && (p.kind === 'income' || p.kind === 'bill')) {
      p = { ...p, once: true, spread: false, onceYm: p.onceYm ?? ctx.onceYm ?? null };
      if (p.day === null) p.day = defaultDay(p.kind, p.onceYm, today);
    }
    if (!p || p.kind === 'hint' || p.kind === 'skip' || p.kind === 'goal' || p.kind === 'save') {
      skipped.push(p?.reason ? `${original} (${p.reason})` : original);
      continue;
    }
    items.push(p);
  }

  if (!items.length && !hasHeader) return null;
  // Без заголовков реагируем только если понята каждая строка — иначе это просто разговор
  if (!hasHeader && items.length !== body) return null;
  return { items, skipped };
}
