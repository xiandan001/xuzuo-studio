// @vitest-environment jsdom
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PageProps, Project } from '../types';
import type { WorkflowDefinition } from '../configuration-types';
import { AutomationProjectField } from './AutomationProjectField';
import { AutomationCenter } from '../pages/AutomationCenter';
import { Workflows } from '../pages/Workflows';
import { RunWorkflowDialog } from './RunWorkflowDialog';
import { WorkflowEditor } from './WorkflowEditor';

let root: Root | undefined, host: HTMLDivElement;
const project = (id: string, kind: Project['kind'] = 'word', workspaceId = 'workspace') => ({ id, workspaceId, name: `项目-${id}`, kind, description: `本次需求-${id}`, status: 'draft', version: 0, costCents: 0, accent: 'blue', updatedAt: '' } as Project);
const workflow: WorkflowDefinition = { id: 'workflow', workspaceId: 'workspace', name: '保存既有Word内容', description: '本地保存', outputKind: 'word', updatedAt: '', steps: [{ id: 'export', name: '保存', kind: 'export', enabled: true, inputSource: 'project', prompt: '' }] };
beforeEach(() => {
  localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', vi.fn(() => { throw Error('No network in project creation caller tests'); }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  host = document.createElement('div'); document.body.append(host); Object.defineProperty(window, 'desktop', { configurable: true, value: undefined });
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren(); expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function props(overrides: Partial<PageProps> = {}) { return { workspaceId: 'workspace', workspace: { id: 'workspace', name: '工作区' }, projects: [], activeProject: project('old', 'image'), ledger: [], preferences: { confirmGeneration: false }, configuration: { models: [], connections: [], credentials: [], categories: [], workflows: [], studioActions: [], useTemplates: [], saveWorkflow: vi.fn(() => true) }, workflowRunner: { runs: [], runtimeStatus: { available: false }, startLive: vi.fn(), preflight: vi.fn() }, onCreateProject: vi.fn(), notify: vi.fn(), navigate: vi.fn(), ...overrides } as unknown as PageProps; }
async function render(node: ReactNode) { await act(async () => { root ||= createRoot(host); root.render(node); }); }
async function click(label: string) { const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label); expect(button, label).toBeTruthy(); await act(async () => button!.click()); }
async function fill(label: string, value: string) { const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!; expect(field).toBeTruthy(); await act(async () => { Object.getOwnPropertyDescriptor(field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); }); }

it('通用自动化新建不锁死Word；创建期间防重复，取消可重试且迟到回调不切换工作区', async () => {
  const page = props({ projects: [project('old')] }), selected = vi.fn();
  await render(<AutomationProjectField props={page} value="old" label="项目" ariaLabel="目标项目" onSelect={selected} />); await click('新建项目');
  expect(document.querySelector('.auto-field-heading button')?.textContent).toContain('准备项目'); await act(async () => (document.querySelector('.auto-field-heading button') as HTMLButtonElement).click());
  const create = vi.mocked(page.onCreateProject); expect(create).toHaveBeenCalledTimes(1); expect(create.mock.calls[0][0]).toBeUndefined();
  await act(async () => create.mock.calls[0][1]!.onCancelled!()); await click('新建项目'); expect(create).toHaveBeenCalledTimes(2);
  await render(<AutomationProjectField props={{ ...page, workspaceId: 'other' }} value="" label="项目" ariaLabel="目标项目" onSelect={selected} />);
  await act(async () => create.mock.calls[1][1]!.onCreated!(project('new'))); expect(selected).not.toHaveBeenCalled();
});
it('计划类型已明确的新建带入quick与原需求，取消不改变已选项目', async () => {
  const page = props(), selected = vi.fn(); await render(<AutomationProjectField props={page} value="" label="保存项目" ariaLabel="保存项目" newProjectKind="image" quickCreate initialDescription="原本已填的壁纸要求" onSelect={selected} />);
  await click('新建项目'); const call = vi.mocked(page.onCreateProject).mock.calls[0]; expect(call).toEqual(['image', expect.objectContaining({ quick: true, initial: { description: '原本已填的壁纸要求' } })]);
  await act(async () => call[1]!.onCancelled!()); expect(selected).not.toHaveBeenCalled(); await click('新建项目');
  await act(async () => vi.mocked(page.onCreateProject).mock.calls[1][1]!.onCreated!(project('new-image', 'image'))); expect(selected).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-image' }));
});
it('自动化空入口创建后保留明确的新项目ID，项目列表迟到时不落到旧项目，已填目标不丢', async () => {
  const page = props(); await render(<AutomationCenter {...page} />); await click('新建项目'); const call = vi.mocked(page.onCreateProject).mock.calls[0]; expect(call[0]).toBeUndefined();
  const created = project('created', 'ppt'); await act(async () => call[1]!.onCreated!(created)); await fill('标准流程名称', '保留本次流程名'); await fill('标准流程目标', '保留已填目标与受众');
  await render(<AutomationCenter {...page} projects={[created]} />);
  expect(document.querySelector('[aria-label="标准流程项目"]')?.textContent).toContain(created.name); expect(document.querySelector<HTMLInputElement>('[aria-label="标准流程名称"]')?.value).toBe('保留本次流程名'); expect(document.querySelector<HTMLTextAreaElement>('[aria-label="标准流程目标"]')?.value).toBe('保留已填目标与受众');
  await act(async () => document.querySelector<HTMLFormElement>('.auto-modal form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const saved = vi.mocked(page.configuration.saveWorkflow).mock.calls[0][0]; expect(saved.outputKind).toBe('ppt'); expect(saved.name).toBe('保留本次流程名'); expect(JSON.stringify(saved)).toContain('保留已填目标与受众');
});
it('从工作流新建使用已知名称quick接续，回调目标ID明确传给运行窗口并保留新需求', async () => {
  const page = props(); page.configuration.workflows = [workflow]; await render(<Workflows {...page} />); await click('先创建项目');
  const call = vi.mocked(page.onCreateProject).mock.calls[0]; expect(call).toEqual(['word', expect.objectContaining({ quick: true, initial: { name: workflow.name } })]);
  const created = project('created-word'); await act(async () => call[1]!.onCreated!(created)); await render(<Workflows {...page} projects={[created]} />);
  expect(document.querySelector('[aria-label="运行关联项目"]')?.textContent).toContain(created.name); expect(document.querySelector<HTMLTextAreaElement>('[aria-label="工作流本次需求"]')?.value).toBe(created.description); expect(page.workflowRunner.startLive).not.toHaveBeenCalled();
});
it('运行窗口尊重明确的新建ID，未登记前不默认落到其他现有项目或允许运行', async () => {
  const old = project('old'), created = project('created'), page = props({ projects: [old], activeProject: old }), onClose = vi.fn();
  const dialog = (value: PageProps) => <RunWorkflowDialog props={value} workflow={workflow} initial={{ projectId: created.id, input: '只给新项目的需求', mode: 'simulation' }} onClose={onClose} onStarted={vi.fn()} onEdit={vi.fn()} />;
  await render(dialog(page)); const start = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === '开始模拟')!; expect(start().disabled).toBe(true);
  expect(document.querySelector('[aria-label="运行关联项目"]')?.textContent).not.toContain(old.name); await render(dialog({ ...page, projects: [old, created] }));
  expect(document.querySelector('[aria-label="运行关联项目"]')?.textContent).toContain(created.name); expect(document.querySelector<HTMLTextAreaElement>('[aria-label="工作流本次需求"]')?.value).toBe('只给新项目的需求'); expect(start().disabled).toBe(false); expect(onClose).not.toHaveBeenCalled();
});

it('红包专用确认固定生成规格，保留付费勾选和模型账户入口', async () => {
  const imageProject = project('cover', 'image');
  const page = props({ projects: [imageProject], activeProject: imageProject });
  page.preferences.confirmGeneration = true;
  page.workflowRunner.runtimeStatus = { available: true };
  page.configuration.models = [{ id: 'model', connectionId: 'connection', name: '图像测试模型', modelId: 'dall-e-3', enabled: true, capabilities: ['image-generation'], pricing: { unit: 'image', currency: 'CNY', input: '', output: '0.10' } }];
  page.configuration.connections = [{ id: 'connection', name: '隔离服务', enabled: true, providerId: 'openai', protocol: 'openai-chat', baseUrl: 'https://offline.invalid', status: 'configured' }];
  page.configuration.credentials = [{ id: 'key', name: '测试账户', connectionId: 'connection', lastFour: '0000', enabled: true, updatedAt: '' } as PageProps['configuration']['credentials'][number]];
  const imageWorkflow: WorkflowDefinition = { ...workflow, id: 'quick-cover', outputKind: 'image', steps: [
    { id: 'cover', name: '生成封面', kind: 'image-generation', enabled: true, inputSource: 'project', prompt: '用梅花制作照片封面', imageSize: '1536x1024', imageOutputFormat: 'gif', count: 4, modelConfigId: 'model', credentialId: 'key' },
  ] };
  const steps = [{ id: 'cover', name: '生成封面', kind: 'image-generation' }];
  const preflight = vi.mocked(page.workflowRunner.preflight);
  preflight.mockResolvedValue({ ok: false, errors: ['尺寸参数无效', '请核对 Key'], warnings: [], steps, unknownCost: false, issues: [
    { stepId: 'cover', field: 'imageSize', message: '尺寸参数无效' }, { stepId: 'cover', field: 'credentialId', message: '请核对 Key' },
  ] });
  const onEdit = vi.fn();
  const dialog = (fixed: boolean) => <RunWorkflowDialog key={String(fixed)} props={page} workflow={imageWorkflow} initial={{ projectId: imageProject.id, input: '创作梅花封面', attachmentIds: ['reference'] }}
    studio redPacketCover={fixed} onClose={vi.fn()} onStarted={vi.fn()} onEdit={onEdit} onConfigure={vi.fn()} />;
  await render(dialog(true));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
  expect(document.querySelector('.wf-run-dialog')?.textContent).toContain('957 × 1278 JPEG');
  expect(document.querySelector('.wf-run-dialog')?.textContent).not.toContain('高级步骤');
  const issues = [...document.querySelectorAll('.wf-validation-issues li')];
  expect(issues[0]?.querySelector('button')).toBeNull();
  expect(issues[1]?.querySelector('button')).toBeTruthy();
  await act(async () => issues[1]?.querySelector('button')?.click());
  expect(document.querySelector('[aria-label="生成确认凭证 生成封面"]')?.closest('details')?.open).toBe(true);
  expect(onEdit).not.toHaveBeenCalled();
  expect(page.workflowRunner.startLive).not.toHaveBeenCalled();
  expect(preflight.mock.calls[0][0].steps[0]).toMatchObject({ imageSize: '1024x1792', imageBackground: 'opaque', imageOutputFormat: 'png', count: 1 });

  preflight.mockResolvedValue({ ok: true, errors: [], warnings: [], steps, unknownCost: false });
  vi.mocked(page.workflowRunner.startLive).mockResolvedValue({ status: 'started', runId: 'cover-run' });
  await click('重新检查');
  const start = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === '确认并开始')!;
  expect(start().disabled).toBe(true);
  await act(async () => document.querySelector<HTMLInputElement>('[aria-label="确认本次模型调用"]')?.click());
  await click('确认并开始');
  expect(page.workflowRunner.startLive).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ steps: [expect.objectContaining({ imageSize: '1024x1792', count: 1 })] }), imageProject.id, '创作梅花封面', {}, ['reference'], false, undefined);

  await render(dialog(false));
  await click('高级步骤');
  expect(onEdit).toHaveBeenCalledOnce();
});

