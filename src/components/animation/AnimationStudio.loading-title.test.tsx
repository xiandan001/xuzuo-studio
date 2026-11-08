// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AnimationStudio } from '../../pages/AnimationStudio';
import { animationBackend, animationCleanup, animationDomSetup, animationMount } from './animation-test-fixtures';

beforeEach(() => { animationDomSetup(); vi.useFakeTimers(); });
afterEach(async () => { await animationCleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([
  ['atlas', '角色图集'],
  ['gif', 'GIF 动画工坊'],
] as const)('读取工程期间按 %s 入口显示标题，不抢先显示另一种用途', async (mode, title) => {
  const backend = animationBackend();
  vi.mocked(backend.bridge.read).mockImplementation(() => new Promise(() => {}));
  Object.defineProperty(window, 'desktop', { configurable: true, value: { animation: backend.bridge } });
  const { host } = await animationMount(<AnimationStudio props={backend.props} project={backend.project} initialMode={mode} />);
  expect(host.querySelector('h1')?.textContent).toBe(title);
  expect(host.querySelector('.animation-loading')?.textContent).toContain('正在读取动画工程');
  expect(backend.bridge.generate).not.toHaveBeenCalled();
});
