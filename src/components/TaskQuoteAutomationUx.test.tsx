import { afterEach, describe, expect, it, vi } from 'vitest';
import { isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PageProps } from '../types';
import type { WorkflowRun } from '../configuration-types';
import type { CustomerQuoteInfo } from '../lib/customer-quote';
import { emptyCustomerQuote } from '../lib/customer-quote';
import { WorkflowRunCard } from './WorkflowRunCard';
import { CustomerQuotePanel } from './CustomerQuotePanel';
import { AutomationCenter } from '../pages/AutomationCenter';

const hooks = vi.hoisted(() => {
  type Effect = { deps?: readonly unknown[]; cleanup?: () => void };
  const slots: unknown[] = [], effects = new Map<number, Effect>();
  let cursor = 0, changed = false, pending: { index: number; action: () => void | (() => void); deps?: readonly unknown[] }[] = [];
  const unmount = () => { for (const effect of effects.values()) effect.cleanup?.(); effects.clear(); pending = []; };
  return {
    reset() { unmount(); slots.length = 0; cursor = 0; changed = false; },
    begin() { cursor = 0; changed = false; },
    changed: () => changed,
    useState(initial: unknown) {
      const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value: unknown) => { const next = typeof value === 'function' ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; changed = true; } }];
    },
    useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useId() { const index = cursor++; if (!(index in slots)) slots[index] = `test-field-${index}`; return String(slots[index]); },
    useEffect(action: () => void | (() => void), deps?: readonly unknown[]) {
      const index = cursor++, previous = effects.get(index);
      if (!previous || !deps || deps.length !== previous.deps?.length || deps.some((value, position) => !Object.is(value, previous.deps?.[position]))) pending.push({ index, action, deps });
    },
    commit() {
      const queued = pending; pending = [];
      for (const effect of queued) { effects.get(effect.index)?.cleanup?.(); const cleanup = effect.action(); effects.set(effect.index, { deps: effect.deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }); }
    },
    unmount,
  };
});
const automation = vi.hoisted(() => ({ tab: 'history', snapshot: {} as unknown }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: hooks.useState, useRef: hooks.useRef, useEffect: hooks.useEffect, useId: hooks.useId }));
vi.mock('../hooks/useRememberedBoolean', () => ({ useRememberedBoolean: (_key: string, fallback: boolean) => hooks.useState(fallback) }));
vi.mock('../hooks/useRememberedString', () => ({ useRememberedString: () => hooks.useState(automation.tab) }));
vi.mock('../hooks/useAutomationCenter', () => ({ useAutomationCenter: () => ({ snapshot: automation.snapshot, bridge: undefined, refresh: async () => undefined, loading: false }) }));
vi.mock('../lib/editor-session-guard', () => ({ registerEditorSession: () => () => undefined }));
vi.mock('./RememberedDetails', () => ({ RememberedDetails: ({ children, className }: { children: ReactNode; className?: string }) => <details open className={className}>{children}</details> }));
vi.mock('./ModalPortal', () => ({ ModalPortal: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('./TaskRunActions', () => ({ TaskRunActions: () => null }));
vi.mock('./ArtifactResults', () => ({ ArtifactResults: () => null }));

const flush = async () => { for (let index = 0; index < 6; index++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function find(node: ReactNode, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return undefined;
  return predicate(node) ? node : find(node.props.children as ReactNode, predicate);
}
function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : '';
}
function view(component: () => ReactElement) {
  hooks.reset(); let tree!: ReactElement;
  const render = () => {
    for (let pass = 0; pass < 8; pass++) { hooks.begin(); tree = component(); const html = renderToStaticMarkup(tree); hooks.commit(); if (!hooks.changed()) return html; }
    throw Error('Controlled component did not settle');
  };
  const button = (label: string) => { const result = find(tree, element => element.type === 'button' && text(element.props.children as ReactNode) === label); if (!result) throw Error(`Missing button: ${label}`); return result; };
  render();
  return { render, tree: () => tree, button, click: (label: string) => { (button(label).props.onClick as () => void)(); } };
}
const project = { id: 'project', workspaceId: 'workspace', kind: 'word', name: '独立项目', status: 'draft', version: 0, costCents: 0, accent: 'blue', updatedAt: '2026-11-06T00:00:00Z' };
const pageProps = () => ({ workspaceId: 'workspace', workspace: { id: 'workspace', name: '独立工作区' }, activeProject: project, projects: [project], configuration: { workflows: [], categories: [], models: [], connections: [], credentials: [] }, preferences: { confirmGeneration: true }, ledger: [], navigate: vi.fn(), notify: vi.fn(), onCreateProject: vi.fn() } as unknown as PageProps);
function summary(): WorkflowRun {
  return { id: 'run', workspaceId: 'workspace', projectId: 'project', mode: 'live', workflowId: 'workflow', workflowName: '已有制作任务', status: 'complete', stepIndex: 0, attempts: [], variables: {}, input: '', createdAt: '2026-11-06T00:00:00Z', updatedAt: '2026-11-06T00:00:00Z', detailVersion: 1, contentTruncated: true, snapshot: { id: 'workflow', workspaceId: 'workspace', name: '已有制作任务', description: '', outputKind: 'word', steps: [], updatedAt: '2026-11-06T00:00:00Z' } };
}
function quoteFixture(changes: Partial<CustomerQuoteInfo> = {}) {
  let info = { ...emptyCustomerQuote(), scope: '交付十页可编辑方案', ...changes };
  const exportFile = vi.fn(async (_input: { html: string; format: string }) => ({ saved: true })), notify = vi.fn(), focus = vi.fn(), querySelector = vi.fn(() => ({ focus }));
  const onChange = vi.fn((field: keyof CustomerQuoteInfo, value: string) => { info = { ...info, [field]: value }; });
  vi.stubGlobal('window', { desktop: { customerQuotes: { export: exportFile } } });
  const f = view(() => CustomerQuotePanel({ workspaceId: 'workspace', projectId: 'project', title: '客户交付方案', priceCents: 9455, enabled: true, info, onChange, notify }));
  const attachForm = () => {
    const form = find(f.tree(), element => element.props.className === 'customer-quote-form')!;
    (form.props.ref as { current: unknown }).current = { querySelector };
  };
  const field = (label: string) => find(f.tree(), element => element.props['aria-label'] === label)!;
  attachForm();
  return { ...f, field, exportFile, notify, focus, querySelector, onChange, info: () => info, change: (label: string, value: string) => { (field(label).props.onChange as (event: { target: { value: string } }) => void)({ target: { value } }); f.render(); attachForm(); } };
}
function automationFixture(tab: string, counts: { rules?: number; history?: number; memory?: number }) {
  automation.tab = tab;
  automation.snapshot = { available: true, rules: Array.from({ length: counts.rules || 0 }, (_, index) => ({ id: `rule-${index}`, name: `规则${index}`, projectId: 'project', workflowId: 'workflow', trigger: 'manual', input: '', enabled: false })), decisions: [], jobs: Array.from({ length: counts.history || 0 }, (_, index) => ({ id: `job-${index}`, projectId: 'project', ruleId: 'rule', status: 'complete', createdAt: '2026-11-06T00:00:00Z' })), memories: Array.from({ length: counts.memory || 0 }, (_, index) => ({ id: `memory-${index}`, projectId: 'project', note: `偏好${index}`, action: 'approve', createdAt: '2026-11-06T00:00:00Z' })) };
  const props = pageProps(); return view(() => AutomationCenter(props));
}
afterEach(() => { hooks.unmount(); vi.unstubAllGlobals(); });

describe('task detail, customer quote and automation feedback', () => {
  it('failed detail reads stop loading and retry in place without model controls', async () => {
    const run = summary(), next = deferred<WorkflowRun>(), load = vi.fn().mockRejectedValueOnce(Error('磁盘暂不可读')).mockImplementationOnce(() => next.promise);
    const controls = { retry: vi.fn(), resume: vi.fn(), pause: vi.fn(), cancel: vi.fn() }, props = { ...pageProps(), workflowRunner: { ...controls, loadRunDetail: load } } as unknown as PageProps;
    const f = view(() => WorkflowRunCard({ props, run })); expect(load).not.toHaveBeenCalled();
    f.click('查看步骤与结果'); f.render(); await flush();
    expect(f.render()).toContain('磁盘暂不可读'); expect(f.render()).not.toContain('正在按需读取');
    const retry = f.button('重新读取详情'); (retry.props.onClick as () => void)(); (retry.props.onClick as () => void)();
    expect(f.render()).toContain('正在按需读取'); await flush(); expect(load).toHaveBeenCalledTimes(2);
    next.resolve({ ...run, contentTruncated: false }); await flush();
    expect(f.render()).not.toContain('磁盘暂不可读'); expect(f.render()).not.toContain('正在按需读取');
    expect(load.mock.calls.map(call => call[0])).toEqual(['run', 'run']);
    for (const action of Object.values(controls)) expect(action).not.toHaveBeenCalled();
  });

  it('collapsing a pending detail read ignores its late content', async () => {
    const run = summary(), pending = deferred<WorkflowRun>(), load = vi.fn(() => pending.promise), props = { ...pageProps(), workflowRunner: { loadRunDetail: load } } as unknown as PageProps;
    const f = view(() => WorkflowRunCard({ props, run })); f.click('查看步骤与结果'); f.render(); await flush();
    f.click('收起步骤与结果'); f.render(); pending.resolve({ ...run, workflowName: '不应显示的迟到内容', contentTruncated: false }); await flush();
    expect(f.render()).not.toContain('不应显示的迟到内容'); expect(f.render()).not.toContain('正在按需读取'); expect(load).toHaveBeenCalledTimes(1);
  });

  it('quote scope errors describe and focus their own field without altering price or exporting', () => {
    const f = quoteFixture({ scope: '' }), field = f.field('报价交付范围');
    expect(field.props['aria-invalid']).toBe(true);
    expect(find(f.tree(), element => element.props.id === field.props['aria-describedby'])).toBeDefined();
    f.click('定位问题字段'); expect(f.querySelector).toHaveBeenCalledWith('[data-quote-field="scope"]'); expect(f.focus).toHaveBeenCalledOnce();
    expect(f.onChange).not.toHaveBeenCalled(); expect(f.exportFile).not.toHaveBeenCalled(); expect(f.button('导出 PDF').props.disabled).toBe(true);
    f.change('报价交付范围', '已确认交付范围');
    expect(f.field('报价交付范围').props['aria-invalid']).toBeUndefined(); expect(f.button('导出 PDF').props.disabled).toBe(false);
    expect(f.info().quantity).toBe('1'); expect(f.info().scope).toBe('已确认交付范围');
  });

  it.each([
    ['quantity', '0', '报价交付数量'], ['revisions', '101', '报价包含修改次数'],
    ['deliveryDate', '2026-02-30', '报价交付日期'], ['validUntil', '2026-13-01', '报价有效期'],
  ] as const)('quote %s validation locates the correct field', (field, value, label) => {
    const f = quoteFixture({ [field]: value });
    expect(f.field(label).props['aria-invalid']).toBe(true); f.click('定位问题字段');
    expect(f.querySelector).toHaveBeenCalledWith(`[data-quote-field="${field}"]`); expect(f.exportFile).not.toHaveBeenCalled();
  });

  it('invalid quote export remains guarded and valid export keeps the computed amount', async () => {
    const f = quoteFixture({ scope: '' }); f.click('导出 PDF'); await flush(); expect(f.exportFile).not.toHaveBeenCalled();
    f.change('报价交付范围', '完整交付范围'); f.click('导出 PDF'); f.render(); await flush();
    expect(f.exportFile).toHaveBeenCalledTimes(1); const exported = f.exportFile.mock.calls[0][0] as unknown as { html: string; format: string };
    expect(exported.format).toBe('pdf'); expect(exported.html).toContain('¥94.55'); expect(exported.html).toContain('完整交付范围');
    expect(f.info().quantity).toBe('1');
  });

  it('an empty active automation tab has no more button despite other long lists', () => {
    const f = automationFixture('history', { rules: 40, history: 0, memory: 100 });
    expect(f.render()).toContain('规则第一次触发后'); expect(f.render()).not.toContain('再显示20项');
  });

  it('automation more stops at its own tab count and retains the 20-item increment', () => {
    const f = automationFixture('rules', { rules: 21, memory: 100 });
    expect((f.render().match(/auto-rule-card/g) || []).length).toBe(20); f.click('再显示20项');
    expect((f.render().match(/auto-rule-card/g) || []).length).toBe(21); expect(f.render()).not.toContain('再显示20项');
  });
});
