// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BusinessProductionPanel } from './BusinessProductionPanel';
import { BusinessSamplePreview } from './BusinessSamplePreview';
import type { BusinessOrder } from '../../business-types';
import type { ArtifactMetadata, ArtifactPreview } from '../../live-types';
import type { PageProps } from '../../types';
import type { WorkflowRunner } from '../../configuration-types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [], imageA = 'data:image/png;base64,AAAA', imageB = 'data:image/gif;base64,BBBB';
const deferred = () => { let resolve!: (value: ArtifactPreview) => void; const promise = new Promise<ArtifactPreview>(done => { resolve = done; }); return { promise, resolve }; };
const file = (id: string): ArtifactMetadata => ({ id, name: id + '.png', projectId: 'project', kind: 'image', mimeType: 'image/png', path: '', bytes: 100, createdAt: '2026-11-08T00:00:00Z' });
const runner = () => ({ previewArtifact: vi.fn(async () => ({ mimeType: 'image/png', dataUrl: imageA })), thumbnailArtifact: vi.fn(async () => ({ mimeType: 'image/png', dataUrl: imageA })), saveArtifact: vi.fn(async () => ({ saved: true })) }) as unknown as WorkflowRunner;
const order = (): BusinessOrder => ({ id: 'order', name: '样稿制作', recipe: 'merchant', sourceProjectId: 'project', brief: '', productIds: [], projectIds: ['project'], runIds: ['own'], outputIds: ['sample'], includedRevisions: 1, status: 'sample-review', factsRevision: 1, facts: {}, outputKinds: ['image'], imageCount: 1, sizes: [], tasks: [{ id: 'compose', label: '制作样稿', kind: 'image', operation: 'compose', status: 'complete', artifactIds: ['sample'], factsRevision: 1 }], bindings: {}, createdAt: '', updatedAt: '' });
async function mount(content: React.ReactNode) { const host = document.createElement('div'), root = createRoot(host); document.body.append(host); roots.push(root); await act(async () => root.render(content)); return { host, show: (next: React.ReactNode) => act(async () => root.render(next)) }; }
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); });

describe('business real spend and original sample inspection', () => {
  it('shows only unique real entries of this order, never other shared-project runs or simulations', async () => {
    const real = { id: 'fee', billingMode: 'live', workflowRunId: 'own', costState: 'manual', costCents: 17 }, ledger = [real, real, { ...real, id: 'other', workflowRunId: 'other', costCents: 999 }, { ...real, id: 'simulation', billingMode: 'simulation', costCents: 888 }];
    const props = { ledger, workflowRunner: runner() } as unknown as PageProps, original = JSON.stringify(ledger), { host } = await mount(<BusinessProductionPanel props={props} order={order()} files={[]} busy={false} onAction={() => {}} />);
    expect(host.querySelector('[aria-label="本单累计真实API花费"]')?.textContent).toContain('¥0.17'); expect(host.textContent).not.toContain('确认费用'); expect(JSON.stringify(ledger)).toBe(original);
  });
  it('opens the actual custom preview, closes it and ignores a read arriving after closure', async () => {
    const read = deferred(), r = runner(); vi.mocked(r.previewArtifact).mockImplementationOnce(() => read.promise).mockResolvedValue({ mimeType: 'image/gif', dataUrl: imageB });
    const props = { ledger: [], workflowRunner: r } as unknown as PageProps, { host } = await mount(<BusinessProductionPanel props={props} order={order()} files={[file('sample')]} busy={false} onAction={() => {}} />);
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '查看原尺寸')!.click());
    expect(document.body.querySelector('[aria-label="样稿原尺寸预览"]')).not.toBeNull(); expect(r.previewArtifact).toHaveBeenCalledWith('sample');
    await act(async () => document.body.querySelector<HTMLButtonElement>('[aria-label="关闭样稿预览"]')!.click());
    await act(async () => read.resolve({ mimeType: 'image/png', dataUrl: imageA })); expect(document.body.querySelector('[aria-label="样稿原尺寸预览"]')).toBeNull();
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '查看原尺寸')!.click());
    expect(document.body.querySelector<HTMLImageElement>('[aria-label="样稿原尺寸预览"] img')?.src).toBe(imageB);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(document.body.querySelector('[aria-label="样稿原尺寸预览"]')).toBeNull();
  });
  it('binds content to the selected artifact and rejects a late result from the previous artifact', async () => {
    const old = deferred(), next = deferred(), r = runner(); vi.mocked(r.previewArtifact).mockImplementationOnce(() => old.promise).mockImplementationOnce(() => next.promise);
    const ui = await mount(<BusinessSamplePreview file={file('a')} runner={r} onClose={() => {}} />);
    await ui.show(<BusinessSamplePreview file={file('b')} runner={r} onClose={() => {}} />); expect(document.body.querySelector('[aria-label="样稿原尺寸预览"] img')).toBeNull();
    await act(async () => next.resolve({ mimeType: 'image/gif', dataUrl: imageB })); await act(async () => old.resolve({ mimeType: 'image/png', dataUrl: imageA }));
    const img = document.body.querySelector<HTMLImageElement>('[aria-label="样稿原尺寸预览"] img'); expect(img?.src).toBe(imageB); expect(img?.alt).toBe('b.png');
    vi.mocked(r.previewArtifact).mockResolvedValueOnce({ mimeType: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,CCCC' });
    await ui.show(<BusinessSamplePreview file={file('svg')} runner={r} onClose={() => {}} />); expect(document.body.querySelector<HTMLImageElement>('[aria-label="样稿原尺寸预览"] img')?.src).toBe('data:image/svg+xml;base64,CCCC');
  });
  it('clears prior read errors on another file and surfaces synchronous or empty preview failures', async () => {
    const r = runner(); vi.mocked(r.previewArtifact).mockImplementationOnce(() => { throw Error('原文件不可读取'); });
    const ui = await mount(<BusinessSamplePreview file={file('bad')} runner={r} onClose={() => {}} />); expect(document.body.textContent).toContain('原文件不可读取');
    await ui.show(<BusinessSamplePreview file={file('good')} runner={r} onClose={() => {}} />); expect(document.body.textContent).not.toContain('原文件不可读取'); expect(document.body.querySelector('[aria-label="样稿原尺寸预览"] img')).not.toBeNull();
    vi.mocked(r.previewArtifact).mockResolvedValueOnce({ mimeType: 'image/png' }); await ui.show(<BusinessSamplePreview file={file('empty')} runner={r} onClose={() => {}} />); expect(document.body.textContent).toContain('未返回可显示的图片');
  });
});
