// Мини-приложение Telegram: проверка подписи initData и адрес приложения.
import { createHmac, timingSafeEqual } from 'node:crypto';

// Проверяет initData по схеме Telegram (HMAC-SHA256 от токена бота).
// Возвращает { user, startParam, authDate } или null, если подпись неверна или данные устарели.
export function verifyInitData(initData, botToken, { maxAgeSec = 24 * 3600, now = Date.now() } = {}) {
  if (typeof initData !== 'string' || !initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete('hash');
  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = createHmac('sha256', secret).update(check).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== calc.length || !timingSafeEqual(given, calc)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || now / 1000 - authDate > maxAgeSec || authDate - now / 1000 > 300) return null;
  let user;
  try { user = JSON.parse(params.get('user') ?? ''); } catch { return null; }
  if (!user || !Number.isSafeInteger(user.id)) return null;
  return { user, startParam: params.get('start_param') ?? null, authDate };
}

// Публичный адрес мини-приложения (тот же домен, что у вебхука)
export function appUrl(env = process.env) {
  const u = env.APP_URL || env.PUBLIC_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  return (u || 'https://meiiijas-finance-bot.vercel.app').replace(/\/+$/, '');
}
