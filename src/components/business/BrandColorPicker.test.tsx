// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { BrandColorPicker } from './BrandColorPicker';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
async function mount(initial: string) { const host = document.createElement('div'), root = createRoot(host); document.body.append(host); roots.push(root); let latest = initial; function Harness() { const [value, setValue] = useState(initial); return <BrandColorPicker value={value} onChange={next => { latest = next; setValue(next); }} rememberKey="brand-test" brandName="山野咖啡" />; } await act(async () => root.render(<Harness />)); return { host, latest: () => latest }; }
const button = (host: HTMLElement, label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); localStorage.clear(); });
describe('可视品牌色系', () => {
  it('直接选择命名色系、添加和移除颜色，无需填写颜色代码', async () => {
    const { host, latest } = await mount('#2463eb');
    expect(host.querySelector('select,input[type="color"]')).toBeNull(); expect(host.textContent).not.toContain('多个色值用逗号分隔');
    expect(host.querySelector<HTMLInputElement>('[aria-label="品牌标准色"]')?.closest('details')?.open).toBe(false);
    await act(async () => button(host, '使用森野绿意色系').click()); expect(latest()).toBe('#28634c, #e5efdf, #fffdf5'); expect(host.querySelector('[aria-label="品牌配色即时预览"]')?.textContent).toContain('山野咖啡');
    await act(async () => [...host.querySelectorAll('button')].find(item => item.textContent === '添加颜色')!.click()); await act(async () => button(host, '添加樱桃红').click()); expect(latest()).toMatch(/#c83e4d$/);
    await act(async () => button(host, '移除辅助色3').click()); expect(latest()).toBe('#28634c, #e5efdf, #fffdf5');
  });
  it('保留已有自定义色及高级输入原文，主辅色可直接互换', async () => {
    const { host, latest } = await mount('#123456, #abcdef');
    await act(async () => button(host, '将辅助色1设为主色').click()); expect(latest()).toBe('#abcdef, #123456');
    await act(async () => host.querySelector('summary')!.click()); expect(host.querySelector('details')?.open).toBe(true);
    await act(async () => { const input = host.querySelector<HTMLInputElement>('[aria-label="品牌标准色"]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '#123456,'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(latest()).toBe('#123456,'); expect(host.querySelector<HTMLInputElement>('[aria-label="品牌标准色"]')?.value).toBe('#123456,');
  });
});
