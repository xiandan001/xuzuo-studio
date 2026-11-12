import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectHub } from '../../src/pages/ProjectHub';
import { Projects } from '../../src/pages/Projects';
import { EditableDocumentStudio } from '../../src/components/EditableDocumentStudio';
import { FeedbackPanel } from '../../src/components/business/FeedbackPanel';
import { HomeBusinessTodos } from '../../src/components/HomeBusinessTodos';
import { artifact, order, seeded, time } from '../../src/pages/business-studio-demo-data';
import { checkedBusinessState } from '../../src/lib/business-data';
import type { PageProps, Project, ViewId } from '../../src/types';
import type { BusinessBridge, BusinessState } from '../../src/business-types';
import type { EditorRecord } from '../../src/editor-types';
import type { ArtifactMetadata } from '../../src/live-types';
import '../../src/styles.css';
import '../../src/theme.css';
import '../../src/appearance-palettes.css';
import '../../src/surface-depth.css';
import '../../src/next-interface.css';

// Real production UI components; Native bridge responses are isolated examples.
// This validates DOM interactions only. Native Office bytes/adoption are covered separately.
const workspaceId = 'project-flow-browser-example', projectId = 'project-revision';
document.documentElement.dataset.appTheme = 'light';
document.documentElement.dataset.appPalette = 'violet';
const original = artifact('original-office', projectId, { name: '合作说明-原版.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', runId: `editor-${projectId}-2` });
const source: EditorRecord = { version: 1, projectId, revision: 2, savedAt: time, sourceArtifactIds: [], document: { schemaVersion: 1, kind: 'word', title: '合作说明', blocks: [{ id: 'price-paragraph', type: 'paragraph', text: '已确认价格为129元，其他产品参数保持不变。', fontSize: 12, bold: false, italic: false, align: 'left' }] } };
let record = structuredClone(source);
const files: ArtifactMetadata[] = [original], versions = new Map([[2, structuredClone(source)]]);
const productionOrder = order('revision-order', 'documents', { name: '山野合作说明返修', sourceProjectId: projectId, projectIds: [projectId], outputIds: [original.id], status: 'review', factsConfirmedAt: time });
let state: BusinessState = { ...seeded(workspaceId, [productionOrder]), feedback: [{ id: 'revision-feedback', orderId: productionOrder.id, round: 1, target: { projectId, artifactId: original.id, blockId: 'price-paragraph', selectedText: '129元' }, sourceSha256: 'a'.repeat(64), sourceRevision: 2, text: '价格调整为139元，保留其他参数。', tasks: ['将129元修改为139元，保留其他文字。'], status: 'approved', runIds: [], createdAt: time, updatedAt: time }] };
const calls = { exports: 0, adoptRevision: [] as unknown[], routes: [] as string[], provider: 0, snapshots: 0, inventories: [] as string[], artifactPreviews: 0 };
const listeners = new Set<(value: { workspaceId: string; revision: number }) => void>();
const copy = <T,>(value: T): T => structuredClone(value);
const notifyState = () => { for (const listener of listeners) listener({ workspaceId, revision: state.revision }); };
function inspect(id: string) {
  const file = files.find(item => item.id === id); if (!file) throw Error('示例原文件不存在');
  const binding = id === original.id ? source : versions.get(Number(file.runId?.split('-').at(-1)))!;
  return { artifact: copy(file), sha256: id === original.id ? 'a'.repeat(64) : 'b'.repeat(64), documentSource: JSON.stringify(binding.document), sourceRevision: binding.revision };
}
const business: BusinessBridge = {
  snapshot: async id => { if (id !== workspaceId) throw Error('隔离工作区不匹配'); calls.snapshots++; return copy(state); },
  save: async input => { if (input.expectedRevision !== state.revision) throw Error('BUSINESS_CONFLICT'); state = { ...checkedBusinessState(copy(input.state), workspaceId), revision: state.revision + 1 }; notifyState(); return copy(state); },
  onChanged: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  adoptRevision: async input => {
    if (input.sourceArtifactId !== original.id || input.sourceSha256 !== 'a'.repeat(64) || input.sourceRevision !== 2 || input.exportRevision !== record.revision || !record.sourceArtifactIds.includes(original.id) || !input.artifactIds.every(id => files.some(file => file.id === id && file.runId === `editor-${projectId}-${record.revision}`))) throw Error('示例采用版本与真实UI导出版本不匹配');
    calls.adoptRevision.push(copy(input));
    state = { ...state, revision: state.revision + 1, orders: state.orders.map(row => row.id === productionOrder.id ? { ...row, outputIds: input.artifactIds } : row), feedback: state.feedback.map(row => row.id === input.feedbackId ? { ...row, status: 'confirmed' as const } : row) }; notifyState(); return { state: copy(state), projects: [] };
  },
  exportRecovery: async () => ({ saved: false }),
} as BusinessBridge;
Object.defineProperty(window, 'desktop', { configurable: true, value: {
  business,
  chat: {
    selectTarget: async (input: { projectId: string; artifactId: string; kind: 'word' }) => { const inspection = inspect(input.artifactId); return { target: { ...input, sha256: inspection.sha256, editorRevision: inspection.sourceRevision }, inspection }; },
    inspectTarget: async (input: { target: { artifactId: string; sha256: string } }) => { const inspection = inspect(input.target.artifactId); if (inspection.sha256 !== input.target.sha256) throw Error('示例SHA不匹配'); return inspection; },
  },
  editor: {
    load: async () => copy(record), loadVersion: async (input: { revision: number }) => copy(versions.get(input.revision)), history: async () => [...versions.values()].map(row => ({ revision: row.revision, savedAt: row.savedAt, title: row.document.title, kind: 'word' })),
    save: async (input: Pick<EditorRecord, 'document' | 'sourceArtifactIds'> & { expectedRevision: number }) => { if (input.expectedRevision !== record.revision) throw Error('EDITOR_CONFLICT'); record = { ...record, document: copy(input.document), sourceArtifactIds: [...input.sourceArtifactIds], revision: record.revision + 1, savedAt: new Date().toISOString() }; versions.set(record.revision, copy(record)); return copy(record); },
    export: async (input: Pick<EditorRecord, 'document' | 'sourceArtifactIds'> & { expectedRevision: number }) => {
      if (input.expectedRevision !== record.revision) throw Error('EDITOR_CONFLICT');
      record = { ...record, document: copy(input.document), sourceArtifactIds: [...input.sourceArtifactIds], revision: record.revision + 1, savedAt: new Date().toISOString() }; versions.set(record.revision, copy(record));
      const exported = { ...original, id: `export-${record.revision}`, name: `合作说明-修订-v${record.revision}.docx`, runId: `editor-${projectId}-${record.revision}`, createdAt: record.savedAt }; files.push(exported); calls.exports++; return { record: copy(record), artifacts: [copy(exported)] };
    },
  },
} });
Object.defineProperty(window, 'projectFlowBrowserFixture', { value: Object.freeze({ kind: 'isolated-project-flow-example', snapshot: () => copy({ state, record, files, calls }), browserState: () => localStorage.getItem(`xuzuo-project-browser-v1:${workspaceId}`) }) });
const primary: Project = { id: projectId, workspaceId, kind: 'word', name: '合作说明返修验收', description: '原版、编辑稿与采用成品分开；无Key交互验收。', status: 'review', version: 2, costCents: 0, updatedAt: time, accent: 'blue' };
const projectRows: Project[] = Array.from({ length: 20 }, (_, index) => index === 12 ? primary : { ...primary, id: `filler-${index}`, name: `其他示例项目 ${index + 1}` });
function Fixture() {
  const [view, setView] = useState<ViewId>('projects'), [selectedId, setSelectedId] = useState(projectId), [projects, setProjects] = useState(projectRows), [message, setMessage] = useState(''), [dark, setDark] = useState(false), [, rerender] = useState(0);
  const navigate = (next: ViewId, id?: string) => { calls.routes.push(next); setView(next); if (id) setSelectedId(id); document.querySelector('.app-content')?.scrollTo({ top: 0 }); };
  const activeProject = projects.find(row => row.id === selectedId) || primary;
  const workspace = { id: workspaceId, name: '独立返修验收', directory: 'isolated-example', createdAt: time };
  const props = {
    workspaceId, workspace, workspaces: [workspace], projects, trashedProjects: [], activeProject, ledger: [], prompts: [], preferences: { hourlyRate: 50 },
    configuration: { models: [], credentials: [], connections: [], workflows: [], categories: [], studioActions: [], useTemplates: [] },
    navigate, notify: (text: string) => setMessage(text), onOpenBusiness: () => navigate('business', projectId), onCreateProject: () => setMessage('验收不创建真实项目目录'), onUpdateProject: (id: string, patch: Partial<Project>) => setProjects(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row)),
    onSavePrompt: () => {}, onUsePrompt: () => {}, onExport: () => { throw Error('不得回退为浏览器假导出'); },
    workflowRunner: { runs: [], trashedArtifacts: [], inventoryRevision: calls.exports, listProjectArtifacts: async (id: string) => { calls.inventories.push(id); return copy(files.filter(file => file.projectId === id)); }, previewArtifact: async (id: string) => { calls.artifactPreviews++; return { ...inspect(id), text: inspect(id).documentSource }; }, saveArtifact: async () => ({ saved: false }), listTrashedArtifacts: async () => [], importFiles: async () => [] },
  } as unknown as PageProps;
  const commit = async (transform: (value: BusinessState) => BusinessState) => { state = { ...checkedBusinessState(transform(copy(state)), workspaceId), revision: state.revision + 1 }; notifyState(); rerender(value => value + 1); return copy(state); };
  return <><header className="fixture-bar"><strong>隔离UI示例 · 无Key、无模型、无真实Office磁盘写入</strong><div><button className="btn btn-secondary" onClick={() => navigate('overview')}>查看首页待办</button><button className="btn btn-secondary" onClick={() => navigate('projects')}>返回项目列表</button><button className="btn btn-secondary" onClick={() => { document.documentElement.dataset.appTheme = dark ? 'light' : 'dark'; setDark(!dark); }}>{dark ? '切到白天' : '切到黑夜'}</button></div></header><main className="app-content fixture-content">{message && <p className="fixture-message" role="status">{message}</p>}{view === 'overview' ? <section className="fixture-order"><h1>首页待办组件验收</h1><HomeBusinessTodos props={props} /></section> : view === 'projects' ? <Projects {...props} /> : view === 'project' ? <ProjectHub {...props} /> : view === 'documents' ? <EditableDocumentStudio {...props} /> : <section className="fixture-order"><h1>山野合作说明返修</h1><button className="btn btn-secondary" onClick={() => navigate('project', projectId)}>返回项目概览</button><FeedbackPanel props={props} state={state} order={state.orders[0]} files={files} commit={commit} onRefresh={async () => rerender(value => value + 1)} onImageEdit={() => { throw Error('本场景不编辑图片'); }} /></section>}</main></>;
}
const style = document.createElement('style'); style.textContent = 'html,body,#root{height:100%;margin:0;min-width:0}#root{display:flex;flex-direction:column}body{background:var(--ui-bg);color:var(--ui-fg)}.fixture-bar{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:12px 24px;border-bottom:1px solid var(--ui-border);background:var(--ui-surface);flex-shrink:0}.fixture-bar>div{display:flex;gap:10px}.fixture-content{flex:1;min-height:0;overflow:auto;padding:0}.fixture-message{padding:10px 24px;margin:0;background:var(--ui-info-bg)}.fixture-order{padding:24px 32px}.fixture-order>.bs-panel{margin-top:20px}'; document.head.append(style);
createRoot(document.getElementById('root')!).render(<Fixture />);
