// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommerceImageDocument, CommerceImageRead, CommerceImagesBridge } from '../commerce-image-types';
import type { PageProps } from '../types';
import { guardedEditorSessions } from '../lib/editor-session-guard';
import { CommerceLayerEditor } from './CommerceLayerEditor';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', class { callback: ResizeObserverCallback; constructor(callback: ResizeObserverCallback) { this.callback = callback; } observe() { this.callback([{ contentRect: { width: 600 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } disconnect() {} unobserve() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {} }) as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(image);
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
});
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); delete window.desktop; });
function doc(source = 'original', documentId = 'working'): CommerceImageDocument {
  return { type: 'xuzuo-commerce-image', version: 1, id: documentId, projectId: 'project', sourceArtifactId: source, sourceSha256: 'a'.repeat(64), revision: 0, title: '商品海报', width: 256, height: 256, background: '#FFFFFF', updatedAt: '', layers: [{ id: 'product', type: 'image', role: 'product', artifactId: source, name: '商品主体', x: 0, y: 0, width: 256, height: 256, opacity: 1, visible: true, locked: false }, { id: 'price', type: 'text', name: '售价', text: '原售价129元', x: 10, y: 200, width: 230, height: 50, fontSize: 20, fontFamily: 'Microsoft YaHei', fontWeight: 'bold', align: 'left', color: '#17212B', opacity: 1, visible: true, locked: false }] };
}
function read(document = doc()): CommerceImageRead { return { projectId: 'project', sourceArtifactId: document.sourceArtifactId, documentId: document.id, document, source: { id: document.sourceArtifactId, name: '真实商品.png', width: 256, height: 256, sha256: document.sourceSha256, previewDataUrl: image }, previews: { [document.sourceArtifactId]: image } }; }
async function mounted(options: { source?: string; bridge?: Partial<CommerceImagesBridge> } = {}) {
  let current = doc(); const onGenerate = vi.fn(), onExport = vi.fn();
  const bridge: CommerceImagesBridge = { read: vi.fn(async () => read(current)), save: vi.fn(async input => { current = { ...input.document, revision: input.expectedRevision + 1 }; return current; }), render: vi.fn(async () => ({ documentId: current.id, sourceRevision: current.revision, runId: 'export', artifacts: [{ id: 'result', projectId: 'project', name: '真实成品.png', mimeType: 'image/png', kind: 'image' as const, bytes: 100, path: 'managed/result', createdAt: '' }] })), applyAlpha: vi.fn(async () => ({ artifact: { id: 'product-matte', name: '主体.png', projectId: 'project', mimeType: 'image/png', kind: 'image' as const, bytes: 10, path: '', createdAt: '' }, width: 256, height: 256, sourceSha256: 'a'.repeat(64) })), protect: vi.fn(), mask: vi.fn(async () => ({ id: 'mask', name: '蒙版.png', projectId: 'project', mimeType: 'image/png', kind: 'image' as const, bytes: 10, path: '', createdAt: '' })), cancel: vi.fn(async () => {}), history: vi.fn(async () => []), exportRecovery: vi.fn(async () => ({ saved: true })), ...options.bridge };
  Object.defineProperty(window, 'desktop', { configurable: true, value: { commerceImages: bridge } });
  const ledger = Object.freeze([Object.freeze({ id: 'paid', projectId: 'project', projectName: '商品', billingMode: 'live', costState: 'calculated', costCents: 128, action: '初次生成', model: '已有调用', time: '', status: 'complete' })]);
  const props = { workspaceId: 'workspace', projects: [{ id: 'project', name: '商品海报', workspaceId: 'workspace', kind: 'image', status: 'draft' }], ledger, onGenerate, onUpdateProject: vi.fn(), notify: vi.fn(), workflowRunner: { runs: [], listProjectArtifacts: vi.fn(async () => []), thumbnailArtifact: vi.fn(async () => ({ mimeType: 'image/png', dataUrl: image })), previewArtifact: vi.fn(async () => ({ mimeType: 'image/png', dataUrl: image })), importFiles: vi.fn(async () => []), saveArtifact: vi.fn(async () => ({ saved: true })) } } as unknown as PageProps;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); roots.push(root);
  const render = async (source = options.source || 'final-png') => act(async () => root.render(<CommerceLayerEditor props={props} projectId="project" sourceArtifactId={source} onExport={onExport} />)); await render();
  return { host, root, bridge, props, onGenerate, onExport, ledger, current: () => current, render };
}
function button(host: HTMLElement, name: string) { const value = [...host.querySelectorAll<HTMLButtonElement>('button')].find(element => element.getAttribute('aria-label') === name || element.textContent?.trim() === name); if (!value) throw Error(`Button not found: ${name}`); return value; }
async function input(host: HTMLElement, name: string, value: string) {
  const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${name}"]`)!; if (!element) throw Error('Field missing: ' + name);
  await act(async () => { Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}
describe('商品图层编辑与零额外API操作', () => {
  it('成品回层后改价保存导出，使用原图scope且不重新调用模型', async () => {
    const ui = await mounted(); expect(ui.host.querySelector<HTMLTextAreaElement>('[aria-label="准确文字内容"]')?.value).toBe('原售价129元');
    await input(ui.host, '准确文字内容', '准确售价99元'); await act(async () => button(ui.host, '导出成品').click());
    expect(ui.bridge.save).toHaveBeenCalledWith(expect.objectContaining({ sourceArtifactId: 'original', documentId: 'working', expectedRevision: 0 })); expect(ui.bridge.render).toHaveBeenCalledWith(expect.objectContaining({ sourceArtifactId: 'original', documentId: 'working', expectedRevision: 1 }));
    expect(ui.current().layers.find(layer => layer.id === 'price')).toMatchObject({ type: 'text', text: '准确售价99元' }); expect(ui.onExport).toHaveBeenCalledTimes(1); expect(ui.onGenerate).not.toHaveBeenCalled(); expect(ui.ledger[0].costCents).toBe(128);
  });
  it('位置、锁定、显示和撤销只修改参数，费用保持', async () => {
    const ui = await mounted(); await input(ui.host, '图层横向位置', '77'); await act(async () => button(ui.host, '锁定图层售价').click());
    expect(ui.host.querySelector<HTMLInputElement>('[aria-label="图层横向位置"]')!.disabled).toBe(true); await act(async () => button(ui.host, '撤销图层修改').click());
    expect(ui.host.querySelector<HTMLInputElement>('[aria-label="图层横向位置"]')!.disabled).toBe(false); await act(async () => button(ui.host, '撤销图层修改').click()); expect(ui.host.querySelector<HTMLInputElement>('[aria-label="图层横向位置"]')!.value).toBe('10'); expect(ui.onGenerate).not.toHaveBeenCalled();
  });
  it('新图片已经打开后，旧读取结果不会覆盖它', async () => {
    let resolveFirst!: (value: CommerceImageRead) => void; const first = new Promise<CommerceImageRead>(resolve => { resolveFirst = resolve; });
    const ui = await mounted({ source: 'A', bridge: { read: vi.fn(input => input.sourceArtifactId === 'A' ? first : Promise.resolve(read({ ...doc('B', 'B-doc'), layers: doc('B').layers.map(layer => layer.type === 'text' ? { ...layer, text: 'B真实价格' } : layer) }))) } });
    await ui.render('B'); await act(async () => resolveFirst(read(doc('A', 'A-doc')))); expect(ui.host.querySelector<HTMLTextAreaElement>('[aria-label="准确文字内容"]')?.value).toBe('B真实价格');
  });
  it('保存中继续编辑，不用旧保存回执覆盖新文字', async () => {
    let resolveFirst!: (value: CommerceImageDocument) => void; let savedOnce = false;
    const save = vi.fn((input: Parameters<CommerceImagesBridge['save']>[0]) => { if (!savedOnce) { savedOnce = true; return new Promise<CommerceImageDocument>(resolve => { resolveFirst = resolve; }); } return Promise.resolve({ ...input.document, revision: input.expectedRevision + 1 }); });
    const ui = await mounted({ bridge: { save } }); await input(ui.host, '准确文字内容', '第一段'); await act(async () => button(ui.host, '保存').click()); const snapshot = save.mock.calls[0][0].document;
    await input(ui.host, '准确文字内容', '后续实际售价'); await act(async () => resolveFirst({ ...snapshot, revision: 1 }));
    expect(save).toHaveBeenCalledTimes(2); expect(save.mock.calls[1][0].expectedRevision).toBe(1); expect(ui.host.querySelector<HTMLTextAreaElement>('[aria-label="准确文字内容"]')?.value).toBe('后续实际售价'); expect(guardedEditorSessions().filter(session => session.projectId === 'project')).toHaveLength(0);
  });
  it('未应用主体蒙版受关闭保护，保存会应用选区并保留原费用', async () => {
    const ui = await mounted(); await act(async () => button(ui.host, '手工涂选主体').click());
    const canvas = ui.host.querySelector<HTMLCanvasElement>('[aria-label="主体与保护区蒙版画布"]')!; vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 600, left: 0, top: 0, x: 0, y: 0, right: 600, bottom: 600, toJSON: () => ({}) });
    await act(async () => { canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 200 })); canvas.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 200, clientY: 200 })); });
    await act(async () => button(ui.host, '撤销一笔蒙版').click()); expect(guardedEditorSessions().some(session => session.id === 'commerce-tasks:project')).toBe(false);
    await act(async () => button(ui.host, '重做一笔蒙版').click()); const session = guardedEditorSessions().find(session => session.id === 'commerce-tasks:project'); expect(session).toBeDefined();
    await act(async () => { expect(await session!.save()).toBe(true); }); expect(ui.bridge.mask).toHaveBeenCalledTimes(1); expect(ui.bridge.applyAlpha).toHaveBeenCalledTimes(1); expect(ui.current().layers.find(layer => layer.id === 'product')).toMatchObject({ type: 'image', artifactId: 'product-matte' }); expect(ui.onGenerate).not.toHaveBeenCalled(); expect(ui.ledger[0].costCents).toBe(128);
  });
});