it('保存旧版红包模板时自动替换无效的图片设置，保留提示词和账户', async () => {
  const coverProject = project('cover-project', 'image');
  const page = props({ projects: [coverProject], prompts: [] });
  page.configuration.models = [{ id: 'model', connectionId: 'connection', name: '图像模型', modelId: 'gpt-image-1', enabled: true, capabilities: ['image-generation'], pricing: { unit: 'image', currency: 'CNY', input: '', output: '0.10' } }];
  page.configuration.connections = [{ id: 'connection', name: '隔离服务', enabled: true, providerId: 'openai', protocol: 'openai-chat', baseUrl: 'https://offline.invalid', status: 'configured' }];
  page.configuration.credentials = [{ id: 'key', name: '测试账户', connectionId: 'connection', lastFour: '0000', enabled: true, updatedAt: '' } as PageProps['configuration']['credentials'][number]];
  const id = 'quick-cover-project-image-generation-red-packet-cover', prompt = '用梅花制作红包封面';
  await render(<WorkflowEditor props={page} workflowId={id} initial={{ name: '自定义红包制作', description: '', outputKind: 'image', steps: [
    { id: 'cover', name: '生成封面', kind: 'image-generation', enabled: true, inputSource: 'project', prompt, imageSize: '1536x1024', imageOutputFormat: 'gif', imageFrameCount: 9, imageBackground: 'transparent', count: 4, modelConfigId: 'model', credentialId: 'key' },
  ] }} onClose={vi.fn()} />);
  const form = document.querySelector<HTMLFormElement>('#wf-editor-form')!;
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const saveCall = vi.mocked(page.configuration.saveWorkflow).mock.calls[0];
  expect(saveCall).toEqual([expect.objectContaining({ imagePreset: '微信红包封面' }), id]);
  expect(saveCall[0].steps[0]).toMatchObject({ prompt, credentialId: 'key', count: 1, imageSize: '1024x1536', imageBackground: 'opaque', imageOutputFormat: 'png' });
  expect(saveCall[0].steps[0].imageFrameCount).toBeUndefined();
});
