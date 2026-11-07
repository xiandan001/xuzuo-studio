// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BeadAIPreparation } from './BeadAIPreparation';
import { beadUiPage, BEAD_UI_PNG } from '../lib/bead-ui-fixtures';
import { DEFAULT_BEAD_SETTINGS } from '../lib/bead-pattern';
import type { WorkflowRun } from '../configuration-types';
import type { BeadSourcePreview } from '../bead-types';

let root: Root | undefined, container: HTMLDivElement, saved: [string, string][];
beforeEach(() => { saved = Array.from({ length: localStorage.length }, (_, i) => { const key = localStorage.key(i)!; return [key, localStorage.getItem(key)!]; }); localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn(() => { throw Error('AI acceptance must not call real providers'); })); container = document.createElement('div'); document.body.append(container); });
afterEach(async () => { try { if (root) await act(async () => root!.unmount()); expect(fetch).not.toHaveBeenCalled(); } finally { root = undefined; container.remove(); vi.unstubAllGlobals(); localStorage.clear(); for (const [key, value] of saved) localStorage.setItem(key, value); } });
function fixture() {
  const f = beadUiPage(), onUse = vi.fn(), source: BeadSourcePreview = { referenceId: 'reference', name: '原底图.png', sourceSha256: 'a'.repeat(64), originalWidth: 512, originalHeight: 512, dataUrl: BEAD_UI_PNG };
  return { ...f, onUse, source, context: 'document:1' };
}
async function render(f: ReturnType<typeof fixture>) { await act(async () => { root ||= createRoot(container); root.render(<BeadAIPreparation props={f.props} project={f.project} source={f.source} settings={DEFAULT_BEAD_SETTINGS} context={f.context} onUse={f.onUse} />); }); }
async function start() { await act(async () => container.querySelector('summary')!.click()); const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === 'AI 整理底图 · 按用量计费')!; expect(button.disabled).toBe(false); await act(async () => button.click()); }
function resultRun(projectId: string, nonce: string, artifactProject = projectId): WorkflowRun {
  return { id: 'matching-run', projectId, workspaceId: 'bead-workspace', workflowId: `quick-${projectId}-bead-base`, workflowName: 'AI底图', mode: 'live', status: 'complete', stepIndex: 2, input: '', variables: {}, createdAt: '', updatedAt: '', snapshot: { id: 'bead-base', name: 'AI底图', workspaceId: 'bead-workspace', outputKind: 'image', description: '', updatedAt: '', steps: [{ id: 'planner', name: '准备', kind: 'text', inputSource: 'project', prompt: '', enabled: true }, { id: 'producer', name: '底图', kind: 'image-editing', modelConfigId: 'image-model', beadBaseRequestId: nonce, inputSource: 'project', prompt: '', enabled: true }] }, attempts: [{ id: 'produced', stepId: 'producer', stepName: '底图', modelLabel: '图像模型', action: 'AI 精修', status: 'complete', costCents: 1, input: '', prompt: '', summary: '', artifacts: [{ id: 'ai-base', projectId: artifactProject, runId: 'matching-run', kind: 'image', mimeType: 'image/png', name: 'AI整理底图.png', bytes: 100, path: 'managed/ai-base', createdAt: '' }] }] };
}

describe('拼豆可选AI底图的明确调用与nonce关联', () => {
  it('无额外描述也有完整基础要求，只有明确点击才提交一次原图编辑', async () => {
    const f = fixture(), fee = JSON.stringify(f.ledger); await render(f); expect(f.onGenerate).not.toHaveBeenCalled(); await start();
    expect(f.onGenerate).toHaveBeenCalledTimes(1); const input = f.onGenerate.mock.calls[0][4]!;
    expect(input).toMatchObject({ capability: 'image-editing', attachmentIds: ['reference'], imageOutputFormat: 'png', modelConfigId: 'image-model', credentialId: 'account-alias' }); expect(input.beadBaseRequestId).toMatch(/^[a-f0-9-]{36}$/); expect(input.prompt).toContain('不得绘制网格'); expect(input.prompt).toContain('64 列 × 64 行'); expect(JSON.stringify(f.ledger)).toBe(fee);
  });
  it('不使用最新run猜结果，匹配nonce后仍仅待应用，不覆盖手绘', async () => {
    const f = fixture(); await render(f); await start(); const nonce = f.onGenerate.mock.calls[0][4]!.beadBaseRequestId!;
    f.props.workflowRunner.runs = [resultRun(f.project.id, 'unrelated')]; await render(f); expect(container.textContent).not.toContain('采用为下次制图底图');
    f.context = 'document:2'; f.props.workflowRunner.runs = [resultRun(f.project.id, nonce)]; await render(f); expect(container.textContent).toContain('你已继续编辑'); expect(f.onUse).not.toHaveBeenCalled();
    const use = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === '采用为下次制图底图')!; await act(async () => use.click()); expect(f.onUse).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'ai-base', projectId: f.project.id }));
  });
  it('相同nonce但外项目产物不能成为底图，未成功入队也不无限等待', async () => {
    const f = fixture(); await render(f); await start(); const nonce = f.onGenerate.mock.calls[0][4]!.beadBaseRequestId!; f.props.workflowRunner.runs = [resultRun(f.project.id, nonce, 'foreign-project')]; await render(f); expect(container.textContent).not.toContain('采用为下次制图底图'); expect(f.onUse).not.toHaveBeenCalled();
    f.onGenerate.mockReturnValueOnce(undefined); const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === 'AI 整理底图 · 按用量计费')!; await act(async () => button.click()); expect(container.textContent).toContain('任务尚未创建');
  });
  it('跨项目不保留旧结果或账户选择，不会自动采用迟到图片', async () => {
    const f = fixture(); await render(f); await start(); const nonce = f.onGenerate.mock.calls[0][4]!.beadBaseRequestId!; const next = beadUiPage('other-project'); f.props = next.props; f.project = next.project; f.props.workflowRunner.runs = [resultRun('bead-project', nonce)]; await render(f); expect(container.textContent).not.toContain('采用为下次制图底图'); expect(f.onUse).not.toHaveBeenCalled(); expect(container.textContent).not.toContain('停止本次等待');
  });
});
