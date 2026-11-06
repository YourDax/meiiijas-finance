// Обработчик запросов мини-приложения: подпись Telegram → выбор бюджета → действие → ответ.
// Возвращает { status, json }; HTTP-обвязка — в api/app.js.
import { normalize, nowInTz } from './bot.js';
import { verifyInitData } from './webapp.js';
import { AppError, buildState, buildView, runAction, importParse } from './app.js';
import { overspendAlerts } from './digest.js';
import { refreshDash } from './engine.js';
import { money } from './format.js';

const MAX_PDF_B64 = 3_400_000; // Vercel принимает тело запроса до 4,5 МБ
const MEMBER = new Set(['creator', 'administrator', 'member']);

const err = (status, error) => ({ status, json: { error } });

// Состоит ли пользователь в беседе (иначе чужой бюджет не отдаём)
async function isMember(tg, chatId, userId) {
  try {
    const r = await tg.getChatMember(chatId, userId);
    return !!r?.ok && (MEMBER.has(r.result?.status) || (r.result?.status === 'restricted' && r.result?.is_member));
  } catch {
    return false;
  }
}

async function listChats(user, startParam, { store, tg }) {
  const chats = [{ id: user.id, title: 'Личный бюджет', type: 'private' }];
  const ids = new Set(await store.userChats?.(user.id).catch(() => []) ?? []);
  if (startParam && /^-\d+$/.test(startParam)) ids.add(Number(startParam));
  ids.delete(user.id);
  const found = await Promise.all([...ids].map(async (id) => {
    if (!(await isMember(tg, id, user.id))) return null;
    const c = await tg.getChat(id).catch(() => null);
    return { id, title: c?.result?.title ?? `Беседа ${id}`, type: c?.result?.type ?? 'group' };
  }));
  chats.push(...found.filter(Boolean));
  return { chats, suggest: startParam && /^-\d+$/.test(startParam) ? Number(startParam) : null };
}

export async function handleApp(body, deps) {
  const { store, tg } = deps;
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now();
  if (!body || typeof body !== 'object') return err(400, 'Некорректный запрос');

  const auth = verifyInitData(body.initData, env.BOT_TOKEN, { now });
  if (!auth) return err(401, 'Открой приложение из Telegram');
  const { user } = auth;
  const tz = env.TZ_NAME || 'Europe/Moscow';
  const action = String(body.action ?? '');
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
  const currency = env.CURRENCY || '₽';

  try {
    if (action === 'chats') return { status: 200, json: await listChats(user, auth.startParam, deps) };

    let chatId = user.id;
    if (body.chatId != null && Number(body.chatId) !== user.id) {
      chatId = Number(body.chatId);
      if (!Number.isSafeInteger(chatId) || chatId >= 0 || !(await isMember(tg, chatId, user.id))) return err(403, 'Нет доступа к этому бюджету');
    }

    const today = nowInTz(tz, new Date(now));
    const raw = await store.load(chatId);
    const by = user.first_name || undefined;
    const ctx = { by, tz };
    const state = (data) => buildState(data, today, { tz, currency });

    if (action === 'state') return { status: 200, json: { state: state(raw), chatId, user: { id: user.id, name: by } } };
    if (action === 'view') return { status: 200, json: { html: buildView(raw, today, String(payload.name ?? ''), payload, tz) } };

    let r;
    if (action === 'import_parse') {
      const b64 = String(payload.pdf ?? '');
      if (!b64 || b64.length > MAX_PDF_B64) return err(413, 'Файл слишком большой: выгрузи выписку за более короткий период');
      r = await importParse(raw, today, ctx, Buffer.from(b64, 'base64'), { pdfText: deps.pdfText });
    } else {
      r = runAction(raw, today, ctx, action, payload);
    }

    if (r.changed) {
      await store.save(chatId, r.data);
      // Бот в беседе узнаёт о правке: обновляем закреплённую сводку и предупреждаем о перерасходе
      try {
        const alerts = overspendAlerts(normalize(raw), r.data, today);
        if (alerts.length) await tg.send(chatId, alerts.join('\n\n'));
        await refreshDash(chatId, r.data, today, { store, tg });
        if (r.result?.undone) await tg.send(chatId, `↩️ Отменено в приложении: ${money(r.result.undone.amount)} ${r.result.undone.name ?? ''}`.trim());
      } catch (e) {
        console.error('app sync error', e);
      }
    }
    return { status: 200, json: { result: r.result ?? {}, state: state(r.data), chatId } };
  } catch (e) {
    if (e instanceof AppError) return err(400, e.message);
    console.error('app error', action, e);
    return err(500, 'Что-то пошло не так, попробуй ещё раз');
  }
}
