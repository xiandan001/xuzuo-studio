// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageStudio } from './ImageStudio';
import type { PageProps, Project } from '../types';
import type { ArtifactMetadata } from '../live-types';
import type { WorkflowRun } from '../configuration-types';
import { imageDraftKey } from '../lib/image-studio';
import { studioPreferenceKey } from '../lib/studio-layout-state';
import { writeDisclosure } from '../lib/disclosure-state';

const project: Project = { id: 'red-packet-project', workspaceId: 'workspace', name: '封面验收', kind: 'image', status: 'draft', description: '', updatedAt: '2026-11-18T00:00:00Z', version: 0, costCents: 0, accent: 'blue' };
const image: ArtifactMetadata = { id: 'cover-original', projectId: project.id, runId: 'run', kind: 'image', mimeType: 'image/png', bytes: 68, name: '红包原图.png', path: '', createdAt: project.updatedAt };
const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2FEAAAAASUVORK5CYII=';
const coverLabel = '微信红包封面';
const generateLabel = '生成微信红包封面';
let root: Root | undefined, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('红包封面验收在本地运行'); }));
  const size = { x: 80, y: 80, top: 80, left: 80, bottom: 120, right: 320, width: 240, height: 40, toJSON: () => ({}) };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(size);
  host = document.createElement('div');
  document.body.append(host);
  for (const [setting, value] of [['initialized', true], ['panel-open', true], ['focus', false], ['tool', 'ai']] as const) {
    writeDisclosure(studioPreferenceKey('images', { workspaceId: project.workspaceId, projectId: project.id }, setting), value);
  }
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host.remove();
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function fixture(withImage = false) {
  const onGenerate = vi.fn(), exportRedPacketCover = vi.fn(async () => ({ saved: true }));
  const run = { id: image.runId, mode: 'live', status: 'complete', workspaceId: project.workspaceId, projectId: project.id, workflowId: 'flow', workflowName: '生成封面', updatedAt: project.updatedAt, createdAt: project.updatedAt, stepIndex: 1,
    snapshot: { id: 'flow', workspaceId: project.workspaceId, outputKind: 'image', steps: [{ id: 'cover', kind: 'image-generation', enabled: true }] },
    attempts: [{ id: 'attempt', stepId: 'cover', action: '初次生成', status: 'complete', artifacts: [image] }],
  } as unknown as WorkflowRun;
  const runner = { runs: withImage ? [run] : [], runtimeStatus: { available: true }, trashedArtifacts: [], exportRedPacketCover, saveArtifact: vi.fn(), importFiles: vi.fn(async () => [image]),
    previewArtifact: vi.fn(async () => ({ supported: true, mimeType: image.mimeType, dataUrl })), inspectImageArtifact: vi.fn(async () => ({ mimeType: image.mimeType, bytes: image.bytes })),
  };
  const props = { activeProject: project, workspaceId: project.workspaceId, workspace: { id: project.workspaceId, name: '验收工作区' }, projects: [project], ledger: [], workflowRunner: runner,
    onGenerate, notify: vi.fn(), onPromptApplied: vi.fn(), onUpdateProject: vi.fn(), navigate: vi.fn(), prompts: [], preferences: {},
    configuration: { categories: [], workflows: [], studioActions: [], credentials: [{ id: 'key', name: '测试账户', connectionId: 'connection', enabled: true }],
      models: [{ id: 'model', modelId: 'gpt-image-1.5', name: '测试模型', connectionId: 'connection', capabilities: ['image-generation', 'image-editing'], enabled: true }],
      connections: [{ id: 'connection', name: '测试连接', providerId: 'openai', enabled: true }],
    },
  } as unknown as PageProps;
  return { props, runner, onGenerate, exportRedPacketCover };
}
async function render(props: PageProps) { await act(async () => { root ||= createRoot(host); root.render(<ImageStudio {...props} />); }); }
function button(label: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label || item.textContent?.trim() === label);
  expect(found, `Missing ${label}`).toBeDefined();
  return found!;
}
async function click(label: string) { await act(async () => button(label).click()); }
const theme = () => host.querySelector<HTMLTextAreaElement>('.red-packet-form textarea')!;
async function setTheme(value: string) {
  await act(async () => {
    const input = theme();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('微信红包封面工作台', () => {
  it('只要求主题，沿用保存的草稿时不沿用旧图像参数', async () => {
    localStorage.setItem(imageDraftKey(project.id), JSON.stringify({ preset: coverLabel, mode: 'refine', prompt: '', quantity: 4, size: '1536x1024',
      background: 'transparent', wallpaperEnabled: true, wallpaperTarget: { width: 2160, height: 3840, fit: 'cover' },
      imageOptions: { imageOutputFormat: 'gif', imageFrameCount: 6 }, references: [],
    }));
    const f = fixture(); await render(f.props);
    expect(button(generateLabel).disabled).toBe(true);
    expect(host.querySelector('[aria-label="图像生成数量"],[aria-label="图像输出尺寸"],[aria-label="图像输出背景"],[aria-label="图片输出格式"],[aria-label="壁纸设备或分辨率"]')).toBeNull();
    expect(host.textContent).toContain('957 × 1278 JPEG');
    await setTheme('灯笼和一只橘猫，温暖的过年气氛');
    await click(generateLabel);
    expect(f.onGenerate).toHaveBeenCalledWith(project.id, '初次生成', 1, undefined, expect.objectContaining({
      prompt: expect.stringContaining('灯笼和一只橘猫'), imageSize: '1024x1536', imageOutputFormat: 'png', imageBackground: 'opaque',
      attachmentIds: [], capability: 'image-generation', modelConfigId: 'model', credentialId: 'key', redPacketCover: true,
    }));
    const parameters = f.onGenerate.mock.calls[0][4];
    expect(parameters).not.toHaveProperty('wallpaperTarget');
    expect(parameters).not.toHaveProperty('imageFrameCount');
  });

  it('从用途进入后可采用实际原图作为可选参考，原图预览和 JPEG 导出不会重新生成', async () => {
    const f = fixture(true); await render(f.props); await click(coverLabel);
    await setTheme('用参考图制作梅花红包');
    await click('当前图作参考'); await click(generateLabel);
    expect(f.onGenerate).toHaveBeenCalledWith(project.id, '重新生成', 1, undefined, expect.objectContaining({ capability: 'image-editing', attachmentIds: [image.id] }));
    expect(host.querySelector('.red-packet-simulation')).toBeNull();
    await click('红包位置模拟');
    const preview = host.querySelector<HTMLImageElement>('img[alt="裁剪后的红包封面画面"]');
    expect(preview?.src).toBe(dataUrl);
    await click('原图');
    expect(host.querySelector('.red-packet-simulation')).toBeNull();
    await click('导出红包封面 JPEG');
    expect(f.exportRedPacketCover).toHaveBeenCalledExactlyOnceWith({ projectId: project.id, sourceArtifactId: image.id });
    expect(f.runner.saveArtifact).not.toHaveBeenCalled();
    expect(f.onGenerate).toHaveBeenCalledTimes(1);
    await click('图片');
    expect(host.querySelector('.red-packet-form')).toBeNull();
    expect(button('生成图片')).toBeDefined();
  });
});
