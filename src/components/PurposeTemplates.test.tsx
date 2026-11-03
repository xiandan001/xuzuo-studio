import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ImageUseTemplate } from '../configuration-types';
import { PurposeTemplates } from './PurposeTemplates';
import { PromptEditor, PromptPicker } from './PromptDialogs';

const template: ImageUseTemplate = { id: 'custom-purpose', workspaceId: 'workspace', name: '电商商品主图', prompt: '保留主体，使用简洁背景。', size: '1024x1024', background: 'auto', minReferences: 1, enabled: true };
describe('用途模板编辑入口', () => {
  it('新增表单显示完整默认参数、自定义下拉和零调用说明', () => {
    const save = vi.fn(), remove = vi.fn();
    const html = renderToStaticMarkup(<PurposeTemplates templates={[]} workspaceId="workspace" workspaceName="当前工作区" initialMode="create" onSave={save} onDelete={remove} onClose={() => undefined} />);
    for (const label of ['新增用途模板', '用途模板名称', '用途模板默认描述', '用途模板默认尺寸', '用途模板默认背景', '用途模板最少参考图', '保存用途模板', '不调用模型']) expect(html).toContain(label);
    expect(html).toContain('role="combobox"'); expect(html).not.toContain('<select');
    expect(save).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it('管理仅包含本区自定义用途，内置只能复制，删除入口明确保留项目', () => {
    const html = renderToStaticMarkup(<PurposeTemplates templates={[template, { ...template, id: 'foreign', workspaceId: 'other', name: '别区专用' }]} workspaceId="workspace" workspaceName="当前工作区" initialMode="manage" onSave={() => true} onDelete={() => true} onClose={() => undefined} />);
    expect(html).toContain('编辑用途 电商商品主图'); expect(html).toContain('删除用途 电商商品主图');
    expect(html).toContain('复制用途 试衣图'); expect(html).not.toContain('删除用途 试衣图');
    expect(html).not.toContain('别区专用');
  });
  it('提示词编辑共用工作区用途列表，已删除关联可保留而不误改成另一用途', () => {
    const initial = { name: '我的提示词', description: '用于商品图', content: '主体居中。', category: 'image' as const, mode: 'create' as const, imagePreset: template.id };
    const html = renderToStaticMarkup(<PromptEditor initial={initial} useTemplates={[template]} onSave={() => undefined} onClose={() => undefined} />);
    expect(html).toContain('电商商品主图'); expect(html).not.toContain('<select');
    const removed = renderToStaticMarkup(<PromptEditor initial={initial} useTemplates={[]} onSave={() => undefined} onClose={() => undefined} />);
    expect(removed).toContain('原用途（已删除或停用）');
  });
  it('提示词预览显示用途名称，删除后说明状态而不向用户显示UUID', () => {
    const prompt = { id: 'prompt', builtin: false, workspaceId: 'workspace', updatedAt: '', name: '产品图', description: '描述', content: '主体居中。', category: 'image' as const, mode: 'create' as const, imagePreset: template.id };
    const html = renderToStaticMarkup(<PromptPicker prompts={[prompt]} useTemplates={[template]} onClose={() => undefined} onUse={() => undefined} />);
    expect(html).toContain('电商商品主图'); expect(html).not.toContain('custom-purpose');
    const removed = renderToStaticMarkup(<PromptPicker prompts={[prompt]} useTemplates={[]} onClose={() => undefined} onUse={() => undefined} />);
    expect(removed).toContain('原用途已删除'); expect(removed).not.toContain('custom-purpose');
  });
});
