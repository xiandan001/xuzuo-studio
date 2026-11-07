// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BeadStudio } from './BeadStudio';
import { ImageStudio } from './ImageStudio';
import { beadUiBridge, beadUiDocument, beadUiPage } from '../lib/bead-ui-fixtures';
import { imageDraftKey } from '../lib/image-studio';
import { studioPreferenceKey } from '../lib/studio-layout-state';
import { writeDisclosure } from '../lib/disclosure-state';
import type { BeadDocument } from '../bead-types';

let root: Root | undefined, container: HTMLDivElement, desktop: PropertyDescriptor | undefined, saved: [string, string][];
beforeEach(() => {
  saved = Array.from({ length: localStorage.length }, (_, i) => { const key = localStorage.key(i)!; return [key, localStorage.getItem(key)!]; }); localStorage.clear();
  desktop = Object.getOwnPropertyDescriptor(window, 'desktop'); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Bead UI must not contact a provider'); }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 440, width: 640, height: 440, toJSON: () => ({}) });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ setTransform() {}, clearRect() {}, fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} } as unknown as CanvasRenderingContext2D);
  container = document.createElement('div'); document.body.append(container);
});
afterEach(async () => { try { if (root) await act(async () => root!.unmount()); expect(fetch).not.toHaveBeenCalled(); } finally { root = undefined; container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); if (desktop) Object.defineProperty(window, 'desktop', desktop); else delete window.desktop; localStorage.clear(); for (const [key, value] of saved) localStorage.setItem(key, value); } });
function fixture(document?: BeadDocument) { const f = beadUiPage(document?.projectId), native = beadUiBridge(document), back = vi.fn(); Object.defineProperty(window, 'desktop', { configurable: true, value: { beads: native.bridge } }); return { ...f, ...native, back }; }
async function render(f: ReturnType<typeof fixture>) { await act(async () => { root ||= createRoot(container); root.render(<BeadStudio props={f.props} project={f.project} onBack={f.back} />); }); }
function button(label: string) { const result = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label); expect(result, label).toBeDefined(); return result!; }
async function click(label: string) { await act(async () => button(label).click()); }
async function type(label: string, value: string) { const field = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; expect(field, label).not.toBeNull(); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function canvasKey(key: string) { await act(async () => container.querySelector('canvas')!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))); }

