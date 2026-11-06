// API мини-приложения Telegram: единая точка, все запросы подписаны initData.
import { handleApp } from '../lib/appserver.js';
import { store } from '../lib/store.js';
import { tg } from '../lib/tg.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const { status, json } = await handleApp(req.body, { store, tg });
  return res.status(status).json(json);
}
