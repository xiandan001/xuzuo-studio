import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PageProps } from '../types';
import { EditableDocumentStudio } from './EditableDocumentStudio';
import { SpreadsheetStudio } from './SpreadsheetStudio';
import { LocalRefinement } from './LocalRefinement';
import { DocumentIllustrationOptions } from './DocumentIllustrationOptions';
import { studioCredentialChoice, studioProjectCredential } from '../lib/studio-project-bindings';
import { documentStudioFormKey } from '../lib/document-studio-state';
import { spreadsheetFormKey } from '../lib/spreadsheet-ui';

function fixture(kind: 'word' | 'ppt' | 'excel', inspector = 'create') {
  const descriptors = ['window', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const values = new Map<string, string>(), start = vi.fn(), generate = vi.fn();
  const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage, desktop: { runtime: { start } } } });
  const project = { id: 'project', workspaceId: 'workspace', kind, name: '已确认事实', description: '保留已确认数字与名称', status: 'draft', costCents: 0, version: 0, updatedAt: '', accent: 'blue' };
  const model = { id: 'text-model', modelId: 'fixture-text', name: '本次文本模型', connectionId: 'connection', enabled: true, capabilities: ['text'], pricing: { unit: 'million-tokens', currency: 'CNY', input: '1', output: '1' } };
  const key = { id: 'current-key', connectionId: 'connection', name: '本次账户', enabled: true, lastFour: 'TEST' };
  const props = { activeProject: project, projects: [project], workspaceId: 'workspace', workspace: { id: 'workspace', name: '隔离工作区', directory: 'C:/owned' }, ledger: [], prompts: [], configuration: { models: [model], connections: [{ id: 'connection', enabled: true, protocol: 'openai-chat' }], credentials: [key], workflows: [], categories: [], studioActions: [] }, workflowRunner: { runtimeStatus: { available: true }, runs: [], ledger: [], trashedArtifacts: [] }, onGenerate: generate, notify: vi.fn(), navigate: vi.fn(), onUpdateProject: vi.fn() } as unknown as PageProps;
  if (inspector === 'refine') values.set(kind === 'excel' ? spreadsheetFormKey(project.id) : documentStudioFormKey(project.id), JSON.stringify({ version: 1, inspector, instruction: '保留金额，只修改措辞' }));
  return { props, start, generate, model, key, restore: () => { for (const [key, descriptor] of descriptors) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
}

describe('紧凑文档AI保留用户操作', () => {
  it.each(['word', 'ppt', 'excel'] as const)('%s retains input, directly selectable model, current account, template and one creation action without a request', kind => {
    const f = fixture(kind);
    try {
      const html = renderToStaticMarkup(kind === 'excel' ? <SpreadsheetStudio {...f.props} /> : <EditableDocumentStudio {...f.props} />);
      expect(html).toContain(kind === 'excel' ? '表格创作需求' : '文档创作需求'); expect(html).toContain(kind === 'excel' ? '表格实际模型' : '文档实际模型');
      expect(html).toContain('本次文本模型'); expect(html).toContain('本次账户'); expect(html).toContain('提示词模板'); expect(html).toContain('更多工具');
      expect(html.match(new RegExp('>' + (kind === 'excel' ? '生成表格' : '生成内容') + '</button>', 'g'))).toHaveLength(1);
      expect(html).not.toContain('AI 请求费用自动累计；撤销不会退回'); expect(f.start).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
    } finally { f.restore(); }
  });
  it.each(['word', 'ppt', 'excel'] as const)('%s restores refinement instruction and editable scope with one explicit refinement action and zero calls', kind => {
    const f = fixture(kind, 'refine');
    try {
      const html = renderToStaticMarkup(kind === 'excel' ? <SpreadsheetStudio {...f.props} /> : <EditableDocumentStudio {...f.props} />);
      expect(html).toContain(kind === 'excel' ? '表格修改指令' : '文档修改指令'); expect(html).toContain(kind === 'excel' ? '表格精修区域' : '文档精修范围');
      expect(html).toContain('保留金额，只修改措辞'); expect(html.match(/>精修所选范围<\/button>/g)).toHaveLength(1);
      expect(f.start).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
    } finally { f.restore(); }
  });
  it('compact refinement retains its explicit action and diff workflow entry without adding another account picker or making calls', () => {
    const f = fixture('word');
    try {
      const html = renderToStaticMarkup(<LocalRefinement compact props={f.props} targets={[{ id: 'paragraph', label: '当前段落', value: '保留金额100' }]} instruction="只改措辞" model={f.props.configuration.models[0]} preferredCredentialId="current-key" beforeRun={() => true} onApply={vi.fn()} />);
      expect(html).toContain('精修所选范围'); expect(html).toContain('先查看差异，再应用'); expect(html).not.toContain('局部精修凭证'); expect(f.start).not.toHaveBeenCalled();
    } finally { f.restore(); }
  });
  it('a disabled prior illustration account is not replaced silently, and the one remaining account can still be explicitly selected', () => {
    const f = fixture('word'), onCredential = vi.fn();
    try {
      const selected = studioProjectCredential(f.props.configuration.credentials, f.props.configuration.models[0], studioCredentialChoice('disabled-key', f.props.configuration.models[0])); expect(selected).toBeUndefined();
      const html = renderToStaticMarkup(<DocumentIllustrationOptions mode="generate" onMode={vi.fn()} images={[]} selectedIds={[]} onSelect={vi.fn()} modelId="text-model" models={f.props.configuration.models} onModel={vi.fn()} credentialId={selected || ''} credentials={f.props.configuration.credentials} onCredential={onCredential} count={1} onCount={vi.fn()} issue="请选择配图账户" />);
      expect(html).toContain('aria-label="文档配图凭证"'); expect(html).toContain('请选择此连接的 Key'); expect(html).not.toContain('select-value">本次账户'); expect(onCredential).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled();
    } finally { f.restore(); }
  });
});
