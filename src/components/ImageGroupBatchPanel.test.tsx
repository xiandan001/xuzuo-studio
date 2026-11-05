import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PageProps, Project } from '../types';
import { ImageGroupBatchPanel } from './ImageGroupBatchPanel';
import { imageGroupDraftKey } from '../lib/image-group-batch';
const project = { id: 'project', workspaceId: 'workspace', name: '独立图片', kind: 'image', description: 'PRIVATE-PROMPT-MUST-NOT-COPY', budgetCents: 0, referenceFiles: [{ id: 'private-reference' }] } as Project;
function render(stored?: string) {
  const descriptors = ['window', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const), create = vi.fn(), list = vi.fn(), get = vi.fn(), control = vi.fn();
  const values = new Map(stored ? [[imageGroupDraftKey('workspace', 'project'), stored]] : []);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { desktop: { batches: { create, list, get, control } } } }); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value) } });
  const model = { id: 'model', name: '当前生成模型', connectionId: 'connection', capabilities: ['image-generation'], enabled: true } as PageProps['configuration']['models'][number];
  const props = { workspaceId: 'workspace', workspace: { directory: 'C:/owned' }, projects: [project], configuration: { models: [model], connections: [{ id: 'connection', enabled: true }], credentials: [{ id: 'key', name: '当前生成Key', connectionId: 'connection', enabled: true }] }, notify: vi.fn(), navigate: vi.fn() } as unknown as PageProps;
  try { return { html: renderToStaticMarkup(<ImageGroupBatchPanel props={props} project={project} settings={{ model, credentialId: 'key', size: '1024x1024', background: 'auto' }} busy={false} onClose={vi.fn()} />), calls: [create, list, get, control].reduce((sum, mock) => sum + mock.mock.calls.length, 0) }; }
  finally { for (const [key, descriptor] of descriptors) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
}
describe('分组图片面板边界', () => {
  it('初始两组描述为空，不带当前私有prompt/参考/预算；共有规格明确且填写不调用', () => {
    const { html, calls } = render(); expect(html).not.toContain('PRIVATE-PROMPT-MUST-NOT-COPY'); expect(html).not.toContain('private-reference'); expect(html).not.toContain('金额上限'); expect(html).toContain('当前生成模型'); expect(html).toContain('当前生成Key'); expect(html).toContain('1024x1024'); expect(html).toContain('独立图片项目和文件夹'); expect(html.match(/独立画面描述/g)).toHaveLength(2); expect(html.match(/<textarea[^>]*><\/textarea>/g)).toHaveLength(2); expect(calls).toBe(0);
  });
  it('500组恢复草稿只渲染20行，不挂图片预览或执行请求', () => {
    const stored = JSON.stringify({ version: 1, revision: 1, name: '大批次草稿', groups: Array.from({ length: 500 }, (_, index) => ({ id: 'row-' + index, name: '组' + index, brief: '独立需求' + index, count: '1' })) }); const { html, calls } = render(stored); expect(html.match(/独立画面描述/g)).toHaveLength(20); expect(html).not.toContain('<img'); expect(html).toContain('500 组'); expect(calls).toBe(0);
  });
});
