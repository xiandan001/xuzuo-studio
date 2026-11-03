import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createArtifactStore } = require('../../electron/artifact-store.cjs');
it('实际产物同长度被外部修改也不能冒充原始内容，旧登记原字节保留', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-artifact-integrity-'));
  const store = createArtifactStore({ directory });
  const file = await store.write({ name: '实际文稿.txt', mimeType: 'text/plain', text: 'ABCD' });
  const before = await fs.readFile(path.join(directory, 'manifest-v1.json'));
  await fs.writeFile(file.path, 'ABXD');
  await expect(store.read(file.id)).rejects.toThrow('应用外改变');
  expect(await fs.readFile(path.join(directory, 'manifest-v1.json'))).toEqual(before);
  expect(await fs.readFile(file.path, 'utf8')).toBe('ABXD');
});
