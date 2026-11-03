import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const { createDocumentArtifactPreview } = createRequire(import.meta.url)('../../electron/artifact-document-preview.cjs');
const artifact = { id: 'office', projectId: 'project', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const attempt = (stepId, summary, files = []) => ({ stepId, summary, status: 'complete', artifacts: files });
const run = { mode: 'live', projectId: 'project', snapshot: { steps: [{ id: 'text', kind: 'text', enabled: true }, { id: 'export', kind: 'export', enabled: true, inputSource: 'previous' }] }, attempts: [attempt('text', '{"title":"原结果","sections":[]}'), attempt('export', '导出完成', [artifact]), attempt('text', '后来重试的新结果')] };
function preview(runs = [run], source = { revision: 2, document: { kind: 'word', title: '历史版' } }) {
  const loadVersion = vi.fn(async () => source);
  return { read: createDocumentArtifactPreview({ liveEngine: { snapshot: async () => ({ runs }) }, editorStore: { loadVersion }, spreadsheetStore: { loadVersion } }), loadVersion };
}
describe('Office产物使用精确生成来源预览', () => {
  it('只读导出前的成功正文，之后重试的新稿不能冒充旧文件', async () => {
    expect((await preview().read(artifact)).text).toContain('原结果');
    expect((await preview().read(artifact)).text).not.toContain('后来重试');
  });
  it('编辑导出读取绑定历史版本，不读取或覆盖当前最新稿', async () => {
    const { read, loadVersion } = preview([{ ...run, sourceRevision: 2 }]);
    expect(await read(artifact)).toMatchObject({ documentSource: true, sourceRevision: 2 });
    expect(loadVersion).toHaveBeenCalledTimes(1); expect(loadVersion).toHaveBeenCalledWith({ projectId: 'project', revision: 2 });
  });
  it('不同项目及外部导入文件不借用当前项目源', async () => {
    expect(await preview([{ ...run, projectId: 'other' }]).read(artifact)).toBeUndefined();
    expect(await preview().read({ ...artifact, id: 'external-import' })).toBeUndefined();
  });
  it('显式导出来源和project输入严格遵循实际导出选择', async () => {
    const explicit = structuredClone(run); explicit.snapshot.steps[1].contentSourceStepId = 'text';
    expect((await preview([explicit]).read(artifact)).text).toContain('原结果');
    explicit.snapshot.steps[1].contentSourceStepId = undefined; explicit.snapshot.steps[1].inputSource = 'project'; explicit.attempts[1].input = '导出当时的项目需求';
    expect((await preview([explicit]).read(artifact)).text).toBe('导出当时的项目需求');
  });
});
