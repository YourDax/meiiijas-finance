// Хранилище данных чата в Upstash Redis (Vercel Marketplace -> Upstash Redis).
import { randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';

let redis;
function client() {
  if (!redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    if (!url || !token) throw new Error('Не заданы переменные Redis (UPSTASH_REDIS_REST_URL / _TOKEN)');
    redis = new Redis({ url, token });
  }
  return redis;
}

const key = (chatId) => `finance:chat:${chatId}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Снимаем замок, только если он всё ещё наш (иначе можно удалить чужой после истечения TTL)
const UNLOCK = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

export const store = {
  load: (chatId) => client().get(key(chatId)),
  save: (chatId, data) => client().set(key(chatId), data),

  // Выполняет fn под замком чата: параллельные «загрузил → изменил → сохранил» не затирают друг друга.
  // Замок сам истекает через ttlMs, поэтому упавшая функция его не заблокирует.
  async withLock(chatId, fn, { ttlMs = 25_000, waitMs = 12_000 } = {}) {
    const k = `finance:lock:${chatId}`;
    const token = randomUUID();
    const deadline = Date.now() + waitMs;
    while (!(await client().set(k, token, { nx: true, px: ttlMs }))) {
      if (Date.now() > deadline) throw new Error(`lock timeout: ${chatId}`);
      await sleep(80 + Math.random() * 120);
    }
    try {
      return await fn();
    } finally {
      await client().eval(UNLOCK, [k], [token]).catch((e) => console.error('unlock', e));
    }
  },

  // Архив удалённых при чистке данных: ничего не пропадает безвозвратно
  async archive(chatId, payload) {
    await client().rpush(`finance:archive:${chatId}`, JSON.stringify(payload));
  },

  // Беседы, где пользователь писал боту: по ним мини-приложение предлагает выбрать бюджет
  async addUserChat(userId, chatId) {
    await client().sadd(`finance:user:${userId}`, String(chatId));
  },
  async userChats(userId) {
    const ids = await client().smembers(`finance:user:${userId}`);
    return (ids ?? []).map(Number).filter(Number.isSafeInteger);
  },

  // Чаты, где бот заблокирован/удалён: cron их пропускает, пока там снова не напишут боту
  markInactive: (chatId) => client().sadd('finance:inactive', String(chatId)),
  markActive: (chatId) => client().srem('finance:inactive', String(chatId)),
  async inactiveChats() {
    return new Set(((await client().smembers('finance:inactive')) ?? []).map(Number));
  },

  async listChats() {
    const ids = [];
    let cursor = '0';
    do {
      const [next, keys] = await client().scan(cursor, { match: 'finance:chat:*', count: 100 });
      cursor = String(next);
      ids.push(...keys.map((k) => Number(k.slice('finance:chat:'.length))));
    } while (cursor !== '0');
    return ids;
  },
};
