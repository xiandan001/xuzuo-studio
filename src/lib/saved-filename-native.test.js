import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createSavedFilename, timestampedDefaultPath, stripSavedTimestamp } = require('../../electron/saved-filename.cjs');
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
const date = new Date(2026, 10, 3, 9, 5, 7, 12);
const stamp = '2026-11-03_09-05-07-012';

describe('new saved filename timestamps', () => {
  it('uses local time, retains Chinese/extensions and distinguishes saves in the same millisecond', () => {
    const name = createSavedFilename(() => date);
    expect(name('客户报价.xlsx')).toBe(`客户报价_${stamp}.xlsx`);
    expect(name('客户报价.xlsx')).toBe(`客户报价_${stamp}-1.xlsx`);
    expect(name(`客户报价_2025-01-01_00-00-00-000-7.xlsx`)).toBe(`客户报价_${stamp}-2.xlsx`);
    expect(stripSavedTimestamp(name('检查报告.json'))).toBe('检查报告.json');
    expect(stripSavedTimestamp('2026-10报告.json')).toBe('2026-10报告.json');
  });
  it('refreshes only the basename and makes generated names safe on Windows', () => {
    const name = createSavedFilename(() => date);
    expect(name('../../中文:方案?.docx')).toBe(`中文_方案__${stamp}.docx`);
    expect(name('CON.txt')).toBe(`文件-CON_${stamp}-1.txt`);
    const long = name('客户😀'.repeat(100) + '.png');
    expect(long.length).toBeLessThanOrEqual(255);
    expect(long).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    const selected = timestampedDefaultPath('D:\\客户_2020-01-01_00-00-00-000\\中文方案_2025-01-01_00-00-00-000.docx');
    expect(path.win32.dirname(selected)).toBe('D:\\客户_2020-01-01_00-00-00-000');
    expect(path.win32.basename(selected)).toMatch(/^中文方案_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}(?:-\d+)?\.docx$/);
    expect((selected.match(/2025-01-01/g) || [])).toHaveLength(0);
  });
  it('stamps newly generated artifacts while preserving imported names and already registered metadata', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-saved-name-'));
    try {
      const store = createArtifactStore({ directory: path.join(directory, 'managed') });
      const first = await store.write({ name: '客户交付.txt', mimeType: 'text/plain', text: '第一份' });
      const second = await store.write({ name: first.name, mimeType: 'text/plain', text: '第二份' });
      for (const item of [first, second]) expect(item.name).toMatch(/^客户交付_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}(?:-\d+)?\.txt$/);
      expect(first.name).not.toBe(second.name); expect(first.path).not.toBe(second.path);
      expect((await store.read(first.id)).buffer.toString()).toBe('第一份');
      expect((await store.read(second.id)).buffer.toString()).toBe('第二份');
      const source = path.join(directory, '原始参考_2020-01-01_00-00-00-000.txt');
      await fs.writeFile(source, '原始资料');
      const [imported] = await store.importPaths([source]);
      expect(imported.name).toBe(path.basename(source)); expect(await fs.readFile(source, 'utf8')).toBe('原始资料');
      const legacy = await store.write({ name: '旧登记名.txt', mimeType: 'text/plain', text: '已有文件', preserveOriginalName: true });
      const reopened = createArtifactStore({ directory: path.join(directory, 'managed') });
      expect((await reopened.read(legacy.id)).name).toBe('旧登记名.txt');
      expect((await reopened.read(legacy.id)).buffer.toString()).toBe('已有文件');
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
});
