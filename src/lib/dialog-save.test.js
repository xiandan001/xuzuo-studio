import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const { authorizeSave, writeDialogFile } = createRequire(import.meta.url)('../../electron/dialog-save.cjs');
it('reports disk and permission failures in plain language without touching the original file', async () => {
  for (const [code, text] of [['ENOSPC', '磁盘空间不足'], ['EACCES', '没有权限'], ['EPERM', '关闭正在使用'], ['EBUSY', '正在使用']]) {
    const result = authorizeSave({ canceled: false, filePath: 'C:/qa/报告.json' }, { assertSaveTarget: async () => undefined });
    const rename = vi.fn(), files = { lstat: async () => ({ isDirectory: () => true, isSymbolicLink: () => false }), writeFile: async () => { throw Object.assign(new Error('native error'), { code }); }, unlink: vi.fn(async () => undefined), rename };
    await expect(writeDialogFile(result, Buffer.from('{}'), files)).rejects.toThrow(text);
    expect(rename).not.toHaveBeenCalled(); expect(files.unlink).toHaveBeenCalledTimes(1);
  }
});
