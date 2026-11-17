import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PerformanceSettings } from '../../src/components/PerformanceSettings';
import { DocumentArtifactPreview } from '../../src/components/DocumentArtifactPreview';
import { CommerceReflowDialog } from '../../src/components/CommerceReflowDialog';
import { CommerceLayerEditor } from '../../src/components/CommerceLayerEditor';
import { ProjectTemplateActions, ProjectTemplateDialog } from '../../src/components/ProjectTemplateActions';
import { setAppearanceMode } from '../../src/lib/appearance';
import { imageDraftKey } from '../../src/lib/image-studio';
import { INITIAL_PREFERENCES } from '../../src/data';
import type { PageProps, Project } from '../../src/types';
import type { ArtifactMetadata } from '../../src/live-types';
import type { EditorRecord } from '../../src/editor-types';
import type { CommerceImageScope, CommerceReflowResult } from '../../src/commerce-image-types';
import '../../src/styles.css';
import '../../src/theme.css';
import '../../src/appearance-palettes.css';
import '../../src/surface-depth.css';
import '../../src/next-interface.css';

interface Context { workspaceId: string; project: Project; source: ArtifactMetadata; scope: CommerceImageScope; revision: number; documents: Record<'word' | 'ppt', EditorRecord>; imageIds: Record<'word' | 'ppt', string>; ledger: PageProps['ledger']; configuration: PageProps['configuration']; }
const state = { read: () => ({}) as object };
Object.defineProperty(window, 'productionUsabilityFixture', { value: Object.freeze({ kind: 'isolated-production-usability', snapshot: () => state.read() }) });
function Fixture() {
  const [context, setContext] = useState<Context>(), [view, setView] = useState('performance'), [notice, setNotice] = useState(''), [unit, setUnit] = useState(''), [library, setLibrary] = useState(false), [result, setResult] = useState<CommerceReflowResult>(), [projects, setProjects] = useState<Project[]>([]), [target, setTarget] = useState<{ projectId: string; sourceArtifactId: string; documentId?: string }>();
  useEffect(() => { let active = true; void window.desktop!.runtime.status().then(value => { if (active) { const data = value as unknown as Context; setContext(data); setProjects([data.project]); setAppearanceMode('light'); } }); return () => { active = false; }; }, []);
  state.read = () => ({ view, unit, notice, projects, target, result, ledger: context?.ledger });
  if (!context) return <p role="status">正在准备隔离工程…</p>;
  const runner = { runs: [], inventoryRevision: result ? 1 : 0, listProjectArtifacts: (id: string) => window.desktop!.runtime.listProjectArtifacts!(id), previewArtifact: (id: string) => window.desktop!.runtime.previewArtifact(id), thumbnailArtifact: (id: string) => window.desktop!.runtime.thumbnailArtifact!(id) };
  const props = { workspaceId: context.workspaceId, workspace: { id: context.workspaceId, name: '独立验收' }, projects, activeProject: projects.find(project => project.id === target?.projectId) || context.project, configuration: context.configuration, preferences: INITIAL_PREFERENCES, ledger: context.ledger, workflowRunner: runner,
    notify: (message: string) => setNotice(message),
    onCreateProject: (_kind: string, options: { initial: { name: string }; onCreated: (project: Project) => void; onCancelled: (message: string) => void }) => { void window.desktop!.workspaceFiles.ensureProject({ workspaceId: context.workspaceId, name: options.initial.name } as never).then(value => { const project = value as unknown as Project; setProjects(current => [...current, project]); options.onCreated(project); }).catch(cause => options.onCancelled(String(cause))); },
    onUpdateProject: (id: string, patch: Partial<Project>) => setProjects(current => current.map(project => project.id === id ? { ...project, ...patch } : project)),
    navigate: (_page: string, projectId: string) => { const draft = JSON.parse(localStorage.getItem(imageDraftKey(projectId)) || '{}'); setTarget({ projectId, sourceArtifactId: draft.templateLayerSourceId, documentId: draft.templateLayerDocumentId }); setView('target'); },
  } as unknown as PageProps;
  const kind = view === 'ppt' ? 'ppt' : 'word', record = context.documents[kind];
  return <><header className="puf-header"><b>独立实际组件验收 · 无 Key</b><nav>{[['performance', '性能'], ['word', 'Word 预览'], ['ppt', 'PPT 预览'], ['reflow', '多比例排版'], ['templates', '项目模板']].map(([id, label]) => <button key={id} type="button" className="btn btn-secondary" onClick={() => setView(id)}>{label}</button>)}<button type="button" className="btn btn-secondary" onClick={() => setAppearanceMode('light')}>白天</button><button type="button" className="btn btn-secondary" onClick={() => setAppearanceMode('dark')}>黑夜</button></nav></header>
    <main className={`puf-main puf-${view}`}>{notice && <p className="puf-notice" role="status">{notice}</p>}{view === 'performance' ? <PerformanceSettings /> : view === 'word' || view === 'ppt' ? <><p className="puf-unit" data-selected-unit={unit}>点击插图只记录真实组件的单元回调：{unit || '尚未选择'}</p><DocumentArtifactPreview text={JSON.stringify(record.document)} title={record.document.title} hint={kind} imageContext={{ scope: `${context.workspaceId}/usability-${kind}/${record.revision}`, projectId: `usability-${kind}`, runner: runner as never, onEditUnit: setUnit }} /></> : view === 'reflow' ? <><p id="reflow-result" data-export-count={result?.variants.length || 0}>{result ? `已保存 ${result.variants.length} 版独立工程及成品` : '逐版确认后本地导出'}</p>{!result && <CommerceReflowDialog scope={context.scope} revision={context.revision} bridge={window.desktop!.commerceImages!} onClose={() => setView('templates')} onExport={setResult} />}</> : view === 'templates' ? <section className="puf-template-host"><h1>复用实际海报工程</h1><p>项目创建为受控目录 seam；模板保存、资产复制和新工程来自真实服务。</p><ProjectTemplateActions props={props} project={context.project} artifactId={context.source.id} /><button type="button" className="btn btn-primary" onClick={() => setLibrary(true)}>使用已保存模板</button></section> : target ? <CommerceLayerEditor props={props} {...target} /> : null}</main>
    {library && <ProjectTemplateDialog props={props} mode="library" onClose={() => setLibrary(false)} />}
  </>;
}
const style = document.createElement('style');
style.textContent = 'html,body,#root{height:100%;min-width:0;margin:0}#root{display:flex;flex-direction:column}.puf-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 18px;border-bottom:1px solid var(--ui-border);background:var(--ui-surface);flex-shrink:0}.puf-header>b{font-size:13px}.puf-header nav{display:flex;flex-wrap:wrap;gap:6px}.puf-header .btn{font-size:13px;padding:8px 10px}.puf-main{flex:1;min-height:0;min-width:0;overflow:auto;padding:20px 28px;background:var(--ui-bg);color:var(--ui-fg)}.puf-performance>section{max-width:1050px;margin:0 auto}.puf-notice,.puf-unit{padding:9px 14px;margin:0 0 14px;background:var(--ui-surface-subtle);border:1px solid var(--ui-border);border-radius:10px}.puf-template-host{max-width:900px;margin:auto}.puf-template-host>.btn{margin:12px 8px 0 0}.puf-target{padding:0;display:flex;flex-direction:column}.puf-target>.commerce-layer-editor{flex:1;min-height:0}.puf-target>.puf-notice{flex-shrink:0}.puf-word .dap-word{max-width:700px}.puf-ppt .dap-presentation{max-width:1000px;margin:auto}@media(max-width:1100px){.puf-header{flex-wrap:wrap}.puf-main{padding:16px}}';
document.head.append(style);
createRoot(document.getElementById('root')!).render(<Fixture />);
