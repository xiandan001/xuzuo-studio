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
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Picking a scenario must not make a network request'); }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 80, y: 100, left: 80, top: 100, right: 340, bottom: 144, width: 260, height: 44, toJSON: () => ({}) });
  host = document.createElement('div'); document.body.append(host);
});
afterEach(async () => {
  try { if (root) await act(async () => root!.unmount()); expect(fetch).not.toHaveBeenCalled(); }
  finally { root = undefined; host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});
const picker = () => host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
async function key(target: HTMLElement, value: string) { await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); }); }
async function query(value: string) {
  const search = document.querySelector<HTMLInputElement>('[aria-label="搜索使用场景"]')!;
  expect(search).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, value); search.dispatchEvent(new Event('input', { bubbles: true })); });
  return search;
}
async function fixture(templates: ImageUseTemplate[] = [], disabled = false) {
  const selected = vi.fn();
  const render = async (currentTemplates = templates, isDisabled = disabled, currentWorkspace = workspaceId) => act(async () => { root ||= createRoot(host); root.render(<ChatScenarioPicker workspaceId={currentWorkspace} templates={currentTemplates} disabled={isDisabled} onSelect={selected} />); });
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

  it('空的自定义库仍提供真实的内置场景；壁纸不使用旧竖屏默认值覆盖设备方向', () => {
    const rows = chatScenarios([], workspaceId);
    expect(rows.some(row => row.name === '宣传图')).toBe(true);
    const wallpaper = rows.find(row => row.name === '壁纸')!;
    expect(wallpaper.text).toContain('以本次设备和用户要求为准');
    expect(wallpaper.text).not.toContain('1024 × 1536');
  });

  it('只在用户键盘确认后回调，携带自定义用途与参考资料要求', async () => {
    const f = await fixture([custom]); expect(f.selected).not.toHaveBeenCalled();
    await key(picker(), 'ArrowDown'); const search = await query('品牌产品场景');
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    await key(search, 'Enter'); expect(f.selected).toHaveBeenCalledOnce();
    expect(f.selected.mock.calls[0][0]).toMatchObject({ outputKind: 'image', name: custom.name, imageTemplate: { id: custom.id, minReferences: 2, background: 'opaque', size: '1536x1024' } });
    expect(f.selected.mock.calls[0][0].text).toContain(custom.prompt);
    expect(f.selected.mock.calls[0][0].text).toContain('至少 2 张参考图片');
    expect(f.selected.mock.calls[0][0].text).toContain('1536 × 1024');
    expect(picker().getAttribute('aria-expanded')).toBe('false');
  });

  it('搜索无匹配时保留空结果，Escape返回焦点且不应用场景', async () => {
    const f = await fixture(); await act(async () => { picker().focus(); picker().click(); });
    const search = await query('没有这样的场景'); expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
    await key(search, 'Escape'); expect(document.activeElement).toBe(picker()); expect(f.selected).not.toHaveBeenCalled();
  });

  it('禁用时不打开，运行中变为禁用会关闭场景列表且不应用', async () => {
    const f = await fixture([custom], true); expect(picker().disabled).toBe(true);
    await key(picker(), 'Enter'); expect(document.querySelector('[data-select-popup]')).toBeNull();
    await f.render([custom], false); await key(picker(), 'ArrowDown'); expect(document.querySelector('[data-select-popup]')).toBeTruthy();
    await f.render([custom], true); expect(document.querySelector('[data-select-popup]')).toBeNull(); expect(f.selected).not.toHaveBeenCalled();
  });

  it('工作区切换后旧工作区自定义场景消失，选择文档会传递正确的制作类型', async () => {
    const f = await fixture([custom]); await f.render([custom], false, 'another-workspace');
    await key(picker(), 'ArrowDown'); await query('品牌产品场景'); expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
    const search = await query('合作说明书'); await key(search, 'Enter');
    expect(f.selected).toHaveBeenCalledOnce(); expect(f.selected.mock.calls[0][0]).toMatchObject({ outputKind: 'word', text: expect.stringContaining('合作说明书') });
  });
});
