// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { AnimationPreviewHeader } from './AnimationPreviewHeader';
import { animationBackend, animationCleanup, animationDomSetup, animationMount, button, click } from './animation-test-fixtures';

beforeEach(animationDomSetup);
afterEach(async () => { await animationCleanup(); vi.restoreAllMocks(); });

function previewProps() {
  return {
    entry: animationBackend({ ready: true }).document.entries[0],
    index: 0,
    mode: 'gif' as const,
    status: '已就绪',
    metadata: '512 × 512 px · 2.40 秒循环',
    canPlay: true,
    playing: false,
    disabled: false,
    onTogglePlaying: vi.fn(),
    onCompose: vi.fn(),
  };
}

describe('动画预览标题与本地操作', () => {
  it('长动作要求不作为预览标题，完整文案可展开查看', async () => {
    const props = previewProps();
    props.entry.description = '保持身体站定并自然挥手，保留角色与服装细节。'.repeat(40);
    props.entry.caption = '动画文案'.repeat(24);
    const { host } = await animationMount(<AnimationPreviewHeader {...props} />);
    const heading = host.querySelector('.animation-preview-heading')!;
    expect(heading.querySelector('.animation-preview-title')?.textContent).toBe('第 1 份 · 动画预览');
    expect(heading.textContent).not.toContain(props.entry.description);
    expect(heading.querySelector('.animation-preview-caption')?.getAttribute('title')).toBe(props.entry.caption);
    const requirements = host.querySelector<HTMLDetailsElement>('.animation-preview-requirements')!;
    expect(requirements.open).toBe(false);
    await click(requirements.querySelector('summary')!);
    expect(requirements.open).toBe(true);
    expect(requirements.querySelector('p')?.textContent).toBe(props.entry.description);
  });

  it('播放和免费更新使用独立操作，不需要模型参数', async () => {
    const props = previewProps();
    const { host, root } = await animationMount(<AnimationPreviewHeader {...props} />);
    await click(button(host, '播放 GIF'));
    await click(button(host, '更新预览'));
    expect(props.onTogglePlaying).toHaveBeenCalledTimes(1);
    expect(props.onCompose).toHaveBeenCalledTimes(1);
    expect(button(host, '更新预览').title).toContain('不新增费用');
    await act(async () => root.render(<AnimationPreviewHeader {...props} playing />));
    expect(button(host, '暂停预览').disabled).toBe(false);
  });

  it('本地合成不可用时仍可播放已有GIF，忙碌时两项都锁定', async () => {
    const props = previewProps();
    const { host, root } = await animationMount(<AnimationPreviewHeader {...props} composeDisabled />);
    expect(button(host, '更新预览').disabled).toBe(true);
    expect(button(host, '播放 GIF').disabled).toBe(false);
    await act(async () => root.render(<AnimationPreviewHeader {...props} disabled />));
    expect(button(host, '更新预览').disabled).toBe(true);
    expect(button(host, '播放 GIF').disabled).toBe(true);
  });

  it('图集使用独立短标题，无源图时不能合成，也不出现播放按钮', async () => {
    const props = previewProps();
    const { host } = await animationMount(<AnimationPreviewHeader {...props} entry={undefined} index={2} mode="atlas" canPlay={false} />);
    expect(host.querySelector('.animation-preview-title')?.textContent).toBe('第 3 份 · 角色预览');
    expect(host.textContent).not.toContain('播放 GIF');
    expect(button(host, '更新预览').disabled).toBe(true);
    expect(host.querySelector('.animation-preview-requirements')).toBeNull();
  });
});
