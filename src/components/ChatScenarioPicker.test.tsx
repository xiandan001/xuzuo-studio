// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageUseTemplate } from '../configuration-types';
import { ChatScenarioPicker, chatScenarios } from './ChatScenarioPicker';

const workspaceId = 'current-workspace';
const custom: ImageUseTemplate = { id: 'custom-purpose', workspaceId, name: '品牌产品场景', prompt: '保留附件中的产品包装，使用暖色桌面与简洁留白。', size: '1536x1024', background: 'opaque', minReferences: 2, enabled: true };
let root: Root | undefined, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Picking a scenario must not make a network request'); }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  const bounds = { x: 80, y: 100, left: 80, top: 100, right: 340, bottom: 144, width: 260, height: 44, toJSON: () => ({}) };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(bounds);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([bounds] as unknown as DOMRectList);
  host = document.createElement('div'); document.body.append(host);
});
afterEach(async () => {
  try { if (root) await act(async () => root!.unmount()); expect(fetch).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeNull(); }
  finally { root = undefined; host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});
const picker = () => host.querySelector<HTMLButtonElement>('[aria-label="使用场景"]')!;
async function key(target: HTMLElement, value: string) { await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); }); }
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label || button.textContent?.trim() === label);
  expect(button).toBeTruthy(); await act(async () => button!.click());
}
async function open() { await act(async () => { picker().focus(); picker().click(); }); }
async function query(value: string) {
  const search = document.querySelector<HTMLInputElement>('[aria-label="搜索使用场景"]')!;
  expect(search).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, value); search.dispatchEvent(new Event('input', { bubbles: true })); });
  return search;
}
async function fixture(templates: ImageUseTemplate[] = [], disabled = false, value?: string, mode: 'chat' | 'plan' = 'chat') {
  const selected = vi.fn();
  const render = async (currentTemplates = templates, isDisabled = disabled, currentWorkspace = workspaceId, currentValue = value, currentMode = mode) => act(async () => { root ||= createRoot(host); root.render(<ChatScenarioPicker workspaceId={currentWorkspace} templates={currentTemplates} value={currentValue} mode={currentMode} disabled={isDisabled} onSelect={selected} />); });
  await render(); return { selected, render };
}

