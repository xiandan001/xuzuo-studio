import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloneElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PageProps } from '../types';
import type { WorkflowAttempt, WorkflowRun, WorkflowRunner } from '../configuration-types';
import type { ArtifactMetadata, ArtifactPreview } from '../live-types';
import { ArtifactResults } from './ArtifactResults';
import { WorkflowRunCard } from './WorkflowRunCard';

// The existing controlled-hook convention, with separate keyed frames so the
// real card -> attempt -> result composition also exercises remount cleanup.
const hooks = vi.hoisted(() => {
  type Effect = { deps?: readonly unknown[]; cleanup?: () => void };
  type Frame = { slots: unknown[]; cursor: number; live: boolean; effects: Map<number, Effect> };
  const frames = new Map<string, Frame>();
  let active: Frame | undefined, changed = false;
  let seen = new Set<string>(), pending: { frame: Frame; index: number; action: () => void | (() => void); deps?: readonly unknown[] }[] = [];
  const close = (frame: Frame) => { frame.live = false; for (const effect of frame.effects.values()) effect.cleanup?.(); };
  const current = () => { if (!active) throw Error('Hook used outside controlled component'); return active; };
  const differs = (before?: readonly unknown[], after?: readonly unknown[]) => !before || !after || before.length !== after.length || after.some((value, index) => !Object.is(value, before[index]));
  return {
    reset() { for (const frame of frames.values()) close(frame); frames.clear(); active = undefined; pending = []; },
    begin() { changed = false; seen = new Set(); pending = []; },
    enter(id: string) {
      let frame = frames.get(id);
      if (!frame) { frame = { slots: [], cursor: 0, live: true, effects: new Map() }; frames.set(id, frame); }
      frame.cursor = 0; active = frame; seen.add(id);
    },
    leave() { active = undefined; },
    changed: () => changed,
    useState(initial: unknown) {
      const frame = current(), index = frame.cursor++;
      if (!(index in frame.slots)) frame.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [frame.slots[index], (value: unknown) => {
        if (!frame.live) return;
        const next = typeof value === 'function' ? value(frame.slots[index]) : value;
        if (!Object.is(next, frame.slots[index])) { frame.slots[index] = next; changed = true; }
      }];
    },
    useRef(initial: unknown) { const frame = current(), index = frame.cursor++; if (!(index in frame.slots)) frame.slots[index] = { current: initial }; return frame.slots[index]; },
    useMemo(factory: () => unknown, deps?: readonly unknown[]) {
      const frame = current(), index = frame.cursor++, previous = frame.slots[index] as { value: unknown; deps?: readonly unknown[] } | undefined;
      if (!previous || differs(previous.deps, deps)) frame.slots[index] = { value: factory(), deps };
      return (frame.slots[index] as { value: unknown }).value;
    },
    useEffect(action: () => void | (() => void), deps?: readonly unknown[]) {
      const frame = current(), index = frame.cursor++;
      if (!frame.effects.has(index) || differs(frame.effects.get(index)?.deps, deps)) pending.push({ frame, index, action, deps });
    },
    commit() {
      for (const [id, frame] of frames) if (!seen.has(id)) { close(frame); frames.delete(id); }
      const queued = pending; pending = [];
      for (const item of queued) if (item.frame.live) {
        item.frame.effects.get(item.index)?.cleanup?.(); const cleanup = item.action();
        item.frame.effects.set(item.index, { deps: item.deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined });
      }
    },
  };
});
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: hooks.useState, useRef: hooks.useRef, useMemo: hooks.useMemo, useCallback: (callback: unknown, deps?: readonly unknown[]) => hooks.useMemo(() => callback, deps), useEffect: hooks.useEffect }));
vi.mock('../hooks/useRememberedBoolean', () => ({ useRememberedBoolean: (_key: string, fallback: boolean) => hooks.useState(fallback) }));
vi.mock('./RememberedDetails', () => ({ RememberedDetails: ({ children, className }: { children: ReactNode; className?: string }) => <details open className={className}>{children}</details> }));
vi.mock('./ModalPortal', () => ({ ModalPortal: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('./TaskRunActions', () => ({ TaskRunActions: () => null }));
vi.mock('./Select', () => ({ Select: ({ options, value, onValueChange, ...props }: { options: { value: string; label: string }[]; value: string; onValueChange: (value: string) => void; 'aria-label'?: string }) => <select {...props} value={value} onChange={event => onValueChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }));

type Element = ReactElement<Record<string, unknown>>;
function expand(node: ReactNode, path = 'root'): ReactNode {
  if (Array.isArray(node)) return node.map((child, index) => expand(child, `${path}/${isValidElement(child) && child.key !== null ? child.key : index}`));
  if (!isValidElement<Record<string, unknown>>(node)) return node;
  if (typeof node.type === 'function') {
    const id = `${path}:${node.type.name}:${node.key || ''}`;
    hooks.enter(id); let rendered: ReactNode;
    try { rendered = (node.type as (props: Record<string, unknown>) => ReactNode)(node.props); }
    finally { hooks.leave(); }
    return expand(rendered, id);
  }
  return cloneElement(node, undefined, expand(node.props.children as ReactNode, `${path}/children`));
}
function all(node: ReactNode, matches: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap(child => all(child, matches));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(matches(node) ? [node] : []), ...all(node.props.children as ReactNode, matches)];
}
function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : '';
}
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function view(component: () => ReactElement) {
  hooks.reset(); let tree: ReactNode;
  const render = () => {
    for (let pass = 0; pass < 12; pass++) {
      hooks.begin(); tree = expand(component()); const html = renderToStaticMarkup(<>{tree}</>); hooks.commit();
      if (!hooks.changed()) return html;
    }
    throw Error('Controlled artifact result did not settle');
  };
  const button = (label: string) => {
    const found = all(tree, item => item.type === 'button' && (item.props['aria-label'] === label || text(item.props.children as ReactNode) === label));
    if (found.length !== 1) throw Error(`Expected one button: ${label}; got ${found.length}`);
    return found[0];
  };
  const settle = async () => { for (let index = 0; index < 3; index++) { render(); await flush(); } return render(); };
  render();
  return { render, settle, tree: () => tree, button, click(label: string) { const found = button(label); expect(found.props.disabled).not.toBe(true); (found.props.onClick as () => void)(); } };
}
function rows(tree: ReactNode) { return all(tree, item => item.type === 'article' && String(item.props.className).split(' ').includes('ar-file')); }
function rowNames(tree: ReactNode) { return rows(tree).map(row => all(row, item => item.type === 'strong')[0].props.title); }
function file(id: string, changes: Partial<ArtifactMetadata> = {}): ArtifactMetadata {
  return { id, name: `${id}.docx`, kind: 'office', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', projectId: 'project', runId: 'local-export', bytes: 100, path: `managed/${id}`, createdAt: '2026-11-06T00:00:00Z', ...changes };
}
const current = () => file('current', { name: '当前版本.docx' });
const report = () => file('current-check', { name: '当前版本-检查报告.json', kind: 'text', mimeType: 'application/json' });
function attempt(id: string, artifacts: ArtifactMetadata[], changes: Partial<WorkflowAttempt> = {}): WorkflowAttempt {
  return { id, stepId: 'export', stepName: '保存编辑后的文件', modelLabel: '本地编辑', status: 'complete', costCents: 0, costState: 'not-incurred', summary: '', input: '', prompt: '', action: 'AI 精修', artifacts, ...changes };
}
function run(attempts: WorkflowAttempt[]): WorkflowRun {
  return { id: 'local-export', workspaceId: 'workspace', projectId: 'project', mode: 'live', workflowId: 'local-export', workflowName: '本地编辑导出', status: 'complete', stepIndex: 1,
    snapshot: { id: 'local-export', workspaceId: 'workspace', name: '本地导出', description: '', outputKind: 'word', updatedAt: '', steps: [{ id: 'export', name: '保存编辑后的文件', kind: 'export', prompt: '', inputSource: 'project', enabled: true }] },
    attempts, variables: {}, input: '', createdAt: '2026-11-06T00:00:00Z', updatedAt: '2026-11-06T00:00:00Z' };
}
function fixture(files: ArtifactMetadata[], trash: ArtifactMetadata[] = [], runs: WorkflowRun[] = []) {
  const store = { files, trash };
  const controls = { start: vi.fn(), startLive: vi.fn(), retry: vi.fn(), resume: vi.fn(), pause: vi.fn(), cancel: vi.fn(), reconcileCost: vi.fn() };
  const runner = { ...controls, runs, trashedArtifacts: trash,
    listProjectArtifacts: vi.fn(async () => store.files), listTrashedArtifacts: vi.fn(async () => store.trash),
    previewArtifact: vi.fn(async (_id: string): Promise<ArtifactPreview> => ({ mimeType: current().mimeType, text: '当前文件完整内容' })),
    openArtifact: vi.fn(async (_id: string) => undefined), saveArtifact: vi.fn(async (_id: string) => ({ saved: true })),
    trashArtifact: vi.fn(async (id: string): Promise<void> => {
      store.files = store.files.map(item => item.id === id ? { ...item, trashedAt: '2026-11-06T01:00:00Z' } : item);
      store.trash = store.files.filter(item => item.trashedAt); runner.trashedArtifacts = store.trash;
    }),
    restoreArtifact: vi.fn(async (id: string): Promise<void> => {
      store.files = store.files.map(item => item.id === id ? { ...item, trashedAt: undefined } : item);
      store.trash = store.trash.filter(item => item.id !== id); runner.trashedArtifacts = store.trash;
    }),
  } satisfies Partial<WorkflowRunner>;
  return { store, controls, runner: runner as unknown as WorkflowRunner, io: runner };
}
function pageProps(runner: WorkflowRunner): PageProps {
  const project = { id: 'project', workspaceId: 'workspace', kind: 'word', name: '本地项目', status: 'draft', version: 0, costCents: 123, accent: 'blue', updatedAt: '' };
  return { workspaceId: 'workspace', activeProject: project, projects: [project], workflowRunner: runner, preferences: { confirmGeneration: true },
    ledger: [{ id: 'historical-fee', projectId: 'project', projectName: '本地项目', action: '初次生成', model: '已发生的调用', costCents: 123, time: '2026-11-06T00:00:00Z', status: 'complete', billingMode: 'live', costState: 'calculated' }], navigate: vi.fn(), notify: vi.fn() } as unknown as PageProps;
}
function expectNoModelCalls(controls: ReturnType<typeof fixture>['controls']) { for (const operation of Object.values(controls)) expect(operation).not.toHaveBeenCalled(); }

beforeEach(() => { vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() }); });
afterEach(() => { hooks.reset(); vi.unstubAllGlobals(); });

describe('attempt results remain separate from complete project inventory', () => {
  it('shows only the selected local export and its report, Office first, and acts on those IDs', async () => {
    const document = current(), check = report(), old = file('old'), foreign = file('foreign', { projectId: 'other-project' });
    const source = file('source', { name: '生成源稿.txt', kind: 'text', mimeType: 'text/plain' });
    const history = run([attempt('current-attempt', [check, document])]);
    const f = fixture([old, source, foreign, check, document], [], [history]);
    const original = JSON.stringify(history);
    const ui = view(() => <ArtifactResults fileScope="attempt" projectId="project" artifacts={[check, document, foreign]} runner={f.runner} />);
    await ui.settle();
    expect(rowNames(ui.tree())).toEqual([document.name, check.name]);
    expect(ui.render()).toContain('本次产物'); expect(ui.render()).not.toContain('刷新项目文件');
    ui.click(`预览产物 ${document.name}`); await ui.settle();
    expect(ui.render()).toContain('当前文件完整内容'); expect(f.io.previewArtifact).toHaveBeenCalledWith(document.id);
    ui.click('关闭产物预览'); ui.render(); ui.click(`打开产物 ${document.name}`); await ui.settle();
    ui.click(`另存产物 ${check.name}`); await ui.settle(); ui.click('刷新本次产物'); await ui.settle();
    expect(f.io.openArtifact).toHaveBeenCalledWith(document.id); expect(f.io.saveArtifact).toHaveBeenCalledWith(check.id);
    expect(f.io.listProjectArtifacts).toHaveBeenLastCalledWith('project', { refresh: true });
    expect(rowNames(ui.tree())).toEqual([document.name, check.name]); expect(JSON.stringify(history)).toBe(original); expectNoModelCalls(f.controls);
  });

  it('keeps missing current output visible and disabled instead of substituting an older healthy export', async () => {
    const document = current(), missing = { ...document, unavailable: true, unavailableReason: '原文件不在原位置' };
    const f = fixture([file('older-healthy'), missing]);
    const ui = view(() => <ArtifactResults fileScope="attempt" projectId="project" artifacts={[document]} runner={f.runner} />);
    await ui.settle();
    expect(rowNames(ui.tree())).toEqual([document.name]); expect(ui.render()).toContain(missing.unavailableReason);
    for (const action of ['预览', '打开', '另存', '移入回收站']) expect(ui.button(`${action}产物 ${document.name}`).props.disabled).toBe(true);
    expect(f.io.previewArtifact).not.toHaveBeenCalled(); expect(f.io.openArtifact).not.toHaveBeenCalled(); expect(f.io.saveArtifact).not.toHaveBeenCalled(); expectNoModelCalls(f.controls);
  });

  it('filters global trash to this attempt and restores only its member without changing history or fees', async () => {
    const document = current(), recycled = { ...document, trashedAt: '2026-11-06T01:00:00Z' }, oldTrash = file('old-trash', { trashedAt: recycled.trashedAt });
    const foreign = file('foreign-trash', { projectId: 'other-project', trashedAt: recycled.trashedAt });
    const history = run([attempt('export-attempt', [document])]), f = fixture([recycled, oldTrash, foreign], [recycled, oldTrash, foreign], [history]);
    const props = pageProps(f.runner), original = JSON.stringify({ history, ledger: props.ledger });
    const ui = view(() => <ArtifactResults fileScope="attempt" projectId="project" artifacts={[document]} runner={f.runner} />);
    await ui.settle(); ui.click('回收站'); await ui.settle();
    expect(ui.render()).toContain('本次产物回收站'); expect(rowNames(ui.tree())).toEqual([document.name]);
    ui.click(`恢复产物 ${document.name}`); await ui.settle();
    expect(f.io.restoreArtifact).toHaveBeenCalledExactlyOnceWith(document.id); expect(rowNames(ui.tree())).toEqual([]);
    ui.click('返回产物'); await ui.settle(); expect(rowNames(ui.tree())).toEqual([document.name]);
    expect(ui.button(`预览产物 ${document.name}`).props.disabled).not.toBe(true);
    expect(JSON.stringify({ history, ledger: props.ledger })).toBe(original); expectNoModelCalls(f.controls);
  });

  it('also scopes freshly read recycle fallback and subsequent trash/restore to supplied IDs', async () => {
    const document = current(), old = file('unrelated'), f = fixture([document, old]);
    const ui = view(() => <ArtifactResults fileScope="attempt" projectId="project" artifacts={[document]} runner={f.runner} />);
    await ui.settle(); ui.click(`移入回收站产物 ${document.name}`); ui.render(); ui.click('确认移入回收站'); await ui.settle();
    expect(f.io.trashArtifact).toHaveBeenCalledExactlyOnceWith(document.id);
    f.store.trash = [...f.store.trash, { ...old, trashedAt: '2026-11-06T01:00:00Z' }]; f.runner.trashedArtifacts = undefined;
    ui.click('回收站'); await ui.settle(); expect(rowNames(ui.tree())).toEqual([document.name]);
    ui.click(`恢复产物 ${document.name}`); await ui.settle(); expect(rowNames(ui.tree())).toEqual([]);
    expect(f.store.trash.map(item => item.id)).toEqual([old.id]); expectNoModelCalls(f.controls);
  });

  it('preserves every image, deduplicates IDs, accepts explicitly reused runs and rejects other projects', async () => {
    const images = Array.from({ length: 5 }, (_, index) => file(`image-${index}`, { name: `图片${index}.png`, kind: 'image', mimeType: 'image/png', runId: index ? 'current-run' : 'older-source-run' }));
    const old = file('unrelated-image', { kind: 'image', mimeType: 'image/png' }), foreign = file('foreign-image', { projectId: 'foreign', kind: 'image', mimeType: 'image/png' });
    const f = fixture([...images, old, foreign]);
    const ui = view(() => <ArtifactResults fileScope="attempt" projectId="project" artifacts={[...images, images[0], foreign]} runner={f.runner} />);
    await ui.settle(); expect(rowNames(ui.tree())).toEqual(images.map(image => image.name)); expect(rows(ui.tree())).toHaveLength(5);
    ui.click(`另存产物 ${images[0].name}`); await ui.settle(); expect(f.io.saveArtifact).toHaveBeenCalledExactlyOnceWith(images[0].id); expectNoModelCalls(f.controls);
  });

  it('retains full project inventory and project-wide recycle discovery by default', async () => {
    const document = current(), orphan = file('orphan-export'), oldTrash = file('old-trash', { trashedAt: '2026-11-06T01:00:00Z' });
    const foreign = file('foreign', { projectId: 'foreign' }), f = fixture([document, orphan, oldTrash, foreign], [oldTrash]);
    const ui = view(() => <ArtifactResults projectId="project" artifacts={[document]} runner={f.runner} />);
    await ui.settle(); expect(rowNames(ui.tree())).toEqual([document.name, orphan.name, oldTrash.name]);
    expect(ui.render()).toContain('项目文件'); ui.click('刷新项目文件'); await ui.settle();
    ui.click('回收站'); await ui.settle(); expect(ui.render()).toContain('本项目范围的产物回收站'); expect(rowNames(ui.tree())).toEqual([oldTrash.name]); expectNoModelCalls(f.controls);
  });

  it('uses real WorkflowRunCard history selection and discards a late preview from the previous attempt', async () => {
    const old = file('old-attempt'), document = current(), check = report(), pending = deferred<ArtifactPreview>();
    const history = run([attempt('attempt-old', [old], { costCents: 31, costState: 'calculated' }), attempt('attempt-current', [check, document], { costCents: 47, costState: 'calculated' })]);
    const f = fixture([file('older-project-export'), old, document, check], [], [history]), props = pageProps(f.runner);
    const original = JSON.stringify({ history, ledger: props.ledger }); f.io.previewArtifact.mockImplementationOnce(() => pending.promise);
    const ui = view(() => <WorkflowRunCard props={props} run={history} />);
    expect(ui.button('收起步骤与结果')).toBeDefined(); await ui.settle(); expect(rowNames(ui.tree())).toEqual([document.name, check.name]);
    ui.click(`预览产物 ${document.name}`); ui.render();
    const select = all(ui.tree(), item => item.type === 'select' && item.props['aria-label'] === '查看步骤 保存编辑后的文件 的历史尝试')[0];
    expect(select).toBeDefined(); (select.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'attempt-old' } });
    await ui.settle(); expect(rowNames(ui.tree())).toEqual([old.name]);
    pending.resolve({ mimeType: document.mimeType, text: '不能串入历史尝试的迟到预览' }); await ui.settle();
    expect(ui.render()).not.toContain('不能串入历史尝试的迟到预览'); expect(all(ui.tree(), item => item.props.role === 'dialog')).toHaveLength(0);
    expect(f.io.previewArtifact).toHaveBeenCalledExactlyOnceWith(document.id);
    expect(JSON.stringify({ history, ledger: props.ledger })).toBe(original); expectNoModelCalls(f.controls);
  });
});
