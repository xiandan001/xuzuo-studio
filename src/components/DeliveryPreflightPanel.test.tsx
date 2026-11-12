// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeliveryPreflightPanel } from './DeliveryPreflightPanel';
import type { DeliveryPreflightPanelProps } from './DeliveryPreflightPanel';
import type { DeliveryPreflightFinding, DeliveryPreflightReport, DeliveryPreflightRequest } from '../delivery-types';
const roots: { root: Root; host: HTMLDivElement }[] = [];
afterEach(async () => { for (const item of roots.splice(0)) { await act(async () => item.root.unmount()); item.host.remove(); } delete window.desktop; vi.unstubAllGlobals(); });
async function mount(props: Partial<DeliveryPreflightPanelProps>) { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), item = { root, host }; roots.push(item); await act(async () => root.render(<DeliveryPreflightPanel projectId="project" kind="word" artifactIds={['file']} sourceRevision={3} {...props} />)); return item; }
async function click(host: HTMLDivElement, text: string) { const button = [...host.querySelectorAll('button')].find(item => item.textContent?.includes(text)); expect(button).toBeTruthy(); await act(async () => button!.click()); }
const finding: DeliveryPreflightFinding = { id: 'finding', severity: 'warning', label: '小字号', detail: '第2页文字太小', method: 'ooxml', target: { projectId: 'project', artifactId: 'file', sha256: 'a'.repeat(64), sourceRevision: 3, pageNumber: 2, pageId: 'page-two' } };
function report(): DeliveryPreflightReport { return { version: 1, requestId: 'request', projectId: 'project', kind: 'word', generatedAt: '', cached: false, files: [{ id: 'file', name: 'file.docx', bytes: 100, mimeType: 'application/test', sha256: 'a'.repeat(64) }], checks: [], findings: [finding], rendered: { status: 'not-needed' } }; }
describe('按需运行的交付预检交互', () => {
  it('首次展开不自动读文件或运行后台检查，明确点击才开始，可直达指定位置', async () => {
    const preflight = vi.fn(async (_input: DeliveryPreflightRequest) => report()), onOpenIssue = vi.fn(); window.desktop = { delivery: { preflight, cancelPreflight: vi.fn(async () => undefined) } } as unknown as typeof window.desktop;
    const { host } = await mount({ onOpenIssue }); expect(preflight).not.toHaveBeenCalled(); expect(host.textContent).toContain('0 API费用');
    await click(host, '运行预检'); expect(preflight).toHaveBeenCalledTimes(1); expect(preflight.mock.calls[0][0]).toMatchObject({ projectId: 'project', sourceRevision: 3, artifactIds: ['file'] });
    await click(host, '查看位置'); expect(onOpenIssue).toHaveBeenCalledWith(finding);
  });
  it('dirty草稿不发请求，不用旧成品覆盖正在修改的内容', async () => {
    const preflight = vi.fn(); window.desktop = { delivery: { preflight } } as unknown as typeof window.desktop; const { host } = await mount({ dirty: true });
    expect(host.querySelector('button')!.disabled).toBe(true); expect(host.textContent).toContain('先保存并导出'); expect(preflight).not.toHaveBeenCalled();
  });
  it('取消和切换成品清理后台任务，迟到结果不显示在新项目', async () => {
    let resolve: (report: DeliveryPreflightReport) => void; const preflight = vi.fn(() => new Promise<DeliveryPreflightReport>(done => { resolve = done; })), cancelPreflight = vi.fn(async () => undefined); window.desktop = { delivery: { preflight, cancelPreflight } } as unknown as typeof window.desktop;
    const { host, root } = await mount({}); await click(host, '运行预检'); await click(host, '取消'); expect(cancelPreflight).toHaveBeenCalledTimes(1);
    await act(async () => resolve!(report())); expect(host.textContent).not.toContain('第2页文字太小');
    await act(async () => root.render(<DeliveryPreflightPanel projectId="other-project" kind="word" artifactIds={['other-file']} />)); expect(host.textContent).not.toContain('小字号');
  });
});
