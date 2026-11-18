// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PageProps } from '../types';
import type { ArtifactMetadata } from '../live-types';
import type { WorkflowDefinition } from '../configuration-types';
import { DocumentImageTools } from './DocumentImageTools';
import { documentImageBindingKey, readDocumentImageBinding, saveDocumentImageBinding } from '../lib/document-image-binding';

let host: HTMLDivElement, root: Root;
const startLive = vi.fn(async () => ({ status: 'started', runId: 'new-run' }));
function props(projectId = 'project-a'): PageProps {
  return { workspaceId: 'workspace', activeProject: { id: projectId, kind: 'word', name: '真实文档' }, preferences: { confirmGeneration: false },
    configuration: { connections: [{ id: 'connection.one', name: '服务一', enabled: true }, { id: 'connection_two', name: '服务二', enabled: true }],
      models: [{ id: 'model.one_v2', name: '插图精修一', enabled: true, connectionId: 'connection.one', capabilities: ['image-editing'] }, { id: 'model:two', name: '插图精修二', enabled: true, connectionId: 'connection_two', capabilities: ['image-editing'] }],
      credentials: [{ id: 'account.one', name: '账户一', connectionId: 'connection.one', enabled: true }, { id: 'account_two', name: '账户二', connectionId: 'connection.one', enabled: true }, { id: 'account:three', name: '账户三', connectionId: 'connection_two', enabled: true }] },
    workflowRunner: { runs: [], startLive, thumbnailArtifact: vi.fn(async () => ({ mimeType: 'image/png', originalWidth: 1600, originalHeight: 900 })) }, navigate: vi.fn() } as unknown as PageProps;
}
const image = (projectId: string, id = 'image-a'): ArtifactMetadata => ({ id, projectId, name: '插图.png', mimeType: 'image/png', kind: 'image', bytes: 10, path: '', createdAt: '' });
async function render(value: PageProps, id = 'image-a') {
  await act(async () => root.render(<DocumentImageTools props={value} target={{ id: 'block-' + id, imageId: id }} images={[image(value.activeProject.id, id)]} disabled={false} beforeRun={() => true} onReplace={() => undefined} onImport={() => undefined} />));
}
async function click(node: HTMLElement) { await act(async () => node.click()); }
async function choose(label: string, text: string) {
  await click(host.querySelector<HTMLElement>('[aria-label="' + label + '"]')!);
  const option = [...document.querySelectorAll<HTMLElement>('[role=option]')].find(item => item.textContent?.trim() === text); expect(option).toBeTruthy(); await click(option!);
}
async function open() {
  const outer = host.querySelector<HTMLDetailsElement>('.document-image-tools>details')!; if (!outer.open) await click(outer.querySelector('summary')!);
  const settings = host.querySelector<HTMLDetailsElement>('.document-image-model-settings')!; if (!settings.open) await click(settings.querySelector('summary')!);
}
const startButton = () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('精修当前图片'))!;
beforeEach(() => {
  localStorage.clear(); startLive.mockClear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 10, right: 310, top: 10, bottom: 50, width: 300, height: 40, x: 10, y: 10, toJSON: () => ({}) });
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('按项目记忆有效模型和账户，切插图或重挂仍保留，主面板先显示要求和当前摘要', async () => {
  const value = props(); await render(value); await open();
  await choose('文档插图精修模型', '插图精修一'); await choose('文档插图精修凭证', '账户二');
  expect(readDocumentImageBinding('workspace', 'project-a')).toEqual({ modelConfigId: 'model.one_v2', connectionId: 'connection.one', credentialId: 'account_two' });
  await render(value, 'image-b'); expect(host.querySelector('[aria-label="文档插图精修凭证"]')!.textContent).toContain('账户二');
  expect(host.querySelector<HTMLDetailsElement>('.document-image-model-settings')!.open).toBe(true);
  await click(host.querySelector('.document-image-model-settings>summary')!); expect(host.querySelector<HTMLDetailsElement>('.document-image-model-settings')!.open).toBe(false);
  expect(host.querySelector('.document-image-model-settings>summary')!.textContent).toContain('插图精修一'); expect(host.querySelector('.document-image-model-settings>summary')!.textContent).toContain('账户二');
  expect(host.querySelector('[aria-label="文档插图修改要求"]')!.closest('details')).toBe(host.querySelector('.document-image-tools>details'));
  await act(async () => root.render(<></>)); await render(value, 'image-b');
  expect(host.querySelector('[aria-label="文档插图精修模型"]')!.textContent).toContain('插图精修一'); expect(host.querySelector('[aria-label="文档插图精修凭证"]')!.textContent).toContain('账户二');
  expect(startLive).not.toHaveBeenCalled(); expect(startButton().disabled).toBe(false);
  await click(startButton()); const [workflow, projectId, context, , references] = startLive.mock.calls[0] as unknown as [WorkflowDefinition, string, string, unknown, string[]];
  expect(workflow.steps[0]).toMatchObject({ modelConfigId: 'model.one_v2', credentialId: 'account_two' }); expect(projectId).toBe('project-a'); expect(JSON.parse(context)).toMatchObject({ sourceImageId: 'image-b' }); expect(references).toEqual(['image-b']);
});

