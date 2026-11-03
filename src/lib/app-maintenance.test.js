import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
const { createAppMaintenance } = createRequire(import.meta.url)('../../electron/app-maintenance.cjs');

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xuzuo-maintenance-'));
  const resources = path.join(root, 'resources'); await fs.mkdir(resources);
  const file = path.join(resources, 'xuzuo-maintenance.exe'), contents = Buffer.from('owned executable fixture'); await fs.writeFile(file, contents);
  const receipt = { format: 1, appId: 'local.xuzuo.studio', files: [{ path: 'resources/xuzuo-maintenance.exe', bytes: contents.length, sha256: createHash('sha256').update(contents).digest('hex') }] };
  await fs.writeFile(path.join(resources, 'xuzuo-install-manifest.json'), JSON.stringify(receipt));
  return { root, file, options: { app: { isPackaged: true }, executablePath: path.join(root, '序作工作台.exe'), appId: receipt.appId } };
}
it('exposes no uninstall operation for development or missing installation receipt', async () => {
  const api = createAppMaintenance({ app: { isPackaged: false }, appId: 'local.xuzuo.studio' });
  expect((await api.status()).available).toBe(false); await expect(api.openUninstall()).rejects.toThrow('开发');
  const f = await fixture(); await fs.unlink(path.join(f.root, 'resources/xuzuo-install-manifest.json'));
  expect((await createAppMaintenance(f.options).status()).available).toBe(false);
});
it('rejects a replaced maintenance binary or foreign app receipt', async () => {
  const f = await fixture(); expect((await createAppMaintenance(f.options).status()).available).toBe(true);
  expect((await createAppMaintenance({ ...f.options, appId: 'foreign' }).status()).available).toBe(false);
  await fs.writeFile(f.file, 'replaced'); expect((await createAppMaintenance(f.options).status()).available).toBe(false);
});
it('opens only the verified maintenance path and passes the exact installed root without a shell', async () => {
  const f = await fixture(); let called;
  const api = createAppMaintenance({ ...f.options, spawnImpl: (...args) => { called = args; const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit('spawn')); return child; } });
  expect(await api.openUninstall()).toEqual({ opened: true });
  expect(called).toEqual([f.file, ['--uninstall', '--root', f.root], { detached: true, windowsHide: true, stdio: 'ignore' }]);
});
