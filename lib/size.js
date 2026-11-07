// Размер бюджета чата в Redis. Весь бюджет — один JSON-ключ, а запрос к Upstash по REST ограничен ~1 МБ,
// поэтому следим, чтобы он не разрастался (траты, импорт, журнал).
export const SIZE_LIMIT = 1_000_000;
export const SIZE_WARN = 600_000;

const bytes = (v) => Buffer.byteLength(JSON.stringify(v ?? null));

export function sizeReport(data) {
  const parts = {};
  for (const [k, v] of Object.entries(data ?? {})) parts[k] = { count: Array.isArray(v) ? v.length : undefined, bytes: bytes(v) };
  const total = bytes(data);
  const top = Object.entries(parts).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 3).map(([k, p]) => `${k}: ${Math.round(p.bytes / 1024)} КБ${p.count != null ? ` (${p.count})` : ''}`);
  return { bytes: total, percent: Math.round((total / SIZE_LIMIT) * 100), warn: total >= SIZE_WARN, parts, top };
}
