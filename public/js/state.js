// Состояние приложения, запросы к серверу и действия, меняющие данные.
import { haptic, toast } from './util.js';

export const tgw = window.Telegram?.WebApp;
export const hooks = { render: () => {}, boot: () => {}, load: () => {} };
export const S = { state: null, chatId: null, chats: [], tab: 'home', confirm: null, filter: { month: 'cur', q: '' } };
export const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* без хранилища работаем как обычно */ } },
};

// ---------- запросы ----------
export async function api(action, payload = {}, chatId = S.chatId) {
  const r = await fetch('/api/app', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData: tgw.initData, chatId: chatId ?? undefined, action, payload }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Ошибка ${r.status}`);
  return j;
}

// Действие, меняющее данные: обновляет состояние и экран. Возвращает result или null при ошибке
export async function act(action, payload = {}, { silent = false } = {}) {
  document.body.classList.add('spin');
  try {
    const j = await api(action, payload);
    S.state = j.state;
    hooks.render();
    if (!silent) haptic('success');
    return j.result ?? {};
  } catch (e) {
    toast(e.message, true); haptic('error');
    return null;
  } finally {
    document.body.classList.remove('spin');
  }
}