it('原显式账户停用后即使只剩另一账户，也不能在当前或再次重挂时悄悄替换', async () => {
  saveDocumentImageBinding('workspace', 'project-a', { modelConfigId: 'model.one_v2', connectionId: 'connection.one', credentialId: 'account_two' });
  const value = props(); value.configuration.credentials = value.configuration.credentials.map(item => item.id === 'account_two' ? { ...item, enabled: false } : item);
  const stored = localStorage.getItem(documentImageBindingKey('workspace', 'project-a'));
  await render(value); expect(startButton().disabled).toBe(true); expect(localStorage.getItem(documentImageBindingKey('workspace', 'project-a'))).toBe(stored);
  await act(async () => root.render(<></>)); await render(value); expect(startButton().disabled).toBe(true); expect(localStorage.getItem(documentImageBindingKey('workspace', 'project-a'))).toBe(stored);
  await open(); await choose('文档插图精修凭证', '账户一'); expect(startButton().disabled).toBe(false);
  expect(readDocumentImageBinding('workspace', 'project-a').credentialId).toBe('account.one'); expect(startLive).not.toHaveBeenCalled();
});

it('连接变更或模型停用要求重选，另一项目与工作区不继承本项目的账户', async () => {
  saveDocumentImageBinding('workspace', 'project-a', { modelConfigId: 'model.one_v2', connectionId: 'connection.one', credentialId: 'account_two' });
  const value = props(); value.configuration.models = value.configuration.models.map(item => item.id === 'model.one_v2' ? { ...item, connectionId: 'connection_two' } : item);
  await render(value); expect(startButton().disabled).toBe(true);
  expect(readDocumentImageBinding('workspace', 'project-a').connectionId).toBe('connection.one');
  await open(); await choose('文档插图精修凭证', '账户三'); expect(startButton().disabled).toBe(false);
  await render(props('project-b')); expect(startButton().disabled).toBe(true); expect(readDocumentImageBinding('workspace', 'project-b')).toEqual({});
  const elsewhere = props(); elsewhere.workspaceId = 'other-workspace'; await render(elsewhere); expect(startButton().disabled).toBe(true);
  const disabled = props(); disabled.configuration.models = disabled.configuration.models.map(item => item.id === 'model.one_v2' ? { ...item, enabled: false } : item);
  await render(disabled); expect(startButton().disabled).toBe(true); expect(startLive).not.toHaveBeenCalled();
});

it('记忆只保存编号，支持现有合法ID中的点下划线冒号，异常字段和存储失败安全保留当前操作', () => {
  const saved: Record<string, string> = {};
  const store = { setItem: (key: string, value: string) => { saved[key] = value; }, getItem: (key: string) => saved[key] || null };
  expect(saveDocumentImageBinding('w', 'p', { modelConfigId: 'model.one_v2', connectionId: 'connection:one', credentialId: 'account_one' }, store)).toBe(true);
  expect(readDocumentImageBinding('w', 'p', store)).toEqual({ modelConfigId: 'model.one_v2', connectionId: 'connection:one', credentialId: 'account_one' });
  expect(Object.keys(JSON.parse(saved[documentImageBindingKey('w', 'p')])).sort()).toEqual(['version', 'modelConfigId', 'connectionId', 'credentialId'].sort());
  saved[documentImageBindingKey('w', 'p')] = '{"version":1,"modelConfigId":"model.one_v2","secret":"MUST_NOT_LOAD"}';
  expect(readDocumentImageBinding('w', 'p', store)).toEqual({});
  expect(saveDocumentImageBinding('w', 'p', { modelConfigId: 'model.one_v2' }, { setItem() { throw Error('Full'); } })).toBe(false);
});
