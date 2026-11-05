import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PageProps, Project } from '../types';
import type { WorkflowRun } from '../configuration-types';
import type { ArtifactMetadata } from '../live-types';
import { ImageStudio } from './ImageStudio';
import { ImageGallery } from '../components/ImageGallery';

const project: Project = { id: 'image-project', workspaceId: 'workspace', name: '客户宣传图', kind: 'image', status: 'draft', description: '我的真实画面描述', updatedAt: 'now', costCents: 23, version: 1, accent: 'purple' };
const preview = vi.fn();
const artifact = (id: string, kind: 'image' | 'text'): ArtifactMetadata => ({ id, projectId: project.id, name: `${id}.${kind === 'image' ? 'png' : 'txt'}`, mimeType: kind === 'image' ? 'image/png' : 'text/plain', bytes: 30, kind, path: `files/${id}`, createdAt: '2026-10-30T01:00:00Z' });
function run(id: string, file: ArtifactMetadata, date: string): WorkflowRun {
  return { id, mode: 'live', workspaceId: 'workspace', projectId: project.id, workflowId: id, workflowName: id, snapshot: { id, name: id, workspaceId: 'workspace', description: '', outputKind: 'image', steps: [{ id: 'step', name: '步骤', kind: file.kind === 'image' ? 'image-generation' : 'text', prompt: '', inputSource: 'project', enabled: true }], updatedAt: date }, status: 'complete', stepIndex: 1, attempts: [{ id: `${id}-attempt`, stepId: 'step', stepName: '步骤', modelLabel: '模型', status: 'complete', costCents: 23, summary: '', input: '', prompt: '', action: '初次生成', artifacts: [file] }], variables: {}, input: '', createdAt: date, updatedAt: date };
}
function props(runs: WorkflowRun[] = []): PageProps {
  return {
    activeProject: project, projects: [project], workspaceId: 'workspace', workspace: { id: 'workspace', name: '测试工作区' }, preferences: {}, ledger: [], prompts: [],
    configuration: { categories: [], workflows: [], studioActions: [], credentials: [{ id: 'test-key', name: '测试账户', connectionId: 'connection', enabled: true }], connections: [{ id: 'connection', name: '测试服务', enabled: true }], models: [{ id: 'generation-model', name: '测试生成模型', modelId: 'fixture-generation', connectionId: 'connection', capabilities: ['image-generation'], enabled: true }, { id: 'editing-model', name: '测试编辑模型', modelId: 'fixture-editing', connectionId: 'connection', capabilities: ['image-editing'], enabled: true }] },
    workflowRunner: { runs, runtimeStatus: { available: true }, trashedArtifacts: [], previewArtifact: preview },
    onPromptApplied: vi.fn(), notify: vi.fn(),
  } as unknown as PageProps;
}
beforeEach(() => { vi.stubGlobal('window', { desktop: undefined }); });
afterEach(() => { vi.unstubAllGlobals(); preview.mockClear(); });

