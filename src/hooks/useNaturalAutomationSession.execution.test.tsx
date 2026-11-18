// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AutomationJob, AutomationRule, AutomationSnapshot } from '../automation-types';
import type { WorkflowDefinition } from '../configuration-types';
import type { LivePreflight } from '../live-types';
import type { PageProps, Project } from '../types';
import { naturalAutomationDraftStorageKey, type NaturalAutomationDraft } from './useNaturalAutomationDraft';
import { useNaturalAutomationSession, type NaturalAutomationSession } from './useNaturalAutomationSession';

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // A hidden renderer may not paint while its native execution IPC remains available.
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.useFakeTimers();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('保存过的方案执行不等待后台状态刷新，慢预检不取消或重复派发', async () => {
  const workspaceId = 'workspace';
  const updatedAt = '2026-11-18T10:00:00Z';
  const project: Project = { id: 'project', workspaceId, name: '合作说明书', description: '', kind: 'word', status: 'draft', costCents: 0, version: 0, accent: 'blue', updatedAt };
  const binding = { modelConfigId: 'text-model', credentialId: 'text-account' };
  const workflow: WorkflowDefinition = { id: 'workflow', workspaceId, name: project.name, description: '', outputKind: 'word', updatedAt, steps: [{ id: 'draft-step', name: '撰写说明', kind: 'text', enabled: true, inputSource: 'project', prompt: '撰写合作说明', ...binding }] };
  const rule: AutomationRule = { id: 'rule', workspaceId, projectId: project.id, workflowId: workflow.id, name: project.name, trigger: 'manual', enabled: false, input: '制作说明书', variables: {}, updatedAt };
  const draft: NaturalAutomationDraft = {
    version: 1, workspaceId, projectId: project.id, input: rule.input, planner: binding, bindings: { text: binding },
    workflowId: workflow.id, ruleId: rule.id, workflowSaved: true,
    plan: { version: 1, name: project.name, objective: rule.input, outputKind: 'word', trigger: { type: 'manual' }, steps: [{ kind: 'text', name: '撰写说明', instruction: '按明确资料撰写' }], illustrations: { mode: 'none', count: 0 }, acceptance: ['正文完整'], constraints: [], questions: [], unsupported: [], maxRepairs: 0 },
  };
  localStorage.setItem(naturalAutomationDraftStorageKey(workspaceId), JSON.stringify(draft));

  const jobs: AutomationJob[] = [];
  const nativeSnapshot = (): AutomationSnapshot => ({ revision: 1, available: true, rules: [structuredClone(rule)], jobs: structuredClone(jobs), events: [], decisions: [], memories: [] });
  const snapshot = vi.fn<() => Promise<AutomationSnapshot>>()
    .mockResolvedValueOnce(nativeSnapshot()) // Load the already saved rule.
    .mockImplementationOnce(() => new Promise(() => undefined)) // Background progress read stalls.
    .mockImplementation(async () => nativeSnapshot());
  const trigger = vi.fn(async ({ ruleId }: { ruleId: string }) => {
    const job: AutomationJob = { id: 'job-one', workspaceId, projectId: project.id, ruleId, eventId: 'manual-event', dispatchKey: 'a'.repeat(64), status: 'queued', createdAt: updatedAt, updatedAt, attachmentIds: [], input: rule.input };
    jobs.push(job);
    return job;
  });
  const saveRule = vi.fn(async () => structuredClone(rule));
  vi.stubGlobal('desktop', { automation: { snapshot, syncContext: async () => undefined, saveRule, trigger } });

  let finishPreflight!: (value: LivePreflight) => void;
  const preflight = vi.fn(() => new Promise<LivePreflight>(resolve => { finishPreflight = resolve; }));
  const props = {
    workspaceId, projects: [project], activeProject: project, workspaces: [{ id: workspaceId, name: '隔离工作区' }], ledger: [],
    configuration: {
      workflows: [workflow], saveWorkflow: vi.fn(() => true),
      connections: [{ id: 'connection', providerId: 'openai', protocol: 'openai-responses', enabled: true }],
      models: [{ id: binding.modelConfigId, connectionId: 'connection', modelId: 'gpt-6.2-sol', enabled: true, capabilities: ['text'] }],
      credentials: [{ id: binding.credentialId, connectionId: 'connection', enabled: true }],
    },
    workflowRunner: { runs: [], preflight }, notify: vi.fn(),
  } as unknown as PageProps;
  let session!: NaturalAutomationSession;
  function Fixture() { session = useNaturalAutomationSession(props, { draftOptions: { keepCreatedDraft: true } }); return null; }
  await act(async () => root.render(<Fixture />));
  expect(session.readiness.loadedRuleId).toBe(rule.id);
  expect(session.readiness.dispatchLoading).toBe(true);

  let flight!: ReturnType<NaturalAutomationSession['createAndRun']>;
  await act(async () => { flight = session.createAndRun(); });
  expect(preflight).toHaveBeenCalledOnce();
  expect(trigger).not.toHaveBeenCalled();

  await act(async () => vi.advanceTimersByTimeAsync(21000));
  expect(session.runBusy).toBe(true);
  expect(session.createAndRun()).toBe(flight);
  await act(async () => { finishPreflight({ ok: true, errors: [], warnings: [], steps: [], unknownCost: false }); });

  await expect(flight).resolves.toMatchObject({ status: 'started', job: { id: 'job-one', ruleId: rule.id } });
  expect(session.runBusy).toBe(false);
  expect(trigger).toHaveBeenCalledExactlyOnceWith({ ruleId: rule.id });
  expect(saveRule).toHaveBeenCalledTimes(1);
  expect((await session.createAndRun()).status).toBe('existing');
  expect(trigger).toHaveBeenCalledOnce();
});
