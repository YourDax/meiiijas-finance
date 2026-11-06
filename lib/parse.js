// Разбор сумм и команд из сообщений Telegram.

export function parseAmount(token) {
  const m = /^(\d+(?:[.,]\d+)?)(к|k|тыс)?$/i.exec(String(token ?? '').trim());
  if (!m) return null;
  let v = parseFloat(m[1].replace(',', '.'));
  if (m[2]) v *= 1000;
  v = Math.round(v * 100) / 100;
  return v > 0 ? v : null;
}

export function parseDay(token) {
  if (!/^\d{1,2}$/.test(String(token ?? ''))) return null;
  const d = Number(token);
  return d >= 1 && d <= 31 ? d : null;
}

// "/plan@my_bot arg1 arg2" -> { cmd: 'plan', args: ['arg1','arg2'] }
export function parseCommand(line) {
  const m = /^\/([a-zA-Z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(line.trim());
  if (!m) return null;
  const rest = (m[2] ?? '').trim();
  return { cmd: m[1].toLowerCase(), args: rest ? rest.split(/\s+/) : [] };
}
