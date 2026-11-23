import { round2 } from './budget.js';
import { logEvent } from './prompt.js';
import { money } from './format.js';

// Подтверждённые события плана. Разовые операции баланса уже представлены в topups.
export function confirmedHistory(data) {
  const items = new Map(data.items.filter((item) => !item.spread).map((item) => [item.id, item]));
  for (const topup of data.topups) items.delete(topup.itemId);
  const rows = [];
  for (const [key, mark] of Object.entries(data.done)) {
    const item = items.get(key.split(':')[0]);
    if (!item || mark.skipped || !Number.isFinite(mark.ts)) continue;
    const amount = mark.applied ? Math.abs(mark.applied.delta) : (mark.amount ?? item.amount);
    rows.push({ key, ts: mark.ts, name: item.name, by: item.by, amount,
      kind: item.type === 'income' ? 'topup' : 'spend', fromReserve: mark.applied?.to === 'reserve',
      editable: Object.hasOwn(mark, 'applied') });
  }
  return rows;
}

export function editConfirmedAmount(data, today, row, amount) {
  const mark = data.done[row.key];
  if (mark.applied) {
    const { to, delta } = mark.applied;
    const nextDelta = row.kind === 'topup' ? amount : -amount;
    const account = data[to];
    if (account && (to === 'reserve' || account.ts <= mark.ts)) {
      account.amount = round2(account.amount + nextDelta - delta);
    }
    mark.applied.delta = nextDelta;
  }
  mark.amount = amount;
  logEvent(data, today.ts, `изменена фактическая сумма «${row.name}»: ${money(amount)}`);
}

export function editTopup(data, today, rec, amount, name) {
  const signed = Math.sign(rec.amount) * amount;
  if (rec.mode === 'balance' && data.balance && data.balance.ts <= rec.ts) {
    data.balance.amount = round2(data.balance.amount + signed - rec.amount);
  }
  const item = data.items.find((it) => it.id === rec.itemId);
  if (item) Object.assign(item, { amount, name });
  Object.assign(rec, { name, amount: signed });
  logEvent(data, today.ts, `изменена операция «${name}»: ${money(signed)}`);
}
