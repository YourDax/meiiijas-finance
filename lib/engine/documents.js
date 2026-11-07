// Входящие документы: PDF-выписка Т-Банка.
import { normalize } from '../bot.js';
import { extractPdfText, parseStatementText, prepareImport, previewText } from '../statement.js';
import { TZ } from './cards.js';
import { makeImportPending } from '../ops.js';

// Выписка Т-Банка (PDF): разбираем и показываем карточку с итогами до записи
export async function onDocument(msg, deps) {
  const { store, tg, today } = deps;
  const doc = msg.document;
  const isPdf = doc.mime_type === 'application/pdf' || /\.pdf$/i.test(doc.file_name ?? '');
  if (!isPdf) return;
  const chatId = msg.chat.id;
  const by = msg.from?.first_name ?? undefined;
  if ((doc.file_size ?? 0) > 15 * 1024 * 1024) {
    await tg.send(chatId, '📄 Файл слишком большой. Выгрузи выписку за более короткий период.');
    return;
  }
  await tg.send(chatId, '📄 Читаю выписку…');
  let parsed;
  try {
    const info = await tg.getFile(doc.file_id);
    const buffer = await tg.download(info.result.file_path);
    parsed = parseStatementText(await (deps.pdfText ?? extractPdfText)(buffer), TZ());
  } catch (err) {
    console.error('statement error', err);
    await tg.send(chatId, '😵 Не получилось прочитать PDF. Пришли «Справку о движении средств» Т-Банка файлом без пароля.');
    return;
  }
  if (!parsed.rows.length) {
    await tg.send(chatId, '🤔 Не нашёл операций. Это должна быть «Справка о движении средств» Т-Банка (PDF из приложения: Счёт → Выписка).');
    return;
  }
  const data = normalize(await store.load(chatId));
  const prep = prepareImport(data, parsed, TZ());
  const pend = makeImportPending(prep, parsed, by);
  data.pending = [...data.pending.filter((x) => x.kind !== 'import'), pend].slice(-10);
  await store.save(chatId, data);
  const rows = [];
  if (pend.rows.length || pend.deposits.length) {
    if (parsed.balance) rows.push([{ text: '✅ Записать траты и задать остаток', callback_data: `ix:${pend.id}:b` }]);
    rows.push([{ text: pend.rows.length ? '✅ Записать только траты' : '✅ Готово', callback_data: `ix:${pend.id}:n` }]);
  } else if (parsed.balance) {
    rows.push([{ text: '💼 Только задать остаток', callback_data: `ix:${pend.id}:b` }]);
  }
  rows.push([{ text: '❌ Отмена', callback_data: `no:${pend.id}` }]);
  await tg.send(chatId, previewText(prep, parsed, TZ()), { reply_markup: { inline_keyboard: rows } });
}
