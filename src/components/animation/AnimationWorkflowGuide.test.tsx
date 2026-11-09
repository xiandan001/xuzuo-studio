// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimationEmptyPreview, AnimationWorkflowGuide } from './AnimationWorkflowGuide';
import { animationCleanup, animationDomSetup, animationMount, button, click } from './animation-test-fixtures';

beforeEach(animationDomSetup);
afterEach(async () => { await animationCleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('动画工作台的非阻断制作引导', () => {
  it('按源图和实际成品状态提示下一步，不把后台已连接当作制作完成', async () => {
    const props = { mode: 'gif' as const, hasFrames: false, ready: true, multiple: false, accepted: false };
    const { host, root } = await animationMount(<AnimationWorkflowGuide {...props} />);
    expect(host.querySelectorAll('li')).toHaveLength(3);
    expect(host.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain('描述需求');
    await act(async () => root.render(<AnimationWorkflowGuide {...props} hasFrames ready={false} />));
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain('制作与检查');
    expect(host.textContent).toContain('免费更新预览');
    await act(async () => root.render(<AnimationWorkflowGuide {...props} hasFrames />));
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain('导出作品');
    expect(host.textContent).toContain('当前 GIF 已就绪');
    expect(host.querySelector('button')).toBeNull();
  });

  it('认可样片只用于解释批量扩展，不阻止当前PNG导出', async () => {
    const props = { mode: 'atlas' as const, hasFrames: true, ready: true, multiple: true, accepted: false };
    const { host, root } = await animationMount(<AnimationWorkflowGuide {...props} />);
    expect(host.textContent).toContain('可直接导出当前 PNG');
    expect(host.textContent).toContain('先认可这份样片');
    await act(async () => root.render(<AnimationWorkflowGuide {...props} accepted />));
    expect(host.textContent).toContain('样片已认可');
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain('导出作品');
  });
});

describe('没有源图时的操作入口', () => {
  it.each([['atlas', '先做一张角色图', 'PNG'], ['gif', '先做一份 GIF 样片', 'GIF']] as const)('%s空态可填示例或导入工程，展示本身不触发回调', async (mode, title, output) => {
    const onExample = vi.fn(), onImport = vi.fn();
    const { host, root } = await animationMount(<AnimationEmptyPreview mode={mode} onExample={onExample} onImport={onImport} disabled={false} canFillExample />);
    expect(host.querySelector('h3')?.textContent).toBe(title);
    expect(host.textContent).toContain(output);
    expect(host.textContent).toContain('不调用模型');
    expect(onExample).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
    await click(button(host, '填入示例'));
    expect(onExample).toHaveBeenCalledTimes(1);
    expect(onImport).not.toHaveBeenCalled();
    await click(button(host, '导入已有工程'));
    expect(onImport).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<AnimationEmptyPreview mode={mode} onExample={onExample} onImport={onImport} disabled canFillExample={false} />));
    expect([...host.querySelectorAll('button')].some(item => item.textContent?.includes('填入示例'))).toBe(false);
    expect(button(host, '导入已有工程').disabled).toBe(true);
    await click(button(host, '导入已有工程'));
    expect(onImport).toHaveBeenCalledTimes(1);
  });
});
