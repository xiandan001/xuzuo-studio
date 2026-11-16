// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CommerceImagePreview, CommerceImagePreviewRequest, CommerceImagesBridge } from '../commerce-image-types';
import type { CommercePreviewPlan } from '../lib/commerce-viewport';
import { useCommerceClearPreviews } from './useCommerceClearPreviews';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
let root: Root | undefined, host: HTMLDivElement;
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function reply(input: CommerceImagePreviewRequest, dataUrl = image): CommerceImagePreview { return { artifactId: input.artifactId, sourceWidth: 1280, sourceHeight: 720, width: Math.ceil(input.region.width * 1280), height: Math.ceil(input.region.height * 720), crop: input.region, sha256: (input.artifactId === 'other' ? 'b' : 'a').repeat(64), dataUrl }; }
function Probe({ scope, plans, bridge }: { scope: string; plans: CommercePreviewPlan[]; bridge: CommerceImagesBridge }) { const value = useCommerceClearPreviews({ projectId: 'project', scope, sourceId: scope === 'other' ? 'other' : 'original', sourceSha256: (scope === 'other' ? 'b' : 'a').repeat(64), plans, bridge, enabled: true }); return <div data-tile={Object.keys(value.tiles).join(',')} data-crops={JSON.stringify(Object.fromEntries(Object.entries(value.tiles).map(([id, tile]) => [id, tile.crop])))} data-issue={value.issue} data-loading={value.loading} />; }
async function render(scope: string, plans: CommercePreviewPlan[], bridge: CommerceImagesBridge) { await act(async () => { root ||= createRoot(host); root.render(<Probe scope={scope} plans={plans} bridge={bridge} />); }); }
async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(180); }); }
const plan = (artifactId = 'original', x = 0): CommercePreviewPlan => ({ tileId: artifactId, artifactId, region: { x, y: 0, width: .04, height: .04 }, maxSide: 768 });
it('停手后只请求视口裁片，已有清晰结果与相同新对象渲染不产生循环请求', async () => {
  const preview = vi.fn(async input => reply(input)), bridge = { preview, cancelPreview: vi.fn(async () => {}) } as unknown as CommerceImagesBridge;
  await render('original', [plan()], bridge); expect(preview).not.toHaveBeenCalled(); await settle(); expect(preview).toHaveBeenCalledTimes(1);
  expect(preview.mock.calls[0][0]).toMatchObject({ projectId: 'project', artifactId: 'original', region: { width: .04 }, expectedSha256: 'a'.repeat(64) });
  await render('original', [plan()], bridge); await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); expect(preview).toHaveBeenCalledTimes(1); expect(host.firstElementChild!.getAttribute('data-tile')).toBe('original');
});
it('切换来源取消原请求，旧artifact和SHA的迟到回包不能写入新画布', async () => {
  const pending: { input: CommerceImagePreviewRequest; resolve: (value: CommerceImagePreview) => void }[] = [];
  const preview = vi.fn((input: CommerceImagePreviewRequest) => new Promise<CommerceImagePreview>(resolve => pending.push({ input, resolve }))), cancelPreview = vi.fn(async () => {}), bridge = { preview, cancelPreview } as unknown as CommerceImagesBridge;
  await render('original', [plan()], bridge); await settle(); await render('other', [plan('other')], bridge); await settle(); expect(cancelPreview).toHaveBeenCalledWith({ projectId: 'project', requestId: pending[0].input.requestId });
  await act(async () => pending[1].resolve(reply(pending[1].input))); expect(host.firstElementChild!.getAttribute('data-tile')).toBe('other');
  await act(async () => pending[0].resolve(reply(pending[0].input))); expect(host.firstElementChild!.getAttribute('data-tile')).toBe('other');
});
it('坏来源SHA不替换图片，字节预算会在16个数量上限之前淘汰旧裁片', async () => {
  let bad = true; const large = 'data:image/png;base64,' + 'A'.repeat(1024 * 1024);
  const preview = vi.fn(async (input: CommerceImagePreviewRequest) => ({ ...reply(input, large), ...(bad ? { sha256: 'c'.repeat(64) } : {}) })), bridge = { preview, cancelPreview: vi.fn(async () => {}) } as unknown as CommerceImagesBridge;
  await render('original', [plan()], bridge); await settle(); expect(host.firstElementChild!.getAttribute('data-tile')).toBe(''); expect(host.firstElementChild!.getAttribute('data-issue')).toContain('来源不一致');
  bad = false;
  for (let index = 1; index <= 7; index++) { await render('original', [plan('original', index * .1)], bridge); await settle(); }
  const calls = preview.mock.calls.length; await render('original', [plan('original', .1)], bridge); await settle(); expect(preview).toHaveBeenCalledTimes(calls + 1);
});
it('同源不同图层各自显示所需裁片，相同ROI与清晰度共享一次请求而不发送placement到IPC', async () => {
  const preview = vi.fn(async (input: CommerceImagePreviewRequest) => { const sourceWidth = 3840, sourceHeight = 2160, width = Math.ceil(sourceWidth * input.region.width), height = Math.ceil(sourceHeight * input.region.height), ratio = Math.min(1, input.maxSide / Math.max(width, height), Math.sqrt(2000000 / (width * height))); return { ...reply(input), sourceWidth, sourceHeight, width: Math.floor(width * ratio), height: Math.floor(height * ratio) }; }), bridge = { preview, cancelPreview: vi.fn(async () => {}) } as unknown as CommerceImagesBridge;
  const badge: CommercePreviewPlan = { tileId: 'layer:badge', artifactId: 'original', region: { x: 0, y: 0, width: 1, height: 1 }, maxSide: 768 }, background: CommercePreviewPlan = { tileId: 'layer:background', artifactId: 'original', region: { x: 0, y: 0, width: .25, height: .3 }, maxSide: 2048 };
  await render('original', [badge, background], bridge); await settle(); expect(preview).toHaveBeenCalledTimes(2); expect(host.firstElementChild!.getAttribute('data-tile')).toBe('layer:badge,layer:background');
  expect(JSON.parse(host.firstElementChild!.getAttribute('data-crops')!)).toEqual({ 'layer:badge': badge.region, 'layer:background': background.region });
  expect(preview.mock.calls.every(([input]) => !Object.hasOwn(input, 'tileId'))).toBe(true);
  await render('other', [{ ...background, artifactId: 'other', tileId: 'layer:one' }, { ...background, artifactId: 'other', tileId: 'layer:two' }], bridge); await settle();
  expect(preview).toHaveBeenCalledTimes(3); expect(host.firstElementChild!.getAttribute('data-tile')).toBe('layer:one,layer:two');
});