describe('聊天使用场景', () => {
  it('保留内置用途和文档场景，只读取本工作区启用的自定义用途', () => {
    const rows = chatScenarios([custom, { ...custom, id: 'disabled', enabled: false }, { ...custom, id: 'foreign', workspaceId: 'another-workspace' }], workspaceId);
    expect(rows.some(row => row.name === '试衣图')).toBe(true);
    expect(rows.filter(row => row.outputKind !== 'image').map(row => row.outputKind)).toEqual(['ppt', 'word', 'excel']);
    expect(rows.filter(row => row.id.startsWith('image:') && row.imageTemplate?.id === custom.id)).toHaveLength(1);
    expect(rows.some(row => /disabled|foreign/.test(row.id))).toBe(false);
    expect(custom).toEqual({ id: 'custom-purpose', workspaceId, name: '品牌产品场景', prompt: '保留附件中的产品包装，使用暖色桌面与简洁留白。', size: '1536x1024', background: 'opaque', minReferences: 2, enabled: true });
  });

  it('自由聊天有明确模式且无制作提示，壁纸与拼豆保留正确的原始约束', () => {
    const rows = chatScenarios([], workspaceId);
    expect(rows.find(row => row.id === 'chat-default')).toMatchObject({ name: '自由聊天', mode: 'chat', text: '' });
    expect(rows.find(row => row.name === '宣传图')?.mode).toBe('plan');
    const wallpaper = rows.find(row => row.name === '壁纸')!;
    expect(wallpaper.text).toContain('以本次设备和用户要求为准'); expect(wallpaper.text).not.toContain('1024 × 1536');
    expect(rows.find(row => row.name === '拼豆')!.text).toMatch(/^请制作拼豆图纸。/);
  });

  it('工具栏显示已选场景，打开分类对话框不会发送或应用场景', async () => {
    const f = await fixture([], false, 'image:宣传图');
    expect(picker().textContent).toBe('场景：宣传图'); expect(picker().getAttribute('aria-haspopup')).toBe('dialog');
    await open(); expect(document.querySelector('[role="dialog"]')).toBeTruthy(); expect(f.selected).not.toHaveBeenCalled();
    await click('图片'); expect(document.querySelector('[aria-label="使用场景 自由聊天"]')).toBeNull(); expect(document.querySelector('[aria-label="使用场景 宣传图"]')).toBeTruthy();
    await click('文档与表格'); expect(document.querySelectorAll('.chat-scenario-list > button')).toHaveLength(3);
    await click('关闭使用场景'); expect(picker().getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(picker()); expect(f.selected).not.toHaveBeenCalled();
  });

  it('搜索唯一结果并键盘确认，回调保留完整自定义用途与参考要求', async () => {
    const f = await fixture([custom]); await open(); const search = await query('品牌产品场景');
    expect(document.querySelectorAll('.chat-scenario-list > button')).toHaveLength(1);
    await key(search, 'Enter'); expect(f.selected).toHaveBeenCalledOnce();
    expect(f.selected.mock.calls[0][0]).toMatchObject({ mode: 'plan', outputKind: 'image', name: custom.name, imageTemplate: { id: custom.id, minReferences: 2, background: 'opaque', size: '1536x1024' } });
    expect(f.selected.mock.calls[0][0].text).toContain(custom.prompt); expect(f.selected.mock.calls[0][0].text).toContain('至少 2 张参考图片'); expect(f.selected.mock.calls[0][0].text).toContain('1536 × 1024');
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(picker().getAttribute('aria-expanded')).toBe('false');
  });

  it('空结果可恢复全部场景，Escape返回焦点且不应用场景', async () => {
    const f = await fixture(); await open(); await query('没有这样的场景');
    expect(document.querySelectorAll('.chat-scenario-list > button')).toHaveLength(0); expect(document.body.textContent).toContain('没有找到相关场景');
    await click('查看全部'); expect(document.querySelector('[aria-label="使用场景 自由聊天"]')).toBeTruthy();
    await key(document.querySelector<HTMLInputElement>('[aria-label="搜索使用场景"]')!, 'Escape');
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(picker()); expect(f.selected).not.toHaveBeenCalled();
  });

  it('运行中禁用会关闭场景对话框，重新启用不自动打开', async () => {
    const f = await fixture([custom], true); expect(picker().disabled).toBe(true);
    await act(async () => picker().click()); expect(document.querySelector('[role="dialog"]')).toBeNull();
    await f.render([custom], false); await open(); expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    await f.render([custom], true); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(f.selected).not.toHaveBeenCalled();
    await f.render([custom], false); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('工作区切换关闭旧对话框，旧自定义场景不会显示或被选择', async () => {
    const f = await fixture([custom], false, `image:${custom.id}`); await open();
    await f.render([custom], false, 'another-workspace'); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(picker().textContent).toBe('场景：自由聊天');
    await open(); await query('品牌产品场景'); expect(document.querySelectorAll('.chat-scenario-list > button')).toHaveLength(0);
    await query('合作说明书'); await click('使用场景 把资料整理成正式文档');
    expect(f.selected).toHaveBeenCalledOnce(); expect(f.selected.mock.calls[0][0]).toMatchObject({ mode: 'plan', outputKind: 'word', text: expect.stringContaining('合作说明书') });
  });

  it('自由聊天可以显式选中，默认制作场景只显示且不替父级修改输入', async () => {
    const f = await fixture([], false, undefined, 'plan'); expect(picker().textContent).toBe('场景：宣传图'); expect(f.selected).not.toHaveBeenCalled();
    await open(); await click('聊天'); await click('使用场景 自由聊天');
    expect(f.selected).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'chat-default', mode: 'chat', text: '' }));
  });
});