describe('拼豆工作台本地真实DOM主线', () => {
  it('无底图不许本地制图；导入后生成网格，默认流程不调用AI', async () => {
    const f = fixture(), fee = JSON.stringify(f.ledger); await render(f); expect(button('本地生成图纸 · 免费').disabled).toBe(true); expect(f.bridge.generate).not.toHaveBeenCalled();
    await click('导入'); expect(button('本地生成图纸 · 免费').disabled).toBe(false); await click('本地生成图纸 · 免费');
    expect(f.bridge.generate).toHaveBeenCalledTimes(1); expect(container.querySelector('canvas')).not.toBeNull(); expect(container.querySelectorAll('*').length).toBeLessThan(1500); expect(f.onGenerate).not.toHaveBeenCalled(); expect(JSON.stringify(f.ledger)).toBe(fee);
  });
  it('底图丢失仍能手绘和导出，导出先保存最新网格版本', async () => {
    const f = fixture(beadUiDocument()); vi.mocked(f.bridge.source).mockRejectedValueOnce(Error('missing reference')); await render(f);
    expect(container.textContent).toContain('现有图纸仍可编辑和导出'); expect(button('本地重新制图 · 免费').disabled).toBe(true);
    await canvasKey('Enter'); await click('导出整套'); expect(f.bridge.save).toHaveBeenCalledTimes(1); expect(vi.mocked(f.bridge.export).mock.calls[0][0]).toMatchObject({ expectedRevision: 2, format: 'bundle' }); expect(f.current()?.pattern.cells[0]).toBe(1); expect(document.querySelector('[aria-label="拼豆导出与交付"]')).not.toBeNull(); expect(f.onGenerate).not.toHaveBeenCalled();
  });
  it('底板只改分块元数据，可保存导出且不重新采样丢手绘', async () => {
    const f = fixture(beadUiDocument()); await render(f); await type('拼豆底板列数', '50');
    expect(container.querySelector('.bead-pending-banner')).toBeNull(); expect(button('导出整套').disabled).toBe(false); expect(f.bridge.generate).not.toHaveBeenCalled();
    await click('导出整套'); expect(f.current()?.settings.boardColumns).toBe(50); expect(f.current()?.pattern.cells).toEqual(beadUiDocument().pattern.cells); expect(f.onGenerate).not.toHaveBeenCalled();
  });
  it('新采样设置未应用时不静默导出旧尺寸，可一键保留当前图纸', async () => {
    const f = fixture(beadUiDocument()); await render(f); await type('拼豆列数', '96');
    expect(container.querySelector('.bead-pending-banner')?.textContent).toContain('当前画布仍为 8 × 8'); expect(button('导出整套').disabled).toBe(true); expect(f.bridge.generate).not.toHaveBeenCalled();
    await click('继续使用当前图纸'); expect(button('导出整套').disabled).toBe(false); expect(container.querySelector<HTMLInputElement>('[aria-label="拼豆列数"]')!.value).toBe('8');
  });
  it('全空格不是可售卖图纸，但允许保存JSON再继续绘制', async () => {
    const value = beadUiDocument(); value.pattern.cells.fill(0); const f = fixture(value); await render(f); expect(button('导出整套').disabled).toBe(true); expect(container.textContent).toContain('当前全空格');
    await click('拼豆导出格式'); const option = [...document.querySelectorAll<HTMLButtonElement>('[role=option]')].find(item => item.querySelector('strong')?.textContent === '工程 JSON')!; await act(async () => option.click()); await click('导出工程 JSON'); expect(vi.mocked(f.bridge.export).mock.calls[0][0].format).toBe('json'); expect(f.onGenerate).not.toHaveBeenCalled();
  });
  it('单份珠数与采购份数分开，包装可改，底板覆盖不随份数相乘', async () => {
    const f = fixture(beadUiDocument()), fee = JSON.stringify(f.ledger); await render(f); await act(async () => container.querySelector<HTMLButtonElement>('[role=tab][aria-selected=false]')!.click());
    expect(container.textContent).toContain('单份珠子'); await type('拼豆制作份数', '2'); await type('拼豆预留损耗', '0'); await type('拼豆默认每袋粒数', '10');
    const row = container.querySelector('tbody tr')!; expect(row.textContent).toContain('126'); expect(row.querySelector('td:last-child')?.textContent).toBe('13'); expect(container.textContent).toContain('至少 1 片'); expect(container.textContent).toContain('不随份数倍增'); expect(JSON.stringify(f.ledger)).toBe(fee); expect(f.onGenerate).not.toHaveBeenCalled();
  });
  it('素材token只成为下次底图并ack，不替换当前手绘网格或发起AI', async () => {
    const f = fixture(beadUiDocument()), ack = vi.fn(); f.props.assetToApply = { token: 'material-token', workspaceId: f.project.workspaceId, projectId: f.project.id, file: { ...f.reference, id: 'material', name: '材料底图.png' } }; f.props.onAssetApplied = ack; await render(f);
    expect(ack).toHaveBeenCalledExactlyOnceWith('material-token'); expect(container.querySelector('[aria-label="拼豆底图"]')?.textContent).toContain('material.png'); expect(container.querySelector('.bead-pending-banner')).not.toBeNull(); expect(f.current()?.pattern.cells).toEqual(beadUiDocument().pattern.cells); expect(f.bridge.generate).not.toHaveBeenCalled(); expect(f.onGenerate).not.toHaveBeenCalled();
  });
  it('外部素材到达导致暂时禁绘时，已开始的一笔仍提交而不丢失', async () => {
    const f = fixture(beadUiDocument()); await render(f); await act(async () => container.querySelector('canvas')!.dispatchEvent(new MouseEvent('pointerdown', { clientX: 180, clientY: 80, button: 0, bubbles: true, cancelable: true })));
    let finish!: (value: Awaited<ReturnType<typeof f.bridge.source>>) => void; vi.mocked(f.bridge.source).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    f.props.assetToApply = { token: 'late-material', workspaceId: f.project.workspaceId, projectId: f.project.id, file: { ...f.reference, id: 'material' } }; await render(f);
    await act(async () => { const session = (await import('../lib/editor-session-guard')).guardedEditorSessions({ includeDirty: true }).find(item => item.id === `beads:${f.project.id}`)!; await session.exportRecovery(); });
    expect(vi.mocked(f.bridge.exportRecovery).mock.calls[0][0].document.pattern.cells[0]).toBe(1);
    await act(async () => finish({ referenceId: 'material', name: 'material.png', sourceSha256: 'a'.repeat(64), originalWidth: 512, originalHeight: 512, dataUrl: 'data:image/png;base64,AA==' })); expect(f.onGenerate).not.toHaveBeenCalled();
  });
  it('保存失败可导出当前手绘恢复JSON，再从保存记录恢复为前进版本', async () => {
    const f = fixture(beadUiDocument()); await render(f); vi.mocked(f.bridge.save).mockRejectedValue(Error('工作区离线')); await canvasKey('Enter'); await click('保存');
    await click('导出恢复 JSON'); expect(vi.mocked(f.bridge.exportRecovery).mock.calls[0][0].document.pattern.cells[0]).toBe(1); expect(f.current()?.pattern.cells[0]).toBe(0);
    await click('从保存记录恢复'); const restore = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === '恢复此版本')!; expect(restore.disabled).toBe(false); await act(async () => restore.click());
    expect(vi.mocked(f.bridge.restore).mock.calls[0][0].expectedRevision).toBeUndefined(); expect(container.textContent).toContain('已保存 · v2'); expect(f.onGenerate).not.toHaveBeenCalled();
  });
  it('跨项目时旧生成回执不会覆盖新工程', async () => {
    const first = fixture(); await render(first); await click('导入'); let finish!: (value: BeadDocument) => void; vi.mocked(first.bridge.generate).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await click('本地生成图纸 · 免费');
    const nextDoc = { ...beadUiDocument('next-bead-project'), title: '新项目图纸' }, second = fixture(nextDoc); await render(second); await act(async () => finish({ ...beadUiDocument(), title: '迟到的旧图纸' })); expect(container.textContent).toContain('新项目图纸'); expect(container.textContent).not.toContain('迟到的旧图纸');
  });
  it('第四入口在旧后台也可返回普通图片，不被保存错误困住', async () => {
    const f = beadUiPage(); Object.defineProperty(window, 'desktop', { configurable: true, value: undefined }); for (const [key, value] of [['initialized', true], ['panel-open', true], ['focus', false], ['tool', 'ai']] as const) writeDisclosure(studioPreferenceKey('images', { workspaceId: f.project.workspaceId, projectId: f.project.id }, key), value);
    localStorage.setItem(imageDraftKey(f.project.id), JSON.stringify({ mode: 'create', prompt: '原图片要求', preset: '宣传图' })); await act(async () => { root = createRoot(container); root.render(<ImageStudio {...f.props} />); }); await click('拼豆'); await vi.waitFor(() => expect(container.querySelector('[aria-label="拼豆制图工作台"]')).not.toBeNull());
    await click('返回图片'); expect(container.querySelector('[aria-label="拼豆制图工作台"]')).toBeNull(); expect(JSON.parse(localStorage.getItem(imageDraftKey(f.project.id))!).preset).toBe('宣传图'); expect(f.onGenerate).not.toHaveBeenCalled();
  });
});
