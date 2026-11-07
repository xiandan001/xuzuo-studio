import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BEAD_WORKSPACE_NOTICE } from './bead-intent';
import { naturalAutomationRequestIssues } from './natural-automation-plan';
const require = createRequire(import.meta.url), { createAutomationPlanning } = require('../../electron/automation-planning.cjs'), owned = [];
const input = { id: 'planning-request', workspaceId: 'workspace', projectId: 'project', modelConfigId: 'model', credentialId: 'key', input: '做64×64拼豆图纸，要色号采购' };
async function fixture() {
  const temporary = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(temporary, 'xuzuo-bead-plan-guard-')), runs = new Map();
  const start = vi.fn(async request => { const run = { id: 'fake-planner-run', purpose: request.purpose, dispatchKey: request.dispatchKey, projectId: request.project.id, workspaceId: request.project.workspaceId, status: 'running', snapshot: request.workflow, attempts: [] }; runs.set(run.id, run); return run; });
  const context = vi.fn(async () => ({ project: { id: 'project', workspaceId: 'workspace', name: '规划测试项目', kind: 'image', costCents: 0 }, workflows: [], models: [{ id: 'model', enabled: true, connectionId: 'connection', modelId: 'fixture', capabilities: ['text'] }], connections: [{ id: 'connection', enabled: true, providerId: 'custom', protocol: 'openai-chat', baseUrl: 'https://fixture.invalid/v1' }] }));
  const credentials = { list: vi.fn(async () => [{ id: 'key', enabled: true, connectionId: 'connection' }]) }, requestIssues = vi.fn(naturalAutomationRequestIssues);
  const service = createAutomationPlanning({ directory, liveEngine: { start, snapshot: async () => ({ runs: [...runs.values()] }), runDetail: async id => runs.get(id), control: async () => {} }, automationCenter: { getPlanningContext: context }, credentials, start, requestIssues });
  const f = { directory, temporary, service, start, context, credentials, requestIssues }; owned.push(f); return f;
}
afterEach(async () => { for (const f of owned.splice(0)) { await f.service.shutdown(); expect(path.dirname(await fs.realpath(f.directory))).toBe(f.temporary); expect(path.basename(f.directory)).toMatch(/^xuzuo-bead-plan-guard-/); expect((await fs.lstat(f.directory)).isSymbolicLink()).toBe(false); await fs.rm(f.directory, { recursive: true, force: true }); } });
describe('拼豆实际图纸不进入付费规划入口', () => {
  it('rejects technical pattern requests before creating a planning record, accessing keys or calling start', async () => {
    const f = await fixture(); expect(require('../../electron/natural-automation-plan.runtime.cjs').BEAD_WORKSPACE_NOTICE).toBe(BEAD_WORKSPACE_NOTICE);
    await expect(f.service.start(input)).rejects.toThrow(BEAD_WORKSPACE_NOTICE); expect(f.requestIssues).toHaveBeenCalledExactlyOnceWith(input.input); expect(f.start).not.toHaveBeenCalled(); expect(f.context).not.toHaveBeenCalled(); expect(f.credentials.list).not.toHaveBeenCalled(); expect(await f.service.list('workspace')).toEqual([]); await expect(fs.access(path.join(f.directory, 'automation-planning-v1.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('keeps bead-shop marketing posters on the ordinary planning route', async () => {
    const f = await fixture(), result = await f.service.start({ ...input, input: '制作一张拼豆门店营销海报' }); expect(result.status).toBe('running'); expect(f.start).toHaveBeenCalledTimes(1); expect(f.start.mock.calls[0][0]).toMatchObject({ purpose: 'automation-plan' }); expect(f.requestIssues.mock.results[0].value).not.toContain(BEAD_WORKSPACE_NOTICE);
  });
  it('validates request identifiers before intent dispatch and leaves existing non-bead notices as warnings', async () => {
    const f = await fixture(); await expect(f.service.start({ ...input, id: '../invalid-request' })).rejects.toThrow('有效'); expect(f.requestIssues).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled();
    f.requestIssues.mockReturnValue(['既有其他规划提示']); await expect(f.service.start({ ...input, input: '制作产品宣传图' })).resolves.toMatchObject({ status: 'running' }); expect(f.start).toHaveBeenCalledTimes(1);
  });
});
