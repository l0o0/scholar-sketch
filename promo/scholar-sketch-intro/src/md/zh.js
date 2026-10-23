// Real zh-CN UI strings from the product's Fluent file (single-line `key = value` entries only).
import ftl from '@addon/locale/zh-CN/addon.ftl';

const map = new Map();
for (const line of ftl.split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z][\w-]*)\s*=\s*(.+)$/);
  if (m) map.set(m[1], m[2].trim());
}
export function zh(key) {
  const value = map.get(key);
  if (value === undefined) throw new Error(`zh-CN string missing: ${key}`);
  return value;
}
export const zhOr = (key, fallback) => map.get(key) ?? fallback;
