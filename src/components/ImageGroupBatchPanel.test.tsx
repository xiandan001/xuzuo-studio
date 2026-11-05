import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PageProps, Project } from '../types';
import { ImageGroupBatchPanel } from './ImageGroupBatchPanel';
import { imageGroupDraftKey } from '../lib/image-group-batch';
import type { ImageOutputOptions } from '../image-options-types';
const project = { id: 'project', workspaceId: 'workspace', name: '独立图片', kind: 'image', description: 'PRIVATE-PROMPT-MUST-NOT-COPY', budgetCents: 0, referenceFiles: [{ id: 'private-reference' }] } as Project;
function render(stored?: string, imageOptions?: ImageOutputOptions, modelId = 'gpt-image-2.6-sunburst') {
  const descriptors = ['window', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const), create = vi.fn(), list = vi.fn(), get = vi.fn(), control = vi.fn();
  const values = new Map(stored ? [[imageGroupDraftKey('workspace', 'project'), stored]] : []);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { desktop: { batches: { create, list, get, control } } } }); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value) } });
  const model = { id: 'model', modelId, name: '当前生成模型', connectionId: 'connection', capabilities: ['image-generation'], enabled: true } as PageProps['configuration']['models'][number];
  const props = { workspaceId: 'workspace', workspace: { directory: 'C:/owned' }, projects: [project], configuration: { models: [model], connections: [{ id: 'connection', enabled: true }], credentials: [{ id: 'key', name: '当前生成Key', connectionId: 'connection', enabled: true }] }, notify: vi.fn(), navigate: vi.fn() } as unknown as PageProps;
  try { return { html: renderToStaticMarkup(<ImageGroupBatchPanel props={props} project={project} settings={{ model, credentialId: 'key', size: '1024x1024', background: 'auto', imageOptions }} busy={false} onClose={vi.fn()} />), calls: [create, list, get, control].reduce((sum, mock) => sum + mock.mock.calls.length, 0) }; }
  finally { for (const [key, descriptor] of descriptors) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
}
describe('分组图片面板边界', () => {
  it('只读摘要显示实际SVG/GIF格式、动画参数和工作台调整入口，不新建格式表单或调用', () => {
    const svg = render(undefined, { imageOutputFormat: 'svg' }); expect(svg.html).toContain('SVG矢量图'); expect(svg.html).toContain('返回图片工作台可调整'); expect(svg.calls).toBe(0);
    const gif = render(undefined, { imageOutputFormat: 'gif', imageFrameCount: 2, imageFrameDurationMs: 205 }); expect(gif.html).toContain('GIF动画'); expect(gif.html).toContain('2帧'); expect(gif.html).toContain('每帧210ms'); expect(gif.html).toContain('auto'); expect(gif.calls).toBe(0);
    const old = render(undefined, { imageOutputFormat: 'svg' }, 'gpt-image-2.5-flare'); expect(old.html).toContain('仅支持 GPT Image 2.6'); expect(old.calls).toBe(0);
  });
  it('升级后的默认PNG仍识别旧提交设置键，保留显式新建一批操作', () => {
    const stored = JSON.stringify({ version: 1, revision: 1, name: '已提交批次', groups: [{ id: 'row-one', name: '组一', brief: '独立需求', count: '1' }], submitted: { batchId: 'batch-one', revision: 1, settings: 'model|key|1024x1024|auto' } });
    const { html, calls } = render(stored, { imageOutputFormat: 'png', imageQuality: 'auto' }); expect(html).toContain('此批已创建'); expect(html).toContain('按相同分组新建一批'); expect(calls).toBe(0);
  });
  it('初始两组描述为空，不带当前私有prompt/参考/预算；共有规格明确且填写不调用', () => {
    const { html, calls } = render(); expect(html).not.toContain('PRIVATE-PROMPT-MUST-NOT-COPY'); expect(html).not.toContain('private-reference'); expect(html).not.toContain('金额上限'); expect(html).toContain('当前生成模型'); expect(html).toContain('当前生成Key'); expect(html).toContain('1024x1024'); expect(html).toContain('独立图片项目和文件夹'); expect(html.match(/独立画面描述/g)).toHaveLength(2); expect(html.match(/<textarea[^>]*><\/textarea>/g)).toHaveLength(2); expect(calls).toBe(0);
  });
  it('500组恢复草稿只渲染20行，不挂图片预览或执行请求', () => {
    const stored = JSON.stringify({ version: 1, revision: 1, name: '大批次草稿', groups: Array.from({ length: 500 }, (_, index) => ({ id: 'row-' + index, name: '组' + index, brief: '独立需求' + index, count: '1' })) }); const { html, calls } = render(stored); expect(html.match(/独立画面描述/g)).toHaveLength(20); expect(html).not.toContain('<img'); expect(html).toContain('500 组'); expect(calls).toBe(0);
  });
});