describe('图片工作台可见交互', () => {
  it.each([3, 7, 20])('自定义数量 %s 张显示为可输入字段，并同步生成按钮', quantity => {
    vi.stubGlobal('localStorage', { getItem: (key: string) => key.startsWith('xuzuo-image-draft-v1-') ? JSON.stringify({ quantity, prompt: '自定义张数测试', generationModelId: 'generation-model' }) : null });
    const html = renderToStaticMarkup(<ImageStudio {...props()} />);
    expect(html.match(/<input[^>]*aria-label="图像生成数量"/g)).toHaveLength(1);
    expect(html.match(new RegExp(`placeholder="输入张数" value="${quantity}"`, 'g'))).toHaveLength(1);
    expect(html).toContain('1–20 张，可直接输入');
    expect(html).toContain(`生成图片 · ${quantity} 张`);
    expect(html).toContain(`逐张生成 ${quantity} 张`);
    expect(html).not.toMatch(/role="combobox"[^>]*aria-label="图像生成数量"/);
  });
  it('新项目显示空态和真实描述，所有参数下拉为自定义控件，没有示例配色工具', () => {
    const html = renderToStaticMarkup(<ImageStudio {...props()} />);
    expect(html).toContain('从一个想法，开始第一张图片');
    expect(html).toContain('我的真实画面描述');
    expect(html).toContain('role="combobox"');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('示例草稿配色调整');
    expect(html).not.toContain('studio-art-layer');
    expect(html).not.toContain('studio-color-swatches');
    expect(preview).not.toHaveBeenCalled();
  });

  it('新文字报告不替代旧图片，图片仍可选且报告有独立入口', () => {
    const history = [run('image-run', artifact('real-image', 'image'), '2026-10-30T01:00:00Z'), run('review-run', artifact('review-report', 'text'), '2026-10-30T02:00:00Z')];
    const html = renderToStaticMarkup(<ImageStudio {...props(history)} />);
    expect(html).toContain('1 张真实图片');
    expect(html).toContain('选择图片 1：real-image.png');
    expect(html).toContain('查看项目文件');
    expect(html).toContain('导出图片');
    expect(html).not.toContain('review-report.txt');
    expect(html).not.toContain('确认交付当前版本');
    expect(html).not.toContain('编辑图片');
    expect(html).not.toContain('从一个想法，开始第一张图片');
    expect(preview).not.toHaveBeenCalled();
  });

  it('没有图片模型时提供可操作的配置入口，并把模型选择放在参考图之前', () => {
    const state = props(); state.configuration.models = [];
    const html = renderToStaticMarkup(<ImageStudio {...state} />);
    expect(html).toContain('配置图片模型');
    expect(html).toContain('已填写内容会保留');
    expect(html).toContain('aria-label="图片实际使用模型"');
    expect(html).toContain('aria-label="打开格式与属性"');
    expect(html).not.toContain('role="dialog"');
    const button = html.match(/<button[^>]*aria-label="配置图片模型"[^>]*>/)?.[0];
    expect(button).toBeDefined();
    expect(button).not.toContain('disabled');
    expect(preview).not.toHaveBeenCalled();
  });

  it('已有结果用同一工作台，收起面板仍保留唯一精修草稿和固定导出入口', () => {
    vi.stubGlobal('localStorage', { getItem: (key: string) => key.startsWith('xuzuo-studio-credential-v1:') ? null : JSON.stringify({ mode: 'refine', refinePrompt: '只清理边缘', editingModelId: 'editing-model' }) });
    const current = run('active-run', artifact('source-image', 'image'), '2026-10-30T01:00:00Z'); current.status = 'waiting-review';
    const html = renderToStaticMarkup(<ImageStudio {...props([current])} />);
    expect(html).toContain('修改');
    expect(html).toContain('导出图片');
    expect(html).not.toContain('simple-image-composer');
    expect(html).toContain('开始精修 · 1 张');
    expect(html.match(/id="image-prompt-image-project"/g)).toHaveLength(1);
    expect(html).toContain('class="sw-panel" hidden=""');
    expect(html).toContain('aria-label="工作台常用工具"');
    expect(preview).not.toHaveBeenCalled();
  });
  it('自定义用途在工作台可选，参考图不足时拦住生成并提供直接管理入口', () => {
    const state = props();
    const template = { id: 'custom-use', workspaceId: 'workspace', name: '三视图参考', prompt: '保留三个参考角度。', size: '1024x1024', background: 'auto' as const, minReferences: 3, enabled: true };
    state.configuration.useTemplates = [template];
    vi.stubGlobal('localStorage', { getItem: (key: string) => key.startsWith('xuzuo-studio-credential-v1:') ? null : JSON.stringify({ preset: template.id, presetSnapshot: template, prompt: '保留我编辑过的原文', generationModelId: 'generation-model' }) });
    const html = renderToStaticMarkup(<ImageStudio {...state} />);
    expect(html).toContain('三视图参考'); expect(html).toContain('打开格式与属性'); expect(html).not.toContain('role="dialog"');
    expect(html).toContain('此用途还需要 3 张参考图。');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?生成图片 · 1 张<\/button>/s);
    expect(html).toContain('保留我编辑过的原文'); expect(preview).not.toHaveBeenCalled();
  });
  it('已删除用途仍显示项目快照及原描述，不把用途ID当名称或丢掉项目内容', () => {
    const snapshot = { id: 'removed-use', name: '已存商品用途', prompt: '原用途示例', size: '1536x1024', background: 'transparent', minReferences: 0 };
    vi.stubGlobal('localStorage', { getItem: (key: string) => key.startsWith('xuzuo-studio-credential-v1:') ? null : JSON.stringify({ preset: snapshot.id, presetSnapshot: snapshot, prompt: '项目已修改的内容', generationModelId: 'generation-model' }) });
    const html = renderToStaticMarkup(<ImageStudio {...props()} />);
    expect(html).toContain('已存商品用途（已删除或停用）'); expect(html).toContain('项目已修改的内容');
    expect(html).toContain('当前项目的描述、设置和参考图仍保留');
    expect(html).not.toContain('value="原用途示例"'); expect(preview).not.toHaveBeenCalled();
  });
});


describe('精修参考不是生成成品', () => {
  it('尚无成品时把所选素材显示到画布，不冒充生成或交付结果', () => {
    const state = props();
    const html = renderToStaticMarkup(<ImageGallery images={[]} runner={state.workflowRunner} selectedId={undefined} onSelect={() => undefined} onRefine={() => undefined} onSave={() => undefined} saving={false} canRefine={false} reference={{ name: '所选素材.png', url: 'data:image/png;base64,fixture' }} />);
    expect(html).toContain('当前参考素材'); expect(html).toContain('尚未生成新结果'); expect(html).toContain('alt="所选素材.png"');
    expect(html).not.toContain('当前图片结果'); expect(html).not.toContain('开始第一张图片'); expect(html).not.toContain('编辑图片');
    expect(preview).not.toHaveBeenCalled();
  });
});
