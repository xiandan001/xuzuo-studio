import { moveProjectWithDraft } from './lib/project-move';
import { ModalPortal } from './components/ModalPortal';
import { hasManagedDialog } from './lib/dialog-stack';
import { flushSync } from 'react-dom';
import { ApplicationClosing } from './components/ApplicationClosing';
import type { SearchTarget } from './lib/global-search';
import { flushEditorRecovery, guardedEditorSessions, registerEditorSession } from './lib/editor-session-guard';
import { useEditorTransitions } from './hooks/useEditorTransitions';
import { APP_VERSION } from './lib/app-version';
import { StorageRecoveryPage, StorageRecoveryBanner } from './components/StorageRecovery';
import { readWorkspaceState, writeWorkspaceState, resetWorkspaceState } from './lib/workspace-persistence';
import { useAppearance } from './hooks/useAppearance';
import { useAutomationContext } from './hooks/useAutomationCenter';
import { AutomationAttention } from './components/AutomationAttention';
import { AppNavigation } from './components/AppNavigation';
import { AppHeaderActions } from './components/AppHeaderActions';
import { APP_NAVIGATION, appViewLabel, navigationTaskSummary } from './lib/navigation-catalog';
import './focused-shell.css';
import { creationPrompt } from './lib/creation-quality';
import { CREATION_PROFILES } from './lib/creation-profiles';
import { quickImageWorkflowBudget, quickImageWorkflowSteps, quickImageWorkflowTail, quickWorkflowTail } from './lib/quick-workflow';
import { illustratedDocumentSteps } from './lib/document-illustrations';
import { assetApplicationTarget, assertAssetImage } from './lib/asset-application';
import { studioCredential, studioModel } from './lib/studio-run';
import { useWorkspaceFiles } from './hooks/useWorkspaceFiles';
import { useProjectPurge } from './hooks/useProjectPurge';
import { useWorkspaceProjection } from './hooks/useWorkspaceProjection';
import { clearPurgedProjectsDrafts } from './lib/project-purge';
import { WorkspaceFolderBar } from './components/WorkspaceFolderBar';
import { NewProjectDialog } from './components/NewProjectDialog';
import { ProjectCreationRecovery } from './components/ProjectCreationRecovery';
import { WorkspaceCreateDialog } from './components/WorkspaceCreateDialog';
import { recoverProjectDraft } from './lib/project-recovery';
import { liveProjectStateSignature } from './lib/project-status';
import { isProductionRun } from './lib/workflow-purpose';
import type { DeliveryReceipt, DeliverySelection } from './delivery-types';
import type { RecoveryProjectFields } from './lib/project-recovery';
import { isWorkspaceConnectionError } from './components/WorkspaceConnectionRecovery';
import type { NewProjectDraft } from './components/NewProjectDialog';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, Check, ChevronRight, CircleHelp, FileText, LoaderCircle, Maximize2, Minus, Settings as SettingsIcon, ShieldCheck, Sparkles, Wallet, X } from 'lucide-react';
import { AppMark, Brand } from './components/Brand';
import { CostTotal } from './components/CostAmount';
import { costSummaryPrimary, costSummarySecondary, summarizeCosts } from './lib/cost-display';
import { ArtifactResults, latestProjectArtifacts } from './components/ArtifactResults';
import { EmptyWorkspace, WorkspaceSwitcher } from './components/WorkspaceSwitcher';
import { useWindowActivity } from './hooks/useWindowActivity';
import { ManagementNavigation } from './components/ManagementNavigation';
import { PreparingGeneration } from './components/PreparingGeneration';
import { isSelectInteraction } from './components/Select';
import { useStudioConfiguration } from './hooks/useStudioConfiguration';
import { useDataManagement } from './hooks/useDataManagement';
import { useWorkflowRunner } from './hooks/useWorkflowRunner';
import { activeRun } from './lib/workflows';
import { belongsToCategory } from './lib/configuration';
import { projectImageContent } from './lib/image-studio';
import type { GenerationIntent, WorkflowDraft, WorkflowRunner, WorkflowStep, StorageIssue } from './configuration-types';
import { BUILTIN_PROMPTS } from './prompt-data';
import { demoCost, INITIAL_PREFERENCES, INITIAL_PROJECTS, KIND_LABEL, money, budgetLabel, parseOptionalBudget } from './data';
import { downloadFile } from './lib/files';
import type { ArtifactMetadata } from './live-types';
import { blocksProjectTrash, mergePurgedProjectAudits, moveProjectWorkspace, projectPurgeError, projectTrashError, restoreProjectState, trashProjectState, visibleWorkspaces, workspaceRemoveError, removeWorkspaceState, restoreWorkspaceState } from './lib/workspace-state';
import type { WorkspaceState } from './lib/workspace-state';
import type { LedgerEntry, PageProps, Preferences, Project, ProjectKind, AssetApplication, PromptApplication, PromptDraft, PromptTemplate, ViewId } from './types';

const StudioRunDialog = lazy(() => import('./components/StudioRunDialog').then(module => ({ default: module.StudioRunDialog })));
const StudioRunStatus = lazy(() => import('./components/StudioRunStatus').then(module => ({ default: module.StudioRunStatus })));
const Workflows = lazy(() => import('./pages/Workflows').then(module => ({ default: module.Workflows })));
const Overview = lazy(() => import('./pages/Overview').then(module => ({ default: module.Overview })));
const DocumentStudio = lazy(() => import('./pages/DocumentStudio').then(module => ({ default: module.DocumentStudio })));
const ImageStudio = lazy(() => import('./pages/ImageStudio').then(module => ({ default: module.ImageStudio })));
const Projects = lazy(() => import('./pages/Projects').then(module => ({ default: module.Projects })));
const Assets = lazy(() => import('./pages/Assets').then(module => ({ default: module.Assets })));
const Activity = lazy(() => import('./pages/Activity').then(module => ({ default: module.Activity })));
const Finance = lazy(() => import('./pages/Finance').then(module => ({ default: module.Finance })));
const Settings = lazy(() => import('./pages/Settings').then(module => ({ default: module.Settings })));
const Prompts = lazy(() => import('./pages/Prompts').then(module => ({ default: module.Prompts })));
const Categories = lazy(() => import('./pages/Categories').then(module => ({ default: module.Categories })));
const Models = lazy(() => import('./pages/Models').then(module => ({ default: module.Models })));
const AutomationCenter = lazy(() => import('./pages/AutomationCenter').then(module => ({ default: module.AutomationCenter })));
const ToolsHub = lazy(() => import('./pages/ToolsHub').then(module => ({ default: module.ToolsHub })));
const GlobalSearch = lazy(() => import('./components/GlobalSearch').then(module => ({ default: module.GlobalSearch })));

const NAVIGATION = APP_NAVIGATION;
function nowLabel() { return `今天 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`; }
function documentDraft(projectId: string) {
  try { return JSON.parse(localStorage.getItem(`xuzuo.document.${projectId}`) || 'null') as unknown; }
  catch { return null; }
}
type PromptIntent = { template: PromptTemplate; content: string };
type ProjectStartOptions = NonNullable<Parameters<PageProps['onCreateProject']>[1]>;
type ProjectConnectionRecovery = { workspaceId: string; directory: string; message: string; connected: boolean; action: 'new' | 'change' | 'commit'; kind: ProjectKind; promptIntent?: PromptIntent; selectionId?: string; draft?: RecoveryProjectFields };
const projectCreationError = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : fallback;

