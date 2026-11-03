import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PageProps, Preferences } from '../types';
import { INITIAL_PREFERENCES } from '../data';
import { Settings } from './Settings';

function render(preferences: Preferences) {
  const props = { preferences, workspace: { id: 'settings-fixture', name: '隔离设置' }, configuration: { connections: [], models: [], vaultStatus: { available: false } }, navigate: () => undefined, notify: () => undefined, onUpdatePreferences: () => undefined } as unknown as PageProps;
  return renderToStaticMarkup(<Settings {...props} />);
}
describe('生成前逐次确认设置', () => {
  it('开关默认关闭，直接调用与实际费用说明清楚', () => {
    const html = render(INITIAL_PREFERENCES);
    expect(html.match(/<button\b[^>]*aria-label="生成前逐次确认"[^>]*>/)?.[0]).toContain('aria-checked="false"');
    expect(html).toContain('默认关闭'); expect(html).toContain('会直接调用所选模型'); expect(html).toContain('按实际用量记录费用');
    expect(html).not.toContain('真实调用始终需要费用预检与确认');
  });
  it('旧默认true显示关闭，显式新选择true显示开启', () => {
    const old = render({ ...INITIAL_PREFERENCES, confirmGeneration: true, confirmGenerationVersion: undefined });
    const optedIn = render({ ...INITIAL_PREFERENCES, confirmGeneration: true, confirmGenerationVersion: 1 });
    expect(old.match(/<button\b[^>]*aria-label="生成前逐次确认"[^>]*>/)?.[0]).toContain('aria-checked="false"');
    expect(optedIn.match(/<button\b[^>]*aria-label="生成前逐次确认"[^>]*>/)?.[0]).toContain('aria-checked="true"');
  });
});
