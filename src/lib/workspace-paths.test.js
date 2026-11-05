import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { atomicJson } = require('../../electron/workspace-paths.cjs');
const ownedRoot = path.resolve('work'), active = [];
afterEach(async () => { for (const directory of active.splice(0)) { if (path.dirname(directory) !== ownedRoot) throw Error('Non-owned cleanup'); await fs.rm(directory, { recursive: true, force: true }); } });
async function fixture() {
  const directory = await fs.mkdtemp(path.join(ownedRoot, 'atomic-json-retry-')); active.push(directory);
  const filename = path.join(directory, 'automation-center-v1.json'), original = '{"version":1,"previous":"retain-original"}\n'; await fs.writeFile(filename, original, 'utf8');
  return { directory, filename, original, next: { version: 1, current: 'complete-next-state' } };
}
describe('Windows atomic JSON transient sharing errors', () => {
  it.skipIf(process.platform !== 'win32').each(['EPERM', 'EBUSY'])('%s retries the same real temp asynchronously, preserving the original until successful replacement', async code => {
    const f = await fixture(), temporaryNames = [], removed = []; let calls = 0, yielded = false;
    const writeFile = vi.fn(fs.writeFile), fileSystem = { ...fs, writeFile, rename: async (from, to) => {
      temporaryNames.push(from); calls++; expect(to).toBe(f.filename); expect(await fs.readFile(f.filename, 'utf8')).toBe(f.original); expect(JSON.parse(await fs.readFile(from, 'utf8'))).toEqual(f.next);
      if (calls === 1) setTimeout(() => { yielded = true; }, 0); else expect(yielded).toBe(true);
      if (calls <= 2) throw Object.assign(Error('owned sharing lock'), { code });
      return fs.rename(from, to);
    }, unlink: async filename => { removed.push(filename); return fs.unlink(filename); } };
    await atomicJson(fileSystem, f.filename, f.next);
    expect(calls).toBe(3); expect(new Set(temporaryNames).size).toBe(1); expect(writeFile).toHaveBeenCalledTimes(1); expect(removed).toEqual([]); expect(JSON.parse(await fs.readFile(f.filename, 'utf8'))).toEqual(f.next); expect(await fs.readdir(f.directory)).toEqual(['automation-center-v1.json']);
  });
  it.skipIf(process.platform !== 'win32')('a permanent lock stops after4 attempts and removes only its own temp, retaining original bytes', async () => {
    const f = await fixture(), error = Object.assign(Error('owned persistent lock'), { code: 'EPERM' }), attempts = [], removed = [];
    const fileSystem = { ...fs, rename: async (from, to) => { attempts.push({ from, to }); throw error; }, unlink: async filename => { removed.push(filename); return fs.unlink(filename); } };
    await expect(atomicJson(fileSystem, f.filename, f.next)).rejects.toBe(error);
    expect(attempts).toHaveLength(4); expect(new Set(attempts.map(item => item.from)).size).toBe(1); expect(removed).toEqual([attempts[0].from]); expect(removed).not.toContain(f.filename); expect(await fs.readFile(f.filename, 'utf8')).toBe(f.original); expect(await fs.readdir(f.directory)).toEqual(['automation-center-v1.json']);
  });
  it.each(['EIO', 'EACCES', 'ENOENT'])('%s remains a single attempt with unchanged cleanup and original data', async code => {
    const f = await fixture(), rename = vi.fn(async () => { throw Object.assign(Error('owned non-retry error'), { code }); });
    await expect(atomicJson({ ...fs, rename }, f.filename, f.next)).rejects.toMatchObject({ code });
    expect(rename).toHaveBeenCalledTimes(1); expect(await fs.readFile(f.filename, 'utf8')).toBe(f.original); expect(await fs.readdir(f.directory)).toEqual(['automation-center-v1.json']);
  });
  it('non-Windows EPERM remains a single attempt', async () => {
    const f = await fixture(), descriptor = Object.getOwnPropertyDescriptor(process, 'platform'), rename = vi.fn(async () => { throw Object.assign(Error('owned other-platform error'), { code: 'EPERM' }); });
    try { Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' }); await expect(atomicJson({ ...fs, rename }, f.filename, f.next)).rejects.toMatchObject({ code: 'EPERM' }); }
    finally { Object.defineProperty(process, 'platform', descriptor); }
    expect(rename).toHaveBeenCalledTimes(1); expect(await fs.readFile(f.filename, 'utf8')).toBe(f.original); expect(await fs.readdir(f.directory)).toEqual(['automation-center-v1.json']);
  });
});
