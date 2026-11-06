// Импорт выписки Т-Банка («Справка о движении средств», PDF): разбор текста, классификация, поиск дублей.
import { categorizeMerchant, catName, merchantInfo } from './cats.js';
import { occurrences, dn, fromDn } from './period.js';
import { round2 } from './budget.js';
import { money } from './format.js';

const HOUR = 3600000;

// Текст из PDF. unpdf подгружается только здесь, чтобы тесты и остальные модули не тянули pdf.js
export async function extractPdfText(buffer) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).join('\n');
}

const toNum = (s) => Number(String(s).replace(/\s/g, '').replace(',', '.'));

// Локальное время выписки -> UTC-метка
export function zonedTs(y, m, d, hh, mm, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(guess)).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return guess - (asUtc - guess);
}

const HEADER_RE = /Дата и время операции Дата списания Сумма в валюте операции Сумма операции в валюте карты Описание операции Номер карты/g;
const FOOTER_RE = /АО «ТБанк» универсальная лицензия[\s\S]*?КПП \d+ \d+/g;
const ROW_RE = /(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}) \d{2}\.\d{2}\.\d{4} \d{2}:\d{2} ([+-]?\d[\d ]*[.,]\d{2}) ?[^\s\d]{1,3} ([+-]?\d[\d ]*[.,]\d{2}) ?[^\s\d]{1,3} (.+?) (\d{4})(?= \d{2}\.\d{2}\.\d{4} \d{2}:\d{2} \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}|\s*$)/g;

// -> { rows, balance: {amount, date:'DD.MM.YYYY'}|null, totals: {inflow, outflow}|null, ok }
export function parseStatementText(raw, tz = 'Europe/Moscow') {
  let t = String(raw ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/Справка о движении средств/.test(t)) return { rows: [], balance: null, totals: null, ok: false, reason: 'not-statement' };

  const bm = /Сумма доступного остатка на (\d{2}\.\d{2}\.\d{4}): ?(-?\d[\d ]*[.,]\d{2})/.exec(t);
  const balance = bm ? { date: bm[1], amount: toNum(bm[2]) } : null;

  // Суммы с пробелом-разделителем тысяч; номер карты перед ними («3192 23 900,00») в сумму не попадает
  const tm = /(\d{1,3}(?: \d{3})*,\d{2}) ?₽ ?Пополнения: ?(\d{1,3}(?: \d{3})*,\d{2}) ?₽ ?Расходы:/.exec(t);
  const totals = tm ? { inflow: toNum(tm[1]), outflow: toNum(tm[2]) } : null;
  if (tm) t = t.slice(0, tm.index);

  const first = t.search(HEADER_RE);
  if (first >= 0) t = t.slice(first);
  t = t.replace(FOOTER_RE, ' ').replace(HEADER_RE, ' ').replace(/\s+/g, ' ').trim();

  const rows = [];
  for (const m of t.matchAll(ROW_RE)) {
    const [, dd, mo, yyyy, hh, mi, , amt, desc, card] = m;
    rows.push({
      ts: zonedTs(+yyyy, +mo, +dd, +hh, +mi, tz),
      amount: toNum(amt), // в валюте карты, со знаком
      desc: desc.replace(/\s+/g, ' ').trim(),
      card,
    });
  }
  // Проверка полноты: суммы должны сойтись с итогами в конце справки
  let ok = rows.length > 0;
  if (totals) {
    const inflow = round2(rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0));
    const outflow = round2(-rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0));
    ok = Math.abs(inflow - totals.inflow) < 0.02 && Math.abs(outflow - totals.outflow) < 0.02;
  }
  return { rows, balance, totals, ok };
}

// Тип операции и название/категория
export function classifyRow(r, rules = {}) {
  const d = r.desc;
  if (/^Внутренний перевод/i.test(d)) return { ...r, kind: 'internal', contract: (/договор\w*\s+(\d+)/i.exec(d) ?? [])[1] ?? null };
  if (r.amount > 0) return { ...r, kind: 'inflow', name: d.split('.')[0].slice(0, 40) };
  if (/^Оплата в /i.test(d)) {
    const rest = d.replace(/^Оплата в\s+/i, '');
    const { key, name } = merchantInfo(rest);
    return { ...r, kind: 'purchase', merchant: key, name, cat: categorizeMerchant(rest, key, rules) };
  }
  if (/^Внешний перевод/i.test(d)) return { ...r, kind: 'purchase', merchant: 'TRANSFER', name: 'Перевод людям', cat: rules.TRANSFER ?? 'other' };
  if (/Снятие наличных|Выдача наличных/i.test(d)) return { ...r, kind: 'purchase', merchant: 'CASH', name: 'Снятие наличных', cat: rules.CASH ?? 'other' };
  return { ...r, kind: 'purchase', merchant: 'OTHER', name: d.slice(0, 40), cat: 'other' };
}

