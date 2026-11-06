// Хранилище данных чата в Upstash Redis (Vercel Marketplace -> Upstash Redis).
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

export const store = {
  load: (chatId) => client().get(key(chatId)),
  save: (chatId, data) => client().set(key(chatId), data),
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
