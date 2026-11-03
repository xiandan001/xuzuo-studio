import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createRunHistoryStore } = require('../../electron/run-history-store.cjs');

export async function readLiveHistory(directory: string) {
  return createRunHistoryStore({ directory, fileSystem: fs }).load();
}
export async function writeLiveHistory(directory: string, value: { records: unknown[]; revision?: number }) {
  const store = createRunHistoryStore({ directory, fileSystem: fs });
  await store.load();
  return store.save(value.records, value.revision || 0);
}
