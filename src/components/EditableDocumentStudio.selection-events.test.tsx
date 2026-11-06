// @vitest-environment jsdom
// Real React DOM events and production fields/hooks; not native geometry, IME,
// visual rendering, a provider call, or a Chromium/profile persistence claim.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, LedgerEntry, PageProps, Project } from '../types';
import type { EditorBridge, EditorDocument, EditorRecord, PresentationEditorDocument, WordBlock, WordEditorDocument } from '../editor-types';
import { INITIAL_PREFERENCES } from '../data';
import { readRecovery } from '../lib/editor-recovery';
import { EditableDocumentStudio } from './EditableDocumentStudio';

const stamp = '2026-11-07T00:00:00Z';
const deniedCalls: { name: string; count: () => number }[] = [];
const mounted: { root: Root; container: HTMLDivElement }[] = [];
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
let stored: [string, string][] = [];
let desktopDescriptor: PropertyDescriptor | undefined;

function forbidden(name: string) {
  const spy = vi.fn(() => { throw Error(`Selection event fixture must not call ${name}`); });
  deniedCalls.push({ name, count: () => spy.mock.calls.length });
  return spy;
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function assertNoDispatch() {
  expect(deniedCalls.filter(call => call.count() !== 0).map(call => ({ name: call.name, count: call.count() }))).toEqual([]);
}

beforeEach(() => {
  stored = Array.from({ length: localStorage.length }, (_, index): [string, string] => {
    const key = localStorage.key(index)!;
    return [key, localStorage.getItem(key)!];
  });
  localStorage.clear(); desktopDescriptor = Object.getOwnPropertyDescriptor(window, 'desktop');
  deniedCalls.length = 0; frames.clear(); frameId = 0;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // Only frame scheduling is controlled; no field, selection, focus, hook, or
  // editing algorithm is replaced. JSDOM supplies no usable layout measurements.
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++frameId; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  vi.stubGlobal('fetch', forbidden('network fetch'));
  const resource = forbidden('network resource');
  vi.stubGlobal('XMLHttpRequest', class { constructor() { resource(); } });
  vi.stubGlobal('WebSocket', class { constructor() { resource(); } });
  vi.stubGlobal('Image', class { constructor() { resource(); } });
});
afterEach(async () => {
  try {
    for (const item of mounted.splice(0).reverse()) {
      try { await act(async () => { item.root.unmount(); }); }
      finally { item.container.remove(); }
    }
    expect(frames.size).toBe(0); assertNoDispatch();
  } finally {
    frames.clear();
    if (desktopDescriptor) Object.defineProperty(window, 'desktop', desktopDescriptor); else delete window.desktop;
    vi.unstubAllGlobals(); vi.restoreAllMocks();
    localStorage.clear(); for (const [key, value] of stored) localStorage.setItem(key, value);
    deniedCalls.length = 0;
  }
});

function paragraph(id: string, text: string): WordBlock {
  return { id, type: 'paragraph', text, fontSize: 12, bold: false, italic: false, align: 'left' };
}
function word(): WordEditorDocument {
  return { schemaVersion: 1, kind: 'word', title: '隔离文字事件', blocks: [paragraph('paragraph-1', '甲原句；乙原句'), paragraph('paragraph-2', '另一段原文')] };
}
function presentation(body: string): PresentationEditorDocument {
  return { schemaVersion: 1, kind: 'ppt', title: '隔离双栏事件', theme: 'paper', slides: [
    { id: 'slide-1', title: '第一页标题', body, notes: '第一页讲稿保持', layout: 'two-columns', fontSize: 20, align: 'left' },
    { id: 'slide-2', title: '第二页标题', body: '第二页正文保持', notes: '第二页讲稿保持', layout: 'title-body', fontSize: 20, align: 'left' },
  ] };
}

async function mountStudio(seed: EditorDocument) {
  const project: Project = { id: `dom-${seed.kind}-project`, workspaceId: 'dom-workspace', name: seed.title, kind: seed.kind, status: 'draft', description: '仅本地DOM事件，不能发起生成', updatedAt: stamp, costCents: 5, version: 1, accent: 'purple' };
  const workspace = { id: project.workspaceId, name: '隔离事件工作区', description: '', createdAt: stamp };
  const ledger = deepFreeze<LedgerEntry[]>([{ id: 'existing-fee', projectId: project.id, projectName: project.name, action: 'AI 精修', model: 'Synthetic historical model', costCents: 5, billingMode: 'live', costState: 'calculated', status: 'complete', time: stamp, workflowRunId: 'existing-run', workflowStepId: 'existing-step', workflowAttemptId: 'existing-attempt', usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, providerRequestId: 'synthetic-existing-request' }, calculation: { version: 1, ruleId: 'synthetic-frozen', ruleVersion: '1', nativeCurrency: 'USD', nativeAmount: '0.00603', cnyAmount: '0.04016966037735978', components: [{ code: 'request', label: 'Synthetic historical fee', quantity: 1, unit: 'request', unitPrice: '0.00603', amount: '0.00603', currency: 'USD' }], completeness: 'complete', basis: 'Synthetic nonempty fee fixture, not a new account charge' } }]);
  const ledgerBefore = JSON.stringify(ledger), row = ledger[0], calculation = row.calculation, usage = row.usage;
  const saved: EditorRecord = { version: 1, projectId: project.id, revision: 1, savedAt: stamp, document: structuredClone(seed), sourceArtifactIds: [] };
  const editor: EditorBridge = {
    load: vi.fn(async () => structuredClone(saved)),
    history: vi.fn(async () => [{ revision: 1, savedAt: stamp, title: seed.title, kind: seed.kind }]),
    save: forbidden('editor.save'), export: forbidden('editor.export'), loadVersion: forbidden('editor.loadVersion'), restore: forbidden('editor.restore'),
  };
  const desktop: DesktopBridge = {
    editor,
    runtime: {
      status: forbidden('runtime.status'), preflight: forbidden('runtime.preflight'), start: forbidden('runtime.start'), control: forbidden('runtime.control'), snapshot: forbidden('runtime.snapshot'), reconcile: forbidden('runtime.reconcile'),
      exportDraft: forbidden('runtime.exportDraft'), importFiles: forbidden('runtime.importFiles'), previewArtifact: forbidden('runtime.previewArtifact'), openArtifact: forbidden('runtime.openArtifact'), saveArtifact: forbidden('runtime.saveArtifact'),
      trashArtifact: forbidden('runtime.trashArtifact'), restoreArtifact: forbidden('runtime.restoreArtifact'), listTrashedArtifacts: forbidden('runtime.listTrashedArtifacts'), probe: forbidden('runtime.probe'),
    },
    credentials: { status: forbidden('credentials.status'), list: forbidden('credentials.list'), save: forbidden('credentials.save'), setEnabled: forbidden('credentials.setEnabled') },
    minimize: forbidden('desktop.minimize'), maximize: forbidden('desktop.maximize'), close: forbidden('desktop.close'),
  };
  Object.defineProperty(window, 'desktop', { configurable: true, value: desktop });
  const props: PageProps = {
    activeView: 'documents', activeProject: project, projects: [project], trashedProjects: [], workspaceId: workspace.id, workspace, workspaces: [workspace], ledger, preferences: { ...INITIAL_PREFERENCES }, prompts: [],
    configuration: {
      categories: [], workflows: [], connections: [], models: [], credentials: [], studioActions: [], useTemplates: [], vaultStatus: { available: false, reason: 'No credential access in this fixture' },
      reloadStorage: forbidden('configuration.reloadStorage'), exportOriginalStorage: forbidden('configuration.exportOriginalStorage'), resetStorage: forbidden('configuration.resetStorage'),
      saveUseTemplate: forbidden('configuration.saveUseTemplate'), deleteUseTemplate: forbidden('configuration.deleteUseTemplate'), saveStudioAction: forbidden('configuration.saveStudioAction'), setStudioActionEnabled: forbidden('configuration.setStudioActionEnabled'),
      saveCategory: forbidden('configuration.saveCategory'), archiveCategory: forbidden('configuration.archiveCategory'), saveWorkflow: forbidden('configuration.saveWorkflow'), duplicateWorkflow: forbidden('configuration.duplicateWorkflow'),
      saveConnection: forbidden('configuration.saveConnection'), checkConnection: forbidden('configuration.checkConnection'), setConnectionEnabled: forbidden('configuration.setConnectionEnabled'), saveModel: forbidden('configuration.saveModel'), setModelEnabled: forbidden('configuration.setModelEnabled'),
      saveCredential: forbidden('configuration.saveCredential'), setCredentialEnabled: forbidden('configuration.setCredentialEnabled'), refreshCredentials: forbidden('configuration.refreshCredentials'),
    },
    workflowRunner: {
      runs: [], trashedArtifacts: [], runtimeStatus: { available: false, reason: 'Only local editing is permitted' }, listProjectArtifacts: vi.fn(async () => []),
      startLive: forbidden('runner.startLive'), start: forbidden('runner.start'), preflight: forbidden('runner.preflight'), readStartResult: forbidden('runner.readStartResult'), pause: forbidden('runner.pause'), resume: forbidden('runner.resume'), cancel: forbidden('runner.cancel'), retry: forbidden('runner.retry'),
      importFiles: forbidden('runner.importFiles'), previewArtifact: forbidden('runner.previewArtifact'), openArtifact: forbidden('runner.openArtifact'), saveArtifact: forbidden('runner.saveArtifact'),
      trashArtifact: forbidden('runner.trashArtifact'), restoreArtifact: forbidden('runner.restoreArtifact'), listTrashedArtifacts: forbidden('runner.listTrashedArtifacts'), reconcileCost: forbidden('runner.reconcileCost'),
    },
    notify: vi.fn(), onUpdateProject: vi.fn(), onGenerate: forbidden('onGenerate'), onExport: forbidden('onExport'), navigate: forbidden('navigate'), onCreateProject: forbidden('onCreateProject'), onMoveProject: forbidden('onMoveProject'),
    onGenerationIntentConsumed: forbidden('onGenerationIntentConsumed'), onUseStudioAction: forbidden('onUseStudioAction'), onPromptApplied: forbidden('onPromptApplied'), onSavePrompt: forbidden('onSavePrompt'), onUsePrompt: forbidden('onUsePrompt'), onTrashProject: forbidden('onTrashProject'), onRestoreProject: forbidden('onRestoreProject'), onUpdatePreferences: forbidden('onUpdatePreferences'),
  };
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); mounted.push({ root, container });
  await act(async () => { root.render(<EditableDocumentStudio {...props} />); });
  expect(editor.load).toHaveBeenCalledExactlyOnceWith({ projectId: project.id, kind: seed.kind, title: seed.title });
  const draft = () => {
    const stored = readRecovery(localStorage, project.id, seed.kind); expect(stored).toBeDefined();
    if (!stored) throw Error('The real recovery effect did not persist a complete canonical draft');
    expect(stored.baseRevision).toBe(1); expect(stored.sourceArtifactIds).toEqual([]); return stored.document;
  };
  expect(draft()).toEqual(seed);
  const cost = container.querySelector('.sw-status'); expect(cost).not.toBeNull();
  const costBefore = cost!.textContent; expect(costBefore).toContain('项目调用费用');
  const assertExpenses = () => {
    expect(props.ledger).toBe(ledger); expect(props.ledger[0]).toBe(row); expect(row.calculation).toBe(calculation); expect(row.usage).toBe(usage);
    expect(Object.isFrozen(ledger) && Object.isFrozen(row) && Object.isFrozen(calculation) && Object.isFrozen(calculation?.components) && Object.isFrozen(usage)).toBe(true);
    expect(JSON.stringify(ledger)).toBe(ledgerBefore); expect(container.querySelector('.sw-status')?.textContent).toBe(costBefore); assertNoDispatch();
  };
  assertExpenses(); return { container, draft, assertExpenses };
}
type Fixture = Awaited<ReturnType<typeof mountStudio>>;