export function rowHash(r) {
  const s = `${r.ts}|${r.amount}|${r.desc}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Подготовка к импорту: что новое, что уже записано, что похоже на мои платежи
export function prepareImport(data, parsed, tz = 'Europe/Moscow') {
  const rules = data.rules ?? {};
  const imported = new Set(data.imported ?? []);
  const manual = (data.spends ?? []).filter((s) => s.src !== 'bank');
  const usedManual = new Set();
  const items = data.items ?? [];

  const out = { fresh: [], dupImport: [], dupManual: [], bills: [], internal: [], inflow: [], deposits: [], contracts: {} };
  const res = data.reserve;
  const resContract = res?.contract ?? null;
  const usedHist = new Set();
  for (const raw of parsed.rows) {
    const r = classifyRow(raw, rules);
    r.h = rowHash(raw);
    if (r.kind === 'internal') {
      const toReserve = resContract && r.contract && r.contract.endsWith(resContract);
      if (toReserve && !imported.has(r.h) && r.ts > (res.ts ?? 0)) {
        // перевод на счёт резерва (минус на карте = плюс в резерве); ручную запись о таком переводе не задваиваем
        const amount = round2(-r.amount);
        const hist = (res.history ?? []).find((x) => x.src === 'manual' && !x.matched && !usedHist.has(x.ts) && Math.abs(x.amount - amount) <= 1 && Math.abs(x.ts - r.ts) <= 3 * 24 * HOUR);
        if (hist) usedHist.add(hist.ts);
        out.deposits.push({ ts: r.ts, amount, h: r.h, dupOf: hist ? hist.ts : null });
        continue;
      }
      if (toReserve) { out.dupImport.push(r); continue; }
      if (r.contract && r.amount < 0) out.contracts[r.contract] = round2((out.contracts[r.contract] ?? 0) - r.amount);
      out.internal.push(r);
      continue;
    }
    if (r.kind === 'inflow') { out.inflow.push(r); continue; }
    if (imported.has(r.h)) { out.dupImport.push(r); continue; }
    const abs = Math.abs(r.amount);
    // Вручную записанная трата: сумма совпадает (с точностью до рубля или 1%), дата в пределах 5 дней — берём ближайшую
    const tol = Math.max(1.01, abs * 0.01);
    const man = manual
      .filter((s) => !usedManual.has(s.id) && Math.abs(s.amount - abs) <= tol && Math.abs(s.ts - r.ts) <= 5 * 24 * HOUR)
      .sort((a, b) => Math.abs(a.ts - r.ts) - Math.abs(b.ts - r.ts))[0];
    if (man) { usedManual.add(man.id); out.dupManual.push({ ...r, matched: man.name }); continue; }
    // Похоже на мой обязательный платёж (та же сумма около даты платежа)
    const day = dn(...Object.values(fromDn(Math.floor(r.ts / 86400000))));
    const occ = occurrences(items, day - 7, day + 7).find((o) => o.type === 'bill' && Math.abs(o.amount - abs) < 0.5);
    if (occ) { out.bills.push({ ...r, matched: occ.name }); continue; }
    out.fresh.push(r);
  }
  out.reserveContract = resContract;
  return out;
}

const fmtDate = (ts, tz) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'short' }).format(new Date(ts));

export function previewText(prep, parsed, tz = 'Europe/Moscow') {
  const sum = (a) => round2(a.reduce((s, r) => s + Math.abs(r.amount), 0));
  const all = parsed.rows;
  const from = all.length ? fmtDate(Math.min(...all.map((r) => r.ts)), tz) : '';
  const to = all.length ? fmtDate(Math.max(...all.map((r) => r.ts)), tz) : '';
  const L = [`📄 <b>Выписка Т-Банка</b> · ${from} — ${to}`, `Операций в файле: ${all.length}`, ''];

  const byCat = {};
  for (const r of prep.fresh) byCat[r.cat] = round2((byCat[r.cat] ?? 0) + Math.abs(r.amount));
  L.push(`🧾 <b>Новые траты: ${prep.fresh.length} на ${money(sum(prep.fresh))}</b>`);
  for (const [k, v] of Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 6)) L.push(`   ${catName(k)} — ${money(v)}`);

  const other = prep.fresh.filter((r) => r.cat === 'other');
  if (other.length) {
    const names = [...new Set(other.map((r) => r.name))].slice(0, 5).join(', ');
    L.push(`   ❓ В «Другое»: ${names} — категорию можно поменять в /list`);
  }
  const skipped = [];
  if (prep.dupImport.length) skipped.push(`уже импортированы: ${prep.dupImport.length}`);
  if (prep.dupManual.length) skipped.push(`уже записаны вручную: ${prep.dupManual.length}`);
  if (skipped.length) L.push('', `♻️ Пропущу — ${skipped.join(', ')}`);
  if (prep.bills.length) {
    L.push('', `🔁 Похожи на мои платежи (не считаю тратами): ${prep.bills.map((r) => `${r.matched} ${money(Math.abs(r.amount))}`).join(', ')}`);
  }
  if (prep.deposits.length) {
    const fresh = prep.deposits.filter((d) => !d.dupOf);
    L.push('', `🏠 Переводы на резерв для аренды: ${fresh.length} на ${money(round2(fresh.reduce((s, d) => s + d.amount, 0)))}${prep.deposits.length > fresh.length ? ` (ещё ${prep.deposits.length - fresh.length} уже учтены вручную)` : ''}`);
  }
  if (prep.internal.length) {
    L.push('', `➡️ Переводы между своими счетами: ${prep.internal.length} на ${money(sum(prep.internal))} — не считаю тратами`);
    const cs = Object.entries(prep.contracts);
    if (cs.length && !prep.reserveContract) {
      L.push(`   <i>Если один из договоров — резерв на аренду, задай: /reserve contract последние-цифры (${cs.map(([c, v]) => `…${c.slice(-4)} ${money(v)}`).join(', ')})</i>`);
    }
  }
  if (prep.inflow.length) L.push('', `💚 Поступления: ${prep.inflow.length} на ${money(sum(prep.inflow))} — отдельно не записываю`);
  if (parsed.balance) L.push('', `💼 Остаток по выписке: <b>${money(parsed.balance.amount)}</b> на ${parsed.balance.date}`);
  if (!parsed.ok) L.push('', '⚠️ Суммы операций не сошлись с итогами справки — часть строк могла не разобраться. Проверь результат.');
  return L.join('\n');
}
