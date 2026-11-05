import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageProps, Project } from '../types';
import { ImageStudio } from './ImageStudio';
const captured = vi.hoisted(() => ({ focus: false }));
vi.mock('../hooks/useStudioLayout', () => ({ useStudioLayout: () => ({ tool: 'ai', leftOpen: false, rightOpen: false, focus: captured.focus, narrow: false, toggleLeft: vi.fn(), toggleFocus: vi.fn(), openPanel: vi.fn(), togglePanel: vi.fn(), closePanel: vi.fn() }) }));
afterEach(() => { vi.unstubAllGlobals(); captured.focus = false; });
describe('统一图片工作台折叠与专注保留草稿', () => {
  it('左右关闭及专注时仍保留同一份创作输入，固定工具可达，不调用模型或预览', () => {
    vi.stubGlobal('window', { desktop: undefined });
    const project: Project = { id: 'folding-image', workspaceId: 'workspace', name: '图片项目', kind: 'image', status: 'draft', description: '保留未生成的描述', updatedAt: '', costCents: 17, version: 1, accent: 'purple' };
    const generate = vi.fn(), preview = vi.fn();
    const props = { activeProject: project, projects: [project], workspaceId: 'workspace', workspace: { id: 'workspace', name: '工作区' }, preferences: {}, ledger: [], prompts: [], configuration: { categories: [], workflows: [], studioActions: [], connections: [], models: [], credentials: [], useTemplates: [] }, workflowRunner: { runs: [], runtimeStatus: { available: false }, trashedArtifacts: [], previewArtifact: preview }, onGenerate: generate, onPromptApplied: () => undefined, notify: () => undefined } as unknown as PageProps;
    for (const focused of [false, true]) {
      captured.focus = focused; const html = renderToStaticMarkup(<ImageStudio {...props} />);
      expect(html).toContain('aria-label="工作台常用工具"'); expect(html).toContain('aria-label="展开图片结果"'); expect(html).toContain('aria-label="打开 AI 创作与修改"');
      expect(html).toContain('class="sw-navigation" hidden=""'); expect(html).toContain('class="sw-panel" hidden=""');
      expect(html).toContain('保留未生成的描述'); expect(html.match(/id="image-prompt-folding-image"/g)).toHaveLength(1);
      expect(html).not.toContain('professional-workbench'); expect(html).not.toContain('simple-image-composer');
      expect(html).toContain('生成设置'); expect(html).toContain('更多工具'); expect(html).toContain('aria-label="新增工作台功能"');
    }
    expect(generate).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled(); expect(project.costCents).toBe(17);
  });
});
