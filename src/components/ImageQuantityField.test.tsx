// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageQuantityField } from './ImageQuantityField';
import { animationCleanup, animationDomSetup, animationMount, fill } from './animation/animation-test-fixtures';
beforeEach(animationDomSetup);
afterEach(async () => { await animationCleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('共享数量输入保持旧默认并支持工坊自定义份数', () => {
  it('普通图片仍使用20张上限、原标签与单位', async () => { const { host, root } = await animationMount(<ImageQuantityField value={20} onChange={() => {}} />); const input = host.querySelector('input')!; expect(input.getAttribute('aria-label')).toBe('图像生成数量'); expect(input.getAttribute('aria-invalid')).toBe('false'); expect(host.textContent).toContain('1–20 张'); const { act } = await import('react'); await act(async () => root.render(<ImageQuantityField value={21} onChange={() => {}} />)); expect(input.getAttribute('aria-invalid')).toBe('true'); });
  it('工坊可输入100份，空输入给出可修正错误而不是自动补1', async () => { function Controlled() { const [value, setValue] = useState(1); return <ImageQuantityField value={value} onChange={setValue} max={100} label="作品数量" unit="份" ariaLabel="角色份数" />; } const { host } = await animationMount(<Controlled />); await fill(host, '角色份数', '100'); const input = host.querySelector('input')!; expect(input.value).toBe('100'); expect(input.getAttribute('aria-invalid')).toBe('false'); expect(host.textContent).toContain('1–100 份'); await fill(host, '角色份数', ''); expect(input.value).toBe(''); expect(input.getAttribute('aria-invalid')).toBe('true'); expect(host.textContent).toContain('请输入 1–100 的整数'); });
});