export default function App() {
  const { layout, resolved, palette } = useAppearance();
  useWindowActivity();
  useEffect(() => {
    const dialogs = (window.desktop as typeof window.desktop & { fileDialogs?: { setAppearance: (appearance: { mode: 'light' | 'dark'; palette: string }) => Promise<void> } })?.fileDialogs;
    if (dialogs?.setAppearance) void Promise.resolve(dialogs.setAppearance({ mode: resolved, palette })).catch(() => undefined);
  }, [resolved, palette]);
  const [closingStatus, setClosingStatus] = useState<{ phase: string; message?: string }>();
  useEffect(() => { const desktop = window.desktop; const removeCheck = desktop?.onCloseStateRequested?.(() => { flushSync(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }); let saved = true; flushSync(() => { saved = flushEditorRecovery(); }); return { blocked: !saved || creatingProjectRef.current || guardedEditorSessions().length > 0 }; }); const removeStatus = desktop?.onClosingStatus?.(state => setClosingStatus(state.phase === 'cancelled' ? undefined : state)); return () => { removeCheck?.(); removeStatus?.(); }; }, []);
  const { confirmTransition, transitionDialog } = useEditorTransitions();
  const [loadedWorkspace, setLoadedWorkspace] = useState(() => readWorkspaceState(() => localStorage));
  const initial = loadedWorkspace.state;
  const [workspaceStorageIssue, setWorkspaceStorageIssue] = useState<StorageIssue | undefined>(loadedWorkspace.issue);
  const [allProjects, setProjects] = useState(initial.projects);
  const [allLedger, setLedger] = useState(initial.ledger);
  const [workspaces, setWorkspaces] = useState(initial.workspaces);
  const visibleWorkspaceList = useMemo(() => visibleWorkspaces(workspaces), [workspaces]);
  const [workspaceId, setWorkspaceId] = useState(initial.activeWorkspaceId);
  const [preferencesByWorkspace, setPreferencesByWorkspace] = useState(initial.preferencesByWorkspace);
  const [customPrompts, setCustomPrompts] = useState(initial.customPrompts);
  const workspaceStateRef = useRef<WorkspaceState>(initial);
  workspaceStateRef.current = { projects: allProjects, ledger: allLedger, workspaces, activeWorkspaceId: workspaceId, preferencesByWorkspace, customPrompts };
  const [promptToApply, setPromptToApply] = useState<PromptApplication>();
  const [assetToApply, setAssetToApply] = useState<AssetApplication>();
  const assetApplicationRequest = useRef(0);
  const [generationIntent, setGenerationIntent] = useState<GenerationIntent>();
  const [automationIntent, setAutomationIntent] = useState<import('./automation-types').AutomationIntent>();
  const workspace = workspaces.find(item => item.id === workspaceId)!;
  const preferences = preferencesByWorkspace[workspaceId] || { ...INITIAL_PREFERENCES, studioName: workspace.name };
  const { projects, trashedProjects, ledger } = useWorkspaceProjection(allProjects, allLedger, workspaceId);
  const purgedProjects = useMemo(() => allProjects.filter(project => project.workspaceId === workspaceId && project.purgedAt), [allProjects, workspaceId]);
  const prompts = useMemo(() => [...BUILTIN_PROMPTS, ...customPrompts.filter(item => item.workspaceId === workspaceId)], [customPrompts, workspaceId]);
  const [view, setView] = useState<ViewId>('overview');
  const [activeId, setActiveId] = useState(workspace.lastProjectId || projects[0]?.id || '');
  const selectedProject = projects.find(item => item.id === activeId);
  const studioProject = view === 'documents' && selectedProject?.kind === 'image' ? projects.find(item => item.kind !== 'image') : view === 'images' && selectedProject?.kind !== 'image' ? projects.find(item => item.kind === 'image') : selectedProject;
  const activeProject = studioProject || selectedProject || projects[0] || { ...INITIAL_PROJECTS[0], id: '', workspaceId, name: '', costCents: 0, version: 0 };
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);
  const [newProject, setNewProject] = useState<NewProjectDraft | null>(null);
  const newProjectRef = useRef(newProject); newProjectRef.current = newProject;
  const projectCreationCompletion = useRef<{ workspaceId: string; onCreated?: (project: Project) => void; onCancelled?: (error?: string) => void } | undefined>(undefined);
  useEffect(() => { if (projectCreationCompletion.current?.workspaceId !== workspaceId) projectCreationCompletion.current = undefined; }, [workspaceId]);
  const [projectFolderUnavailable, setProjectFolderUnavailable] = useState(false);
  const [projectConnectionRecovery, setProjectConnectionRecovery] = useState<ProjectConnectionRecovery>();
  const [creatingRecoveryWorkspace, setCreatingRecoveryWorkspace] = useState(false);
  const projectConnectionRecoveryRef = useRef(projectConnectionRecovery); projectConnectionRecoveryRef.current = projectConnectionRecovery;
  const [selectingProjectFolder, setSelectingProjectFolder] = useState(false);
  const selectingProjectFolderRef = useRef(false), projectDraftEpoch = useRef(0);
  const [formError, setFormError] = useState('');
  const [exportId, setExportId] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [projectRecordStatus, setProjectRecordStatus] = useState('');
  const [savingProjectRecord, setSavingProjectRecord] = useState(false);
  const projectRecordPending = useRef(false);
  const [manualArtifacts, setManualArtifacts] = useState<Record<string, ArtifactMetadata[]>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const showSearch = () => setSearchOpen(true);
  const [searchTarget, setSearchTarget] = useState<SearchTarget>();
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pendingGeneration, setPendingGeneration] = useState<{ projectId: string; action: LedgerEntry['action']; count: number; onStarted?: () => void } | null>(null);
  const [taskProgress, setTaskProgress] = useState<Record<string, number>>({});
  const jobs = useRef(new Map<string, { timer: ReturnType<typeof setInterval>; ledgerId: string; progress: number }>());
  const pendingProjectTrash = useRef(new Set<string>());
  useEffect(() => registerEditorSession({ id: 'project-metadata-actions', projectId: '', label: '正在整理项目资料', getState: () => ({ dirty: false, pending: pendingProjectTrash.current.size > 0 }), save: async () => false, exportRecovery: () => false }), []);
  const projectsRef = useRef(allProjects);
  const workspaceIdRef = useRef(workspaceId);
  const workflowRunnerRef = useRef<WorkflowRunner | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  projectsRef.current = allProjects;
  workspaceIdRef.current = workspaceId;

  useEffect(() => {
    if (workspaceStorageIssue) return;
    const issue = writeWorkspaceState(() => localStorage, workspaceStateRef.current);
    if (issue) setWorkspaceStorageIssue(issue);
  }, [allProjects, allLedger, workspaces, workspaceId, preferencesByWorkspace, customPrompts, workspaceStorageIssue]);
  useEffect(() => { document.documentElement.dataset.reduceMotion = String(preferences.reduceMotion); }, [preferences.reduceMotion]);
  useEffect(() => () => { jobs.current.forEach(job => clearInterval(job.timer)); clearTimeout(toastTimer.current); }, []);

  const notify = useCallback((message: string, type: 'success' | 'info' | 'error' = 'success') => {
    clearTimeout(toastTimer.current); setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3800);
  }, []);
  const configuration = useStudioConfiguration(workspaceId, notify);
  useAutomationContext({ workspaceId, workspaces, projects: allProjects, workflows: configuration.workflows, models: configuration.models, connections: configuration.connections });
  const dataManagement = useDataManagement({ workspaceId, state: workspaceStateRef, configuration, storageIssue: workspaceStorageIssue, notify, applyState: next => {
    workspaceStateRef.current = next; setProjects(next.projects); setLedger(next.ledger); setWorkspaces(next.workspaces); setPreferencesByWorkspace(next.preferencesByWorkspace); setCustomPrompts(next.customPrompts);
  } });
  const workflowRunner = useWorkflowRunner({ workspaceId, activeProjectId: activeId, runDetailProjectId: ['documents', 'images'].includes(view) ? activeProject.id || undefined : undefined, projects: allProjects, ledger: allLedger, configuration, setProjects, setLedger, isOtherTaskRunning: id => jobs.current.has(id) || pendingProjectTrash.current.has(id), notify });
  workflowRunnerRef.current = workflowRunner;
  const clearedPurgedDrafts = useRef(new Set<string>());
  const applyProjectPurgeAudits = useCallback((audits: Project[]) => {
    const removed = new Set(audits.map(project => project.id));
    setProjects(current => mergePurgedProjectAudits(current, audits));
    setWorkspaces(current => current.some(item => item.lastProjectId && removed.has(item.lastProjectId)) ? current.map(item => item.lastProjectId && removed.has(item.lastProjectId) ? { ...item, lastProjectId: undefined } : item) : current);
    setActiveId(current => removed.has(current) ? '' : current);
    setExportId(current => current && removed.has(current) ? null : current);
    setManualArtifacts(current => Object.keys(current).some(id => removed.has(id)) ? Object.fromEntries(Object.entries(current).filter(([id]) => !removed.has(id))) : current);
    setGenerationIntent(current => current && removed.has(current.projectId) ? undefined : current);
    setAutomationIntent(current => current && removed.has(current.projectId) ? undefined : current);
    setAssetToApply(current => current && removed.has(current.projectId) ? undefined : current);
    setPromptToApply(current => current && removed.has(current.projectId) ? undefined : current);
    setPendingGeneration(current => current && removed.has(current.projectId) ? null : current);
    const pendingDrafts = audits.filter(project => !clearedPurgedDrafts.current.has(project.id));
    let cleared = false;
    try { cleared = clearPurgedProjectsDrafts(localStorage, pendingDrafts); } catch { /* Local storage access may be unavailable after Native removal. */ }
    if (cleared) pendingDrafts.forEach(project => clearedPurgedDrafts.current.add(project.id));
    if (!cleared) notify('项目已永久移除，但部分浏览器草稿暂未清理成功；重新进入应用后会继续核对。历史费用保留。', 'info');
  }, [notify]);
  const projectPurge = useProjectPurge({ workspaceId, onAudits: applyProjectPurgeAudits, assertReady: (ids, source, retry) => {
    if (source !== workspaceIdRef.current) throw Error('工作区已切换，请重新选择当前工作区的项目。');
    const busyIds = new Set([...jobs.current.keys(), ...pendingProjectTrash.current, ...(workflowRunnerRef.current?.runs || []).filter(blocksProjectTrash).map(run => run.projectId)]);
    for (const session of guardedEditorSessions({ includeDirty: true })) if (session.projectId) busyIds.add(session.projectId);
    if (exportBusy && exportId) busyIds.add(exportId);
    for (const id of ids) {
      const project = projectsRef.current.find(item => item.id === id);
      const error = projectPurgeError(project, source, busyIds);
      if (error) throw Error(error);
      if (project?.purgedAt && !retry) throw Error('项目已经永久移除，请在“清理未完成”中继续处理原请求。');
    }
  } });
  const rememberProject = useCallback((id: string, targetWorkspaceId: string) => {
    setActiveId(id);
    setWorkspaces(items => items.some(item => item.id === targetWorkspaceId && item.lastProjectId !== (id || undefined)) ? items.map(item => item.id === targetWorkspaceId ? { ...item, lastProjectId: id || undefined } : item) : items);
  }, []);
  const navigateNow = useCallback((next: ViewId, projectId?: string) => {
    assetApplicationRequest.current++; setAssetToApply(undefined); setSearchTarget(undefined); setAutomationIntent(undefined);
    const candidates = projectsRef.current.filter(item => item.workspaceId === workspaceId && !item.trashedAt);
    if (projectId && projectsRef.current.some(item => item.id === projectId && item.workspaceId === workspaceId && item.purgedAt)) {
      setView(next === 'finance' || next === 'activity' ? next : 'projects'); setSearchOpen(false); setNotificationOpen(false); setPendingGeneration(null); setGenerationIntent(undefined);
      notify('这个项目已永久移除，不能再恢复或编辑；历史费用与调用记录仍保留。', 'info'); return;
    }
    if (projectId && projectsRef.current.some(item => item.id === projectId && item.workspaceId === workspaceId && item.trashedAt)) {
      setView('projects'); setSearchOpen(false); setNotificationOpen(false); setPendingGeneration(null); setGenerationIntent(undefined);
      notify('这个项目已在回收站中，请先在“我的项目 → 回收站”恢复。', 'info'); return;
    }
    let selected = candidates.find(item => item.id === (projectId || activeId));
    if (!projectId && next === 'images' && selected?.kind !== 'image') selected = candidates.find(item => item.kind === 'image');
    if (!projectId && next === 'documents' && selected?.kind === 'image') selected = candidates.find(item => item.kind !== 'image');
    rememberProject(selected?.id || candidates[0]?.id || '', workspaceId);
    setView(next); setSearchOpen(false); setNotificationOpen(false); setPendingGeneration(null); setPromptToApply(undefined); setGenerationIntent(undefined);
    document.querySelector('.app-content')?.scrollTo({ top: 0 });
  }, [activeId, workspaceId, rememberProject, notify]);

  useEffect(() => { setAssetToApply(current => current && (current.workspaceId !== workspaceId || current.projectId !== activeId || !['documents', 'images'].includes(view)) ? undefined : current); }, [workspaceId, activeId, view]);

  const navigate = useCallback((next: ViewId, projectId?: string) => { setSearchOpen(false); setNotificationOpen(false); void confirmTransition().then(allowed => { if (allowed) navigateNow(next, projectId); }); }, [confirmTransition, navigateNow]);
  const onAutomateWorkflow = (workflowId: string) => {
    const workflow = configuration.workflows.find(workflow => workflow.id === workflowId), source = workspaceIdRef.current;
    if (!workflow) return;
    const project = projects.find(project => project.id === activeId && project.kind === workflow.outputKind) || projects.find(project => project.kind === workflow.outputKind);
    if (!project) { notify('请先创建同类型项目，再为此流程配置自动化。', 'info'); return; }
    void confirmTransition().then(allowed => { if (allowed && source === workspaceIdRef.current) { navigateNow('automation', project.id); setAutomationIntent({ token: crypto.randomUUID(), workspaceId: source, projectId: project.id, workflowId, input: project.description }); } });
  };
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (guardedEditorSessions().length) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (hasManagedDialog() && event.key === 'Escape') return;
      if (document.querySelector('[data-application-closing], [data-editor-transition]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && document.querySelector('[role=dialog][aria-modal=true]:not(.command-palette)')) { event.preventDefault(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (document.querySelector('.command-palette')) setSearchOpen(false); else showSearch(); }
      if (event.key === 'Escape' && !isSelectInteraction(event) && document.querySelector('.preparing-generation')) setGenerationIntent(undefined);
      if (event.key === 'Escape' && !isSelectInteraction(event)) { setSearchOpen(false); if (!creatingProjectRef.current && !selectingProjectFolderRef.current) { projectDraftEpoch.current++; if (projectConnectionRecoveryRef.current) setProjectConnectionRecovery(undefined); else { setNewProject(null); setProjectFolderUnavailable(false); } } setExportId(null); setNotificationOpen(false); setHelpOpen(false); setPendingGeneration(null); }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);

  const onSelectWorkspace = async (id: string) => {
    if (creatingProjectRef.current) { notify('项目文件夹正在登记，请等待完成后再切换工作区。', 'info'); return; }
    if (!await confirmTransition()) return;
    projectDraftEpoch.current++; setProjectFolderUnavailable(false); setProjectConnectionRecovery(undefined); setCreatingRecoveryWorkspace(false);
    const selected = workspaces.find(item => item.id === id && !item.removedAt);
    if (!selected) return;
    const candidates = allProjects.filter(item => item.workspaceId === id && !item.trashedAt);
    setWorkspaceId(id); setAutomationIntent(undefined); setSearchTarget(undefined); setActiveId(candidates.find(item => item.id === selected.lastProjectId)?.id || candidates[0]?.id || '');
    setSearchOpen(false); setNotificationOpen(false); setNewProject(null); setExportId(null); setPendingGeneration(null); setPromptToApply(undefined); setGenerationIntent(undefined); setToast(null);
  };
  const workspaceFiles = useWorkspaceFiles({ workspaces, projects: allProjects, setWorkspaces, setProjects, notify });
  const creatingProjectRef = useRef(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const onCreateWorkspace = async (name: string, description: string) => {
    if (!await confirmTransition()) return false;
    const sourceWorkspaceId = workspaceIdRef.current;
    const id = crypto.randomUUID();
    const location = await workspaceFiles.choose({ id, name });
    if (location === null) return false;
    setWorkspaces(items => [...items, { id, name, description, ...(location ? { directory: location.directory } : {}), createdAt: new Date().toISOString() }]);
    setPreferencesByWorkspace(items => ({ ...items, [id]: { ...INITIAL_PREFERENCES, studioName: name } }));
    if (workspaceIdRef.current !== sourceWorkspaceId) { notify(`工作区“${name}”已创建，可从左侧切换。`); return true; }
    setWorkspaceId(id); setActiveId(''); setView('overview'); setNewProject(null); setPendingGeneration(null); setPromptToApply(undefined); setSearchOpen(false); setNotificationOpen(false);
    notify(location ? '本地工作区已创建，项目文件将分别保存到子文件夹。' : '预览工作区已创建；本地文件夹请在桌面版绑定。');
    return true;
  };
  const applyWorkspaceManagement = (next: WorkspaceState) => {
    const issue = writeWorkspaceState(() => localStorage, next, workspaceStorageIssue);
    if (issue) { setWorkspaceStorageIssue(issue); throw new Error(issue.message); }
    const changed = next.activeWorkspaceId !== workspaceIdRef.current;
    workspaceStateRef.current = next; workspaceIdRef.current = next.activeWorkspaceId;
    setWorkspaces(next.workspaces); setWorkspaceId(next.activeWorkspaceId);
    if (changed) {
      const selected = next.workspaces.find(item => item.id === next.activeWorkspaceId);
      setActiveId(next.projects.find(item => item.workspaceId === next.activeWorkspaceId && item.id === selected?.lastProjectId && !item.trashedAt)?.id || next.projects.find(item => item.workspaceId === next.activeWorkspaceId && !item.trashedAt)?.id || '');
      projectDraftEpoch.current++; setView('overview'); setNewProject(null); setProjectConnectionRecovery(undefined); setCreatingRecoveryWorkspace(false);
      setPromptToApply(undefined); setGenerationIntent(undefined); setSearchOpen(false); setNotificationOpen(false); setExportId(null);
    }
  };
  const onRemoveWorkspace = async (id: string) => {
    const issue = workspaceRemoveError(workspaceStateRef.current.workspaces, id);
    if (issue) throw new Error(issue);
    const ids = new Set(projectsRef.current.filter(project => project.workspaceId === id).map(project => project.id));
    if (creatingProjectRef.current || selectingProjectFolderRef.current || (exportBusy && exportId && ids.has(exportId)) || [...jobs.current.keys()].some(projectId => ids.has(projectId))) throw new Error('工作区仍有创建、导出或执行操作，请等待完成后再移除。');
    if (guardedEditorSessions({ includeDirty: true }).some(session => ids.has(session.projectId))) throw new Error('请先保存此工作区的未保存编辑或处理保存错误，再移除工作区。');
    const runs = window.desktop?.runtime ? (await window.desktop.runtime.snapshot()).runs : [];
    if ([...runs, ...(workflowRunnerRef.current?.runs || [])].some(run => ids.has(run.projectId) && activeRun(run))) throw new Error('此工作区仍有运行、暂停或待审核任务，请先完成或取消后再移除。');
    applyWorkspaceManagement(removeWorkspaceState(workspaceStateRef.current, id)); notify('工作区已从列表移除，本地文件和费用记录保留，可在已移除列表恢复。'); return true;
  };
  const onRestoreWorkspace = async (id: string) => {
    applyWorkspaceManagement(restoreWorkspaceState(workspaceStateRef.current, id)); notify('工作区已恢复，可从左侧切换。'); return true;
  };
  const onUpdatePreferences = (changes: Partial<Preferences>) => {
    setPreferencesByWorkspace(items => ({ ...items, [workspaceId]: { ...preferences, ...changes } }));
    if (changes.studioName) setWorkspaces(items => items.map(item => item.id === workspaceId ? { ...item, name: changes.studioName! } : item));
  };
  const onUpdateProject = useCallback((id: string, changes: Partial<Project>) => {
    if (!projectsRef.current.some(item => item.id === id && item.workspaceId === workspaceIdRef.current && !item.trashedAt)) return;
    const flow = workflowRunnerRef.current?.runs.find(run => run.projectId === id && activeRun(run));
    const invalidatingDelivery = Object.prototype.hasOwnProperty.call(changes, 'confirmedDelivery') && changes.confirmedDelivery === undefined && (!changes.status || changes.status === 'review');
    if (flow && changes.status && !invalidatingDelivery) {
      if (changes.status === 'paused') workflowRunnerRef.current?.pause(flow.id);
      else if (changes.status === 'processing') workflowRunnerRef.current?.resume(flow.id);
      else if (changes.status === 'draft') workflowRunnerRef.current?.cancel(flow.id);
      else notify('请在工作流运行记录中完成当前步骤。', 'info');
      return;
    }
    const currentJob = jobs.current.get(id);
    if (currentJob && changes.status && !['processing', 'paused'].includes(changes.status)) {
      clearInterval(currentJob.timer); jobs.current.delete(id);
      setLedger(items => items.map(item => item.id === currentJob.ledgerId ? { ...item, status: 'cancelled' } : item));
      setTaskProgress(items => { const next = { ...items }; delete next[id]; return next; });
    }
    setProjects(items => items.map(item => item.id === id ? { ...item, ...changes, updatedAt: new Date().toISOString(), workspaceId: item.workspaceId } : item));
    if (changes.name) setLedger(items => items.map(item => item.projectId === id ? { ...item, projectName: changes.name! } : item));
  }, [notify]);
  const onProjectDelivered = async (id: string, receipt: DeliveryReceipt, selection: DeliverySelection) => {
    const project = projectsRef.current.find(item => item.id === id && item.workspaceId === workspaceIdRef.current && !item.trashedAt);
    const delivery = window.desktop?.delivery, runtime = window.desktop?.runtime;
    if (!project || !delivery || receipt.projectId !== id || selection.projectId !== id || selection.kind !== project.kind) throw new Error('交付记录不属于当前项目，未修改项目状态。');
    const inspection = await delivery.inspect(selection);
    if (!inspection.ready || inspection.errors.length || inspection.currentReceipt?.id !== receipt.id || inspection.fingerprint !== receipt.fingerprint) throw new Error('当前成品或交付检查已经变化，请刷新检查后再确认。');
    const snapshot = runtime ? await (runtime.pollSnapshot ? runtime.pollSnapshot(-1) : runtime.snapshot()) : undefined;
    if (workspaceIdRef.current !== project.workspaceId || guardedEditorSessions({ includeDirty: true }).some(session => session.projectId === id)) return;
    const runs = (snapshot?.runs || workflowRunnerRef.current?.runs || []).filter(run => isProductionRun(run) && run.projectId === id && run.mode === 'live');
    if (runs.some(run => run.status === 'running' || run.status === 'paused')) return;
    const latest = runs[0];
    const outputIds = new Set(latest?.attempts.flatMap(attempt => attempt.artifacts?.filter(file => !file.trashedAt && !file.unavailable).map(file => file.id) || []) || []);
    if (latest && inspection.files.some(file => !outputIds.has(file.id))) return;
    const signature = latest ? liveProjectStateSignature(latest) : project.lastLiveStateSignature || 'manual-delivery';
    setProjects(items => items.map(item => {
      if (item.id !== id || item.trashedAt || item.workspaceId !== project.workspaceId) return item;
      if (item.status === 'complete' && item.confirmedDelivery?.id === receipt.id && item.confirmedDelivery.fingerprint === receipt.fingerprint && item.confirmedDelivery.runStateSignature === signature) return item;
      return { ...item, status: 'complete', updatedAt: receipt.confirmedAt, lastLiveStateSignature: signature, confirmedDelivery: { id: receipt.id, fingerprint: receipt.fingerprint, runStateSignature: signature } };
    }));
  };
  const onMoveProject: PageProps['onMoveProject'] = async (id, destination, changes) => {
    const sourceWorkspaceId = workspaceIdRef.current, project = projectsRef.current.find(item => item.id === id && item.workspaceId === sourceWorkspaceId && !item.trashedAt);
    if (!project || !workspaces.some(item => item.id === destination && !item.removedAt) || destination === sourceWorkspaceId) return false;
    if (jobs.current.has(id) || workflowRunnerRef.current?.runs.some(run => run.projectId === id && activeRun(run))) { notify('请先完成或取消项目的运行任务，再移动工作区。', 'info'); return false; }
    try {
      const moved = await moveProjectWithDraft({ project, destination, changes, move: workspaceFiles.move, commit: (location, draft) => {
        setProjects(items => moveProjectWorkspace(items, id, destination).map(item => item.id === id ? { ...item, ...draft, directory: location.directory, updatedAt: new Date().toISOString() } : item));
        if (draft.name) setLedger(items => items.map(item => item.projectId === id ? { ...item, projectName: draft.name! } : item));
      } });
      if (!moved) return false;
    } catch (error) { notify(error instanceof Error ? error.message : '项目目录移动未完成，原文件已保留。', 'error'); return false; }
    if (workspaceIdRef.current !== sourceWorkspaceId) { notify('项目目录与资料已移动到目标工作区。'); return true; }
    if (activeId === id) rememberProject(projectsRef.current.find(item => item.workspaceId === sourceWorkspaceId && item.id !== id && !item.trashedAt)?.id || '', sourceWorkspaceId);
    setPromptToApply(undefined);
    notify('项目已移动，内容、版本与累计费用一同保留。'); return true;
  };
  const onTrashProject = async (id: string, silent = false) => {
    if (pendingProjectTrash.current.has(id) || projectPurge.activeIds.current.has(id)) return false;
    const targetWorkspaceId = workspaceIdRef.current;
    pendingProjectTrash.current.add(id);
    try {
      const nativeRuns = window.desktop?.runtime ? (await window.desktop.runtime.snapshot()).runs : [];
      if (workspaceIdRef.current !== targetWorkspaceId) return false;
      const busyIds = new Set([...jobs.current.keys(), ...[...(workflowRunnerRef.current?.runs || []), ...nativeRuns].filter(blocksProjectTrash).map(run => run.projectId)]);
      if (exportBusy && exportId) busyIds.add(exportId);
      const project = projectsRef.current.find(item => item.id === id);
      const error = projectTrashError(project, targetWorkspaceId, busyIds);
      if (error) { if (!silent) notify(error, 'info'); return false; }
      await window.desktop?.automation?.prepareProjectArchive({ projectId: id, workspaceId: targetWorkspaceId });
      const timestamp = new Date().toISOString();
      setProjects(items => trashProjectState(items, id, targetWorkspaceId, busyIds, timestamp));
      if (workspaceIdRef.current === targetWorkspaceId) {
        if (activeId === id) rememberProject(projectsRef.current.find(item => item.workspaceId === targetWorkspaceId && item.id !== id && !item.trashedAt)?.id || '', targetWorkspaceId);
        setExportId(null); setPendingGeneration(null); setPromptToApply(undefined); setGenerationIntent(undefined); setSearchOpen(false);
      }
      if (!silent) notify('项目已移入回收站，历史费用保留。本地文件未改动；外部已删除的文件不会恢复。'); return true;
    } catch (cause) { if (!silent) notify(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '暂时无法确认项目是否仍有任务，未移入回收站；请稍后重试。', 'error'); return false; }
    finally { pendingProjectTrash.current.delete(id); }
  };
  const onRestoreProject = async (id: string, silent = false) => {
    const source = workspaceIdRef.current, project = projectsRef.current.find(item => item.id === id && item.workspaceId === source && item.trashedAt && !item.purgedAt);
    if (!project || pendingProjectTrash.current.has(id) || projectPurge.activeIds.current.has(id)) return false;
    if (projectPurge.loading || projectPurge.error) { if (!silent) notify('正在核对永久删除状态，请先在回收站重新读取状态后再恢复。', 'info'); return false; }
    pendingProjectTrash.current.add(id);
    try {
      await window.desktop?.automation?.restoreProjectArchive({ projectId: id, workspaceId: source });
      setProjects(items => restoreProjectState(items, id, source));
      if (!silent) notify('项目已恢复，原有草稿、产物与费用保持不变。'); return true;
    } catch (cause) { if (!silent) notify(cause instanceof Error ? cause.message : '项目未恢复，请检查当前任务与目录状态。', 'error'); return false; }
    finally { pendingProjectTrash.current.delete(id); }
  };

  const onBulkProjectAction: NonNullable<PageProps['onBulkProjectAction']> = async (ids, action) => {
    if (!['trash', 'restore'].includes(action) || !Array.isArray(ids) || ids.length > 100) throw new Error('请选择最多100个本区项目。');
    const source = workspaceIdRef.current, unique = [...new Set(ids)], failedIds: string[] = []; let done = 0;
    for (const id of unique) {
      if (workspaceIdRef.current !== source) { failedIds.push(id); continue; }
      const succeeded = action === 'trash' ? await onTrashProject(id, true) : await onRestoreProject(id, true);
      if (succeeded) done++; else failedIds.push(id);
    }
    notify(`批量整理完成 ${done} 项，跳过 ${failedIds.length} 项；历史费用保持。`);
    return { done, skipped: failedIds.length, failedIds };
  };

  const startGeneration = useCallback((projectId: string, action: LedgerEntry['action'], count = 1, onStarted?: () => void) => {
    const project = projectsRef.current.find(item => item.id === projectId && item.workspaceId === workspaceIdRef.current && !item.trashedAt);
    if (!project) return;
    if (pendingProjectTrash.current.has(projectId)) { notify('项目正在移入回收站，请等待操作完成。', 'info'); return; }
    if (workflowRunnerRef.current?.runs.some(run => run.projectId === projectId && activeRun(run))) { notify('项目已有运行或待检查的工作流，请先完成或取消。', 'info'); return; }
    if (jobs.current.has(projectId)) { notify('这个项目已有运行任务，可以在任务中心暂停或继续。', 'info'); return; }
    const quantity = Math.min(4, Math.max(1, Math.floor(count)));
    const costCents = demoCost(project.kind, action, quantity);
    if (project.budgetCents != null && project.costCents + costCents > project.budgetCents) { notify('项目演示预算不足，请先在项目设置中调整预算。', 'error'); return; }
    const ledgerId = crypto.randomUUID();
    const entry: LedgerEntry = { id: ledgerId, projectId, projectName: project.name, action, model: `${project.kind === 'image' ? '图片' : '文本'}模型${quantity > 1 ? ` ×${quantity}张` : ''} · 演示`, costCents, time: nowLabel(), status: 'processing', quantity };
    setLedger(items => [entry, ...items]);
    setProjects(items => items.map(item => item.id === projectId ? { ...item, status: 'processing', costCents: item.costCents + costCents } : item));
    setTaskProgress(items => ({ ...items, [projectId]: 4 }));
    const job = { progress: 4, ledgerId, timer: setInterval(() => {
      const current = projectsRef.current.find(item => item.id === projectId);
      if (current?.status === 'paused') return;
      job.progress = Math.min(100, job.progress + 7);
      setTaskProgress(items => ({ ...items, [projectId]: job.progress }));
      if (job.progress === 100) {
        clearInterval(job.timer); jobs.current.delete(projectId);
        setLedger(items => items.map(item => item.id === ledgerId ? { ...item, status: 'complete' } : item));
        setProjects(items => items.map(item => item.id === projectId ? { ...item, status: action === 'AI 复核' ? 'complete' : 'review', version: item.version + (action === 'AI 复核' ? 0 : 1), updatedAt: new Date().toISOString() } : item));
        if (current?.workspaceId === workspaceIdRef.current) notify(`${action}演示已完成。新增演示流水 ¥${money(costCents)}，未产生真实扣费。`);
        setTimeout(() => { if (jobs.current.has(projectId)) return; setTaskProgress(items => { const next = { ...items }; delete next[projectId]; return next; }); }, 1600);
      }
    }, 280) };
    jobs.current.set(projectId, job); onStarted?.();
  }, [notify]);
  const onGenerate: PageProps['onGenerate'] = (projectId, action, count = 1, _onStarted, parameters) => {
    const project = projects.find(item => item.id === projectId);
    if (!project) return;
    if (pendingProjectTrash.current.has(projectId)) { notify('项目正在移入回收站，请等待操作完成。', 'info'); return; }
    const currentRuns = workflowRunner.runs.filter(run => run.projectId === projectId && activeRun(run));
    if (currentRuns.some(run => run.mode !== 'live' || run.status !== 'waiting-review')) { notify('项目正在执行或已暂停，请在当前任务中继续、等待或取消后再生成。', 'info'); return; }
    const replaceWaitingReviewRunId = currentRuns.find(run => run.mode === 'live' && run.status === 'waiting-review')?.id;
    const kind = parameters?.capability || (project.kind === 'image' ? action === 'AI 复核' ? 'vision' : action === 'AI 精修' ? 'image-editing' : 'image-generation' : 'text');
    const id = `quick-${project.id}-${kind}-${action === '初次生成' ? 'create' : action === '重新生成' ? 'regenerate' : action === 'AI 精修' ? 'refine' : 'review'}${parameters?.documentImages ? `-illustrated-${parameters.documentImages.mode}` : ''}`;
    const existing = configuration.workflows.find(flow => flow.id === id);
    const models = configuration.models.filter(item => !item.demo && item.enabled && item.capabilities.includes(kind) && configuration.connections.some(connection => connection.id === item.connectionId && connection.enabled && !connection.demo));
    const model = studioModel(models, parameters?.modelConfigId || existing?.steps[0]?.modelConfigId);
    const credentialId = studioCredential(configuration.credentials, model?.connectionId, parameters?.credentialId ?? existing?.steps[0]?.credentialId);
    if (parameters?.credentialId && !credentialId) { notify('所选 Key 已不可用或不属于当前模型，请重新选择后再继续。', 'error'); return; }
    const instruction = parameters?.prompt || (action === 'AI 复核' ? '检查当前内容中的错误、遗漏和需要人工核对的内容，输出清楚的检查报告。' : project.description || `根据本次需求制作${KIND_LABEL[project.kind]}内容，保留已提供事实，缺失信息标为待确认。`);
    const corePrompt = action === 'AI 精修' && kind === 'text' && project.kind !== 'image' ? `${instruction}\n请输出可直接交付的完整修订内容，不要只输出修改建议。保留未要求修改的事实、数字和段落，无法核实的信息标注待确认。` : instruction;
    const prompt = creationPrompt(project.kind, corePrompt, action === 'AI 复核' ? 'vision' : kind, { imageSize: parameters?.imageSize, imageBackground: parameters?.imageBackground, hasReferences: Boolean(parameters?.attachmentIds?.length) });
    const previousLimit = existing?.steps[0]?.maxOutputTokens;
    const maxOutputTokens = kind === 'text' && project.kind !== 'image' && action !== 'AI 复核' ? previousLimit && previousLimit !== 4096 ? previousLimit : CREATION_PROFILES[project.kind].outputTokens : previousLimit || 4096;
    const firstStep: WorkflowStep = { id: existing?.steps[0]?.id || crypto.randomUUID(), name: action, kind, prompt, inputSource: 'project', budgetCents: quickImageWorkflowBudget(existing?.steps), enabled: true, modelConfigId: parameters?.modelConfigId || model?.id, credentialId, maxOutputTokens, count, imageSize: parameters?.imageSize || '1024x1024', imageBackground: parameters?.imageBackground || 'auto' };
    const tail = quickWorkflowTail(project.kind, kind, action, parameters?.documentImages ? undefined : quickImageWorkflowTail(existing?.steps));
    let steps: WorkflowStep[];
    try { steps = quickImageWorkflowSteps(firstStep, tail); }
    catch (cause) { notify(cause instanceof Error ? cause.message : '图片数量无效。', 'error'); return; }
    if (parameters?.documentImages) {
      if (!['word', 'ppt'].includes(project.kind) || kind !== 'text') { notify('图文生成仅用于 Word 和 PPT 正文。', 'error'); return; }
      try { steps = illustratedDocumentSteps(firstStep, tail, parameters.documentImages, configuration, parameters.input || instruction); }
      catch (cause) { notify(cause instanceof Error ? cause.message : '图文工作流配置未完成。', 'error'); return; }
    }
    const draft: WorkflowDraft = { name: existing?.name || `${project.name} · ${action}`, description: parameters?.documentImages ? '完整正文与独立插图自动排版，成品可继续编辑。配图和正文调用分别记费。' : '由工作台创建，可编辑步骤、模型和提示词后重复使用。', outputKind: project.kind, businessCategoryId: project.businessCategoryId, steps };
    if (!configuration.saveWorkflow(draft, id, { silent: true })) return;
    rememberProject(projectId, workspaceId);
    const previousImages = projectImageContent(workflowRunner.runs, projectId, workflowRunner.trashedArtifacts).images.slice(0, 1).map(item => item.id);
    const input = parameters?.input?.trim() || (['image-generation', 'image-editing'].includes(kind) ? '按当前提示词和参考文件执行。' : project.description || '按当前提示词执行。');
    setGenerationIntent({ token: crypto.randomUUID(), workflowId: id, projectId, input, replaceWaitingReviewRunId, attachmentIds: parameters?.attachmentIds !== undefined ? parameters.attachmentIds : ['image-editing', 'vision'].includes(kind) ? previousImages : [] });
  };
  const onUseStudioAction: PageProps['onUseStudioAction'] = (id, projectId, input, attachmentIds) => {
    const action = configuration.studioActions.find(item => item.id === id && item.enabled);
    const project = projects.find(item => item.id === projectId);
    if (!action || !project || project.kind !== action.outputKind) { notify('请选择作品类型匹配的项目和功能。', 'error'); return; }
    const currentRuns = workflowRunner.runs.filter(run => run.projectId === projectId && activeRun(run));
    if (pendingProjectTrash.current.has(projectId) || jobs.current.has(projectId) || currentRuns.some(run => run.mode !== 'live' || run.status !== 'waiting-review')) { notify('项目正在执行或已暂停，请先处理当前任务。', 'info'); return; }
    const replaceWaitingReviewRunId = currentRuns.find(run => run.mode === 'live' && run.status === 'waiting-review')?.id;
    rememberProject(projectId, workspaceId);
    setGenerationIntent({ token: crypto.randomUUID(), workflowId: action.workflowId, projectId, input: input?.trim() || project.description, attachmentIds, replaceWaitingReviewRunId });
  };
  const beginProject = async (kind: ProjectKind = 'ppt', promptIntent?: PromptIntent, onCreated?: (project: Project) => void, options?: ProjectStartOptions) => {
    if (selectingProjectFolderRef.current || creatingProjectRef.current) { options?.onCancelled?.('正在处理另一个保存位置，请稍后再试。'); return; }
    const sourceWorkspaceId = workspaceIdRef.current, epoch = ++projectDraftEpoch.current;
    const completion = onCreated || options?.onCancelled ? { workspaceId: sourceWorkspaceId, onCreated, onCancelled: options?.onCancelled } : undefined;
    selectingProjectFolderRef.current = true; setSelectingProjectFolder(true); setFormError('');
    try {
      if (!onCreated && !await confirmTransition() || sourceWorkspaceId !== workspaceIdRef.current || epoch !== projectDraftEpoch.current) return;
      projectCreationCompletion.current = completion;
      if (!window.desktop?.workspaceFiles?.chooseProjectFolder || !window.desktop.workspaceFiles.createProject) { setProjectFolderUnavailable(true); completion?.onCancelled?.('请在桌面应用中选择本地保存位置。'); return; }
      const selection = await workspaceFiles.chooseProjectFolder(sourceWorkspaceId);
      if (!selection || sourceWorkspaceId !== workspaceIdRef.current || epoch !== projectDraftEpoch.current) { if (projectCreationCompletion.current === completion) projectCreationCompletion.current = undefined; completion?.onCancelled?.(); return; }
      setProjectFolderUnavailable(false);
      const next: NewProjectDraft = { selection, kind, name: (options?.initial?.name || selection.name).slice(0, 50), description: options?.initial?.description || promptIntent?.template.description || '', budget: '', promptIntent };
      if (options?.quick && completion?.onCreated) await createProject(next, true);
      else setNewProject(next);
    } catch (cause) {
      if (sourceWorkspaceId === workspaceIdRef.current && epoch === projectDraftEpoch.current) {
        const message = projectCreationError(cause, '项目文件夹选择未完成。');
        completion?.onCancelled?.(message);
        if (isWorkspaceConnectionError(message)) setProjectConnectionRecovery({ workspaceId: sourceWorkspaceId, directory: workspaceStateRef.current.workspaces.find(item => item.id === sourceWorkspaceId)?.directory || '', message, connected: false, action: 'new', kind, promptIntent });
        else { if (projectCreationCompletion.current === completion) projectCreationCompletion.current = undefined; notify(message, 'error'); }
      }
    }
    finally { selectingProjectFolderRef.current = false; setSelectingProjectFolder(false); }
  };
  const onCreateProject: PageProps['onCreateProject'] = (kind = 'ppt', options) => { void beginProject(kind, undefined, options?.onCreated, options); };
  const closeNewProject = () => {
    if (creatingProjectRef.current || selectingProjectFolderRef.current) return;
    projectDraftEpoch.current++; projectCreationCompletion.current?.onCancelled?.(); projectCreationCompletion.current = undefined; setNewProject(null); setProjectFolderUnavailable(false); setProjectConnectionRecovery(undefined); setFormError('');
  };
  const changeProjectFolder = async () => {
    const draft = newProjectRef.current;
    if (!draft || creatingProjectRef.current || selectingProjectFolderRef.current) return;
    const epoch = ++projectDraftEpoch.current;
    selectingProjectFolderRef.current = true; setSelectingProjectFolder(true); setFormError('');
    try {
      const selection = await workspaceFiles.chooseProjectFolder(draft.selection.workspaceId);
      if (!selection || epoch !== projectDraftEpoch.current || workspaceIdRef.current !== draft.selection.workspaceId) return;
      setNewProject(value => value?.selection.selectionId === draft.selection.selectionId ? { ...value, selection, name: value.name === draft.selection.name.slice(0, 50) ? selection.name.slice(0, 50) : value.name } : value);
    } catch (cause) {
      if (epoch === projectDraftEpoch.current && workspaceIdRef.current === draft.selection.workspaceId) {
        const message = projectCreationError(cause, '文件夹未能更换，原选择已保留。');
        if (isWorkspaceConnectionError(message)) setProjectConnectionRecovery({ workspaceId: draft.selection.workspaceId, directory: workspaceStateRef.current.workspaces.find(item => item.id === draft.selection.workspaceId)?.directory || '', message, connected: false, action: 'change', kind: draft.kind, promptIntent: draft.promptIntent, selectionId: draft.selection.selectionId });
        else setFormError(message);
      }
    }
    finally { selectingProjectFolderRef.current = false; setSelectingProjectFolder(false); }
  };
  const closeProjectConnectionRecovery = () => {
    if (creatingProjectRef.current || selectingProjectFolderRef.current) return;
    projectDraftEpoch.current++; setProjectConnectionRecovery(undefined); setCreatingRecoveryWorkspace(false);
  };
  const createRecoveryWorkspace = async (name: string, description: string) => {
    const recovery = projectConnectionRecoveryRef.current;
    if (!recovery || selectingProjectFolderRef.current || creatingProjectRef.current || recovery.workspaceId !== workspaceIdRef.current || !await confirmTransition()) return false;
    const sourceWorkspaceId = recovery.workspaceId, id = crypto.randomUUID(), epoch = ++projectDraftEpoch.current;
    const saved = newProjectRef.current;
    const draft = saved ? { kind: saved.kind, name: saved.name, description: saved.description, budget: saved.budget, promptIntent: saved.promptIntent } : recovery.draft;
    selectingProjectFolderRef.current = true; setSelectingProjectFolder(true);
    let created = false;
    try {
      const location = await workspaceFiles.choose({ id, name });
      if (location === null) return false;
      if (!location) throw new Error('请在桌面应用内选择本地工作区文件夹。');
      created = true;
      const next: ProjectConnectionRecovery = { workspaceId: id, directory: location.directory, message: '新工作区已创建。请选择独立项目文件夹继续，原工作区的项目和费用已保留。', connected: true, action: 'new', kind: recovery.kind, promptIntent: recovery.promptIntent, draft };
      flushSync(() => {
        setWorkspaces(items => [...items, { id, name, description, directory: location.directory, createdAt: new Date().toISOString() }]);
        setPreferencesByWorkspace(items => ({ ...items, [id]: { ...INITIAL_PREFERENCES, studioName: name } }));
        if (epoch !== projectDraftEpoch.current || workspaceIdRef.current !== sourceWorkspaceId) return;
        setWorkspaceId(id); setActiveId(''); setView('overview'); setNewProject(null); setProjectConnectionRecovery(next);
        setPendingGeneration(null); setPromptToApply(undefined); setGenerationIntent(undefined); setSearchOpen(false); setNotificationOpen(false);
      });
      if (epoch !== projectDraftEpoch.current || workspaceIdRef.current !== id) { notify(`工作区“${name}”已创建，可从左侧切换。`); return true; }
      try {
        const selection = await workspaceFiles.chooseProjectFolder(id);
        if (selection && epoch === projectDraftEpoch.current && workspaceIdRef.current === id) {
          setNewProject(recoverProjectDraft(next, selection)); setProjectConnectionRecovery(undefined); setProjectFolderUnavailable(false); setFormError('');
        }
      } catch (cause) {
        if (epoch === projectDraftEpoch.current && workspaceIdRef.current === id) setProjectConnectionRecovery({ ...next, connected: !isWorkspaceConnectionError(projectCreationError(cause, '')), message: projectCreationError(cause, '项目文件夹尚未选择，可继续重试。') });
      }
      return true;
    } finally {
      selectingProjectFolderRef.current = false; setSelectingProjectFolder(false);
      if (created) setCreatingRecoveryWorkspace(false);
    }
  };
  const reconnectProjectCreation = async () => {
    const recovery = projectConnectionRecoveryRef.current;
    if (!recovery || creatingProjectRef.current || selectingProjectFolderRef.current || recovery.workspaceId !== workspaceIdRef.current) return;
    const epoch = ++projectDraftEpoch.current;
    let connected = recovery.connected;
    selectingProjectFolderRef.current = true; setSelectingProjectFolder(true);
    const currentOperation = () => epoch === projectDraftEpoch.current && recovery.workspaceId === workspaceIdRef.current;
    try {
      if (!connected) {
        const result = await workspaceFiles.reconnect(recovery.workspaceId);
        if (!result || !currentOperation()) return;
        connected = true;
        setProjectConnectionRecovery(value => value?.workspaceId === recovery.workspaceId ? { ...value, directory: result.directory, connected: true, message: '工作区已重新连接，账本和旧项目记录均已保留。' } : value);
      }
      if (recovery.action === 'commit') { if (currentOperation()) { setFormError(''); setProjectConnectionRecovery(undefined); notify('工作区已重新连接，项目信息已保留，可以继续创建项目。'); } return; }
      const selection = await workspaceFiles.chooseProjectFolder(recovery.workspaceId);
      if (!selection || !currentOperation()) return;
      if (recovery.action === 'new') setNewProject(recoverProjectDraft(recovery, selection));
      else setNewProject(value => value && value.selection.selectionId === recovery.selectionId ? { ...value, selection, name: value.name === value.selection.name.slice(0, 50) ? selection.name.slice(0, 50) : value.name } : value);
      setFormError(''); setProjectFolderUnavailable(false); setProjectConnectionRecovery(undefined);
    } catch (cause) {
      if (currentOperation()) {
        const message = projectCreationError(cause, '工作区重新连接未完成，当前信息已保留。');
        setProjectConnectionRecovery(value => value?.workspaceId === recovery.workspaceId ? { ...value, connected: connected && !isWorkspaceConnectionError(message), message } : value);
      }
    } finally { selectingProjectFolderRef.current = false; setSelectingProjectFolder(false); }
  };
  const applyPrompt = (project: Project, intent: PromptIntent) => {
    setAssetToApply(undefined); assetApplicationRequest.current++;
    setActiveId(project.id); setView(project.kind === 'image' ? 'images' : 'documents');
    setPromptToApply({ token: crypto.randomUUID(), projectId: project.id, category: intent.template.category, content: intent.content, mode: intent.template.mode, imagePreset: intent.template.imagePreset });
  };
  const onUsePrompt = (template: PromptTemplate, content: string) => {
    if (!template.builtin) setCustomPrompts(items => items.map(item => item.id === template.id && item.workspaceId === workspaceId ? { ...item, lastUsedAt: new Date().toISOString() } : item));
    const kind = template.category === 'general' ? projects.find(item => item.id === activeId)?.kind || 'ppt' : template.category;
    const project = projects.find(item => item.id === activeId && item.kind === kind) || projects.find(item => item.kind === kind);
    if (project) { applyPrompt(project, { template, content }); notify('提示词已填入工作台，可继续修改；尚未生成或计费。'); }
    else { void beginProject(kind, { template, content }); }
  };
  const onUseAsset = async (projectId: string, file: ArtifactMetadata) => {
    const sourceWorkspaceId = workspaceIdRef.current, request = ++assetApplicationRequest.current;
    try {
      assetApplicationTarget(projectsRef.current, sourceWorkspaceId, projectId, file);
      if (!await confirmTransition()) { notify('素材副本已保留在目标项目，当前页面未切换。', 'info'); return false; }
      if (request !== assetApplicationRequest.current || workspaceIdRef.current !== sourceWorkspaceId) return false;
      const listed = await workflowRunnerRef.current?.listProjectArtifacts?.(projectId);
      const actual = listed ? listed.find(item => item.id === file.id) : file;
      if (!actual) throw new Error('素材副本已不可用，请在项目文件中检查或重新添加。');
      const target = assetApplicationTarget(projectsRef.current, sourceWorkspaceId, projectId, actual);
      if (request !== assetApplicationRequest.current || workspaceIdRef.current !== sourceWorkspaceId) return false;
      if (actual.kind !== 'image' || target.kind === 'excel') {
        navigateNow(target.kind === 'image' ? 'images' : 'documents', projectId);
        notify(target.kind === 'excel' && actual.kind === 'image' ? '图片已保存在项目参考资料。Excel 当前不支持直接插入图片，单元格保持不变。' : '素材已加入项目参考资料，可在工作台查看和使用。'); return true;
      }
      assertAssetImage(projectId, actual, target.kind !== 'image');
      navigateNow(target.kind === 'image' ? 'images' : 'documents', projectId);
      setAssetToApply({ token: crypto.randomUUID(), workspaceId: sourceWorkspaceId, projectId, file: actual }); return true;
    } catch (cause) { if (workspaceIdRef.current === sourceWorkspaceId) notify(projectCreationError(cause, '素材未能带入工作台，已复制文件仍保留。'), 'error'); return false; }
  };
  const onSavePrompt = (draft: PromptDraft, id?: string) => {
    if (!draft.name.trim() || !draft.content.trim()) { notify('模板名称和内容不能为空。', 'error'); return; }
    if (!belongsToCategory(configuration.categories, workspaceId, draft.businessCategoryId)) { notify('提示词分类不属于当前工作区。', 'error'); return; }
    const existing = customPrompts.find(item => item.id === id && item.workspaceId === workspaceId);
    const template: PromptTemplate = { ...existing, ...draft, name: draft.name.trim(), content: draft.content.trim(), id: existing?.id || crypto.randomUUID(), builtin: false, workspaceId, updatedAt: new Date().toISOString() };
    setCustomPrompts(items => existing ? items.map(item => item.id === existing.id ? template : item) : [template, ...items]);
    notify(`提示词已保存到“${workspace.name}”。`);
  };
  const onManagePrompt: NonNullable<PageProps['onManagePrompt']> = (id, action) => {
    const selected = customPrompts.find(item => item.id === id && item.workspaceId === workspaceId);
    if (!selected) { notify('只能整理本工作区的自定义提示词。', 'info'); return; }
    const changes = action === 'archive' ? { archivedAt: new Date().toISOString() } : action === 'trash' ? { trashedAt: new Date().toISOString() } : action === 'restore' ? { archivedAt: undefined, trashedAt: undefined } : { favorite: action === 'favorite' };
    setCustomPrompts(items => items.map(item => item.id === id && item.workspaceId === workspaceId ? { ...item, ...changes, updatedAt: new Date().toISOString() } : item));
    notify(action === 'trash' ? '提示词已移入回收站，已有工作流内容保留。' : action === 'archive' ? '提示词已归档。' : action === 'restore' ? '提示词已恢复。' : action === 'favorite' ? '已收藏提示词。' : '已取消收藏。');
  };
  const createProject = async (prepared?: NewProjectDraft, quick = false) => {
    const draft = prepared || newProjectRef.current;
    const completion = projectCreationCompletion.current;
    if (!draft || creatingProjectRef.current || selectingProjectFolderRef.current && !quick) return;
    if (draft.selection.workspaceId !== workspaceIdRef.current) { closeNewProject(); return; }
    const invalid = (message: string) => { setFormError(message); if (quick) { setNewProject(draft); completion?.onCancelled?.(message); } };
    if (!draft.name.trim()) { invalid('先为这份作品起一个名字。'); return; }
    let budgetCents: number | undefined;
    try { budgetCents = parseOptionalBudget(draft.budget); }
    catch (error) { invalid(error instanceof Error ? error.message : '请填写有效金额，或留空不设上限。'); return; }
    const project: Project = { id: draft.selection.projectId, workspaceId: draft.selection.workspaceId, name: draft.name.trim(), kind: draft.kind, description: draft.description.trim(), status: 'draft', updatedAt: new Date().toISOString(), costCents: 0, budgetCents, version: 0, accent: draft.kind === 'ppt' ? 'orange' : draft.kind === 'word' ? 'blue' : draft.kind === 'excel' ? 'green' : 'purple' };
    creatingProjectRef.current = true; setCreatingProject(true);
    try {
      const location = await workspaceFiles.createProject(draft.selection, project.name);
      if (location.projectId !== project.id || location.workspaceId !== project.workspaceId) throw new Error('项目目录登记与当前选择不一致，未添加项目；请重新选择文件夹。');
      project.directory = location.directory;
      if (!projectsRef.current.some(item => item.id === project.id)) projectsRef.current = [project, ...projectsRef.current];
      setProjects(items => items.some(item => item.id === project.id) ? items : [project, ...items]);
      if (workspaceIdRef.current !== project.workspaceId || completion && projectCreationCompletion.current !== completion) { notify('项目已在原工作区创建，文件目录已保留。'); return; }
      rememberProject(project.id, project.workspaceId); setNewProject(value => value?.selection.selectionId === draft.selection.selectionId ? null : value);
      if (completion?.onCreated) {
        projectCreationCompletion.current = undefined;
        try { completion.onCreated(project); }
        catch (cause) { const message = `作品已创建，当前对话设置尚未保存。${cause instanceof Error ? cause.message : ''} 可在我的作品中继续。`; completion.onCancelled?.(message); notify(message, 'error'); }
      }
      else { setView(project.kind === 'image' ? 'images' : 'documents'); if (draft.promptIntent) applyPrompt(project, draft.promptIntent); }
      notify('项目已创建，产物会保存到所选文件夹。');
    } catch (cause) {
      const message = projectCreationError(cause, '项目目录未能创建，当前信息已保留。');
      if (quick) { setNewProject(draft); completion?.onCancelled?.(message); }
      if (isWorkspaceConnectionError(message) && workspaceIdRef.current === project.workspaceId) setProjectConnectionRecovery({ workspaceId: project.workspaceId, directory: workspaceStateRef.current.workspaces.find(item => item.id === project.workspaceId)?.directory || '', message, connected: false, action: 'commit', kind: draft.kind, promptIntent: draft.promptIntent, selectionId: draft.selection.selectionId });
      else setFormError(message);
    }
    finally { creatingProjectRef.current = false; setCreatingProject(false); }
  };

  const onExport: PageProps['onExport'] = (projectId, draft) => {
    const id = projectId || activeProject.id;
    const project = projects.find(item => item.id === id);
    if (!project) return;
    if (pendingProjectTrash.current.has(id)) { notify('项目正在移入回收站，请等待操作完成。', 'info'); return; }
    setExportId(id);
    if (draft) {
      const bridge = window.desktop?.runtime;
      if (!bridge) { notify('请使用新版 EXE 导出真实 Office 文件。', 'info'); return; }
      setExportBusy(true);
      void bridge.exportDraft({ project, title: draft.title, text: draft.text }).then(artifacts => { setManualArtifacts(items => ({ ...items, [id]: artifacts })); notify('当前草稿已生成实际文件，可打开检查或另存。'); }).catch(error => notify(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '文件未能导出。', 'error')).finally(() => setExportBusy(false));
    }
  };
  const displayProgress = { ...taskProgress, ...Object.fromEntries(workflowRunner.runs.filter(activeRun).map(run => [run.projectId, Math.round(run.stepIndex / Math.max(1, run.snapshot.steps.length) * 100)])) };
  const onBatchProjectsCreated = (created: Project[]) => setProjects(existing => { const known = new Set(existing.map(project => project.id)); const added = created.filter(project => !known.has(project.id)).map(project => ({ ...project, liveLedgerBaselineCents: project.costCents })); return added.length ? [...added, ...existing] : existing; });
  const props: PageProps = { activeView: view, onBatchProjectsCreated, automationIntent, onAutomationIntentConsumed: token => setAutomationIntent(value => value?.token === token ? undefined : value), onAutomateWorkflow, dataManagement, onBindWorkspace: () => workspaceFiles.bind(workspaceId), searchTarget, onSearchTargetConsumed: token => setSearchTarget(value => value?.token === token ? undefined : value), generationIntent, onGenerationIntentConsumed: token => setGenerationIntent(value => value?.token === token ? undefined : value), onUseStudioAction, configuration, workflowRunner, workspaceId, workspace, workspaces: visibleWorkspaceList, prompts, promptToApply, assetToApply, onUseAsset, onAssetApplied: token => setAssetToApply(value => value?.token === token ? undefined : value), onPromptApplied: token => setPromptToApply(value => value?.token === token ? undefined : value), onSavePrompt, onManagePrompt, onUsePrompt, onMoveProject, projects, trashedProjects, purgedProjects, projectPurgeLoading: projectPurge.loading, projectPurgeError: projectPurge.error, pendingProjectPurges: projectPurge.pending, onPurgeProjects: projectPurge.execute, onRetryProjectPurge: projectPurge.retry, onRefreshProjectPurges: projectPurge.refresh, onTrashProject, onRestoreProject, onBulkProjectAction, ledger, preferences, activeProject, taskProgress: displayProgress, navigate, notify, onCreateProject, onUpdateProject, onProjectDelivered, onGenerate, onExport, onUpdatePreferences };
  const liveCost = useMemo(() => summarizeCosts(ledger.filter(item => item.billingMode === 'live')), [ledger]);
  const navigationTasks = navigationTaskSummary(workflowRunner.runs, workspaceId, projects);
  const exportProject = projects.find(item => item.id === exportId);
  const pendingProject = projects.find(item => item.id === pendingGeneration?.projectId);
  const pendingCostCents = pendingProject && pendingGeneration ? demoCost(pendingProject.kind, pendingGeneration.action, pendingGeneration.count) : 0;
  const panels: Record<ViewId, () => ReactNode> = {
    tools: () => <ToolsHub navigate={navigate} taskSummary={navigationTasks} />,
    overview: () => <Overview {...props} />, documents: () => <DocumentStudio {...props} />, images: () => <ImageStudio {...props} />, projects: () => <Projects {...props} />, assets: () => <Assets {...props} />, prompts: () => <Prompts {...props} />, categories: () => <Categories {...props} />, workflows: () => <Workflows {...props} />, models: () => <Models {...props} />, activity: () => <Activity {...props} />, finance: () => <Finance {...props} />, automation: () => <AutomationCenter {...props} />, settings: () => <Settings {...props} />,
  };

  async function exportWorkspaceData() {
    try {
      const content = workspaceStorageIssue?.kind === 'read' ? loadedWorkspace.raw : JSON.stringify(workspaceStateRef.current, null, 2);
      if (content === null) return false;
      return await downloadFile('序作-工作室索引恢复.json', content);
    } catch { return false; }
  }
  function reloadWorkspaceData() {
    const next = readWorkspaceState(() => localStorage);
    if (next.issue) { setLoadedWorkspace(next); setWorkspaceStorageIssue(next.issue); return false; }
    window.location.reload(); return true;
  }
  async function resetWorkspaceData() {
    if (window.desktop?.runtime && (await window.desktop.runtime.snapshot()).runs.some(run => run.status === 'running')) {
      setWorkspaceStorageIssue(issue => ({ kind: issue?.kind || 'read', canExportOriginal: issue?.canExportOriginal || false, message: '仍有任务正在执行，请先停止或等待完成，再备份后重置。' })); return false;
    }
    const result = resetWorkspaceState(() => localStorage, { ...loadedWorkspace, issue: workspaceStorageIssue }, workspaceStorageIssue?.kind === 'write' ? workspaceStateRef.current : undefined);
    if (!result.ok) { setWorkspaceStorageIssue(result.issue); return false; }
    window.location.reload(); return true;
  }
  async function stopRecoveryTasks() {
    const runtime = window.desktop?.runtime;
    if (!runtime) return '浏览器中没有本机执行任务。';
    const running = (await runtime.snapshot()).runs.filter(run => run.status === 'running');
    for (const run of running) await runtime.control({ id: run.id, action: 'cancel' });
    return running.length ? '已请求停止当前执行任务，已经发生的费用记录仍会保留。' : '当前没有正在执行的任务。';
  }
  if (workspaceStorageIssue) return <StorageRecoveryPage title="工作室数据" issue={workspaceStorageIssue} exportLabel={workspaceStorageIssue.kind === 'write' ? '导出当前数据' : '导出原始数据'} onExport={exportWorkspaceData} onReload={reloadWorkspaceData} onReset={resetWorkspaceData} onStopTasks={window.desktop?.runtime ? stopRecoveryTasks : undefined} />;
  return <div className={`desktop-shell studio-app-shell next-interface app-layout-${layout} ${preferences.reduceMotion ? 'reduce-motion' : ''}`}>
    <div className="desktop-titlebar"><span className="titlebar-caption"><AppMark />序作工作台 <i /> {window.desktop?.runtime ? '桌面创作工作台' : '浏览器体验'}</span><div className="titlebar-right"><span>{window.desktop?.runtime ? '调用费用自动记录 · 密钥本机加密' : '浏览器预览 · 关闭请使用浏览器标签页'}</span>{window.desktop?.close && <div className="window-controls"><button title="最小化" aria-label="最小化" onClick={() => window.desktop?.minimize()}><Minus size={14} /></button><button title="最大化" aria-label="最大化" onClick={() => window.desktop?.maximize()}><Maximize2 size={12} /></button><button className="window-close" title="关闭窗口" aria-label="关闭窗口" onClick={() => window.desktop?.close()}><X size={15} /></button></div>}</div></div>
    <div className="app-body"><aside className="sidebar"><Brand /><WorkspaceSwitcher workspaces={workspaces} activeWorkspaceId={workspaceId} projects={allProjects.filter(project => !project.trashedAt)} onSelect={onSelectWorkspace} onRemove={onRemoveWorkspace} onRestore={onRestoreWorkspace} onCreate={onCreateWorkspace} onBind={id => workspaceFiles.bind(id)} onOpen={id => { void workspaceFiles.open(id); }} />
      <AppNavigation view={view} onNavigate={navigate} />
      <div className="sidebar-bottom"><button className="sidebar-budget sidebar-budget-compact" aria-label="真实调用账本" title={`真实调用账本 · ${costSummaryPrimary(liveCost)}${costSummarySecondary(liveCost) ? ` · ${costSummarySecondary(liveCost)}` : ''} · 本区月度预算 ${budgetLabel(preferences.monthlyBudget == null ? undefined : Math.round(preferences.monthlyBudget * 100))}`} onClick={() => navigate('finance')}><Wallet size={15} /><span>费用与报价</span><strong><CostTotal summary={liveCost} /></strong>{liveCost.pendingCount > 0 && <em title="软件会自动复算，无需填写费用；点击查看具体缺项。">+{liveCost.pendingCount} 待补齐</em>}<ChevronRight size={13} /></button><button className="profile-button focused-settings-button" aria-label="模型与设置" onClick={() => navigate('models')}><SettingsIcon size={17} /><span>模型与设置</span></button></div>
    </aside><div className="app-main"><header className="app-header"><div className="breadcrumb"><button type="button" className="breadcrumb-workspace" aria-label={`返回${workspace.name}创作对话`} onClick={() => navigate('overview')}>{workspace.name}</button><ChevronRight size={13} /><strong>{['documents', 'images'].includes(view) && activeProject.id ? activeProject.name : appViewLabel(view)}</strong></div><AppHeaderActions summary={navigationTasks} onNavigate={navigate} onSearch={showSearch} onNotifications={() => setNotificationOpen(value => !value)} onHelp={() => setHelpOpen(true)} onCreateProject={() => onCreateProject()} onOpenFolder={window.desktop?.workspaceFiles && workspace.directory ? () => { void workspaceFiles.open(workspaceId, ['documents', 'images'].includes(view) && activeProject.directory ? activeProject.id : undefined); } : undefined} notify={notify}><AutomationAttention workspaceId={workspaceId} onOpen={() => navigate('automation')} representedReviewRunIds={workflowRunner.runs.filter(run => run.workspaceId === workspaceId && run.status === 'waiting-review' && !run.hiddenAt && !run.trashedAt && projects.some(project => project.id === run.projectId)).map(run => run.id)} /></AppHeaderActions></header>
      <main className={`app-content content-${view}`}>{workflowRunner.simulationStorage?.issue && <StorageRecoveryBanner title="模拟任务历史" issue={workflowRunner.simulationStorage.issue} onExport={workflowRunner.simulationStorage.exportOriginal} onReload={workflowRunner.simulationStorage.reload} onReset={workflowRunner.simulationStorage.reset} />}{configuration.storageIssue && <StorageRecoveryBanner title="模型与工作流配置" issue={configuration.storageIssue} onExport={configuration.exportOriginalStorage} onReload={configuration.reloadStorage} onReset={configuration.resetStorage} />}{['documents', 'images'].includes(view) && !workspace.directory && <WorkspaceFolderBar workspace={workspace} project={['documents', 'images'].includes(view) && activeProject.id ? activeProject : undefined} onBind={() => { void workspaceFiles.bind(workspaceId); }} onOpen={projectId => { void workspaceFiles.open(workspaceId, projectId); }} />}{(projects.length === 0 && !['overview', 'projects', 'finance', 'assets', 'settings', 'prompts', 'categories', 'workflows', 'models', 'automation', 'tools', 'activity'].includes(view)) || (view === 'images' && !projects.some(item => item.kind === 'image')) || (view === 'documents' && !projects.some(item => item.kind !== 'image')) ? <EmptyWorkspace workspace={workspace} projectCount={projects.length} trashedProjectCount={trashedProjects.length} onOpenTrash={() => navigate('projects')} kind={view === 'images' ? 'image' : 'ppt'} onCreateProject={() => onCreateProject(view === 'images' ? 'image' : 'ppt')} onOpenPrompts={() => navigate('prompts')} /> : <div key={workspaceId} className="workspace-panel"><ManagementNavigation view={view} navigate={navigate} />{(view === 'documents' || view === 'images') && <Suspense fallback={null}><StudioRunStatus key={`${workspaceId}-${activeProject.id}`} props={props} /></Suspense>}<Suspense fallback={<div className="empty-state" role="status">正在打开页面…</div>}>{panels[view]()}</Suspense></div>}</main><footer className="statusbar"><span><ShieldCheck size={12} /> 数据仅存于本机浏览器 / 桌面应用</span><span>工作台 v{APP_VERSION} {window.desktop?.validationProfile && <span className="validation-profile-badge">独立测试窗口 · 非正式工作区</span>}<i /> 真实与模拟分开记录</span></footer>
    </div></div>

    {toast && <div role="status" className={`toast toast-${toast.type}`}><span>{toast.type === 'success' ? <Check size={16} /> : <CircleHelp size={16} />}</span>{toast.message}<button aria-label="关闭提示" onClick={() => setToast(null)}><X size={14} /></button></div>}
    {closingStatus && <ApplicationClosing {...closingStatus} />}
    {transitionDialog}
    {notificationOpen && <div className="notification-popover"><div><strong>最近调用记录</strong><button className="btn-icon" aria-label="关闭通知" onClick={() => setNotificationOpen(false)}><X size={15} /></button></div><p>调用记录保存在本机，真实与模拟分别标注。</p>{!ledger.length && <p>还没有调用记录。</p>}{ledger.slice(0, 4).map(item => <button key={item.id} onClick={() => navigate('activity', item.projectId)}><span className="notification-circle">{item.status === 'processing' ? <LoaderCircle size={15} className="spin" /> : item.status === 'complete' ? <Check size={15} /> : <X size={15} />}</span><span><strong>{item.projectName}</strong><small>{item.billingMode === 'live' ? '真实' : '模拟'} · {item.action} · {item.time}</small></span></button>)}</div>}

    {generationIntent && <Suspense fallback={<PreparingGeneration onCancel={() => setGenerationIntent(undefined)} />}><StudioRunDialog key={generationIntent.token} props={props} intent={generationIntent} onClose={() => setGenerationIntent(undefined)} /></Suspense>}
    {(newProject || projectFolderUnavailable) && !projectConnectionRecovery && <NewProjectDialog draft={newProject} workspaceName={workspaces.find(item => item.id === newProject?.selection.workspaceId)?.name || workspace.name} returnToSelection={projectCreationCompletion.current?.workspaceId === workspaceId} unavailable={projectFolderUnavailable} busy={creatingProject} picking={selectingProjectFolder} error={formError} onChange={changes => { setFormError(''); setNewProject(value => value && { ...value, ...changes }); }} onChooseFolder={() => { void changeProjectFolder(); }} onCreate={() => { void createProject(); }} onClose={closeNewProject} />}
    {projectConnectionRecovery && !creatingRecoveryWorkspace && <ProjectCreationRecovery workspaceName={workspaces.find(item => item.id === projectConnectionRecovery.workspaceId)?.name || workspace.name} directory={projectConnectionRecovery.directory} message={projectConnectionRecovery.message} connected={projectConnectionRecovery.connected} busy={selectingProjectFolder} onReconnect={() => { void reconnectProjectCreation(); }} onNewWorkspace={() => setCreatingRecoveryWorkspace(true)} onClose={closeProjectConnectionRecovery} />}
    {projectConnectionRecovery && creatingRecoveryWorkspace && <WorkspaceCreateDialog workspaces={workspaces} recovery onCreate={createRecoveryWorkspace} onClose={() => { if (!selectingProjectFolderRef.current) setCreatingRecoveryWorkspace(false); }} />}

    {pendingGeneration && <ModalPortal onClose={() => setPendingGeneration(null)} busy={false}><div className="modal-backdrop" onMouseDown={() => setPendingGeneration(null)}><section className="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="generation-heading" onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><span className="modal-heading-icon"><Sparkles size={23} /></span><button className="btn-icon" aria-label="关闭生成确认" onClick={() => setPendingGeneration(null)}><X size={18} /></button></div><h2 id="generation-heading">开始{pendingGeneration.action}演示？</h2><p className="muted">我们会模拟一次完整的任务，并新增一条独立的演示费用记录。</p><div className="confirmation-info"><span>当前项目</span><strong>{projects.find(item => item.id === pendingGeneration.projectId)?.name}</strong><span>本次演示费用</span><strong>¥{money(pendingCostCents)} · {pendingGeneration.count} 份</strong><span>剩余项目预算</span><strong>{pendingProject?.budgetCents == null ? '未设上限' : budgetLabel(Math.max(0, pendingProject.budgetCents - pendingProject.costCents - pendingCostCents))}</strong><span>费用性质</span><strong>虚构演示数据，不会真实扣费</strong><span>版本与记录</span><strong>生成新版本，原稿和历史费用保留</strong></div><div className="modal-actions"><button className="btn btn-secondary" onClick={() => setPendingGeneration(null)}>取消</button><button className="btn btn-primary" onClick={() => { startGeneration(pendingGeneration.projectId, pendingGeneration.action, pendingGeneration.count, pendingGeneration.onStarted); setPendingGeneration(null); }}><Sparkles size={15} />开始演示</button></div></section></div></ModalPortal>}

    {exportProject && <ModalPortal onClose={() => setExportId(null)} busy={exportBusy || savingProjectRecord}><div className="modal-backdrop" onMouseDown={() => !exportBusy && !savingProjectRecord && setExportId(null)}><section className="modal export-modal" role="dialog" aria-modal="true" aria-labelledby="export-heading" onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><span className="modal-heading-icon"><ArrowDownToLine size={22} /></span><button className="btn-icon" aria-label="关闭导出" disabled={exportBusy || savingProjectRecord} onClick={() => setExportId(null)}><X size={18} /></button></div><h2 id="export-heading">实际文件与记录导出</h2><p className="muted">{exportProject.name}</p>{exportBusy ? <div className="inline-notice"><LoaderCircle size={17} className="spin" />正在从当前草稿生成实际文件，不调用模型、不增加API费用。</div> : <ArtifactResults artifacts={manualArtifacts[exportProject.id] || latestProjectArtifacts(workflowRunner.runs, exportProject.id)} runner={workflowRunner} projectId={exportProject.id} />}<button className="export-option" disabled={savingProjectRecord || exportBusy} onClick={async () => { if (projectRecordPending.current) return; projectRecordPending.current = true; setSavingProjectRecord(true); setProjectRecordStatus(''); try { const saved = await downloadFile(`${exportProject.name}-项目备份.json`, JSON.stringify({ project: exportProject, documentDraft: documentDraft(exportProject.id), ledger: ledger.filter(item => item.projectId === exportProject.id), runs: workflowRunner.runs.filter(item => item.projectId === exportProject.id), note: '项目和运行记录备份；不包含API Key，不代替实际Office与媒体产物。' }, null, 2)); setProjectRecordStatus(saved ? '项目索引与运行记录已保存。' : '已取消保存，原记录仍保留。'); } catch (error) { setProjectRecordStatus(error instanceof Error ? error.message : '项目记录未能导出。'); } finally { projectRecordPending.current = false; setSavingProjectRecord(false); } }}><span className="icon-purple"><FileText size={23} /></span><div><strong>项目索引与运行记录（不含文件）</strong><small>{savingProjectRecord ? '正在保存记录…' : 'JSON · 实际文件请使用上方打开或另存'}</small></div><ArrowDownToLine size={18} /></button>{projectRecordStatus && <p role="status">{projectRecordStatus}</p>}<div className="inline-notice"><CircleHelp size={16} />文件请在 Office 或 WPS 中检查版式与公式；查看检查报告后再交付。</div></section></div></ModalPortal>}

    {searchOpen && <Suspense fallback={<div role="status">正在打开搜索…</div>}><GlobalSearch key={workspaceId} props={props} navigation={NAVIGATION} onClose={closeSearch} onNavigate={(next, projectId, target) => { const source = workspaceIdRef.current; setSearchOpen(false); void confirmTransition().then(allowed => { if (allowed && workspaceIdRef.current === source && (!target?.workspaceId || target.workspaceId === source)) { navigateNow(next, projectId); setSearchTarget(target ? { ...target, workspaceId: source } : undefined); } }); }} /></Suspense>}

    {helpOpen && <ModalPortal onClose={() => setHelpOpen(false)} busy={false}><div className="modal-backdrop" onMouseDown={() => setHelpOpen(false)}><section className="modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-heading" onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><Brand compact /><button className="btn-icon" aria-label="关闭帮助" onClick={() => setHelpOpen(false)}><X size={18} /></button></div><h2 id="help-heading">从需求，到可检查的实际文件。</h2><p className="muted">这是一套为个人自由职业者设计的本地创作与交付工作台。</p><div className="help-feature"><Check size={17} /><span>可以创建项目、编辑草稿、运行真实生成与精修流程</span></div><div className="help-feature"><Check size={17} /><span>真实与模拟分开记账，取消、失败与重试保留已知用量</span></div><div className="help-feature"><Check size={17} /><span>可以计算建议报价、检查实际文件和导出项目记录</span></div><div className="inline-notice">真实调用需要桌面密钥、匹配的接口与账户权限；未适配功能会拦截，Office公式和版式仍需人工检查。</div><button className="btn btn-primary full-width" onClick={() => { setHelpOpen(false); onCreateProject(); }}>开始体验 <ArrowRight size={15} /></button></section></div></ModalPortal>}
  </div>;
}
