const serialized = new WeakMap<object, string>();

// Editor snapshots are immutable plain records. Their shared children can reuse
// JSON text without keeping discarded history alive.
function serialize(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  const cached = serialized.get(value); if (cached !== undefined) return cached;
  let result: string;
  if ('toJSON' in value && typeof value.toJSON === 'function') result = JSON.stringify(value);
  else if (Array.isArray(value)) result = `[${Array.from(value, item => serialize(item) ?? 'null').join(',')}]`;
  else result = `{${Object.entries(value).flatMap(([key, item]) => { const text = serialize(item); return text === undefined ? [] : [`${JSON.stringify(key)}:${text}`]; }).join(',')}}`;
  serialized.set(value, result); return result;
}
export function serializeImmutableSnapshot(value: unknown): string {
  const result = serialize(value);
  if (result === undefined) throw new Error('编辑快照需要可保存的内容。');
  return result;
}
