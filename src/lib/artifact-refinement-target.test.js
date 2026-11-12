import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
const { assertArtifactRefinementTarget } = createRequire(import.meta.url)('../../electron/artifact-refinement-target.cjs');
const original = Buffer.from('selected immutable content');
const request = () => ({ project: { id: 'project' }, workflow: { sourceArtifactTarget: { id: 'artifact', sha256: createHash('sha256').update(original).digest('hex') } } });
it('checks immutable source bytes and ownership before a paid operation', async () => {
  const read = vi.fn(async () => ({ projectId: 'project', buffer: original }));
  await assertArtifactRefinementTarget(request(), { read });
  read.mockResolvedValue({ projectId: 'project', buffer: Buffer.from('external overwrite') });
  await expect(assertArtifactRefinementTarget(request(), { read })).rejects.toMatchObject({ requestStarted: false, publicMessage: expect.stringContaining('已变化') });
  read.mockResolvedValue({ projectId: 'other-project', buffer: original });
  await expect(assertArtifactRefinementTarget(request(), { read })).rejects.toMatchObject({ requestStarted: false });
});
it('does not read unrelated files on ordinary workflows and rejects a missing selected source', async () => {
  const read = vi.fn(async () => { throw Error('unavailable'); });
  await assertArtifactRefinementTarget({ workflow: {} }, { read }); expect(read).not.toHaveBeenCalled();
  await expect(assertArtifactRefinementTarget(request(), { read })).rejects.toMatchObject({ requestStarted: false });
});
