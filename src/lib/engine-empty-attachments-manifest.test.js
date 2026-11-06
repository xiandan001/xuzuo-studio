import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { fixture, request, until } = require('./production-test-fixtures.cjs');

it('空附件且产物登记表损坏时在模型调用和费用流水之前失败并保留坏字节', async () => {
  const f = await fixture();
  let list;
  try {
    const input = request(); input.input = '独立无附件的业务需求'; input.workflow.steps = [input.workflow.steps[0]];
    await f.workspaceStorage.ensureProject({ projectId: input.project.id, workspaceId: input.project.workspaceId, name: input.project.name });
    const original = await f.artifactStore.write({ projectId: input.project.id, name: '已有原件.txt', mimeType: 'text/plain', text: '必须保留的已有内容' });
    const originalBytes = await fs.readFile(original.path);
    await f.engine.snapshot();
    const manifestFile = path.join(f.directory, 'artifacts-v1', 'manifest-v1.json');
    const damaged = Buffer.from('{"version":1,"artifacts":[broken-owned-manifest');
    await fs.writeFile(manifestFile, damaged);
    list = vi.spyOn(f.artifactStore, 'list');
    expect(input.attachmentIds).toEqual([]);
    expect((await f.engine.preflight(input)).ok).toBe(true);
    const started = await f.engine.start(input);
    const snapshot = await until(() => f.engine.snapshot(), value => value.runs.find(run => run.id === started.id)?.status === 'failed');
    expect(list).toHaveBeenCalledTimes(1); expect(list).toHaveBeenCalledWith([]);
    expect(f.calls).toHaveLength(0); expect(snapshot.ledger).toEqual([]);
    expect(snapshot.runs.find(run => run.id === started.id).attempts[0].status).toBe('failed');
    expect(await fs.readFile(manifestFile)).toEqual(damaged);
    expect(await fs.readFile(original.path)).toEqual(originalBytes);
  } finally {
    list?.mockRestore();
    await f.engine.shutdown(); await f.artifactStore.drain();
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(f.directory));
    if (!relative.startsWith('xuzuo-production-') || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Non-owned production fixture cleanup');
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});