function field(fixture: Fixture, label: string) {
  const matches = [...fixture.container.querySelectorAll<HTMLTextAreaElement>('textarea')].filter(element => element.getAttribute('aria-label') === label);
  expect(matches).toHaveLength(1); return matches[0];
}
function localButton(fixture: Fixture, direction: 'undo' | 'redo') {
  const label = direction === 'undo' ? '仅撤销选中内容' : '仅重做选中内容';
  const matches = [...fixture.container.querySelectorAll<HTMLButtonElement>('button')].filter(element => element.getAttribute('aria-label') === label);
  expect(matches).toHaveLength(1); return matches[0];
}
async function input(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    element.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!setter) throw Error('JSDOM must expose the real textarea value setter');
    setter.call(element, value);
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  });
  expect(element.value).toBe(value);
}
async function select(element: HTMLTextAreaElement, start: number, end: number) {
  await act(async () => {
    element.focus(); element.setSelectionRange(start, end);
    element.dispatchEvent(new Event('select', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  expect(document.activeElement).toBe(element); expect(element.selectionStart).toBe(start); expect(element.selectionEnd).toBe(end);
}
async function frame() {
  const pending = [...frames.values()]; frames.clear(); expect(pending.length).toBeGreaterThan(0);
  await act(async () => { for (const callback of pending) callback(0); });
}
async function localAction(fixture: Fixture, element: HTMLTextAreaElement, direction: 'undo' | 'redo', start: number, end: number) {
  const button = localButton(fixture, direction); expect(button.disabled).toBe(false);
  await act(async () => {
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    expect(button.dispatchEvent(down)).toBe(false); expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(element);
    // Normal pointer-down preserves focus. Explicitly losing focus also must not
    // discard the saved range (e.g. keyboard/assistive focus before activation).
    element.blur(); button.focus(); expect(document.activeElement).toBe(button);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await frame(); await frame();
  expect(document.activeElement).toBe(element); expect(element.selectionStart).toBe(start); expect(element.selectionEnd).toBe(end);
  expect(frames.size).toBe(0); fixture.assertExpenses();
}

describe('真实文档字段与局部历史工具栏的React DOM事件链（非Native UI）', () => {
  it('Word鼠标选中甲句，toolbar失焦撤销与重做只改变甲句并恢复选区', async () => {
    const seed = word(), fixture = await mountStudio(seed), first = field(fixture, '段落 1 内容'), second = field(fixture, '段落 2 内容');
    await input(first, '甲精修稿；乙原句'); await input(second, '另一段后改'); await input(first, '甲精修稿；乙用户后改');
    await select(first, 0, 4); await localAction(fixture, first, 'undo', 0, 3);
    const expected = structuredClone(seed); expected.blocks[0].text = '甲原句；乙用户后改'; expected.blocks[1].text = '另一段后改';
    expect(fixture.draft()).toEqual(expected); expect(first.value).toBe(expected.blocks[0].text); expect(second.value).toBe('另一段后改');
    await localAction(fixture, first, 'redo', 0, 4); expected.blocks[0].text = '甲精修稿；乙用户后改';
    expect(fixture.draft()).toEqual(expected); fixture.assertExpenses();
  });

  it('Word表格单元格使用真实cell字段与工具栏，邻格及其他段落的后改保留', async () => {
    const seed = word(); seed.blocks[0] = { ...paragraph('table-1', ''), type: 'table', table: { columns: [{ id: 'col-1' }, { id: 'col-2' }], rows: [{ id: 'row-1', cells: [{ id: 'cell-1', text: '甲原句；乙原句' }, { id: 'cell-2', text: '邻格原文' }] }], header: true, borders: true } };
    const fixture = await mountStudio(seed), first = field(fixture, '表格 1 第 1 行第 1 列'), neighbor = field(fixture, '表格 1 第 1 行第 2 列'), otherParagraph = field(fixture, '段落 2 内容');
    await input(first, '甲新稿；乙原句'); await input(neighbor, '邻格后改'); await input(otherParagraph, '另一段后改'); await input(first, '甲新稿；乙用户后改');
    await select(first, 0, 3); await localAction(fixture, first, 'undo', 0, 3);
    const expected = structuredClone(seed); expected.blocks[0].table!.rows[0].cells[0].text = '甲原句；乙用户后改'; expected.blocks[0].table!.rows[0].cells[1].text = '邻格后改'; expected.blocks[1].text = '另一段后改';
    expect(fixture.draft()).toEqual(expected);
    await localAction(fixture, first, 'redo', 0, 3); expected.blocks[0].table!.rows[0].cells[0].text = '甲新稿；乙用户后改';
    expect(fixture.draft()).toEqual(expected); fixture.assertExpenses();
  });

  it('PPT显式双栏右侧局部恢复使用全文偏移，左栏、其他页和讲稿不改变', async () => {
    const seed = presentation('左栏原文\n---\n甲原句；乙原句'), fixture = await mountStudio(seed);
    const left = field(fixture, '当前幻灯片左栏正文'), right = field(fixture, '当前幻灯片右栏正文');
    expect(right.dataset.editOffset).toBe(String('左栏原文\n---\n'.length));
    await input(right, '甲新稿；乙原句'); await input(left, '左栏后改'); await input(right, '甲新稿；乙用户后改');
    expect(right.dataset.editOffset).toBe(String('左栏后改\n---\n'.length));
    await select(right, 0, 3); await localAction(fixture, right, 'undo', 0, 3);
    const expected = structuredClone(seed); expected.slides[0].body = '左栏后改\n---\n甲原句；乙用户后改'; expect(fixture.draft()).toEqual(expected);
    await localAction(fixture, right, 'redo', 0, 3); expected.slides[0].body = '左栏后改\n---\n甲新稿；乙用户后改';
    expect(fixture.draft()).toEqual(expected); fixture.assertExpenses();
  });

  it('PPT隐式空左栏首次输入更新offset，后续选区恢复不吞分栏与范围外文字', async () => {
    const seed = presentation('\n甲原句'), fixture = await mountStudio(seed), left = field(fixture, '当前幻灯片左栏正文'), right = field(fixture, '当前幻灯片右栏正文');
    expect(left.value).toBe(''); expect(right.value).toBe('甲原句'); expect(right.dataset.editOffset).toBe('1');
    await input(right, '甲新稿'); expect(right.dataset.editOffset).toBe('5'); await input(right, '甲新稿；乙用户后改');
    await select(right, 0, 3); await localAction(fixture, right, 'undo', 0, 3);
    const expected = structuredClone(seed); expected.slides[0].body = '\n---\n甲原句；乙用户后改';
    expect(fixture.draft()).toEqual(expected); expect(left.value).toBe(''); expect(right.dataset.editOffset).toBe('5');
    await localAction(fixture, right, 'redo', 0, 3); expected.slides[0].body = '\n---\n甲新稿；乙用户后改';
    expect(fixture.draft()).toEqual(expected); fixture.assertExpenses();
  });

  it('真实DOM的Unicode半代理与组合重音选区被拒绝，重选完整字符后仍可撤销重做', async () => {
    const seed = word(); seed.blocks[0].text = '首🙂和e\u0301尾';
    const fixture = await mountStudio(seed), first = field(fixture, '段落 1 内容');
    const changed = '首🌟和e\u0300尾'; await input(first, changed);
    const beforeInvalid = fixture.draft(); await select(first, 1, 2);
    expect(localButton(fixture, 'undo').disabled).toBe(true); expect(fixture.container.textContent).toContain('请重新选择完整文字');
    await act(async () => { localButton(fixture, 'undo').click(); }); expect(fixture.draft()).toEqual(beforeInvalid);
    await select(first, 1, 3); await localAction(fixture, first, 'undo', 1, 3);
    const expected = structuredClone(seed); expected.blocks[0].text = '首🙂和e\u0300尾'; expect(fixture.draft()).toEqual(expected);
    await localAction(fixture, first, 'redo', 1, 3); expected.blocks[0].text = changed; expect(fixture.draft()).toEqual(expected);
    await select(first, 4, 5); expect(localButton(fixture, 'undo').disabled).toBe(true);
    await act(async () => { localButton(fixture, 'undo').click(); }); expect(fixture.draft()).toEqual(expected);
    await select(first, 4, 6); await localAction(fixture, first, 'undo', 4, 6); expected.blocks[0].text = '首🌟和e\u0301尾'; expect(fixture.draft()).toEqual(expected);
    await localAction(fixture, first, 'redo', 4, 6); expected.blocks[0].text = changed; expect(fixture.draft()).toEqual(expected); fixture.assertExpenses();
  });
});
